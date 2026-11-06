-- Owner requests (2026-11-06):
-- 1. A cost price on each product (and optionally each size/colour), so profit can be worked out when an item
--    has no production or purchase cost in the ledger. The ledger cost always wins where there is one.
-- 2. Repairs: their own records, separate from orders: stages, a maker, a charge and payments recorded manually.

-------------------------------------------------------------------------------
-- 1. Product cost prices (cost data: owners, and production managers an owner allows, can read them)
-------------------------------------------------------------------------------
create table public.product_costs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  cost_minor bigint not null check (cost_minor >= 0 and cost_minor <= 100000000000),
  updated_by uuid default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, product_id) references public.products (business_id, id),
  foreign key (business_id, variant_id) references public.product_variants (business_id, id)
);
create unique index product_costs_product_key on public.product_costs (product_id) where variant_id is null;
create unique index product_costs_variant_key on public.product_costs (variant_id) where variant_id is not null;
alter table public.product_costs enable row level security;
create policy "cost viewers read product costs" on public.product_costs
  for select to authenticated using (app.can_view_costs(business_id));
revoke insert, update, delete on public.product_costs from authenticated;
create trigger audit_product_costs after insert or update or delete on public.product_costs
  for each row execute function app.write_audit();

-- Owners set (or clear, with null) the cost price of a product, or of one of its variants.
create or replace function public.set_product_cost(p_product uuid, p_variant uuid, p_cost_minor bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_business uuid;
begin
  select business_id into v_business from public.products where id = p_product;
  if v_business is null or not app.is_owner(v_business) then
    raise exception 'Only an owner can set cost prices.' using errcode = '42501';
  end if;
  if p_variant is not null and not exists (select 1 from public.product_variants where id = p_variant and product_id = p_product) then
    raise exception 'That size or colour belongs to another product.' using errcode = 'P0001';
  end if;
  if p_cost_minor is not null and (p_cost_minor < 0 or p_cost_minor > 100000000000) then
    raise exception 'Enter the cost price in naira, like 15000.' using errcode = 'P0001';
  end if;
  if p_cost_minor is null then
    delete from public.product_costs where product_id = p_product and variant_id is not distinct from p_variant;
  elsif p_variant is null then
    insert into public.product_costs (business_id, product_id, variant_id, cost_minor) values (v_business, p_product, null, p_cost_minor)
    on conflict (product_id) where variant_id is null do update set cost_minor = excluded.cost_minor, updated_by = (select auth.uid()), updated_at = now();
  else
    insert into public.product_costs (business_id, product_id, variant_id, cost_minor) values (v_business, p_product, p_variant, p_cost_minor)
    on conflict (variant_id) where variant_id is not null do update set cost_minor = excluded.cost_minor, updated_by = (select auth.uid()), updated_at = now();
  end if;
end;
$$;
revoke all on function public.set_product_cost from public, anon;
grant execute on function public.set_product_cost to authenticated;
comment on function public.set_product_cost is 'Intentional SECURITY DEFINER: owners only.';

-- The cost price that applies to a finished-goods stock item: its variant's, else its product's (kobo, or null).
create or replace function app.stock_item_cost_price(p_item uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.cost_minor from public.product_costs c where c.variant_id = s.variant_id),
    (select c.cost_minor from public.product_costs c join public.product_variants v on v.product_id = c.product_id
      where v.id = s.variant_id and c.variant_id is null))::numeric
  from public.stock_items s where s.id = p_item
$$;
revoke all on function app.stock_item_cost_price from public, anon, authenticated;

