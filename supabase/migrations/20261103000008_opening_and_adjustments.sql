-- Spec 2 Phase 1: opening inventory batches (owner-approved, reversible) and stock
-- adjustments (counts and write-offs requested by production, approved by an owner).
-- Opening balances only create stock documents: never sales, expenses or cash.

-------------------------------------------------------------------------------
-- Opening batches
-------------------------------------------------------------------------------
create table public.opening_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  reference text not null,
  effective_date date not null,
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed', 'discarded')),
  file_name text check (char_length(file_name) <= 200),
  notes text check (char_length(notes) <= 1000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  posted_by uuid references auth.users (id),
  posted_at timestamptz,
  document_id uuid,
  reversal_reason text check (char_length(reversal_reason) <= 500),
  unique (business_id, id),
  unique (business_id, reference),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id)
);

create table public.opening_batch_lines (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  batch_id uuid not null,
  line_no integer not null,
  stock_item_id uuid,
  -- For materials not yet in the catalogue: {code, name, kind, base_unit, category, colour}.
  new_item jsonb,
  location_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit text not null references public.units (code),
  qty_base numeric(18, 4) not null check (qty_base > 0),
  -- Kobo per entered unit, and per base unit.
  unit_cost numeric(20, 6) not null check (unit_cost >= 0),
  cost_base numeric(20, 6) not null check (cost_base >= 0),
  foreign key (business_id, batch_id) references public.opening_batches (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id),
  foreign key (business_id, location_id) references public.locations (business_id, id),
  check ((stock_item_id is null) <> (new_item is null)),
  unique (batch_id, line_no)
);

-- Validates proposed opening lines against the live catalogue. Used for the preview and
-- again, authoritatively, when saving and when posting.
-- p_lines: [{ line, item_id?, code?, name?, kind?, base_unit?, category?, colour?, location_id, quantity, unit, unit_cost }]
--   unit_cost is kobo per entered unit.
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
  v_loc uuid;
  v_key text;
  v_seen text[] := '{}';
  v_msg text;
  v_qty_base numeric;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can prepare opening stock.' using errcode = '42501';
  end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_line := coalesce((l ->> 'line')::integer, 0);
    v_msg := null; v_item := null; v_qty_base := null;
    v_unit := nullif(btrim(l ->> 'unit'), '');
    v_code := nullif(btrim(l ->> 'code'), '');
    v_loc := nullif(l ->> 'location_id', '')::uuid;
    begin
      v_qty := (l ->> 'quantity')::numeric;
      v_cost := coalesce(nullif(l ->> 'unit_cost', '')::numeric, 0);
    exception when others then
      v_qty := null;
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
    elsif v_cost is null or v_cost < 0 then
      v_msg := 'Unit cost must be zero or more.';
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
      v_key := coalesce(v_item.id::text, lower(v_code)) || '@' || v_loc::text;
      if v_key = any (v_seen) then
        v_msg := 'Duplicate: this item and location appear more than once in the file.';
      elsif v_item.id is not null and exists (
        select 1 from public.stock_movements m
        join public.stock_documents d on d.id = m.document_id
        where m.business_id = p_business_id and m.stock_item_id = v_item.id and m.location_id = v_loc
          and d.doc_type = 'opening_balance' and d.reversed_by_id is null
      ) then
        v_msg := 'Already has an opening balance at this location. Reverse that batch first to re-import.';
      end if;
      v_seen := v_seen || v_key;
      v_qty_base := app.convert_qty(v_qty, v_unit, v_base);
    end if;

    line := v_line;
    ok := v_msg is null;
    message := coalesce(v_msg, case when v_item.id is null then 'New item will be created.' else 'OK' end);
    stock_item_id := v_item.id;
    creates_item := v_item.id is null and v_msg is null;
    qty_base := v_qty_base;
    -- Kobo per base unit = kobo per entered unit × entered units per base unit.
    cost_base := case when v_qty_base > 0 then round(v_cost * v_qty / v_qty_base, 6) end;
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
  select cutover_date into v_cutover from public.businesses where id = p_business_id;
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
      coalesce(nullif(l ->> 'unit_cost', '')::numeric, 0), v.cost_base
    );
  end loop;
  return v_batch;
end;
$$;

