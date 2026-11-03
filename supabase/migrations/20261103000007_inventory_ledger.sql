-- Spec 2 Phase 1: units, suppliers, makers, locations, stock items and the inventory ledger.
--
-- Ledger rules (docs/COSTING.md):
--   * stock_movements is the source of truth. Physical on hand = sum(quantity) per item and location.
--   * Rows are written only by posting functions (SECURITY DEFINER, explicit role checks), one
--     transaction per document. No role may insert, update or delete ledger rows directly.
--   * Posted documents are never changed. Mistakes are undone by a reversal document.
--   * Idempotency key per document; stock item rows are locked while posting (no double posting,
--     no overselling under concurrency); negative stock is refused.
--   * Quantities are numeric in the item's base unit. Unit costs are kobo per base unit (numeric).
--   * Valuation: moving weighted average per item, across all locations.

-------------------------------------------------------------------------------
-- Units (global, read-only reference data)
-------------------------------------------------------------------------------
create table public.units (
  code text primary key,
  name text not null,
  -- Units only convert within the same dimension (never pieces ↔ pairs ↔ metres).
  dimension text not null check (dimension in ('length', 'area', 'mass', 'volume', 'count', 'pair')),
  -- How many of the dimension's base unit one of this unit is (m, m2, kg, l, pc, pair).
  to_base numeric(20, 10) not null check (to_base > 0)
);

insert into public.units (code, name, dimension, to_base) values
  ('m', 'metre', 'length', 1),
  ('cm', 'centimetre', 'length', 0.01),
  ('mm', 'millimetre', 'length', 0.001),
  ('yd', 'yard', 'length', 0.9144),
  ('in', 'inch', 'length', 0.0254),
  ('m2', 'square metre', 'area', 1),
  ('ft2', 'square foot', 'area', 0.09290304),
  ('kg', 'kilogram', 'mass', 1),
  ('g', 'gram', 'mass', 0.001),
  ('l', 'litre', 'volume', 1),
  ('ml', 'millilitre', 'volume', 0.001),
  ('pc', 'piece', 'count', 1),
  ('dozen', 'dozen', 'count', 12),
  ('pair', 'pair', 'pair', 1);

alter table public.units enable row level security;
create policy "signed-in users read units" on public.units for select to authenticated using (true);
revoke insert, update, delete on public.units from authenticated, anon;

-- Converts a quantity between units of the same dimension; errors otherwise.
create or replace function app.convert_qty(p_qty numeric, p_from text, p_to text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  f public.units;
  t public.units;
begin
  if p_from = p_to then return p_qty; end if;
  select * into f from public.units where code = p_from;
  select * into t from public.units where code = p_to;
  if f.code is null or t.code is null then
    raise exception 'Unknown unit.' using errcode = 'P0001';
  end if;
  if f.dimension <> t.dimension then
    raise exception 'Cannot convert % to % (different kinds of unit).', f.name, t.name using errcode = 'P0001';
  end if;
  return p_qty * f.to_base / t.to_base;
end;
$$;
grant execute on function app.convert_qty(numeric, text, text) to authenticated;

-------------------------------------------------------------------------------
-- Business stock settings and counters
-------------------------------------------------------------------------------
alter table public.businesses
  add column cutover_date date,
  -- Postings dated on or before this date are refused (owner-controlled).
  add column stock_closed_through date,
  add column next_stock_doc_number integer not null default 1 check (next_stock_doc_number > 0),
  add column next_batch_number integer not null default 1 check (next_batch_number > 0);
grant update (cutover_date, stock_closed_through) on public.businesses to authenticated;

-------------------------------------------------------------------------------
-- Suppliers and makers
-------------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  contact_name text check (char_length(contact_name) <= 120),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  address text check (char_length(address) <= 300),
  notes text check (char_length(notes) <= 2000),
  external_id text check (char_length(external_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  unique (business_id, external_id)
);
create index suppliers_business_idx on public.suppliers (business_id, lower(name));

create table public.makers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  trade text not null default 'tailor' check (trade in ('tailor', 'shoemaker', 'bag_maker', 'other')),
  is_external boolean not null default false,
  phone text check (char_length(phone) <= 40),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id)
);
create index makers_business_idx on public.makers (business_id, lower(name));

