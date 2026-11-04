-- Phase 2b/c: bills of materials, production jobs, reservations, WIP, external makers, QC (Spec 2 §6–9).
--
-- How value flows (docs/COSTING.md):
--   * Allocation reserves raw materials (reduces *available*, never *physical* stock).
--   * Issue to a job removes material from a location at the current average cost: the material is
--     consumed here, once. Its value is now work in progress (WIP) on the job.
--   * Unused material returned from a job comes back at the job's average issue cost for that item.
--   * Agreed maker labour and other direct costs are added to the job's WIP.
--   * QC-passed units enter finished stock at (WIP remaining ÷ units still to finish) each.
--     QC-rejected units go to Quarantine at the same cost (never saleable until inspected again).
--     Rework units stay in WIP. Nothing consumes material again at completion or dispatch.
--   * Materials sent to an external maker are a transfer to that maker's location: still business stock,
--     still visible, still reserved for the job until issued.

-------------------------------------------------------------------------------
-- Counters
-------------------------------------------------------------------------------
alter table public.businesses
  add column next_job_number integer not null default 1 check (next_job_number > 0),
  add column next_qc_number integer not null default 1 check (next_qc_number > 0);

-- Quantities in messages: up to 4 decimals, no trailing zeros or dot ("26", "14.8").
create or replace function app.fmt_qty(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select rtrim(to_char(p, 'FM999999990.####'), '.') $$;

-------------------------------------------------------------------------------
-- Reservations (production now; sales orders in Phase 3)
-------------------------------------------------------------------------------
create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  stock_item_id uuid not null,
  -- Still reserved, base units. Goes down as material is issued.
  qty_base numeric(18, 4) not null check (qty_base >= 0),
  source_type text not null check (source_type in ('production_job', 'sales_order')),
  source_id uuid not null,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id)
);
create index stock_reservations_item_idx on public.stock_reservations (business_id, stock_item_id) where status = 'active';
create index stock_reservations_source_idx on public.stock_reservations (source_type, source_id);

-- On hand (outside quarantine), reserved and available per item. RLS of the caller applies.
create view public.stock_availability
with (security_invoker = true)
as
select i.business_id, i.id as stock_item_id,
  coalesce(oh.qty, 0)::numeric(18, 4) as on_hand,
  coalesce(rs.qty, 0)::numeric(18, 4) as reserved,
  (coalesce(oh.qty, 0) - coalesce(rs.qty, 0))::numeric(18, 4) as available
from public.stock_items i
left join lateral (
  select sum(m.quantity) as qty from public.stock_movements m
  join public.locations l on l.id = m.location_id
  where m.stock_item_id = i.id and l.kind <> 'quarantine'
) oh on true
left join lateral (
  select sum(r.qty_base) as qty from public.stock_reservations r
  where r.stock_item_id = i.id and r.status = 'active'
) rs on true;

create or replace function app.available_qty(p_item uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select sum(m.quantity) from public.stock_movements m join public.locations l on l.id = m.location_id
                   where m.stock_item_id = p_item and l.kind <> 'quarantine'), 0)
       - coalesce((select sum(qty_base) from public.stock_reservations where stock_item_id = p_item and status = 'active'), 0)
$$;
revoke all on function app.available_qty from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Bills of materials
-------------------------------------------------------------------------------
create table public.boms (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  product_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  version integer not null check (version > 0),
  -- draft = editable; active = used for new jobs (one per product); archived = kept for history.
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  -- A one-off spec for a custom order: never becomes the product's standard recipe.
  is_one_off boolean not null default false,
  -- Kobo per finished unit. Cost data: not readable directly.
  labour_cost numeric(20, 6) not null default 0 check (labour_cost >= 0),
  other_cost numeric(20, 6) not null default 0 check (other_cost >= 0),
  instructions text check (char_length(instructions) <= 4000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (product_id, version),
  foreign key (business_id, product_id) references public.products (business_id, id)
);
create unique index boms_one_active on public.boms (product_id) where status = 'active' and not is_one_off;

create table public.bom_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  bom_id uuid not null,
  line_no integer not null check (line_no > 0),
  stock_item_id uuid not null,
  -- Per finished unit, in `unit`; qty_base is the same in the item's base unit.
  qty numeric(18, 4) not null check (qty > 0),
  unit text not null,
  qty_base numeric(18, 6) not null check (qty_base > 0),
  wastage_pct numeric(5, 2) not null default 0 check (wastage_pct between 0 and 100),
  -- Only for this variant (e.g. a longer length uses more fabric); null = every variant.
  variant_id uuid,
  notes text check (char_length(notes) <= 300),
  unique (business_id, id),
  unique (bom_id, line_no),
  foreign key (business_id, bom_id) references public.boms (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id),
  foreign key (business_id, variant_id) references public.product_variants (business_id, id)
);
create index bom_lines_bom_idx on public.bom_lines (bom_id);

