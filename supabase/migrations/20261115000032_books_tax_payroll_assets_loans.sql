-- Books Phase D: VAT summary and returns, tax payments, payroll, fixed asset register and depreciation,
-- loans, director money and share capital (docs/ACCOUNTING.md). Owners only. Each record posts its own
-- journal (from the first live year, like Phase B) and is voided by a reversal, never deleted.

--------------------------------------------------------------------------------
-- Shared helpers
--------------------------------------------------------------------------------
-- A bank, cash or POS account registered under Bank and cash.
create or replace function app.is_bank_account(p_business_id uuid, p_account uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bank_accounts b join public.accounts a on a.id = b.account_id
                 where b.business_id = p_business_id and b.account_id = p_account and b.archived_at is null and a.archived_at is null)
$$;

create or replace function app.require_bank_account(p_business_id uuid, p_account uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account is null or not app.is_bank_account(p_business_id, p_account) then
    raise exception 'Choose a bank, cash or POS account (set them up under Books → Bank and cash).' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function app.require_positive(p_amount bigint, p_what text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then
    raise exception 'Enter %.', p_what using errcode = 'P0001';
  end if;
end;
$$;

-- Number generator per business and kind (PR-0001, FA-001, LN-001…), serialised by the settings row lock.
alter table public.books_settings add column next_numbers jsonb not null default '{}'::jsonb;
create or replace function app.books_next_number(p_business_id uuid, p_kind text, p_prefix text, p_width integer)
returns text language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.books_settings set next_numbers = jsonb_set(next_numbers, array[p_kind], to_jsonb(coalesce((next_numbers ->> p_kind)::integer, 0) + 1))
  where business_id = p_business_id
  returning (next_numbers ->> p_kind)::integer into v_n;
  return p_prefix || '-' || lpad(v_n::text, p_width, '0');
end;
$$;

--------------------------------------------------------------------------------
-- VAT and other taxes
--------------------------------------------------------------------------------
create table public.vat_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  period_from date not null,
  period_to date not null,
  output_minor bigint not null,
  input_minor bigint not null,
  net_minor bigint not null,
  paid_from_account_id uuid,
  paid_on date,
  reference text check (char_length(reference) <= 120),
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, idempotency_key),
  unique (business_id, id),
  foreign key (business_id, paid_from_account_id) references public.accounts (business_id, id),
  check (period_to >= period_from)
);

create table public.tax_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  tax text not null check (tax in ('paye', 'wht', 'pension', 'cit')),
  amount_minor bigint not null check (amount_minor > 0),
  paid_on date not null,
  paid_from_account_id uuid not null,
  reference text check (char_length(reference) <= 120),
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, idempotency_key),
  unique (business_id, id),
  foreign key (business_id, paid_from_account_id) references public.accounts (business_id, id)
);

