-- Fixes from the Phase 2 review (docs/DECISIONS.md, 2026-11-04):
--   1. The posting engine refuses any document that would eat into reserved stock
--      (covers over-issuing to a job, write-offs, transfers to Quarantine, supplier returns and reversals).
--   2. Materials can't be returned to a completed or cancelled job (value would be counted twice).
--   3. Supplier returns re-read the receipt under the business lock (no race with a reversal) and
--      reopen the returned quantity on the purchase order.
--   4. Quarantine stock can't be issued to a job or moved for a job without inspection.
--   5. Completing a job with no recorded cost flags the item "cost missing" instead of valuing it at ₦0.
--   6. Maker pay (approved fee, payments) is returned to owners only.
--   7. Supplier bills can only link an order or delivery from the same supplier.
--   8. A job idempotency key can't be reused for a different job; recipe versions are numbered one at a time.
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
        app.fmt_qty(r.bal) using errcode = 'P0001';
    end if;
  end loop;

  -- Never eat into stock reserved for production jobs (and, later, sales orders):
  -- available = on hand outside Quarantine − active reservations.
  for r in select distinct m.stock_item_id from public.stock_movements m where m.document_id = v_doc and m.quantity < 0 loop
    if app.available_qty(r.stock_item_id) < 0 then
      raise exception 'Not enough unreserved %: the rest is reserved for production jobs. Issue or release those reservations first.',
        (select name from public.stock_items where id = r.stock_item_id) using errcode = 'P0001';
    end if;
  end loop;

  return v_doc;
end;
$$;

create or replace function public.issue_job_materials(
  p_job uuid, p_from uuid, p_effective_date date, p_lines jsonb, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
  v_existing public.stock_documents;
  v_line jsonb;
  v_item public.stock_items;
  v_qty numeric;
  v_stock jsonb := '[]'::jsonb;
  v_doc uuid;
  v_res public.stock_reservations;
  v_take numeric;
begin
  j := app.lock_job(p_job);
  select * into v_existing from public.stock_documents where business_id = j.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.doc_type <> 'material_issue' or v_existing.source_id is distinct from p_job then
      raise exception 'This request was already used for a different stock action. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if j.status not in ('planned', 'allocated', 'in_progress', 'in_qc') then
    raise exception 'This job is %; materials can no longer be issued.', j.status using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose what to issue.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.locations where id = p_from and business_id = j.business_id and kind = 'quarantine') then
    raise exception 'Stock in Quarantine must be inspected and moved out before it can be used.' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.stock_items where id = (v_line ->> 'item')::uuid and business_id = j.business_id;
    if v_item.id is null or v_item.kind = 'finished_good' then
      raise exception 'Choose a material or packaging item.' using errcode = 'P0001';
    end if;
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter a quantity greater than zero for %.', v_item.name using errcode = 'P0001';
    end if;
    insert into public.job_materials (business_id, job_id, stock_item_id, planned_qty_base, source)
    values (j.business_id, p_job, v_item.id, 0, 'extra')
    on conflict (job_id, stock_item_id) do nothing;
    update public.job_materials set issued_qty_base = issued_qty_base + v_qty where job_id = p_job and stock_item_id = v_item.id;

    -- Use up this job's reservation for the item first.
    v_take := v_qty;
    for v_res in
      select * from public.stock_reservations
      where source_type = 'production_job' and source_id = p_job and stock_item_id = v_item.id and status = 'active'
      order by created_at for update
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
    -- Anything beyond this job's reservation must not eat into stock reserved for others:
    -- the posting engine checks availability after posting and refuses if it would.
    v_stock := v_stock || jsonb_build_object('item', v_item.id, 'location', p_from, 'qty', -v_qty);
  end loop;

  v_doc := app.post_stock_document(j.business_id, 'material_issue', p_effective_date, v_stock, p_idempotency_key,
    'Issued to ' || j.number, 'production_job', p_job);
  if j.status in ('planned', 'allocated') then
    update public.production_jobs set status = 'in_progress', start_date = coalesce(start_date, p_effective_date) where id = p_job;
  end if;
  return v_doc;
