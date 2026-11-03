-- Business logic, derived money figures and Row Level Security.

-------------------------------------------------------------------------------
-- Money: derived, never typed in
-------------------------------------------------------------------------------

-- Payment status from what is due and what has been received (net of refunds).
-- Mirrored in src/lib/money.ts; keep both in step (tests cover both).
create or replace function app.payment_status(amount_due bigint, net_paid bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when amount_due = 0 and net_paid = 0 then 'settled'
    when net_paid > amount_due then 'overpaid'
    when net_paid = amount_due then 'paid'
    when net_paid > 0 then 'part_paid'
    else 'unpaid'
  end
$$;

create or replace view public.order_summaries
with (security_invoker = true)
as
with item_totals as (
  select business_id, order_id,
    -- sum(bigint) returns numeric; cast back so money stays in whole kobo.
    sum(quantity::bigint * unit_price_minor)::bigint as subtotal,
    count(*) as item_count,
    bool_or(item_type = 'made_to_order') as has_made_to_order
  from public.order_items
  group by business_id, order_id
),
payment_totals as (
  select business_id, order_id,
    (sum(amount_minor) filter (where kind = 'payment'))::bigint as paid,
    (sum(amount_minor) filter (where kind = 'refund'))::bigint as refunded,
    max(paid_on) filter (where kind = 'payment') as last_paid_on
  from public.payments
  where voided_at is null
  group by business_id, order_id
),
figures as (
  select o.*,
    coalesce(i.subtotal, 0) as subtotal_minor,
    greatest(coalesce(i.subtotal, 0) - o.discount_minor, 0) + o.delivery_fee_minor as total_minor,
    coalesce(i.item_count, 0) as item_count,
    coalesce(i.has_made_to_order, false) as has_made_to_order,
    coalesce(p.paid, 0) as paid_minor,
    coalesce(p.refunded, 0) as refunded_minor,
    coalesce(p.paid, 0) - coalesce(p.refunded, 0) as net_paid_minor,
    p.last_paid_on
  from public.orders o
  left join item_totals i on i.business_id = o.business_id and i.order_id = o.id
  left join payment_totals p on p.business_id = o.business_id and p.order_id = o.id
)
select f.*,
  -- A cancelled order owes nothing; anything already paid becomes a refund due.
  case when f.status = 'cancelled' then 0 else f.total_minor end as amount_due_minor,
  (case when f.status = 'cancelled' then 0 else f.total_minor end) - f.net_paid_minor as balance_minor,
  app.payment_status(case when f.status = 'cancelled' then 0 else f.total_minor end, f.net_paid_minor) as payment_status
from figures f;

-------------------------------------------------------------------------------
-- Order numbers: per business, gap-free under concurrency (row lock on business)
-------------------------------------------------------------------------------
create or replace function app.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  prefix text;
begin
  update public.businesses
    set next_order_number = next_order_number + 1
    where id = new.business_id
    returning next_order_number - 1, order_prefix into n, prefix;
  new.order_number := prefix || '-' || lpad(n::text, 5, '0');
  return new;
end;
$$;

create trigger orders_number before insert on public.orders
  for each row execute function app.assign_order_number();

-------------------------------------------------------------------------------
-- Order rules enforced in the database
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
    if not app.is_manager(new.business_id) then
      raise exception 'Only an owner or manager can cancel an order.' using errcode = '42501';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := (select auth.uid());
  end if;

  if new.fulfilment_stage <> old.fulfilment_stage then
    -- Moving an order backwards needs a manager.
    if new.fulfilment_stage < old.fulfilment_stage and not app.is_manager(new.business_id) then
      raise exception 'Only an owner or manager can move an order back a stage.' using errcode = '42501';
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

create trigger orders_guard before update on public.orders
  for each row execute function app.guard_order_update();

-- Items can't change once an order is cancelled or dispatched.
create or replace function app.guard_order_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o record;
begin
  select status, fulfilment_stage into o
  from public.orders
  where id = coalesce(new.order_id, old.order_id);

  if o.status = 'cancelled' then
    raise exception 'This order is cancelled and its items cannot be changed.' using errcode = 'P0001';
  end if;
  if tg_op <> 'UPDATE' or new.quantity <> old.quantity or new.unit_price_minor <> old.unit_price_minor then
    if o.fulfilment_stage >= 'dispatched' then
      raise exception 'Items cannot be changed after the order is dispatched.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger order_items_guard before insert or update on public.order_items
  for each row execute function app.guard_order_items();

-- Payments: no new payments on cancelled orders; refunds can't exceed what was received.
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
    if not app.is_manager(new.business_id) then
      raise exception 'Only an owner or manager can record a refund.' using errcode = '42501';
    end if;
    select coalesce(sum(case when kind = 'payment' then amount_minor else -amount_minor end), 0)
      into net
      from public.payments
      where order_id = new.order_id and voided_at is null;
    if new.amount_minor > net then
      raise exception 'A refund cannot be more than the amount received.' using errcode = 'P0001';
    end if;
  end if;

  new.recorded_by := (select auth.uid());
  new.verification := 'recorded_manually';
  return new;
end;
$$;

create trigger payments_guard_insert before insert on public.payments
  for each row execute function app.guard_payment_insert();

create or replace function app.guard_payment_void()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.voided_at is not null then
    raise exception 'This payment is already voided.' using errcode = 'P0001';
  end if;
  new.voided_at := now();
  new.voided_by := (select auth.uid());
  return new;
end;
$$;

create trigger payments_guard_void before update on public.payments
  for each row execute function app.guard_payment_void();

-- Enquiry stage bookkeeping.
create or replace function app.guard_enquiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.stage <> old.stage then
    new.stage_changed_at := now();
    if new.stage <> 'lost' then
      new.lost_reason := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger enquiries_guard before update on public.enquiries
  for each row execute function app.guard_enquiry();

-------------------------------------------------------------------------------
-- RPC: create an order with its items in one transaction (runs as the caller, so RLS applies)
-------------------------------------------------------------------------------
create or replace function public.create_order(
  p_business_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_idempotency_key uuid,
  p_enquiry_id uuid default null,
  p_channel public.contact_source default null,
  p_promised_date date default null,
  p_discount_minor bigint default 0,
  p_delivery_fee_minor bigint default 0,
  p_delivery_method public.delivery_method default null,
  p_delivery_address text default null,
  p_delivery_city text default null,
  p_delivery_state text default null,
  p_pickup_location text default null,
  p_delivery_instructions text default null,
  p_assigned_to uuid default null,
  p_internal_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_existing uuid;
  v_subtotal bigint := 0;
  v_item jsonb;
begin
  if not app.is_office(p_business_id) then
    raise exception 'You do not have permission to create orders here.' using errcode = '42501';
  end if;

  -- Double-tap protection: the same key returns the order already created.
  select id into v_existing from public.orders
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_enquiry_id is not null then
    select id into v_existing from public.orders where enquiry_id = p_enquiry_id;
    if v_existing is not null then
      raise exception 'An order already exists for this enquiry.' using errcode = '23505', detail = v_existing::text;
    end if;
    perform 1 from public.enquiries
      where id = p_enquiry_id and business_id = p_business_id and customer_id = p_customer_id;
    if not found then
      raise exception 'That enquiry does not belong to this customer.' using errcode = 'P0001';
    end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item.' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_subtotal := v_subtotal + (v_item ->> 'quantity')::bigint * (v_item ->> 'unit_price_minor')::bigint;
  end loop;

  if p_discount_minor > v_subtotal then
    raise exception 'The discount cannot be more than the items total.' using errcode = 'P0001';
  end if;

  insert into public.orders (
    business_id, customer_id, enquiry_id, idempotency_key, channel, promised_date,
    discount_minor, delivery_fee_minor, delivery_method, delivery_address, delivery_city,
    delivery_state, pickup_location, delivery_instructions, assigned_to, internal_notes
  ) values (
    p_business_id, p_customer_id, p_enquiry_id, p_idempotency_key, p_channel, p_promised_date,
    p_discount_minor, p_delivery_fee_minor, p_delivery_method, p_delivery_address, p_delivery_city,
    p_delivery_state, p_pickup_location, p_delivery_instructions, p_assigned_to, p_internal_notes
  )
  returning id into v_order_id;

  insert into public.order_items (
    business_id, order_id, product_id, variant_id, description, size, colour,
    quantity, unit_price_minor, item_type
  )
  select p_business_id, v_order_id,
    nullif(x ->> 'product_id', '')::uuid,
    nullif(x ->> 'variant_id', '')::uuid,
    x ->> 'description',
    nullif(x ->> 'size', ''),
    nullif(x ->> 'colour', ''),
    (x ->> 'quantity')::integer,
    (x ->> 'unit_price_minor')::bigint,
    coalesce(nullif(x ->> 'item_type', ''), 'ready_made')::public.item_type
  from jsonb_array_elements(p_items) as x;

  if p_enquiry_id is not null then
    update public.enquiries set stage = 'won' where id = p_enquiry_id;
  end if;

  return v_order_id;
end;
$$;

revoke all on function public.create_order from public, anon;
grant execute on function public.create_order to authenticated;

-------------------------------------------------------------------------------
-- RPC: onboarding a business (creator becomes owner; trial subscription)
-------------------------------------------------------------------------------
create or replace function public.create_business(
  p_name text,
  p_slug text,
  p_currency char(3) default 'NGN',
  p_timezone text default 'Africa/Lagos',
  p_order_prefix text default 'HC',
  p_is_demo boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'You already own the maximum number of workspaces.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown timezone.' using errcode = 'P0001';
  end if;

  insert into public.businesses (name, slug, currency, timezone, order_prefix, is_demo, created_by)
  values (btrim(p_name), p_slug, upper(p_currency), p_timezone, upper(p_order_prefix), p_is_demo, v_uid)
  returning id into v_id;

  insert into public.memberships (business_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into public.business_subscriptions (business_id, status) values (v_id, 'trial');
  return v_id;
end;
$$;

revoke all on function public.create_business from public, anon;
grant execute on function public.create_business to authenticated;

-------------------------------------------------------------------------------
-- RPCs: staff management (owners only)
-------------------------------------------------------------------------------
create or replace function public.create_invitation(p_business_id uuid, p_email text, p_role public.member_role)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app.has_role(p_business_id, array['owner']::public.member_role[]) then
    raise exception 'Only the business owner can invite staff.' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'Invite as manager, sales or production.' using errcode = 'P0001';
  end if;

  insert into public.invitations (business_id, email, role, token_hash, invited_by)
  values (p_business_id, lower(btrim(p_email)), p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), (select auth.uid()));
  -- The plain token is returned once, to build the invite link. Only its hash is kept.
  return v_token;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower((select auth.jwt()) ->> 'email');
  inv public.invitations;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into inv from public.invitations
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    for update;

  if inv.id is null or inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invitation is invalid or has expired. Ask the owner for a new link.' using errcode = 'P0001';
  end if;
  if inv.email <> v_email then
    raise exception 'This invitation was sent to a different email address.' using errcode = '42501';
  end if;

  insert into public.memberships (business_id, user_id, role, invited_by)
  values (inv.business_id, v_uid, inv.role, inv.invited_by)
  on conflict (business_id, user_id)
    do update set role = excluded.role, status = 'active', deactivated_at = null;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = inv.id;
  return inv.business_id;
end;
$$;

create or replace function public.update_member(
  p_membership_id uuid,
  p_role public.member_role default null,
  p_active boolean default null
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
  if m.id is null or not app.has_role(m.business_id, array['owner']::public.member_role[]) then
    raise exception 'Only the business owner can change staff access.' using errcode = '42501';
  end if;

  update public.memberships set
    role = coalesce(p_role, role),
    status = case when p_active is null then status when p_active then 'active'::public.member_status else 'deactivated'::public.member_status end,
    deactivated_at = case when p_active is false then now() when p_active then null else deactivated_at end
  where id = p_membership_id;

  select count(*) into remaining_owners from public.memberships
    where business_id = m.business_id and role = 'owner' and status = 'active';
  if remaining_owners = 0 then
    raise exception 'A business must keep at least one active owner.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.create_invitation, public.accept_invitation, public.update_member from public, anon;
grant execute on function public.create_invitation, public.accept_invitation, public.update_member to authenticated;

-------------------------------------------------------------------------------
-- RPC: production staff see only their assigned work and what they need to do it
-------------------------------------------------------------------------------
create or replace function public.my_production_jobs(p_business_id uuid)
returns table (
  job_id uuid,
  order_number text,
  item_description text,
  size text,
  colour text,
  quantity integer,
  item_type public.item_type,
  due_date date,
  job_status text,
  job_notes text,
  customer_first_name text,
  bust numeric,
  waist numeric,
  hip numeric,
  measurement_unit public.measurement_unit,
  fit_notes text
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
    and app.is_member(p_business_id)
    and o.status = 'open'
    and (j.assigned_to = (select auth.uid()) or app.is_manager(p_business_id))
  order by j.due_date nulls last
$$;

revoke all on function public.my_production_jobs from public, anon;
grant execute on function public.my_production_jobs to authenticated;

-------------------------------------------------------------------------------
-- New users get a profile
-------------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(left(new.raw_user_meta_data ->> 'full_name', 120), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------
alter table public.businesses enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.plans enable row level security;
alter table public.business_subscriptions enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.enquiries enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.order_returns enable row level security;
alter table public.tasks enable row level security;
alter table public.production_jobs enable row level security;
alter table public.audit_log enable row level security;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- Nobody deletes through the API; records are archived instead.
revoke delete on all tables in schema public from authenticated;

-- Businesses
create policy "members and platform admins read businesses" on public.businesses
  for select to authenticated
  using (app.is_member(id) or app.is_platform_admin());
create policy "owners update business settings" on public.businesses
  for update to authenticated
  using (app.has_role(id, array['owner']::public.member_role[]))
  with check (app.has_role(id, array['owner']::public.member_role[]));
revoke insert, update on public.businesses from authenticated;
grant update (name, logo_path, currency, timezone, order_prefix, stage_labels) on public.businesses to authenticated;

-- Profiles: your own, plus people you work with.
create policy "read own and coworker profiles" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships theirs
      where theirs.user_id = profiles.id and app.is_member(theirs.business_id)
    )
  );
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke insert, update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Platform admins: only they can see the list.
create policy "platform admins read admins" on public.platform_admins
  for select to authenticated using (app.is_platform_admin());
revoke insert, update on public.platform_admins from authenticated;

-- Memberships: members see their colleagues; changes go through RPCs.
create policy "members read memberships" on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or app.is_member(business_id));
revoke insert, update on public.memberships from authenticated;

-- Invitations: owners see their business's invitations; created via RPC.
create policy "owners read invitations" on public.invitations
  for select to authenticated
  using (app.has_role(business_id, array['owner']::public.member_role[]));
create policy "owners revoke invitations" on public.invitations
  for update to authenticated
  using (app.has_role(business_id, array['owner']::public.member_role[]))
  with check (app.has_role(business_id, array['owner']::public.member_role[]));
revoke insert, update on public.invitations from authenticated;
grant update (revoked_at) on public.invitations to authenticated;
-- Never expose token hashes to clients.
revoke select on public.invitations from authenticated;
grant select (id, business_id, email, role, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
  on public.invitations to authenticated;

-- Plans: readable by anyone signed in; managed by platform admins.
create policy "signed-in users read active plans" on public.plans
  for select to authenticated using (is_active or app.is_platform_admin());
create policy "platform admins manage plans" on public.plans
  for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

-- Subscriptions: owners read theirs; platform admins manage (manually).
create policy "owners and platform admins read subscriptions" on public.business_subscriptions
  for select to authenticated
  using (app.has_role(business_id, array['owner']::public.member_role[]) or app.is_platform_admin());
create policy "platform admins update subscriptions" on public.business_subscriptions
  for update to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());
revoke insert on public.business_subscriptions from authenticated;

-- Office records: owners, managers and sales staff. Production staff have no direct access.
create policy "office reads customers" on public.customers
  for select to authenticated using (app.is_office(business_id));
create policy "office creates customers" on public.customers
  for insert to authenticated with check (app.is_office(business_id));
create policy "office updates customers" on public.customers
  for update to authenticated using (app.is_office(business_id)) with check (app.is_office(business_id));

create policy "office reads products" on public.products
  for select to authenticated using (app.is_office(business_id));
create policy "managers create products" on public.products
  for insert to authenticated with check (app.is_manager(business_id));
create policy "managers update products" on public.products
  for update to authenticated using (app.is_manager(business_id)) with check (app.is_manager(business_id));

create policy "office reads variants" on public.product_variants
  for select to authenticated using (app.is_office(business_id));
create policy "managers create variants" on public.product_variants
  for insert to authenticated with check (app.is_manager(business_id));
create policy "managers update variants" on public.product_variants
  for update to authenticated using (app.is_manager(business_id)) with check (app.is_manager(business_id));

create policy "office reads enquiries" on public.enquiries
  for select to authenticated using (app.is_office(business_id));
create policy "office creates enquiries" on public.enquiries
  for insert to authenticated with check (app.is_office(business_id));
create policy "office updates enquiries" on public.enquiries
  for update to authenticated using (app.is_office(business_id)) with check (app.is_office(business_id));

create policy "office reads orders" on public.orders
  for select to authenticated using (app.is_office(business_id));
create policy "office creates orders" on public.orders
  for insert to authenticated with check (app.is_office(business_id));
create policy "office updates orders" on public.orders
  for update to authenticated using (app.is_office(business_id)) with check (app.is_office(business_id));
-- Order numbers, ids and ownership are never edited.
revoke update on public.orders from authenticated;
grant update (
  channel, status, fulfilment_stage, promised_date, delivery_fee_minor, discount_minor,
  delivery_method, delivery_address, delivery_city, delivery_state, pickup_location,
  delivery_instructions, courier_name, tracking_reference, dispatched_at, delivered_at,
  assigned_to, internal_notes, cancel_reason, archived_at
) on public.orders to authenticated;

create policy "office reads order items" on public.order_items
  for select to authenticated using (app.is_office(business_id));
create policy "office creates order items" on public.order_items
  for insert to authenticated with check (app.is_office(business_id));
create policy "office updates order items" on public.order_items
  for update to authenticated using (app.is_office(business_id)) with check (app.is_office(business_id));
revoke update on public.order_items from authenticated;
grant update (description, size, colour, quantity, unit_price_minor, item_type, dispatched_quantity, dispatched_at)
  on public.order_items to authenticated;

create policy "office reads payments" on public.payments
  for select to authenticated using (app.is_office(business_id));
create policy "office records payments" on public.payments
  for insert to authenticated with check (app.is_office(business_id));
-- Only voiding is allowed after recording, and only by owners and managers.
create policy "managers void payments" on public.payments
  for update to authenticated
  using (app.is_manager(business_id) and voided_at is null)
  with check (app.is_manager(business_id));
revoke update on public.payments from authenticated;
grant update (void_reason) on public.payments to authenticated;

create policy "office reads returns" on public.order_returns
  for select to authenticated using (app.is_office(business_id));
create policy "office creates returns" on public.order_returns
  for insert to authenticated with check (app.is_office(business_id));
create policy "office updates returns" on public.order_returns
  for update to authenticated using (app.is_office(business_id)) with check (app.is_office(business_id));
revoke update on public.order_returns from authenticated;
grant update (status, resolution_notes, resolved_at) on public.order_returns to authenticated;

create policy "office reads tasks" on public.tasks
  for select to authenticated using (app.is_office(business_id));
create policy "office creates tasks" on public.tasks
  for insert to authenticated with check (app.is_office(business_id));
create policy "office updates tasks" on public.tasks
  for update to authenticated using (app.is_office(business_id)) with check (app.is_office(business_id));

create policy "office reads production jobs" on public.production_jobs
  for select to authenticated using (app.is_office(business_id));
create policy "managers create production jobs" on public.production_jobs
  for insert to authenticated with check (app.is_manager(business_id));
create policy "managers update production jobs" on public.production_jobs
  for update to authenticated using (app.is_manager(business_id)) with check (app.is_manager(business_id));

-- Audit log: owners and managers read; nobody writes except the trigger.
create policy "managers read audit log" on public.audit_log
  for select to authenticated using (app.is_manager(business_id));
revoke insert, update on public.audit_log from authenticated;
