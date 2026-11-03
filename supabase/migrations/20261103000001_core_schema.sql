-- HaleyH Creations CRM: core multi-business schema.
--
-- Isolation model
--   * Every business-owned row carries business_id.
--   * Row Level Security (RLS) only lets active members of that business see or change it,
--     filtered further by role. Production staff get no direct table access at all.
--   * Composite foreign keys (business_id, id) make cross-business links impossible.
--   * No DELETE policies: records are archived so history survives.
--   * Money is integer minor units (kobo for NGN).

create extension if not exists pgcrypto with schema extensions;

-- Private schema for helpers. Not exposed through the Data API.
create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

-------------------------------------------------------------------------------
-- Enums
-------------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'manager', 'sales', 'production');
create type public.member_status as enum ('active', 'deactivated');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'cancelled');
create type public.contact_source as enum ('instagram', 'whatsapp', 'website', 'walk_in', 'referral', 'other');
create type public.enquiry_stage as enum ('new', 'contacted', 'choosing', 'awaiting_payment', 'won', 'lost');
create type public.product_category as enum ('clothing', 'shoes', 'bags', 'other');
create type public.item_type as enum ('ready_made', 'made_to_order');
create type public.order_status as enum ('open', 'cancelled');
create type public.fulfilment_stage as enum (
  'confirmed', 'in_production', 'quality_check', 'ready_for_dispatch', 'dispatched', 'delivered'
);
create type public.delivery_method as enum ('home_delivery', 'station_pickup', 'store_pickup');
create type public.payment_kind as enum ('payment', 'refund');
create type public.payment_method as enum ('bank_transfer', 'cash', 'pos', 'online', 'other');
create type public.payment_verification as enum ('recorded_manually');
create type public.task_kind as enum (
  'follow_up', 'unpaid_order', 'delivery_confirmation', 'fit_check',
  'complaint', 'alteration', 'return', 'exchange', 'other'
);
create type public.task_status as enum ('open', 'done', 'cancelled');
create type public.return_kind as enum ('return', 'exchange');
create type public.return_status as enum ('open', 'resolved', 'rejected');
create type public.measurement_unit as enum ('cm', 'in');

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- Normalises a phone number for duplicate detection. Nigerian local format
-- (0803...) becomes +234803...; anything else keeps its digits with a leading +.
create or replace function app.normalize_phone(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when raw is null or btrim(raw) = '' then null
    else (
      with d as (select regexp_replace(raw, '\D', '', 'g') as digits)
      select case
        when length(digits) = 0 then null
        when digits like '0%' and length(digits) = 11 then '+234' || substr(digits, 2)
        when digits like '234%' then '+' || digits
        else '+' || digits
      end
      from d
    )
  end
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-------------------------------------------------------------------------------
-- Businesses, people and access
-------------------------------------------------------------------------------
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  currency char(3) not null default 'NGN' check (currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Africa/Lagos',
  logo_path text,
  order_prefix text not null default 'HC' check (order_prefix ~ '^[A-Z0-9]{1,6}$'),
  next_order_number integer not null default 1 check (next_order_number > 0),
  -- Business-specific display names for fulfilment stages, e.g. {"quality_check": "Final fitting"}.
  stage_labels jsonb not null default '{}'::jsonb check (jsonb_typeof(stage_labels) = 'object'),
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  status public.member_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  unique (business_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where status = 'active';

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.member_role not null check (role <> 'owner'),
  -- Only a hash of the invite token is stored.
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_business_idx on public.invitations (business_id);

-------------------------------------------------------------------------------
-- Subscriptions (data model only; managed manually until billing is connected)
-------------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  monthly_price_minor bigint not null default 0 check (monthly_price_minor >= 0),
  currency char(3) not null default 'NGN',
  -- e.g. {"staff": 5, "customers": 2000}
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.business_subscriptions (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  plan_id uuid references public.plans (id),
  status public.subscription_status not null default 'trial',
  trial_ends_at timestamptz default now() + interval '30 days',
  current_period_end timestamptz,
  -- Always true until a payment provider is connected and tested.
  managed_manually boolean not null default true,
  notes text,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

-------------------------------------------------------------------------------
-- Access helpers (security definer so policies don't recurse into memberships RLS)
-------------------------------------------------------------------------------
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
$$;

create or replace function app.member_role(bid uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  join public.businesses b on b.id = m.business_id
  where m.business_id = bid
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and b.archived_at is null
$$;

create or replace function app.is_member(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.member_role(bid) is not null
$$;

create or replace function app.has_role(bid uuid, roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.member_role(bid) = any (roles), false)
$$;

-- Office roles: everyone except production staff.
create or replace function app.is_office(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(bid, array['owner', 'manager', 'sales']::public.member_role[])
$$;

create or replace function app.is_manager(bid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role(bid, array['owner', 'manager']::public.member_role[])
$$;

grant execute on function
  app.is_platform_admin(), app.member_role(uuid), app.is_member(uuid),
  app.has_role(uuid, public.member_role[]), app.is_office(uuid), app.is_manager(uuid),
  app.normalize_phone(text)
to authenticated;

-------------------------------------------------------------------------------
-- Customers
-------------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  phone text check (char_length(phone) <= 40),
  phone_normalized text generated always as (app.normalize_phone(phone)) stored,
  whatsapp text check (char_length(whatsapp) <= 40),
  whatsapp_normalized text generated always as (app.normalize_phone(whatsapp)) stored,
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_normalized text generated always as (lower(btrim(email))) stored,
  address_line text check (char_length(address_line) <= 300),
  city text check (char_length(city) <= 80),
  state text check (char_length(state) <= 80),
  country text not null default 'Nigeria' check (char_length(country) <= 80),
  source public.contact_source,
  clothing_size text check (char_length(clothing_size) <= 20),
  shoe_size text check (char_length(shoe_size) <= 20),
  bust numeric(5, 1) check (bust > 0 and bust < 1000),
  waist numeric(5, 1) check (waist > 0 and waist < 1000),
  hip numeric(5, 1) check (hip > 0 and hip < 1000),
  measurement_unit public.measurement_unit,
  measured_on date,
  preferred_colours text check (char_length(preferred_colours) <= 300),
  preferred_products text check (char_length(preferred_products) <= 300),
  fit_notes text check (char_length(fit_notes) <= 2000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  assigned_to uuid,
  -- Channels the customer is happy to be contacted on.
  contact_preferences text[] not null default '{}'
    check (contact_preferences <@ array['whatsapp', 'phone', 'sms', 'email']::text[]),
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  notes text check (char_length(notes) <= 4000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, assigned_to) references public.memberships (business_id, user_id),
  check ((bust is null and waist is null and hip is null) or measurement_unit is not null)
);
create index customers_business_idx on public.customers (business_id, created_at desc);
create index customers_phone_idx on public.customers (business_id, phone_normalized);
create index customers_whatsapp_idx on public.customers (business_id, whatsapp_normalized);
create index customers_email_idx on public.customers (business_id, email_normalized);
create index customers_name_idx on public.customers (business_id, lower(full_name));

-------------------------------------------------------------------------------
-- Products
-------------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category public.product_category not null default 'clothing',
  sku text check (char_length(sku) <= 60),
  description text check (char_length(description) <= 2000),
  base_price_minor bigint not null default 0 check (base_price_minor >= 0),
  default_item_type public.item_type not null default 'ready_made',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id)
);
create index products_business_idx on public.products (business_id, lower(name));

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  size text check (char_length(size) <= 30),
  colour text check (char_length(colour) <= 40),
  sku text check (char_length(sku) <= 60),
  price_minor bigint check (price_minor >= 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id)
);
create index product_variants_product_idx on public.product_variants (business_id, product_id);

-------------------------------------------------------------------------------
-- Enquiries
-------------------------------------------------------------------------------
create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  customer_id uuid not null,
  product_interest text check (char_length(product_interest) <= 300),
  product_id uuid,
  source public.contact_source,
  stage public.enquiry_stage not null default 'new',
  -- Ordering within a pipeline column.
  position double precision not null default extract(epoch from now()),
  assigned_to uuid,
  notes text check (char_length(notes) <= 4000),
  next_action text check (char_length(next_action) <= 300),
  follow_up_at timestamptz,
  lost_reason text check (char_length(lost_reason) <= 300),
  stage_changed_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, assigned_to) references public.memberships (business_id, user_id),
  check (stage <> 'lost' or lost_reason is not null)
);
create index enquiries_pipeline_idx on public.enquiries (business_id, stage, position) where archived_at is null;
create index enquiries_follow_up_idx on public.enquiries (business_id, follow_up_at)
  where archived_at is null and stage not in ('won', 'lost');
create index enquiries_customer_idx on public.enquiries (business_id, customer_id);

-------------------------------------------------------------------------------
-- Orders
-------------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  order_number text not null,
  customer_id uuid not null,
  -- At most one order per enquiry, so a won enquiry can't be converted twice.
  enquiry_id uuid unique,
  -- Client-generated key that makes "Create order" safe to double-tap.
  idempotency_key uuid,
  channel public.contact_source,
  status public.order_status not null default 'open',
  fulfilment_stage public.fulfilment_stage not null default 'confirmed',
  order_date date not null default (now() at time zone 'Africa/Lagos')::date,
  promised_date date,
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  delivery_method public.delivery_method,
  delivery_address text check (char_length(delivery_address) <= 300),
  delivery_city text check (char_length(delivery_city) <= 80),
  delivery_state text check (char_length(delivery_state) <= 80),
  pickup_location text check (char_length(pickup_location) <= 300),
  delivery_instructions text check (char_length(delivery_instructions) <= 500),
  courier_name text check (char_length(courier_name) <= 80),
  tracking_reference text check (char_length(tracking_reference) <= 120),
  dispatched_at timestamptz,
  delivered_at timestamptz,
  assigned_to uuid,
  internal_notes text check (char_length(internal_notes) <= 4000),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  cancel_reason text check (char_length(cancel_reason) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  unique (business_id, order_number),
  unique (business_id, idempotency_key),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, enquiry_id) references public.enquiries (business_id, id),
  foreign key (business_id, assigned_to) references public.memberships (business_id, user_id),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index orders_business_idx on public.orders (business_id, order_date desc);
create index orders_stage_idx on public.orders (business_id, fulfilment_stage) where status = 'open' and archived_at is null;
create index orders_promised_idx on public.orders (business_id, promised_date) where status = 'open' and archived_at is null;
create index orders_customer_idx on public.orders (business_id, customer_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  product_id uuid,
  variant_id uuid,
  description text not null check (char_length(btrim(description)) between 1 and 200),
  size text check (char_length(size) <= 30),
  colour text check (char_length(colour) <= 40),
  quantity integer not null check (quantity between 1 and 10000),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  item_type public.item_type not null default 'ready_made',
  -- Partial fulfilment: items can be dispatched separately.
  dispatched_quantity integer not null default 0,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, order_id) references public.orders (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, variant_id) references public.product_variants (business_id, id),
  check (dispatched_quantity between 0 and quantity)
);
create index order_items_order_idx on public.order_items (business_id, order_id);

-------------------------------------------------------------------------------
-- Payments (manually recorded; never card details)
-------------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  kind public.payment_kind not null default 'payment',
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  paid_on date not null default (now() at time zone 'Africa/Lagos')::date,
  method public.payment_method not null,
  reference text check (char_length(reference) <= 120),
  notes text check (char_length(notes) <= 1000),
  verification public.payment_verification not null default 'recorded_manually',
  recorded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  -- Mistakes are voided with a reason, never edited or deleted.
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (char_length(void_reason) <= 500),
  unique (business_id, id),
  foreign key (business_id, order_id) references public.orders (business_id, id),
  check ((voided_at is null) = (void_reason is null))
);
create index payments_order_idx on public.payments (business_id, order_id);
create index payments_date_idx on public.payments (business_id, paid_on) where voided_at is null;

-------------------------------------------------------------------------------
-- Returns and exchanges (the original order is never altered or deleted)
-------------------------------------------------------------------------------
create table public.order_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid not null,
  kind public.return_kind not null,
  status public.return_status not null default 'open',
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  resolution_notes text check (char_length(resolution_notes) <= 2000),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, order_id) references public.orders (business_id, id)
);