-- VAT in a period from the books: output VAT on sales and repairs, input VAT on expenses and bank lines.
-- Earlier VAT returns (settlement journals) are left out.
create or replace function public.vat_summary(p_business_id uuid, p_from date, p_to date)
returns table (output_minor bigint, input_minor bigint, net_minor bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then raise exception 'Only owners can see the books.' using errcode = '42501'; end if;
  return query
  with v as (
    select a.system_key as k, sum(l.debit_minor - l.credit_minor) as bal
    from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
    where l.business_id = p_business_id and a.system_key in ('vat_output', 'vat_input')
      and j.effective_date between p_from and p_to and coalesce(j.source_type, '') <> 'vat_return'
      and not app.is_year_closing(j.source_type)
    group by a.system_key
  )
  select coalesce(-(select bal from v where k = 'vat_output'), 0)::bigint, coalesce((select bal from v where k = 'vat_input'), 0)::bigint,
    (coalesce(-(select bal from v where k = 'vat_output'), 0) - coalesce((select bal from v where k = 'vat_input'), 0))::bigint;
end;
$$;

-- The journals behind the VAT figures.
create or replace function public.vat_documents(p_business_id uuid, p_from date, p_to date)
returns table (journal_id uuid, number text, effective_date date, narration text, output_minor bigint, input_minor bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then raise exception 'Only owners can see the books.' using errcode = '42501'; end if;
  return query
  select j.id, j.number, j.effective_date, j.narration,
    coalesce(sum(l.credit_minor - l.debit_minor) filter (where a.system_key = 'vat_output'), 0)::bigint,
    coalesce(sum(l.debit_minor - l.credit_minor) filter (where a.system_key = 'vat_input'), 0)::bigint
  from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
  where l.business_id = p_business_id and a.system_key in ('vat_output', 'vat_input')
    and j.effective_date between p_from and p_to and coalesce(j.source_type, '') <> 'vat_return'
  group by j.id, j.number, j.effective_date, j.narration
  order by j.effective_date, j.number;
end;
$$;

-- Records a VAT return for a period: output VAT is set against input VAT and the net paid from a bank
-- account. When input exceeds output, the difference carries forward (nothing is paid).
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
    if p_paid_on is null or p_paid_on < p_to then
      raise exception 'Choose when it was paid (after the period ends).' using errcode = 'P0001';
    end if;
  end if;
  v_offset := least(s.output_minor, s.input_minor);
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
  select id into v_id from public.tax_payments where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_tax not in ('paye', 'wht', 'pension', 'cit') then raise exception 'Choose which tax.' using errcode = 'P0001'; end if;
  perform app.require_positive(p_amount_minor, 'the amount paid');
  perform app.require_bank_account(p_business_id, p_paid_from_account_id);
  if p_paid_on is null or p_paid_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose when it was paid (not in the future).' using errcode = 'P0001';
  end if;
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

--------------------------------------------------------------------------------
-- Payroll (amounts and deductions entered by the owner; no tax tables)
--------------------------------------------------------------------------------
create table public.payroll_people (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('employee', 'contractor')),
  role_title text check (char_length(role_title) <= 80),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  number text not null,
  period_month date not null check (extract(day from period_month) = 1),
  pay_date date not null,
  paid_from_account_id uuid not null,
  status text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, paid_from_account_id) references public.accounts (business_id, id)
);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  run_id uuid not null,
  person_id uuid not null,
  gross_minor bigint not null check (gross_minor > 0),
  paye_minor bigint not null default 0 check (paye_minor >= 0),
  pension_employee_minor bigint not null default 0 check (pension_employee_minor >= 0),
  pension_employer_minor bigint not null default 0 check (pension_employer_minor >= 0),
  wht_minor bigint not null default 0 check (wht_minor >= 0),
  net_minor bigint generated always as (gross_minor - paye_minor - pension_employee_minor - wht_minor) stored,
  unique (run_id, person_id),
  foreign key (business_id, run_id) references public.payroll_runs (business_id, id),
  foreign key (business_id, person_id) references public.payroll_people (business_id, id),
  check (paye_minor + pension_employee_minor + wht_minor < gross_minor)
);

create or replace function public.save_payroll_person(p_business_id uuid, p_id uuid, p_name text, p_kind text, p_role_title text, p_archived boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id;
begin
  perform app.require_owner_books(p_business_id);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'Enter the name.' using errcode = 'P0001'; end if;
  if p_kind not in ('employee', 'contractor') then raise exception 'Choose employee or contractor.' using errcode = 'P0001'; end if;
  if v_id is null then
    insert into public.payroll_people (business_id, name, kind, role_title) values (p_business_id, btrim(p_name), p_kind, nullif(btrim(p_role_title), ''))
    returning id into v_id;
  else
    update public.payroll_people set name = btrim(p_name), kind = p_kind, role_title = nullif(btrim(p_role_title), ''),
      archived_at = case when coalesce(p_archived, false) then coalesce(archived_at, now()) end
    where id = v_id and business_id = p_business_id;
    if not found then raise exception 'That person no longer exists.' using errcode = 'P0001'; end if;
  end if;
  return v_id;
end;
$$;

-- A month's pay: lines [{person_id, gross, paye, pension_employee, pension_employer, wht}] in kobo.
-- Posts salaries and contract pay, employer pension, the deductions owed, and net pay from the bank.
create or replace function public.post_payroll_run(
  p_business_id uuid, p_period_month date, p_pay_date date, p_paid_from_account_id uuid, p_lines jsonb, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number text;
  l jsonb;
  t record;
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
  v_number := app.books_next_number(p_business_id, 'payroll', 'PR', 4);
  insert into public.payroll_runs (business_id, number, period_month, pay_date, paid_from_account_id, idempotency_key)
  values (p_business_id, v_number, p_period_month, p_pay_date, p_paid_from_account_id, p_idempotency_key)
  returning id into v_id;
  for l in select value from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.payroll_people where id = app.uuid_or_null(l ->> 'person_id') and business_id = p_business_id) then
      raise exception 'Choose people from the staff list.' using errcode = 'P0001';
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

--------------------------------------------------------------------------------
-- Fixed asset register and depreciation (straight line by days)
--------------------------------------------------------------------------------
create table public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  number text not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  asset_key text not null check (asset_key in ('ppe_machinery', 'ppe_furniture', 'ppe_computers', 'ppe_equipment', 'ppe_vehicles')),
  cost_minor bigint not null check (cost_minor > 0),
  residual_minor bigint not null default 0 check (residual_minor >= 0),
  life_years numeric(5, 2) not null check (life_years > 0 and life_years <= 50),
  acquired_on date not null,
  -- How it was paid for; null when it's already in the books (e.g. in the imported figures).
  funding_account_id uuid,
  accumulated_minor bigint not null default 0 check (accumulated_minor >= 0),
  depreciated_through date not null,
  status text not null default 'active' check (status in ('active', 'disposed', 'removed')),
  disposed_on date,
  proceeds_minor bigint check (proceeds_minor >= 0),
  proceeds_account_id uuid,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, funding_account_id) references public.accounts (business_id, id),
  foreign key (business_id, proceeds_account_id) references public.accounts (business_id, id),
  check (residual_minor < cost_minor),
  check (accumulated_minor <= cost_minor - residual_minor)
);

