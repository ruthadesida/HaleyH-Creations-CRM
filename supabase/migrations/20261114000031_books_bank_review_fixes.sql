-- Books Phase C review fixes:
-- 1. Reopening a statement line that was posted from the bank page reverses that journal (no double posting).
-- 2. Reconciliation: a book entry counts as cleared only by a statement line dated on or before the date;
--    set-aside lines are shown as explained differences; reconciled periods can't be changed afterwards.
-- 3. Statement import: each line is checked in turn (friendly errors), dedupe ignores the balance column,
--    a request key can't be reused across accounts.
-- 4. Matching skips reversed journals and reversals; posting a line refuses control accounts, returns the
--    journal on a repeated request, and allows input VAT only for a VAT-registered business.
-- 5. Expenses: categories narrowed (no stray current assets), VAT can't exceed what the owner's rate allows,
--    duplicate submissions return the first, and paying an expense from before the live year still posts.
-- 6. The receipts bucket's limits are enforced even if a bucket of that name already existed.

update storage.buckets set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
where id = 'receipts';

--------------------------------------------------------------------------------
-- Expenses
--------------------------------------------------------------------------------
create or replace function app.is_expense_account(p_account uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accounts a where a.id = p_account and a.archived_at is null and (
    a.account_group in ('operating_expenses', 'cost_of_sales', 'finance_costs')
    or (a.account_group = 'non_current_assets' and coalesce(a.system_key, '') not like '%\_dep')
    or a.system_key = 'prepayments')
    and coalesce(a.system_key, '') not in ('cogs', 'stock_change', 'rounding', 'stock_writeoffs', 'production_losses'))
$$;

