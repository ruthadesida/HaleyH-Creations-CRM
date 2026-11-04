-- Phase 3: quotations → confirmed orders, reservations, linked production, dispatch, delivery,
-- cancellation, customer returns with inspection, and cost of goods sold (Spec 2 §10–12).
--
--   * An order starts as a quotation (confirmed_at is null): not a sale, reserves nothing.
--   * Confirming reserves available finished goods for ready-made lines and creates one linked
--     production job for whatever must be made (made-to-order lines, or ready-made lines short of stock).
--     It runs once (idempotent); jobs and reservations are never duplicated.
--   * Items passed by QC on an order's job are reserved for that order, not sold to someone else.
--   * Dispatch posts a customer_dispatch document (QC-passed stock only: never from Quarantine), uses up the
--     line's reservation first, and reduces finished goods exactly once. An unpaid balance needs an owner's
--     approval first. Stages (dispatched, delivered) come from these records, not from typing.
--   * Cancelling releases reservations and handles linked jobs explicitly: unstarted jobs are cancelled,
--     jobs already holding work in progress carry on for stock. Dispatched orders can't be cancelled.
--   * Customer returns go into Quarantine at the cost they left at; inspection decides restock or scrap.
--     A refund (payments) never restocks anything.

-------------------------------------------------------------------------------
-- Schema
-------------------------------------------------------------------------------
alter table public.orders
  add column confirmed_at timestamptz,
  add column confirmed_by uuid references auth.users (id),
  add column unpaid_dispatch_approved_at timestamptz,
  add column unpaid_dispatch_approved_by uuid references auth.users (id),
  add column unpaid_dispatch_reason text check (char_length(unpaid_dispatch_reason) <= 500);
-- Orders recorded before quotations existed were confirmed sales.
update public.orders set confirmed_at = created_at where confirmed_at is null;

alter table public.businesses
  add column next_dispatch_number integer not null default 1 check (next_dispatch_number > 0),
  add column next_return_number integer not null default 1 check (next_return_number > 0);

create table public.order_dispatches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  order_id uuid not null,
  location_id uuid not null,
  dispatched_on date not null,
  courier_name text check (char_length(courier_name) <= 80),
  tracking_reference text check (char_length(tracking_reference) <= 120),
  document_id uuid,
  dispatched_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, order_id) references public.orders (business_id, id),
  foreign key (business_id, location_id) references public.locations (business_id, id),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id)
);
create index order_dispatches_order_idx on public.order_dispatches (order_id);

create table public.order_dispatch_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  dispatch_id uuid not null,
  order_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  unique (business_id, id),
  foreign key (business_id, dispatch_id) references public.order_dispatches (business_id, id),
  foreign key (business_id, order_item_id) references public.order_items (business_id, id)
);
create index order_dispatch_lines_item_idx on public.order_dispatch_lines (order_item_id);

alter table public.order_returns
  add column number text,
  add column received_on date,
  add column location_id uuid,
  add column document_id uuid,
  add column replacement_order_id uuid,
  add column idempotency_key uuid,
  add constraint order_returns_number_key unique (business_id, number),
  add constraint order_returns_idem_key unique (business_id, idempotency_key),
  add constraint order_returns_location_fk foreign key (business_id, location_id) references public.locations (business_id, id),
  add constraint order_returns_document_fk foreign key (business_id, document_id) references public.stock_documents (business_id, id),
  add constraint order_returns_replacement_fk foreign key (business_id, replacement_order_id) references public.orders (business_id, id);