end;
$$;

create or replace function public.return_job_materials(
  p_job uuid, p_to uuid, p_effective_date date, p_lines jsonb, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
  v_existing public.stock_documents;
  v_line jsonb;
  v_jm public.job_materials;
  v_qty numeric;
  v_cost numeric;
  v_stock jsonb := '[]'::jsonb;
  v_doc uuid;
  v_name text;
begin
  j := app.lock_job(p_job);
  select * into v_existing from public.stock_documents where business_id = j.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.doc_type <> 'material_return' or v_existing.source_id is distinct from p_job then
      raise exception 'This request was already used for a different stock action. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose what is coming back.' using errcode = 'P0001';
  end if;
  if j.status in ('completed', 'cancelled') then
    raise exception 'This job is %, so its materials are already accounted for. Record found material as a count instead.', j.status using errcode = 'P0001';
  end if;
  if exists (select 1 from public.locations where id = p_to and business_id = j.business_id and kind = 'quarantine') then
    raise exception 'Return unused material to a store, not Quarantine.' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_jm from public.job_materials where job_id = p_job and stock_item_id = (v_line ->> 'item')::uuid for update;
    select name into v_name from public.stock_items where id = (v_line ->> 'item')::uuid;
    if v_jm.id is null then
      raise exception 'That material was never issued to this job.' using errcode = 'P0001';
    end if;
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter a quantity greater than zero for %.', v_name using errcode = 'P0001';
    end if;
    if v_jm.returned_qty_base + v_qty > v_jm.issued_qty_base then
      raise exception 'Only % of % is still with this job.',
        app.fmt_qty(v_jm.issued_qty_base - v_jm.returned_qty_base), v_name using errcode = 'P0001';
    end if;
    -- Average cost of what this job was issued (net of earlier returns at that same average).
    select coalesce(sum(-m.quantity * m.unit_cost) / nullif(sum(-m.quantity), 0), 0) into v_cost
    from public.stock_movements m join public.stock_documents d on d.id = m.document_id
    where d.source_type = 'production_job' and d.source_id = p_job and d.doc_type = 'material_issue'
      and m.stock_item_id = v_jm.stock_item_id;
    update public.job_materials set returned_qty_base = returned_qty_base + v_qty where id = v_jm.id;
    v_stock := v_stock || jsonb_build_object('item', v_jm.stock_item_id, 'location', p_to, 'qty', v_qty, 'unit_cost', v_cost);
  end loop;

  v_doc := app.post_stock_document(j.business_id, 'material_return', p_effective_date, v_stock, p_idempotency_key,
    'Returned from ' || j.number, 'production_job', p_job);
  return v_doc;
end;
$$;

create or replace function public.move_job_materials(
  p_job uuid, p_from uuid, p_to uuid, p_effective_date date, p_lines jsonb, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
  v_existing public.stock_documents;
  v_line jsonb;
  v_qty numeric;
  v_stock jsonb := '[]'::jsonb;
begin
  j := app.lock_job(p_job);
  select * into v_existing from public.stock_documents where business_id = j.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.doc_type <> 'transfer' or v_existing.source_id is distinct from p_job then
      raise exception 'This request was already used for a different stock action. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if p_from = p_to then
    raise exception 'Choose two different locations.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.locations where id in (p_from, p_to) and business_id = j.business_id and kind = 'quarantine') then
    raise exception 'Quarantine stock is moved only after inspection (Stock → Move stock).' using errcode = 'P0001';
  end if;
  if j.status in ('completed', 'cancelled') then
    raise exception 'This job is %.', j.status using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose what to move.' using errcode = 'P0001';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter quantities greater than zero.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.stock_items where id = (v_line ->> 'item')::uuid and business_id = j.business_id and kind <> 'finished_good') then
      raise exception 'Choose a material or packaging item.' using errcode = 'P0001';
    end if;
    v_stock := v_stock
      || jsonb_build_object('item', (v_line ->> 'item')::uuid, 'location', p_from, 'qty', -v_qty)
      || jsonb_build_object('item', (v_line ->> 'item')::uuid, 'location', p_to, 'qty', v_qty);
  end loop;
  return app.post_stock_document(j.business_id, 'transfer', p_effective_date, v_stock, p_idempotency_key,
    'For ' || j.number, 'production_job', p_job);
end;
$$;

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
  return v_id;
end;
$$;

create or replace function public.job_costs(p_job uuid)
returns table (material_value numeric, labour_cost numeric, other_cost numeric, completed_value numeric,
  wip_value numeric, fee_approved bigint, paid bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select app.job_material_value(j.id), j.labour_cost, j.other_cost, app.job_completed_value(j.id),
    app.job_wip_value(j.id),
    -- Maker pay is owner-only, even for production managers allowed to see costs.
    case when app.is_owner(j.business_id) then j.fee_approved end,
    case when app.is_owner(j.business_id) then
      coalesce((select sum(amount) from public.maker_payments p where p.job_id = j.id and p.voided_at is null), 0)::bigint end
  from public.production_jobs j
  where j.id = p_job and app.can_view_costs(j.business_id)
$$;

create or replace function public.return_to_supplier(
  p_receipt_id uuid, p_effective_date date, p_reason text, p_lines jsonb, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.goods_receipts;
  v_existing public.supplier_returns;
  v_id uuid;
  v_n integer;
  v_line jsonb;
  v_rl public.goods_receipt_lines;
  v_qty numeric;
  v_doc uuid;
  v_stock jsonb := '[]'::jsonb;
  v_item public.stock_items;
  v_on_hand numeric;
  r record;
begin
  select * into v_r from public.goods_receipts where id = p_receipt_id;
  if v_r.id is null or not app.is_production(v_r.business_id) then
    raise exception 'Only an owner or the production manager can return goods to a supplier.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = v_r.business_id for update;
  -- Re-read under the lock: a reversal may have happened while we waited.
  select * into v_r from public.goods_receipts where id = p_receipt_id for update;
  select * into v_existing from public.supplier_returns where business_id = v_r.business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.receipt_id <> p_receipt_id then
      raise exception 'This request was already used for a different return. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;
  if v_r.status <> 'posted' then
    raise exception 'This receipt was reversed.' using errcode = 'P0001';
  end if;
  if v_r.document_id is null then
    raise exception 'Nothing was accepted on this receipt, so there is nothing to return.' using errcode = 'P0001';
  end if;
  if coalesce(char_length(btrim(p_reason)), 0) < 3 then
    raise exception 'Say why the goods are going back.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose what is going back.' using errcode = 'P0001';
  end if;

  update public.businesses set next_supplier_return_number = next_supplier_return_number + 1
    where id = v_r.business_id returning next_supplier_return_number - 1 into v_n;
  insert into public.supplier_returns (business_id, number, receipt_id, location_id, effective_date, reason,
    document_id, posted_by, idempotency_key)
  values (v_r.business_id, 'SR-' || lpad(v_n::text, 5, '0'), v_r.id, v_r.location_id, p_effective_date,
    btrim(p_reason), v_r.document_id, (select auth.uid()), p_idempotency_key)
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_rl from public.goods_receipt_lines
      where id = (v_line ->> 'receipt_line')::uuid and receipt_id = v_r.id for update;
    if v_rl.id is null then
      raise exception 'That line is not on this receipt.' using errcode = 'P0001';
    end if;
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Enter a quantity greater than zero.' using errcode = 'P0001';
    end if;
    if v_rl.qty_returned_base + v_qty > v_rl.qty_accepted_base then
      raise exception 'You can return at most % of that line.', app.fmt_qty(v_rl.qty_accepted_base - v_rl.qty_returned_base) using errcode = 'P0001';
    end if;
    update public.goods_receipt_lines set qty_returned_base = qty_returned_base + v_qty where id = v_rl.id;
    -- Returned goods are expected again: reopen that quantity on the order.
    if v_rl.po_line_id is not null then
      update public.purchase_order_lines set qty_received_base = greatest(qty_received_base - v_qty, 0) where id = v_rl.po_line_id;
    end if;
    insert into public.supplier_return_lines (business_id, return_id, receipt_line_id, qty_base)
    values (v_r.business_id, v_id, v_rl.id, v_qty);
    v_stock := v_stock || jsonb_build_object('item', v_rl.stock_item_id, 'location', v_r.location_id,
      'qty', -v_qty, 'unit_cost', v_rl.unit_cost);
  end loop;

  -- Lock items (business already locked), then take the returned cost back out of the average.
  perform 1 from public.stock_items where id in (select (l ->> 'item')::uuid from jsonb_array_elements(v_stock) l)
    order by id for update;
  for r in
    select (l ->> 'item')::uuid as item, sum(-(l ->> 'qty')::numeric) as q,
      sum(-(l ->> 'qty')::numeric * (l ->> 'unit_cost')::numeric) as v
    from jsonb_array_elements(v_stock) l group by 1
  loop
    select * into v_item from public.stock_items where id = r.item;
    select coalesce(sum(quantity), 0) into v_on_hand from public.stock_movements where stock_item_id = r.item;
    if v_on_hand - r.q > 0 then
      update public.stock_items set avg_cost = greatest((v_on_hand * v_item.avg_cost - r.v) / (v_on_hand - r.q), 0)
        where id = r.item;
    end if;
  end loop;

  v_doc := app.post_stock_document(v_r.business_id, 'supplier_return', p_effective_date, v_stock,
    p_idempotency_key, btrim(p_reason), 'supplier_return', v_id);
  update public.supplier_returns set document_id = v_doc where id = v_id;
  if v_r.po_id is not null then
    perform app.refresh_po_status(v_r.po_id);
  end if;
  return v_id;
end;
$$;

create or replace function public.record_supplier_bill(
  p_business_id uuid, p_supplier_id uuid, p_po_id uuid, p_receipt_id uuid, p_bill_ref text,
  p_bill_date date, p_amount bigint, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only an owner can record supplier bills.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the bill amount.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and business_id = p_business_id) then
    raise exception 'Unknown supplier.' using errcode = 'P0001';
  end if;
  if p_po_id is not null and not exists (
    select 1 from public.purchase_orders where id = p_po_id and business_id = p_business_id and supplier_id = p_supplier_id
  ) then
    raise exception 'That order is from a different supplier.' using errcode = 'P0001';
  end if;
  if p_receipt_id is not null and not exists (
    select 1 from public.goods_receipts where id = p_receipt_id and business_id = p_business_id and supplier_id = p_supplier_id
  ) then
    raise exception 'That delivery is from a different supplier.' using errcode = 'P0001';
  end if;
  insert into public.supplier_bills (business_id, supplier_id, po_id, receipt_id, bill_ref, bill_date, amount, notes, created_by)
  values (p_business_id, p_supplier_id, p_po_id, p_receipt_id, nullif(btrim(p_bill_ref), ''), p_bill_date, p_amount,
    nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_production_job(
  p_business_id uuid, p_variant_id uuid, p_qty numeric, p_bom_id uuid, p_maker_id uuid,
  p_due_date date, p_notes text, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_variant public.product_variants;
  v_item uuid;
  v_bom public.boms;
  v_id uuid;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can create production jobs.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;
  perform 1 from public.businesses where id = p_business_id for update;
  select id into v_existing from public.production_jobs where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    if not exists (select 1 from public.production_jobs where id = v_existing and variant_id is not distinct from p_variant_id) then
      raise exception 'This request was already used for a different job. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing;
  end if;

  select * into v_variant from public.product_variants where id = p_variant_id and business_id = p_business_id;
  if v_variant.id is null then
    raise exception 'Choose what to make.' using errcode = 'P0001';
  end if;
  if v_variant.archived_at is not null then
    raise exception 'That variant is archived.' using errcode = 'P0001';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) or p_qty > 10000 then
    raise exception 'Enter how many to make (a whole number).' using errcode = 'P0001';
  end if;
  select id into v_item from public.stock_items where variant_id = v_variant.id;
  if p_bom_id is not null then
    select * into v_bom from public.boms where id = p_bom_id and business_id = p_business_id;
    if v_bom.id is null or v_bom.product_id <> v_variant.product_id then
      raise exception 'That recipe is not for this product.' using errcode = 'P0001';
    end if;
    if v_bom.status = 'archived' then
      raise exception 'That recipe is archived. Use the current one.' using errcode = 'P0001';
    end if;
  end if;
  if p_maker_id is not null and not exists (
    select 1 from public.makers where id = p_maker_id and business_id = p_business_id and archived_at is null
  ) then
    raise exception 'Choose a maker from the directory.' using errcode = 'P0001';
  end if;

  insert into public.production_jobs (business_id, kind, product_id, variant_id, finished_item_id, planned_qty, bom_id,
    bom_version, instructions, maker_id, due_date, notes, labour_cost, other_cost, created_by, idempotency_key)
  values (p_business_id, 'stock', v_variant.product_id, v_variant.id, v_item, p_qty, v_bom.id, v_bom.version,
    v_bom.instructions, p_maker_id, p_due_date, nullif(btrim(p_notes), ''),
    coalesce(v_bom.labour_cost, 0) * p_qty, coalesce(v_bom.other_cost, 0) * p_qty, (select auth.uid()), p_idempotency_key)
  returning id into v_id;

  if v_bom.id is not null then
    insert into public.job_materials (business_id, job_id, stock_item_id, planned_qty_base)
    select p_business_id, v_id, l.stock_item_id, round(sum(l.qty_base * p_qty * (1 + l.wastage_pct / 100)), 4)
    from public.bom_lines l
    where l.bom_id = v_bom.id and (l.variant_id is null or l.variant_id = v_variant.id)
    group by l.stock_item_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_bom(
  p_business_id uuid, p_bom_id uuid, p_product_id uuid, p_name text, p_is_one_off boolean,
  p_labour_cost numeric, p_other_cost numeric, p_instructions text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bom public.boms;
  v_id uuid;
  v_line jsonb;
  v_item public.stock_items;
  v_qty numeric;
  v_factor numeric;
  v_waste numeric;
  v_costs boolean := app.can_view_costs(p_business_id);
  v_i integer := 0;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can edit bills of materials.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and business_id = p_business_id) then
    raise exception 'Choose a product.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Give the recipe a name.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one material.' using errcode = 'P0001';
  end if;
  if v_costs and (coalesce(p_labour_cost, 0) < 0 or coalesce(p_other_cost, 0) < 0) then
    raise exception 'Costs cannot be negative.' using errcode = 'P0001';
  end if;

  if p_bom_id is null then
    perform 1 from public.products where id = p_product_id for update; -- one version number at a time
    insert into public.boms (business_id, product_id, name, version, is_one_off, labour_cost, other_cost, instructions, created_by)
    values (p_business_id, p_product_id, btrim(p_name),
      coalesce((select max(version) from public.boms where product_id = p_product_id), 0) + 1,
      coalesce(p_is_one_off, false),
      case when v_costs then coalesce(p_labour_cost, 0) else 0 end,
      case when v_costs then coalesce(p_other_cost, 0) else 0 end,
      nullif(btrim(p_instructions), ''), (select auth.uid()))
    returning id into v_id;
  else
    select * into v_bom from public.boms where id = p_bom_id and business_id = p_business_id for update;
    if v_bom.id is null then
      raise exception 'Unknown bill of materials.' using errcode = 'P0001';
    end if;
    if v_bom.status <> 'draft' then
      raise exception 'Only a draft can be edited. Make a new version instead.' using errcode = 'P0001';
    end if;
    if v_bom.product_id <> p_product_id then
      raise exception 'A recipe stays with its product.' using errcode = 'P0001';
    end if;
    v_id := v_bom.id;
    update public.boms set name = btrim(p_name), is_one_off = coalesce(p_is_one_off, false),
      labour_cost = case when v_costs then coalesce(p_labour_cost, 0) else labour_cost end,
      other_cost = case when v_costs then coalesce(p_other_cost, 0) else other_cost end,
      instructions = nullif(btrim(p_instructions), '')
      where id = v_id;
    delete from public.bom_lines where bom_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    select * into v_item from public.stock_items where id = (v_line ->> 'item')::uuid and business_id = p_business_id;
    if v_item.id is null or v_item.kind = 'finished_good' then
      raise exception 'Line %: choose a material or packaging item.', v_i using errcode = 'P0001';
    end if;
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line %: enter how much one finished item uses.', v_i using errcode = 'P0001';
    end if;
    v_factor := app.item_unit_factor(v_item, coalesce(nullif(btrim(v_line ->> 'unit'), ''), v_item.base_unit));
    v_waste := coalesce((v_line ->> 'wastage_pct')::numeric, 0);
    if v_waste < 0 or v_waste > 100 then
      raise exception 'Line %: wastage must be between 0 and 100%%.', v_i using errcode = 'P0001';
    end if;
    if (v_line ->> 'variant') is not null and not exists (
      select 1 from public.product_variants where id = (v_line ->> 'variant')::uuid and product_id = p_product_id
    ) then
      raise exception 'Line %: that variant is not part of this product.', v_i using errcode = 'P0001';
    end if;
    insert into public.bom_lines (business_id, bom_id, line_no, stock_item_id, qty, unit, qty_base, wastage_pct, variant_id, notes)
    values (p_business_id, v_id, v_i, v_item.id, v_qty, lower(coalesce(nullif(btrim(v_line ->> 'unit'), ''), v_item.base_unit)),
      round(v_qty * v_factor, 6), v_waste, (v_line ->> 'variant')::uuid, nullif(btrim(v_line ->> 'notes'), ''));
  end loop;
  return v_id;
end;
$$;

create or replace function public.copy_bom(p_bom_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bom public.boms;
  v_id uuid;
begin
  select * into v_bom from public.boms where id = p_bom_id;
  if v_bom.id is null or not app.is_production(v_bom.business_id) then
    raise exception 'Only an owner or the production manager can copy a recipe.' using errcode = '42501';
  end if;
  perform 1 from public.products where id = v_bom.product_id for update; -- one version number at a time
  insert into public.boms (business_id, product_id, name, version, is_one_off, labour_cost, other_cost, instructions, created_by)
  values (v_bom.business_id, v_bom.product_id, v_bom.name,
    (select max(version) from public.boms where product_id = v_bom.product_id) + 1,
    v_bom.is_one_off, v_bom.labour_cost, v_bom.other_cost, v_bom.instructions, (select auth.uid()))
  returning id into v_id;
  insert into public.bom_lines (business_id, bom_id, line_no, stock_item_id, qty, unit, qty_base, wastage_pct, variant_id, notes)
  select business_id, v_id, line_no, stock_item_id, qty, unit, qty_base, wastage_pct, variant_id, notes
  from public.bom_lines where bom_id = p_bom_id;
  return v_id;
end;
$$;
