-- Ledger hardening after the Phase 1 review (docs/DECISIONS.md, 2026-11-04).
--   1. One lock order everywhere: business row first, then items. No deadlocks between
--      transfers, reversals, approvals and opening postings.
--   2. Idempotency keys are checked after taking the business lock (no race), and a key reused
--      for a different action is refused instead of silently returning someone else's document.
--   3. The moving average only moves on a net increase of an item within a document, so
--      reversing a transfer can't distort it.
--   4. Counts post (counted − expected), where expected is the ledger quantity when the count was
--      recorded, not when it's approved. Blank/invalid quantities are refused.
--   5. Opening batches re-validate at posting under the business lock and post what that
--      re-validation returns; unknown costs are allowed and flagged instead of treated as ₦0.
--   6. Reversing a document keeps its source record (opening batch, count request) in step.
--   7. No future-dated postings; nothing new into archived locations.

-------------------------------------------------------------------------------
-- Schema
-------------------------------------------------------------------------------
alter table public.stock_items add column cost_missing boolean not null default false;
grant select (cost_missing) on public.stock_items to authenticated;

alter table public.opening_batch_lines alter column unit_cost drop not null, alter column cost_base drop not null;

alter table public.adjustment_lines add column expected_qty numeric(18, 4);
alter table public.adjustment_requests
  add column idempotency_key uuid,
  add constraint adjustment_requests_idem_key unique (business_id, idempotency_key),
  drop constraint if exists adjustment_requests_status_check,
  add constraint adjustment_requests_status_check check (status in ('pending', 'approved', 'rejected', 'reversed'));
grant select (expected_qty) on public.adjustment_lines to authenticated;

