-- Books Phase A review fixes:
-- 1. Closing a reopened year again counted the profit twice: the year-end close and its reversal (both
--    source_type 'fiscal_year') are now left out of the close and of the period columns of the trial balance.
-- 2. A journal with no lines (null p_lines) could be committed; now refused, and every journal needs 2+ lines.
-- 3. Two simultaneous requests with the same key: the key is checked again after taking the lock.
-- 4. Reopening a year no longer silently clears a month close set later than that year.
-- 5. Friendly messages instead of raw cast errors; owner checked before any row lock; tables fully revoked.

--------------------------------------------------------------------------------
-- Tables: nothing but select for signed-in users.
--------------------------------------------------------------------------------
revoke all on public.books_settings, public.accounts, public.fiscal_years, public.journals, public.journal_lines from authenticated;
grant select on public.books_settings, public.accounts, public.fiscal_years, public.journals, public.journal_lines to authenticated;

-- Year-end closing journals and their reversals: bookkeeping about the year, not activity in it.
create or replace function app.is_year_closing(p_source_type text)
returns boolean language sql immutable set search_path = '' as $$ select coalesce(p_source_type = 'fiscal_year', false) $$;

--------------------------------------------------------------------------------
-- Posting
--------------------------------------------------------------------------------
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
  v_debit numeric;
  v_credit numeric;
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
  -- A request with the same key may have finished while this one waited for the lock.
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
    source_type, source_id, reverses_id, idempotency_key)
  values (p_business_id, 'JN-' || lpad(v_n::text, 5, '0'), y.id, p_date, left(btrim(p_narration), 500), p_kind, p_adjustment_type,
    p_source_type, p_source_id, p_reverses_id, p_idempotency_key)
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

create or replace function public.post_manual_journal(
  p_business_id uuid, p_date date, p_narration text, p_kind text, p_adjustment_type text, p_lines jsonb, p_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner_books(p_business_id);
  if p_kind is null or p_kind not in ('manual', 'opening_import', 'opening_adjustment') then
    raise exception 'Choose what kind of journal this is.' using errcode = 'P0001';
  end if;
  if p_kind = 'opening_adjustment' and p_adjustment_type is not null and p_adjustment_type not in ('stock', 'fixed_asset', 'other') then
    raise exception 'Choose what kind of adjustment this is.' using errcode = 'P0001';
  end if;
  return app.post_journal(p_business_id, p_date, p_narration, p_kind,
    case when p_kind = 'opening_adjustment' then coalesce(p_adjustment_type, 'other') end,
    p_lines, p_idempotency_key);
end;
$$;

-- Owner checked before taking any row lock.
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
  update public.journals set reversed_by_id = v_id where id = j.id and reversed_by_id is null;
  return v_id;
end;
$$;

create or replace function public.update_account(p_account_id uuid, p_code text, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
  a public.accounts;
begin
  select business_id into v_business from public.accounts where id = p_account_id;
  if v_business is null or not app.is_owner(v_business) then
    raise exception 'Only owners can work with the books.' using errcode = '42501';
  end if;
  perform app.require_owner_books(v_business);
  select * into a from public.accounts where id = p_account_id for update;
  if p_name is null or char_length(btrim(p_name)) = 0 or char_length(btrim(p_name)) > 120 then
    raise exception 'Give the account a name (up to 120 characters).' using errcode = 'P0001';
  end if;
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
  v_business uuid;
  a public.accounts;
  v_balance bigint;
begin
  select business_id into v_business from public.accounts where id = p_account_id;
  if v_business is null or not app.is_owner(v_business) then
    raise exception 'Only owners can work with the books.' using errcode = '42501';
  end if;
  perform app.require_owner_books(v_business);
  select * into a from public.accounts where id = p_account_id for update;
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

--------------------------------------------------------------------------------
-- Year end
--------------------------------------------------------------------------------
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
  -- A key from an earlier close (e.g. a page left open across a reopen) must not stand in for this one.
  if exists (select 1 from public.journals where business_id = p_business_id and idempotency_key = p_idempotency_key) then
    raise exception 'Refresh the page and try again.' using errcode = 'P0001';
  end if;
  select id into v_re from public.accounts where business_id = p_business_id and system_key = 'retained_earnings';

  -- Income and expenses for the year, leaving out earlier closes of this year and their reversals.
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
      and j.effective_date between y.start_date and y.end_date and not app.is_year_closing(j.source_type)
    group by l.account_id, a.code
    having sum(l.debit_minor - l.credit_minor) <> 0
  ) b;

  if v_lines is not null then
    if v_net <> 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_re,
        'debit', case when v_net > 0 then v_net else 0 end,
        'credit', case when v_net < 0 then -v_net else 0 end,
        'description', case when v_net > 0 then 'Loss for the year' else 'Profit for the year' end));
    end if;
    -- With nothing left but a single line (impossible once balanced), there's nothing to close.
    if jsonb_array_length(v_lines) >= 2 then
      v_journal := app.post_journal(p_business_id, y.end_date,
        'Year-end close: income and expenses for the year to ' || to_char(y.end_date, 'DD Mon YYYY') || ' moved to retained earnings',
        'year_close', null, v_lines, p_idempotency_key, null, 'fiscal_year', y.id, true);
    end if;
  end if;

  update public.fiscal_years set status = 'closed', closed_at = now(), closed_by = auth.uid(), closing_journal_id = v_journal
  where id = y.id;
  update public.books_settings set locked_through = greatest(coalesce(locked_through, y.end_date), y.end_date)
  where business_id = p_business_id;
  perform app.ensure_fiscal_years(p_business_id, y.end_date + 1);
  return v_journal;