-- Order profit: ledger cost of what went out; where an item had none, its product's cost price.
create or replace function public.order_profit(p_order uuid)
returns table (fulfilled_value bigint, cogs numeric, gross_profit numeric, cost_complete boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select * from public.order_summaries where id = p_order and app.is_owner(business_id)
  ),
  sold as (
    -- Price × (dispatched − returned), with the order discount shared across lines by value.
    select round(coalesce(sum(i.unit_price_minor::bigint * (i.dispatched_quantity
      - coalesce((select sum(quantity) from public.order_return_lines rl where rl.order_item_id = i.id), 0))), 0)
      * (1 - coalesce((select o2.discount_minor::numeric / nullif(o2.subtotal_minor, 0) from o o2), 0)))::bigint as v,
      bool_and(app.order_item_stock_item(i.id) is not null or i.dispatched_quantity = 0) as all_stock
    from public.order_items i where i.order_id = p_order
  ),
  moves as (
    select m.quantity, case when m.unit_cost > 0 then m.unit_cost else app.stock_item_cost_price(m.stock_item_id) end as unit_cost
    from public.stock_movements m
    join public.stock_documents d on d.id = m.document_id
    where (d.source_type = 'order_dispatch' and d.source_id in (select id from public.order_dispatches where order_id = p_order))
       or (d.source_type = 'order_return' and d.source_id in (select id from public.order_returns where order_id = p_order))
  ),
  cost as (
    select coalesce(sum(-quantity * coalesce(unit_cost, 0)), 0) as v,
      -- Complete only if every unit that went out (or came back) had a cost: from the ledger or a cost price.
      coalesce(bool_and(coalesce(unit_cost, 0) > 0), true) as complete
    from moves
  )
  select sold.v, cost.v, sold.v - cost.v, cost.complete and sold.all_stock
  from o, sold, cost
$$;

