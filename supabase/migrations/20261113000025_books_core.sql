-- Bookkeeping Phase A: chart of accounts, financial years, double-entry journals, imported years with
-- opening adjustments, reversals, period lock, year-end close. Design: docs/ACCOUNTING.md.
-- Owners only. Journals are written only by the functions below and are never edited or deleted.

--------------------------------------------------------------------------------
-- Settings
--------------------------------------------------------------------------------
create table public.books_settings (
  business_id uuid primary key references public.businesses (id),
  first_year_start date not null check (extract(day from first_year_start) = 1),
  incorporation_date date,
  vat_registered boolean not null default false,
  -- Owner-entered; never assumed. Null until set.
  vat_rate numeric(5, 2) check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100)),
  -- No postings dated on or before this date (month close). Year-end close moves it forward.
  locked_through date,
  next_journal_number integer not null default 1 check (next_journal_number > 0),
  set_up_by uuid not null default auth.uid() references auth.users (id),
  set_up_at timestamptz not null default now(),
  check (not vat_registered or vat_rate is not null)
);

--------------------------------------------------------------------------------
-- Chart of accounts
--------------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  code text not null check (code ~ '^[0-9]{3,6}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  account_group text not null check (account_group in (
    'current_assets', 'non_current_assets', 'current_liabilities', 'non_current_liabilities', 'equity',
    'income', 'other_income', 'cost_of_sales', 'operating_expenses', 'finance_costs', 'tax')),
  type text generated always as (case
    when account_group in ('current_assets', 'non_current_assets') then 'asset'
    when account_group in ('current_liabilities', 'non_current_liabilities') then 'liability'
    when account_group = 'equity' then 'equity'
    when account_group in ('income', 'other_income') then 'income'
    else 'expense' end) stored,
  -- Accounts the app posts to automatically; can be renamed but not regrouped or archived.
  system_key text check (system_key ~ '^[a-z0-9_]{2,40}$'),
  -- Accumulated depreciation points at its asset account.
  contra_of uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, code),
  unique (business_id, system_key),
  foreign key (business_id, contra_of) references public.accounts (business_id, id)
);

--------------------------------------------------------------------------------
-- Financial years
--------------------------------------------------------------------------------
create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  start_date date not null,
  end_date date not null,
  -- imported: figures loaded from earlier records (trial balance + opening adjustments); live: kept in the app.
  kind text not null check (kind in ('imported', 'live')),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  closing_journal_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, start_date),
  check (end_date > start_date)
);

--------------------------------------------------------------------------------
-- Journals
--------------------------------------------------------------------------------
create table public.journals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  number text not null,
  fiscal_year_id uuid not null,
  effective_date date not null,
  narration text not null check (char_length(btrim(narration)) between 1 and 500),
  kind text not null check (kind in ('manual', 'opening_import', 'opening_adjustment', 'year_close', 'reversal')),
  adjustment_type text check (adjustment_type in ('stock', 'fixed_asset', 'other')),
  source_type text check (source_type ~ '^[a-z_]{2,40}$'),
  source_id uuid,
  reverses_id uuid,
  reversed_by_id uuid,
  idempotency_key uuid not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, fiscal_year_id) references public.fiscal_years (business_id, id),
  foreign key (business_id, reverses_id) references public.journals (business_id, id),
  foreign key (business_id, reversed_by_id) references public.journals (business_id, id),
  check ((kind = 'opening_adjustment') = (adjustment_type is not null))
);
create index journals_business_date_idx on public.journals (business_id, effective_date);

alter table public.fiscal_years
  add constraint fiscal_years_closing_journal_fk foreign key (business_id, closing_journal_id) references public.journals (business_id, id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  journal_id uuid not null,
  line_no integer not null check (line_no > 0),
  account_id uuid not null,
  debit_minor bigint not null default 0 check (debit_minor >= 0 and debit_minor <= 100000000000000),
  credit_minor bigint not null default 0 check (credit_minor >= 0 and credit_minor <= 100000000000000),
  description text check (char_length(description) <= 300),
  unique (journal_id, line_no),
  foreign key (business_id, journal_id) references public.journals (business_id, id),
  foreign key (business_id, account_id) references public.accounts (business_id, id),
  -- Exactly one side per line.
  check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0))
);
create index journal_lines_account_idx on public.journal_lines (business_id, account_id);
create index journal_lines_journal_idx on public.journal_lines (journal_id);

-- Every journal balances, checked at commit so all its lines are in.
create or replace function app.check_journal_balanced()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_dr bigint; v_cr bigint; v_n integer;
begin
  select coalesce(sum(debit_minor), 0), coalesce(sum(credit_minor), 0), count(*)
    into v_dr, v_cr, v_n from public.journal_lines where journal_id = new.journal_id;
  if v_n < 2 or v_dr <> v_cr or v_dr = 0 then
    raise exception 'A journal must have at least two lines and its debits must equal its credits.' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger journal_lines_balanced after insert on public.journal_lines
  deferrable initially deferred for each row execute function app.check_journal_balanced();

