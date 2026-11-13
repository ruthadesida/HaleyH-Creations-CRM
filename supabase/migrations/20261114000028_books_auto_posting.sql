-- Books Phase B: the app's own records post their journals automatically (docs/ACCOUNTING.md).
-- * Stock documents (receipts, issues, completions, dispatch and return costs, write-offs, counts, quarantine moves)
-- * Customer and repair payments, refunds and voids; revenue at dispatch and repair collection; returns
-- * Supplier bills and payments, maker labour and pay
-- Each source posts once (a key derived from the source), from the first live financial year onwards.
-- A posting problem never blocks the operation: it's recorded in books_posting_problems and retried.

--------------------------------------------------------------------------------
-- Schema
--------------------------------------------------------------------------------
alter table public.journals drop constraint journals_kind_check;
alter table public.journals add constraint journals_kind_check
  check (kind in ('manual', 'opening_import', 'opening_adjustment', 'year_close', 'reversal', 'auto'));
alter table public.journals
  add column source_part text check (source_part ~ '^[a-z0-9_:.-]{1,60}$'),
  -- The customer, supplier or job the journal belongs to (sub-ledger), e.g. ('order', id).
  add column ref_type text check (ref_type in ('order', 'repair', 'supplier', 'maker', 'job')),
  add column ref_id uuid;
create index journals_source_idx on public.journals (business_id, source_type, source_id);
create index journals_ref_idx on public.journals (business_id, ref_type, ref_id);

alter table public.books_settings
  -- Sales and repairs carry VAT (included in the price) from this date; null = not charging VAT yet.
  add column vat_charged_from date;

-- Which account each payment method lands in.
create table public.books_payment_accounts (
  business_id uuid not null references public.businesses (id),
  method public.payment_method not null,
  account_id uuid not null,
  primary key (business_id, method),
  foreign key (business_id, account_id) references public.accounts (business_id, id)
);
alter table public.books_payment_accounts enable row level security;
create policy "owners read payment accounts" on public.books_payment_accounts for select to authenticated using (app.is_owner(business_id));
revoke all on public.books_payment_accounts from anon, authenticated;
grant select on public.books_payment_accounts to authenticated;

-- Records the app couldn't post (shown to owners with a retry), never silently dropped.
create table public.books_posting_problems (
  business_id uuid not null references public.businesses (id),
  source_type text not null,
  source_id uuid not null,
  message text not null,
  first_seen_at timestamptz not null default now(),
  last_tried_at timestamptz not null default now(),
  primary key (business_id, source_type, source_id)
);
alter table public.books_posting_problems enable row level security;
create policy "owners read posting problems" on public.books_posting_problems for select to authenticated using (app.is_owner(business_id));
revoke all on public.books_posting_problems from anon, authenticated;
grant select on public.books_posting_problems to authenticated;

-- Immutability now also covers the new columns.
create or replace function app.guard_journal_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Posted journals can''t be deleted. Post a reversal instead.' using errcode = 'P0001';
  end if;
  if (old.reversed_by_id is not null)
     or (new.reversed_by_id is null)
     or (row(new.id, new.business_id, new.number, new.fiscal_year_id, new.effective_date, new.narration, new.kind,
             new.adjustment_type, new.source_type, new.source_id, new.reverses_id, new.idempotency_key, new.created_by, new.created_at,
             new.source_part, new.ref_type, new.ref_id)
         is distinct from
         row(old.id, old.business_id, old.number, old.fiscal_year_id, old.effective_date, old.narration, old.kind,
             old.adjustment_type, old.source_type, old.source_id, old.reverses_id, old.idempotency_key, old.created_by, old.created_at,
             old.source_part, old.ref_type, old.ref_id)) then
    raise exception 'Posted journals can''t be changed. Post a reversal instead.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