-- Sales and gross-profit reports: the same fallback to the product's cost price.
create or replace function public.report_sales_by_product(p_business_id uuid, p_from date, p_to date)
returns table (product text, units numeric, sales numeric, cogs numeric, gross_profit numeric, cost_complete boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner boolean := app.is_owner(p_business_id);
begin
  perform app.require_office(p_business_id);
  return query
  with lines as (
    select dl.order_item_id, dl.quantity::numeric as qty, d.document_id, d.order_id
    from public.order_dispatch_lines dl join public.order_dispatches d on d.id = dl.dispatch_id
    where d.business_id = p_business_id and d.dispatched_on between p_from and p_to
    union all
    select rl.order_item_id, -rl.quantity::numeric, r.document_id, r.order_id
    from public.order_return_lines rl join public.order_returns r on r.id = rl.return_id
    where r.business_id = p_business_id and r.received_on between p_from and p_to
  ),
  priced as (
    select coalesce(app.variant_label(i.variant_id), i.description) as name, l.qty,
      l.qty * i.unit_price_minor * (1 - coalesce(s.discount_minor::numeric / nullif(s.subtotal_minor, 0), 0)) as value,
      -- The ledger cost of what went out; where it had none, the product's cost price.
      coalesce(nullif((select sum(abs(m.quantity) * m.unit_cost) / nullif(sum(abs(m.quantity)), 0) from public.stock_movements m
        where m.document_id = l.document_id and m.stock_item_id = app.order_item_stock_item(l.order_item_id)), 0),
        app.stock_item_cost_price(app.order_item_stock_item(l.order_item_id))) as unit_cost
    from lines l
    join public.order_items i on i.id = l.order_item_id
    join public.order_summaries s on s.id = l.order_id
  )
  select p.name, sum(p.qty), round(sum(p.value)),
    case when v_owner then round(sum(p.qty * coalesce(p.unit_cost, 0))) end,
    case when v_owner then round(sum(p.value) - sum(p.qty * coalesce(p.unit_cost, 0))) end,
    case when v_owner then bool_and(coalesce(p.unit_cost, 0) > 0) end
  from priced p group by p.name order by 3 desc nulls last;
end;
$$;

create or replace function public.report_gross_profit(p_business_id uuid, p_from date, p_to date)
returns table (order_number text, customer text, fulfilled_sales numeric, cogs numeric, gross_profit numeric, margin_pct numeric, cost_complete boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_business_id);
  return query
  with lines as (
    select dl.order_item_id, dl.quantity::numeric as qty, d.document_id, d.order_id
    from public.order_dispatch_lines dl join public.order_dispatches d on d.id = dl.dispatch_id
    where d.business_id = p_business_id and d.dispatched_on between p_from and p_to
    union all
    select rl.order_item_id, -rl.quantity::numeric, r.document_id, r.order_id
    from public.order_return_lines rl join public.order_returns r on r.id = rl.return_id
    where r.business_id = p_business_id and r.received_on between p_from and p_to
  ),
  priced as (
    select l.order_id, l.qty,
      l.qty * i.unit_price_minor * (1 - coalesce(s.discount_minor::numeric / nullif(s.subtotal_minor, 0), 0)) as value,
      -- The ledger cost of what went out; where it had none, the product's cost price.
      coalesce(nullif((select sum(abs(m.quantity) * m.unit_cost) / nullif(sum(abs(m.quantity)), 0) from public.stock_movements m
        where m.document_id = l.document_id and m.stock_item_id = app.order_item_stock_item(l.order_item_id)), 0),
        app.stock_item_cost_price(app.order_item_stock_item(l.order_item_id))) as unit_cost
    from lines l
    join public.order_items i on i.id = l.order_item_id
    join public.order_summaries s on s.id = l.order_id
  ),
  per_order as (
    select p.order_id, sum(p.value) as value, sum(p.qty * coalesce(p.unit_cost, 0)) as cogs, bool_and(coalesce(p.unit_cost, 0) > 0) as complete
    from priced p group by p.order_id
  )
  select s.order_number, c.full_name, round(o.value), round(o.cogs), round(o.value - o.cogs),
    round(100 * (o.value - o.cogs) / nullif(o.value, 0), 1), o.complete
  from per_order o
  join public.order_summaries s on s.id = o.order_id
  join public.customers c on c.id = s.customer_id
  order by 5 desc nulls last;
end;
$$;

-------------------------------------------------------------------------------
-- 2. Repairs (separate from orders)
-------------------------------------------------------------------------------
alter table public.businesses add column next_repair_number integer not null default 1 check (next_repair_number > 0);

create table public.repairs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  number text not null,
  customer_id uuid not null,
  item text not null check (char_length(btrim(item)) between 1 and 200),
  problem text not null check (char_length(btrim(problem)) between 1 and 2000),
  received_on date not null,
  promised_date date,
  status text not null default 'received' check (status in ('received', 'in_repair', 'ready', 'collected', 'cancelled')),
  maker_id uuid,
  charge_minor bigint not null default 0 check (charge_minor >= 0 and charge_minor <= 100000000000),
  notes text check (char_length(notes) <= 2000),
  ready_at timestamptz,
  collected_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  foreign key (business_id, customer_id) references public.customers (business_id, id),
  foreign key (business_id, maker_id) references public.makers (business_id, id)
);
create index repairs_business_status_idx on public.repairs (business_id, status, promised_date);
create index repairs_customer_idx on public.repairs (business_id, customer_id);

create table public.repair_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  repair_id uuid not null,
  kind public.payment_kind not null default 'payment',
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  paid_on date not null,
  method public.payment_method not null,
  reference text check (char_length(reference) <= 120),
  verification public.payment_verification not null default 'recorded_manually',
  recorded_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  void_reason text check (char_length(void_reason) <= 500),
  unique (business_id, id),
  foreign key (business_id, repair_id) references public.repairs (business_id, id),
  check ((voided_at is null) = (void_reason is null))
);
create index repair_payments_repair_idx on public.repair_payments (business_id, repair_id);

-- Money is derived: received (net of refunds, voided excluded) and the balance still owed.
create view public.repair_summaries with (security_invoker = true) as
select r.*,
  coalesce(p.net_paid, 0)::bigint as net_paid_minor,
  -- A cancelled repair owes nothing; anything received shows as negative (to refund).
  ((case when r.status = 'cancelled' then 0 else r.charge_minor end) - coalesce(p.net_paid, 0))::bigint as balance_minor