-------------------------------------------------------------------------------
-- Follow-up tasks
-------------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind public.task_kind not null default 'follow_up',
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text check (char_length(notes) <= 2000),
  due_at timestamptz,
  status public.task_status not null default 'open',
  assigned_to uuid,
  customer_id uuid,
  enquiry_id uuid,
  order_id uuid,
  completed_at timestamptz,
  completed_by uuid references auth.users (id),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, assigned_to) references public.memberships (business_id, user_id),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, enquiry_id) references public.enquiries (business_id, id),
  foreign key (business_id, order_id) references public.orders (business_id, id)
);
create index tasks_due_idx on public.tasks (business_id, due_at) where status = 'open';
create index tasks_assignee_idx on public.tasks (business_id, assigned_to) where status = 'open';

-------------------------------------------------------------------------------
-- Production jobs (what production staff are allowed to see)
-------------------------------------------------------------------------------
create table public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_item_id uuid not null,
  assigned_to uuid,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (order_item_id),
  foreign key (business_id, order_item_id) references public.order_items (business_id, id),
  foreign key (business_id, assigned_to) references public.memberships (business_id, user_id)
);

-------------------------------------------------------------------------------
-- Audit log (append-only)
-------------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor uuid,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);
create index audit_log_record_idx on public.audit_log (business_id, table_name, record_id, changed_at desc);