--------------------------------------------------------------------------------
-- Posting core: same checks as before, plus the source part and sub-ledger reference.
--------------------------------------------------------------------------------
drop function if exists app.post_journal(uuid, date, text, text, text, jsonb, uuid, uuid, text, uuid, boolean);
create or replace function app.post_journal(
  p_business_id uuid, p_date date, p_narration text, p_kind text, p_adjustment_type text, p_lines jsonb,
  p_idempotency_key uuid, p_reverses_id uuid default null, p_source_type text default null, p_source_id uuid default null,
  p_ignore_lock boolean default false, p_source_part text default null, p_ref_type text default null, p_ref_id uuid default null
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
  v_debit numeric;
  v_credit numeric;
  l record;
begin
  if p_idempotency_key is null then
    raise exception 'Missing request key. Refresh the page and try again.' using errcode = 'P0001';
  end if;
  select id into v_id from public.journals where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  select * into s from public.books_settings where business_id = p_business_id for update;
  if not found then
    raise exception 'Set up the books first.' using errcode = 'P0001';
  end if;
  select id into v_id from public.journals where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;

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
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal needs at least two lines.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'A journal can have at most 500 lines.' using errcode = 'P0001';
  end if;

  update public.books_settings set next_journal_number = next_journal_number + 1 where business_id = p_business_id
    returning next_journal_number - 1 into v_n;
  insert into public.journals (business_id, number, fiscal_year_id, effective_date, narration, kind, adjustment_type,
    source_type, source_id, reverses_id, idempotency_key, source_part, ref_type, ref_id)
  values (p_business_id, 'JN-' || lpad(v_n::text, 5, '0'), y.id, p_date, left(btrim(p_narration), 500), p_kind, p_adjustment_type,
    p_source_type, p_source_id, p_reverses_id, p_idempotency_key, p_source_part, p_ref_type, p_ref_id)
  returning id into v_id;

  for l in select value as v, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    if jsonb_typeof(l.v) <> 'object' or jsonb_typeof(l.v -> 'debit') is distinct from 'number' or jsonb_typeof(l.v -> 'credit') is distinct from 'number' then
      raise exception 'Line %: amounts must be numbers.', l.n using errcode = 'P0001';
    end if;
    v_debit := (l.v ->> 'debit')::numeric;
    v_credit := (l.v ->> 'credit')::numeric;
    if v_debit <> trunc(v_debit) or v_credit <> trunc(v_credit) then
      raise exception 'Line %: amounts must be whole kobo.', l.n using errcode = 'P0001';
    end if;
    if v_debit < 0 or v_credit < 0 or (v_debit > 0) = (v_credit > 0) then
      raise exception 'Line %: enter either a debit or a credit.', l.n using errcode = 'P0001';
    end if;
    if v_debit > 100000000000000 or v_credit > 100000000000000 then
      raise exception 'Line %: that amount is too large.', l.n using errcode = 'P0001';
    end if;
    if coalesce(l.v ->> 'account_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.accounts a where a.id = (l.v ->> 'account_id')::uuid
                      and a.business_id = p_business_id and a.archived_at is null) then
      raise exception 'Line %: choose an account from the chart.', l.n using errcode = 'P0001';
    end if;
    if l.v ? 'description' and jsonb_typeof(l.v -> 'description') not in ('string', 'null') then
      raise exception 'Line %: the note must be text.', l.n using errcode = 'P0001';
    end if;
    insert into public.journal_lines (business_id, journal_id, line_no, account_id, debit_minor, credit_minor, description)
    values (p_business_id, v_id, l.n, (l.v ->> 'account_id')::uuid, v_debit::bigint, v_credit::bigint,
      left(nullif(btrim(l.v ->> 'description'), ''), 300));
    v_dr := v_dr + v_debit::bigint;
    v_cr := v_cr + v_credit::bigint;
    v_count := v_count + 1;
  end loop;
  if v_count < 2 then
    raise exception 'A journal needs at least two lines.' using errcode = 'P0001';
  end if;
  if v_dr <> v_cr then
    raise exception 'Debits (%) and credits (%) don''t match. The difference is %.',
      to_char(v_dr / 100.0, 'FM999,999,999,990.00'), to_char(v_cr / 100.0, 'FM999,999,999,990.00'),
      to_char(abs(v_dr - v_cr) / 100.0, 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;
revoke all on function app.post_journal from public, anon, authenticated;

--------------------------------------------------------------------------------
-- Automatic posting helpers
--------------------------------------------------------------------------------

-- Records dated before the first live year are covered by imported figures; null when the books aren't set up.
create or replace function app.books_auto_from(p_business_id uuid)
returns date language sql stable security definer set search_path = '' as $$
  select min(y.start_date) from public.fiscal_years y
  join public.books_settings s on s.business_id = y.business_id
  where y.business_id = p_business_id and y.kind = 'live'
$$;

-- A record dated in a closed period posts on the first open day instead (the narration keeps the real date).
create or replace function app.books_open_date(p_business_id uuid, p_date date)
returns date language sql stable security definer set search_path = '' as $$
  select greatest(p_date, coalesce(s.locked_through + 1, p_date),
    coalesce((select max(end_date) + 1 from public.fiscal_years where business_id = p_business_id and status = 'closed'), p_date))
  from public.books_settings s where s.business_id = p_business_id
$$;

create or replace function app.books_key(p_source_type text, p_source_id uuid, p_part text)
returns uuid language sql immutable set search_path = '' as $$
  select md5('books-auto:' || p_source_type || ':' || p_source_id::text || ':' || p_part)::uuid
$$;

create or replace function app.books_account(p_business_id uuid, p_key text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.accounts where business_id = p_business_id and system_key = p_key and archived_at is null;
  if v_id is null then
    raise exception 'The chart has no active account for "%". Check the chart of accounts.', p_key using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

create or replace function app.books_payment_account(p_business_id uuid, p_method public.payment_method)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select pa.account_id from public.books_payment_accounts pa join public.accounts a on a.id = pa.account_id
      where pa.business_id = p_business_id and pa.method = p_method and a.archived_at is null),
    app.books_account(p_business_id, case p_method when 'cash' then 'cash' when 'bank_transfer' then 'bank_main'
      when 'other' then 'bank_main' else 'clearing' end))
$$;

-- One line: amount > 0 is a debit, < 0 a credit. Either an account id or a system key.
create or replace function app.books_line(p_business_id uuid, p_account text, p_amount bigint, p_description text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'account_id', case when p_account ~* '^[0-9a-f-]{36}$' then p_account else app.books_account(p_business_id, p_account)::text end,
    'debit', greatest(p_amount, 0), 'credit', greatest(-p_amount, 0), 'description', p_description)
$$;

-- Posts an automatic journal for a source, once. Lines with a zero amount are dropped.
-- Returns null when nothing is due (books not set up, record before the live years, nothing to post).
create or replace function app.books_auto_post(
  p_business_id uuid, p_source_type text, p_source_id uuid, p_part text, p_date date, p_narration text, p_lines jsonb,
  p_ref_type text default null, p_ref_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_from date := app.books_auto_from(p_business_id);
  v_date date;
  v_lines jsonb;
  v_narr text := p_narration;
begin
  if v_from is null or p_date is null or p_date < v_from then return null; end if;
  select jsonb_agg(e) into v_lines from jsonb_array_elements(p_lines) e
    where (e ->> 'debit')::bigint <> 0 or (e ->> 'credit')::bigint <> 0;
  if v_lines is null or jsonb_array_length(v_lines) < 2 then return null; end if;
  v_date := app.books_open_date(p_business_id, p_date);
  if v_date <> p_date then
    v_narr := v_narr || ' (dated ' || to_char(p_date, 'DD Mon YYYY') || ', posted after the books were closed)';
  end if;
  return app.post_journal(p_business_id, v_date, v_narr, 'auto', null, v_lines,
    app.books_key(p_source_type, p_source_id, p_part), null, p_source_type, p_source_id, false, p_part, p_ref_type, p_ref_id);
end;
$$;

-- Cancels a source's automatic journal (e.g. a voided payment) with a mirror journal, once.
create or replace function app.books_auto_reverse(p_business_id uuid, p_source_type text, p_source_id uuid, p_part text, p_date date, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  j public.journals;
  v_lines jsonb;
  v_id uuid;
  v_date date;
begin
  select * into j from public.journals
    where business_id = p_business_id and idempotency_key = app.books_key(p_source_type, p_source_id, p_part) for update;
  if not found or j.reversed_by_id is not null then return j.reversed_by_id; end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit_minor, 'credit', debit_minor, 'description', description) order by line_no)
    into v_lines from public.journal_lines where journal_id = j.id;
  v_date := app.books_open_date(p_business_id, greatest(coalesce(p_date, j.effective_date), j.effective_date));
  v_id := app.post_journal(p_business_id, v_date, left('Reversal of ' || j.number || ': ' || p_reason, 500), 'reversal', null, v_lines,
    app.books_key(p_source_type, p_source_id, p_part || ':void'), j.id, p_source_type, p_source_id, false, left(p_part || ':void', 60), j.ref_type, j.ref_id);
  update public.journals set reversed_by_id = v_id where id = j.id and reversed_by_id is null;
  return v_id;
end;
$$;

-- What a customer (order or repair) has paid in excess of what's been recognised (positive = deposit held,
-- negative = owed to the business), as posted in the books.
create or replace function app.books_customer_position(p_business_id uuid, p_ref_type text, p_ref_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id
  join public.accounts a on a.id = l.account_id
  where j.business_id = p_business_id and j.ref_type = p_ref_type and j.ref_id = p_ref_id
    and a.system_key in ('receivables', 'customer_deposits')
$$;

-- Lines moving a customer's position by p_change (+ = they paid or were credited, − = revenue recognised or refunded),
-- split between deposits (money held) and receivables (money owed).
create or replace function app.books_position_lines(p_business_id uuid, p_old bigint, p_change bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_array(
    app.books_line(p_business_id, 'receivables', greatest(-(p_old + p_change), 0) - greatest(-p_old, 0)),
    app.books_line(p_business_id, 'customer_deposits', -(greatest(p_old + p_change, 0) - greatest(p_old, 0))))
$$;

-- Splits VAT out of an amount that includes it, when the business charges VAT on that date.
create or replace function app.books_vat_rate(p_business_id uuid, p_date date)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when s.vat_registered and s.vat_rate > 0 and s.vat_charged_from is not null and p_date >= s.vat_charged_from
    then s.vat_rate else 0 end
  from public.books_settings s where s.business_id = p_business_id
$$;

create or replace function app.books_net_of_vat(p_amount bigint, p_rate numeric)
returns bigint language sql immutable set search_path = '' as $$
  select case when coalesce(p_rate, 0) = 0 then p_amount else round(p_amount * 100 / (100 + p_rate))::bigint end
$$;

--------------------------------------------------------------------------------
-- Handlers, one per kind of source. Each is idempotent.
--------------------------------------------------------------------------------

-- Stock documents: the inventory accounts move by the documents' cost; the other side depends on the kind.
create or replace function app.books_post_stock_document(p_doc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.stock_documents;
  v_type text;
  v_contra text;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  r record;
  v_label text;
begin
  select * into d from public.stock_documents where id = p_doc;
  if not found then return; end if;
  v_type := case when d.doc_type = 'reversal' then (select doc_type from public.stock_documents where id = d.reverses_id) else d.doc_type end;
  -- Opening stock is already in the books (imported figures and opening adjustments); differences are
  -- settled from the stock check instead of posting the count again.
  if v_type = 'opening_balance' then return; end if;
  v_contra := case v_type
    when 'purchase_receipt' then 'grni' when 'supplier_return' then 'grni'
    when 'material_issue' then 'inv_wip' when 'material_return' then 'inv_wip' when 'production_completion' then 'inv_wip'
    when 'customer_dispatch' then 'cogs' when 'customer_return' then 'cogs'
    when 'scrap' then 'stock_writeoffs' when 'adjustment' then 'stock_writeoffs'
    else 'rounding' end;
  for r in
    select case when l.kind = 'quarantine' then 'inv_quarantine' when i.kind = 'finished_good' then 'inv_finished' else 'inv_raw' end as acct,
           round(sum(m.quantity * m.unit_cost))::bigint as amt
    from public.stock_movements m
    join public.locations l on l.id = m.location_id
    join public.stock_items i on i.id = m.stock_item_id
    where m.document_id = d.id
    group by 1
  loop
    if r.amt <> 0 then
      v_lines := v_lines || jsonb_build_array(app.books_line(d.business_id, r.acct, r.amt));
      v_total := v_total + r.amt;
    end if;
  end loop;
  if v_total <> 0 then
    v_lines := v_lines || jsonb_build_array(app.books_line(d.business_id, v_contra, -v_total));
  end if;
  v_label := case v_type
    when 'purchase_receipt' then 'goods received' when 'supplier_return' then 'returned to supplier'
    when 'material_issue' then 'materials issued to production' when 'material_return' then 'materials returned from production'
    when 'production_completion' then 'finished goods from production' when 'customer_dispatch' then 'cost of goods dispatched'
    when 'customer_return' then 'customer return into Quarantine' when 'scrap' then 'written off'
    when 'adjustment' then 'stock count adjustment' when 'transfer' then 'moved between Quarantine and stock' else v_type end;
  perform app.books_auto_post(d.business_id, 'stock_document', d.id, 'post', d.effective_date,
    'Stock ' || d.number || ': ' || v_label || case when d.doc_type = 'reversal' then ' (reversal)' else '' end, v_lines,
    case when d.source_type = 'production_job' then 'job' end, case when d.source_type = 'production_job' then d.source_id end);
  if v_type = 'production_completion' and d.source_type = 'production_job' and d.doc_type <> 'reversal' then
    perform app.books_post_job_labour(d.source_id);
  end if;
end;
$$;

-- Labour and other direct costs join WIP when the job first completes units (they're fixed from then on).
create or replace function app.books_post_job_labour(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.production_jobs;
  v_labour bigint;
  v_other bigint;
  v_date date;
begin
  select * into j from public.production_jobs where id = p_job;
  if not found then return; end if;
  select min(d.effective_date) into v_date from public.stock_documents d
    where d.source_type = 'production_job' and d.source_id = j.id and d.doc_type = 'production_completion';
  if v_date is null then return; end if;
  v_labour := round(j.labour_cost)::bigint;
  v_other := round(j.other_cost)::bigint;
  perform app.books_auto_post(j.business_id, 'production_job', j.id, 'labour', v_date,
    'Job ' || j.number || ': labour and other direct costs added to work in progress',
    jsonb_build_array(app.books_line(j.business_id, 'inv_wip', v_labour + v_other),
      app.books_line(j.business_id, 'maker_payables', -v_labour), app.books_line(j.business_id, 'accruals', -v_other)),
    'job', j.id);
  perform app.books_post_job_fee(j.id);
end;
$$;

-- When an owner approves the maker's fee, any difference from the labour in WIP is a production cost.
create or replace function app.books_post_job_fee(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.production_jobs;
  v_posted bigint;
  v_diff bigint;
begin
  select * into j from public.production_jobs where id = p_job;
  if not found or j.fee_approved is null then return; end if;
  -- Only once labour is in the books for this job.
  if not exists (select 1 from public.journals where business_id = j.business_id and idempotency_key = app.books_key('production_job', j.id, 'labour')) then
    return;
  end if;
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_posted
  from public.journal_lines l join public.journals jn on jn.id = l.journal_id join public.accounts a on a.id = l.account_id
  where jn.business_id = j.business_id and jn.source_type = 'production_job' and jn.source_id = j.id
    and jn.source_part like 'fee:%' and a.system_key = 'production_labour';
  v_diff := j.fee_approved - round(j.labour_cost)::bigint - v_posted;
  perform app.books_auto_post(j.business_id, 'production_job', j.id, 'fee:' || j.fee_approved::text,
    coalesce((j.fee_approved_at at time zone app.business_tz(j.business_id))::date, (now() at time zone app.business_tz(j.business_id))::date),
    'Job ' || j.number || ': maker''s approved fee differs from the planned labour',
    jsonb_build_array(app.books_line(j.business_id, 'production_labour', v_diff), app.books_line(j.business_id, 'maker_payables', -v_diff)),
    'job', j.id);
end;
$$;

-- Customer payments and refunds on orders.
create or replace function app.books_post_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
  v_no text;
  v_change bigint;
begin
  select * into p from public.payments where id = p_payment;
  if not found then return; end if;
  select order_number into v_no from public.orders where id = p.order_id;
  if not exists (select 1 from public.journals where business_id = p.business_id and idempotency_key = app.books_key('payment', p.id, 'post')) then
    v_change := case when p.kind = 'payment' then p.amount_minor else -p.amount_minor end;
    perform app.books_auto_post(p.business_id, 'payment', p.id, 'post', p.paid_on,
      case when p.kind = 'payment' then 'Payment received for ' else 'Refund paid for ' end || coalesce(v_no, 'an order'),
      jsonb_build_array(app.books_line(p.business_id, app.books_payment_account(p.business_id, p.method)::text, v_change))
        || app.books_position_lines(p.business_id, app.books_customer_position(p.business_id, 'order', p.order_id), v_change),
      'order', p.order_id);
  end if;
  if p.voided_at is not null then
    perform app.books_auto_reverse(p.business_id, 'payment', p.id, 'post',
      (p.voided_at at time zone app.business_tz(p.business_id))::date, 'payment voided: ' || coalesce(p.void_reason, ''));
  end if;
end;
$$;

-- An order line's share of the order discount, in proportion to value.
create or replace function app.books_line_discount(p_order uuid, p_item uuid, p_qty numeric)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when s.subtotal > 0 then round(o.discount_minor::numeric * i.unit_price_minor * p_qty / s.subtotal)::bigint else 0 end
  from public.orders o
  join public.order_items i on i.id = p_item
  cross join lateral (select coalesce(sum(x.unit_price_minor * x.quantity), 0) as subtotal from public.order_items x where x.order_id = o.id) s
  where o.id = p_order
$$;

-- Revenue at dispatch: sales by category, the order discount's share, the delivery fee on the first dispatch, VAT if charged.
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
  r record;
begin
  select * into dsp from public.order_dispatches where id = p_dispatch;
  if not found then return; end if;
  select * into o from public.orders where id = dsp.order_id;
  select order_number into v_no from public.orders where id = o.id;
  v_rate := coalesce(app.books_vat_rate(dsp.business_id, dsp.dispatched_on), 0);
  for r in
    select x.acct, sum(x.amount)::bigint as amount from (
      select case p.category when 'clothing' then 'sales_clothing' when 'shoes' then 'sales_shoes' when 'bags' then 'sales_bags' else 'sales_other' end as acct,
             -(i.unit_price_minor * dl.quantity) as amount
      from public.order_dispatch_lines dl
      join public.order_items i on i.id = dl.order_item_id
      left join public.products p on p.id = i.product_id
      where dl.dispatch_id = dsp.id
      union all
      select 'discounts', app.books_line_discount(o.id, dl.order_item_id, dl.quantity)
      from public.order_dispatch_lines dl where dl.dispatch_id = dsp.id
      union all
      -- The delivery fee is earned with the first dispatch.
      select 'delivery_income', -o.delivery_fee_minor
      where not exists (select 1 from public.order_dispatches e where e.order_id = o.id
                          and (e.created_at, e.id) < (dsp.created_at, dsp.id))
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
  -- VAT is what's left after the revenue lines (keeps the journal exact to the kobo).
  v_lines := v_lines || jsonb_build_array(app.books_line(dsp.business_id, 'vat_output', v_total - v_net_sum))
    || app.books_position_lines(dsp.business_id, app.books_customer_position(dsp.business_id, 'order', o.id), v_total);
  perform app.books_auto_post(dsp.business_id, 'order_dispatch', dsp.id, 'revenue', dsp.dispatched_on,
    'Sales: ' || coalesce(v_no, 'order') || ' dispatched (' || dsp.number || ')', v_lines, 'order', o.id);
end;
$$;

-- Customer returns reverse the revenue for the returned items (the delivery fee stays earned).
create or replace function app.books_post_return(p_return uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rt public.order_returns;
  v_no text;
  v_rate numeric;
  v_gross bigint;
  v_net bigint;
begin
  select * into rt from public.order_returns where id = p_return;
  if not found or rt.document_id is null or rt.received_on is null then return; end if;
  select order_number into v_no from public.orders where id = rt.order_id;
  select coalesce(sum(i.unit_price_minor * rl.quantity - app.books_line_discount(rt.order_id, rl.order_item_id, rl.quantity)), 0)::bigint
    into v_gross
  from public.order_return_lines rl join public.order_items i on i.id = rl.order_item_id
  where rl.return_id = rt.id;
  if v_gross = 0 then return; end if;
  v_rate := coalesce(app.books_vat_rate(rt.business_id, rt.received_on), 0);
  v_net := app.books_net_of_vat(v_gross, v_rate);
  perform app.books_auto_post(rt.business_id, 'order_return', rt.id, 'revenue', rt.received_on,
    'Sales return: ' || coalesce(v_no, 'order') || ' (' || coalesce(rt.number, 'return') || ')',
    jsonb_build_array(app.books_line(rt.business_id, 'sales_returns', v_net), app.books_line(rt.business_id, 'vat_output', v_gross - v_net))
      || app.books_position_lines(rt.business_id, app.books_customer_position(rt.business_id, 'order', rt.order_id), v_gross),
    'order', rt.order_id);
end;
$$;

-- Repair payments and refunds.
create or replace function app.books_post_repair_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.repair_payments;
  v_no text;
  v_change bigint;
begin
  select * into p from public.repair_payments where id = p_payment;
  if not found then return; end if;
  select number into v_no from public.repairs where id = p.repair_id;
  if not exists (select 1 from public.journals where business_id = p.business_id and idempotency_key = app.books_key('repair_payment', p.id, 'post')) then
    v_change := case when p.kind = 'payment' then p.amount_minor else -p.amount_minor end;
    perform app.books_auto_post(p.business_id, 'repair_payment', p.id, 'post', p.paid_on,
      case when p.kind = 'payment' then 'Payment received for repair ' else 'Refund paid for repair ' end || coalesce(v_no, ''),
      jsonb_build_array(app.books_line(p.business_id, app.books_payment_account(p.business_id, p.method)::text, v_change))
        || app.books_position_lines(p.business_id, app.books_customer_position(p.business_id, 'repair', p.repair_id), v_change),
      'repair', p.repair_id);
  end if;
  if p.voided_at is not null then
    perform app.books_auto_reverse(p.business_id, 'repair_payment', p.id, 'post',
      (p.voided_at at time zone app.business_tz(p.business_id))::date, 'payment voided: ' || coalesce(p.void_reason, ''));
  end if;
end;
$$;

-- Repair income when the customer collects the item.
create or replace function app.books_post_repair(p_repair uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs;
  v_date date;
  v_rate numeric;
  v_net bigint;
begin
  select * into r from public.repairs where id = p_repair;
  if not found or r.status <> 'collected' or r.charge_minor = 0 then return; end if;
  v_date := (coalesce(r.collected_at, now()) at time zone app.business_tz(r.business_id))::date;
  v_rate := coalesce(app.books_vat_rate(r.business_id, v_date), 0);
  v_net := app.books_net_of_vat(r.charge_minor, v_rate);
  perform app.books_auto_post(r.business_id, 'repair', r.id, 'revenue', v_date, 'Repair income: ' || r.number || ' collected',
    jsonb_build_array(app.books_line(r.business_id, 'repair_income', -v_net), app.books_line(r.business_id, 'vat_output', -(r.charge_minor - v_net)))
      || app.books_position_lines(r.business_id, app.books_customer_position(r.business_id, 'repair', r.id), -r.charge_minor),
    'repair', r.id);
end;
$$;

-- Supplier bills (owed to the supplier; settles goods received not invoiced) and supplier payments.
create or replace function app.books_post_supplier_bill(p_bill uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.supplier_bills;
  v_name text;
begin
  select * into b from public.supplier_bills where id = p_bill;
  if not found then return; end if;
  select name into v_name from public.suppliers where id = b.supplier_id;
  perform app.books_auto_post(b.business_id, 'supplier_bill', b.id, 'post', b.bill_date,
    'Supplier bill: ' || coalesce(v_name, 'supplier') || coalesce(' ' || b.bill_ref, ''),
    jsonb_build_array(app.books_line(b.business_id, 'grni', b.amount), app.books_line(b.business_id, 'payables', -b.amount)),
    'supplier', b.supplier_id);
  if b.voided_at is not null then
    perform app.books_auto_reverse(b.business_id, 'supplier_bill', b.id, 'post', (now() at time zone app.business_tz(b.business_id))::date,
      'bill voided: ' || coalesce(b.void_reason, ''));
  end if;
end;
$$;

create or replace function app.books_post_supplier_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.supplier_payments;
  v_name text;
begin
  select * into p from public.supplier_payments where id = p_payment;
  if not found then return; end if;
  select name into v_name from public.suppliers where id = p.supplier_id;
  perform app.books_auto_post(p.business_id, 'supplier_payment', p.id, 'post', p.paid_on,
    'Paid supplier: ' || coalesce(v_name, 'supplier'),
    jsonb_build_array(app.books_line(p.business_id, 'payables', p.amount),
      app.books_line(p.business_id, app.books_payment_account(p.business_id, p.method)::text, -p.amount)),
    'supplier', p.supplier_id);
  if p.voided_at is not null then
    perform app.books_auto_reverse(p.business_id, 'supplier_payment', p.id, 'post', (now() at time zone app.business_tz(p.business_id))::date,
      'payment voided: ' || coalesce(p.void_reason, ''));
  end if;
end;
$$;

create or replace function app.books_post_maker_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.maker_payments;
  v_name text;
begin
  select * into p from public.maker_payments where id = p_payment;
  if not found then return; end if;
  select name into v_name from public.makers where id = p.maker_id;
  perform app.books_auto_post(p.business_id, 'maker_payment', p.id, 'post', p.paid_on,
    'Paid maker: ' || coalesce(v_name, 'maker'),
    jsonb_build_array(app.books_line(p.business_id, 'maker_payables', p.amount),
      app.books_line(p.business_id, app.books_payment_account(p.business_id, p.method)::text, -p.amount)),
    'maker', p.maker_id);
  if p.voided_at is not null then
    perform app.books_auto_reverse(p.business_id, 'maker_payment', p.id, 'post', (now() at time zone app.business_tz(p.business_id))::date,
      'payment voided: ' || coalesce(p.void_reason, ''));
  end if;
end;
$$;

-- Runs a handler; a problem is recorded for the owner instead of stopping the sale, payment or stock move.
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

do $$
declare f text;
begin
  foreach f in array array['books_auto_from(uuid)', 'books_open_date(uuid, date)', 'books_key(text, uuid, text)', 'books_account(uuid, text)',
    'books_payment_account(uuid, public.payment_method)', 'books_line(uuid, text, bigint, text)',
    'books_auto_post(uuid, text, uuid, text, date, text, jsonb, text, uuid)', 'books_auto_reverse(uuid, text, uuid, text, date, text)',
    'books_customer_position(uuid, text, uuid)', 'books_position_lines(uuid, bigint, bigint)', 'books_vat_rate(uuid, date)',
    'books_net_of_vat(bigint, numeric)', 'books_post_stock_document(uuid)', 'books_post_job_labour(uuid)', 'books_post_job_fee(uuid)',
    'books_post_payment(uuid)', 'books_line_discount(uuid, uuid, numeric)', 'books_post_dispatch(uuid)', 'books_post_return(uuid)',
    'books_post_repair_payment(uuid)', 'books_post_repair(uuid)', 'books_post_supplier_bill(uuid)', 'books_post_supplier_payment(uuid)',
    'books_post_maker_payment(uuid)', 'books_safe(uuid, text, uuid)'] loop
    execute format('revoke all on function app.%s from public, anon, authenticated', f);
  end loop;
end;
$$;

--------------------------------------------------------------------------------
-- Triggers. Documents whose lines are added after the header post at commit (deferred).
--------------------------------------------------------------------------------
create or replace function app.books_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.books_safe(new.business_id, tg_argv[0], new.id);
  return null;
end;
$$;
revoke all on function app.books_trigger from public, anon, authenticated;

create constraint trigger books_post_stock_document after insert on public.stock_documents
  deferrable initially deferred for each row execute function app.books_trigger('stock_document');
create constraint trigger books_post_dispatch after insert on public.order_dispatches
  deferrable initially deferred for each row execute function app.books_trigger('order_dispatch');
create constraint trigger books_post_return after insert on public.order_returns
  deferrable initially deferred for each row execute function app.books_trigger('order_return');
create constraint trigger books_post_return_received after update on public.order_returns
  deferrable initially deferred for each row when (old.document_id is null and new.document_id is not null)
  execute function app.books_trigger('order_return');
create trigger books_post_repair after update of status on public.repairs
  for each row when (new.status = 'collected') execute function app.books_trigger('repair');
-- Voiding sets voided_at in a BEFORE trigger, so watch the change itself, not the columns named in the UPDATE.
create trigger books_post_payment after insert on public.payments
  for each row execute function app.books_trigger('payment');
create trigger books_void_payment after update on public.payments
  for each row when (old.voided_at is null and new.voided_at is not null) execute function app.books_trigger('payment');
-- Voiding sets voided_at in a BEFORE trigger, so watch the change itself, not the columns named in the UPDATE.
create trigger books_post_repair_payment after insert on public.repair_payments
  for each row execute function app.books_trigger('repair_payment');
create trigger books_void_repair_payment after update on public.repair_payments
  for each row when (old.voided_at is null and new.voided_at is not null) execute function app.books_trigger('repair_payment');
-- Voiding sets voided_at in a BEFORE trigger, so watch the change itself, not the columns named in the UPDATE.
create trigger books_post_supplier_bill after insert on public.supplier_bills
  for each row execute function app.books_trigger('supplier_bill');
create trigger books_void_supplier_bill after update on public.supplier_bills
  for each row when (old.voided_at is null and new.voided_at is not null) execute function app.books_trigger('supplier_bill');
-- Voiding sets voided_at in a BEFORE trigger, so watch the change itself, not the columns named in the UPDATE.
create trigger books_post_supplier_payment after insert on public.supplier_payments
  for each row execute function app.books_trigger('supplier_payment');
create trigger books_void_supplier_payment after update on public.supplier_payments
  for each row when (old.voided_at is null and new.voided_at is not null) execute function app.books_trigger('supplier_payment');
-- Voiding sets voided_at in a BEFORE trigger, so watch the change itself, not the columns named in the UPDATE.
create trigger books_post_maker_payment after insert on public.maker_payments
  for each row execute function app.books_trigger('maker_payment');
create trigger books_void_maker_payment after update on public.maker_payments
  for each row when (old.voided_at is null and new.voided_at is not null) execute function app.books_trigger('maker_payment');
create trigger books_post_job_fee after update of fee_approved on public.production_jobs
  for each row when (new.fee_approved is distinct from old.fee_approved) execute function app.books_trigger('production_job');

--------------------------------------------------------------------------------
-- Owner functions
--------------------------------------------------------------------------------

-- Posts every record from the first live year that isn't in the books yet, oldest first, and retries problems.
create or replace function public.books_post_existing(p_business_id uuid)
returns table (posted integer, problems integer) language plpgsql security definer set search_path = '' as $$
declare
  v_from date;
  v_before integer;
  r record;
begin
  perform app.require_owner_books(p_business_id);
  v_from := app.books_auto_from(p_business_id);
  if v_from is null then
    raise exception 'Add a financial year kept in the app first (close the imported year).' using errcode = 'P0001';
  end if;
  select count(*) into v_before from public.journals where business_id = p_business_id and kind in ('auto', 'reversal');
  for r in
    select * from (
      select 'stock_document' as t, id, effective_date as d, created_at as c from public.stock_documents where business_id = p_business_id and effective_date >= v_from
      union all select 'payment', id, paid_on, created_at from public.payments where business_id = p_business_id and paid_on >= v_from
      union all select 'order_dispatch', id, dispatched_on, created_at from public.order_dispatches where business_id = p_business_id and dispatched_on >= v_from
      union all select 'order_return', id, received_on, created_at from public.order_returns where business_id = p_business_id and received_on >= v_from and document_id is not null
      union all select 'repair_payment', id, paid_on, created_at from public.repair_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'repair', id, (collected_at at time zone app.business_tz(business_id))::date, collected_at from public.repairs
        where business_id = p_business_id and status = 'collected' and (collected_at at time zone app.business_tz(business_id))::date >= v_from
      union all select 'supplier_bill', id, bill_date, created_at from public.supplier_bills where business_id = p_business_id and bill_date >= v_from
      union all select 'supplier_payment', id, paid_on, created_at from public.supplier_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'maker_payment', id, paid_on, created_at from public.maker_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'production_job', id, (fee_approved_at at time zone app.business_tz(business_id))::date, fee_approved_at from public.production_jobs
        where business_id = p_business_id and fee_approved is not null
      union all select source_type, source_id, null::date, null::timestamptz from public.books_posting_problems where business_id = p_business_id
    ) e order by e.d nulls last, e.c nulls last, e.id
  loop
    perform app.books_safe(p_business_id, r.t, r.id);
  end loop;
  return query select (select count(*)::integer from public.journals where business_id = p_business_id and kind in ('auto', 'reversal')) - v_before,
    (select count(*)::integer from public.books_posting_problems where business_id = p_business_id);
end;
$$;

create or replace function public.set_books_payment_account(p_business_id uuid, p_method public.payment_method, p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner_books(p_business_id);
  if p_account_id is null then
    delete from public.books_payment_accounts where business_id = p_business_id and method = p_method;
    return;
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id and business_id = p_business_id and archived_at is null and type = 'asset') then
    raise exception 'Choose a bank, cash or clearing account.' using errcode = 'P0001';
  end if;
  insert into public.books_payment_accounts (business_id, method, account_id) values (p_business_id, p_method, p_account_id)
  on conflict (business_id, method) do update set account_id = excluded.account_id;
end;
$$;

-- Settings now include the date VAT is first charged on sales.
drop function if exists public.update_books_settings(uuid, date, boolean, numeric);
create or replace function public.update_books_settings(
  p_business_id uuid, p_incorporation_date date, p_vat_registered boolean, p_vat_rate numeric, p_vat_charged_from date default null
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
    vat_rate = case when coalesce(p_vat_registered, false) then p_vat_rate end,
    vat_charged_from = case when coalesce(p_vat_registered, false) then p_vat_charged_from end
  where business_id = p_business_id;
end;
$$;

-- Stock value per inventory account in the stock records, as at a date (owners).
create or replace function app.books_stock_value(p_business_id uuid, p_as_of date)
returns table (system_key text, value_minor bigint) language sql stable security definer set search_path = '' as $$
  select case when l.kind = 'quarantine' then 'inv_quarantine' when i.kind = 'finished_good' then 'inv_finished' else 'inv_raw' end,
         round(sum(m.quantity * m.unit_cost))::bigint
  from public.stock_movements m
  join public.locations l on l.id = m.location_id
  join public.stock_items i on i.id = m.stock_item_id
  where m.business_id = p_business_id and m.effective_date <= p_as_of
  group by 1
$$;
revoke all on function app.books_stock_value from public, anon, authenticated;

-- Checks that the books agree with the operational records (owners).
create or replace function public.books_checks(p_business_id uuid, p_as_of date)
returns table (check_key text, label text, books_minor bigint, records_minor bigint, difference_minor bigint, note text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date;
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can see the books.' using errcode = '42501';
  end if;
  v_from := app.books_auto_from(p_business_id);
  return query
  with gl as (
    select a.system_key as k, sum(l.debit_minor - l.credit_minor)::bigint as bal
    from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
    where l.business_id = p_business_id and j.effective_date <= p_as_of and a.system_key is not null
    group by a.system_key
  ), stock as (select * from app.books_stock_value(p_business_id, p_as_of)),
  inv as (
    select k, lbl from (values ('inv_raw', 'Raw materials and packaging'), ('inv_finished', 'Finished goods'), ('inv_quarantine', 'Stock in Quarantine')) v(k, lbl)
  )
  select 'stock:' || inv.k, inv.lbl, coalesce(gl.bal, 0), coalesce(stock.value_minor, 0), coalesce(gl.bal, 0) - coalesce(stock.value_minor, 0),
    'Books vs the stock records at cost.'::text
  from inv left join gl on gl.k = inv.k left join stock on stock.system_key = inv.k
  union all
  select 'wip', 'Work in progress', coalesce((select bal from gl where k = 'inv_wip'), 0),
    coalesce((select round(sum(app.job_material_value(j.id) - app.job_completed_value(j.id)
        + case when exists (select 1 from public.stock_documents d where d.source_type = 'production_job' and d.source_id = j.id and d.doc_type = 'production_completion')
               then round(j.labour_cost) + round(j.other_cost) else 0 end))::bigint
      from public.production_jobs j where j.business_id = p_business_id), 0),
    0, 'Materials issued to jobs, plus labour once units are completed, less finished goods.'
  union all
  select 'grni', 'Goods received not yet billed', -coalesce((select bal from gl where k = 'grni'), 0), null, null,
    'Should come back to nil once every delivery has its supplier bill. A balance left over usually means a bill differs from the goods received.'
  union all
  select 'problems', 'Records the app couldn''t post', (select count(*)::bigint from public.books_posting_problems where business_id = p_business_id), 0, null,
    'Fix the cause shown, then post existing records again.';
end;
$$;

-- Brings the inventory accounts into line with the stock records at a date (e.g. after an opening count).
create or replace function public.books_match_stock(p_business_id uuid, p_date date, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  r record;
begin
  perform app.require_owner_books(p_business_id);
  for r in
    select k, coalesce(s.value_minor, 0) - coalesce(g.bal, 0) as diff
    from (values ('inv_raw'), ('inv_finished'), ('inv_quarantine')) v(k)
    left join app.books_stock_value(p_business_id, p_date) s on s.system_key = v.k
    left join (select a.system_key, sum(l.debit_minor - l.credit_minor) as bal
               from public.journal_lines l join public.journals j on j.id = l.journal_id join public.accounts a on a.id = l.account_id
               where l.business_id = p_business_id and j.effective_date <= p_date group by a.system_key) g on g.system_key = v.k
  loop
    if r.diff <> 0 then
      v_lines := v_lines || jsonb_build_array(app.books_line(p_business_id, r.k, r.diff::bigint, 'To match the stock records'));
      v_total := v_total + r.diff;
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'The books already match the stock records on that date.' using errcode = 'P0001';
  end if;
  if v_total <> 0 then
    v_lines := v_lines || jsonb_build_array(app.books_line(p_business_id, 'stock_change', -v_total, 'Difference to the stock records'));
  end if;
  return app.post_journal(p_business_id, p_date, 'Stock in the books brought into line with the stock records', 'manual', null, v_lines, p_idempotency_key);
end;
$$;

-- Owners can't reverse automatic journals by hand: the record they came from is the thing to correct.
create or replace function public.reverse_journal(p_journal_id uuid, p_date date, p_reason text, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  j public.journals;
  v_lines jsonb;
  v_id uuid;
begin
  select business_id into v_business from public.journals where id = p_journal_id;
  if v_business is null or not app.is_owner(v_business) then
    raise exception 'Only owners can work with the books.' using errcode = '42501';
  end if;
  perform app.require_owner_books(v_business);
  select * into j from public.journals where id = p_journal_id for update;
  select id into v_id from public.journals where business_id = j.business_id and idempotency_key = p_idempotency_key;
  if found then return v_id; end if;
  if j.reversed_by_id is not null then
    raise exception 'This journal has already been reversed.' using errcode = 'P0001';
  end if;
  if j.kind = 'auto' or (j.kind = 'reversal' and j.source_type is not null and not app.is_year_closing(j.source_type)) then
    raise exception 'This journal was posted from a record in the app. Correct that record instead (e.g. void the payment).' using errcode = 'P0001';
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
  update public.journals set reversed_by_id = v_id where id = j.id and reversed_by_id is null;
  return v_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['books_post_existing', 'set_books_payment_account', 'update_books_settings', 'books_checks', 'books_match_stock'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