from public.repairs r
left join lateral (
  select sum(case when y.kind = 'refund' then -y.amount_minor else y.amount_minor end) as net_paid
  from public.repair_payments y where y.repair_id = r.id and y.voided_at is null
) p on true;

alter table public.repairs enable row level security;
alter table public.repair_payments enable row level security;
create policy "office reads repairs" on public.repairs for select to authenticated using (app.is_office(business_id));
create policy "office reads repair payments" on public.repair_payments for select to authenticated using (app.is_office(business_id));
-- Every change goes through the functions below.
revoke insert, update, delete on public.repairs, public.repair_payments from authenticated;
grant select on public.repair_summaries to authenticated;
create trigger audit_repairs after insert or update on public.repairs for each row execute function app.write_audit();
create trigger audit_repair_payments after insert or update on public.repair_payments for each row execute function app.write_audit();

create or replace function app.lock_repair(p_repair uuid)
returns public.repairs language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs;
begin
  select * into r from public.repairs where id = p_repair;
  if r.id is null or not (app.is_office(r.business_id) or app.is_production(r.business_id)) then
    raise exception 'Repair not found.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = r.business_id for update;
  select * into r from public.repairs where id = p_repair for update;
  return r;
end;
$$;
revoke all on function app.lock_repair from public, anon, authenticated;