-------------------------------------------------------------------------------
-- Posting engine
-------------------------------------------------------------------------------
create or replace function app.post_stock_document(
  p_business_id uuid,
  p_doc_type text,
  p_effective_date date,
  p_lines jsonb,
  p_idempotency_key uuid,
  p_reason text default null,
  p_source_type text default null,
  p_source_id uuid default null,
  p_reverses_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc uuid;
  v_existing public.stock_documents;
  v_closed date;
  v_n integer;
  v_line jsonb;
  v_item public.stock_items;
  v_on_hand numeric;
  v_qty numeric;
  v_cost numeric;
  v_unit_in numeric;
  v_loc_archived timestamptz;
  r record;
begin
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;

  -- 1. Business row first: the single lock order for every posting path.
  select stock_closed_through into v_closed from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'Unknown business.' using errcode = 'P0001';
  end if;

  -- 2. Same request again? Only if it really is the same action.
  select * into v_existing from public.stock_documents
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.doc_type is distinct from p_doc_type
       or v_existing.source_type is distinct from p_source_type
       or v_existing.source_id is distinct from p_source_id
       or v_existing.reverses_id is distinct from p_reverses_id then
      raise exception 'This request was already used for a different stock action. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A stock document needs at least one line.' using errcode = 'P0001';
  end if;
  if p_effective_date is null or p_effective_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The date cannot be in the future.' using errcode = 'P0001';
  end if;
  if v_closed is not null and p_effective_date <= v_closed then
    raise exception 'Stock is closed up to %. Choose a later date.', to_char(v_closed, 'DD Mon YYYY') using errcode = 'P0001';
  end if;

  update public.businesses set next_stock_doc_number = next_stock_doc_number + 1
    where id = p_business_id returning next_stock_doc_number - 1 into v_n;

  -- 3. Then the items, in a fixed order.
  perform 1 from public.stock_items
    where business_id = p_business_id
      and id in (select (l ->> 'item')::uuid from jsonb_array_elements(p_lines) l)
    order by id
    for update;

  insert into public.stock_documents (
    business_id, number, doc_type, effective_date, posted_by, reason, source_type, source_id,
    reverses_id, idempotency_key
  ) values (
    p_business_id, 'SD-' || lpad(v_n::text, 5, '0'), p_doc_type, p_effective_date, (select auth.uid()),
    nullif(btrim(p_reason), ''), p_source_type, p_source_id, p_reverses_id, p_idempotency_key
  )
  returning id into v_doc;

  -- 4. Moving average: only a net increase of the item in this document, carrying a cost, moves it.
  --    (A transfer or its reversal nets to zero and leaves the average alone.)
  for r in
    select (l ->> 'item')::uuid as item,
      sum((l ->> 'qty')::numeric) as net,
      sum((l ->> 'qty')::numeric) filter (where (l ->> 'qty')::numeric > 0 and l ->> 'unit_cost' is not null) as in_qty,
      sum((l ->> 'qty')::numeric * (l ->> 'unit_cost')::numeric)
        filter (where (l ->> 'qty')::numeric > 0 and l ->> 'unit_cost' is not null) as in_value
    from jsonb_array_elements(p_lines) l
    group by 1
  loop
    if r.net > 0 and coalesce(r.in_qty, 0) > 0 then
      select * into v_item from public.stock_items where id = r.item and business_id = p_business_id;
      select coalesce(sum(quantity), 0) into v_on_hand from public.stock_movements
        where business_id = p_business_id and stock_item_id = r.item;
      v_unit_in := r.in_value / r.in_qty;
      update public.stock_items set avg_cost =
          ((greatest(v_on_hand, 0) * v_item.avg_cost) + least(r.net, r.in_qty) * v_unit_in)
          / (greatest(v_on_hand, 0) + least(r.net, r.in_qty))
        where id = r.item;
    end if;
  end loop;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'qty')::numeric;
    if v_qty is null or v_qty = 0 then
      raise exception 'Every line needs a quantity other than zero.' using errcode = 'P0001';
    end if;
    select * into v_item from public.stock_items
      where id = (v_line ->> 'item')::uuid and business_id = p_business_id;
    if v_item.id is null then
      raise exception 'That item does not belong to this business.' using errcode = 'P0001';
    end if;
    select archived_at into v_loc_archived from public.locations
      where id = (v_line ->> 'location')::uuid and business_id = p_business_id;
    if not found then
      raise exception 'That location does not belong to this business.' using errcode = 'P0001';
    end if;
    if v_qty > 0 and v_loc_archived is not null and p_doc_type <> 'reversal' then
      raise exception 'That location is archived. Restore it before moving stock into it.' using errcode = 'P0001';
    end if;
    v_cost := coalesce((v_line ->> 'unit_cost')::numeric, v_item.avg_cost);
    if v_cost < 0 then
      raise exception 'Unit cost cannot be negative.' using errcode = 'P0001';
    end if;
    insert into public.stock_movements (business_id, document_id, stock_item_id, location_id, quantity, unit_cost, effective_date)
    values (p_business_id, v_doc, v_item.id, (v_line ->> 'location')::uuid, v_qty, v_cost, p_effective_date);
  end loop;

  for r in
    select m.stock_item_id, m.location_id, sum(m.quantity) as bal
    from public.stock_movements m
    where m.business_id = p_business_id
      and (m.stock_item_id, m.location_id) in (
        select stock_item_id, location_id from public.stock_movements where document_id = v_doc and quantity < 0
      )
    group by m.stock_item_id, m.location_id
  loop
    if r.bal < 0 then
      raise exception 'Not enough stock: % at %. This would leave %.',
        (select name from public.stock_items where id = r.stock_item_id),
        (select name from public.locations where id = r.location_id),
        trim(to_char(r.bal, 'FM999999990.####')) using errcode = 'P0001';
    end if;
  end loop;

  return v_doc;