-------------------------------------------------------------------------------
-- Locations
-------------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind text not null check (kind in ('store', 'production', 'showroom', 'external_maker', 'quarantine')),
  -- Stock held by an external maker is still business-owned (Spec 2 §8).
  maker_id uuid,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  unique (business_id, name),
  foreign key (business_id, maker_id) references public.makers (business_id, id),
  check ((kind = 'external_maker') = (maker_id is not null))
);

create or replace function app.seed_business_locations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.locations (business_id, name, kind) values
    (new.id, 'Raw material store', 'store'),
    (new.id, 'Production floor', 'production'),
    (new.id, 'Finished goods / showroom', 'showroom'),
    (new.id, 'Quarantine', 'quarantine');
  return new;
end;
$$;
create trigger businesses_seed_locations after insert on public.businesses
  for each row execute function app.seed_business_locations();

insert into public.locations (business_id, name, kind)
select b.id, x.name, x.kind
from public.businesses b
cross join (values ('Raw material store', 'store'), ('Production floor', 'production'),
                   ('Finished goods / showroom', 'showroom'), ('Quarantine', 'quarantine')) as x(name, kind)
on conflict (business_id, name) do nothing;

-------------------------------------------------------------------------------
-- Finished-good catalogue: extend products and variants
-------------------------------------------------------------------------------
alter table public.products
  add column external_id text check (char_length(external_id) <= 120),
  add constraint products_business_external_key unique (business_id, external_id);

alter table public.product_variants
  add column length text check (char_length(length) <= 30),
  -- Other configurable options, e.g. {"heel": "low"}.
  add column options jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  add column external_id text check (char_length(external_id) <= 120),
  add constraint product_variants_business_external_key unique (business_id, external_id);
create unique index product_variants_sku_key on public.product_variants (business_id, lower(sku)) where sku is not null;