create or replace function public.create_repair(
  p_business_id uuid, p_customer_id uuid, p_item text, p_problem text, p_received_on date, p_promised_date date,
  p_charge_minor bigint, p_maker_id uuid, p_notes text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_id uuid;
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
begin
  if not app.is_office(p_business_id) then
    raise exception 'Only owners and the front office record repairs.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and business_id = p_business_id) then
    raise exception 'Choose the customer.' using errcode = 'P0001';
  end if;
  if p_maker_id is not null and not exists (select 1 from public.makers where id = p_maker_id and business_id = p_business_id and archived_at is null) then
    raise exception 'Choose a maker from the list.' using errcode = 'P0001';
  end if;
  if coalesce(p_received_on, v_today) > v_today then
    raise exception 'The received date can''t be in the future.' using errcode = 'P0001';
  end if;
  if p_promised_date is not null and p_promised_date < coalesce(p_received_on, v_today) then
    raise exception 'The promised date is before the item was received.' using errcode = 'P0001';
  end if;
  update public.businesses set next_repair_number = next_repair_number + 1 where id = p_business_id
    returning next_repair_number - 1 into v_n;
  insert into public.repairs (business_id, number, customer_id, item, problem, received_on, promised_date, charge_minor, maker_id, notes)
  values (p_business_id, 'RP-' || lpad(v_n::text, 5, '0'), p_customer_id, btrim(p_item), btrim(p_problem),
    coalesce(p_received_on, v_today), p_promised_date, coalesce(p_charge_minor, 0), p_maker_id, nullif(btrim(p_notes), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Details, charge and maker (front office or owner) while the repair is still open.
create or replace function public.update_repair(
  p_repair uuid, p_item text, p_problem text, p_promised_date date, p_charge_minor bigint, p_maker_id uuid, p_notes text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs := app.lock_repair(p_repair);
begin
  if not app.is_office(r.business_id) then
    raise exception 'Only owners and the front office change repair details.' using errcode = '42501';
  end if;
  if r.status in ('collected', 'cancelled') then
    raise exception 'This repair is closed.' using errcode = 'P0001';
  end if;
  if p_maker_id is not null and p_maker_id is distinct from r.maker_id
     and not exists (select 1 from public.makers where id = p_maker_id and business_id = r.business_id and archived_at is null) then
    raise exception 'Choose a maker from the list.' using errcode = 'P0001';
  end if;
  if p_promised_date is not null and p_promised_date < r.received_on then
    raise exception 'The promised date is before the item was received.' using errcode = 'P0001';
  end if;
  update public.repairs set item = btrim(p_item), problem = btrim(p_problem), promised_date = p_promised_date,
    charge_minor = coalesce(p_charge_minor, 0), maker_id = p_maker_id, notes = nullif(btrim(p_notes), ''), updated_at = now()
  where id = p_repair;
end;
$$;

-- The production manager (or the office) gives the repair to a maker.
create or replace function public.assign_repair_maker(p_repair uuid, p_maker_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs := app.lock_repair(p_repair);
begin
  if r.status in ('collected', 'cancelled') then
    raise exception 'This repair is closed.' using errcode = 'P0001';
  end if;
  if p_maker_id is not null and not exists (select 1 from public.makers where id = p_maker_id and business_id = r.business_id and archived_at is null) then
    raise exception 'Choose a maker from the list.' using errcode = 'P0001';
  end if;
  update public.repairs set maker_id = p_maker_id, updated_at = now() where id = p_repair;
end;
$$;

-- Stages: received → in repair → ready → collected. Production can move work along up to "ready";
-- only the office hands it back (collected) or cancels.
create or replace function public.set_repair_status(p_repair uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs := app.lock_repair(p_repair);
  v_office boolean := app.is_office(r.business_id);
begin
  if r.status = p_status then return; end if; -- double tap
  if r.status in ('collected', 'cancelled') then
    raise exception 'This repair is closed.' using errcode = 'P0001';
  end if;
  if p_status in ('collected', 'cancelled') and not v_office then
    raise exception 'Only owners and the front office close repairs.' using errcode = '42501';
  end if;
  if not ((r.status = 'received' and p_status in ('in_repair', 'ready'))
       or (r.status = 'in_repair' and p_status in ('ready', 'received'))
       or (r.status = 'ready' and p_status in ('collected', 'in_repair'))
       or p_status = 'cancelled') then
    raise exception 'A repair can''t go from % to % directly.', replace(r.status, '_', ' '), replace(p_status, '_', ' ') using errcode = 'P0001';
  end if;
  if p_status = 'cancelled' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling.' using errcode = 'P0001';
  end if;
  update public.repairs set status = p_status, updated_at = now(),
    ready_at = case when p_status = 'ready' then now() when p_status in ('received', 'in_repair') then null else ready_at end,
    collected_at = case when p_status = 'collected' then now() else collected_at end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when p_status = 'cancelled' then left(btrim(p_reason), 500) else cancel_reason end
  where id = p_repair;
end;
$$;

-- Payments and refunds, recorded manually (never verified against the bank). Refunds: owners only.
create or replace function public.record_repair_payment(
  p_repair uuid, p_kind public.payment_kind, p_amount_minor bigint, p_method public.payment_method, p_paid_on date, p_reference text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs := app.lock_repair(p_repair);
  v_paid bigint;
  v_id uuid;
  v_today date := (now() at time zone app.business_tz(r.business_id))::date;
begin
  if not app.is_office(r.business_id) then
    raise exception 'Only owners and the front office record repair payments.' using errcode = '42501';
  end if;
  if p_kind = 'refund' and not app.is_owner(r.business_id) then
    raise exception 'Only an owner can record a refund.' using errcode = '42501';
  end if;
  if r.status = 'cancelled' and p_kind = 'payment' then
    raise exception 'This repair is cancelled.' using errcode = 'P0001';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Enter the amount.' using errcode = 'P0001';
  end if;
  if coalesce(p_paid_on, v_today) > v_today then
    raise exception 'The payment date can''t be in the future.' using errcode = 'P0001';
  end if;
  if p_kind = 'refund' then
    select coalesce(sum(case when kind = 'refund' then -amount_minor else amount_minor end), 0) into v_paid
    from public.repair_payments where repair_id = p_repair and voided_at is null;
    if p_amount_minor > v_paid then
      raise exception 'You can''t refund more than was received.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.repair_payments (business_id, repair_id, kind, amount_minor, paid_on, method, reference)
  values (r.business_id, p_repair, p_kind, p_amount_minor, coalesce(p_paid_on, v_today), p_method, nullif(btrim(p_reference), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.void_repair_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  y public.repair_payments;
  -- (locks the repair below, like every other repair change)
begin
  select * into y from public.repair_payments where id = p_payment;
  if y.id is null or not app.is_owner(y.business_id) then
    raise exception 'Only an owner can void a payment.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  perform app.lock_repair(y.repair_id);
  select * into y from public.repair_payments where id = p_payment;
  if y.voided_at is not null then return; end if;
  if y.kind = 'payment' and (
    select coalesce(sum(case when kind = 'refund' then -amount_minor else amount_minor end), 0)
    from public.repair_payments where repair_id = y.repair_id and voided_at is null and id <> y.id) < 0 then
    raise exception 'Void the refund first: without this payment, more would have been refunded than received.' using errcode = 'P0001';
  end if;
  update public.repair_payments set voided_at = now(), voided_by = (select auth.uid()), void_reason = left(btrim(p_reason), 500)
  where id = p_payment and voided_at is null;
end;
$$;

-- What production sees: the work, not the customer or the money.
create or replace function public.production_repairs(p_business_id uuid)
returns table (id uuid, number text, item text, problem text, status text, maker_id uuid, maker text, received_on date, promised_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_production(p_business_id) then
    raise exception 'This list is for owners and the production manager.' using errcode = '42501';
  end if;
  return query
  select r.id, r.number, r.item, r.problem, r.status, r.maker_id, m.name, r.received_on, r.promised_date
  from public.repairs r left join public.makers m on m.id = r.maker_id
  where r.business_id = p_business_id and r.status in ('received', 'in_repair', 'ready')
  order by r.promised_date nulls last, r.number;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_repair(uuid,uuid,text,text,date,date,bigint,uuid,text)', 'update_repair(uuid,text,text,date,bigint,uuid,text)',
    'assign_repair_maker(uuid,uuid)', 'set_repair_status(uuid,text,text)',
    'record_repair_payment(uuid,public.payment_kind,bigint,public.payment_method,date,text)', 'void_repair_payment(uuid,text)',
    'production_repairs(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('comment on function public.%s is %L', f, 'Intentional SECURITY DEFINER: checks the caller''s role and business first.');
  end loop;
end $$;

-- Notifications: repairs ready for collection or late (office), and repairs with no maker (production).
create or replace function public.my_notifications(p_business_id uuid)
returns table (kind text, severity text, title text, detail text, ref_type text, ref_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
  v_office boolean := app.is_office(p_business_id);
  v_prod boolean := app.is_production(p_business_id);
  v_owner boolean := app.is_owner(p_business_id);
begin
  if not (v_office or v_prod) then
    return;
  end if;

  if v_office then
    return query
    select 'order_late'::text, 'danger'::text, s.order_number || ' is past its promised date',
      c.full_name || ' · promised ' || to_char(s.promised_date, 'DD Mon'), 'order'::text, s.id
    from public.order_summaries s join public.customers c on c.id = s.customer_id
    where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
      and s.fulfilment_stage not in ('dispatched', 'delivered') and s.promised_date < v_today;
    return query
    select 'order_ready', 'info', s.order_number || ' is ready to dispatch', c.full_name, 'order', s.id
    from public.order_summaries s join public.customers c on c.id = s.customer_id
    where s.business_id = p_business_id and s.status = 'open' and s.fulfilment_stage = 'ready_for_dispatch';
    return query
    select 'return_inspect', 'warn', r.number || ': returned items waiting for inspection', o.order_number, 'order', o.id
    from public.order_returns r join public.orders o on o.id = r.order_id
    where r.business_id = p_business_id and exists (select 1 from public.order_return_lines l where l.return_id = r.id and l.decision is null);
  end if;

  if v_office then
    return query
    select 'repair_ready', 'info', r.number || ' is ready for collection', c.full_name || ' · ' || r.item, 'repair', r.id
    from public.repairs r join public.customers c on c.id = r.customer_id
    where r.business_id = p_business_id and r.status = 'ready';
    return query
    select 'repair_late', 'danger', r.number || ' is past its promised date', c.full_name || ' · ' || r.item || ' · promised ' || to_char(r.promised_date, 'DD Mon'), 'repair', r.id
    from public.repairs r join public.customers c on c.id = r.customer_id
    where r.business_id = p_business_id and r.status in ('received', 'in_repair') and r.promised_date < v_today;
  end if;

  if v_prod then
    -- A repair nobody has been given yet (no customer details for production).
    return query
    select 'repair_unassigned', 'warn', r.number || ' needs a maker', r.item || coalesce(' · promised ' || to_char(r.promised_date, 'DD Mon'), ''), 'repair', r.id
    from public.repairs r
    where r.business_id = p_business_id and r.status in ('received', 'in_repair') and r.maker_id is null;
    -- New work: a job (often straight from a confirmed order) that has no maker yet, or no materials planned.
    return query
    select 'job_unassigned', 'warn', j.number || ' needs a maker',
      coalesce(s.name, 'Job') || coalesce(' · for ' || o.order_number, '') || coalesce(' · due ' || to_char(j.due_date, 'DD Mon'), ''), 'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
      left join public.order_items oi on oi.id = j.order_item_id left join public.orders o on o.id = oi.order_id
    where j.business_id = p_business_id and j.status in ('planned', 'allocated') and j.maker_id is null;
    return query
    select 'job_no_materials', 'warn', j.number || ' has no materials planned',
      coalesce(s.name, 'Job') || ' · add them on the job, or give the product a recipe', 'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and j.status = 'planned'
      and not exists (select 1 from public.job_materials m where m.job_id = j.id);
    return query
    select 'job_overdue', 'danger', j.number || ' is overdue', coalesce(s.name, 'Job') || coalesce(' · ' || mk.name, '') || ' · due ' || to_char(j.due_date, 'DD Mon'),
      'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id left join public.makers mk on mk.id = j.maker_id
    where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc') and j.due_date < v_today;
    return query
    select 'job_qc', 'info', j.number || ' is waiting for QC', coalesce(s.name, 'Job'), 'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and j.status = 'in_qc';
    return query
    select 'shortage', 'warn', r.item || ' is short', 'Short by ' || app.fmt_qty(r.short_by) || ' ' || r.unit, 'report', null::uuid
    from public.report_shortages(p_business_id) r;
    return query
    select 'po_late', 'warn', p.number || ' is late from ' || s.name, 'Expected ' || to_char(p.expected_date, 'DD Mon'), 'purchase_order', p.id
    from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
    where p.business_id = p_business_id and p.status in ('ordered', 'part_received') and p.expected_date < v_today;
  end if;

  if v_owner then
    return query
    select 'po_approve', 'info', p.number || ' needs your approval', 'Purchase request from ' || s.name, 'purchase_order', p.id
    from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
    where p.business_id = p_business_id and p.status = 'draft';
    return query
    select 'count_approve', 'info', case a.kind when 'count' then 'A stock count' else 'A write-off' end || ' needs your approval',
      coalesce(a.reason, ''), 'adjustment', a.id
    from public.adjustment_requests a where a.business_id = p_business_id and a.status = 'pending';
    return query
    select 'opening_approve', 'info', b.reference || ': opening stock needs your approval', coalesce(b.file_name, ''), 'opening_batch', b.id
    from public.opening_batches b where b.business_id = p_business_id and b.status = 'draft';
    return query
    select 'fee_approve', 'info', j.number || ': approve what ' || mk.name || ' is owed', coalesce(s.name, ''), 'job', j.id
    from public.production_jobs j join public.makers mk on mk.id = j.maker_id left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and j.status = 'completed' and j.fee_approved is null;
    return query
    select 'unpaid_dispatch', 'info', s.order_number || ' is ready but money is owed', c.full_name, 'order', s.id
    from public.order_summaries s join public.customers c on c.id = s.customer_id
    join public.orders o on o.id = s.id
    where s.business_id = p_business_id and s.status = 'open' and s.fulfilment_stage = 'ready_for_dispatch'
      and s.balance_minor > 0 and o.unpaid_dispatch_approved_at is null;
  end if;
end;
$$;
