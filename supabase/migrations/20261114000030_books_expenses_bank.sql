-- Books Phase C: expenses with receipts and approval; bank, cash and POS accounts; statement import,
-- matching and reconciliation (docs/ACCOUNTING.md).

--------------------------------------------------------------------------------
-- Receipts: a private storage bucket. Files live under <business id>/<expense id>/…
--------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

create or replace function app.uuid_or_null(p text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;
grant execute on function app.uuid_or_null(text) to authenticated;

create policy "office uploads receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and app.is_office(app.uuid_or_null((storage.foldername(name))[1])));
create policy "office reads receipts" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and app.is_office(app.uuid_or_null((storage.foldername(name))[1])));

--------------------------------------------------------------------------------
-- Bank, cash and POS accounts (each is a current-asset account in the chart)
--------------------------------------------------------------------------------
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  account_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('bank', 'cash', 'processor')),
  -- How this bank's statement CSV is laid out, remembered after the first import.
  column_map jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, account_id),
  foreign key (business_id, account_id) references public.accounts (business_id, id)
);

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  bank_account_id uuid not null,
  file_name text check (char_length(file_name) <= 200),
  line_count integer not null default 0,
  skipped_count integer not null default 0,
  imported_by uuid not null default auth.uid() references auth.users (id),
  imported_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, idempotency_key),
  foreign key (business_id, bank_account_id) references public.bank_accounts (business_id, id)
);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  bank_account_id uuid not null,
  import_id uuid not null,
  line_date date not null,
  description text not null check (char_length(description) <= 500),
  reference text check (char_length(reference) <= 120),
  -- Money in is positive, money out negative.
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) <= 100000000000000),
  balance_minor bigint,
  fingerprint text not null,
  status text not null default 'open' check (status in ('open', 'matched', 'ignored')),
  journal_line_id uuid references public.journal_lines (id),
  ignore_reason text check (char_length(ignore_reason) <= 300),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  unique (business_id, id),
  unique (bank_account_id, fingerprint),
  foreign key (business_id, bank_account_id) references public.bank_accounts (business_id, id),
  foreign key (business_id, import_id) references public.bank_statement_imports (business_id, id),
  check ((status = 'matched') = (journal_line_id is not null)),
  check ((status = 'ignored') = (ignore_reason is not null))
);
-- A line in the books matches one statement line at most.
create unique index bank_statement_lines_journal_line_key on public.bank_statement_lines (journal_line_id) where journal_line_id is not null;
create index bank_statement_lines_account_idx on public.bank_statement_lines (bank_account_id, line_date);

create table public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  bank_account_id uuid not null,
  through_date date not null,
  statement_balance_minor bigint not null,
  book_balance_minor bigint not null,
  reconciled_by uuid not null default auth.uid() references auth.users (id),
  reconciled_at timestamptz not null default now(),
  unique (bank_account_id, through_date),
  foreign key (business_id, bank_account_id) references public.bank_accounts (business_id, id)
);

--------------------------------------------------------------------------------
-- Expenses
--------------------------------------------------------------------------------
alter table public.businesses add column next_expense_number integer not null default 1 check (next_expense_number > 0);

create table public.expenses (
  id uuid primary key,
  business_id uuid not null references public.businesses (id),
  number text not null,
  spent_on date not null,
  payee text not null check (char_length(btrim(payee)) between 1 and 160),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  account_id uuid not null,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  vat_minor bigint not null default 0 check (vat_minor >= 0),
  -- Paid from a bank/cash account or a director's own pocket (their current account); null = not paid yet.
  paid_from_account_id uuid,
  paid_on date,
  -- True when it was paid at the time it was recorded; false when paid later (the books then clear accruals).
  paid_when_recorded boolean not null default false,
  receipt_path text check (char_length(receipt_path) <= 300),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'voided')),
  submitted_by uuid not null default auth.uid() references auth.users (id),
  submitted_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  reject_reason text check (char_length(reject_reason) <= 500),
  void_reason text check (char_length(void_reason) <= 500),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, account_id) references public.accounts (business_id, id),
  foreign key (business_id, paid_from_account_id) references public.accounts (business_id, id),
  check (vat_minor < amount_minor),
  check ((paid_from_account_id is null) = (paid_on is null))
);
create index expenses_business_idx on public.expenses (business_id, status, spent_on desc);