create or replace function app.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  rec_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec jsonb := coalesce(rec_new, rec_old);
begin
  -- Skip no-op updates.
  if tg_op = 'UPDATE' and rec_old - 'updated_at' = rec_new - 'updated_at' then
    return new;
  end if;

  insert into public.audit_log (business_id, table_name, record_id, action, actor, old_data, new_data)
  values (
    (rec ->> 'business_id')::uuid,
    tg_table_name,
    (rec ->> 'id')::uuid,
    lower(tg_op),
    (select auth.uid()),
    rec_old,
    rec_new
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_orders after insert or update or delete on public.orders
  for each row execute function app.write_audit();
create trigger audit_order_items after insert or update or delete on public.order_items
  for each row execute function app.write_audit();
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function app.write_audit();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function app.write_audit();
create trigger audit_order_returns after insert or update or delete on public.order_returns
  for each row execute function app.write_audit();
create trigger audit_invitations after insert or update on public.invitations
  for each row execute function app.write_audit();

-------------------------------------------------------------------------------
-- updated_at triggers
-------------------------------------------------------------------------------
create trigger touch_businesses before update on public.businesses for each row execute function app.touch_updated_at();
create trigger touch_profiles before update on public.profiles for each row execute function app.touch_updated_at();
create trigger touch_memberships before update on public.memberships for each row execute function app.touch_updated_at();
create trigger touch_customers before update on public.customers for each row execute function app.touch_updated_at();
create trigger touch_products before update on public.products for each row execute function app.touch_updated_at();
create trigger touch_enquiries before update on public.enquiries for each row execute function app.touch_updated_at();
create trigger touch_orders before update on public.orders for each row execute function app.touch_updated_at();
create trigger touch_order_items before update on public.order_items for each row execute function app.touch_updated_at();
create trigger touch_order_returns before update on public.order_returns for each row execute function app.touch_updated_at();
create trigger touch_tasks before update on public.tasks for each row execute function app.touch_updated_at();
create trigger touch_production_jobs before update on public.production_jobs for each row execute function app.touch_updated_at();
