-- Spec 2 roles.
--   owner              Managing Director / CEO and Creative Director (title on the membership). Full access.
--   front_office       Front Office Manager: customers, enquiries, sales orders, payment records, delivery.
--   production_manager Production Manager / QC: materials, production, purchasing receipts, stock counts, QC.
-- Makers are a directory (no login) and arrive in a later migration.
-- The old 'sales' value can't be dropped from the enum; it is retired by constraint.

alter type public.member_role rename value 'manager' to 'front_office';
alter type public.member_role rename value 'production' to 'production_manager';

update public.memberships set role = 'front_office' where role = 'sales';
update public.invitations set role = 'front_office' where role = 'sales';
alter table public.memberships add constraint memberships_role_not_retired check (role <> 'sales');
alter table public.invitations add constraint invitations_role_not_retired check (role <> 'sales');

alter table public.memberships
  add column title text check (char_length(title) <= 80),
  -- Owner-granted: lets a production manager see costs and stock valuation.
  add column can_view_costs boolean not null default false;

-------------------------------------------------------------------------------
-- Role helpers
-------------------------------------------------------------------------------
create or replace function app.is_owner(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_role(bid, array['owner']::public.member_role[]) $$;

-- Office work: customers, enquiries, sales orders, payment records.
create or replace function app.is_office(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_role(bid, array['owner', 'front_office']::public.member_role[]) $$;

-- Production and stock work: materials, makers, production, receipts, counts.
create or replace function app.is_production(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.has_role(bid, array['owner', 'production_manager']::public.member_role[]) $$;

-- Corrections, refunds, voids, prices, approvals: owners only (Spec 2 §1).
-- Kept under its old name so existing policies keep working with the new meaning.
create or replace function app.is_manager(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select app.is_owner(bid) $$;

-- Costs and valuation: owners, or production managers an owner has allowed.
create or replace function app.can_view_costs(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select app.is_owner(bid) or exists (
    select 1 from public.memberships m
    join public.businesses b on b.id = m.business_id
    where m.business_id = bid and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.role = 'production_manager' and m.can_view_costs and b.archived_at is null
  )
$$;

grant execute on function app.is_owner(uuid), app.is_production(uuid), app.can_view_costs(uuid) to authenticated;

-------------------------------------------------------------------------------
-- Order rules: front office manages orders (cancel, move back); owners do refunds/voids.
-------------------------------------------------------------------------------
create or replace function app.guard_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled' and (new.fulfilment_stage <> old.fulfilment_stage or new.status <> old.status) then
    raise exception 'This order is cancelled and cannot be changed.' using errcode = 'P0001';
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if not app.is_office(new.business_id) then
      raise exception 'Only an owner or the front office can cancel an order.' using errcode = '42501';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := (select auth.uid());
  end if;

  if new.fulfilment_stage <> old.fulfilment_stage then
    if new.fulfilment_stage < old.fulfilment_stage and not app.is_office(new.business_id) then
      raise exception 'Only an owner or the front office can move an order back a stage.' using errcode = '42501';
    end if;
    if new.fulfilment_stage >= 'dispatched' and old.fulfilment_stage < 'dispatched' and new.dispatched_at is null then
      new.dispatched_at := now();
    end if;
    if new.fulfilment_stage = 'delivered' and new.delivered_at is null then
      new.delivered_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- Refund message now names owners.
create or replace function app.guard_payment_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o_status public.order_status;
  net bigint;
begin
  select status into o_status from public.orders where id = new.order_id;

  if new.kind = 'payment' and o_status = 'cancelled' then
    raise exception 'Payments cannot be recorded on a cancelled order. Record a refund instead.' using errcode = 'P0001';
  end if;

  if new.kind = 'refund' then
    if not app.is_owner(new.business_id) then
      raise exception 'Only an owner can record a refund.' using errcode = '42501';
    end if;
    select coalesce(sum(case when kind = 'payment' then amount_minor else -amount_minor end), 0)
      into net from public.payments where order_id = new.order_id and voided_at is null;
    if new.amount_minor > net then
      raise exception 'A refund cannot be more than the amount received.' using errcode = 'P0001';
    end if;
  end if;

  new.recorded_by := (select auth.uid());
  new.verification := 'recorded_manually';
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- Production jobs (placeholder table until the Phase 2 production model)
-------------------------------------------------------------------------------
drop policy if exists "office reads production jobs" on public.production_jobs;
drop policy if exists "managers create production jobs" on public.production_jobs;
drop policy if exists "managers update production jobs" on public.production_jobs;
create policy "office and production read production jobs" on public.production_jobs
  for select to authenticated using (app.is_office(business_id) or app.is_production(business_id));
create policy "production creates production jobs" on public.production_jobs
  for insert to authenticated with check (app.is_production(business_id));
create policy "production updates production jobs" on public.production_jobs
  for update to authenticated using (app.is_production(business_id)) with check (app.is_production(business_id));

create or replace function public.my_production_jobs(p_business_id uuid)
returns table (
  job_id uuid, order_number text, item_description text, size text, colour text, quantity integer,
  item_type public.item_type, due_date date, job_status text, job_notes text, customer_first_name text,
  bust numeric, waist numeric, hip numeric, measurement_unit public.measurement_unit, fit_notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, o.order_number, i.description, i.size, i.colour, i.quantity, i.item_type,
    j.due_date, j.status, j.notes,
    split_part(c.full_name, ' ', 1),
    c.bust, c.waist, c.hip, c.measurement_unit, c.fit_notes
  from public.production_jobs j
  join public.order_items i on i.id = j.order_item_id and i.business_id = j.business_id
  join public.orders o on o.id = i.order_id and o.business_id = j.business_id
  join public.customers c on c.id = o.customer_id and c.business_id = j.business_id
  where j.business_id = p_business_id
    and app.is_production(p_business_id)
    and o.status = 'open'
  order by j.due_date nulls last
$$;

-------------------------------------------------------------------------------
-- Staff management: titles and the cost-visibility permission.
-------------------------------------------------------------------------------
drop function if exists public.update_member(uuid, public.member_role, boolean);
create or replace function public.update_member(
  p_membership_id uuid,
  p_role public.member_role default null,
  p_active boolean default null,
  p_title text default null,
  p_can_view_costs boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.memberships;
  remaining_owners integer;
begin
  select * into m from public.memberships where id = p_membership_id for update;
  if m.id is null or not app.is_owner(m.business_id) then
    raise exception 'Only an owner can change staff access.' using errcode = '42501';
  end if;
  if p_role = 'sales' then
    raise exception 'That role is no longer used.' using errcode = 'P0001';
  end if;

  update public.memberships set
    role = coalesce(p_role, role),
    status = case when p_active is null then status when p_active then 'active'::public.member_status else 'deactivated'::public.member_status end,
    deactivated_at = case when p_active is false then now() when p_active then null else deactivated_at end,
    title = case when p_title is null then title else nullif(btrim(p_title), '') end,
    can_view_costs = coalesce(p_can_view_costs, can_view_costs)
  where id = p_membership_id;

  select count(*) into remaining_owners from public.memberships
    where business_id = m.business_id and role = 'owner' and status = 'active';
  if remaining_owners = 0 then
    raise exception 'A business must keep at least one active owner.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.update_member from public, anon;
grant execute on function public.update_member to authenticated;
comment on function public.update_member is
  'Intentional SECURITY DEFINER: owner-only check inside; keeps at least one active owner.';

-- Owners may invite another owner (Spec 2: two owner accounts).
create or replace function public.create_invitation(p_business_id uuid, p_email text, p_role public.member_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only an owner can invite staff.' using errcode = '42501';
  end if;
  if p_role = 'sales' then
    raise exception 'That role is no longer used.' using errcode = 'P0001';
  end if;
  insert into public.invitations (business_id, email, role, token_hash, invited_by)
  values (p_business_id, lower(btrim(p_email)), p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()));
  return v_token;
end;
$$;
alter table public.invitations drop constraint if exists invitations_role_check;
comment on function public.create_invitation is
  'Intentional SECURITY DEFINER: owner-only check inside; stores only the token hash.';

-- Invitation preview for the accept page (business name and role only, by token).
create or replace function public.invitation_preview(p_token text)
returns table (business_name text, role public.member_role, email text, expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.name, i.role, i.email,
    (i.revoked_at is not null or i.accepted_at is not null or i.expires_at < now())
  from public.invitations i
  join public.businesses b on b.id = i.business_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and (select auth.uid()) is not null
$$;
revoke all on function public.invitation_preview from public, anon;
grant execute on function public.invitation_preview to authenticated;
comment on function public.invitation_preview is
  'Intentional SECURITY DEFINER: needs the secret token; reveals only business name, role and invited email.';