-- Owner approval posts the batch: creates any new materials, then one opening_balance document.
create or replace function public.post_opening_batch(p_batch_id uuid, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.opening_batches;
  r record;
  v_item uuid;
  v_lines jsonb := '[]'::jsonb;
  v_doc uuid;
  v_check jsonb := '[]'::jsonb;
  v_bad integer;
begin
  select * into b from public.opening_batches where id = p_batch_id for update;
  if b.id is null or not app.is_owner(b.business_id) then
    raise exception 'Only an owner can approve and post opening stock.' using errcode = '42501';
  end if;
  if b.status = 'posted' then
    return b.document_id; -- already posted: a repeat click is harmless
  end if;
  if b.status <> 'draft' then
    raise exception 'This batch is % and cannot be posted.', b.status using errcode = 'P0001';
  end if;

  -- Re-validate against today's catalogue and ledger (things may have changed since the draft).
  for r in select * from public.opening_batch_lines where batch_id = b.id order by line_no loop
    v_check := v_check || jsonb_build_object(
      'line', r.line_no, 'item_id', r.stock_item_id, 'code', r.new_item ->> 'code', 'name', r.new_item ->> 'name',
      'kind', r.new_item ->> 'kind', 'base_unit', r.new_item ->> 'base_unit', 'location_id', r.location_id,
      'quantity', r.quantity, 'unit', r.unit, 'unit_cost', r.unit_cost);
  end loop;
  select count(*) into v_bad from public.validate_opening_lines(b.business_id, v_check) where not ok;
  if v_bad > 0 then
    raise exception '% line(s) are no longer valid (for example, already imported). Discard this batch and prepare a new one.', v_bad
      using errcode = 'P0001';
  end if;

  for r in select * from public.opening_batch_lines where batch_id = b.id order by line_no loop
    v_item := r.stock_item_id;
    if v_item is null then
      select id into v_item from public.stock_items
        where business_id = b.business_id and lower(code) = lower(r.new_item ->> 'code');
      if v_item is null then
        insert into public.stock_items (business_id, kind, code, name, category, colour, base_unit)
        values (b.business_id, r.new_item ->> 'kind', r.new_item ->> 'code', r.new_item ->> 'name',
                r.new_item ->> 'category', r.new_item ->> 'colour', r.new_item ->> 'base_unit')
        returning id into v_item;
      end if;
      update public.opening_batch_lines set stock_item_id = v_item, new_item = null where id = r.id;
    end if;
    v_lines := v_lines || jsonb_build_object('item', v_item, 'location', r.location_id, 'qty', r.qty_base, 'unit_cost', r.cost_base);
  end loop;

  v_doc := app.post_stock_document(b.business_id, 'opening_balance', b.effective_date, v_lines, p_idempotency_key,
    'Opening balance ' || b.reference, 'opening_batch', b.id);
  update public.opening_batches
    set status = 'posted', posted_by = (select auth.uid()), posted_at = now(), document_id = v_doc
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
  v_rev uuid;
begin
  select * into b from public.opening_batches where id = p_batch_id for update;
  if b.id is null or not app.is_owner(b.business_id) then
    raise exception 'Only an owner can reverse opening stock.' using errcode = '42501';
  end if;
  if b.status <> 'posted' then
    raise exception 'Only a posted batch can be reversed.' using errcode = 'P0001';
  end if;
  v_rev := app.reverse_stock_document(b.document_id, p_reason, p_idempotency_key);
  update public.opening_batches set status = 'reversed', reversal_reason = p_reason where id = b.id;
  return v_rev;
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
begin
  select * into b from public.opening_batches where id = p_batch_id for update;
  if b.id is null or not app.is_production(b.business_id) then
    raise exception 'You cannot change this batch.' using errcode = '42501';
  end if;
  if b.status <> 'draft' then
    raise exception 'Only a draft can be discarded.' using errcode = 'P0001';
  end if;
  update public.opening_batches set status = 'discarded' where id = b.id;
end;
$$;

-------------------------------------------------------------------------------
-- Stock adjustments: counts and write-offs
-------------------------------------------------------------------------------
create table public.adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  reference text not null,
  kind text not null check (kind in ('count', 'write_off')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  location_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  effective_date date not null,
  requested_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  document_id uuid,
  unique (business_id, id),
  unique (business_id, reference),
  foreign key (business_id, location_id) references public.locations (business_id, id),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id)
);

create table public.adjustment_lines (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  request_id uuid not null,
  stock_item_id uuid not null,
  -- count: the quantity physically counted; write_off: the quantity to remove. Base units.
  quantity numeric(18, 4) not null check (quantity >= 0),
  foreign key (business_id, request_id) references public.adjustment_requests (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id),
  unique (request_id, stock_item_id)
);

