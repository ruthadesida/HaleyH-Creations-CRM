-- Fixes from the Phase 3 review (docs/DECISIONS.md, 2026-11-04):
--   1. Orders marked dispatched/delivered by hand before Phase 3 get their dispatched quantities filled in,
--      and dispatch/cancel refuse orders already out, so legacy orders can't take stock twice or be cancelled.
--   2. An order with no items can't be confirmed, and an empty order is never "dispatched".
--   3. Custom made-to-order lines (no product) keep an order at "confirmed" until they go out.
--   4. Estimated gross profit shares the order discount across lines; completeness checks real stock items.
--   5. A return of goods that left at ₦0 flags "cost missing" instead of lowering the average; returns can't be
--      dated before the dispatch.
--   6. The derived-stage bypass uses the function's own identity instead of a session setting.

update public.order_items i set dispatched_quantity = i.quantity, dispatched_at = coalesce(i.dispatched_at, o.dispatched_at, now())
from public.orders o
where o.id = i.order_id and o.fulfilment_stage >= 'dispatched' and i.dispatched_quantity < i.quantity;
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
    if new.fulfilment_stage < old.fulfilment_stage and not app.is_office(new.business_id)
       -- Derived stage changes run inside the system's own functions, never as a signed-in user's direct update.
       and current_user = 'authenticated' then
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

create or replace function app.refresh_order_stage(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_stage public.fulfilment_stage;
begin
  select * into o from public.orders where id = p_order;
  if o.status = 'cancelled' or o.confirmed_at is null or o.fulfilment_stage = 'delivered' then
    return;
  end if;
  if exists (select 1 from public.order_items where order_id = p_order)
     and not exists (select 1 from public.order_items where order_id = p_order and dispatched_quantity < quantity) then
    v_stage := 'dispatched';
  elsif exists (select 1 from public.production_jobs j join public.order_items i on i.id = j.order_item_id
                where i.order_id = p_order and j.status not in ('completed', 'cancelled')) then
    v_stage := 'in_production';
  elsif exists (
    -- Custom made-to-order lines aren't tracked by a job here, so the order can't be called ready on its own.
    select 1 from public.order_items i
    where i.order_id = p_order and i.variant_id is null and i.item_type = 'made_to_order' and i.dispatched_quantity < i.quantity
  ) then
    v_stage := 'confirmed';
  elsif not exists (
    select 1 from public.order_items i
    where i.order_id = p_order and i.variant_id is not null and i.dispatched_quantity
      + coalesce((select sum(qty_base) from public.stock_reservations r where r.source_type = 'sales_order' and r.source_id = i.id and r.status = 'active'), 0)
      < i.quantity
  ) then
    v_stage := 'ready_for_dispatch';
  else
    v_stage := 'confirmed';
  end if;
  if v_stage is distinct from o.fulfilment_stage then
    -- Written by this definer function: the stage is derived, so the manual-move rule doesn't apply.
    update public.orders set fulfilment_stage = v_stage where id = p_order;
  end if;
end;
$$;

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
  if not exists (select 1 from public.order_items where order_id = p_order) then
    raise exception 'Add at least one item before confirming.' using errcode = 'P0001';
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
  perform app.refresh_order_stage(p_order);
  return v_jobs;
end;
$$;

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
  if o.fulfilment_stage >= 'dispatched' then
    raise exception 'Everything on this order has already gone out.' using errcode = 'P0001';
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

  update public.orders set
    courier_name = coalesce(nullif(btrim(p_courier), ''), courier_name),
    tracking_reference = coalesce(nullif(btrim(p_tracking), ''), tracking_reference)
    where id = p_order;
  perform app.refresh_order_stage(p_order);
  return v_id;
end;
$$;

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
  if o.fulfilment_stage >= 'dispatched' or exists (select 1 from public.order_items where order_id = p_order and dispatched_quantity > 0) then
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
  if p_effective_date < (select min(dispatched_on) from public.order_dispatches where order_id = p_order) then
    raise exception 'A return cannot be dated before the goods went out.' using errcode = 'P0001';
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
      if v_cost = 0 then
        -- It left without a recorded cost: flag it rather than pull the average down to ₦0.
        update public.stock_items set cost_missing = true where id = v_stock;
      end if;
      v_lines := v_lines || jsonb_build_object('item', v_stock, 'location', v_q, 'qty', v_qty, 'unit_cost', nullif(v_cost, 0));
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
