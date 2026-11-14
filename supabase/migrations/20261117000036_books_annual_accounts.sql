-- Books Phase F: annual accounts.
--
-- One annual_accounts row per financial year holds what the owner or accountant writes for the accounts pack
-- (company details, accounting policies, going concern, events after the year end, related parties, the
-- directors' approval) and the accountant's sign-off. The figures are never stored: the pack is built from the
-- ledger every time.
--
-- Sign-off records who reviewed the accounts (name and qualification, as entered) and when the year was closed.
-- It only counts while the year is still closed from that same close: reopening the year withdraws it
-- in effect. Signed-off accounts can't be edited until the sign-off is withdrawn. Sign-off is a review, never an
-- audit, and the pack says so.

create table public.annual_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id),
  fiscal_year_id uuid not null,
  company_name text check (char_length(company_name) <= 200),
  rc_number text check (char_length(rc_number) <= 40),
  registered_office text check (char_length(registered_office) <= 500),
  principal_activity text check (char_length(principal_activity) <= 1000),
  directors text check (char_length(directors) <= 1000),
  share_capital_note text check (char_length(share_capital_note) <= 2000),
  policies text check (char_length(policies) <= 8000),
  going_concern text check (char_length(going_concern) <= 4000),
  events_after text check (char_length(events_after) <= 4000),
  related_parties text check (char_length(related_parties) <= 4000),
  other_notes text check (char_length(other_notes) <= 8000),
  approved_on date,
  approved_by text check (char_length(approved_by) <= 500),
  signed_off_name text check (char_length(signed_off_name) <= 200),
  signed_off_qualification text check (char_length(signed_off_qualification) <= 200),
  signed_off_on date,
  signed_off_note text check (char_length(signed_off_note) <= 2000),
  signed_off_year_closed_at timestamptz,
  signed_off_by uuid references auth.users (id),
  signed_off_at timestamptz,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (business_id, fiscal_year_id),
  foreign key (business_id, fiscal_year_id) references public.fiscal_years (business_id, id),
  check ((signed_off_at is null) = (signed_off_name is null)),
  check ((signed_off_at is null) = (signed_off_year_closed_at is null))
);
alter table public.annual_accounts enable row level security;
create policy "owners read annual accounts" on public.annual_accounts for select to authenticated using (app.is_owner(business_id));
revoke all on public.annual_accounts from anon, authenticated;
grant select on public.annual_accounts to authenticated;
create trigger audit_annual_accounts after insert or update or delete on public.annual_accounts
  for each row execute function app.write_audit();

-- Whether the accounts for a year are signed off and the sign-off still stands.
create or replace function app.annual_accounts_signed(p_year_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.annual_accounts aa join public.fiscal_years y on y.id = aa.fiscal_year_id
    where aa.fiscal_year_id = p_year_id and aa.signed_off_at is not null
      and y.status = 'closed' and y.closed_at = aa.signed_off_year_closed_at)
$$;
revoke all on function app.annual_accounts_signed(uuid) from public, anon, authenticated;

create or replace function app.annual_accounts_year(p_business_id uuid, p_year_id uuid)
returns public.fiscal_years language plpgsql stable security definer set search_path = '' as $$
declare y public.fiscal_years;
begin
  select * into y from public.fiscal_years where id = p_year_id and business_id = p_business_id;
  if not found then raise exception 'That financial year doesn''t exist.' using errcode = 'P0001'; end if;
  return y;
end;
$$;
revoke all on function app.annual_accounts_year(uuid, uuid) from public, anon, authenticated;