create trigger touch_boms before update on public.boms for each row execute function app.touch_updated_at();

-------------------------------------------------------------------------------
-- Production jobs: extend the Phase 1 placeholder (data preserved)
-------------------------------------------------------------------------------
alter table public.production_jobs drop constraint if exists production_jobs_status_check;
update public.production_jobs set status = case status when 'todo' then 'planned' when 'done' then 'completed' else status end;
alter table public.production_jobs
  alter column order_item_id drop not null,
  alter column status set default 'planned',
  add constraint production_jobs_status_check
    check (status in ('planned', 'allocated', 'in_progress', 'in_qc', 'completed', 'cancelled')),
  add column number text,
  add column kind text not null default 'stock' check (kind in ('stock', 'order')),
  add column product_id uuid,
  add column variant_id uuid,
  add column finished_item_id uuid,
  add column planned_qty numeric(18, 4) not null default 1 check (planned_qty > 0),
  add column bom_id uuid,
  add column bom_version integer,
  add column instructions text check (char_length(instructions) <= 4000),
  add column maker_id uuid,
  add column start_date date,
  add column qty_passed numeric(18, 4) not null default 0 check (qty_passed >= 0),
  add column qty_rejected numeric(18, 4) not null default 0 check (qty_rejected >= 0),
  -- Kobo, whole job. Cost data: not readable directly.
  add column labour_cost numeric(20, 6) not null default 0 check (labour_cost >= 0),
  add column other_cost numeric(20, 6) not null default 0 check (other_cost >= 0),
  -- Owner-approved amount payable to the maker (kobo), once the work is done.
  add column fee_approved bigint check (fee_approved >= 0),
  add column fee_approved_at timestamptz,
  add column fee_approved_by uuid references auth.users (id),
  add column completed_at timestamptz,
  add column cancelled_reason text check (char_length(cancelled_reason) <= 500),
  add column created_by uuid references auth.users (id),
  add column idempotency_key uuid,
  add constraint production_jobs_number_key unique (business_id, number),
  add constraint production_jobs_idem_key unique (business_id, idempotency_key),
  add constraint production_jobs_product_fk foreign key (business_id, product_id) references public.products (business_id, id),
  add constraint production_jobs_variant_fk foreign key (business_id, variant_id) references public.product_variants (business_id, id),
  add constraint production_jobs_item_fk foreign key (business_id, finished_item_id) references public.stock_items (business_id, id),
  add constraint production_jobs_bom_fk foreign key (business_id, bom_id) references public.boms (business_id, id),
  add constraint production_jobs_maker_fk foreign key (business_id, maker_id) references public.makers (business_id, id),
  add constraint production_jobs_qty_check check (qty_passed + qty_rejected <= planned_qty);
create index production_jobs_business_idx on public.production_jobs (business_id, status, due_date);

create or replace function app.assign_job_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if new.number is null then
    update public.businesses set next_job_number = next_job_number + 1
      where id = new.business_id returning next_job_number - 1 into v_n;
    new.number := 'PJ-' || lpad(v_n::text, 5, '0');
  end if;
  return new;
end;
$$;
create trigger production_jobs_number before insert on public.production_jobs
  for each row execute function app.assign_job_number();

-- Number existing placeholder jobs.
do $$
declare r record; v_n integer;
begin
  for r in select id, business_id from public.production_jobs where number is null order by created_at loop
    update public.businesses set next_job_number = next_job_number + 1 where id = r.business_id
      returning next_job_number - 1 into v_n;
    update public.production_jobs set number = 'PJ-' || lpad(v_n::text, 5, '0') where id = r.id;
  end loop;
end $$;