end;
$$;

create or replace function public.reopen_fiscal_year(p_business_id uuid, p_year_id uuid, p_reason text, p_idempotency_key uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.books_settings;
  y public.fiscal_years;
  v_lines jsonb;
  v_rev uuid;
  v_prev_end date;
begin
  perform app.require_owner_books(p_business_id);
  select * into s from public.books_settings where business_id = p_business_id for update;
  select * into y from public.fiscal_years where id = p_year_id and business_id = p_business_id for update;
  if not found or y.status <> 'closed' then
    raise exception 'That year isn''t closed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.fiscal_years where business_id = p_business_id and start_date > y.start_date and status = 'closed') then
    raise exception 'Reopen the later year first.' using errcode = 'P0001';
  end if;
  if s.locked_through is not null and s.locked_through > y.end_date then
    raise exception 'The books are also closed up to %, after this year. Move the month close back to % first.',
      to_char(s.locked_through, 'DD Mon YYYY'), to_char(y.end_date, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'Give a reason for reopening the year.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.journals where business_id = p_business_id and idempotency_key = p_idempotency_key) then
    raise exception 'Refresh the page and try again.' using errcode = 'P0001';
  end if;
  if y.closing_journal_id is not null then
    select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit_minor, 'credit', debit_minor,
      'description', description) order by line_no) into v_lines
    from public.journal_lines where journal_id = y.closing_journal_id;
    v_rev := app.post_journal(p_business_id, y.end_date,
      left('Year reopened: ' || btrim(p_reason), 500), 'reversal', null, v_lines, p_idempotency_key,
      y.closing_journal_id, 'fiscal_year', y.id, true);
    update public.journals set reversed_by_id = v_rev where id = y.closing_journal_id and reversed_by_id is null;
  end if;
  update public.fiscal_years set status = 'open', closed_at = null, closed_by = null, closing_journal_id = null where id = y.id;
  select max(end_date) into v_prev_end from public.fiscal_years where business_id = p_business_id and status = 'closed';
  update public.books_settings set locked_through = v_prev_end where business_id = p_business_id;
end;
$$;

-- Same set_books_lock rule as before (no change), kept here only for reference: it can't unlock inside a closed year.

--------------------------------------------------------------------------------
-- Reports: year-end closes and their reversals stay out of the period columns.
--------------------------------------------------------------------------------
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
      sum(case when j.effective_date >= p_from and j.kind not in ('opening_import', 'opening_adjustment')
               and not app.is_year_closing(j.source_type) then l.debit_minor - l.credit_minor else 0 end) as oth
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

-- Ledger in posting order (date, then the order journals were recorded), including year-end closes so
-- the running balance matches what carries forward.
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
      (v_opening + sum(l.debit_minor - l.credit_minor) over (order by j.effective_date, j.created_at, j.id, l.line_no))::bigint as bal
    from public.journal_lines l join public.journals j on j.id = l.journal_id
    where l.account_id = p_account_id and j.effective_date between p_from and p_to
    order by j.effective_date, j.created_at, j.id, l.line_no
  ) t;
end;
$$;