-- Saves what the owner writes for a year's accounts. Keys left out keep their value; empty text clears it.
create or replace function public.save_annual_accounts(p_business_id uuid, p_year_id uuid, p_fields jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  y public.fiscal_years;
  v_key text;
  v_text text[] := array['company_name', 'rc_number', 'registered_office', 'principal_activity', 'directors', 'share_capital_note',
    'policies', 'going_concern', 'events_after', 'related_parties', 'other_notes', 'approved_by'];
  v_approved date;
begin
  perform app.require_owner_books(p_business_id);
  y := app.annual_accounts_year(p_business_id, p_year_id);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Nothing to save.' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any (v_text) or v_key = 'approved_on') then
      raise exception 'Unknown field: %', v_key using errcode = '22023';
    end if;
  end loop;
  if app.annual_accounts_signed(p_year_id) then
    raise exception 'These accounts are signed off. Withdraw the sign-off to change them.' using errcode = 'P0001';
  end if;
  if p_fields ? 'approved_on' and nullif(p_fields ->> 'approved_on', '') is not null then
    begin
      v_approved := (p_fields ->> 'approved_on')::date;
    exception when others then
      raise exception 'The approval date isn''t a real date.' using errcode = 'P0001';
    end;
    if v_approved <= y.end_date then
      raise exception 'The directors approve the accounts after the year end (%).', to_char(y.end_date, 'DD Mon YYYY') using errcode = 'P0001';
    end if;
    if v_approved > (now() at time zone app.business_tz(p_business_id))::date then
      raise exception 'The approval date can''t be in the future.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.annual_accounts (business_id, fiscal_year_id, updated_by)
  values (p_business_id, p_year_id, auth.uid())
  on conflict (business_id, fiscal_year_id) do nothing;

  update public.annual_accounts aa set
    company_name = case when p_fields ? 'company_name' then nullif(btrim(p_fields ->> 'company_name'), '') else aa.company_name end,
    rc_number = case when p_fields ? 'rc_number' then nullif(btrim(p_fields ->> 'rc_number'), '') else aa.rc_number end,
    registered_office = case when p_fields ? 'registered_office' then nullif(btrim(p_fields ->> 'registered_office'), '') else aa.registered_office end,
    principal_activity = case when p_fields ? 'principal_activity' then nullif(btrim(p_fields ->> 'principal_activity'), '') else aa.principal_activity end,
    directors = case when p_fields ? 'directors' then nullif(btrim(p_fields ->> 'directors'), '') else aa.directors end,
    share_capital_note = case when p_fields ? 'share_capital_note' then nullif(btrim(p_fields ->> 'share_capital_note'), '') else aa.share_capital_note end,
    policies = case when p_fields ? 'policies' then nullif(btrim(p_fields ->> 'policies'), '') else aa.policies end,
    going_concern = case when p_fields ? 'going_concern' then nullif(btrim(p_fields ->> 'going_concern'), '') else aa.going_concern end,
    events_after = case when p_fields ? 'events_after' then nullif(btrim(p_fields ->> 'events_after'), '') else aa.events_after end,
    related_parties = case when p_fields ? 'related_parties' then nullif(btrim(p_fields ->> 'related_parties'), '') else aa.related_parties end,
    other_notes = case when p_fields ? 'other_notes' then nullif(btrim(p_fields ->> 'other_notes'), '') else aa.other_notes end,
    approved_by = case when p_fields ? 'approved_by' then nullif(btrim(p_fields ->> 'approved_by'), '') else aa.approved_by end,
    approved_on = case when p_fields ? 'approved_on' then v_approved else aa.approved_on end,
    -- A stale sign-off (the year was reopened) is cleared by the first edit.
    signed_off_name = null, signed_off_qualification = null, signed_off_on = null, signed_off_note = null,
    signed_off_year_closed_at = null, signed_off_by = null, signed_off_at = null,
    updated_by = auth.uid(), updated_at = now()
  where aa.business_id = p_business_id and aa.fiscal_year_id = p_year_id;
end;
$$;

-- Records that an accountant reviewed the accounts. The year must be closed and the directors' approval entered.
create or replace function public.sign_off_annual_accounts(
  p_business_id uuid, p_year_id uuid, p_name text, p_qualification text, p_signed_on date, p_note text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  y public.fiscal_years;
  aa public.annual_accounts;
begin
  perform app.require_owner_books(p_business_id);
  y := app.annual_accounts_year(p_business_id, p_year_id);
  if y.status <> 'closed' or y.closed_at is null then
    raise exception 'Close the year before the accounts are signed off.' using errcode = 'P0001';
  end if;
  select * into aa from public.annual_accounts where business_id = p_business_id and fiscal_year_id = p_year_id for update;
  if not found or aa.approved_on is null or aa.approved_by is null then
    raise exception 'Enter the directors'' approval (date and who signed) first.' using errcode = 'P0001';
  end if;
  if app.annual_accounts_signed(p_year_id) then
    raise exception 'These accounts are already signed off.' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Enter the name of the accountant who reviewed the accounts.' using errcode = 'P0001';
  end if;
  if p_qualification is null or char_length(btrim(p_qualification)) = 0 then
    raise exception 'Enter their qualification (for example ICAN or ANAN membership).' using errcode = 'P0001';
  end if;
  if p_signed_on is null or p_signed_on <= y.end_date then
    raise exception 'The sign-off date is after the year end (%).', to_char(y.end_date, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if p_signed_on > (now() at time zone app.business_tz(p_business_id))::date then
    raise exception 'The sign-off date can''t be in the future.' using errcode = 'P0001';
  end if;
  update public.annual_accounts set
    signed_off_name = btrim(left(p_name, 200)), signed_off_qualification = btrim(left(p_qualification, 200)),
    signed_off_on = p_signed_on, signed_off_note = nullif(btrim(left(coalesce(p_note, ''), 2000)), ''),
    signed_off_year_closed_at = y.closed_at, signed_off_by = auth.uid(), signed_off_at = now(), updated_at = now()
  where id = aa.id;
end;
$$;

-- Withdraws a sign-off so the accounts can be changed (kept in the audit log).
create or replace function public.withdraw_annual_accounts_sign_off(p_business_id uuid, p_year_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner_books(p_business_id);
  perform app.annual_accounts_year(p_business_id, p_year_id);
  update public.annual_accounts set
    signed_off_name = null, signed_off_qualification = null, signed_off_on = null, signed_off_note = null,
    signed_off_year_closed_at = null, signed_off_by = null, signed_off_at = null, updated_by = auth.uid(), updated_at = now()
  where business_id = p_business_id and fiscal_year_id = p_year_id and signed_off_at is not null;
  if not found then
    raise exception 'These accounts aren''t signed off.' using errcode = 'P0001';
  end if;
end;
$$;

-- Debits and credits per account in a period, for the notes (property, plant and equipment movements, directors'
-- accounts). Year-close journals are left out of the period, as in trial_balance; imported figures count as
-- movements of the period they're dated in.
create or replace function public.account_movements(p_business_id uuid, p_from date, p_to date)
returns table (account_id uuid, opening_minor bigint, debit_minor bigint, credit_minor bigint, closing_minor bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can see the books.' using errcode = '42501';
  end if;
  return query
  select l.account_id,
    coalesce(sum(case when j.effective_date < p_from then l.debit_minor - l.credit_minor end), 0)::bigint,
    coalesce(sum(case when j.effective_date >= p_from and not app.is_year_closing(j.source_type) then l.debit_minor end), 0)::bigint,
    coalesce(sum(case when j.effective_date >= p_from and not app.is_year_closing(j.source_type) then l.credit_minor end), 0)::bigint,
    coalesce(sum(case when j.effective_date < p_from or not app.is_year_closing(j.source_type) then l.debit_minor - l.credit_minor end), 0)::bigint
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id
  where l.business_id = p_business_id and j.effective_date <= p_to
  group by l.account_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['save_annual_accounts', 'sign_off_annual_accounts', 'withdraw_annual_accounts_sign_off', 'account_movements'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