-- What a job plans to use, and what it has issued and returned (quantities; values are in the ledger).
create table public.job_materials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  job_id uuid not null,
  stock_item_id uuid not null,
  planned_qty_base numeric(18, 4) not null default 0 check (planned_qty_base >= 0),
  issued_qty_base numeric(18, 4) not null default 0 check (issued_qty_base >= 0),
  returned_qty_base numeric(18, 4) not null default 0 check (returned_qty_base >= 0),
  -- 'plan' from the BOM; 'extra' issued beyond the plan (e.g. rework).
  source text not null default 'plan' check (source in ('plan', 'extra')),
  unique (business_id, id),
  unique (job_id, stock_item_id),
  foreign key (business_id, job_id) references public.production_jobs (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id),
  check (returned_qty_base <= issued_qty_base)
);

-------------------------------------------------------------------------------
-- Quality control
-------------------------------------------------------------------------------
create table public.qc_checklists (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  category public.product_category not null,
  items text[] not null check (cardinality(items) between 1 and 20),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, category)
);

create or replace function app.seed_qc_checklists(p_business_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.qc_checklists (business_id, category, items) values
    (p_business_id, 'clothing', array['Measurements match the order', 'Stitching even and secure', 'Finishing and pressing',
      'No stains or marks', 'Correct colour and size', 'Order instructions followed']),
    (p_business_id, 'shoes', array['Correct size', 'Pair matches', 'Sole firmly attached', 'Finishing', 'No defects']),
    (p_business_id, 'bags', array['Stitching', 'Lining', 'Hardware secure', 'Straps', 'Closures work', 'Finishing']),
    (p_business_id, 'other', array['Matches the specification', 'Finishing', 'No defects'])
  on conflict (business_id, category) do nothing
$$;
revoke all on function app.seed_qc_checklists from public, anon, authenticated;

create or replace function app.seed_business_qc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_qc_checklists(new.id);
  return new;
end;
$$;
create trigger businesses_seed_qc after insert on public.businesses
  for each row execute function app.seed_business_qc();
select app.seed_qc_checklists(id) from public.businesses;

create table public.qc_inspections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  number text not null,
  job_id uuid not null,
  inspector uuid not null references auth.users (id),
  inspected_on date not null,
  qty_inspected numeric(18, 4) not null check (qty_inspected > 0),
  qty_passed numeric(18, 4) not null default 0 check (qty_passed >= 0),
  qty_rework numeric(18, 4) not null default 0 check (qty_rework >= 0),
  qty_rejected numeric(18, 4) not null default 0 check (qty_rejected >= 0),
  -- {"Stitching even and secure": true, ...}
  results jsonb not null default '{}'::jsonb check (jsonb_typeof(results) = 'object'),
  defects text check (char_length(defects) <= 2000),
  instructions text check (char_length(instructions) <= 2000),
  document_id uuid,
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, job_id) references public.production_jobs (business_id, id),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id),
  check (qty_passed + qty_rework + qty_rejected = qty_inspected)
);
create index qc_inspections_job_idx on public.qc_inspections (job_id);

-------------------------------------------------------------------------------
-- Maker payments (owner-controlled; money only)
-------------------------------------------------------------------------------
create table public.maker_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  maker_id uuid not null,
  job_id uuid,
  paid_on date not null,
  amount bigint not null check (amount > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 120),
  verification public.payment_verification not null default 'recorded_manually',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  unique (business_id, id),
  foreign key (business_id, maker_id) references public.makers (business_id, id),
  foreign key (business_id, job_id) references public.production_jobs (business_id, id),
  check ((voided_at is null) = (void_reason is null))
);

-------------------------------------------------------------------------------
-- Job value helpers
-------------------------------------------------------------------------------
-- Material value issued into the job, net of returns (kobo).
create or replace function app.job_material_value(p_job uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(-sum(m.quantity * m.unit_cost), 0)
  from public.stock_movements m
  join public.stock_documents d on d.id = m.document_id
  where d.source_type = 'production_job' and d.source_id = p_job and d.doc_type in ('material_issue', 'material_return')
$$;

-- Value that has left the job as finished (or quarantined) goods (kobo).
create or replace function app.job_completed_value(p_job uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.quantity * m.unit_cost), 0)
  from public.stock_movements m
  join public.stock_documents d on d.id = m.document_id
  where d.source_type = 'production_job' and d.source_id = p_job and d.doc_type = 'production_completion'
$$;

