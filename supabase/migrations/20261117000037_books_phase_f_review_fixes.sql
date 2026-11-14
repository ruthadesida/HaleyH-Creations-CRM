-- Books Phase F review fixes.
-- 1. The directors' approval belongs to a close, like the sign-off: it can only be entered once the year is
--    closed, and it lapses if the year is reopened (approved_year_closed_at).
-- 2. Sign-off dates follow the approval and the close.
-- 3. save_annual_accounts locks the row before checking the sign-off, so a save racing a sign-off can't erase it.
-- 4. account_movements: imported figures and opening adjustments are the starting position (as in the cash flow),
--    and a journal reversed within the period drops out together with its reversal.

alter table public.annual_accounts add column approved_year_closed_at timestamptz;

create or replace function app.annual_accounts_approved(p_year_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.annual_accounts aa join public.fiscal_years y on y.id = aa.fiscal_year_id
    where aa.fiscal_year_id = p_year_id and aa.approved_on is not null and aa.approved_by is not null
      and y.status = 'closed' and y.closed_at = aa.approved_year_closed_at)
$$;
revoke all on function app.annual_accounts_approved(uuid) from public, anon, authenticated;

create or replace function public.save_annual_accounts(p_business_id uuid, p_year_id uuid, p_fields jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  y public.fiscal_years;
  aa public.annual_accounts;
  v_key text;
  v_text text[] := array['company_name', 'rc_number', 'registered_office', 'principal_activity', 'directors', 'share_capital_note',
    'policies', 'going_concern', 'events_after', 'related_parties', 'other_notes', 'approved_by'];
  v_approved date;
  v_approved_by text;
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
  -- Lock first, then check: a sign-off committed meanwhile is seen here.
  select * into aa from public.annual_accounts where business_id = p_business_id and fiscal_year_id = p_year_id for update;
  if app.annual_accounts_signed(p_year_id) then
    raise exception 'These accounts are signed off. Withdraw the sign-off to change them.' using errcode = 'P0001';
  end if;

  v_approved := case when p_fields ? 'approved_on' then v_approved else aa.approved_on end;
  v_approved_by := case when p_fields ? 'approved_by' then nullif(btrim(p_fields ->> 'approved_by'), '') else aa.approved_by end;
  if (v_approved is not null or v_approved_by is not null) and (y.status <> 'closed' or y.closed_at is null)
     and (p_fields ? 'approved_on' or p_fields ? 'approved_by') then
    raise exception 'The directors approve the accounts once the year is closed.' using errcode = 'P0001';
  end if;
  if v_approved is not null and y.closed_at is not null and v_approved < (y.closed_at at time zone app.business_tz(p_business_id))::date then
    raise exception 'The approval date can''t be before the year was closed (%).',
      to_char((y.closed_at at time zone app.business_tz(p_business_id))::date, 'DD Mon YYYY') using errcode = 'P0001';
  end if;

  update public.annual_accounts a set
    company_name = case when p_fields ? 'company_name' then nullif(btrim(p_fields ->> 'company_name'), '') else a.company_name end,
    rc_number = case when p_fields ? 'rc_number' then nullif(btrim(p_fields ->> 'rc_number'), '') else a.rc_number end,
    registered_office = case when p_fields ? 'registered_office' then nullif(btrim(p_fields ->> 'registered_office'), '') else a.registered_office end,
    principal_activity = case when p_fields ? 'principal_activity' then nullif(btrim(p_fields ->> 'principal_activity'), '') else a.principal_activity end,
    directors = case when p_fields ? 'directors' then nullif(btrim(p_fields ->> 'directors'), '') else a.directors end,
    share_capital_note = case when p_fields ? 'share_capital_note' then nullif(btrim(p_fields ->> 'share_capital_note'), '') else a.share_capital_note end,
    policies = case when p_fields ? 'policies' then nullif(btrim(p_fields ->> 'policies'), '') else a.policies end,
    going_concern = case when p_fields ? 'going_concern' then nullif(btrim(p_fields ->> 'going_concern'), '') else a.going_concern end,
    events_after = case when p_fields ? 'events_after' then nullif(btrim(p_fields ->> 'events_after'), '') else a.events_after end,
    related_parties = case when p_fields ? 'related_parties' then nullif(btrim(p_fields ->> 'related_parties'), '') else a.related_parties end,
    other_notes = case when p_fields ? 'other_notes' then nullif(btrim(p_fields ->> 'other_notes'), '') else a.other_notes end,
    approved_by = v_approved_by,
    approved_on = v_approved,
    -- The approval is tied to the close it was given for; re-entering it after a reopen and re-close renews it.
    approved_year_closed_at = case
      when v_approved is null or v_approved_by is null then null
      when (p_fields ? 'approved_on' or p_fields ? 'approved_by') then y.closed_at
      else a.approved_year_closed_at end,
    -- A stale sign-off (the year was reopened) is cleared by the first edit.
    signed_off_name = null, signed_off_qualification = null, signed_off_on = null, signed_off_note = null,
    signed_off_year_closed_at = null, signed_off_by = null, signed_off_at = null,
    updated_by = auth.uid(), updated_at = now()
  where a.id = aa.id;
end;
$$;

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
  if not found or not app.annual_accounts_approved(p_year_id) then
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
  if p_signed_on is null or p_signed_on < aa.approved_on then
    raise exception 'The review date can''t be before the directors approved the accounts (%).', to_char(aa.approved_on, 'DD Mon YYYY') using errcode = 'P0001';
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

create or replace function public.account_movements(p_business_id uuid, p_from date, p_to date)
returns table (account_id uuid, opening_minor bigint, debit_minor bigint, credit_minor bigint, closing_minor bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only owners can see the books.' using errcode = '42501';
  end if;
  return query
  with lines as (
    select l.account_id, l.debit_minor, l.credit_minor, j.effective_date,
      -- Starting position: anything before the period, plus imported figures and opening adjustments.
      (j.effective_date < p_from or j.kind in ('opening_import', 'opening_adjustment')) as is_opening,
      app.is_year_closing(j.source_type) as is_close,
      -- A journal and its reversal, both within the period, cancel out of the gross movements.
      ((j.reversed_by_id is not null and exists (select 1 from public.journals r where r.id = j.reversed_by_id and r.effective_date between p_from and p_to)
          and j.effective_date >= p_from)
        or (j.reverses_id is not null and exists (select 1 from public.journals o where o.id = j.reverses_id and o.effective_date between p_from and p_to)
          and j.effective_date >= p_from)) as is_cancelled
    from public.journal_lines l
    join public.journals j on j.id = l.journal_id
    where l.business_id = p_business_id and j.effective_date <= p_to
  )
  select x.account_id,
    coalesce(sum(case when x.is_opening and not (x.is_close and x.effective_date >= p_from) then x.debit_minor - x.credit_minor end), 0)::bigint,
    coalesce(sum(case when not x.is_opening and not x.is_close and not x.is_cancelled then x.debit_minor end), 0)::bigint,
    coalesce(sum(case when not x.is_opening and not x.is_close and not x.is_cancelled then x.credit_minor end), 0)::bigint,
    coalesce(sum(case when x.effective_date < p_from or not x.is_close then x.debit_minor - x.credit_minor end), 0)::bigint
  from lines x
  group by x.account_id;
end;
$$;