-- Posted journals are never edited or deleted. The only change allowed is recording which journal reversed it.
create or replace function app.guard_journal_lines_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Posted journals can''t be changed or deleted. Post a reversal instead.' using errcode = 'P0001';
end;
$$;

create or replace function app.guard_journal_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Posted journals can''t be deleted. Post a reversal instead.' using errcode = 'P0001';
  end if;
  if (old.reversed_by_id is not null)
     or (new.reversed_by_id is null)
     or (row(new.id, new.business_id, new.number, new.fiscal_year_id, new.effective_date, new.narration, new.kind,
             new.adjustment_type, new.source_type, new.source_id, new.reverses_id, new.idempotency_key, new.created_by, new.created_at)
         is distinct from
         row(old.id, old.business_id, old.number, old.fiscal_year_id, old.effective_date, old.narration, old.kind,
             old.adjustment_type, old.source_type, old.source_id, old.reverses_id, old.idempotency_key, old.created_by, old.created_at)) then
    raise exception 'Posted journals can''t be changed. Post a reversal instead.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger journals_immutable before update or delete on public.journals
  for each row execute function app.guard_journal_immutable();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function app.guard_journal_lines_immutable();

--------------------------------------------------------------------------------
-- Access: owners read; nobody writes directly.
--------------------------------------------------------------------------------
alter table public.books_settings enable row level security;
alter table public.accounts enable row level security;
alter table public.fiscal_years enable row level security;
alter table public.journals enable row level security;
alter table public.journal_lines enable row level security;
create policy "owners read books settings" on public.books_settings for select to authenticated using (app.is_owner(business_id));
create policy "owners read accounts" on public.accounts for select to authenticated using (app.is_owner(business_id));
create policy "owners read fiscal years" on public.fiscal_years for select to authenticated using (app.is_owner(business_id));
create policy "owners read journals" on public.journals for select to authenticated using (app.is_owner(business_id));
create policy "owners read journal lines" on public.journal_lines for select to authenticated using (app.is_owner(business_id));
revoke insert, update, delete, truncate on public.books_settings, public.accounts, public.fiscal_years, public.journals, public.journal_lines from authenticated, anon;
revoke all on public.books_settings, public.accounts, public.fiscal_years, public.journals, public.journal_lines from anon;
grant select on public.books_settings, public.accounts, public.fiscal_years, public.journals, public.journal_lines to authenticated;

--------------------------------------------------------------------------------
-- Internal helpers
--------------------------------------------------------------------------------
create or replace function app.require_owner_books(p_business_id uuid)
returns public.books_settings language plpgsql security definer set search_path = '' as $$
declare s public.books_settings;
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can work with the books.' using errcode = '42501';
  end if;
  select * into s from public.books_settings where business_id = p_business_id;
  if not found then
    raise exception 'Set up the books first.' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