create or replace function public.record_expense(
  p_business_id uuid, p_id uuid, p_spent_on date, p_payee text, p_description text, p_account_id uuid,
  p_amount_minor bigint, p_vat_minor bigint, p_paid_from_account_id uuid, p_receipt_path text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_owner boolean := app.is_owner(p_business_id);
  v_registered boolean;
  v_rate numeric;
  v_id uuid;
begin
  if not app.is_office(p_business_id) then
    raise exception 'Only owners and the front office record expenses.' using errcode = '42501';
  end if;
  -- Locking the business row numbers expenses in order and makes a repeated request wait, then return the first.
  perform 1 from public.businesses where id = p_business_id for update;
  select id into v_id from public.expenses where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if p_id is null then
    raise exception 'Refresh the page and try again.' using errcode = 'P0001';
  end if;
  if p_spent_on is null or p_spent_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'Choose the date it was spent (not in the future).' using errcode = 'P0001';
  end if;
  if p_payee is null or char_length(btrim(p_payee)) = 0 then
    raise exception 'Say who was paid.' using errcode = 'P0001';
  end if;
  if p_description is null or char_length(btrim(p_description)) = 0 then
    raise exception 'Say what it was for.' using errcode = 'P0001';
  end if;
  if p_account_id is null or not exists (select 1 from public.accounts where id = p_account_id and business_id = p_business_id)
     or not app.is_expense_account(p_account_id) then
    raise exception 'Choose what kind of expense it is.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount_minor, 0) <= 0 then
    raise exception 'Enter the amount.' using errcode = 'P0001';
  end if;
  select vat_registered, vat_rate into v_registered, v_rate from public.books_settings where business_id = p_business_id;
  if coalesce(p_vat_minor, 0) < 0 or coalesce(p_vat_minor, 0) >= p_amount_minor then
    raise exception 'VAT must be less than the amount.' using errcode = 'P0001';
  end if;
  if coalesce(p_vat_minor, 0) > 0 and not coalesce(v_registered, false) then
    raise exception 'The business isn''t set up as VAT-registered, so leave VAT at 0.' using errcode = 'P0001';
  end if;
  -- At most the VAT the owner's rate gives on a VAT-inclusive amount (plus a kobo for rounding).
  if coalesce(p_vat_minor, 0) > 0 and v_rate is not null and p_vat_minor > ceil(p_amount_minor * v_rate / (100 + v_rate)) + 1 then
    raise exception 'That''s more VAT than % gives on this amount. Check the receipt.', v_rate || '%' using errcode = 'P0001';
  end if;
  if p_paid_from_account_id is not null and not app.is_paid_from_account(p_business_id, p_paid_from_account_id) then
    raise exception 'Choose how it was paid from the list.' using errcode = 'P0001';
  end if;
  if p_receipt_path is not null and (
       split_part(p_receipt_path, '/', 1) <> p_business_id::text or split_part(p_receipt_path, '/', 2) <> p_id::text
       or not exists (select 1 from storage.objects where bucket_id = 'receipts' and name = p_receipt_path)) then
    raise exception 'The receipt didn''t upload. Add it again.' using errcode = 'P0001';
  end if;
  update public.businesses set next_expense_number = next_expense_number + 1 where id = p_business_id
    returning next_expense_number - 1 into v_n;
  insert into public.expenses (id, business_id, number, spent_on, payee, description, account_id, amount_minor, vat_minor,
    paid_from_account_id, paid_on, paid_when_recorded, receipt_path, status, decided_by, decided_at, idempotency_key)
  values (p_id, p_business_id, 'EX-' || lpad(v_n::text, 5, '0'), p_spent_on, btrim(p_payee), btrim(p_description), p_account_id,
    p_amount_minor, coalesce(p_vat_minor, 0), p_paid_from_account_id, case when p_paid_from_account_id is not null then p_spent_on end,
    p_paid_from_account_id is not null, p_receipt_path,
    case when v_owner then 'approved' else 'submitted' end,
    case when v_owner then auth.uid() end, case when v_owner then now() end, p_idempotency_key);
  return p_id;
end;
$$;

-- An expense from before the live year is in the imported figures (as owed); paying it later still posts.
create or replace function app.books_post_expense(p_expense uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.expenses;
  v_credit text;
  v_today date;
  v_from date;
begin
  select * into e from public.expenses where id = p_expense;
  if not found then return; end if;
  v_today := (now() at time zone app.business_tz(e.business_id))::date;
  v_from := app.books_auto_from(e.business_id);
  if e.status in ('approved', 'voided') and e.decided_at is not null then
    v_credit := case when e.paid_when_recorded then e.paid_from_account_id::text else 'accruals' end;
    perform app.books_auto_post(e.business_id, 'expense', e.id, 'post', e.spent_on,
      'Expense ' || e.number || ': ' || e.payee || ' (' || e.description || ')',
      jsonb_build_array(app.books_line(e.business_id, e.account_id::text, e.amount_minor - e.vat_minor),
        app.books_line(e.business_id, 'vat_input', e.vat_minor), app.books_line(e.business_id, v_credit, -e.amount_minor)));
  end if;
  if not e.paid_when_recorded and e.paid_from_account_id is not null and e.status = 'approved'
     and (exists (select 1 from public.journals where business_id = e.business_id and idempotency_key = app.books_key('expense', e.id, 'post'))
          or (v_from is not null and e.spent_on < v_from)) then
    perform app.books_auto_post(e.business_id, 'expense', e.id, 'pay', e.paid_on,
      'Expense ' || e.number || ' paid: ' || e.payee,
      jsonb_build_array(app.books_line(e.business_id, 'accruals', e.amount_minor), app.books_line(e.business_id, e.paid_from_account_id::text, -e.amount_minor)));
  end if;
  if e.status = 'voided' then
    perform app.books_auto_reverse(e.business_id, 'expense', e.id, 'pay', v_today, 'expense voided: ' || coalesce(e.void_reason, ''));
    perform app.books_auto_reverse(e.business_id, 'expense', e.id, 'post', v_today, 'expense voided: ' || coalesce(e.void_reason, ''));
  end if;
end;
$$;

--------------------------------------------------------------------------------
-- Bank
--------------------------------------------------------------------------------

-- Lines on or before the latest reconciliation are settled and can't be changed.
create or replace function app.bank_locked_through(p_bank_account uuid)
returns date language sql stable security definer set search_path = '' as $$
  select max(through_date) from public.bank_reconciliations where bank_account_id = p_bank_account
$$;

create or replace function app.bank_line_for_change(p_line uuid)
returns public.bank_statement_lines language plpgsql security definer set search_path = '' as $$
declare s public.bank_statement_lines;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_bank(s.bank_account_id);
  if s.line_date <= coalesce(app.bank_locked_through(s.bank_account_id), '-infinity'::date) then
    raise exception 'This line is in a reconciled period.' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

-- A book entry that can still be matched: on the account, not reversed, not itself a reversal.
create or replace function app.bank_matchable(p_journal_line uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.journal_lines l join public.journals j on j.id = l.journal_id
                 where l.id = p_journal_line and j.reversed_by_id is null and j.kind <> 'reversal')
     and not exists (select 1 from public.bank_statement_lines x where x.journal_line_id = p_journal_line)
$$;

drop function if exists public.import_bank_statement(uuid, text, jsonb, jsonb, uuid);
create or replace function public.import_bank_statement(p_bank_account uuid, p_file_name text, p_lines jsonb, p_column_map jsonb, p_idempotency_key uuid)
returns table (imported integer, skipped integer)
language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  v_import public.bank_statement_imports;
  v_id uuid;
  v_count integer;
  v_inserted integer;
  l jsonb;
  v_n integer := 0;
begin
  select * into v_import from public.bank_statement_imports where business_id = b.business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_import.bank_account_id <> b.id then
      raise exception 'Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return query select v_import.line_count, v_import.skipped_count;
    return;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The statement has no lines.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'Import at most 5,000 lines at a time.' using errcode = 'P0001';
  end if;
  -- Each line checked in turn, so a bad one gets a clear message.
  for l in select value from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    if jsonb_typeof(l) <> 'object' or coalesce(l ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Line %: no date. Check the date column.', v_n using errcode = 'P0001';
    end if;
    begin
      perform (l ->> 'date')::date;
    exception when others then
      raise exception 'Line %: % isn''t a real date. Check day/month order.', v_n, l ->> 'date' using errcode = 'P0001';
    end;
    if jsonb_typeof(l -> 'amount') is distinct from 'number' then
      raise exception 'Line %: no amount. Check the amount columns.', v_n using errcode = 'P0001';
    end if;
    if (l ->> 'amount')::numeric = 0 or (l ->> 'amount')::numeric <> trunc((l ->> 'amount')::numeric) or abs((l ->> 'amount')::numeric) > 100000000000000 then
      raise exception 'Line %: the amount isn''t a whole number of kobo.', v_n using errcode = 'P0001';
    end if;
    if l ? 'balance' and jsonb_typeof(l -> 'balance') not in ('number', 'null') then
      raise exception 'Line %: the balance isn''t a number.', v_n using errcode = 'P0001';
    end if;
    if jsonb_typeof(l -> 'balance') = 'number' and ((l ->> 'balance')::numeric <> trunc((l ->> 'balance')::numeric) or abs((l ->> 'balance')::numeric) > 100000000000000) then
      raise exception 'Line %: the balance isn''t a whole number of kobo.', v_n using errcode = 'P0001';
    end if;
  end loop;
  v_count := jsonb_array_length(p_lines);
  insert into public.bank_statement_imports (business_id, bank_account_id, file_name, idempotency_key)
  values (b.business_id, b.id, left(p_file_name, 200), p_idempotency_key) returning id into v_id;
  -- Same date, amount and description, told apart by their order within the day; the balance column is left out
  -- so a re-export with or without it doesn't import twice.
  with src as (
    select (x.l ->> 'date')::date as d, left(coalesce(btrim(x.l ->> 'description'), ''), 500) as descr,
           left(nullif(btrim(x.l ->> 'reference'), ''), 120) as ref, (x.l ->> 'amount')::bigint as amt,
           case when jsonb_typeof(x.l -> 'balance') = 'number' then (x.l ->> 'balance')::bigint end as bal, x.n
    from jsonb_array_elements(p_lines) with ordinality as x(l, n)
  ), fp as (
    select *, md5(d::text || '|' || amt::text || '|' || lower(descr) || '|' ||
      row_number() over (partition by d, amt, lower(descr) order by n)::text) as f
    from src
  ), ins as (
    insert into public.bank_statement_lines (business_id, bank_account_id, import_id, line_date, description, reference, amount_minor, balance_minor, fingerprint)
    select b.business_id, b.id, v_id, d, descr, ref, amt, bal, f from fp
    on conflict (bank_account_id, fingerprint) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  update public.bank_statement_imports set line_count = v_inserted, skipped_count = v_count - v_inserted where id = v_id;
  if p_column_map is not null and jsonb_typeof(p_column_map) = 'object' and length(p_column_map::text) <= 2000 then
    update public.bank_accounts set column_map = p_column_map where id = b.id;
  end if;
  return query select v_inserted, v_count - v_inserted;
end;
$$;

create or replace function public.bank_line_suggestions(p_line uuid)
returns table (journal_line_id uuid, journal_id uuid, number text, effective_date date, narration text, days_apart integer)
language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
  b public.bank_accounts;
begin
  select * into s from public.bank_statement_lines where id = p_line;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  b := app.require_owner_bank(s.bank_account_id);
  return query
  select l.id, j.id, j.number, j.effective_date, j.narration, abs(j.effective_date - s.line_date)
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = b.account_id and j.reversed_by_id is null and j.kind <> 'reversal'
    and ((s.amount_minor > 0 and l.debit_minor = s.amount_minor) or (s.amount_minor < 0 and l.credit_minor = -s.amount_minor))
    and abs(j.effective_date - s.line_date) <= 10
    and not exists (select 1 from public.bank_statement_lines x where x.journal_line_id = l.id)
  order by abs(j.effective_date - s.line_date), j.effective_date, j.number
  limit 10;
end;
$$;

create or replace function public.match_bank_line(p_line uuid, p_journal_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines := app.bank_line_for_change(p_line);
  b public.bank_accounts := app.require_owner_bank(s.bank_account_id);
  l public.journal_lines;
begin
  if s.status <> 'open' then raise exception 'This line is already dealt with.' using errcode = 'P0001'; end if;
  select * into l from public.journal_lines where id = p_journal_line;
  if not found or l.account_id <> b.account_id
     or not ((s.amount_minor > 0 and l.debit_minor = s.amount_minor) or (s.amount_minor < 0 and l.credit_minor = -s.amount_minor)) then
    raise exception 'That entry isn''t for this account and amount.' using errcode = 'P0001';
  end if;
  if not app.bank_matchable(p_journal_line) then
    raise exception 'That entry is already matched, reversed or a reversal.' using errcode = 'P0001';
  end if;
  update public.bank_statement_lines set status = 'matched', journal_line_id = p_journal_line, decided_by = auth.uid(), decided_at = now()
  where id = s.id;
end;
$$;

-- Back to open. A journal that was posted from this line is reversed, so posting it again can't double count.
create or replace function public.reopen_bank_line(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines := app.bank_line_for_change(p_line);
  b public.bank_accounts := app.require_owner_bank(s.bank_account_id);
  j public.journals;
  v_lines jsonb;
  v_rev uuid;
begin
  if s.status = 'open' then return; end if;
  if s.journal_line_id is not null then
    select jn.* into j from public.journals jn join public.journal_lines l on l.journal_id = jn.id
      where l.id = s.journal_line_id and jn.source_type = 'bank_line' and jn.source_id = s.id for update of jn;
    if found and j.reversed_by_id is null then
      select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit_minor, 'credit', debit_minor, 'description', description) order by line_no)
        into v_lines from public.journal_lines where journal_id = j.id;
      v_rev := app.post_journal(b.business_id, app.books_open_date(b.business_id, j.effective_date),
        left('Reversal of ' || j.number || ': statement line reopened', 500), 'reversal', null, v_lines,
        md5('bank-reopen:' || s.id::text || ':' || j.id::text)::uuid, j.id, 'bank_line', s.id);
      update public.journals set reversed_by_id = v_rev where id = j.id and reversed_by_id is null;
    end if;
  end if;
  update public.bank_statement_lines set status = 'open', journal_line_id = null, ignore_reason = null, decided_by = auth.uid(), decided_at = now()
  where id = s.id;
end;
$$;

create or replace function public.ignore_bank_line(p_line uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.bank_statement_lines := app.bank_line_for_change(p_line);
begin
  if s.status <> 'open' then raise exception 'This line is already dealt with.' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'Say why it''s set aside (e.g. a bank error the bank will reverse).' using errcode = 'P0001';
  end if;
  update public.bank_statement_lines set status = 'ignored', ignore_reason = left(btrim(p_reason), 300), decided_by = auth.uid(), decided_at = now()
  where id = s.id;
end;
$$;

create or replace function public.post_bank_line(p_line uuid, p_account_id uuid, p_narration text, p_vat_minor bigint, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
  b public.bank_accounts;
  v_journal uuid;
  v_line uuid;
  v_vat bigint := coalesce(p_vat_minor, 0);
  v_lines jsonb;
  v_key text;
begin
  select * into s from public.bank_statement_lines where id = p_line;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  b := app.require_owner_bank(s.bank_account_id);
  -- A repeated request returns the journal it posted.
  select id into v_journal from public.journals where business_id = b.business_id and idempotency_key = p_idempotency_key;
  if found then return v_journal; end if;
  s := app.bank_line_for_change(p_line);
  perform app.require_owner_books(b.business_id);
  if s.status <> 'open' then raise exception 'This line is already dealt with.' using errcode = 'P0001'; end if;
  select system_key into v_key from public.accounts where id = p_account_id and business_id = b.business_id and archived_at is null;
  if not found or p_account_id = b.account_id then
    raise exception 'Choose the other account (not this bank account).' using errcode = 'P0001';
  end if;
  if v_key in ('receivables', 'customer_deposits', 'payables', 'grni', 'maker_payables', 'inv_raw', 'inv_wip', 'inv_finished', 'inv_quarantine', 'cogs') then
    raise exception 'That account is kept by the app''s own records. Record it there instead (e.g. the order''s payment, the supplier payment), then match it.' using errcode = 'P0001';
  end if;
  if v_vat < 0 or v_vat >= abs(s.amount_minor) or (v_vat > 0 and s.amount_minor > 0) then
    raise exception 'Input VAT applies to money out, and must be less than the amount.' using errcode = 'P0001';
  end if;
  if v_vat > 0 and not coalesce((select vat_registered from public.books_settings where business_id = b.business_id), false) then
    raise exception 'The business isn''t set up as VAT-registered, so leave VAT at 0.' using errcode = 'P0001';
  end if;
  v_lines := jsonb_build_array(
    app.books_line(b.business_id, b.account_id::text, s.amount_minor, s.description),
    app.books_line(b.business_id, p_account_id::text, -(s.amount_minor + case when s.amount_minor < 0 then v_vat else 0 end), s.description));
  if v_vat > 0 then
    v_lines := v_lines || jsonb_build_array(app.books_line(b.business_id, 'vat_input', v_vat, s.description));
  end if;
  v_journal := app.post_journal(b.business_id, s.line_date,
    coalesce(nullif(btrim(p_narration), ''), 'Bank: ' || s.description), 'manual', null, v_lines, p_idempotency_key,
    null, 'bank_line', s.id);
  select id into v_line from public.journal_lines where journal_id = v_journal and account_id = b.account_id order by line_no limit 1;
  update public.bank_statement_lines set status = 'matched', journal_line_id = v_line, decided_by = auth.uid(), decided_at = now()
  where id = s.id and status = 'open';
  return v_journal;
end;
$$;

create or replace function public.bank_auto_match(p_bank_account uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  v_locked date := coalesce(app.bank_locked_through(p_bank_account), '-infinity'::date);
  v_n integer := 0;
  r record;
begin
  for r in
    with cand as (
      select s.id as line_id, l.id as jl
      from public.bank_statement_lines s
      join public.journal_lines l on l.account_id = b.account_id
        and ((s.amount_minor > 0 and l.debit_minor = s.amount_minor) or (s.amount_minor < 0 and l.credit_minor = -s.amount_minor))
      join public.journals j on j.id = l.journal_id and abs(j.effective_date - s.line_date) <= 3
        and j.reversed_by_id is null and j.kind <> 'reversal'
      where s.bank_account_id = b.id and s.status = 'open' and s.line_date > v_locked
        and not exists (select 1 from public.bank_statement_lines x where x.journal_line_id = l.id)
    )
    select line_id, min(jl::text)::uuid as jl from cand c
    where (select count(*) from cand c2 where c2.line_id = c.line_id) = 1
      and (select count(*) from cand c3 where c3.jl = c.jl) = 1
    group by line_id
  loop
    update public.bank_statement_lines set status = 'matched', journal_line_id = r.jl, decided_by = auth.uid(), decided_at = now()
    where id = r.line_id and status = 'open';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Reconciliation at a date. Books less entries not yet on the statement (or on it only after the date), plus
-- entries the statement shows before the books do, plus set-aside lines (bank errors etc.), equals the statement.
drop function if exists public.bank_reconciliation_status(uuid, date);
create or replace function public.bank_reconciliation_status(p_bank_account uuid, p_through date)
returns table (book_balance_minor bigint, statement_balance_minor bigint, uncleared_books_minor bigint, unposted_statement_minor bigint,
  set_aside_minor bigint, difference_minor bigint, open_lines integer)
language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  v_book bigint;
  v_stmt bigint;
  v_uncleared bigint;
  v_early bigint;
  v_unposted bigint;
  v_aside bigint;
  v_open integer;
  v_start date;
  v_last date;
begin
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_book
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = b.account_id and j.effective_date <= p_through;
  select min(line_date), max(line_date) filter (where line_date <= p_through and balance_minor is not null) into v_start, v_last
  from public.bank_statement_lines where bank_account_id = b.id;
  select s.balance_minor into v_stmt from public.bank_statement_lines s
  where s.bank_account_id = b.id and s.line_date = v_last and s.balance_minor is not null
    and not exists (select 1 from public.bank_statement_lines o where o.bank_account_id = b.id and o.line_date = v_last
                      and o.id <> s.id and o.balance_minor is not null and o.balance_minor - o.amount_minor = s.balance_minor)
  limit 1;
  -- In the books (since the statement starts, up to the date) but not cleared by a statement line up to the date.
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_uncleared
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = b.account_id and j.effective_date <= p_through and j.effective_date >= coalesce(v_start, p_through + 1)
    and not exists (select 1 from public.bank_statement_lines x where x.journal_line_id = l.id and x.line_date <= p_through);
  -- Dated in the books after the date, but already on the statement up to it.
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_early
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  join public.bank_statement_lines x on x.journal_line_id = l.id
  where l.account_id = b.account_id and j.effective_date > p_through and x.line_date <= p_through;
  select coalesce(sum(amount_minor) filter (where status = 'open'), 0), coalesce(sum(amount_minor) filter (where status = 'ignored'), 0),
         count(*) filter (where status = 'open')
    into v_unposted, v_aside, v_open
  from public.bank_statement_lines where bank_account_id = b.id and line_date <= p_through;
  return query select v_book, v_stmt, v_uncleared - v_early, v_unposted, v_aside,
    case when v_stmt is null then null else v_book - (v_uncleared - v_early) + v_unposted + v_aside - v_stmt end, v_open;
end;
$$;

create or replace function public.reconcile_bank(p_bank_account uuid, p_through date, p_statement_balance_minor bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  st record;
begin
  if p_through is null or p_through > (now() at time zone app.business_tz(b.business_id))::date then
    raise exception 'Choose a date up to today.' using errcode = 'P0001';
  end if;
  if p_statement_balance_minor is null then
    raise exception 'Enter the statement balance on that date.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.bank_statement_lines where bank_account_id = b.id and line_date <= p_through) then
    raise exception 'Import the statement up to that date first.' using errcode = 'P0001';
  end if;
  if p_through < coalesce(app.bank_locked_through(b.id), '-infinity'::date) then
    raise exception 'A later date is already reconciled.' using errcode = 'P0001';
  end if;
  select * into st from public.bank_reconciliation_status(p_bank_account, p_through);
  if st.open_lines > 0 then
    raise exception 'Deal with the % open statement line(s) up to that date first.', st.open_lines using errcode = 'P0001';
  end if;
  if st.book_balance_minor - st.uncleared_books_minor + st.set_aside_minor <> p_statement_balance_minor then
    raise exception 'The books don''t agree with that statement balance yet (difference %).',
      to_char((st.book_balance_minor - st.uncleared_books_minor + st.set_aside_minor - p_statement_balance_minor) / 100.0, 'FM999,999,999,990.00')
      using errcode = 'P0001';
  end if;
  insert into public.bank_reconciliations (business_id, bank_account_id, through_date, statement_balance_minor, book_balance_minor)
  values (b.business_id, b.id, p_through, p_statement_balance_minor, st.book_balance_minor)
  on conflict (bank_account_id, through_date) do update set statement_balance_minor = excluded.statement_balance_minor,
    book_balance_minor = excluded.book_balance_minor, reconciled_by = auth.uid(), reconciled_at = now();
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['bank_locked_through(uuid)', 'bank_line_for_change(uuid)', 'bank_matchable(uuid)'] loop
    execute format('revoke all on function app.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['import_bank_statement', 'bank_reconciliation_status', 'bank_line_suggestions'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