create or replace function public.request_adjustment(
  p_business_id uuid, p_kind text, p_location uuid, p_reason text, p_effective_date date, p_lines jsonb
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
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can count or write off stock.' using errcode = '42501';
  end if;
  if p_kind not in ('count', 'write_off') then
    raise exception 'Unknown adjustment type.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.' using errcode = 'P0001';
  end if;
  update public.businesses set next_batch_number = next_batch_number + 1
    where id = p_business_id returning next_batch_number - 1 into v_n;
  insert into public.adjustment_requests (business_id, reference, kind, location_id, reason, effective_date, requested_by)
  values (p_business_id, 'ADJ-' || lpad(v_n::text, 4, '0'), p_kind, p_location, btrim(p_reason),
          coalesce(p_effective_date, (now() at time zone 'Africa/Lagos')::date), (select auth.uid()))
  returning id into v_req;
  for l in select * from jsonb_array_elements(p_lines) loop
    if (l ->> 'qty')::numeric < 0 or (p_kind = 'write_off' and (l ->> 'qty')::numeric <= 0) then
      raise exception 'Quantities must be zero or more (and more than zero for a write-off).' using errcode = 'P0001';
    end if;
    insert into public.adjustment_lines (business_id, request_id, stock_item_id, quantity)
    values (p_business_id, v_req, (l ->> 'item')::uuid, (l ->> 'qty')::numeric);
  end loop;
  return v_req;
end;
$$;

create or replace function public.decide_adjustment(p_request_id uuid, p_approve boolean, p_note text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.adjustment_requests;
  r record;
  v_lines jsonb := '[]'::jsonb;
  v_on_hand numeric;
  v_doc uuid;
begin
  select * into a from public.adjustment_requests where id = p_request_id for update;
  if a.id is null or not app.is_owner(a.business_id) then
    raise exception 'Only an owner can approve stock adjustments and write-offs.' using errcode = '42501';
  end if;
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

  perform 1 from public.stock_items where id in (select stock_item_id from public.adjustment_lines where request_id = a.id)
    order by id for update;
  for r in select * from public.adjustment_lines where request_id = a.id loop
    if a.kind = 'count' then
      -- The difference between what was counted and what the ledger says, at approval time.
      select coalesce(sum(quantity), 0) into v_on_hand from public.stock_movements
        where stock_item_id = r.stock_item_id and location_id = a.location_id;
      if r.quantity - v_on_hand <> 0 then
        v_lines := v_lines || jsonb_build_object('item', r.stock_item_id, 'location', a.location_id, 'qty', r.quantity - v_on_hand);
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

revoke all on function public.validate_opening_lines, public.save_opening_batch, public.post_opening_batch,
  public.reverse_opening_batch, public.discard_opening_batch, public.request_adjustment, public.decide_adjustment
  from public, anon;
grant execute on function public.validate_opening_lines, public.save_opening_batch, public.post_opening_batch,
  public.reverse_opening_batch, public.discard_opening_batch, public.request_adjustment, public.decide_adjustment
  to authenticated;
comment on function public.validate_opening_lines is 'Intentional SECURITY DEFINER: production/owner check; reads only this business.';
comment on function public.save_opening_batch is 'Intentional SECURITY DEFINER: production/owner check; validates every line.';
comment on function public.post_opening_batch is 'Intentional SECURITY DEFINER: owner approval; posts through the ledger engine.';
comment on function public.reverse_opening_batch is 'Intentional SECURITY DEFINER: owner-only reversal.';
comment on function public.discard_opening_batch is 'Intentional SECURITY DEFINER: production/owner; drafts only.';
comment on function public.request_adjustment is 'Intentional SECURITY DEFINER: production/owner request; posts nothing.';
comment on function public.decide_adjustment is 'Intentional SECURITY DEFINER: owner approval; posts through the ledger engine.';

-------------------------------------------------------------------------------
-- RLS: readable by production and owners; written only through the RPCs above.
-------------------------------------------------------------------------------
alter table public.opening_batches enable row level security;
alter table public.opening_batch_lines enable row level security;
alter table public.adjustment_requests enable row level security;
alter table public.adjustment_lines enable row level security;
revoke all on public.opening_batches, public.opening_batch_lines, public.adjustment_requests, public.adjustment_lines from anon;
revoke insert, update, delete on public.opening_batches, public.opening_batch_lines, public.adjustment_requests,
  public.adjustment_lines from authenticated;

create policy "production reads opening batches" on public.opening_batches
  for select to authenticated using (app.is_production(business_id));
create policy "production reads opening lines" on public.opening_batch_lines
  for select to authenticated using (app.is_production(business_id));
create policy "production reads adjustment requests" on public.adjustment_requests
  for select to authenticated using (app.is_production(business_id));
create policy "production reads adjustment lines" on public.adjustment_lines
  for select to authenticated using (app.is_production(business_id));

-- Unit costs on opening lines are cost data.
revoke select on public.opening_batch_lines from authenticated;
grant select (id, business_id, batch_id, line_no, stock_item_id, new_item, location_id, quantity, unit, qty_base)
  on public.opening_batch_lines to authenticated;

create or replace function public.opening_batch_costs(p_batch_id uuid)
returns table (line_no integer, unit_cost numeric, cost_base numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.line_no, l.unit_cost, l.cost_base
  from public.opening_batch_lines l
  where l.batch_id = p_batch_id and app.can_view_costs(l.business_id)
  order by l.line_no
$$;
revoke all on function public.opening_batch_costs from public, anon;
grant execute on function public.opening_batch_costs to authenticated;
comment on function public.opening_batch_costs is 'Intentional SECURITY DEFINER: returns rows only when the caller may see costs.';