-------------------------------------------------------------------------------
-- Stock items: raw materials, packaging and finished-good variants
-------------------------------------------------------------------------------
create table public.stock_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  kind text not null check (kind in ('raw_material', 'packaging', 'finished_good')),
  code text not null check (char_length(btrim(code)) between 1 and 60),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text check (char_length(category) <= 80),
  colour text check (char_length(colour) <= 60),
  specs text check (char_length(specs) <= 500),
  base_unit text not null references public.units (code),
  -- Item-specific purchase pack, e.g. "roll" = 50 m. Base units per purchase unit.
  purchase_unit text check (char_length(purchase_unit) <= 30),
  purchase_factor numeric(18, 6) check (purchase_factor > 0),
  default_supplier_id uuid,
  default_location_id uuid,
  reorder_level numeric(18, 4) check (reorder_level >= 0),
  variant_id uuid unique,
  -- Moving weighted average cost, kobo per base unit. Not readable directly: see stock_valuation().
  avg_cost numeric(20, 6) not null default 0 check (avg_cost >= 0),
  external_id text check (char_length(external_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (business_id, id),
  foreign key (business_id, default_supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, default_location_id) references public.locations (business_id, id),
  foreign key (business_id, variant_id) references public.product_variants (business_id, id),
  check ((kind = 'finished_good') = (variant_id is not null)),
  check ((purchase_unit is null) = (purchase_factor is null))
);
create unique index stock_items_code_key on public.stock_items (business_id, lower(code));
create unique index stock_items_external_key on public.stock_items (business_id, external_id) where external_id is not null;
create index stock_items_kind_idx on public.stock_items (business_id, kind, lower(name));

-- Every finished-good variant has exactly one stock item, kept in step automatically.
create or replace function app.sync_variant_stock_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products;
  v_name text;
  v_unit text;
begin
  select * into p from public.products where id = new.product_id;
  v_name := p.name || coalesce(' · ' || nullif(concat_ws(' / ', new.size, new.colour, new.length), ''), '');
  v_unit := case when p.category = 'shoes' then 'pair' else 'pc' end;
  insert into public.stock_items (business_id, kind, code, name, category, colour, base_unit, variant_id, archived_at)
  values (new.business_id, 'finished_good',
          coalesce(nullif(new.sku, ''), 'FG-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))),
          v_name, p.category::text, new.colour, v_unit, new.id, new.archived_at)
  on conflict (variant_id) do update set
    code = excluded.code, name = excluded.name, category = excluded.category,
    colour = excluded.colour, archived_at = excluded.archived_at, updated_at = now();
  return new;
end;
$$;
create trigger product_variants_stock_item after insert or update on public.product_variants
  for each row execute function app.sync_variant_stock_item();

-- Renaming or recategorising a product renames its variants' stock items.
create or replace function app.touch_product_variants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.category is distinct from old.category then
    update public.product_variants set sku = sku where product_id = new.id;
  end if;
  return new;
end;
$$;
create trigger products_touch_variants after update on public.products
  for each row execute function app.touch_product_variants();

-- Backfill for variants created before this migration (e.g. demo data).
update public.product_variants set sku = sku;

create trigger touch_stock_items before update on public.stock_items for each row execute function app.touch_updated_at();
create trigger touch_suppliers before update on public.suppliers for each row execute function app.touch_updated_at();
create trigger touch_makers before update on public.makers for each row execute function app.touch_updated_at();

-------------------------------------------------------------------------------
-- Ledger
-------------------------------------------------------------------------------
create table public.stock_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  doc_type text not null check (doc_type in (
    'opening_balance', 'purchase_receipt', 'supplier_return', 'transfer', 'material_issue',
    'material_return', 'production_completion', 'customer_dispatch', 'customer_return',
    'scrap', 'adjustment', 'reversal'
  )),
  effective_date date not null,
  created_at timestamptz not null default now(),
  posted_by uuid not null references auth.users (id),
  reason text check (char_length(reason) <= 500),
  source_type text check (char_length(source_type) <= 40),
  source_id uuid,
  reverses_id uuid,
  reversed_by_id uuid,
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  unique (reverses_id),
  foreign key (business_id, reverses_id) references public.stock_documents (business_id, id),
  foreign key (business_id, reversed_by_id) references public.stock_documents (business_id, id),
  check ((doc_type = 'reversal') = (reverses_id is not null))
);
create index stock_documents_business_idx on public.stock_documents (business_id, effective_date desc, created_at desc);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  business_id uuid not null,
  document_id uuid not null,
  stock_item_id uuid not null,
  location_id uuid not null,
  -- Positive = into the location, negative = out of it. Base units of the item.
  quantity numeric(18, 4) not null check (quantity <> 0),
  -- Kobo per base unit at the time of posting. Not readable directly.
  unit_cost numeric(20, 6) not null default 0 check (unit_cost >= 0),
  effective_date date not null,
  created_at timestamptz not null default now(),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id),
  foreign key (business_id, location_id) references public.locations (business_id, id)
);
create index stock_movements_item_loc_idx on public.stock_movements (business_id, stock_item_id, location_id);
create index stock_movements_document_idx on public.stock_movements (document_id);

-- Physical on hand per item and location (RLS of the caller applies).
create view public.stock_balances
with (security_invoker = true)
as
select business_id, stock_item_id, location_id, sum(quantity)::numeric(18, 4) as on_hand
from public.stock_movements
group by business_id, stock_item_id, location_id
having sum(quantity) <> 0;

-------------------------------------------------------------------------------
-- Posting engine (internal; called only by the public RPCs below)
-------------------------------------------------------------------------------
-- p_lines: [{ "item": uuid, "location": uuid, "qty": numeric (signed, base units), "unit_cost": numeric|null }]
-- Cost-bearing incoming lines (unit_cost given, qty > 0) update the moving average.
-- Outgoing lines and lines without a cost are valued at the current average.
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
  v_closed date;
  v_number text;
  v_n integer;
  v_line jsonb;
  v_item public.stock_items;
  v_on_hand numeric;
  v_qty numeric;
  v_cost numeric;
  v_in_qty numeric;
  v_in_value numeric;
  r record;