create table public.depreciation_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  through_date date not null,
  total_minor bigint not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, idempotency_key)
);

create table public.depreciation_lines (
  run_id uuid not null,
  business_id uuid not null,
  asset_id uuid not null,
  from_date date not null,
  to_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  primary key (run_id, asset_id),
  foreign key (business_id, run_id) references public.depreciation_runs (business_id, id),
  foreign key (business_id, asset_id) references public.fixed_assets (business_id, id)
);

-- Depreciation due on an asset for a date range (whole days), never past cost less residual.
create or replace function app.asset_depreciation(a public.fixed_assets, p_from date, p_to date)
returns bigint language sql immutable set search_path = '' as $$
  select case when p_to < p_from or a.cost_minor - a.residual_minor - a.accumulated_minor <= 0 then 0
    else least(round((a.cost_minor - a.residual_minor)::numeric * (p_to - p_from + 1) / (a.life_years * 365))::bigint,
               a.cost_minor - a.residual_minor - a.accumulated_minor) end
$$;

-- Registers an asset. With a funding account it posts the purchase (Dr asset · Cr how it was paid); without,
-- it's already in the books and only joins the register (with depreciation to date already counted).
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
  if p_life_years is null or p_life_years <= 0 or p_life_years > 50 then raise exception 'Useful life is between 1 and 50 years.' using errcode = 'P0001'; end if;
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

-- Depreciation for every active asset up to a date, in one journal (Dr Depreciation · Cr each accumulated depreciation).
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
  if p_through is null or p_through > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose a date up to today.' using errcode = 'P0001';
  end if;
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

-- Sells or scraps an asset: depreciation up to the date, then cost and accumulated depreciation out,
-- proceeds in, and the gain or loss to other income.
create or replace function public.dispose_fixed_asset(p_asset_id uuid, p_disposed_on date, p_proceeds_minor bigint, p_proceeds_account_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.fixed_assets;
  v_catch bigint;
  v_acc bigint;
  v_gain bigint;
  v_proceeds bigint := coalesce(p_proceeds_minor, 0);
begin
  select * into a from public.fixed_assets where id = p_asset_id for update;
  if not found or not app.is_owner(a.business_id) then raise exception 'Only owners manage fixed assets.' using errcode = '42501'; end if;
  perform app.require_owner_books(a.business_id);
  perform app.books_lock(a.business_id);
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

--------------------------------------------------------------------------------
-- Loans, director money and share capital
--------------------------------------------------------------------------------
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  number text not null,
  lender text not null check (char_length(btrim(lender)) between 1 and 160),
  term text not null check (term in ('short', 'long')),
  principal_minor bigint not null check (principal_minor > 0),
  received_on date not null,
  received_into_account_id uuid,
  interest_note text check (char_length(interest_note) <= 300),
  status text not null default 'open' check (status in ('open', 'voided')),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, received_into_account_id) references public.accounts (business_id, id)
);

create table public.loan_repayments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  loan_id uuid not null,
  paid_on date not null,
  principal_minor bigint not null default 0 check (principal_minor >= 0),
  interest_minor bigint not null default 0 check (interest_minor >= 0),
  paid_from_account_id uuid not null,
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, loan_id) references public.loans (business_id, id),
  foreign key (business_id, paid_from_account_id) references public.accounts (business_id, id),
  check (principal_minor + interest_minor > 0)
);