end;
$$;
revoke all on function app.post_stock_document from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Reversal
-------------------------------------------------------------------------------
create or replace function app.reverse_stock_document(p_doc_id uuid, p_reason text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.stock_documents;
  v_bid uuid;
  v_existing public.stock_documents;
  v_new uuid;
  v_lines jsonb;
  r record;
  v_on_hand numeric;
  v_item public.stock_items;
begin
  select business_id into v_bid from public.stock_documents where id = p_doc_id;
  if v_bid is null then
    raise exception 'Unknown stock document.' using errcode = 'P0001';
  end if;
  perform 1 from public.businesses where id = v_bid for update; -- same lock order as the engine
  select * into d from public.stock_documents where id = p_doc_id for update;

  -- A retry of this exact reversal returns it before anything else changes.
  select * into v_existing from public.stock_documents where business_id = v_bid and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.doc_type = 'reversal' and v_existing.reverses_id = d.id then
      return v_existing.id;
    end if;
    raise exception 'This request was already used for a different stock action. Refresh the page and try again.' using errcode = 'P0001';
  end if;

  if d.doc_type = 'reversal' then
    raise exception 'A reversal cannot itself be reversed. Post a new document instead.' using errcode = 'P0001';
  end if;
  if d.reversed_by_id is not null then
    raise exception 'This document has already been reversed.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for the reversal.' using errcode = 'P0001';
  end if;

  perform 1 from public.stock_items where id in (select stock_item_id from public.stock_movements where document_id = d.id)
    order by id for update;

  -- Take incoming cost-bearing stock back out at its original cost.
  for r in
    select stock_item_id, sum(quantity) as q, sum(quantity * unit_cost) as v
    from public.stock_movements where document_id = d.id
    group by stock_item_id
    having sum(quantity) > 0
  loop
    if d.doc_type in ('opening_balance', 'purchase_receipt', 'production_completion', 'customer_return', 'adjustment') then
      select * into v_item from public.stock_items where id = r.stock_item_id;
      select coalesce(sum(quantity), 0) into v_on_hand from public.stock_movements where stock_item_id = r.stock_item_id;
      if v_on_hand - r.q > 0 then
        update public.stock_items
          set avg_cost = greatest((v_on_hand * v_item.avg_cost - r.v) / (v_on_hand - r.q), 0)
          where id = r.stock_item_id;
      end if;
    end if;
  end loop;

  -- Stock coming back (mirror of an outgoing line) returns at the cost it left with.
  select jsonb_agg(jsonb_build_object('item', stock_item_id, 'location', location_id, 'qty', -quantity,
           'unit_cost', case when quantity < 0 then unit_cost end))
    into v_lines from public.stock_movements where document_id = d.id;

  v_new := app.post_stock_document(d.business_id, 'reversal', greatest(d.effective_date, (now() at time zone 'Africa/Lagos')::date),
    v_lines, p_idempotency_key, p_reason, 'stock_document', d.id, d.id);

  update public.stock_movements nm set unit_cost = om.unit_cost
    from public.stock_movements om
    where nm.document_id = v_new and om.document_id = d.id
      and om.stock_item_id = nm.stock_item_id and om.location_id = nm.location_id and om.quantity = -nm.quantity;

  update public.stock_documents set reversed_by_id = v_new where id = d.id;

  -- Keep the source record in step, whichever screen the reversal came from.
  if d.source_type = 'opening_batch' then
    update public.opening_batches set status = 'reversed', reversal_reason = coalesce(reversal_reason, btrim(p_reason))
      where id = d.source_id and business_id = v_bid;
  elsif d.source_type = 'adjustment_request' then
    update public.adjustment_requests set status = 'reversed' where id = d.source_id and business_id = v_bid;
  end if;
  return v_new;
end;
$$;
revoke all on function app.reverse_stock_document from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Transfers: refuse archived items
-------------------------------------------------------------------------------
create or replace function public.post_transfer(
  p_business_id uuid, p_item uuid, p_from uuid, p_to uuid, p_qty numeric,
  p_effective_date date, p_note text, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can move stock.' using errcode = '42501';
  end if;
  if p_from = p_to then
    raise exception 'Choose two different locations.' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Enter a quantity greater than zero.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.stock_items where id = p_item and business_id = p_business_id and archived_at is not null) then
    raise exception 'That item is archived. Restore it before moving it.' using errcode = 'P0001';
  end if;
  return app.post_stock_document(p_business_id, 'transfer', p_effective_date,
    jsonb_build_array(
      jsonb_build_object('item', p_item, 'location', p_from, 'qty', -p_qty),
      jsonb_build_object('item', p_item, 'location', p_to, 'qty', p_qty)
    ), p_idempotency_key, p_note);
end;
$$;

-------------------------------------------------------------------------------
-- Opening stock: rounding, unknown costs, consistent new-item definitions
-------------------------------------------------------------------------------
create or replace function public.validate_opening_lines(p_business_id uuid, p_lines jsonb)
returns table (line integer, ok boolean, message text, stock_item_id uuid, creates_item boolean,
               qty_base numeric, cost_base numeric, base_unit text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  l jsonb;
  v_line integer;
  v_item public.stock_items;
  v_code text;
  v_unit text;
  v_base text;
  v_qty numeric;
  v_cost numeric;
  v_cost_bad boolean;
  v_loc uuid;
  v_key text;
  v_seen text[] := '{}';
  v_new_defs jsonb := '{}'::jsonb;
  v_def text;
  v_msg text;
  v_qty_base numeric;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can prepare opening stock.' using errcode = '42501';
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_line := coalesce((l ->> 'line')::integer, 0);
    v_msg := null; v_item := null; v_qty_base := null; v_cost := null; v_cost_bad := false; v_qty := null;
    v_unit := nullif(btrim(l ->> 'unit'), '');
    v_code := nullif(btrim(l ->> 'code'), '');
    v_loc := nullif(l ->> 'location_id', '')::uuid;
    begin
      v_qty := (l ->> 'quantity')::numeric;
    exception when others then
      v_qty := null;
    end;
    begin
      v_cost := nullif(btrim(l ->> 'unit_cost'), '')::numeric; -- blank = cost unknown
    exception when others then
      v_cost_bad := true;
    end;

    if nullif(l ->> 'item_id', '') is not null then
      select * into v_item from public.stock_items
        where id = (l ->> 'item_id')::uuid and business_id = p_business_id and archived_at is null;
    elsif v_code is not null then
      select * into v_item from public.stock_items
        where business_id = p_business_id and lower(code) = lower(v_code) and archived_at is null;
    end if;
    v_base := coalesce(v_item.base_unit, nullif(btrim(l ->> 'base_unit'), ''));

    if v_qty is null or v_qty <= 0 then
      v_msg := 'Quantity must be a number greater than zero.';
    elsif v_cost_bad or v_cost < 0 then
      v_msg := 'Unit cost must be a number of zero or more, or left blank if unknown.';
    elsif v_loc is null or not exists (select 1 from public.locations where id = v_loc and business_id = p_business_id and archived_at is null) then
      v_msg := 'Unknown location.';
    elsif v_item.id is null and v_code is null then
      v_msg := 'Each line needs an item code.';
    elsif v_item.id is null and (coalesce(btrim(l ->> 'name'), '') = '' or coalesce(l ->> 'kind', '') not in ('raw_material', 'packaging')) then
      v_msg := 'Code ' || v_code || ' is not in the catalogue. To create it, give a name and a kind (raw_material or packaging). Finished goods must be added as products first.';
    elsif v_base is null or not exists (select 1 from public.units where code = v_base) then
      v_msg := 'Unknown base unit for this item.';
    elsif v_unit is null or not exists (select 1 from public.units where code = v_unit) then
      v_msg := 'Unknown unit. Use one of: m, cm, yd, in, m2, ft2, kg, g, l, ml, pc, dozen, pair.';
    elsif (select dimension from public.units where code = v_unit) <> (select dimension from public.units where code = v_base) then
      v_msg := 'Unit ' || v_unit || ' cannot be converted to this item''s unit (' || v_base || ').';
    else
      v_qty_base := round(app.convert_qty(v_qty, v_unit, v_base), 4);
      v_key := coalesce(v_item.id::text, lower(v_code)) || '@' || v_loc::text;
      if v_item.id is null then
        v_def := lower(coalesce(l ->> 'kind', '')) || '|' || v_base;
      end if;
      if v_qty_base <= 0 then
        v_msg := 'Quantity is too small to record in ' || v_base || '.';
      elsif v_key = any (v_seen) then
        v_msg := 'Duplicate: this item and location appear more than once in the file.';
      elsif v_item.id is null and v_new_defs ? lower(v_code) and v_new_defs ->> lower(v_code) <> v_def then
        v_msg := 'New item ' || v_code || ' is defined twice with a different kind or base unit.';
      elsif v_item.id is not null and exists (
        select 1 from public.stock_movements m
        join public.stock_documents d on d.id = m.document_id
        where m.business_id = p_business_id and m.stock_item_id = v_item.id and m.location_id = v_loc
          and d.doc_type = 'opening_balance' and d.reversed_by_id is null
      ) then
        v_msg := 'Already has an opening balance at this location. Reverse that batch first to re-import.';
      end if;
      v_seen := v_seen || v_key;
      if v_item.id is null and not v_new_defs ? lower(v_code) then
        v_new_defs := v_new_defs || jsonb_build_object(lower(v_code), v_def);
      end if;
    end if;

    line := v_line;
    ok := v_msg is null;
    message := coalesce(v_msg,
      case when v_item.id is null then 'New item will be created.' else 'OK' end
      || case when v_cost is null then ' Cost unknown: the value of this stock will be incomplete.' else '' end);
    stock_item_id := v_item.id;
    creates_item := v_item.id is null and v_msg is null;
    qty_base := v_qty_base;
    -- Kobo per base unit, from the rounded base quantity so value = entered quantity × entered cost.
    cost_base := case when v_qty_base > 0 and v_cost is not null then round(v_cost * v_qty / v_qty_base, 6) end;
    base_unit := v_base;
    return next;
  end loop;
end;
$$;

create or replace function public.save_opening_batch(
  p_business_id uuid, p_file_name text, p_notes text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_n integer;
  v_cutover date;
  v_bad integer;
  l jsonb;
  v record;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can prepare opening stock.' using errcode = '42501';
  end if;
  select cutover_date into v_cutover from public.businesses where id = p_business_id for update;
  if v_cutover is null then
    raise exception 'An owner must set the cutover date in Settings first. Opening balances are dated at cutover.' using errcode = 'P0001';
  end if;
  select count(*) into v_bad from public.validate_opening_lines(p_business_id, p_lines) where not ok;
  if v_bad > 0 then
    raise exception '% line(s) have problems. Fix them in the preview before saving.', v_bad using errcode = 'P0001';
  end if;

  update public.businesses set next_batch_number = next_batch_number + 1
    where id = p_business_id returning next_batch_number - 1 into v_n;
  insert into public.opening_batches (business_id, reference, effective_date, file_name, notes, created_by)
  values (p_business_id, 'OB-' || lpad(v_n::text, 4, '0'), v_cutover, nullif(btrim(p_file_name), ''),
          nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_batch;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into v from public.validate_opening_lines(p_business_id, jsonb_build_array(l));
    insert into public.opening_batch_lines (
      business_id, batch_id, line_no, stock_item_id, new_item, location_id, quantity, unit, qty_base, unit_cost, cost_base
    ) values (
      p_business_id, v_batch, (l ->> 'line')::integer, v.stock_item_id,
      case when v.stock_item_id is null then jsonb_build_object(
        'code', btrim(l ->> 'code'), 'name', btrim(l ->> 'name'), 'kind', l ->> 'kind', 'base_unit', v.base_unit,
        'category', nullif(btrim(l ->> 'category'), ''), 'colour', nullif(btrim(l ->> 'colour'), '')) end,
      (l ->> 'location_id')::uuid, (l ->> 'quantity')::numeric, btrim(l ->> 'unit'), v.qty_base,
      nullif(btrim(l ->> 'unit_cost'), '')::numeric, v.cost_base
    );
  end loop;
  return v_batch;
end;
$$;

create or replace function public.post_opening_batch(p_batch_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.opening_batches;
  v_bid uuid;
  v_cutover date;
  v_check jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_item uuid;
  v_doc uuid;
  v_bad integer;
  r record;
  v record;
  v_saved record;
begin
  select business_id into v_bid from public.opening_batches where id = p_batch_id;
  if v_bid is null or not app.is_owner(v_bid) then
    raise exception 'Only an owner can approve and post opening stock.' using errcode = '42501';
  end if;
  -- Business lock first: two owners posting overlapping batches can't both pass validation.
  select cutover_date into v_cutover from public.businesses where id = v_bid for update;
  select * into b from public.opening_batches where id = p_batch_id for update;
  if b.status = 'posted' then
    return b.document_id;
  end if;
  if b.status <> 'draft' then
    raise exception 'This batch is % and cannot be posted.', b.status using errcode = 'P0001';
  end if;
  if v_cutover is null then
    raise exception 'Set the cutover date in Settings first.' using errcode = 'P0001';
  end if;

  for r in select * from public.opening_batch_lines where batch_id = b.id order by line_no loop
    v_check := v_check || jsonb_build_object(
      'line', r.line_no, 'item_id', r.stock_item_id, 'code', r.new_item ->> 'code', 'name', r.new_item ->> 'name',
      'kind', r.new_item ->> 'kind', 'base_unit', r.new_item ->> 'base_unit', 'location_id', r.location_id,
      'quantity', r.quantity, 'unit', r.unit, 'unit_cost', r.unit_cost);
  end loop;
  select count(*) into v_bad from public.validate_opening_lines(v_bid, v_check) where not ok;
  if v_bad > 0 then
    raise exception '% line(s) are no longer valid (for example, already imported). Discard this batch and prepare a new one.', v_bad
      using errcode = 'P0001';
  end if;

  -- Post exactly what today's validation says (item, base quantity and cost may have changed since the draft).
  for v in select * from public.validate_opening_lines(v_bid, v_check) loop
    select * into v_saved from public.opening_batch_lines where batch_id = b.id and line_no = v.line;
    v_item := v.stock_item_id;
    if v_item is null then
      select id into v_item from public.stock_items
        where business_id = v_bid and lower(code) = lower(v_saved.new_item ->> 'code') and archived_at is null;
      if v_item is null then
        insert into public.stock_items (business_id, kind, code, name, category, colour, base_unit)
        values (v_bid, v_saved.new_item ->> 'kind', v_saved.new_item ->> 'code', v_saved.new_item ->> 'name',
                v_saved.new_item ->> 'category', v_saved.new_item ->> 'colour', v.base_unit)
        returning id into v_item;
      end if;
    end if;
    update public.opening_batch_lines
      set stock_item_id = v_item, new_item = null, qty_base = v.qty_base, cost_base = v.cost_base
      where id = v_saved.id;
    if v.cost_base is null then
      update public.stock_items set cost_missing = true where id = v_item;
    end if;
    v_lines := v_lines || jsonb_build_object('item', v_item, 'location', v_saved.location_id, 'qty', v.qty_base, 'unit_cost', v.cost_base);
  end loop;

  v_doc := app.post_stock_document(v_bid, 'opening_balance', v_cutover, v_lines, p_idempotency_key,
    'Opening balance ' || b.reference, 'opening_batch', b.id);
  update public.opening_batches
    set status = 'posted', posted_by = (select auth.uid()), posted_at = now(), document_id = v_doc, effective_date = v_cutover
    where id = b.id;
  return v_doc;
end;
$$;

create or replace function public.reverse_opening_batch(p_batch_id uuid, p_reason text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.opening_batches;
  v_bid uuid;
begin
  select business_id into v_bid from public.opening_batches where id = p_batch_id;
  if v_bid is null or not app.is_owner(v_bid) then
    raise exception 'Only an owner can reverse opening stock.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = v_bid for update;
  select * into b from public.opening_batches where id = p_batch_id for update;
  if b.status = 'reversed' then
    -- Already done (a retry, or reversed from the Movements page).
    return (select reversed_by_id from public.stock_documents where id = b.document_id);
  end if;
  if b.status <> 'posted' then
    raise exception 'Only a posted batch can be reversed.' using errcode = 'P0001';
  end if;
  -- Marks the batch reversed as well.
  return app.reverse_stock_document(b.document_id, p_reason, p_idempotency_key);
end;
$$;

create or replace function public.discard_opening_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.opening_batches;
  v_bid uuid;
begin
  select business_id into v_bid from public.opening_batches where id = p_batch_id;
  if v_bid is null or not app.is_production(v_bid) then
    raise exception 'You cannot change this batch.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = v_bid for update;
  select * into b from public.opening_batches where id = p_batch_id for update;
  if b.status = 'discarded' then
    return;
  end if;
  if b.status <> 'draft' then
    raise exception 'Only a draft can be discarded.' using errcode = 'P0001';
  end if;
  update public.opening_batches set status = 'discarded' where id = b.id;
end;
$$;

-------------------------------------------------------------------------------
-- Counts and write-offs
-------------------------------------------------------------------------------
drop function if exists public.request_adjustment(uuid, text, uuid, text, date, jsonb);
create function public.request_adjustment(
  p_business_id uuid, p_kind text, p_location uuid, p_reason text, p_effective_date date, p_lines jsonb,
  p_idempotency_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req uuid;
  v_n integer;
  l jsonb;
  v_qty numeric;
  v_item uuid;
  v_items uuid[] := '{}';
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can count or write off stock.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('count', 'write_off') then
    raise exception 'Unknown adjustment type.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why (e.g. monthly count, water damage).' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location and business_id = p_business_id and archived_at is null) then
    raise exception 'Choose a location.' using errcode = 'P0001';
  end if;

  perform 1 from public.businesses where id = p_business_id for update;
  if p_idempotency_key is not null then
    select id into v_req from public.adjustment_requests where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if v_req is not null then
      return v_req; -- a retry of the same request
    end if;
  end if;

  update public.businesses set next_batch_number = next_batch_number + 1
    where id = p_business_id returning next_batch_number - 1 into v_n;
  insert into public.adjustment_requests (business_id, reference, kind, location_id, reason, effective_date, requested_by, idempotency_key)
  values (p_business_id, 'ADJ-' || lpad(v_n::text, 4, '0'), p_kind, p_location, btrim(p_reason),
          coalesce(p_effective_date, (now() at time zone 'Africa/Lagos')::date), (select auth.uid()), p_idempotency_key)
  returning id into v_req;

  for l in select * from jsonb_array_elements(p_lines) loop
    begin
      v_item := (l ->> 'item')::uuid;
      v_qty := (l ->> 'qty')::numeric;
    exception when others then
      raise exception 'Every line needs an item and a number.' using errcode = 'P0001';
    end;
    if v_item is null or v_qty is null then
      raise exception 'Every line needs an item and a quantity. A blank quantity is not the same as zero.' using errcode = 'P0001';
    end if;
    if v_qty < 0 or (p_kind = 'write_off' and v_qty = 0) then
      raise exception 'Quantities must be zero or more (and more than zero for a write-off).' using errcode = 'P0001';
    end if;
    if v_item = any (v_items) then
      raise exception 'The same item appears twice. Combine it into one line.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.stock_items where id = v_item and business_id = p_business_id) then
      raise exception 'That item does not belong to this business.' using errcode = 'P0001';
    end if;
    v_items := v_items || v_item;
    -- What the ledger said at the moment of the count; approval posts counted − expected.
    insert into public.adjustment_lines (business_id, request_id, stock_item_id, quantity, expected_qty)
    values (p_business_id, v_req, v_item, v_qty,
      (select coalesce(sum(quantity), 0) from public.stock_movements where stock_item_id = v_item and location_id = p_location));
  end loop;
  return v_req;
end;
$$;
revoke all on function public.request_adjustment from public, anon;
grant execute on function public.request_adjustment to authenticated;
comment on function public.request_adjustment is 'Intentional SECURITY DEFINER: production/owner request; records expected quantities; posts nothing.';

create or replace function public.decide_adjustment(p_request_id uuid, p_approve boolean, p_note text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.adjustment_requests;
  v_bid uuid;
  r record;
  v_lines jsonb := '[]'::jsonb;
  v_expected numeric;
  v_doc uuid;
begin
  select business_id into v_bid from public.adjustment_requests where id = p_request_id;
  if v_bid is null or not app.is_owner(v_bid) then
    raise exception 'Only an owner can approve stock adjustments and write-offs.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = v_bid for update;
  select * into a from public.adjustment_requests where id = p_request_id for update;
  if a.status = 'approved' then
    return a.document_id;
  end if;
  if a.status <> 'pending' then
    raise exception 'This request has already been decided.' using errcode = 'P0001';
  end if;

  if not p_approve then
    update public.adjustment_requests set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(),
      decision_note = nullif(btrim(p_note), '') where id = a.id;
    return null;
  end if;

  for r in select * from public.adjustment_lines where request_id = a.id loop
    if a.kind = 'count' then
      v_expected := coalesce(r.expected_qty, (select coalesce(sum(quantity), 0) from public.stock_movements
        where stock_item_id = r.stock_item_id and location_id = a.location_id));
      if r.quantity - v_expected <> 0 then
        v_lines := v_lines || jsonb_build_object('item', r.stock_item_id, 'location', a.location_id, 'qty', r.quantity - v_expected);
      end if;
    else
      v_lines := v_lines || jsonb_build_object('item', r.stock_item_id, 'location', a.location_id, 'qty', -r.quantity);
    end if;
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    v_doc := app.post_stock_document(a.business_id, case when a.kind = 'count' then 'adjustment' else 'scrap' end,
      a.effective_date, v_lines, p_idempotency_key, a.reference || ': ' || a.reason, 'adjustment_request', a.id);
  end if;
  update public.adjustment_requests set status = 'approved', decided_by = (select auth.uid()), decided_at = now(),
    decision_note = nullif(btrim(p_note), ''), document_id = v_doc where id = a.id;
  return v_doc;
end;
$$;