begin
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;

  -- Same request again (double tap, retry): return what was already posted.
  select id into v_doc from public.stock_documents
    where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_doc is not null then
    return v_doc;
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A stock document needs at least one line.' using errcode = 'P0001';
  end if;
  if p_effective_date is null or p_effective_date > (now() at time zone 'Africa/Lagos')::date + 1 then
    raise exception 'The effective date cannot be in the future.' using errcode = 'P0001';
  end if;

  -- Lock the business row: serialises numbering and the closed-period check.
  update public.businesses set next_stock_doc_number = next_stock_doc_number + 1
    where id = p_business_id
    returning next_stock_doc_number - 1, stock_closed_through into v_n, v_closed;
  if v_n is null then
    raise exception 'Unknown business.' using errcode = 'P0001';
  end if;
  if v_closed is not null and p_effective_date <= v_closed then
    raise exception 'Stock is closed up to %. Choose a later date.', to_char(v_closed, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  v_number := 'SD-' || lpad(v_n::text, 5, '0');

  -- Lock every affected item (in a fixed order, so concurrent postings can't deadlock).
  perform 1 from public.stock_items
    where business_id = p_business_id
      and id in (select (l ->> 'item')::uuid from jsonb_array_elements(p_lines) l)
    order by id
    for update;

  insert into public.stock_documents (
    business_id, number, doc_type, effective_date, posted_by, reason, source_type, source_id,
    reverses_id, idempotency_key
  ) values (
    p_business_id, v_number, p_doc_type, p_effective_date, (select auth.uid()),
    nullif(btrim(p_reason), ''), p_source_type, p_source_id, p_reverses_id, p_idempotency_key
  )
  returning id into v_doc;

  -- Moving average: gather cost-bearing incoming quantity/value per item first.
  for r in
    select (l ->> 'item')::uuid as item,
      sum((l ->> 'qty')::numeric) filter (where (l ->> 'qty')::numeric > 0 and l ? 'unit_cost' and l ->> 'unit_cost' is not null) as in_qty,
      sum((l ->> 'qty')::numeric * (l ->> 'unit_cost')::numeric)
        filter (where (l ->> 'qty')::numeric > 0 and l ? 'unit_cost' and l ->> 'unit_cost' is not null) as in_value
    from jsonb_array_elements(p_lines) l
    group by 1
  loop
    if r.in_qty is not null and r.in_qty > 0 then
      select * into v_item from public.stock_items where id = r.item and business_id = p_business_id;
      select coalesce(sum(quantity), 0) into v_on_hand from public.stock_movements
        where business_id = p_business_id and stock_item_id = r.item;
      v_in_qty := r.in_qty;
      v_in_value := r.in_value;
      update public.stock_items set avg_cost = case
          when greatest(v_on_hand, 0) + v_in_qty > 0
            then ((greatest(v_on_hand, 0) * v_item.avg_cost) + v_in_value) / (greatest(v_on_hand, 0) + v_in_qty)
          else avg_cost end
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
    v_cost := coalesce((v_line ->> 'unit_cost')::numeric, v_item.avg_cost);
    if v_cost < 0 then
      raise exception 'Unit cost cannot be negative.' using errcode = 'P0001';
    end if;
    insert into public.stock_movements (business_id, document_id, stock_item_id, location_id, quantity, unit_cost, effective_date)
    values (p_business_id, v_doc, v_item.id, (v_line ->> 'location')::uuid, v_qty, v_cost, p_effective_date);
  end loop;

  -- No negative stock at any location this document took stock out of.
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

-- Mirror a posted document. Incoming cost-bearing lines come out at their original cost,
-- adjusting the moving average back; refused if the stock has already been used.
create or replace function app.reverse_stock_document(p_doc_id uuid, p_reason text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.stock_documents;
  v_new uuid;
  v_lines jsonb;
  r record;
  v_on_hand numeric;
  v_item public.stock_items;
begin
  select * into d from public.stock_documents where id = p_doc_id for update;
  if d.id is null then
    raise exception 'Unknown stock document.' using errcode = 'P0001';
  end if;
  if d.doc_type = 'reversal' then
    raise exception 'A reversal cannot itself be reversed. Post a new document instead.' using errcode = 'P0001';
  end if;
  if d.reversed_by_id is not null then
    -- Already reversed: idempotent for the same key, otherwise refuse.
    if exists (select 1 from public.stock_documents where id = d.reversed_by_id and idempotency_key = p_idempotency_key) then
      return d.reversed_by_id;
    end if;
    raise exception 'This document has already been reversed.' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for the reversal.' using errcode = 'P0001';
  end if;

  -- Undo the average-cost effect of cost-bearing incoming lines before posting the mirror.
  perform 1 from public.stock_items where id in (select stock_item_id from public.stock_movements where document_id = d.id)
    order by id for update;
  for r in
    select stock_item_id, sum(quantity) as q, sum(quantity * unit_cost) as v
    from public.stock_movements where document_id = d.id and quantity > 0
    group by stock_item_id
  loop
    select * into v_item from public.stock_items where id = r.stock_item_id;
    select coalesce(sum(quantity), 0) into v_on_hand from public.stock_movements where stock_item_id = r.stock_item_id;
    if v_on_hand - r.q > 0 and d.doc_type in ('opening_balance', 'purchase_receipt', 'production_completion', 'customer_return', 'adjustment') then
      update public.stock_items
        set avg_cost = greatest((v_on_hand * v_item.avg_cost - r.v) / (v_on_hand - r.q), 0)
        where id = r.stock_item_id;
    end if;
  end loop;

  -- Stock coming back (mirror of an outgoing line) returns at its original cost, which feeds the
  -- moving average; stock going out was handled above.
  select jsonb_agg(jsonb_build_object('item', stock_item_id, 'location', location_id, 'qty', -quantity,
           'unit_cost', case when quantity < 0 then unit_cost end))
    into v_lines from public.stock_movements where document_id = d.id;

  v_new := app.post_stock_document(d.business_id, 'reversal', greatest(d.effective_date, (now() at time zone 'Africa/Lagos')::date),
    v_lines, p_idempotency_key, p_reason, 'stock_document', d.id, d.id);

  -- The mirror carries the original line costs.
  update public.stock_movements nm set unit_cost = om.unit_cost
    from public.stock_movements om
    where nm.document_id = v_new and om.document_id = d.id
      and om.stock_item_id = nm.stock_item_id and om.location_id = nm.location_id and om.quantity = -nm.quantity;

  update public.stock_documents set reversed_by_id = v_new where id = d.id;
  return v_new;
end;
$$;
revoke all on function app.reverse_stock_document from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Public RPCs (role checks first, then the posting engine)
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
  -- Two equal and opposite lines: total business stock is unchanged.
  return app.post_stock_document(p_business_id, 'transfer', p_effective_date,
    jsonb_build_array(
      jsonb_build_object('item', p_item, 'location', p_from, 'qty', -p_qty),
      jsonb_build_object('item', p_item, 'location', p_to, 'qty', p_qty)
    ), p_idempotency_key, p_note);
end;
$$;

create or replace function public.reverse_stock_document(p_doc_id uuid, p_reason text, p_idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bid uuid;
begin
  select business_id into v_bid from public.stock_documents where id = p_doc_id;
  if v_bid is null or not app.is_owner(v_bid) then
    raise exception 'Only an owner can reverse a stock document.' using errcode = '42501';
  end if;
  return app.reverse_stock_document(p_doc_id, p_reason, p_idempotency_key);
end;
$$;

-- Valuation is cost data: owners and permitted production managers only.
create or replace function public.stock_valuation(p_business_id uuid)
returns table (stock_item_id uuid, location_id uuid, on_hand numeric, avg_cost numeric, value_kobo numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select b.stock_item_id, b.location_id, b.on_hand, i.avg_cost, round(b.on_hand * i.avg_cost, 2)
  from public.stock_balances b
  join public.stock_items i on i.id = b.stock_item_id
  where b.business_id = p_business_id and app.can_view_costs(p_business_id)
$$;

revoke all on function public.post_transfer, public.reverse_stock_document, public.stock_valuation from public, anon;
grant execute on function public.post_transfer, public.reverse_stock_document, public.stock_valuation to authenticated;
comment on function public.post_transfer is 'Intentional SECURITY DEFINER: owner/production check, then the posting engine.';
comment on function public.reverse_stock_document is 'Intentional SECURITY DEFINER: owner-only reversal through the posting engine.';
comment on function public.stock_valuation is 'Intentional SECURITY DEFINER: returns rows only when the caller may see costs.';

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.makers enable row level security;
alter table public.locations enable row level security;
alter table public.stock_items enable row level security;
alter table public.stock_documents enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.suppliers, public.makers, public.locations, public.stock_items,
  public.stock_documents, public.stock_movements, public.stock_balances from anon;
revoke delete on public.suppliers, public.makers, public.locations, public.stock_items,
  public.stock_documents, public.stock_movements from authenticated;

create policy "office and production read suppliers" on public.suppliers
  for select to authenticated using (app.is_office(business_id) or app.is_production(business_id));
create policy "production manages suppliers" on public.suppliers
  for insert to authenticated with check (app.is_production(business_id));
create policy "production updates suppliers" on public.suppliers
  for update to authenticated using (app.is_production(business_id)) with check (app.is_production(business_id));

create policy "production reads makers" on public.makers
  for select to authenticated using (app.is_production(business_id));
create policy "production adds makers" on public.makers
  for insert to authenticated with check (app.is_production(business_id));
create policy "production updates makers" on public.makers
  for update to authenticated using (app.is_production(business_id)) with check (app.is_production(business_id));

create policy "members read locations" on public.locations
  for select to authenticated using (app.is_member(business_id));
create policy "production adds locations" on public.locations
  for insert to authenticated with check (app.is_production(business_id));
create policy "production updates locations" on public.locations
  for update to authenticated using (app.is_production(business_id)) with check (app.is_production(business_id));
revoke update on public.locations from authenticated;
grant update (name, archived_at) on public.locations to authenticated;

-- Front office sees finished goods only; production sees everything; costs are never selectable.
create policy "read stock items by role" on public.stock_items
  for select to authenticated
  using (app.is_production(business_id) or (app.is_office(business_id) and kind = 'finished_good'));
create policy "production adds materials" on public.stock_items
  for insert to authenticated
  with check (app.is_production(business_id) and kind in ('raw_material', 'packaging'));
create policy "production updates materials" on public.stock_items
  for update to authenticated
  using (app.is_production(business_id) and kind in ('raw_material', 'packaging'))
  with check (app.is_production(business_id) and kind in ('raw_material', 'packaging'));
revoke select, insert, update on public.stock_items from authenticated;
grant select (id, business_id, kind, code, name, category, colour, specs, base_unit, purchase_unit, purchase_factor,
  default_supplier_id, default_location_id, reorder_level, variant_id, external_id, created_at, updated_at, archived_at)
  on public.stock_items to authenticated;
grant insert (business_id, kind, code, name, category, colour, specs, base_unit, purchase_unit, purchase_factor,
  default_supplier_id, default_location_id, reorder_level, external_id)
  on public.stock_items to authenticated;
grant update (code, name, category, colour, specs, purchase_unit, purchase_factor, default_supplier_id,
  default_location_id, reorder_level, archived_at)
  on public.stock_items to authenticated;

create policy "read stock documents by role" on public.stock_documents
  for select to authenticated using (app.is_production(business_id) or app.is_office(business_id));
revoke insert, update on public.stock_documents from authenticated;

create policy "read stock movements by role" on public.stock_movements
  for select to authenticated
  using (
    app.is_production(business_id)
    or (app.is_office(business_id) and exists (
      select 1 from public.stock_items i where i.id = stock_item_id and i.kind = 'finished_good'))
  );
revoke select, insert, update on public.stock_movements from authenticated;
grant select (id, business_id, document_id, stock_item_id, location_id, quantity, effective_date, created_at)
  on public.stock_movements to authenticated;

-- Audit: stock documents carry their own history; item and location edits are audited.
create trigger audit_stock_items after insert or update on public.stock_items
  for each row execute function app.write_audit();
create trigger audit_locations after insert or update on public.locations
  for each row execute function app.write_audit();
create trigger audit_makers after insert or update on public.makers
  for each row execute function app.write_audit();