alter table public.bank_accounts enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_reconciliations enable row level security;
alter table public.expenses enable row level security;
create policy "owners read bank accounts" on public.bank_accounts for select to authenticated using (app.is_owner(business_id));
create policy "owners read statement imports" on public.bank_statement_imports for select to authenticated using (app.is_owner(business_id));
create policy "owners read statement lines" on public.bank_statement_lines for select to authenticated using (app.is_owner(business_id));
create policy "owners read reconciliations" on public.bank_reconciliations for select to authenticated using (app.is_owner(business_id));
create policy "office reads expenses" on public.expenses for select to authenticated using (app.is_office(business_id));
revoke all on public.bank_accounts, public.bank_statement_imports, public.bank_statement_lines, public.bank_reconciliations, public.expenses
  from anon, authenticated;
grant select on public.bank_accounts, public.bank_statement_imports, public.bank_statement_lines, public.bank_reconciliations, public.expenses
  to authenticated;

--------------------------------------------------------------------------------
-- What the expense form may offer (the front office can't read the chart directly)
--------------------------------------------------------------------------------
create or replace function app.is_expense_account(p_account uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.accounts a where a.id = p_account and a.archived_at is null and (
    a.account_group in ('operating_expenses', 'cost_of_sales', 'finance_costs')
    or (a.account_group = 'non_current_assets' and coalesce(a.system_key, '') not like '%\_dep')
    or (a.account_group = 'current_assets' and (a.system_key is null or a.system_key = 'prepayments')
        and not exists (select 1 from public.bank_accounts b where b.account_id = a.id))))
    and not exists (select 1 from public.accounts a where a.id = p_account and a.system_key in ('cogs', 'stock_change', 'rounding', 'stock_writeoffs'))
$$;

create or replace function app.is_paid_from_account(p_business_id uuid, p_account uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bank_accounts b join public.accounts a on a.id = b.account_id
                 where b.business_id = p_business_id and b.account_id = p_account and b.archived_at is null and a.archived_at is null)
      or exists (select 1 from public.accounts a where a.id = p_account and a.business_id = p_business_id
                 and a.archived_at is null and a.system_key in ('director_1', 'director_2'))
$$;

create or replace function public.expense_options(p_business_id uuid)
returns table (option_kind text, id uuid, code text, name text, account_group text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_office(p_business_id) then
    raise exception 'Only owners and the front office record expenses.' using errcode = '42501';
  end if;
  return query
  select 'category'::text, a.id, a.code, a.name, a.account_group from public.accounts a
    where a.business_id = p_business_id and app.is_expense_account(a.id)
  union all
  select 'paid_from', a.id, a.code, coalesce(b.name, a.name), a.account_group from public.accounts a
    left join public.bank_accounts b on b.account_id = a.id and b.archived_at is null
    where a.business_id = p_business_id and app.is_paid_from_account(p_business_id, a.id)
  order by 1, 3;
end;
$$;

-- Records an expense. The front office's wait for an owner; an owner's are approved at once.
create or replace function public.record_expense(
  p_business_id uuid, p_id uuid, p_spent_on date, p_payee text, p_description text, p_account_id uuid,
  p_amount_minor bigint, p_vat_minor bigint, p_paid_from_account_id uuid, p_receipt_path text, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_owner boolean := app.is_owner(p_business_id);
  v_vat_ok boolean;
begin
  if not app.is_office(p_business_id) then
    raise exception 'Only owners and the front office record expenses.' using errcode = '42501';
  end if;
  if exists (select 1 from public.expenses where business_id = p_business_id and idempotency_key = p_idempotency_key) then
    return (select id from public.expenses where business_id = p_business_id and idempotency_key = p_idempotency_key);
  end if;
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
  select coalesce(vat_registered, false) into v_vat_ok from public.books_settings where business_id = p_business_id;
  if coalesce(p_vat_minor, 0) < 0 or coalesce(p_vat_minor, 0) >= p_amount_minor then
    raise exception 'VAT must be less than the amount.' using errcode = 'P0001';
  end if;
  if coalesce(p_vat_minor, 0) > 0 and not coalesce(v_vat_ok, false) then
    raise exception 'The business isn''t set up as VAT-registered, so leave VAT at 0.' using errcode = 'P0001';
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

create or replace function public.decide_expense(p_expense_id uuid, p_approve boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.expenses;
begin
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not app.is_owner(e.business_id) then
    raise exception 'Only owners approve expenses.' using errcode = '42501';
  end if;
  if e.status <> 'submitted' then
    raise exception 'This expense has already been decided.' using errcode = 'P0001';
  end if;
  if not p_approve and (p_reason is null or char_length(btrim(p_reason)) = 0) then
    raise exception 'Say why it''s rejected.' using errcode = 'P0001';
  end if;
  update public.expenses set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), reject_reason = case when p_approve then null else left(btrim(p_reason), 500) end
  where id = e.id;
end;
$$;

-- Records that an unpaid expense has now been paid.
create or replace function public.pay_expense(p_expense_id uuid, p_paid_from_account_id uuid, p_paid_on date)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.expenses;
begin
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not app.is_owner(e.business_id) then
    raise exception 'Only owners record expense payments.' using errcode = '42501';
  end if;
  if e.status <> 'approved' or e.paid_from_account_id is not null then
    raise exception 'Only an approved, unpaid expense can be marked paid.' using errcode = 'P0001';
  end if;
  if p_paid_from_account_id is null or not app.is_paid_from_account(e.business_id, p_paid_from_account_id) then
    raise exception 'Choose how it was paid from the list.' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on < e.spent_on or p_paid_on > (now() at time zone app.business_tz(e.business_id))::date then
    raise exception 'The payment date is between the expense date and today.' using errcode = 'P0001';
  end if;
  update public.expenses set paid_from_account_id = p_paid_from_account_id, paid_on = p_paid_on where id = e.id;
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.expenses;
begin
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not app.is_owner(e.business_id) then
    raise exception 'Only owners void expenses.' using errcode = '42501';
  end if;
  if e.status not in ('approved', 'submitted') then
    raise exception 'This expense can''t be voided.' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'Say why it''s voided.' using errcode = 'P0001';
  end if;
  update public.expenses set status = 'voided', void_reason = left(btrim(p_reason), 500) where id = e.id;
end;
$$;

-- Books: an approved expense debits its account (net of VAT) and input VAT, against how it was paid
-- (or accruals until paid); paying later clears accruals; voiding reverses both.
create or replace function app.books_post_expense(p_expense uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.expenses;
  v_credit text;
  v_today date;
begin
  select * into e from public.expenses where id = p_expense;
  if not found then return; end if;
  v_today := (now() at time zone app.business_tz(e.business_id))::date;
  if e.status in ('approved', 'voided') and e.decided_at is not null then
    v_credit := case when e.paid_when_recorded then e.paid_from_account_id::text else 'accruals' end;
    perform app.books_auto_post(e.business_id, 'expense', e.id, 'post', e.spent_on,
      'Expense ' || e.number || ': ' || e.payee || ' (' || e.description || ')',
      jsonb_build_array(app.books_line(e.business_id, e.account_id::text, e.amount_minor - e.vat_minor),
        app.books_line(e.business_id, 'vat_input', e.vat_minor), app.books_line(e.business_id, v_credit, -e.amount_minor)));
  end if;
  if not e.paid_when_recorded and e.paid_from_account_id is not null
     and exists (select 1 from public.journals where business_id = e.business_id and idempotency_key = app.books_key('expense', e.id, 'post')) then
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

create trigger books_post_expense after insert or update on public.expenses
  for each row execute function app.books_trigger('expense');

-- The dispatcher learns about expenses.
create or replace function app.books_safe(p_business_id uuid, p_source_type text, p_source_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.books_settings where business_id = p_business_id) then return true; end if;
  begin
    case p_source_type
      when 'stock_document' then perform app.books_post_stock_document(p_source_id);
      when 'payment' then perform app.books_post_payment(p_source_id);
      when 'order_dispatch' then perform app.books_post_dispatch(p_source_id);
      when 'order_return' then perform app.books_post_return(p_source_id);
      when 'repair_payment' then perform app.books_post_repair_payment(p_source_id);
      when 'repair' then perform app.books_post_repair(p_source_id);
      when 'supplier_bill' then perform app.books_post_supplier_bill(p_source_id);
      when 'supplier_payment' then perform app.books_post_supplier_payment(p_source_id);
      when 'maker_payment' then perform app.books_post_maker_payment(p_source_id);
      when 'production_job' then perform app.books_post_job_fee(p_source_id);
      when 'expense' then perform app.books_post_expense(p_source_id);
      else return true;
    end case;
    delete from public.books_posting_problems where business_id = p_business_id and source_type = p_source_type and source_id = p_source_id;
    return true;
  exception when others then
    insert into public.books_posting_problems (business_id, source_type, source_id, message)
    values (p_business_id, p_source_type, p_source_id, left(sqlerrm, 500))
    on conflict (business_id, source_type, source_id) do update set message = excluded.message, last_tried_at = now();
    return false;
  end;
end;
$$;

-- Posting existing records also covers expenses.
create or replace function public.books_post_existing(
  p_business_id uuid, p_after_date date default null, p_after_created timestamptz default null, p_after_id uuid default null,
  p_limit integer default 200
)
returns table (posted integer, problems integer, next_date date, next_created timestamptz, next_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_from date;
  v_before integer;
  v_n integer := 0;
  v_limit integer := greatest(least(coalesce(p_limit, 200), 1000), 1);
  v_last record;
  r record;
begin
  perform app.require_owner_books(p_business_id);
  v_from := app.books_auto_from(p_business_id);
  if v_from is null then
    raise exception 'Add a financial year kept in the app first (close the imported year).' using errcode = 'P0001';
  end if;
  select count(*) into v_before from public.journals where business_id = p_business_id and kind in ('auto', 'reversal');
  if p_after_id is null then
    for r in select source_type, source_id from public.books_posting_problems where business_id = p_business_id loop
      perform app.books_safe(p_business_id, r.source_type, r.source_id);
    end loop;
  end if;
  for r in
    select * from (
      select 'stock_document' as t, id, effective_date as d, created_at as c from public.stock_documents where business_id = p_business_id and effective_date >= v_from
      union all select 'payment', id, paid_on, created_at from public.payments where business_id = p_business_id and paid_on >= v_from
      union all select 'order_dispatch', id, dispatched_on, created_at from public.order_dispatches where business_id = p_business_id and dispatched_on >= v_from
      union all select 'order_return', id, received_on, created_at from public.order_returns where business_id = p_business_id and received_on >= v_from
      union all select 'repair_payment', id, paid_on, created_at from public.repair_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'repair', id, (collected_at at time zone app.business_tz(business_id))::date, collected_at from public.repairs
        where business_id = p_business_id and status = 'collected' and collected_at is not null and (collected_at at time zone app.business_tz(business_id))::date >= v_from
      union all select 'supplier_bill', id, bill_date, created_at from public.supplier_bills where business_id = p_business_id and bill_date >= v_from
      union all select 'supplier_payment', id, paid_on, created_at from public.supplier_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'maker_payment', id, paid_on, created_at from public.maker_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'production_job', id, (fee_approved_at at time zone app.business_tz(business_id))::date, fee_approved_at from public.production_jobs
        where business_id = p_business_id and fee_approved is not null and fee_approved_at is not null
      union all select 'expense', id, spent_on, submitted_at from public.expenses where business_id = p_business_id and spent_on >= v_from
        and status in ('approved', 'voided')
    ) e
    where p_after_id is null or (e.d, e.c, e.id) > (p_after_date, p_after_created, p_after_id)
    order by e.d, e.c, e.id
    limit v_limit
  loop
    perform app.books_safe(p_business_id, r.t, r.id);
    v_n := v_n + 1;
    v_last := r;
  end loop;
  return query select (select count(*)::integer from public.journals where business_id = p_business_id and kind in ('auto', 'reversal')) - v_before,
    (select count(*)::integer from public.books_posting_problems where business_id = p_business_id),
    case when v_n >= v_limit then v_last.d end, case when v_n >= v_limit then v_last.c end, case when v_n >= v_limit then v_last.id end;
end;
$$;

--------------------------------------------------------------------------------
-- Bank accounts and statements (owners)
--------------------------------------------------------------------------------
create or replace function public.add_bank_account(p_business_id uuid, p_account_id uuid, p_name text, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_owner_books(p_business_id);
  if p_kind not in ('bank', 'cash', 'processor') then
    raise exception 'Choose bank, cash or POS/processor.' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'Give the account a name.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id and business_id = p_business_id and archived_at is null
                 and account_group = 'current_assets' and (system_key is null or system_key in ('cash', 'bank_main', 'clearing'))) then
    raise exception 'Choose the account for it in the chart (a current asset such as a bank or cash account).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bank_accounts where business_id = p_business_id and account_id = p_account_id) then
    raise exception 'That account is already set up.' using errcode = 'P0001';
  end if;
  insert into public.bank_accounts (business_id, account_id, name, kind) values (p_business_id, p_account_id, btrim(p_name), p_kind)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.require_owner_bank(p_bank_account uuid)
returns public.bank_accounts language plpgsql security definer set search_path = '' as $$
declare b public.bank_accounts;
begin
  select * into b from public.bank_accounts where id = p_bank_account;
  if not found or not app.is_owner(b.business_id) then
    raise exception 'Only owners can work with bank accounts.' using errcode = '42501';
  end if;
  return b;
end;
$$;

-- Imports statement lines, skipping ones already imported (same date, amount, description, balance and
-- position among identical lines). Amounts in kobo, money in positive.
create or replace function public.import_bank_statement(p_bank_account uuid, p_file_name text, p_lines jsonb, p_column_map jsonb, p_idempotency_key uuid)
returns table (imported integer, skipped integer)
language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  v_import uuid;
  v_count integer;
  v_inserted integer;
begin
  select id into v_import from public.bank_statement_imports where business_id = b.business_id and idempotency_key = p_idempotency_key;
  if found then
    return query select line_count, skipped_count from public.bank_statement_imports where id = v_import;
    return;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'The statement has no lines.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'Import at most 5,000 lines at a time.' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             where coalesce(l ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
                or jsonb_typeof(l -> 'amount') <> 'number' or (l ->> 'amount')::numeric = 0
                or (l ->> 'amount')::numeric <> trunc((l ->> 'amount')::numeric)
                or abs((l ->> 'amount')::numeric) > 100000000000000
                or (l ? 'balance' and jsonb_typeof(l -> 'balance') not in ('number', 'null'))) then
    raise exception 'Some lines have no date or amount. Check the column choices.' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_lines);
  insert into public.bank_statement_imports (business_id, bank_account_id, file_name, idempotency_key)
  values (b.business_id, b.id, left(p_file_name, 200), p_idempotency_key) returning id into v_import;
  with src as (
    select (l ->> 'date')::date as d, left(coalesce(btrim(l ->> 'description'), ''), 500) as descr,
           left(nullif(btrim(l ->> 'reference'), ''), 120) as ref, (l ->> 'amount')::bigint as amt,
           case when jsonb_typeof(l -> 'balance') = 'number' then (l ->> 'balance')::numeric::bigint end as bal, n
    from jsonb_array_elements(p_lines) with ordinality as x(l, n)
  ), fp as (
    select *, md5(d::text || '|' || amt::text || '|' || lower(descr) || '|' || coalesce(bal::text, '') || '|' ||
      row_number() over (partition by d, amt, lower(descr), bal order by n)::text) as f
    from src
  ), ins as (
    insert into public.bank_statement_lines (business_id, bank_account_id, import_id, line_date, description, reference, amount_minor, balance_minor, fingerprint)
    select b.business_id, b.id, v_import, d, descr, ref, amt, bal, f from fp
    on conflict (bank_account_id, fingerprint) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;
  update public.bank_statement_imports set line_count = v_inserted, skipped_count = v_count - v_inserted where id = v_import;
  if p_column_map is not null and jsonb_typeof(p_column_map) = 'object' and length(p_column_map::text) <= 2000 then
    update public.bank_accounts set column_map = p_column_map where id = b.id;
  end if;
  return query select v_inserted, v_count - v_inserted;
end;
$$;

-- Lines in the books that could be this statement line: same account, same amount and direction, not matched yet, near the date.
create or replace function public.bank_line_suggestions(p_line uuid)
returns table (journal_line_id uuid, journal_id uuid, number text, effective_date date, narration text, days_apart integer)
language plpgsql stable security definer set search_path = '' as $$
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
  where l.account_id = b.account_id
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
  s public.bank_statement_lines;
  b public.bank_accounts;
  l public.journal_lines;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  b := app.require_owner_bank(s.bank_account_id);
  if s.status <> 'open' then raise exception 'This line is already dealt with.' using errcode = 'P0001'; end if;
  select * into l from public.journal_lines where id = p_journal_line;
  if not found or l.account_id <> b.account_id
     or not ((s.amount_minor > 0 and l.debit_minor = s.amount_minor) or (s.amount_minor < 0 and l.credit_minor = -s.amount_minor)) then
    raise exception 'That entry isn''t for this account and amount.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bank_statement_lines where journal_line_id = p_journal_line) then
    raise exception 'That entry is already matched to another statement line.' using errcode = 'P0001';
  end if;
  update public.bank_statement_lines set status = 'matched', journal_line_id = p_journal_line, decided_by = auth.uid(), decided_at = now()
  where id = s.id;
end;
$$;

-- Back to open (unmatch or un-ignore). Lines already inside a reconciled period stay as they are.
create or replace function public.reopen_bank_line(p_line uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.bank_statement_lines;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_bank(s.bank_account_id);
  if exists (select 1 from public.bank_reconciliations r where r.bank_account_id = s.bank_account_id and r.through_date >= s.line_date) then
    raise exception 'This line is in a reconciled period.' using errcode = 'P0001';
  end if;
  update public.bank_statement_lines set status = 'open', journal_line_id = null, ignore_reason = null, decided_by = auth.uid(), decided_at = now()
  where id = s.id;
end;
$$;

create or replace function public.ignore_bank_line(p_line uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.bank_statement_lines;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_bank(s.bank_account_id);
  if s.status <> 'open' then raise exception 'This line is already dealt with.' using errcode = 'P0001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'Say why it''s ignored (e.g. a duplicate line in the statement).' using errcode = 'P0001';
  end if;
  update public.bank_statement_lines set status = 'ignored', ignore_reason = left(btrim(p_reason), 300), decided_by = auth.uid(), decided_at = now()
  where id = s.id;
end;
$$;

-- Posts a statement line that isn't in the books yet (bank charges, a transfer, a pre-app sale…) against the
-- chosen account, with optional input VAT, and matches it.
create or replace function public.post_bank_line(p_line uuid, p_account_id uuid, p_narration text, p_vat_minor bigint, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.bank_statement_lines;
  b public.bank_accounts;
  v_journal uuid;
  v_line uuid;
  v_vat bigint := coalesce(p_vat_minor, 0);
  v_lines jsonb;
begin
  select * into s from public.bank_statement_lines where id = p_line for update;
  if not found then raise exception 'That line no longer exists.' using errcode = 'P0001'; end if;
  b := app.require_owner_bank(s.bank_account_id);
  perform app.require_owner_books(b.business_id);
  if s.status <> 'open' then raise exception 'This line is already dealt with.' using errcode = 'P0001'; end if;
  if p_account_id is null or p_account_id = b.account_id
     or not exists (select 1 from public.accounts where id = p_account_id and business_id = b.business_id and archived_at is null) then
    raise exception 'Choose the other account (not this bank account).' using errcode = 'P0001';
  end if;
  if v_vat < 0 or v_vat >= abs(s.amount_minor) or (v_vat > 0 and s.amount_minor > 0) then
    raise exception 'Input VAT applies to money out, and must be less than the amount.' using errcode = 'P0001';
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

-- Matches every open line that has exactly one candidate within 3 days, which no other line also points at.
create or replace function public.bank_auto_match(p_bank_account uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
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
      where s.bank_account_id = b.id and s.status = 'open'
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

-- Reconciliation at a date: the statement balance plus what the books have that the statement doesn't yet,
-- less what the statement has that the books don't, must equal the books.
create or replace function public.bank_reconciliation_status(p_bank_account uuid, p_through date)
returns table (book_balance_minor bigint, statement_balance_minor bigint, uncleared_books_minor bigint, unposted_statement_minor bigint,
  difference_minor bigint, open_lines integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  v_book bigint;
  v_stmt bigint;
  v_uncleared bigint;
  v_unposted bigint;
  v_open integer;
  v_start date;
  v_last date;
begin
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_book
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = b.account_id and j.effective_date <= p_through;
  select min(line_date), max(line_date) filter (where line_date <= p_through and balance_minor is not null) into v_start, v_last
  from public.bank_statement_lines where bank_account_id = b.id;
  -- The statement balance at the end of that day: the line whose balance no other line that day continues from
  -- (statements list lines oldest- or newest-first, so file order can't be trusted).
  select s.balance_minor into v_stmt from public.bank_statement_lines s
  where s.bank_account_id = b.id and s.line_date = v_last and s.balance_minor is not null
    and not exists (select 1 from public.bank_statement_lines o where o.bank_account_id = b.id and o.line_date = v_last
                      and o.id <> s.id and o.balance_minor is not null and o.balance_minor - o.amount_minor = s.balance_minor)
  limit 1;
  -- In the books since the statement starts, but not matched to any statement line (e.g. a transfer not yet cleared).
  -- Earlier entries make up the opening balance, which the statement's balances already include.
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_uncleared
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = b.account_id and j.effective_date <= p_through and j.effective_date >= coalesce(v_start, p_through + 1)
    and not exists (select 1 from public.bank_statement_lines x where x.journal_line_id = l.id);
  -- On the statement but not yet in the books.
  select coalesce(sum(amount_minor), 0), count(*) into v_unposted, v_open
  from public.bank_statement_lines where bank_account_id = b.id and line_date <= p_through and status = 'open';
  return query select v_book, v_stmt, v_uncleared, v_unposted,
    case when v_stmt is null then null else v_book - v_uncleared + v_unposted - v_stmt end, v_open;
end;
$$;

create or replace function public.reconcile_bank(p_bank_account uuid, p_through date, p_statement_balance_minor bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.bank_accounts := app.require_owner_bank(p_bank_account);
  st record;
begin
  select * into st from public.bank_reconciliation_status(p_bank_account, p_through);
  if p_statement_balance_minor is null then
    raise exception 'Enter the statement balance on that date.' using errcode = 'P0001';
  end if;
  if st.open_lines > 0 then
    raise exception 'Deal with the % open statement line(s) up to that date first.', st.open_lines using errcode = 'P0001';
  end if;
  if st.book_balance_minor - st.uncleared_books_minor <> p_statement_balance_minor then
    raise exception 'The books don''t agree with that statement balance yet (difference %).',
      to_char((st.book_balance_minor - st.uncleared_books_minor - p_statement_balance_minor) / 100.0, 'FM999,999,999,990.00') using errcode = 'P0001';
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
  foreach f in array array['is_expense_account(uuid)', 'is_paid_from_account(uuid, uuid)', 'books_post_expense(uuid)', 'require_owner_bank(uuid)'] loop
    execute format('revoke all on function app.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['expense_options', 'record_expense', 'decide_expense', 'pay_expense', 'void_expense', 'books_post_existing',
    'add_bank_account', 'import_bank_statement', 'bank_line_suggestions', 'match_bank_line', 'reopen_bank_line', 'ignore_bank_line',
    'post_bank_line', 'bank_auto_match', 'bank_reconciliation_status', 'reconcile_bank'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