create table public.equity_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  kind text not null check (kind in ('director_in', 'director_out', 'share_capital')),
  director_key text check (director_key in ('director_1', 'director_2')),
  amount_minor bigint not null check (amount_minor > 0),
  moved_on date not null,
  bank_account_id uuid not null,
  note text check (char_length(note) <= 300),
  status text not null default 'recorded' check (status in ('recorded', 'voided')),
  void_reason text check (char_length(void_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, bank_account_id) references public.accounts (business_id, id),
  check ((kind = 'share_capital') = (director_key is null))
);

-- A loan received. One received before the books' first live year is already in the imported figures:
-- it joins the register without posting.
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
  if ln.status <> 'open' then raise exception 'This loan is voided.' using errcode = 'P0001'; end if;
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

-- Money a director puts in or takes out (their current account), or share capital paid in.
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

--------------------------------------------------------------------------------
-- Voids (a reversal journal; the record stays, marked voided)
--------------------------------------------------------------------------------
create or replace function public.void_books_record(p_kind text, p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  v_today date;
begin
  if p_reason is null or char_length(btrim(p_reason)) = 0 then raise exception 'Say why it''s voided.' using errcode = 'P0001'; end if;
  case p_kind
    when 'vat_return' then select business_id into v_business from public.vat_returns where id = p_id and status = 'recorded' for update;
    when 'tax_payment' then select business_id into v_business from public.tax_payments where id = p_id and status = 'recorded' for update;
    when 'payroll_run' then select business_id into v_business from public.payroll_runs where id = p_id and status = 'posted' for update;
    when 'loan' then select business_id into v_business from public.loans where id = p_id and status = 'open' for update;
    when 'loan_repayment' then select business_id into v_business from public.loan_repayments where id = p_id and status = 'recorded' for update;
    when 'equity_movement' then select business_id into v_business from public.equity_movements where id = p_id and status = 'recorded' for update;
    else raise exception 'That can''t be voided here.' using errcode = 'P0001';
  end case;
  if v_business is null then raise exception 'That record is already voided or no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_books(v_business);
  if p_kind = 'loan' and exists (select 1 from public.loan_repayments where loan_id = p_id and status = 'recorded') then
    raise exception 'Void its repayments first.' using errcode = 'P0001';
  end if;
  v_today := (now() at time zone app.business_tz(v_business))::date;
  perform app.books_auto_reverse(v_business, p_kind, p_id, 'post', v_today, left(p_kind || ' voided: ' || btrim(p_reason), 200));
  case p_kind
    when 'vat_return' then update public.vat_returns set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'tax_payment' then update public.tax_payments set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'payroll_run' then update public.payroll_runs set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'loan' then update public.loans set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'loan_repayment' then update public.loan_repayments set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
    when 'equity_movement' then update public.equity_movements set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = p_id;
  end case;
end;
$$;

--------------------------------------------------------------------------------
-- Access
--------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vat_returns', 'tax_payments', 'payroll_people', 'payroll_runs', 'payroll_lines', 'fixed_assets',
    'depreciation_runs', 'depreciation_lines', 'loans', 'loan_repayments', 'equity_movements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "owners read %s" on public.%I for select to authenticated using (app.is_owner(business_id))', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['is_bank_account(uuid, uuid)', 'require_bank_account(uuid, uuid)', 'require_positive(bigint, text)',
    'books_next_number(uuid, text, text, integer)', 'asset_depreciation(public.fixed_assets, date, date)'] loop
    execute format('revoke all on function app.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['vat_summary', 'vat_documents', 'record_vat_return', 'pay_tax', 'save_payroll_person', 'post_payroll_run',
    'add_fixed_asset', 'run_depreciation', 'dispose_fixed_asset', 'add_loan', 'record_loan_repayment', 'record_equity_movement',
    'void_books_record'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

--------------------------------------------------------------------------------
-- Dispatches and returns are taken in document order (DN-…, RT-… numbers), not creation time, when sharing the
-- order discount and earning the delivery fee: two documents saved in the same moment can't swap places.
--------------------------------------------------------------------------------
create or replace function app.books_post_dispatch(p_dispatch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dsp public.order_dispatches;
  o public.orders;
  v_no text;
  v_rate numeric;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_net_sum bigint := 0;
  v_net bigint;
  v_before numeric;
  v_this numeric;
  r record;
begin
  select * into dsp from public.order_dispatches where id = p_dispatch;
  if not found then return; end if;
  perform app.books_lock(dsp.business_id);
  select * into o from public.orders where id = dsp.order_id;
  select order_number into v_no from public.orders where id = o.id;
  v_rate := coalesce(app.books_vat_rate(dsp.business_id, dsp.dispatched_on), 0);
  select coalesce(sum(i.unit_price_minor * dl.quantity), 0) into v_before
  from public.order_dispatch_lines dl join public.order_dispatches e on e.id = dl.dispatch_id join public.order_items i on i.id = dl.order_item_id
  where e.order_id = o.id and (e.number, e.id) < (dsp.number, dsp.id);
  select coalesce(sum(i.unit_price_minor * dl.quantity), 0) into v_this
  from public.order_dispatch_lines dl join public.order_items i on i.id = dl.order_item_id where dl.dispatch_id = dsp.id;
  for r in
    select x.acct, sum(x.amount)::bigint as amount from (
      select case p.category when 'clothing' then 'sales_clothing' when 'shoes' then 'sales_shoes' when 'bags' then 'sales_bags' else 'sales_other' end as acct,
             -(i.unit_price_minor * dl.quantity) as amount
      from public.order_dispatch_lines dl
      join public.order_items i on i.id = dl.order_item_id
      left join public.products p on p.id = i.product_id
      where dl.dispatch_id = dsp.id
      union all
      select 'discounts', app.books_order_discount(o.id, v_before + v_this) - app.books_order_discount(o.id, v_before)
      union all
      select 'delivery_income', -o.delivery_fee_minor
      where not exists (select 1 from public.order_dispatches e where e.order_id = o.id and (e.number, e.id) < (dsp.number, dsp.id))
    ) x group by x.acct
  loop
    if r.amount <> 0 then
      v_net := app.books_net_of_vat(r.amount, v_rate);
      v_lines := v_lines || jsonb_build_array(app.books_line(dsp.business_id, r.acct, v_net));
      v_total := v_total + r.amount;
      v_net_sum := v_net_sum + v_net;
    end if;
  end loop;
  if v_total = 0 then return; end if;
  v_lines := v_lines || jsonb_build_array(app.books_line(dsp.business_id, 'vat_output', v_total - v_net_sum))
    || app.books_position_lines(dsp.business_id, app.books_customer_position(dsp.business_id, 'order', o.id), v_total);
  perform app.books_auto_post(dsp.business_id, 'order_dispatch', dsp.id, 'revenue', dsp.dispatched_on,
    'Sales: ' || coalesce(v_no, 'order') || ' dispatched (' || dsp.number || ')', v_lines, 'order', o.id);
end;
$$;

create or replace function app.books_post_return(p_return uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rt public.order_returns;
  v_no text;
  v_rate numeric;
  v_before numeric;
  v_this numeric;
  v_gross bigint;
  v_net bigint;
  v_sale_date date;
begin
  select * into rt from public.order_returns where id = p_return;
  if not found or rt.received_on is null then return; end if;
  perform app.books_lock(rt.business_id);
  select order_number into v_no from public.orders where id = rt.order_id;
  select coalesce(sum(i.unit_price_minor * rl.quantity), 0) into v_before
  from public.order_return_lines rl join public.order_returns e on e.id = rl.return_id join public.order_items i on i.id = rl.order_item_id
  where e.order_id = rt.order_id and e.received_on is not null and (coalesce(e.number, ''), e.id) < (coalesce(rt.number, ''), rt.id);
  select coalesce(sum(i.unit_price_minor * rl.quantity), 0) into v_this
  from public.order_return_lines rl join public.order_items i on i.id = rl.order_item_id where rl.return_id = rt.id;
  v_gross := (v_this - (app.books_order_discount(rt.order_id, v_before + v_this) - app.books_order_discount(rt.order_id, v_before)))::bigint;
  if v_gross = 0 then return; end if;
  select max(dispatched_on) into v_sale_date from public.order_dispatches where order_id = rt.order_id and dispatched_on <= rt.received_on;
  v_rate := coalesce(app.books_vat_rate(rt.business_id, coalesce(v_sale_date, rt.received_on)), 0);
  v_net := app.books_net_of_vat(v_gross, v_rate);
  perform app.books_auto_post(rt.business_id, 'order_return', rt.id, 'revenue', rt.received_on,
    'Sales return: ' || coalesce(v_no, 'order') || ' (' || coalesce(rt.number, 'return') || ')',
    jsonb_build_array(app.books_line(rt.business_id, 'sales_returns', v_net), app.books_line(rt.business_id, 'vat_output', v_gross - v_net))
      || app.books_position_lines(rt.business_id, app.books_customer_position(rt.business_id, 'order', rt.order_id), v_gross),
    'order', rt.order_id);
end;
$$;