-- Creates 12-month years after the last one until the given date is covered.
create or replace function app.ensure_fiscal_years(p_business_id uuid, p_through date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_last date;
begin
  select max(end_date) into v_last from public.fiscal_years where business_id = p_business_id;
  while v_last is not null and v_last < p_through loop
    insert into public.fiscal_years (business_id, start_date, end_date, kind)
    values (p_business_id, v_last + 1, (v_last + 1 + interval '1 year')::date - 1, 'live');
    v_last := (v_last + 1 + interval '1 year')::date - 1;
  end loop;
end;
$$;

-- The one place journals are written. Validates, numbers, and inserts header and lines in this transaction.
create or replace function app.post_journal(
  p_business_id uuid, p_date date, p_narration text, p_kind text, p_adjustment_type text, p_lines jsonb,
  p_idempotency_key uuid, p_reverses_id uuid default null, p_source_type text default null, p_source_id uuid default null,
  p_ignore_lock boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.books_settings;
  y public.fiscal_years;
  v_id uuid;
  v_n integer;
  v_dr bigint := 0;
  v_cr bigint := 0;
  v_count integer := 0;
  l record;
begin
  if p_idempotency_key is null then
    raise exception 'Missing request key. Refresh the page and try again.' using errcode = 'P0001';
  end if;
  select id into v_id from public.journals where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;

  -- Locking the settings row numbers journals in order and serialises postings per business.
  select * into s from public.books_settings where business_id = p_business_id for update;
  if not found then
    raise exception 'Set up the books first.' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'Choose the date.' using errcode = 'P0001';
  end if;
  if p_date < s.first_year_start then
    raise exception 'That date is before the books start (%).', to_char(s.first_year_start, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if p_date > (now() at time zone app.business_tz(p_business_id))::date + 31 then
    raise exception 'That date is too far in the future.' using errcode = 'P0001';
  end if;
  perform app.ensure_fiscal_years(p_business_id, p_date);
  select * into y from public.fiscal_years
    where business_id = p_business_id and p_date between start_date and end_date;
  if y.status = 'closed' and p_kind <> 'year_close' and not p_ignore_lock then
    raise exception 'The financial year ending % is closed.', to_char(y.end_date, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if not p_ignore_lock and s.locked_through is not null and p_date <= s.locked_through then
    raise exception 'The books are closed up to %. Choose a later date or reopen the period.', to_char(s.locked_through, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if p_kind in ('opening_import', 'opening_adjustment') and y.kind <> 'imported' then
    raise exception 'Imported figures and opening adjustments belong in an imported year.' using errcode = 'P0001';
  end if;
  if p_narration is null or char_length(btrim(p_narration)) = 0 then
    raise exception 'Say what this journal is for.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal needs at least two lines.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'A journal can have at most 500 lines.' using errcode = 'P0001';
  end if;

  update public.books_settings set next_journal_number = next_journal_number + 1 where business_id = p_business_id
    returning next_journal_number - 1 into v_n;
  insert into public.journals (business_id, number, fiscal_year_id, effective_date, narration, kind, adjustment_type,
    source_type, source_id, reverses_id, idempotency_key)
  values (p_business_id, 'JN-' || lpad(v_n::text, 5, '0'), y.id, p_date, btrim(p_narration), p_kind, p_adjustment_type,
    p_source_type, p_source_id, p_reverses_id, p_idempotency_key)
  returning id into v_id;

  for l in select value as v, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    if jsonb_typeof(l.v -> 'debit') is distinct from 'number' or jsonb_typeof(l.v -> 'credit') is distinct from 'number'
       or (l.v ->> 'debit')::numeric <> trunc((l.v ->> 'debit')::numeric)
       or (l.v ->> 'credit')::numeric <> trunc((l.v ->> 'credit')::numeric) then
      raise exception 'Line %: amounts must be whole kobo.', l.n using errcode = 'P0001';
    end if;
    if ((l.v ->> 'debit')::bigint > 0) = ((l.v ->> 'credit')::bigint > 0) or (l.v ->> 'debit')::bigint < 0 or (l.v ->> 'credit')::bigint < 0 then
      raise exception 'Line %: enter either a debit or a credit.', l.n using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.accounts a where a.id = (l.v ->> 'account_id')::uuid
                   and a.business_id = p_business_id and a.archived_at is null) then
      raise exception 'Line %: choose an account from the chart.', l.n using errcode = 'P0001';
    end if;
    insert into public.journal_lines (business_id, journal_id, line_no, account_id, debit_minor, credit_minor, description)
    values (p_business_id, v_id, l.n, (l.v ->> 'account_id')::uuid, (l.v ->> 'debit')::bigint, (l.v ->> 'credit')::bigint,
      nullif(btrim(l.v ->> 'description'), ''));
    v_dr := v_dr + (l.v ->> 'debit')::bigint;
    v_cr := v_cr + (l.v ->> 'credit')::bigint;
    v_count := v_count + 1;
  end loop;
  if v_dr <> v_cr then
    raise exception 'Debits (%) and credits (%) don''t match. The difference is %.',
      to_char(v_dr / 100.0, 'FM999,999,999,990.00'), to_char(v_cr / 100.0, 'FM999,999,999,990.00'),
      to_char(abs(v_dr - v_cr) / 100.0, 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;
revoke all on function app.post_journal from public, anon, authenticated;
revoke all on function app.require_owner_books from public, anon, authenticated;
revoke all on function app.ensure_fiscal_years from public, anon, authenticated;

--------------------------------------------------------------------------------
-- Chart of accounts template (Nigerian fashion business, IFRS for SMEs)
--------------------------------------------------------------------------------
create or replace function app.seed_chart(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts (business_id, code, name, account_group, system_key)
  select p_business_id, c.code, c.name, c.grp, c.sk from (values
    ('1000', 'Cash in hand', 'current_assets', 'cash'),
    ('1010', 'Business bank account', 'current_assets', 'bank_main'),
    ('1050', 'POS and transfer clearing', 'current_assets', 'clearing'),
    ('1100', 'Trade receivables', 'current_assets', 'receivables'),
    ('1150', 'Staff advances', 'current_assets', null),
    ('1160', 'Prepayments', 'current_assets', 'prepayments'),
    ('1170', 'VAT receivable (input VAT)', 'current_assets', 'vat_input'),
    ('1180', 'Due from directors', 'current_assets', 'due_from_directors'),
    ('1190', 'Share capital unpaid', 'current_assets', 'share_capital_unpaid'),
    ('1200', 'Inventory: raw materials', 'current_assets', 'inv_raw'),
    ('1210', 'Inventory: work in progress', 'current_assets', 'inv_wip'),
    ('1220', 'Inventory: finished goods', 'current_assets', 'inv_finished'),
    ('1230', 'Inventory: in quarantine', 'current_assets', 'inv_quarantine'),
    ('1500', 'Plant and machinery', 'non_current_assets', 'ppe_machinery'),
    ('1505', 'Plant and machinery: accumulated depreciation', 'non_current_assets', 'ppe_machinery_dep'),
    ('1510', 'Furniture and fittings', 'non_current_assets', 'ppe_furniture'),
    ('1515', 'Furniture and fittings: accumulated depreciation', 'non_current_assets', 'ppe_furniture_dep'),
    ('1520', 'Computers and phones', 'non_current_assets', 'ppe_computers'),
    ('1525', 'Computers and phones: accumulated depreciation', 'non_current_assets', 'ppe_computers_dep'),
    ('1530', 'Generators and equipment', 'non_current_assets', 'ppe_equipment'),
    ('1535', 'Generators and equipment: accumulated depreciation', 'non_current_assets', 'ppe_equipment_dep'),
    ('1540', 'Motor vehicles', 'non_current_assets', 'ppe_vehicles'),
    ('1545', 'Motor vehicles: accumulated depreciation', 'non_current_assets', 'ppe_vehicles_dep'),
    ('2000', 'Trade payables', 'current_liabilities', 'payables'),
    ('2010', 'Goods received not invoiced', 'current_liabilities', 'grni'),
    ('2020', 'Maker fees payable', 'current_liabilities', 'maker_payables'),
    ('2030', 'Customer deposits', 'current_liabilities', 'customer_deposits'),
    ('2100', 'VAT payable (output VAT)', 'current_liabilities', 'vat_output'),
    ('2110', 'PAYE payable', 'current_liabilities', 'paye'),
    ('2120', 'Withholding tax payable', 'current_liabilities', 'wht'),
    ('2130', 'Pension payable', 'current_liabilities', 'pension'),
    ('2140', 'Company income tax payable', 'current_liabilities', 'cit'),
    ('2150', 'Accruals', 'current_liabilities', 'accruals'),
    ('2160', 'Net pay payable', 'current_liabilities', 'net_pay'),
    ('2200', 'Director''s current account 1', 'current_liabilities', 'director_1'),
    ('2210', 'Director''s current account 2', 'current_liabilities', 'director_2'),
    ('2300', 'Short-term loans', 'current_liabilities', 'loans_short'),
    ('2500', 'Long-term loans', 'non_current_liabilities', 'loans_long'),
    ('3000', 'Share capital', 'equity', 'share_capital'),
    ('3100', 'Business-name capital taken over', 'equity', 'bn_capital'),
    ('3200', 'Retained earnings', 'equity', 'retained_earnings'),
    ('3300', 'Opening balance equity', 'equity', 'opening_equity'),
    ('3400', 'Dividends', 'equity', 'dividends'),
    ('4000', 'Sales: clothing', 'income', 'sales_clothing'),
    ('4010', 'Sales: shoes', 'income', 'sales_shoes'),
    ('4020', 'Sales: bags', 'income', 'sales_bags'),
    ('4030', 'Sales: other', 'income', 'sales_other'),
    ('4100', 'Repair income', 'income', 'repair_income'),
    ('4200', 'Delivery charges', 'income', 'delivery_income'),
    ('4300', 'Discounts given', 'income', 'discounts'),
    ('4310', 'Sales returns', 'income', 'sales_returns'),
    ('4900', 'Other income', 'other_income', 'other_income'),
    ('5000', 'Cost of goods sold', 'cost_of_sales', 'cogs'),
    ('5010', 'Materials and fabrics', 'cost_of_sales', 'materials'),
    ('5020', 'Production labour and maker fees', 'cost_of_sales', 'production_labour'),
    ('5030', 'Printing, labels and packaging', 'cost_of_sales', 'packaging'),
    ('5040', 'Production losses and rework', 'cost_of_sales', 'production_losses'),
    ('5050', 'Stock write-offs and count differences', 'cost_of_sales', 'stock_writeoffs'),
    ('5060', 'Inbound delivery', 'cost_of_sales', 'inbound_delivery'),
    ('5090', 'Opening and closing stock adjustment', 'cost_of_sales', 'stock_change'),
    ('6000', 'Salaries and wages', 'operating_expenses', 'salaries'),
    ('6010', 'Contract staff pay', 'operating_expenses', 'contract_pay'),
    ('6020', 'Pension (employer)', 'operating_expenses', 'pension_expense'),
    ('6030', 'Staff welfare', 'operating_expenses', null),
    ('6040', 'Rent', 'operating_expenses', 'rent'),
    ('6050', 'Electricity and diesel', 'operating_expenses', null),
    ('6060', 'Internet, data and phone', 'operating_expenses', null),
    ('6070', 'Delivery and logistics', 'operating_expenses', 'delivery_out'),
    ('6080', 'Advertising', 'operating_expenses', null),
    ('6090', 'Marketing and events', 'operating_expenses', null),
    ('6100', 'Social media management', 'operating_expenses', null),
    ('6110', 'Photography and creatives', 'operating_expenses', null),
    ('6120', 'Cleaning', 'operating_expenses', null),
    ('6130', 'Bank charges', 'operating_expenses', 'bank_charges'),
    ('6140', 'Repairs and maintenance', 'operating_expenses', null),
    ('6150', 'Professional and registration fees', 'operating_expenses', null),
    ('6160', 'IT and subscriptions', 'operating_expenses', null),
    ('6170', 'Training', 'operating_expenses', null),
    ('6180', 'Depreciation', 'operating_expenses', 'depreciation'),
    ('6190', 'PAYE and withholding tax borne by the company', 'operating_expenses', 'tax_borne'),
    ('6900', 'Office and sundry', 'operating_expenses', null),
    ('7000', 'Interest', 'finance_costs', 'interest'),
    ('7900', 'Income tax expense', 'tax', 'income_tax'),
    ('9999', 'Rounding', 'operating_expenses', 'rounding')
  ) as c(code, name, grp, sk);

  -- Pair each accumulated depreciation account with its asset.
  update public.accounts d set contra_of = a.id
  from public.accounts a
  where d.business_id = p_business_id and a.business_id = p_business_id
    and d.system_key like 'ppe\_%\_dep' and a.system_key = left(d.system_key, -4);
end;
$$;
revoke all on function app.seed_chart from public, anon, authenticated;

--------------------------------------------------------------------------------
-- Owner functions
--------------------------------------------------------------------------------

-- Turn the books on: settings, the chart of accounts and the financial years up to today.
-- The first year can be "imported" (figures from earlier records, then opening adjustments).
create or replace function public.setup_books(
  p_business_id uuid, p_first_year_start date, p_first_year_imported boolean, p_incorporation_date date,
  p_vat_registered boolean, p_vat_rate numeric
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can set up the books.' using errcode = '42501';
  end if;
  if exists (select 1 from public.books_settings where business_id = p_business_id) then
    raise exception 'The books are already set up.' using errcode = 'P0001';
  end if;
  if p_first_year_start is null or extract(day from p_first_year_start) <> 1 then
    raise exception 'The first financial year starts on the 1st of a month.' using errcode = 'P0001';
  end if;
  if p_first_year_start > v_today then
    raise exception 'The first financial year can''t start in the future.' using errcode = 'P0001';
  end if;
  if p_first_year_start < v_today - interval '6 years' then
    raise exception 'Start no more than six years back.' using errcode = 'P0001';
  end if;
  if coalesce(p_vat_registered, false) and p_vat_rate is null then
    raise exception 'Enter the VAT rate.' using errcode = 'P0001';
  end if;
  if p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100) then
    raise exception 'The VAT rate must be between 0 and 100%%.' using errcode = 'P0001';
  end if;
  insert into public.books_settings (business_id, first_year_start, incorporation_date, vat_registered, vat_rate)
  values (p_business_id, p_first_year_start, p_incorporation_date, coalesce(p_vat_registered, false),
    case when coalesce(p_vat_registered, false) then p_vat_rate end);
  perform app.seed_chart(p_business_id);
  insert into public.fiscal_years (business_id, start_date, end_date, kind)
  values (p_business_id, p_first_year_start, (p_first_year_start + interval '1 year')::date - 1,
    case when coalesce(p_first_year_imported, false) then 'imported' else 'live' end);
  perform app.ensure_fiscal_years(p_business_id, v_today);
end;
$$;

create or replace function public.update_books_settings(
  p_business_id uuid, p_incorporation_date date, p_vat_registered boolean, p_vat_rate numeric
)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner_books(p_business_id);
  if coalesce(p_vat_registered, false) and p_vat_rate is null then
    raise exception 'Enter the VAT rate.' using errcode = 'P0001';
  end if;
  if p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100) then
    raise exception 'The VAT rate must be between 0 and 100%%.' using errcode = 'P0001';
  end if;
  update public.books_settings set incorporation_date = p_incorporation_date,
    vat_registered = coalesce(p_vat_registered, false),
    vat_rate = case when coalesce(p_vat_registered, false) then p_vat_rate end
  where business_id = p_business_id;
end;
$$;

create or replace function public.create_account(p_business_id uuid, p_code text, p_name text, p_group text, p_contra_of uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_owner_books(p_business_id);
  if p_code is null or p_code !~ '^[0-9]{3,6}$' then
    raise exception 'The code is 3 to 6 digits, e.g. 6210.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.accounts where business_id = p_business_id and code = p_code) then
    raise exception 'Another account already uses code %.', p_code using errcode = 'P0001';
  end if;
  if p_group is null or p_group not in ('current_assets', 'non_current_assets', 'current_liabilities', 'non_current_liabilities',
      'equity', 'income', 'other_income', 'cost_of_sales', 'operating_expenses', 'finance_costs', 'tax') then
    raise exception 'Choose where the account belongs.' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Give the account a name.' using errcode = 'P0001';
  end if;
  if p_contra_of is not null and not exists (select 1 from public.accounts where id = p_contra_of and business_id = p_business_id) then
    raise exception 'Choose the asset account this one belongs to.' using errcode = 'P0001';
  end if;
  insert into public.accounts (business_id, code, name, account_group, contra_of)
  values (p_business_id, p_code, btrim(p_name), p_group, p_contra_of)
  returning id into v_id;
  return v_id;
end;
$$;

-- Rename (any account) or recode (accounts the app doesn't post to automatically).
create or replace function public.update_account(p_account_id uuid, p_code text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account_id for update;
  if not found then raise exception 'That account no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_books(a.business_id);
  if p_code is distinct from a.code then
    if a.system_key is not null then
      raise exception 'The app posts to this account automatically, so its code stays %. You can rename it.', a.code using errcode = 'P0001';
    end if;
    if p_code is null or p_code !~ '^[0-9]{3,6}$' then
      raise exception 'The code is 3 to 6 digits, e.g. 6210.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.accounts where business_id = a.business_id and code = p_code) then
      raise exception 'Another account already uses code %.', p_code using errcode = 'P0001';
    end if;
  end if;
  update public.accounts set code = p_code, name = btrim(p_name) where id = p_account_id;
end;
$$;

create or replace function public.set_account_archived(p_account_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.accounts;
  v_balance bigint;
begin
  select * into a from public.accounts where id = p_account_id for update;
  if not found then raise exception 'That account no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_books(a.business_id);
  if p_archived then
    if a.system_key is not null then
      raise exception 'The app posts to this account automatically, so it can''t be archived.' using errcode = 'P0001';
    end if;
    select coalesce(sum(debit_minor - credit_minor), 0) into v_balance from public.journal_lines where account_id = p_account_id;
    if v_balance <> 0 then
      raise exception 'This account still has a balance. Move it to another account first.' using errcode = 'P0001';
    end if;
  end if;
  update public.accounts set archived_at = case when p_archived then now() end where id = p_account_id;
end;
$$;

-- Manual journals, imported trial balances and opening adjustments (owners).
create or replace function public.post_manual_journal(
  p_business_id uuid, p_date date, p_narration text, p_kind text, p_adjustment_type text, p_lines jsonb, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner_books(p_business_id);
  if p_kind not in ('manual', 'opening_import', 'opening_adjustment') then
    raise exception 'Choose what kind of journal this is.' using errcode = 'P0001';
  end if;
  return app.post_journal(p_business_id, p_date, p_narration, p_kind,
    case when p_kind = 'opening_adjustment' then coalesce(p_adjustment_type, 'other') end,
    p_lines, p_idempotency_key);
end;
$$;

-- Mirror a journal (debits become credits). Both stay in the books.
create or replace function public.reverse_journal(p_journal_id uuid, p_date date, p_reason text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  j public.journals;
  v_lines jsonb;
  v_id uuid;
begin
  select * into j from public.journals where id = p_journal_id for update;
  if not found then raise exception 'That journal no longer exists.' using errcode = 'P0001'; end if;
  perform app.require_owner_books(j.business_id);
  -- A repeated request returns the reversal already made.
  select id into v_id from public.journals where business_id = j.business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if j.reversed_by_id is not null then
    raise exception 'This journal has already been reversed.' using errcode = 'P0001';
  end if;
  if j.kind in ('reversal', 'year_close') then
    raise exception 'This journal can''t be reversed here.%', case when j.kind = 'year_close' then ' Reopen the year instead.' else ' Post a new journal instead.' end using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'Give a reason for the reversal.' using errcode = 'P0001';
  end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit_minor, 'credit', debit_minor,
    'description', description) order by line_no) into v_lines
  from public.journal_lines where journal_id = p_journal_id;
  v_id := app.post_journal(j.business_id, coalesce(p_date, j.effective_date),
    left('Reversal of ' || j.number || ': ' || btrim(p_reason), 500), 'reversal', null, v_lines, p_idempotency_key, j.id);
  update public.journals set reversed_by_id = v_id where id = j.id;
  return v_id;
end;
$$;

-- Month close: no postings dated on or before this date. Can't reopen inside a closed year.
create or replace function public.set_books_lock(p_business_id uuid, p_locked_through date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_closed_end date;
begin
  perform app.require_owner_books(p_business_id);
  select max(end_date) into v_closed_end from public.fiscal_years where business_id = p_business_id and status = 'closed';
  if v_closed_end is not null and (p_locked_through is null or p_locked_through < v_closed_end) then
    raise exception 'The year ending % is closed. Reopen the year to change dates in it.', to_char(v_closed_end, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if p_locked_through > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'You can''t close a period that hasn''t ended.' using errcode = 'P0001';
  end if;
  update public.books_settings set locked_through = p_locked_through where business_id = p_business_id;
end;
$$;

-- Year-end close: income and expenses go to retained earnings; the year is locked.
create or replace function public.close_fiscal_year(p_business_id uuid, p_year_id uuid, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  y public.fiscal_years;
  v_re uuid;
  v_lines jsonb;
  v_net bigint;
  v_journal uuid;
begin
  perform app.require_owner_books(p_business_id);
  -- Serialise with postings.
  perform 1 from public.books_settings where business_id = p_business_id for update;
  select * into y from public.fiscal_years where id = p_year_id and business_id = p_business_id for update;
  if not found then raise exception 'That financial year doesn''t exist.' using errcode = 'P0001'; end if;
  if y.status = 'closed' then
    return y.closing_journal_id;
  end if;
  if exists (select 1 from public.fiscal_years where business_id = p_business_id and start_date < y.start_date and status = 'open') then
    raise exception 'Close the earlier financial year first.' using errcode = 'P0001';
  end if;
  if y.end_date >= (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'This financial year hasn''t ended yet.' using errcode = 'P0001';
  end if;
  select id into v_re from public.accounts where business_id = p_business_id and system_key = 'retained_earnings';

  -- One line per income/expense account with a balance for the year, the opposite way round.
  select jsonb_agg(jsonb_build_object('account_id', b.account_id,
           'debit', case when b.bal < 0 then -b.bal else 0 end,
           'credit', case when b.bal > 0 then b.bal else 0 end,
           'description', 'Year-end close') order by b.code),
         coalesce(sum(b.bal), 0)
    into v_lines, v_net
  from (
    select l.account_id, a.code, sum(l.debit_minor - l.credit_minor) as bal
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    join public.accounts a on a.id = l.account_id
    where l.business_id = p_business_id and a.type in ('income', 'expense')
      and j.effective_date between y.start_date and y.end_date and j.kind <> 'year_close'
    group by l.account_id, a.code
    having sum(l.debit_minor - l.credit_minor) <> 0
  ) b;

  if v_lines is not null then
    -- Net debit balance = a loss, which reduces retained earnings.
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_re,
      'debit', case when v_net > 0 then v_net else 0 end,
      'credit', case when v_net < 0 then -v_net else 0 end,
      'description', case when v_net > 0 then 'Loss for the year' else 'Profit for the year' end));
    if v_net = 0 then
      v_lines := (select jsonb_agg(e) from jsonb_array_elements(v_lines) e where e ->> 'account_id' <> v_re::text);
    end if;
    v_journal := app.post_journal(p_business_id, y.end_date,
      'Year-end close: income and expenses for the year to ' || to_char(y.end_date, 'DD Mon YYYY') || ' moved to retained earnings',
      'year_close', null, v_lines, p_idempotency_key, null, 'fiscal_year', y.id, true);
  end if;

  update public.fiscal_years set status = 'closed', closed_at = now(), closed_by = auth.uid(), closing_journal_id = v_journal
  where id = y.id;
  update public.books_settings set locked_through = greatest(coalesce(locked_through, y.end_date), y.end_date)
  where business_id = p_business_id;
  perform app.ensure_fiscal_years(p_business_id, y.end_date + 1);
  return v_journal;
end;
$$;

-- Reopen the most recent closed year (owners): reverses the closing journal and unlocks the year.
create or replace function public.reopen_fiscal_year(p_business_id uuid, p_year_id uuid, p_reason text, p_idempotency_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  y public.fiscal_years;
  v_lines jsonb;
  v_rev uuid;
  v_prev_end date;
begin
  perform app.require_owner_books(p_business_id);
  perform 1 from public.books_settings where business_id = p_business_id for update;
  select * into y from public.fiscal_years where id = p_year_id and business_id = p_business_id for update;
  if not found or y.status <> 'closed' then
    raise exception 'That year isn''t closed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fiscal_years where business_id = p_business_id and start_date > y.start_date and status = 'closed') then
    raise exception 'Reopen the later year first.' using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'Give a reason for reopening the year.' using errcode = 'P0001';
  end if;
  if y.closing_journal_id is not null then
    select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit_minor, 'credit', debit_minor,
      'description', description) order by line_no) into v_lines
    from public.journal_lines where journal_id = y.closing_journal_id;
    v_rev := app.post_journal(p_business_id, y.end_date,
      left('Year reopened: ' || btrim(p_reason), 500), 'reversal', null, v_lines, p_idempotency_key,
      y.closing_journal_id, 'fiscal_year', y.id, true);
    update public.journals set reversed_by_id = v_rev where id = y.closing_journal_id;
  end if;
  update public.fiscal_years set status = 'open', closed_at = null, closed_by = null, closing_journal_id = null where id = y.id;
  select max(end_date) into v_prev_end from public.fiscal_years where business_id = p_business_id and status = 'closed';
  update public.books_settings set locked_through = v_prev_end
  where business_id = p_business_id and (locked_through is null or locked_through >= y.start_date);
end;
$$;

--------------------------------------------------------------------------------
-- Reports (owners)
--------------------------------------------------------------------------------

-- Balances per account (debit positive). Movements in the range are split into imported figures,
-- opening adjustments and everything else; year-end closing journals inside the range are left out,
-- so income and expenses show for the period. The opening column is everything before p_from.
create or replace function public.trial_balance(p_business_id uuid, p_from date, p_to date)
returns table (
  account_id uuid, code text, name text, account_group text, account_type text, system_key text, archived boolean,
  opening_minor bigint, imported_minor bigint, adjustments_minor bigint, other_minor bigint, closing_minor bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can see the books.' using errcode = '42501';
  end if;
  return query
  with m as (
    select l.account_id,
      sum(case when j.effective_date < p_from then l.debit_minor - l.credit_minor else 0 end) as opening,
      sum(case when j.effective_date >= p_from and j.kind = 'opening_import' then l.debit_minor - l.credit_minor else 0 end) as imp,
      sum(case when j.effective_date >= p_from and j.kind = 'opening_adjustment' then l.debit_minor - l.credit_minor else 0 end) as adj,
      sum(case when j.effective_date >= p_from and j.kind not in ('opening_import', 'opening_adjustment', 'year_close')
               then l.debit_minor - l.credit_minor else 0 end) as oth
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    where l.business_id = p_business_id and j.effective_date <= p_to
    group by l.account_id
  )
  select a.id, a.code, a.name, a.account_group, a.type, a.system_key, a.archived_at is not null,
    coalesce(m.opening, 0)::bigint, coalesce(m.imp, 0)::bigint, coalesce(m.adj, 0)::bigint, coalesce(m.oth, 0)::bigint,
    (coalesce(m.opening, 0) + coalesce(m.imp, 0) + coalesce(m.adj, 0) + coalesce(m.oth, 0))::bigint
  from public.accounts a
  left join m on m.account_id = a.id
  where a.business_id = p_business_id and (a.archived_at is null or m.account_id is not null)
  order by a.code;
end;
$$;

-- One account's lines in a date range with a running balance (debit positive); first row is the opening balance.
create or replace function public.account_ledger(p_account_id uuid, p_from date, p_to date)
returns table (
  journal_id uuid, number text, effective_date date, kind text, narration text, description text,
  debit_minor bigint, credit_minor bigint, balance_minor bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_business uuid;
  v_opening bigint;
begin
  select business_id into v_business from public.accounts where id = p_account_id;
  if v_business is null or not app.is_owner(v_business) then
    raise exception 'Only owners can see the books.' using errcode = '42501';
  end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_opening
  from public.journal_lines l join public.journals j on j.id = l.journal_id
  where l.account_id = p_account_id and j.effective_date < p_from;
  return query
  select null::uuid, null::text, p_from, 'opening'::text, 'Opening balance'::text, null::text, null::bigint, null::bigint, v_opening
  union all
  select * from (
    select j.id, j.number, j.effective_date, j.kind, j.narration, l.description, l.debit_minor, l.credit_minor,
      (v_opening + sum(l.debit_minor - l.credit_minor) over (order by j.effective_date, j.number, l.line_no))::bigint as bal
    from public.journal_lines l join public.journals j on j.id = l.journal_id
    where l.account_id = p_account_id and j.effective_date between p_from and p_to
    order by j.effective_date, j.number, l.line_no
  ) t;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['setup_books', 'update_books_settings', 'create_account', 'update_account', 'set_account_archived',
    'post_manual_journal', 'reverse_journal', 'set_books_lock', 'close_fiscal_year', 'reopen_fiscal_year',
    'trial_balance', 'account_ledger'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
