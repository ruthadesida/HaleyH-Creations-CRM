-- Books Phase D review fixes:
-- 1. Records dated before the books' first live year (covered by the imported figures) are refused with a clear
--    message instead of being saved without a journal: VAT returns, tax payments, pay runs, depreciation runs,
--    disposals, repayments and director money. Loans and assets from then join their registers without posting.
-- 2. An asset bought before the live year must be added as "already in the books"; depreciation counted so far
--    needs its date; a newly bought asset starts at nil depreciation.
-- 3. Pay runs: only current staff, and nobody paid twice for the same month in pay runs that stand.
-- 4. Locks taken in one order everywhere (books, then the record); loan voids and repayments can't cross.
-- 5. VAT payment can't be dated in the future; a negative offset can't happen.
-- 6. An asset added by mistake can be removed (voided) while no depreciation has been posted on it.

create or replace function app.require_live_date(p_business_id uuid, p_date date, p_what text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_from date := app.books_auto_from(p_business_id);
begin
  if v_from is null then
    raise exception 'Close the imported year first: these records are kept from the first live year.' using errcode = 'P0001';
  end if;
  if p_date is not null and p_date < v_from then
    raise exception '% dated % is before the books'' first live year (%), which the imported figures cover.',
      p_what, to_char(p_date, 'DD Mon YYYY'), to_char(v_from, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function app.require_live_date(uuid, date, text) from public, anon, authenticated;

create or replace function public.record_vat_return(
  p_business_id uuid, p_from date, p_to date, p_paid_from_account_id uuid, p_paid_on date, p_reference text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  s record;
  v_offset bigint;
  v_lines jsonb;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id into v_id from public.vat_returns where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose the period.' using errcode = 'P0001';
  end if;
  if p_to >= (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Record a return once its period has ended.' using errcode = 'P0001';
  end if;
  perform app.require_live_date(p_business_id, p_from, 'A VAT return');
  if exists (select 1 from public.vat_returns where business_id = p_business_id and status = 'recorded'
             and period_from <= p_to and period_to >= p_from) then
    raise exception 'A VAT return already covers part of that period.' using errcode = 'P0001';
  end if;
  select * into s from public.vat_summary(p_business_id, p_from, p_to);
  if s.output_minor = 0 and s.input_minor = 0 then
    raise exception 'There''s no VAT in the books for that period.' using errcode = 'P0001';
  end if;
  if s.net_minor > 0 then
    perform app.require_bank_account(p_business_id, p_paid_from_account_id);
    if p_paid_on is null or p_paid_on < p_to or p_paid_on > (now() at time zone app.business_tz(p_business_id))::date then
      raise exception 'Choose when it was paid (after the period ends).' using errcode = 'P0001';
    end if;
  end if;
  v_offset := greatest(least(s.output_minor, s.input_minor), 0);
  insert into public.vat_returns (business_id, period_from, period_to, output_minor, input_minor, net_minor, paid_from_account_id, paid_on,
    reference, idempotency_key)
  values (p_business_id, p_from, p_to, s.output_minor, s.input_minor, s.net_minor,
    case when s.net_minor > 0 then p_paid_from_account_id end, case when s.net_minor > 0 then p_paid_on end,
    nullif(btrim(p_reference), ''), p_idempotency_key)
  returning id into v_id;
  v_lines := jsonb_build_array(
    app.books_line(p_business_id, 'vat_output', v_offset + greatest(s.net_minor, 0), 'VAT for the period'),
    app.books_line(p_business_id, 'vat_input', -v_offset, 'Input VAT set against output VAT'));
  if s.net_minor > 0 then
    v_lines := v_lines || jsonb_build_array(app.books_line(p_business_id, p_paid_from_account_id::text, -s.net_minor, 'VAT paid'));
  end if;
  perform app.books_auto_post(p_business_id, 'vat_return', v_id, 'post', coalesce(case when s.net_minor > 0 then p_paid_on end, p_to),
    'VAT return ' || to_char(p_from, 'DD Mon YYYY') || ' to ' || to_char(p_to, 'DD Mon YYYY'), v_lines);
  return v_id;
end;
$$;

create or replace function public.pay_tax(
  p_business_id uuid, p_tax text, p_amount_minor bigint, p_paid_from_account_id uuid, p_paid_on date, p_reference text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id into v_id from public.tax_payments where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_tax not in ('paye', 'wht', 'pension', 'cit') then raise exception 'Choose which tax.' using errcode = 'P0001'; end if;
  perform app.require_positive(p_amount_minor, 'the amount paid');
  perform app.require_bank_account(p_business_id, p_paid_from_account_id);
  if p_paid_on is null or p_paid_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose when it was paid (not in the future).' using errcode = 'P0001';
  end if;
  perform app.require_live_date(p_business_id, p_paid_on, 'A tax payment');
  insert into public.tax_payments (business_id, tax, amount_minor, paid_on, paid_from_account_id, reference, idempotency_key)
  values (p_business_id, p_tax, p_amount_minor, p_paid_on, p_paid_from_account_id, nullif(btrim(p_reference), ''), p_idempotency_key)
  returning id into v_id;
  perform app.books_auto_post(p_business_id, 'tax_payment', v_id, 'post', p_paid_on,
    case p_tax when 'paye' then 'PAYE paid' when 'wht' then 'Withholding tax paid' when 'pension' then 'Pension contributions paid'
      else 'Company income tax paid' end || coalesce(' (' || nullif(btrim(p_reference), '') || ')', ''),
    jsonb_build_array(app.books_line(p_business_id, p_tax, p_amount_minor), app.books_line(p_business_id, p_paid_from_account_id::text, -p_amount_minor)));
  return v_id;
end;
$$;

create or replace function public.post_payroll_run(
  p_business_id uuid, p_period_month date, p_pay_date date, p_paid_from_account_id uuid, p_lines jsonb, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number text;
  l jsonb;
  t record;
  v_dup text;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id into v_id from public.payroll_runs where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_period_month is null or extract(day from p_period_month) <> 1 then raise exception 'Choose the month.' using errcode = 'P0001'; end if;
  if p_pay_date is null or p_pay_date > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose the pay date (not in the future).' using errcode = 'P0001';
  end if;
  perform app.require_bank_account(p_business_id, p_paid_from_account_id);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one person.' using errcode = 'P0001';
  end if;
  perform app.require_live_date(p_business_id, p_pay_date, 'A pay run');
  v_number := app.books_next_number(p_business_id, 'payroll', 'PR', 4);
  insert into public.payroll_runs (business_id, number, period_month, pay_date, paid_from_account_id, idempotency_key)
  values (p_business_id, v_number, p_period_month, p_pay_date, p_paid_from_account_id, p_idempotency_key)
  returning id into v_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.payroll_people where id = app.uuid_or_null(l ->> 'person_id') and business_id = p_business_id and archived_at is null) then
      raise exception 'Choose people from the current staff list.' using errcode = 'P0001';
    end if;
    -- Someone already paid for this month in another pay run that stands: void that one first.
    v_dup := null;
    select r.number into v_dup from public.payroll_runs r join public.payroll_lines pl on pl.run_id = r.id
      where r.business_id = p_business_id and r.status = 'posted' and r.period_month = p_period_month and r.id <> v_id
        and pl.person_id = (l ->> 'person_id')::uuid limit 1;
    if v_dup is not null then
      raise exception '% is already paid for this month in %. Void that pay run first if this replaces it.',
        (select name from public.payroll_people where id = (l ->> 'person_id')::uuid), v_dup using errcode = 'P0001';
    end if;
    begin
      insert into public.payroll_lines (business_id, run_id, person_id, gross_minor, paye_minor, pension_employee_minor, pension_employer_minor, wht_minor)
      values (p_business_id, v_id, (l ->> 'person_id')::uuid, (l ->> 'gross')::bigint, coalesce((l ->> 'paye')::bigint, 0),
        coalesce((l ->> 'pension_employee')::bigint, 0), coalesce((l ->> 'pension_employer')::bigint, 0), coalesce((l ->> 'wht')::bigint, 0));
    exception
      when unique_violation then raise exception 'A person appears twice in this pay run.' using errcode = 'P0001';
      when check_violation or invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Check the amounts: gross pay above 0, and deductions less than gross.' using errcode = 'P0001';
    end;
  end loop;
  select coalesce(sum(pl.gross_minor) filter (where p.kind = 'employee'), 0)::bigint as gross_emp,
         coalesce(sum(pl.gross_minor) filter (where p.kind = 'contractor'), 0)::bigint as gross_con,
         coalesce(sum(pl.paye_minor), 0)::bigint as paye, coalesce(sum(pl.pension_employee_minor + pl.pension_employer_minor), 0)::bigint as pension,
         coalesce(sum(pl.pension_employer_minor), 0)::bigint as employer, coalesce(sum(pl.wht_minor), 0)::bigint as wht, coalesce(sum(pl.net_minor), 0)::bigint as net
    into t
  from public.payroll_lines pl join public.payroll_people p on p.id = pl.person_id where pl.run_id = v_id;
  perform app.books_auto_post(p_business_id, 'payroll_run', v_id, 'post', p_pay_date,
    'Pay run ' || v_number || ': ' || to_char(p_period_month, 'FMMonth YYYY'),
    jsonb_build_array(
      app.books_line(p_business_id, 'salaries', t.gross_emp), app.books_line(p_business_id, 'contract_pay', t.gross_con),
      app.books_line(p_business_id, 'pension_expense', t.employer), app.books_line(p_business_id, 'paye', -t.paye),
      app.books_line(p_business_id, 'pension', -t.pension), app.books_line(p_business_id, 'wht', -t.wht),
      app.books_line(p_business_id, p_paid_from_account_id::text, -t.net)));
  return v_id;
end;
$$;

create or replace function public.add_fixed_asset(
  p_business_id uuid, p_name text, p_asset_key text, p_cost_minor bigint, p_residual_minor bigint, p_life_years numeric,
  p_acquired_on date, p_funding_account_id uuid, p_accumulated_minor bigint, p_depreciated_through date, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number text;
  v_key text;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id into v_id from public.fixed_assets where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then raise exception 'Describe the asset.' using errcode = 'P0001'; end if;
  if p_asset_key not in ('ppe_machinery', 'ppe_furniture', 'ppe_computers', 'ppe_equipment', 'ppe_vehicles') then
    raise exception 'Choose the kind of asset.' using errcode = 'P0001';
  end if;
  perform app.require_positive(p_cost_minor, 'what it cost');
  if coalesce(p_residual_minor, 0) < 0 or coalesce(p_residual_minor, 0) >= p_cost_minor then
    raise exception 'The value at the end of its life must be less than the cost.' using errcode = 'P0001';
  end if;
  if p_life_years is null or p_life_years < 0.1 or p_life_years > 50 then raise exception 'Useful life is between 1 and 50 years.' using errcode = 'P0001'; end if;
  if p_acquired_on is null or p_acquired_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose when it was bought (not in the future).' using errcode = 'P0001';
  end if;
  if p_funding_account_id is not null then
    select system_key into v_key from public.accounts where id = p_funding_account_id and business_id = p_business_id and archived_at is null
      and type in ('asset', 'liability', 'equity');
    if not found or v_key like 'inv\_%' or v_key like 'ppe\_%' or v_key in ('receivables', 'customer_deposits', 'grni') then
      raise exception 'Choose how it was paid for (a bank account, a director''s account, trade payables, share capital…).' using errcode = 'P0001';
    end if;
  end if;
  if p_funding_account_id is not null and p_acquired_on < coalesce(app.books_auto_from(p_business_id), p_acquired_on) then
    raise exception 'It was bought before the books'' first live year, so it''s in the imported figures: tick "already in the books" and give the depreciation counted so far.' using errcode = 'P0001';
  end if;
  if p_funding_account_id is null and (p_depreciated_through is null or p_depreciated_through < p_acquired_on - 1
       or p_depreciated_through > (now() at time zone app.business_tz(p_business_id))::date) then
    raise exception 'Say up to what date depreciation is already counted (between the purchase date and today).' using errcode = 'P0001';
  end if;
  if p_funding_account_id is not null and coalesce(p_accumulated_minor, 0) <> 0 then
    raise exception 'A newly bought asset has no depreciation yet.' using errcode = 'P0001';
  end if;
  if coalesce(p_accumulated_minor, 0) < 0 or coalesce(p_accumulated_minor, 0) > p_cost_minor - coalesce(p_residual_minor, 0) then
    raise exception 'Depreciation so far can''t be more than the cost less the end-of-life value.' using errcode = 'P0001';
  end if;
  v_number := app.books_next_number(p_business_id, 'asset', 'FA', 3);
  insert into public.fixed_assets (business_id, number, name, asset_key, cost_minor, residual_minor, life_years, acquired_on, funding_account_id,
    accumulated_minor, depreciated_through, idempotency_key)
  values (p_business_id, v_number, btrim(p_name), p_asset_key, p_cost_minor, coalesce(p_residual_minor, 0), p_life_years, p_acquired_on,
    p_funding_account_id, coalesce(p_accumulated_minor, 0),
    coalesce(case when p_funding_account_id is null then p_depreciated_through end, p_acquired_on - 1), p_idempotency_key)
  returning id into v_id;
  if p_funding_account_id is not null then
    perform app.books_auto_post(p_business_id, 'fixed_asset', v_id, 'acquire', p_acquired_on, 'Fixed asset bought: ' || v_number || ' ' || btrim(p_name),
      jsonb_build_array(app.books_line(p_business_id, p_asset_key, p_cost_minor), app.books_line(p_business_id, p_funding_account_id::text, -p_cost_minor)));
  end if;
  return v_id;
end;
$$;

create or replace function public.run_depreciation(p_business_id uuid, p_through date, p_idempotency_key uuid)
returns table (run_id uuid, total_minor bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_total bigint := 0;
  v_lines jsonb := '[]'::jsonb;
  a public.fixed_assets;
  v_amt bigint;
  r record;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id, d.total_minor into v_id, v_total from public.depreciation_runs d where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return query select v_id, v_total; return; end if;
  v_total := 0; -- the lookup above leaves it empty when nothing matched
  if p_through is null or p_through > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose a date up to today.' using errcode = 'P0001';
  end if;
  perform app.require_live_date(p_business_id, p_through, 'A depreciation run');
  insert into public.depreciation_runs (business_id, through_date, total_minor, idempotency_key) values (p_business_id, p_through, 0, p_idempotency_key)
  returning id into v_id;
  for a in select * from public.fixed_assets where business_id = p_business_id and status = 'active' and depreciated_through < p_through for update loop
    v_amt := app.asset_depreciation(a, a.depreciated_through + 1, p_through);
    if v_amt > 0 then
      insert into public.depreciation_lines (run_id, business_id, asset_id, from_date, to_date, amount_minor)
      values (v_id, p_business_id, a.id, a.depreciated_through + 1, p_through, v_amt);
      v_total := v_total + v_amt;
    end if;
    update public.fixed_assets set depreciated_through = p_through, accumulated_minor = accumulated_minor + v_amt where id = a.id;
  end loop;
  if v_total = 0 then
    update public.depreciation_runs set total_minor = 0 where id = v_id;
    return query select v_id, 0::bigint;
    return;
  end if;
  for r in select f.asset_key, sum(dl.amount_minor) as amt from public.depreciation_lines dl join public.fixed_assets f on f.id = dl.asset_id
           where dl.run_id = v_id group by f.asset_key loop
    v_lines := v_lines || jsonb_build_array(app.books_line(p_business_id, r.asset_key || '_dep', -r.amt::bigint));
  end loop;
  v_lines := v_lines || jsonb_build_array(app.books_line(p_business_id, 'depreciation', v_total));
  update public.depreciation_runs set total_minor = v_total where id = v_id;
  perform app.books_auto_post(p_business_id, 'depreciation_run', v_id, 'post', p_through,
    'Depreciation to ' || to_char(p_through, 'DD Mon YYYY'), v_lines);
  return query select v_id, v_total;
end;
$$;

create or replace function public.dispose_fixed_asset(p_asset_id uuid, p_disposed_on date, p_proceeds_minor bigint, p_proceeds_account_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.fixed_assets;
  v_catch bigint;
  v_acc bigint;
  v_gain bigint;
  v_proceeds bigint := coalesce(p_proceeds_minor, 0);
begin
  -- Owner check, then the books lock, then the asset (the same order as the depreciation run).
  select * into a from public.fixed_assets where id = p_asset_id;
  if not found or not app.is_owner(a.business_id) then raise exception 'Only owners manage fixed assets.' using errcode = '42501'; end if;
  perform app.require_owner_books(a.business_id);
  perform app.books_lock(a.business_id);
  select * into a from public.fixed_assets where id = p_asset_id for update;
  perform app.require_live_date(a.business_id, p_disposed_on, 'A disposal');
  if a.status <> 'active' then raise exception 'This asset is no longer in use.' using errcode = 'P0001'; end if;
  if p_disposed_on is null or p_disposed_on < a.acquired_on or p_disposed_on > (now() at time zone app.business_tz(a.business_id))::date then
    raise exception 'Choose the date it was sold or scrapped (between purchase and today).' using errcode = 'P0001';
  end if;
  if p_disposed_on < a.depreciated_through then
    raise exception 'Depreciation has already been run past that date. Choose a later date.' using errcode = 'P0001';
  end if;
  if v_proceeds < 0 then raise exception 'Proceeds can''t be negative.' using errcode = 'P0001'; end if;
  if v_proceeds > 0 then perform app.require_bank_account(a.business_id, p_proceeds_account_id); end if;
  v_catch := app.asset_depreciation(a, a.depreciated_through + 1, p_disposed_on);
  v_acc := a.accumulated_minor + v_catch;
  v_gain := v_proceeds - (a.cost_minor - v_acc);
  update public.fixed_assets set status = 'disposed', disposed_on = p_disposed_on, proceeds_minor = v_proceeds,
    proceeds_account_id = case when v_proceeds > 0 then p_proceeds_account_id end, accumulated_minor = v_acc, depreciated_through = p_disposed_on
  where id = a.id;
  perform app.books_auto_post(a.business_id, 'fixed_asset', a.id, 'dispose', p_disposed_on,
    'Fixed asset ' || case when v_proceeds > 0 then 'sold: ' else 'scrapped: ' end || a.number || ' ' || a.name || coalesce(' (' || nullif(btrim(p_reason), '') || ')', ''),
    jsonb_build_array(
      app.books_line(a.business_id, 'depreciation', v_catch, 'Depreciation to the date it left'),
      app.books_line(a.business_id, a.asset_key || '_dep', v_acc - v_catch, 'Accumulated depreciation cleared'),
      app.books_line(a.business_id, a.asset_key, -a.cost_minor, 'Cost cleared'),
      app.books_line(a.business_id, coalesce(p_proceeds_account_id::text, 'cash'), v_proceeds, 'Proceeds'),
      app.books_line(a.business_id, 'other_income', -v_gain, case when v_gain >= 0 then 'Gain on disposal' else 'Loss on disposal' end)));
end;
$$;

create or replace function public.add_loan(
  p_business_id uuid, p_lender text, p_term text, p_principal_minor bigint, p_received_on date, p_received_into_account_id uuid,
  p_interest_note text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number text;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id into v_id from public.loans where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_lender is null or char_length(btrim(p_lender)) = 0 then raise exception 'Say who lent it.' using errcode = 'P0001'; end if;
  if p_term not in ('short', 'long') then raise exception 'Choose whether it''s repaid within a year.' using errcode = 'P0001'; end if;
  perform app.require_positive(p_principal_minor, 'the amount borrowed');
  if p_received_on is null or p_received_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose when it was received (not in the future).' using errcode = 'P0001';
  end if;
  if p_received_on >= coalesce(app.books_auto_from(p_business_id), p_received_on) then
    perform app.require_bank_account(p_business_id, p_received_into_account_id);
  elsif p_received_into_account_id is not null then
    raise exception 'It was received before the books'' first live year, so it''s in the imported figures: leave "Received into" blank.' using errcode = 'P0001';
  end if;
  v_number := app.books_next_number(p_business_id, 'loan', 'LN', 3);
  insert into public.loans (business_id, number, lender, term, principal_minor, received_on, received_into_account_id, interest_note, idempotency_key)
  values (p_business_id, v_number, btrim(p_lender), p_term, p_principal_minor, p_received_on, p_received_into_account_id,
    nullif(btrim(p_interest_note), ''), p_idempotency_key)
  returning id into v_id;
  if p_received_into_account_id is not null then
    perform app.books_auto_post(p_business_id, 'loan', v_id, 'post', p_received_on, 'Loan received: ' || v_number || ' from ' || btrim(p_lender),
      jsonb_build_array(app.books_line(p_business_id, p_received_into_account_id::text, p_principal_minor),
        app.books_line(p_business_id, case p_term when 'short' then 'loans_short' else 'loans_long' end, -p_principal_minor)));
  end if;
  return v_id;
end;
$$;

create or replace function public.record_loan_repayment(
  p_loan_id uuid, p_paid_on date, p_principal_minor bigint, p_interest_minor bigint, p_paid_from_account_id uuid, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ln public.loans;
  v_id uuid;
  v_out bigint;
begin
  select * into ln from public.loans where id = p_loan_id;
  if not found or not app.is_owner(ln.business_id) then raise exception 'Only owners record loan repayments.' using errcode = '42501'; end if;
  perform app.require_owner_books(ln.business_id);
  perform app.books_lock(ln.business_id);
  select id into v_id from public.loan_repayments where business_id = ln.business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  select * into ln from public.loans where id = p_loan_id for update; -- read again under the lock
  if ln.status <> 'open' then raise exception 'This loan is voided.' using errcode = 'P0001'; end if;
  perform app.require_live_date(ln.business_id, p_paid_on, 'A repayment');
  if coalesce(p_principal_minor, 0) < 0 or coalesce(p_interest_minor, 0) < 0 or coalesce(p_principal_minor, 0) + coalesce(p_interest_minor, 0) = 0 then
    raise exception 'Enter the amount repaid and any interest.' using errcode = 'P0001';
  end if;
  select ln.principal_minor - coalesce(sum(principal_minor), 0) into v_out from public.loan_repayments where loan_id = ln.id and status = 'recorded';
  if coalesce(p_principal_minor, 0) > v_out then
    raise exception 'That''s more than the % still owed.', to_char(v_out / 100.0, 'FM₦999,999,999,990.00') using errcode = 'P0001';
  end if;
  perform app.require_bank_account(ln.business_id, p_paid_from_account_id);
  if p_paid_on is null or p_paid_on < ln.received_on or p_paid_on > (now() at time zone app.business_tz(ln.business_id))::date then
    raise exception 'Choose the date it was repaid.' using errcode = 'P0001';
  end if;
  insert into public.loan_repayments (business_id, loan_id, paid_on, principal_minor, interest_minor, paid_from_account_id, idempotency_key)
  values (ln.business_id, ln.id, p_paid_on, coalesce(p_principal_minor, 0), coalesce(p_interest_minor, 0), p_paid_from_account_id, p_idempotency_key)
  returning id into v_id;
  perform app.books_auto_post(ln.business_id, 'loan_repayment', v_id, 'post', p_paid_on, 'Loan repayment: ' || ln.number || ' to ' || ln.lender,
    jsonb_build_array(app.books_line(ln.business_id, case ln.term when 'short' then 'loans_short' else 'loans_long' end, coalesce(p_principal_minor, 0)),
      app.books_line(ln.business_id, 'interest', coalesce(p_interest_minor, 0)),
      app.books_line(ln.business_id, p_paid_from_account_id::text, -(coalesce(p_principal_minor, 0) + coalesce(p_interest_minor, 0)))));
  return v_id;
end;
$$;

create or replace function public.record_equity_movement(
  p_business_id uuid, p_kind text, p_director_key text, p_amount_minor bigint, p_moved_on date, p_bank_account_id uuid, p_note text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_other text;
  v_sign integer;
begin
  perform app.require_owner_books(p_business_id);
  perform app.books_lock(p_business_id);
  select id into v_id from public.equity_movements where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_kind not in ('director_in', 'director_out', 'share_capital') then raise exception 'Choose what kind of money it is.' using errcode = 'P0001'; end if;
  if p_kind <> 'share_capital' and coalesce(p_director_key, '') not in ('director_1', 'director_2') then
    raise exception 'Choose the director.' using errcode = 'P0001';
  end if;
  perform app.require_positive(p_amount_minor, 'the amount');
  perform app.require_bank_account(p_business_id, p_bank_account_id);
  if p_moved_on is null or p_moved_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose the date (not in the future).' using errcode = 'P0001';
  end if;
  perform app.require_live_date(p_business_id, p_moved_on, 'This');
  insert into public.equity_movements (business_id, kind, director_key, amount_minor, moved_on, bank_account_id, note, idempotency_key)
  values (p_business_id, p_kind, case when p_kind <> 'share_capital' then p_director_key end, p_amount_minor, p_moved_on, p_bank_account_id,
    nullif(btrim(p_note), ''), p_idempotency_key)
  returning id into v_id;
  v_other := case when p_kind = 'share_capital' then 'share_capital' else p_director_key end;
  v_sign := case when p_kind = 'director_out' then -1 else 1 end;
  perform app.books_auto_post(p_business_id, 'equity_movement', v_id, 'post', p_moved_on,
    case p_kind when 'director_in' then 'Money put in by a director' when 'director_out' then 'Money taken out by a director'
      else 'Share capital paid in' end || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    jsonb_build_array(app.books_line(p_business_id, p_bank_account_id::text, v_sign * p_amount_minor),
      app.books_line(p_business_id, v_other, -v_sign * p_amount_minor)));
  return v_id;
end;
$$;

create or replace function public.void_books_record(p_kind text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  v_today date;
begin
  if p_reason is null or char_length(btrim(p_reason)) = 0 then raise exception 'Say why it''s voided.' using errcode = 'P0001'; end if;
  -- Owner check and the books lock first (the order every posting uses), then the record itself.
  v_business := case p_kind
    when 'vat_return' then (select business_id from public.vat_returns where id = p_id)
    when 'tax_payment' then (select business_id from public.tax_payments where id = p_id)
    when 'payroll_run' then (select business_id from public.payroll_runs where id = p_id)
    when 'loan' then (select business_id from public.loans where id = p_id)
    when 'loan_repayment' then (select business_id from public.loan_repayments where id = p_id)
    when 'equity_movement' then (select business_id from public.equity_movements where id = p_id)
    when 'fixed_asset' then (select business_id from public.fixed_assets where id = p_id) end;
  if v_business is null then raise exception 'That record is already voided or no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_books(v_business);
  perform app.books_lock(v_business);
  v_business := null;
  case p_kind
    when 'vat_return' then select business_id into v_business from public.vat_returns where id = p_id and status = 'recorded' for update;
    when 'tax_payment' then select business_id into v_business from public.tax_payments where id = p_id and status = 'recorded' for update;
    when 'payroll_run' then select business_id into v_business from public.payroll_runs where id = p_id and status = 'posted' for update;
    when 'loan' then select business_id into v_business from public.loans where id = p_id and status = 'open' for update;
    when 'loan_repayment' then select business_id into v_business from public.loan_repayments where id = p_id and status = 'recorded' for update;
    when 'equity_movement' then select business_id into v_business from public.equity_movements where id = p_id and status = 'recorded' for update;
    -- An asset added by mistake: removable while no depreciation has been posted on it.
    when 'fixed_asset' then select business_id into v_business from public.fixed_assets where id = p_id and status = 'active' for update;
    else raise exception 'That can''t be voided here.' using errcode = 'P0001';
  end case;
  if v_business is null then raise exception 'That record is already voided or no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_books(v_business);
  if p_kind = 'fixed_asset' and exists (select 1 from public.depreciation_lines where asset_id = p_id) then
    raise exception 'Depreciation has been posted on this asset. Record it as sold or scrapped instead.' using errcode = 'P0001';
  end if;
  if p_kind = 'loan' and exists (select 1 from public.loan_repayments where loan_id = p_id and status = 'recorded') then
    raise exception 'Void its repayments first.' using errcode = 'P0001';
  end if;
  v_today := (now() at time zone app.business_tz(v_business))::date;
  perform app.books_auto_reverse(v_business, p_kind, p_id, case when p_kind = 'fixed_asset' then 'acquire' else 'post' end, v_today,
    left(replace(p_kind, '_', ' ') || ' voided: ' || btrim(p_reason), 200));
  case p_kind
    when 'vat_return' then update public.vat_returns set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'tax_payment' then update public.tax_payments set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'payroll_run' then update public.payroll_runs set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'loan' then update public.loans set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'loan_repayment' then update public.loan_repayments set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'equity_movement' then update public.equity_movements set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'fixed_asset' then update public.fixed_assets set status = 'removed' where id = p_id;
  end case;
end;
$$;