create or replace function app.job_wip_value(p_job uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select app.job_material_value(j.id) + j.labour_cost + j.other_cost - app.job_completed_value(j.id)
  from public.production_jobs j where j.id = p_job
$$;
revoke all on function app.job_material_value, app.job_completed_value, app.job_wip_value from public, anon, authenticated;

-- Job costs, for callers who may see costs.
create or replace function public.job_costs(p_job uuid)
returns table (material_value numeric, labour_cost numeric, other_cost numeric, completed_value numeric,
  wip_value numeric, fee_approved bigint, paid bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select app.job_material_value(j.id), j.labour_cost, j.other_cost, app.job_completed_value(j.id),
    app.job_wip_value(j.id), j.fee_approved,
    coalesce((select sum(amount) from public.maker_payments p where p.job_id = j.id and p.voided_at is null), 0)::bigint
  from public.production_jobs j
  where j.id = p_job and app.can_view_costs(j.business_id)
$$;

-- BOM costs, for callers who may see costs.
create or replace function public.bom_costs(p_bom uuid)
returns table (labour_cost numeric, other_cost numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select b.labour_cost, b.other_cost from public.boms b where b.id = p_bom and app.can_view_costs(b.business_id)
$$;

-- Locks the business, then the job row (the single lock order), and checks the caller.
create or replace function app.lock_job(p_job uuid)
returns public.production_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bid uuid;
  j public.production_jobs;
begin
  select business_id into v_bid from public.production_jobs where id = p_job;
  if v_bid is null or not app.is_production(v_bid) then
    raise exception 'Only an owner or the production manager can work on production jobs.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = v_bid for update;
  select * into j from public.production_jobs where id = p_job for update;
  return j;
end;
$$;
revoke all on function app.lock_job from public, anon, authenticated;

-------------------------------------------------------------------------------
-- BOM RPCs
-------------------------------------------------------------------------------
-- Creates a new draft (p_bom_id null) or edits a draft. Costs kept as they were when the caller can't see costs.
-- p_lines: [{ "item": uuid, "qty": numeric, "unit": text, "wastage_pct": numeric, "variant": uuid|null, "notes": text }]
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

-- Makes a draft the product's standard recipe; the previous one is archived (kept for history).
create or replace function public.activate_bom(p_bom_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bom public.boms;
begin
  select * into v_bom from public.boms where id = p_bom_id for update;
  if v_bom.id is null or not app.is_production(v_bom.business_id) then
    raise exception 'Only an owner or the production manager can activate a recipe.' using errcode = '42501';
  end if;
  if v_bom.status = 'active' then return; end if;
  if v_bom.status <> 'draft' then
    raise exception 'An archived recipe cannot be activated again. Make a new version.' using errcode = 'P0001';
  end if;
  if not v_bom.is_one_off then
    update public.boms set status = 'archived' where product_id = v_bom.product_id and status = 'active' and not is_one_off;
  end if;
  update public.boms set status = 'active' where id = p_bom_id;
end;
$$;

-- Copies a recipe into a new draft version.
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

-------------------------------------------------------------------------------
-- Job RPCs
-------------------------------------------------------------------------------
-- Creates a job for a finished-good variant. The recipe's lines are copied into the job (later recipe
-- changes don't alter it), with quantities × planned units × (1 + wastage).
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

-- Adds or changes a planned material before it's issued (one-off adjustments, custom orders).
create or replace function public.set_job_material(p_job uuid, p_item uuid, p_qty numeric, p_unit text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
  v_item public.stock_items;
  v_qty numeric;
  v_jm public.job_materials;
  v_reserved numeric;
begin
  j := app.lock_job(p_job);
  if j.status not in ('planned', 'allocated', 'in_progress') then
    raise exception 'This job is %; its materials can no longer be planned.', j.status using errcode = 'P0001';
  end if;
  select * into v_item from public.stock_items where id = p_item and business_id = j.business_id;
  if v_item.id is null or v_item.kind = 'finished_good' then
    raise exception 'Choose a material or packaging item.' using errcode = 'P0001';
  end if;
  v_qty := round(coalesce(p_qty, 0) * app.item_unit_factor(v_item, coalesce(nullif(btrim(p_unit), ''), v_item.base_unit)), 4);
  if v_qty < 0 then
    raise exception 'Enter a quantity of zero or more.' using errcode = 'P0001';
  end if;
  select * into v_jm from public.job_materials where job_id = p_job and stock_item_id = p_item;
  select coalesce(sum(qty_base), 0) into v_reserved from public.stock_reservations
    where source_type = 'production_job' and source_id = p_job and stock_item_id = p_item and status = 'active';
  if v_reserved > 0 then
    raise exception 'Release the reservation for % first (or issue it).', v_item.name using errcode = 'P0001';
  end if;
  if v_jm.id is null then
    insert into public.job_materials (business_id, job_id, stock_item_id, planned_qty_base)
    values (j.business_id, p_job, p_item, v_qty);
  else
    update public.job_materials set planned_qty_base = v_qty where id = v_jm.id;
  end if;
end;
$$;

create or replace function public.assign_job_maker(p_job uuid, p_maker_id uuid, p_due_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
begin
  j := app.lock_job(p_job);
  if j.status in ('completed', 'cancelled') then
    raise exception 'This job is %.', j.status using errcode = 'P0001';
  end if;
  if p_maker_id is not null and not exists (
    select 1 from public.makers where id = p_maker_id and business_id = j.business_id and archived_at is null
  ) then
    raise exception 'Choose a maker from the directory.' using errcode = 'P0001';
  end if;
  update public.production_jobs set maker_id = p_maker_id, due_date = p_due_date where id = p_job;
end;
$$;

-- Owner sets the agreed labour fee (part of the job's cost) and other direct costs for the whole job.
create or replace function public.set_job_costs(p_job uuid, p_labour_cost numeric, p_other_cost numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
begin
  j := app.lock_job(p_job);
  if not app.is_owner(j.business_id) then
    raise exception 'Only an owner can set labour and other costs on a job.' using errcode = '42501';
  end if;
  if j.status in ('completed', 'cancelled') or j.qty_passed + j.qty_rejected > 0 then
    raise exception 'Costs can only change before any units are completed.' using errcode = 'P0001';
  end if;
  if coalesce(p_labour_cost, 0) < 0 or coalesce(p_other_cost, 0) < 0 then
    raise exception 'Costs cannot be negative.' using errcode = 'P0001';
  end if;
  update public.production_jobs set labour_cost = coalesce(p_labour_cost, 0), other_cost = coalesce(p_other_cost, 0)
    where id = p_job;
end;
$$;

-- Reserves everything the job still needs. All or nothing: if anything is short, nothing is reserved
-- and the message lists the shortages.
create or replace function public.allocate_job_materials(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
  r record;
  v_short text := '';
  v_avail numeric;
begin
  j := app.lock_job(p_job);
  if j.status not in ('planned', 'allocated', 'in_progress') then
    raise exception 'This job is %; nothing to allocate.', j.status using errcode = 'P0001';
  end if;
  perform 1 from public.stock_items where id in (select stock_item_id from public.job_materials where job_id = p_job)
    order by id for update;
  for r in
    select m.stock_item_id, i.name, i.base_unit,
      greatest(m.planned_qty_base - m.issued_qty_base + m.returned_qty_base
        - coalesce((select sum(qty_base) from public.stock_reservations s
                    where s.source_type = 'production_job' and s.source_id = p_job
                      and s.stock_item_id = m.stock_item_id and s.status = 'active'), 0), 0) as need
    from public.job_materials m join public.stock_items i on i.id = m.stock_item_id
    where m.job_id = p_job
    order by i.name
  loop
    if r.need > 0 then
      v_avail := app.available_qty(r.stock_item_id);
      if v_avail < r.need then
        v_short := v_short || format('%s: need %s %s, %s available. ', r.name,
          app.fmt_qty(r.need), r.base_unit, app.fmt_qty(greatest(v_avail, 0)));
      end if;
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Not enough material. %', v_short using errcode = 'P0001';
  end if;
  insert into public.stock_reservations (business_id, stock_item_id, qty_base, source_type, source_id, created_by)
  select j.business_id, m.stock_item_id,
    greatest(m.planned_qty_base - m.issued_qty_base + m.returned_qty_base
      - coalesce((select sum(qty_base) from public.stock_reservations s
                  where s.source_type = 'production_job' and s.source_id = p_job
                    and s.stock_item_id = m.stock_item_id and s.status = 'active'), 0), 0),
    'production_job', p_job, (select auth.uid())
  from public.job_materials m
  where m.job_id = p_job
    and m.planned_qty_base - m.issued_qty_base + m.returned_qty_base
      - coalesce((select sum(qty_base) from public.stock_reservations s
                  where s.source_type = 'production_job' and s.source_id = p_job
                    and s.stock_item_id = m.stock_item_id and s.status = 'active'), 0) > 0;
  if j.status = 'planned' then
    update public.production_jobs set status = 'allocated' where id = p_job;
  end if;
end;
$$;

create or replace function app.release_job_reservations(p_job uuid, p_item uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stock_reservations set status = 'released', closed_at = now()
  where source_type = 'production_job' and source_id = p_job and status = 'active'
    and (p_item is null or stock_item_id = p_item)
$$;
revoke all on function app.release_job_reservations from public, anon, authenticated;

create or replace function public.release_job_materials(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
begin
  j := app.lock_job(p_job);
  perform app.release_job_reservations(p_job);
  if j.status = 'allocated' then
    update public.production_jobs set status = 'planned' where id = p_job;
  end if;
end;
$$;

-- Issues material from a location into the job (consumed here, once; value becomes WIP).
-- p_lines: [{ "item": uuid, "qty": numeric (base units) }]
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
    -- Anything beyond the reservation must not eat into stock reserved for other jobs or orders.
    if v_take > 0 and app.available_qty(v_item.id) < v_take then
      raise exception 'Not enough unreserved %: other jobs or orders have the rest reserved.', v_item.name using errcode = 'P0001';
    end if;
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

-- Unused material back from the job, at the job's average issue cost for that item.
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

-- The location that holds stock for an external maker (created the first time it's needed).
create or replace function public.maker_location(p_maker_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.makers;
  v_id uuid;
begin
  select * into m from public.makers where id = p_maker_id;
  if m.id is null or not app.is_production(m.business_id) then
    raise exception 'Only an owner or the production manager can send materials to makers.' using errcode = '42501';
  end if;
  select id into v_id from public.locations where business_id = m.business_id and maker_id = m.id;
  if v_id is null then
    insert into public.locations (business_id, name, kind, maker_id)
    values (m.business_id, left('With ' || m.name, 80), 'external_maker', m.id)
    on conflict (business_id, name) do nothing
    returning id into v_id;
    if v_id is null then
      insert into public.locations (business_id, name, kind, maker_id)
      values (m.business_id, left('With ' || m.name || ' (' || left(m.id::text, 4) || ')', 80), 'external_maker', m.id)
      returning id into v_id;
    end if;
  end if;
  return v_id;
end;
$$;

-- Materials moved for a job between locations (e.g. to or from an external maker): a transfer.
-- The material stays business stock and stays reserved for the job until it's issued.
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

create or replace function public.submit_job_for_qc(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
begin
  j := app.lock_job(p_job);
  if j.status = 'in_qc' then return; end if;
  if j.status not in ('planned', 'allocated', 'in_progress') then
    raise exception 'Only work in progress can go to QC. This job is %.', j.status using errcode = 'P0001';
  end if;
  if j.finished_item_id is null then
    raise exception 'This job has no finished item to complete.' using errcode = 'P0001';
  end if;
  update public.production_jobs set status = 'in_qc' where id = p_job;
end;
$$;

-- Records a QC inspection. Passed units enter finished stock (saleable); rejected units go to Quarantine;
-- rework units stay in WIP and the job goes back to work. Each unit leaving WIP takes an equal share
-- of the job's remaining WIP value.
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
    if p_passed > 0 then
      v_stock := v_stock || jsonb_build_object('item', j.finished_item_id, 'location', p_to, 'qty', p_passed, 'unit_cost', v_unit);
    end if;
    if p_rejected > 0 then
      select id into v_quarantine from public.locations
        where business_id = j.business_id and kind = 'quarantine' and archived_at is null order by created_at limit 1;
      if v_quarantine is null then
        raise exception 'Add a Quarantine location first.' using errcode = 'P0001';
      end if;
      v_stock := v_stock || jsonb_build_object('item', j.finished_item_id, 'location', v_quarantine, 'qty', p_rejected, 'unit_cost', v_unit);
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

-- Cancels a job before anything is completed. Material still with the job must be returned first.
create or replace function public.cancel_production_job(p_job uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
begin
  j := app.lock_job(p_job);
  if j.status in ('completed', 'cancelled') then
    raise exception 'This job is already %.', j.status using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  if j.qty_passed + j.qty_rejected > 0 then
    raise exception 'Some items from this job are already finished, so it cannot be cancelled.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.job_materials where job_id = p_job and issued_qty_base > returned_qty_base) then
    raise exception 'Return the materials still with this job first (or record them as used and write them off).' using errcode = 'P0001';
  end if;
  perform app.release_job_reservations(p_job);
  update public.production_jobs set status = 'cancelled', cancelled_reason = btrim(p_reason) where id = p_job;
end;
$$;

-- Owner approves what the maker is owed once the job is done; payments are recorded separately.
create or replace function public.approve_maker_fee(p_job uuid, p_amount bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.production_jobs;
begin
  j := app.lock_job(p_job);
  if not app.is_owner(j.business_id) then
    raise exception 'Only an owner can approve what a maker is owed.' using errcode = '42501';
  end if;
  if j.maker_id is null then
    raise exception 'Assign a maker first.' using errcode = 'P0001';
  end if;
  if j.status <> 'completed' then
    raise exception 'Approve the fee once the job is completed.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount owed.' using errcode = 'P0001';
  end if;
  update public.production_jobs set fee_approved = p_amount, fee_approved_at = now(), fee_approved_by = (select auth.uid())
    where id = p_job;
end;
$$;

create or replace function public.record_maker_payment(
  p_business_id uuid, p_maker_id uuid, p_job uuid, p_paid_on date, p_amount bigint,
  p_method public.payment_method, p_reference text
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
    raise exception 'Only an owner can record maker payments.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount paid.' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.makers where id = p_maker_id and business_id = p_business_id) then
    raise exception 'Unknown maker.' using errcode = 'P0001';
  end if;
  if p_job is not null and not exists (
    select 1 from public.production_jobs where id = p_job and business_id = p_business_id and maker_id = p_maker_id
  ) then
    raise exception 'That job is not assigned to this maker.' using errcode = 'P0001';
  end if;
  insert into public.maker_payments (business_id, maker_id, job_id, paid_on, amount, method, reference, created_by)
  values (p_business_id, p_maker_id, p_job, p_paid_on, p_amount, p_method, nullif(btrim(p_reference), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-------------------------------------------------------------------------------
-- Reversals: production documents are undone from the job, not the Movements page
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
  if d.source_type = 'goods_receipt' and exists (select 1 from public.supplier_returns where receipt_id = d.source_id) then
    raise exception 'Some of these goods were already returned to the supplier, so this receipt cannot be reversed.' using errcode = 'P0001';
  end if;
  if d.source_type = 'supplier_return' then
    raise exception 'A supplier return cannot be reversed. Receive the goods again instead.' using errcode = 'P0001';
  end if;
  if d.source_type = 'production_job' and d.doc_type <> 'transfer' then
    raise exception 'Production documents are corrected from the job (return materials, or record QC again).' using errcode = 'P0001';
  end if;

  perform 1 from public.stock_items where id in (select stock_item_id from public.stock_movements where document_id = d.id)
    order by id for update;

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

  if d.source_type = 'opening_batch' then
    update public.opening_batches set status = 'reversed', reversal_reason = coalesce(reversal_reason, btrim(p_reason))
      where id = d.source_id and business_id = v_bid;
  elsif d.source_type = 'adjustment_request' then
    update public.adjustment_requests set status = 'reversed' where id = d.source_id and business_id = v_bid;
  elsif d.source_type = 'goods_receipt' then
    perform app.undo_goods_receipt(d.source_id, p_reason);
  end if;
  return v_new;
end;
$$;
revoke all on function app.reverse_stock_document from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Grants and Row Level Security
-------------------------------------------------------------------------------
revoke all on function public.job_costs, public.bom_costs, public.save_bom, public.activate_bom, public.copy_bom,
  public.create_production_job, public.set_job_material, public.assign_job_maker, public.set_job_costs,
  public.allocate_job_materials, public.release_job_materials, public.issue_job_materials, public.return_job_materials,
  public.maker_location, public.move_job_materials, public.submit_job_for_qc, public.record_qc_inspection,
  public.cancel_production_job, public.approve_maker_fee, public.record_maker_payment from public, anon;
grant execute on function public.job_costs, public.bom_costs, public.save_bom, public.activate_bom, public.copy_bom,
  public.create_production_job, public.set_job_material, public.assign_job_maker, public.set_job_costs,
  public.allocate_job_materials, public.release_job_materials, public.issue_job_materials, public.return_job_materials,
  public.maker_location, public.move_job_materials, public.submit_job_for_qc, public.record_qc_inspection,
  public.cancel_production_job, public.approve_maker_fee, public.record_maker_payment to authenticated;
comment on function public.job_costs is 'Intentional SECURITY DEFINER: returns rows only when the caller may see costs.';
comment on function public.bom_costs is 'Intentional SECURITY DEFINER: returns rows only when the caller may see costs.';
comment on function public.issue_job_materials is 'Intentional SECURITY DEFINER: production check, then the posting engine.';
comment on function public.record_qc_inspection is 'Intentional SECURITY DEFINER: production check, then the posting engine.';
comment on function public.record_maker_payment is 'Intentional SECURITY DEFINER: owner-only; money only.';

alter table public.stock_reservations enable row level security;
alter table public.boms enable row level security;
alter table public.bom_lines enable row level security;
alter table public.job_materials enable row level security;
alter table public.qc_checklists enable row level security;
alter table public.qc_inspections enable row level security;
alter table public.maker_payments enable row level security;

revoke all on public.stock_reservations, public.stock_availability, public.boms, public.bom_lines, public.job_materials,
  public.qc_checklists, public.qc_inspections, public.maker_payments from anon;
revoke insert, update, delete on public.stock_reservations, public.boms, public.bom_lines, public.job_materials,
  public.qc_inspections, public.maker_payments from authenticated;
revoke insert, delete on public.qc_checklists from authenticated;

create policy "read reservations by role" on public.stock_reservations
  for select to authenticated
  using (
    app.is_production(business_id)
    or (app.is_office(business_id) and exists (
      select 1 from public.stock_items i where i.id = stock_item_id and i.kind = 'finished_good'))
  );
create policy "production reads boms" on public.boms
  for select to authenticated using (app.is_production(business_id));
create policy "production reads bom lines" on public.bom_lines
  for select to authenticated using (app.is_production(business_id));
create policy "production reads job materials" on public.job_materials
  for select to authenticated using (app.is_production(business_id));
create policy "production reads qc checklists" on public.qc_checklists
  for select to authenticated using (app.is_production(business_id));
create policy "production edits qc checklists" on public.qc_checklists
  for update to authenticated using (app.is_production(business_id)) with check (app.is_production(business_id));
revoke update on public.qc_checklists from authenticated;
grant update (items) on public.qc_checklists to authenticated;
create policy "production reads qc inspections" on public.qc_inspections
  for select to authenticated using (app.is_production(business_id));
create policy "owners read maker payments" on public.maker_payments
  for select to authenticated using (app.is_owner(business_id));

-- Costs are never selectable directly.
revoke select on public.boms from authenticated;
grant select (id, business_id, product_id, name, version, status, is_one_off, instructions, created_by, created_at, updated_at)
  on public.boms to authenticated;

-- Jobs: written only through the RPCs; the front office can follow progress; costs hidden.
drop policy if exists "production creates production jobs" on public.production_jobs;
drop policy if exists "production updates production jobs" on public.production_jobs;
revoke insert, update, delete on public.production_jobs from authenticated;
revoke select on public.production_jobs from authenticated;
grant select (id, business_id, order_item_id, assigned_to, due_date, status, notes, created_at, updated_at, number, kind,
  product_id, variant_id, finished_item_id, planned_qty, bom_id, bom_version, instructions, maker_id, start_date,
  qty_passed, qty_rejected, fee_approved_at, completed_at, cancelled_reason, created_by)
  on public.production_jobs to authenticated;

create trigger audit_boms after insert or update on public.boms for each row execute function app.write_audit();
create trigger audit_production_jobs after insert or update on public.production_jobs for each row execute function app.write_audit();
create trigger audit_qc_inspections after insert on public.qc_inspections for each row execute function app.write_audit();
create trigger audit_maker_payments after insert or update on public.maker_payments for each row execute function app.write_audit();
create trigger audit_qc_checklists after update on public.qc_checklists for each row execute function app.write_audit();