create table public.order_return_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  return_id uuid not null,
  order_item_id uuid not null,
  quantity integer not null check (quantity > 0),
  condition text check (char_length(condition) <= 300),
  -- After inspection: back into saleable stock, or written off. Null = still in Quarantine.
  decision text check (decision in ('restock', 'scrap')),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  decision_document_id uuid,
  unique (business_id, id),
  foreign key (business_id, return_id) references public.order_returns (business_id, id),
  foreign key (business_id, order_item_id) references public.order_items (business_id, id),
  foreign key (business_id, decision_document_id) references public.stock_documents (business_id, id)
);
create index order_return_lines_item_idx on public.order_return_lines (order_item_id);

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------
-- The stock item of an order line (null for custom lines that aren't stock-tracked).
create or replace function app.order_item_stock_item(p_item uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.order_items i join public.stock_items s on s.variant_id = i.variant_id where i.id = p_item
$$;

-- Business, then order row: the single lock order for every sales path.
create or replace function app.lock_order(p_order uuid)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bid uuid;
  o public.orders;
begin
  select business_id into v_bid from public.orders where id = p_order;
  if v_bid is null or not app.is_office(v_bid) then
    raise exception 'Only an owner or the front office can work on orders.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = v_bid for update;
  select * into o from public.orders where id = p_order for update;
  return o;
end;
$$;

-- Keeps up to p_qty of a line's stock reserved for it (never more than it still needs).
create or replace function app.reserve_for_order_item(p_item uuid, p_qty numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.order_items;
  o public.orders;
  v_stock uuid;
  v_reserved numeric;
  v_take numeric;
begin
  select * into i from public.order_items where id = p_item;
  select * into o from public.orders where id = i.order_id;
  v_stock := app.order_item_stock_item(p_item);
  if v_stock is null or o.status = 'cancelled' or o.confirmed_at is null then
    return 0;
  end if;
  select coalesce(sum(qty_base), 0) into v_reserved from public.stock_reservations
    where source_type = 'sales_order' and source_id = p_item and status = 'active';
  v_take := least(p_qty, i.quantity - i.dispatched_quantity - v_reserved, greatest(app.available_qty(v_stock), 0));
  if v_take > 0 then
    insert into public.stock_reservations (business_id, stock_item_id, qty_base, source_type, source_id, created_by)
    values (i.business_id, v_stock, v_take, 'sales_order', p_item, coalesce((select auth.uid()), o.created_by));
  end if;
  return greatest(v_take, 0);
end;
$$;

create or replace function app.release_order_reservations(p_order uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stock_reservations set status = 'released', closed_at = now()
  where source_type = 'sales_order' and status = 'active'
    and source_id in (select id from public.order_items where order_id = p_order)
$$;
revoke all on function app.order_item_stock_item, app.lock_order, app.reserve_for_order_item, app.release_order_reservations
  from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Items can't change once an order is confirmed (cancel and re-create instead)
-------------------------------------------------------------------------------
create or replace function app.guard_order_items()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o record;
begin
  select status, fulfilment_stage, confirmed_at into o from public.orders where id = coalesce(new.order_id, old.order_id);
  if o.status = 'cancelled' then
    raise exception 'This order is cancelled and its items cannot be changed.' using errcode = 'P0001';
  end if;
  if tg_op <> 'UPDATE' or new.quantity <> old.quantity or new.unit_price_minor <> old.unit_price_minor
     or new.variant_id is distinct from old.variant_id or new.item_type <> old.item_type then
    if o.fulfilment_stage >= 'dispatched' then
      raise exception 'Items cannot be changed after the order is dispatched.' using errcode = 'P0001';
    end if;
    if o.confirmed_at is not null then
      raise exception 'This order is confirmed, so its items are fixed (stock and production depend on them). Cancel it and create a new one to change items.' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- Stage, status and dispatch fields change only through the functions below.
revoke update on public.orders from authenticated;
grant update (channel, promised_date, delivery_fee_minor, discount_minor, delivery_method, delivery_address, delivery_city,
  delivery_state, pickup_location, delivery_instructions, courier_name, tracking_reference, assigned_to, internal_notes, archived_at)
  on public.orders to authenticated;
revoke update on public.order_items from authenticated;
grant update (description, size, colour, quantity, unit_price_minor, item_type) on public.order_items to authenticated;

-- Discount and delivery fee also freeze once confirmed (the total is what the customer agreed).
create or replace function app.guard_order_money()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.confirmed_at is not null and (new.discount_minor <> old.discount_minor or new.delivery_fee_minor <> old.delivery_fee_minor) then
    raise exception 'This order is confirmed, so its price is fixed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger orders_guard_money before update on public.orders for each row execute function app.guard_order_money();

-------------------------------------------------------------------------------
-- Confirm
-------------------------------------------------------------------------------
-- Turns a quotation into a confirmed order: reserves stock that's in, creates linked jobs for the rest.
-- Returns how many jobs were created.
create or replace function public.confirm_order(p_order uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  i public.order_items;
  v_got numeric;
  v_make numeric;
  v_jobs integer := 0;
  v_variant public.product_variants;
  v_bom public.boms;
  v_job uuid;
begin
  o := app.lock_order(p_order);
  if o.status = 'cancelled' then
    raise exception 'This order is cancelled.' using errcode = 'P0001';
  end if;
  if o.confirmed_at is not null then
    return 0; -- already confirmed (double tap)
  end if;
  update public.orders set confirmed_at = now(), confirmed_by = (select auth.uid()) where id = p_order;
  perform 1 from public.stock_items where variant_id in (select variant_id from public.order_items where order_id = p_order)
    order by id for update;

  for i in select * from public.order_items where order_id = p_order order by created_at, id loop
    if i.variant_id is null then
      continue; -- a custom line that isn't stock-tracked
    end if;
    v_got := 0;
    if i.item_type = 'ready_made' then
      v_got := app.reserve_for_order_item(i.id, i.quantity);
    end if;
    v_make := i.quantity - v_got;
    if v_make > 0 and not exists (select 1 from public.production_jobs where order_item_id = i.id) then
      select * into v_variant from public.product_variants where id = i.variant_id;
      select * into v_bom from public.boms where product_id = v_variant.product_id and status = 'active' and not is_one_off;
      insert into public.production_jobs (business_id, kind, order_item_id, product_id, variant_id, finished_item_id, planned_qty,
        bom_id, bom_version, instructions, due_date, notes, labour_cost, other_cost, created_by)
      values (o.business_id, 'order', i.id, v_variant.product_id, v_variant.id, app.order_item_stock_item(i.id), v_make,
        v_bom.id, v_bom.version, v_bom.instructions, o.promised_date,
        'For order ' || o.order_number || coalesce(' · ' || nullif(btrim(concat_ws(' ', i.size, i.colour)), ''), ''),
        coalesce(v_bom.labour_cost, 0) * v_make, coalesce(v_bom.other_cost, 0) * v_make, (select auth.uid()))
      returning id into v_job;
      if v_bom.id is not null then
        insert into public.job_materials (business_id, job_id, stock_item_id, planned_qty_base)
        select o.business_id, v_job, l.stock_item_id, round(sum(l.qty_base * v_make * (1 + l.wastage_pct / 100)), 4)
        from public.bom_lines l where l.bom_id = v_bom.id and (l.variant_id is null or l.variant_id = v_variant.id)
        group by l.stock_item_id;
      end if;
      v_jobs := v_jobs + 1;
      v_bom := null;
    end if;
  end loop;
  return v_jobs;
end;
$$;

-- Tops up a confirmed order's reservations from stock that has since come in (e.g. a delivery).
create or replace function public.reserve_order_stock(p_order uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  i public.order_items;
  v_total numeric := 0;
begin
  o := app.lock_order(p_order);
  if o.status = 'cancelled' or o.confirmed_at is null then
    raise exception 'Only a confirmed, open order can reserve stock.' using errcode = 'P0001';
  end if;
  perform 1 from public.stock_items where variant_id in (select variant_id from public.order_items where order_id = p_order)
    order by id for update;
  for i in select * from public.order_items where order_id = p_order and variant_id is not null loop
    v_total := v_total + app.reserve_for_order_item(i.id, i.quantity);
  end loop;
  return v_total;
end;
$$;

-------------------------------------------------------------------------------
-- Dispatch and delivery
-------------------------------------------------------------------------------
create or replace function public.approve_unpaid_dispatch(p_order uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  o := app.lock_order(p_order);
  if not app.is_owner(o.business_id) then
    raise exception 'Only an owner can approve dispatching with money still owed.' using errcode = '42501';
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 3 then
    raise exception 'Say why (e.g. trusted customer, pays on delivery).' using errcode = 'P0001';
  end if;
  update public.orders set unpaid_dispatch_approved_at = now(), unpaid_dispatch_approved_by = (select auth.uid()),
    unpaid_dispatch_reason = btrim(p_reason) where id = p_order;
end;
$$;

-- p_lines: [{ "item": order_item uuid, "qty": integer }]
create or replace function public.dispatch_order(
  p_order uuid, p_location uuid, p_effective_date date, p_courier text, p_tracking text, p_lines jsonb, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_existing public.order_dispatches;
  v_balance bigint;
  v_line jsonb;
  i public.order_items;
  v_qty integer;
  v_stock uuid;
  v_res public.stock_reservations;
  v_take numeric;
  v_lines jsonb := '[]'::jsonb;
  v_id uuid;
  v_n integer;
  v_doc uuid;
  v_all boolean;
begin
  o := app.lock_order(p_order);
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;
  select * into v_existing from public.order_dispatches where business_id = o.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.order_id <> p_order then
      raise exception 'This request was already used for a different dispatch. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if o.status = 'cancelled' then
    raise exception 'This order is cancelled.' using errcode = 'P0001';
  end if;
  if o.confirmed_at is null then
    raise exception 'Confirm the order before dispatching it. A quotation is not a sale.' using errcode = 'P0001';
  end if;
  select balance_minor into v_balance from public.order_summaries where id = p_order;
  if v_balance > 0 and o.unpaid_dispatch_approved_at is null then
    raise exception '₦% is still owed. An owner must approve dispatching before it is paid.',
      to_char(v_balance / 100.0, 'FM999,999,999,990.00') using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location and business_id = o.business_id and archived_at is null and kind <> 'quarantine') then
    raise exception 'Choose where the goods leave from (not Quarantine: only QC-passed stock can be dispatched).' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose what is going out.' using errcode = 'P0001';
  end if;

  update public.businesses set next_dispatch_number = next_dispatch_number + 1
    where id = o.business_id returning next_dispatch_number - 1 into v_n;
  insert into public.order_dispatches (business_id, number, order_id, location_id, dispatched_on, courier_name,
    tracking_reference, dispatched_by, idempotency_key)
  values (o.business_id, 'DN-' || lpad(v_n::text, 5, '0'), p_order, p_location, p_effective_date,
    nullif(btrim(p_courier), ''), nullif(btrim(p_tracking), ''), (select auth.uid()), p_idempotency_key)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into i from public.order_items where id = (v_line ->> 'item')::uuid and order_id = p_order for update;
    if i.id is null then
      raise exception 'That item is not on this order.' using errcode = 'P0001';
    end if;
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    if i.dispatched_quantity + v_qty > i.quantity then
      raise exception 'Only % of "%" is still to go out.', i.quantity - i.dispatched_quantity, i.description using errcode = 'P0001';
    end if;
    update public.order_items set dispatched_quantity = dispatched_quantity + v_qty,
      dispatched_at = case when dispatched_quantity + v_qty = quantity then now() else dispatched_at end
      where id = i.id;
    insert into public.order_dispatch_lines (business_id, dispatch_id, order_item_id, quantity) values (o.business_id, v_id, i.id, v_qty);
    v_stock := app.order_item_stock_item(i.id);
    if v_stock is not null then
      -- Use up this line's reservation first; anything more must be unreserved (the engine checks).
      v_take := v_qty;
      for v_res in select * from public.stock_reservations
        where source_type = 'sales_order' and source_id = i.id and status = 'active' order by created_at for update
      loop
        exit when v_take <= 0;
        if v_res.qty_base <= v_take then
          v_take := v_take - v_res.qty_base;
          update public.stock_reservations set qty_base = 0, status = 'consumed', closed_at = now() where id = v_res.id;
        else
          update public.stock_reservations set qty_base = qty_base - v_take where id = v_res.id;
          v_take := 0;
        end if;
      end loop;
      v_lines := v_lines || jsonb_build_object('item', v_stock, 'location', p_location, 'qty', -v_qty);
    end if;
  end loop;

  if not exists (select 1 from public.order_dispatch_lines where dispatch_id = v_id) then
    raise exception 'Enter how many of each item are going out.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_lines) > 0 then
    v_doc := app.post_stock_document(o.business_id, 'customer_dispatch', p_effective_date, v_lines, p_idempotency_key,
      'Order ' || o.order_number, 'order_dispatch', v_id);
    update public.order_dispatches set document_id = v_doc where id = v_id;
  elsif p_effective_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The date cannot be in the future.' using errcode = 'P0001';
  end if;

  select bool_and(dispatched_quantity = quantity) into v_all from public.order_items where order_id = p_order;
  update public.orders set
    fulfilment_stage = case when v_all then 'dispatched'::public.fulfilment_stage
                            when fulfilment_stage < 'ready_for_dispatch' then 'ready_for_dispatch'::public.fulfilment_stage
                            else fulfilment_stage end,
    courier_name = coalesce(nullif(btrim(p_courier), ''), courier_name),
    tracking_reference = coalesce(nullif(btrim(p_tracking), ''), tracking_reference)
    where id = p_order;
  return v_id;
end;
$$;

create or replace function public.mark_order_delivered(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  o := app.lock_order(p_order);
  if o.fulfilment_stage = 'delivered' then return; end if;
  if o.fulfilment_stage <> 'dispatched' then
    raise exception 'Everything must be dispatched before the order is marked delivered.' using errcode = 'P0001';
  end if;
  update public.orders set fulfilment_stage = 'delivered' where id = p_order;
end;
$$;

-------------------------------------------------------------------------------
-- Cancel
-------------------------------------------------------------------------------
-- Releases reservations and deals with linked jobs explicitly. Returns a short note of what happened to jobs.
create or replace function public.cancel_order(p_order uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  j public.production_jobs;
  v_cancelled integer := 0;
  v_kept text[] := '{}';
begin
  o := app.lock_order(p_order);
  if o.status = 'cancelled' then
    return 'Already cancelled.';
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 3 then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.order_items where order_id = p_order and dispatched_quantity > 0) then
    raise exception 'Some items have already gone out. Record a return for them instead of cancelling.' using errcode = 'P0001';
  end if;
  perform app.release_order_reservations(p_order);

  for j in select * from public.production_jobs
    where order_item_id in (select id from public.order_items where order_id = p_order) and status not in ('completed', 'cancelled')
    for update
  loop
    if j.qty_passed + j.qty_rejected = 0
       and not exists (select 1 from public.job_materials where job_id = j.id and issued_qty_base > returned_qty_base) then
      perform app.release_job_reservations(j.id);
      update public.production_jobs set status = 'cancelled', cancelled_reason = 'Order ' || o.order_number || ' cancelled: ' || btrim(p_reason)
        where id = j.id;
      v_cancelled := v_cancelled + 1;
    else
      -- Work is under way: finish it for stock rather than waste it. An owner can cancel the job separately.
      update public.production_jobs set kind = 'stock', order_item_id = null,
        notes = concat_ws(E'\n', notes, 'Order ' || o.order_number || ' was cancelled; finishing for stock.')
        where id = j.id;
      v_kept := v_kept || j.number;
    end if;
  end loop;

  update public.orders set status = 'cancelled', cancel_reason = btrim(p_reason) where id = p_order;
  return concat_ws(' ',
    case when v_cancelled > 0 then v_cancelled || ' unstarted job(s) cancelled.' end,
    case when cardinality(v_kept) > 0 then 'Already in work, now finishing for stock: ' || array_to_string(v_kept, ', ') || '.' end);
end;
$$;

-------------------------------------------------------------------------------
-- Customer returns
-------------------------------------------------------------------------------
-- p_lines: [{ "item": order_item uuid, "qty": integer, "condition": text }]
create or replace function public.receive_customer_return(
  p_order uuid, p_kind public.return_kind, p_reason text, p_effective_date date, p_lines jsonb, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_existing public.order_returns;
  v_q uuid;
  v_id uuid;
  v_n integer;
  v_line jsonb;
  i public.order_items;
  v_qty integer;
  v_returned integer;
  v_stock uuid;
  v_cost numeric;
  v_lines jsonb := '[]'::jsonb;
  v_doc uuid;
begin
  o := app.lock_order(p_order);
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;
  select * into v_existing from public.order_returns where business_id = o.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.order_id <> p_order then
      raise exception 'This request was already used for a different return. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 3 then
    raise exception 'Say why it came back.' using errcode = 'P0001';
  end if;
  select id into v_q from public.locations where business_id = o.business_id and kind = 'quarantine' and archived_at is null order by created_at limit 1;
  if v_q is null then
    raise exception 'Add a Quarantine location first.' using errcode = 'P0001';
  end if;

  update public.businesses set next_return_number = next_return_number + 1
    where id = o.business_id returning next_return_number - 1 into v_n;
  insert into public.order_returns (business_id, order_id, kind, reason, number, received_on, location_id, idempotency_key)
  values (o.business_id, p_order, p_kind, btrim(p_reason), 'RT-' || lpad(v_n::text, 5, '0'), p_effective_date, v_q, p_idempotency_key)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into i from public.order_items where id = (v_line ->> 'item')::uuid and order_id = p_order;
    if i.id is null then
      raise exception 'That item is not on this order.' using errcode = 'P0001';
    end if;
    v_qty := (v_line ->> 'qty')::integer;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;
    select coalesce(sum(quantity), 0) into v_returned from public.order_return_lines where order_item_id = i.id;
    if v_returned + v_qty > i.dispatched_quantity then
      raise exception 'Only % of "%" went out and has not come back.', i.dispatched_quantity - v_returned, i.description using errcode = 'P0001';
    end if;
    insert into public.order_return_lines (business_id, return_id, order_item_id, quantity, condition)
    values (o.business_id, v_id, i.id, v_qty, nullif(btrim(v_line ->> 'condition'), ''));
    v_stock := app.order_item_stock_item(i.id);
    if v_stock is not null then
      -- Comes back at the average cost it left this order at.
      select coalesce(sum(-m.quantity * m.unit_cost) / nullif(sum(-m.quantity), 0), 0) into v_cost
      from public.stock_movements m join public.stock_documents d on d.id = m.document_id
      join public.order_dispatches x on x.id = d.source_id
      where d.source_type = 'order_dispatch' and x.order_id = p_order and m.stock_item_id = v_stock;
      v_lines := v_lines || jsonb_build_object('item', v_stock, 'location', v_q, 'qty', v_qty, 'unit_cost', v_cost);
    end if;
  end loop;

  if not exists (select 1 from public.order_return_lines where return_id = v_id) then
    raise exception 'Enter how many of each item came back.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_lines) > 0 then
    v_doc := app.post_stock_document(o.business_id, 'customer_return', p_effective_date, v_lines, p_idempotency_key,
      'Return on ' || o.order_number, 'order_return', v_id);
    update public.order_returns set document_id = v_doc where id = v_id;
  end if;
  return v_id;
end;
$$;

-- After inspection: restock (Quarantine → a saleable location) or scrap (write off from Quarantine).
create or replace function public.decide_return_line(p_line uuid, p_decision text, p_to uuid, p_idempotency_key uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.order_return_lines;
  r public.order_returns;
  v_stock uuid;
  v_doc uuid;
begin
  select * into l from public.order_return_lines where id = p_line;
  if l.id is null or not (app.is_production(l.business_id) or app.is_office(l.business_id)) then
    raise exception 'You do not have permission to inspect returns.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = l.business_id for update;
  select * into l from public.order_return_lines where id = p_line for update;
  select * into r from public.order_returns where id = l.return_id;
  if l.decision is not null then
    if l.decision = p_decision then return; end if;
    raise exception 'This item was already %.', case l.decision when 'restock' then 'restocked' else 'scrapped' end using errcode = 'P0001';
  end if;
  if p_decision not in ('restock', 'scrap') then
    raise exception 'Choose restock or scrap.' using errcode = 'P0001';
  end if;
  v_stock := app.order_item_stock_item(l.order_item_id);
  if v_stock is not null then
    if p_decision = 'restock' then
      if not exists (select 1 from public.locations where id = p_to and business_id = l.business_id and archived_at is null and kind <> 'quarantine') then
        raise exception 'Choose where it goes back to.' using errcode = 'P0001';
      end if;
      v_doc := app.post_stock_document(l.business_id, 'transfer', (now() at time zone 'Africa/Lagos')::date,
        jsonb_build_array(jsonb_build_object('item', v_stock, 'location', r.location_id, 'qty', -l.quantity),
                          jsonb_build_object('item', v_stock, 'location', p_to, 'qty', l.quantity)),
        p_idempotency_key, 'Inspected and restocked from ' || r.number, 'order_return_line', l.id);
    else
      v_doc := app.post_stock_document(l.business_id, 'scrap', (now() at time zone 'Africa/Lagos')::date,
        jsonb_build_array(jsonb_build_object('item', v_stock, 'location', r.location_id, 'qty', -l.quantity)),
        p_idempotency_key, 'Inspected and scrapped from ' || r.number, 'order_return_line', l.id);
    end if;
  end if;
  update public.order_return_lines set decision = p_decision, decided_at = now(), decided_by = (select auth.uid()),
    decision_document_id = v_doc where id = p_line;
  if not exists (select 1 from public.order_return_lines where return_id = r.id and decision is null) then
    update public.order_returns set status = 'resolved', resolved_at = now() where id = r.id;
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- Cost of goods sold and estimated gross profit (owners)
-------------------------------------------------------------------------------
-- Fulfilled sales are recognised when goods are dispatched (docs/COSTING.md).
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
    select coalesce(sum(i.unit_price_minor::bigint * (i.dispatched_quantity
      - coalesce((select sum(quantity) from public.order_return_lines rl where rl.order_item_id = i.id), 0))), 0)::bigint as v,
      bool_and(i.variant_id is not null or i.dispatched_quantity = 0) as all_stock
    from public.order_items i where i.order_id = p_order
  ),
  cost as (
    select coalesce(sum(-m.quantity * m.unit_cost), 0) as v,
      -- Complete only if every unit that went out (or came back) carried a real cost.
      coalesce(bool_and(m.unit_cost > 0), true) as complete
    from public.stock_movements m
    join public.stock_documents d on d.id = m.document_id
    where (d.source_type = 'order_dispatch' and d.source_id in (select id from public.order_dispatches where order_id = p_order))
       or (d.source_type = 'order_return' and d.source_id in (select id from public.order_returns where order_id = p_order))
  )
  select sold.v, cost.v, sold.v - cost.v, cost.complete and sold.all_stock
  from o, sold, cost
$$;

-------------------------------------------------------------------------------
-- Reversals: sales documents are corrected from the order
-------------------------------------------------------------------------------
create or replace function app.block_sales_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.stock_documents;
begin
  select * into d from public.stock_documents where id = new.reverses_id;
  if d.source_type in ('order_dispatch', 'order_return', 'order_return_line') then
    raise exception 'Dispatches and customer returns are corrected from the order (record a return), not reversed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stock_documents_block_sales_reversal before insert on public.stock_documents
  for each row when (new.doc_type = 'reversal') execute function app.block_sales_reversal();

-------------------------------------------------------------------------------
-- Grants and Row Level Security
-------------------------------------------------------------------------------
revoke all on function public.confirm_order, public.reserve_order_stock, public.approve_unpaid_dispatch, public.dispatch_order,
  public.mark_order_delivered, public.cancel_order, public.receive_customer_return, public.decide_return_line,
  public.order_profit from public, anon;
grant execute on function public.confirm_order, public.reserve_order_stock, public.approve_unpaid_dispatch, public.dispatch_order,
  public.mark_order_delivered, public.cancel_order, public.receive_customer_return, public.decide_return_line,
  public.order_profit to authenticated;
comment on function public.dispatch_order is 'Intentional SECURITY DEFINER: office check, unpaid-balance rule, then the posting engine.';
comment on function public.order_profit is 'Intentional SECURITY DEFINER: returns rows only to owners.';

alter table public.order_dispatches enable row level security;
alter table public.order_dispatch_lines enable row level security;
alter table public.order_return_lines enable row level security;
revoke all on public.order_dispatches, public.order_dispatch_lines, public.order_return_lines from anon;
revoke insert, update, delete on public.order_dispatches, public.order_dispatch_lines, public.order_return_lines from authenticated;
create policy "office reads dispatches" on public.order_dispatches for select to authenticated using (app.is_office(business_id));
create policy "office reads dispatch lines" on public.order_dispatch_lines for select to authenticated using (app.is_office(business_id));
create policy "office and production read return lines" on public.order_return_lines
  for select to authenticated using (app.is_office(business_id) or app.is_production(business_id));
-- Returns are recorded through receive_customer_return; production also inspects them.
drop policy if exists "office creates returns" on public.order_returns;
drop policy if exists "office updates returns" on public.order_returns;
revoke insert, update on public.order_returns from authenticated;
drop policy if exists "office reads returns" on public.order_returns;
create policy "office and production read returns" on public.order_returns
  for select to authenticated using (app.is_office(business_id) or app.is_production(business_id));

create trigger audit_order_dispatches after insert on public.order_dispatches for each row execute function app.write_audit();
create trigger audit_order_return_lines after insert or update on public.order_return_lines for each row execute function app.write_audit();

-------------------------------------------------------------------------------
-- QC: items passed on an order's job are reserved for that order
-------------------------------------------------------------------------------
create or replace function public.record_qc_inspection(
  p_job uuid, p_passed numeric, p_rework numeric, p_rejected numeric, p_results jsonb, p_defects text,
  p_instructions text, p_to uuid, p_effective_date date, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
  v_existing public.qc_inspections;
  v_remaining numeric;
  v_out numeric;
  v_unit numeric;
  v_quarantine uuid;
  v_stock jsonb := '[]'::jsonb;
  v_doc uuid;
  v_n integer;
  v_id uuid;
  v_done boolean;
begin
  j := app.lock_job(p_job);
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;
  select * into v_existing from public.qc_inspections where business_id = j.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.job_id <> p_job then
      raise exception 'This request was already used for a different inspection. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if j.status <> 'in_qc' then
    raise exception 'Submit the job for QC first. It is %.', j.status using errcode = 'P0001';
  end if;
  p_passed := coalesce(p_passed, 0); p_rework := coalesce(p_rework, 0); p_rejected := coalesce(p_rejected, 0);
  if p_passed < 0 or p_rework < 0 or p_rejected < 0
     or p_passed <> trunc(p_passed) or p_rework <> trunc(p_rework) or p_rejected <> trunc(p_rejected) then
    raise exception 'Enter whole numbers of items.' using errcode = 'P0001';
  end if;
  v_remaining := j.planned_qty - j.qty_passed - j.qty_rejected;
  if p_passed + p_rework + p_rejected = 0 then
    raise exception 'Record at least one inspected item.' using errcode = 'P0001';
  end if;
  if p_passed + p_rework + p_rejected > v_remaining then
    raise exception 'Only % item(s) of this job are still to be inspected.', app.fmt_qty(v_remaining) using errcode = 'P0001';
  end if;
  if (p_rework + p_rejected) > 0 and coalesce(btrim(p_defects), '') = '' then
    raise exception 'Describe the defects for rework or rejected items.' using errcode = 'P0001';
  end if;
  if p_passed > 0 and not exists (
    select 1 from public.locations where id = p_to and business_id = j.business_id and archived_at is null and kind <> 'quarantine'
  ) then
    raise exception 'Choose where passed items go (not Quarantine).' using errcode = 'P0001';
  end if;

  v_out := p_passed + p_rejected;
  if v_out > 0 then
    v_unit := greatest(app.job_wip_value(p_job), 0) / v_remaining;
    if v_unit = 0 then
      -- No recorded cost at all (no materials, labour or other costs): flag it instead of valuing at ₦0.
      update public.stock_items set cost_missing = true where id = j.finished_item_id;
    end if;
    if p_passed > 0 then
      v_stock := v_stock || jsonb_build_object('item', j.finished_item_id, 'location', p_to, 'qty', p_passed, 'unit_cost', nullif(v_unit, 0));
    end if;
    if p_rejected > 0 then
      select id into v_quarantine from public.locations
        where business_id = j.business_id and kind = 'quarantine' and archived_at is null order by created_at limit 1;
      if v_quarantine is null then
        raise exception 'Add a Quarantine location first.' using errcode = 'P0001';
      end if;
      v_stock := v_stock || jsonb_build_object('item', j.finished_item_id, 'location', v_quarantine, 'qty', p_rejected, 'unit_cost', nullif(v_unit, 0));
    end if;
    v_doc := app.post_stock_document(j.business_id, 'production_completion', p_effective_date, v_stock, p_idempotency_key,
      'Completed on ' || j.number, 'production_job', p_job);
  elsif p_effective_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The date cannot be in the future.' using errcode = 'P0001';
  end if;

  update public.businesses set next_qc_number = next_qc_number + 1
    where id = j.business_id returning next_qc_number - 1 into v_n;
  insert into public.qc_inspections (business_id, number, job_id, inspector, inspected_on, qty_inspected, qty_passed,
    qty_rework, qty_rejected, results, defects, instructions, document_id, idempotency_key)
  values (j.business_id, 'QC-' || lpad(v_n::text, 5, '0'), p_job, (select auth.uid()), p_effective_date,
    p_passed + p_rework + p_rejected, p_passed, p_rework, p_rejected, coalesce(p_results, '{}'::jsonb),
    nullif(btrim(p_defects), ''), nullif(btrim(p_instructions), ''), v_doc, p_idempotency_key)
  returning id into v_id;

  v_done := j.qty_passed + j.qty_rejected + v_out >= j.planned_qty;
  update public.production_jobs
    set qty_passed = qty_passed + p_passed, qty_rejected = qty_rejected + p_rejected,
        status = case when v_done then 'completed' else 'in_progress' end,
        completed_at = case when v_done then now() end
    where id = p_job;
  if v_done then
    perform app.release_job_reservations(p_job);
  end if;
  -- Made for a customer's order: passed items are kept for that order, never sold to someone else.
  if p_passed > 0 and j.order_item_id is not null then
    perform app.reserve_for_order_item(j.order_item_id, p_passed);
  end if;
  return v_id;
end;
$$;
