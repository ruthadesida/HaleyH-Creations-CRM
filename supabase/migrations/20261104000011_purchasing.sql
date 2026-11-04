-- Phase 2a: purchasing (Spec 2 §5).
--   Purchase request (draft PO) → owner-approved purchase order → goods receipts (partial, rejected)
--   → supplier returns; supplier bills and payments are separate, owner-only financial records.
--   A PO never changes stock. Only the accepted part of a goods receipt does, through the posting engine.
--   A supplier payment never changes stock.
--   Freight and other landed costs are entered once on a receipt and shared across its accepted lines
--   in proportion to their value (docs/COSTING.md). They can't be changed afterwards: reverse and re-receive.
--   Purchase prices are cost data: hidden from roles that can't see costs.

-------------------------------------------------------------------------------
-- Counters
-------------------------------------------------------------------------------
alter table public.businesses
  add column next_po_number integer not null default 1 check (next_po_number > 0),
  add column next_receipt_number integer not null default 1 check (next_receipt_number > 0),
  add column next_supplier_return_number integer not null default 1 check (next_supplier_return_number > 0);

-------------------------------------------------------------------------------
-- Purchase orders
-------------------------------------------------------------------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  supplier_id uuid not null,
  -- draft = purchase request (anyone in production can raise it); ordered = owner-approved.
  status text not null default 'draft'
    check (status in ('draft', 'ordered', 'part_received', 'received', 'cancelled', 'closed')),
  expected_date date,
  notes text check (char_length(notes) <= 2000),
  created_by uuid not null references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  closed_reason text check (char_length(closed_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, number),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id)
);
create index purchase_orders_business_idx on public.purchase_orders (business_id, created_at desc);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  po_id uuid not null,
  line_no integer not null check (line_no > 0),
  stock_item_id uuid not null,
  -- As ordered: quantity in `unit` (a unit code, or the item's own purchase unit such as "roll").
  qty numeric(18, 4) not null check (qty > 0),
  unit text not null check (char_length(unit) between 1 and 30),
  -- Base units of the item per one `unit`, fixed when the line is saved.
  factor numeric(20, 10) not null check (factor > 0),
  qty_base numeric(18, 4) not null check (qty_base > 0),
  -- Kobo per `unit`. Null on an unpriced request; required before approval. Not readable directly.
  unit_price numeric(20, 6) check (unit_price >= 0),
  qty_received_base numeric(18, 4) not null default 0 check (qty_received_base >= 0),
  qty_rejected_base numeric(18, 4) not null default 0 check (qty_rejected_base >= 0),
  unique (business_id, id),
  unique (po_id, line_no),
  foreign key (business_id, po_id) references public.purchase_orders (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id)
);
create index purchase_order_lines_po_idx on public.purchase_order_lines (po_id);

-------------------------------------------------------------------------------
-- Goods receipts
-------------------------------------------------------------------------------
create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  po_id uuid,
  supplier_id uuid,
  location_id uuid not null,
  effective_date date not null,
  supplier_ref text check (char_length(supplier_ref) <= 120),
  -- Freight, duty, transport for the whole receipt, in kobo. Not readable directly.
  landed_cost bigint not null default 0 check (landed_cost >= 0),
  notes text check (char_length(notes) <= 1000),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  document_id uuid,
  posted_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  reversal_reason text check (char_length(reversal_reason) <= 500),
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, po_id) references public.purchase_orders (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, location_id) references public.locations (business_id, id),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id)
);
create index goods_receipts_business_idx on public.goods_receipts (business_id, created_at desc);
create index goods_receipts_po_idx on public.goods_receipts (po_id);

create table public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  receipt_id uuid not null,
  po_line_id uuid,
  stock_item_id uuid not null,
  qty_accepted_base numeric(18, 4) not null default 0 check (qty_accepted_base >= 0),
  qty_rejected_base numeric(18, 4) not null default 0 check (qty_rejected_base >= 0),
  reject_reason text check (char_length(reject_reason) <= 300),
  -- Kobo per base unit: price paid, and price + share of landed cost (what enters stock). Not readable directly.
  unit_price numeric(20, 6) not null default 0 check (unit_price >= 0),
  unit_cost numeric(20, 6) not null default 0 check (unit_cost >= 0),
  qty_returned_base numeric(18, 4) not null default 0 check (qty_returned_base >= 0),
  unique (business_id, id),
  foreign key (business_id, receipt_id) references public.goods_receipts (business_id, id),
  foreign key (business_id, po_line_id) references public.purchase_order_lines (business_id, id),
  foreign key (business_id, stock_item_id) references public.stock_items (business_id, id),
  check (qty_accepted_base + qty_rejected_base > 0),
  check (qty_returned_base <= qty_accepted_base)
);
create index goods_receipt_lines_receipt_idx on public.goods_receipt_lines (receipt_id);

-------------------------------------------------------------------------------
-- Supplier returns (accepted goods sent back after receipt)
-------------------------------------------------------------------------------
create table public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  number text not null,
  receipt_id uuid not null,
  location_id uuid not null,
  effective_date date not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  document_id uuid not null,
  posted_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  idempotency_key uuid not null,
  unique (business_id, id),
  unique (business_id, number),
  unique (business_id, idempotency_key),
  foreign key (business_id, receipt_id) references public.goods_receipts (business_id, id),
  foreign key (business_id, location_id) references public.locations (business_id, id),
  foreign key (business_id, document_id) references public.stock_documents (business_id, id)
);

create table public.supplier_return_lines (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  return_id uuid not null,
  receipt_line_id uuid not null,
  qty_base numeric(18, 4) not null check (qty_base > 0),
  unique (business_id, id),
  foreign key (business_id, return_id) references public.supplier_returns (business_id, id),
  foreign key (business_id, receipt_line_id) references public.goods_receipt_lines (business_id, id)
);

-------------------------------------------------------------------------------
-- Supplier bills and payments (owner-only financial records; never stock)
-------------------------------------------------------------------------------
create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null,
  po_id uuid,
  receipt_id uuid,
  bill_ref text check (char_length(bill_ref) <= 120),
  bill_date date not null,
  amount bigint not null check (amount > 0),
  notes text check (char_length(notes) <= 1000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  unique (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, po_id) references public.purchase_orders (business_id, id),
  foreign key (business_id, receipt_id) references public.goods_receipts (business_id, id),
  check ((voided_at is null) = (void_reason is null))
);
create index supplier_bills_supplier_idx on public.supplier_bills (business_id, supplier_id, bill_date desc);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  supplier_id uuid not null,
  bill_id uuid,
  paid_on date not null,
  amount bigint not null check (amount > 0),
  method public.payment_method not null,
  reference text check (char_length(reference) <= 120),
  -- Always entered by staff; never a verified bank transaction.
  verification public.payment_verification not null default 'recorded_manually',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 500),
  unique (business_id, id),
  foreign key (business_id, supplier_id) references public.suppliers (business_id, id),
  foreign key (business_id, bill_id) references public.supplier_bills (business_id, id),
  check ((voided_at is null) = (void_reason is null))
);
create index supplier_payments_supplier_idx on public.supplier_payments (business_id, supplier_id, paid_on desc);

-- Billed, paid and outstanding per supplier (RLS of the caller applies: owners only).
create view public.supplier_balances
with (security_invoker = true)
as
select s.business_id, s.id as supplier_id,
  coalesce((select sum(b.amount) from public.supplier_bills b where b.supplier_id = s.id and b.voided_at is null), 0)::bigint as billed,
  coalesce((select sum(p.amount) from public.supplier_payments p where p.supplier_id = s.id and p.voided_at is null), 0)::bigint as paid,
  (coalesce((select sum(b.amount) from public.supplier_bills b where b.supplier_id = s.id and b.voided_at is null), 0)
   - coalesce((select sum(p.amount) from public.supplier_payments p where p.supplier_id = s.id and p.voided_at is null), 0))::bigint as balance
from public.suppliers s
where app.is_owner(s.business_id);

create trigger touch_purchase_orders before update on public.purchase_orders for each row execute function app.touch_updated_at();

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------
-- Quantities in messages: up to 4 decimals, no trailing zeros ("26", "14.8").
create or replace function app.fmt_qty(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$ select trim_scale(round(p, 4))::text $$;

-- Base units of an item per one `p_unit` (a unit code or the item's purchase unit).
create or replace function app.item_unit_factor(p_item public.stock_items, p_unit text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_unit is null or btrim(p_unit) = '' then
    raise exception 'Choose a unit for %.', p_item.name using errcode = 'P0001';
  end if;
  if p_item.purchase_unit is not null and lower(btrim(p_unit)) = lower(p_item.purchase_unit) then
    return p_item.purchase_factor;
  end if;
  return app.convert_qty(1, lower(btrim(p_unit)), p_item.base_unit);
end;
$$;

-- Recomputes a PO's status from what has been received.
create or replace function app.refresh_po_status(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_any boolean;
  v_all boolean;
begin
  select status into v_status from public.purchase_orders where id = p_po_id;
  if v_status not in ('ordered', 'part_received', 'received') then
    return;
  end if;
  select bool_or(qty_received_base > 0), bool_and(qty_received_base >= qty_base)
    into v_any, v_all from public.purchase_order_lines where po_id = p_po_id;
  update public.purchase_orders
    set status = case when v_all then 'received' when v_any then 'part_received' else 'ordered' end
    where id = p_po_id;
end;
$$;
revoke all on function app.refresh_po_status from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Purchase order RPCs
-------------------------------------------------------------------------------
-- Creates or replaces a draft (purchase request). Prices are kept as they were when the caller
-- can't see costs (so a production manager can edit quantities without wiping an owner's prices).
-- p_lines: [{ "item": uuid, "qty": numeric, "unit": text, "unit_price": numeric|null (kobo per unit) }]
create or replace function public.save_purchase_order(
  p_business_id uuid, p_po_id uuid, p_supplier_id uuid, p_expected_date date, p_notes text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
  v_id uuid;
  v_n integer;
  v_line jsonb;
  v_item public.stock_items;
  v_factor numeric;
  v_qty numeric;
  v_price numeric;
  v_costs boolean := app.can_view_costs(p_business_id);
  v_old jsonb := '{}'::jsonb;
  v_i integer := 0;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can raise purchase orders.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id and business_id = p_business_id and archived_at is null) then
    raise exception 'Choose a supplier.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'A purchase order can have at most 200 lines.' using errcode = 'P0001';
  end if;

  if p_po_id is null then
    update public.businesses set next_po_number = next_po_number + 1
      where id = p_business_id returning next_po_number - 1 into v_n;
    insert into public.purchase_orders (business_id, number, supplier_id, expected_date, notes, created_by)
    values (p_business_id, 'PO-' || lpad(v_n::text, 5, '0'), p_supplier_id, p_expected_date,
            nullif(btrim(p_notes), ''), (select auth.uid()))
    returning id into v_id;
  else
    select * into v_po from public.purchase_orders where id = p_po_id and business_id = p_business_id for update;
    if v_po.id is null then
      raise exception 'Unknown purchase order.' using errcode = 'P0001';
    end if;
    if v_po.status <> 'draft' then
      raise exception 'Only a draft can be edited. This order is already %.', v_po.status using errcode = 'P0001';
    end if;
    v_id := v_po.id;
    -- Remember existing prices by item + unit.
    select coalesce(jsonb_object_agg(stock_item_id::text || '|' || lower(unit), unit_price), '{}'::jsonb)
      into v_old from public.purchase_order_lines where po_id = v_id and unit_price is not null;
    delete from public.purchase_order_lines where po_id = v_id;
    update public.purchase_orders
      set supplier_id = p_supplier_id, expected_date = p_expected_date, notes = nullif(btrim(p_notes), '')
      where id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    select * into v_item from public.stock_items
      where id = (v_line ->> 'item')::uuid and business_id = p_business_id;
    if v_item.id is null then
      raise exception 'Line %: that item does not belong to this business.', v_i using errcode = 'P0001';
    end if;
    if v_item.kind = 'finished_good' then
      raise exception 'Line %: finished goods are made, not bought here. Choose a material or packaging item.', v_i using errcode = 'P0001';
    end if;
    if v_item.archived_at is not null then
      raise exception 'Line %: % is archived.', v_i, v_item.name using errcode = 'P0001';
    end if;
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    if v_qty is null or v_qty <= 0 then
      raise exception 'Line %: enter a quantity greater than zero.', v_i using errcode = 'P0001';
    end if;
    v_factor := app.item_unit_factor(v_item, v_line ->> 'unit');
    if round(v_qty * v_factor, 4) <= 0 then
      raise exception 'Line %: that quantity is too small.', v_i using errcode = 'P0001';
    end if;
    if v_costs then
      v_price := (v_line ->> 'unit_price')::numeric;
      if v_price is not null and v_price < 0 then
        raise exception 'Line %: price cannot be negative.', v_i using errcode = 'P0001';
      end if;
    else
      v_price := (v_old ->> (v_item.id::text || '|' || lower(btrim(v_line ->> 'unit'))))::numeric;
    end if;
    insert into public.purchase_order_lines (business_id, po_id, line_no, stock_item_id, qty, unit, factor, qty_base, unit_price)
    values (p_business_id, v_id, v_i, v_item.id, v_qty, lower(btrim(v_line ->> 'unit')), v_factor,
            round(v_qty * v_factor, 4), v_price);
  end loop;
  return v_id;
end;
$$;

-- Owner approval turns a request into an order. Every line must be priced.
create or replace function public.approve_purchase_order(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null or not app.is_owner(v_po.business_id) then
    raise exception 'Only an owner can approve purchase orders.' using errcode = '42501';
  end if;
  if v_po.status = 'ordered' then
    return; -- already approved (double tap)
  end if;
  if v_po.status <> 'draft' then
    raise exception 'This order is already %.', v_po.status using errcode = 'P0001';
  end if;
  if exists (select 1 from public.purchase_order_lines where po_id = p_po_id and unit_price is null) then
    raise exception 'Add a price to every line before approving.' using errcode = 'P0001';
  end if;
  update public.purchase_orders set status = 'ordered', approved_by = (select auth.uid()), approved_at = now()
    where id = p_po_id;
end;
$$;

-- Cancels an order with nothing received, or closes one that's partly received (the rest won't come).
create or replace function public.close_purchase_order(p_po_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po public.purchase_orders;
  v_received boolean;
  v_new text;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then
    raise exception 'Unknown purchase order.' using errcode = 'P0001';
  end if;
  -- The production manager may withdraw their own unapproved request; anything else is the owner's call.
  if not (app.is_owner(v_po.business_id) or (v_po.status = 'draft' and app.is_production(v_po.business_id))) then
    raise exception 'Only an owner can cancel or close an approved order.' using errcode = '42501';
  end if;
  if v_po.status in ('cancelled', 'closed', 'received') then
    raise exception 'This order is already %.', v_po.status using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  select exists (select 1 from public.purchase_order_lines where po_id = p_po_id and qty_received_base > 0) into v_received;
  v_new := case when v_received then 'closed' else 'cancelled' end;
  update public.purchase_orders set status = v_new, closed_reason = btrim(p_reason) where id = p_po_id;
  return v_new;
end;
$$;

-- Prices on a PO, for callers who may see costs.
create or replace function public.purchase_order_prices(p_po_id uuid)
returns table (line_id uuid, unit_price numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.unit_price from public.purchase_order_lines l
  where l.po_id = p_po_id and app.can_view_costs(l.business_id)
$$;

-------------------------------------------------------------------------------
-- Receiving
-------------------------------------------------------------------------------
-- p_lines (against a PO): [{ "po_line": uuid, "accepted": numeric, "rejected": numeric, "reject_reason": text }]
--   Quantities are in the PO line's unit.
-- p_lines (quick purchase, no PO): [{ "item": uuid, "unit": text, "accepted": numeric, "rejected": numeric,
--   "unit_price": numeric (kobo per unit), "reject_reason": text }]
-- p_record_bill: owners only; also records a supplier bill for (accepted value + landed cost).
create or replace function public.receive_goods(
  p_business_id uuid, p_po_id uuid, p_supplier_id uuid, p_location uuid, p_effective_date date,
  p_supplier_ref text, p_landed_cost bigint, p_lines jsonb, p_record_bill boolean, p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.goods_receipts;
  v_po public.purchase_orders;
  v_supplier uuid := p_supplier_id;
  v_receipt uuid;
  v_n integer;
  v_line jsonb;
  v_pol public.purchase_order_lines;
  v_item public.stock_items;
  v_factor numeric;
  v_acc numeric;
  v_rej numeric;
  v_price numeric;
  v_total_value numeric := 0;
  v_doc uuid;
  v_stock_lines jsonb := '[]'::jsonb;
  v_i integer := 0;
  r record;
begin
  if not app.is_production(p_business_id) then
    raise exception 'Only an owner or the production manager can receive goods.' using errcode = '42501';
  end if;
  if p_idempotency_key is null then
    raise exception 'Missing idempotency key.' using errcode = 'P0001';
  end if;
  -- Business row first (the single lock order), then the idempotency check.
  perform 1 from public.businesses where id = p_business_id for update;
  select * into v_existing from public.goods_receipts where business_id = p_business_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.po_id is distinct from p_po_id then
      raise exception 'This request was already used for a different receipt. Refresh the page and try again.' using errcode = 'P0001';
    end if;
    return v_existing.id;
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line.' using errcode = 'P0001';
  end if;
  if coalesce(p_landed_cost, 0) < 0 then
    raise exception 'Freight and other costs cannot be negative.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.locations where id = p_location and business_id = p_business_id and archived_at is null) then
    raise exception 'Choose where the goods are going.' using errcode = 'P0001';
  end if;

  if p_po_id is not null then
    select * into v_po from public.purchase_orders where id = p_po_id and business_id = p_business_id for update;
    if v_po.id is null then
      raise exception 'Unknown purchase order.' using errcode = 'P0001';
    end if;
    if v_po.status not in ('ordered', 'part_received') then
      raise exception 'Only an approved order can be received. This one is %.', v_po.status using errcode = 'P0001';
    end if;
    v_supplier := v_po.supplier_id;
  else
    -- A quick purchase sets its own prices: cost data.
    if not app.can_view_costs(p_business_id) then
      raise exception 'Recording a purchase without an order needs permission to see costs. Ask an owner, or receive against a purchase order.' using errcode = '42501';
    end if;
    if v_supplier is not null and not exists (select 1 from public.suppliers where id = v_supplier and business_id = p_business_id) then
      raise exception 'Unknown supplier.' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(p_landed_cost, 0) > 0 and not app.can_view_costs(p_business_id) then
    raise exception 'Only someone who can see costs can enter freight and other costs.' using errcode = '42501';
  end if;
  if p_record_bill and not app.is_owner(p_business_id) then
    raise exception 'Only an owner can record supplier bills.' using errcode = '42501';
  end if;
  if p_record_bill and v_supplier is null then
    raise exception 'Choose a supplier to record a bill.' using errcode = 'P0001';
  end if;

  update public.businesses set next_receipt_number = next_receipt_number + 1
    where id = p_business_id returning next_receipt_number - 1 into v_n;
  insert into public.goods_receipts (business_id, number, po_id, supplier_id, location_id, effective_date,
    supplier_ref, landed_cost, posted_by, idempotency_key)
  values (p_business_id, 'GR-' || lpad(v_n::text, 5, '0'), p_po_id, v_supplier, p_location, p_effective_date,
    nullif(btrim(p_supplier_ref), ''), coalesce(p_landed_cost, 0), (select auth.uid()), p_idempotency_key)
  returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_i := v_i + 1;
    if p_po_id is not null then
      select * into v_pol from public.purchase_order_lines
        where id = (v_line ->> 'po_line')::uuid and po_id = p_po_id for update;
      if v_pol.id is null then
        raise exception 'Line %: not on this purchase order.', v_i using errcode = 'P0001';
      end if;
      select * into v_item from public.stock_items where id = v_pol.stock_item_id;
      v_factor := v_pol.factor;
      v_price := v_pol.unit_price / v_pol.factor; -- kobo per base unit
    else
      select * into v_item from public.stock_items
        where id = (v_line ->> 'item')::uuid and business_id = p_business_id;
      if v_item.id is null or v_item.kind = 'finished_good' then
        raise exception 'Line %: choose a material or packaging item of this business.', v_i using errcode = 'P0001';
      end if;
      if v_item.archived_at is not null then
        raise exception 'Line %: % is archived.', v_i, v_item.name using errcode = 'P0001';
      end if;
      v_factor := app.item_unit_factor(v_item, v_line ->> 'unit');
      v_price := (v_line ->> 'unit_price')::numeric;
      if v_price is null or v_price < 0 then
        raise exception 'Line %: enter the price paid.', v_i using errcode = 'P0001';
      end if;
      v_price := v_price / v_factor;
    end if;

    v_acc := round(coalesce((v_line ->> 'accepted')::numeric, 0) * v_factor, 4);
    v_rej := round(coalesce((v_line ->> 'rejected')::numeric, 0) * v_factor, 4);
    if v_acc < 0 or v_rej < 0 then
      raise exception 'Line %: quantities cannot be negative.', v_i using errcode = 'P0001';
    end if;
    if v_acc + v_rej = 0 then
      continue; -- nothing arrived for this line
    end if;
    if v_rej > 0 and coalesce(btrim(v_line ->> 'reject_reason'), '') = '' then
      raise exception 'Line %: say why goods were rejected (e.g. damaged, wrong colour).', v_i using errcode = 'P0001';
    end if;
    if p_po_id is not null then
      if v_pol.qty_received_base + v_acc > v_pol.qty_base then
        raise exception 'Line %: that is more % than is still outstanding on the order.', v_i, v_item.name using errcode = 'P0001';
      end if;
      update public.purchase_order_lines
        set qty_received_base = qty_received_base + v_acc, qty_rejected_base = qty_rejected_base + v_rej
        where id = v_pol.id;
    end if;
    insert into public.goods_receipt_lines (business_id, receipt_id, po_line_id, stock_item_id, qty_accepted_base,
      qty_rejected_base, reject_reason, unit_price, unit_cost)
    values (p_business_id, v_receipt, v_pol.id, v_item.id, v_acc, v_rej,
      nullif(btrim(v_line ->> 'reject_reason'), ''), v_price, v_price);
    v_total_value := v_total_value + v_acc * v_price;
    v_pol := null;
  end loop;

  if not exists (select 1 from public.goods_receipt_lines where receipt_id = v_receipt) then
    raise exception 'Enter what arrived on at least one line.' using errcode = 'P0001';
  end if;

  -- Landed cost: shared by accepted value, once.
  if coalesce(p_landed_cost, 0) > 0 then
    if v_total_value <= 0 then
      raise exception 'Freight can only be shared across accepted goods that have a price.' using errcode = 'P0001';
    end if;
    update public.goods_receipt_lines
      set unit_cost = unit_price + (unit_price * p_landed_cost / v_total_value)
      where receipt_id = v_receipt and qty_accepted_base > 0;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('item', stock_item_id, 'location', p_location,
      'qty', qty_accepted_base, 'unit_cost', unit_cost)), '[]'::jsonb)
    into v_stock_lines from public.goods_receipt_lines where receipt_id = v_receipt and qty_accepted_base > 0;

  if jsonb_array_length(v_stock_lines) > 0 then
    v_doc := app.post_stock_document(p_business_id, 'purchase_receipt', p_effective_date, v_stock_lines,
      p_idempotency_key, nullif(btrim(p_supplier_ref), ''), 'goods_receipt', v_receipt);
    update public.goods_receipts set document_id = v_doc where id = v_receipt;
  elsif p_effective_date > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The date cannot be in the future.' using errcode = 'P0001';
  end if;

  if p_po_id is not null then
    perform app.refresh_po_status(p_po_id);
  end if;

  if p_record_bill and (v_total_value + coalesce(p_landed_cost, 0)) > 0 then
    insert into public.supplier_bills (business_id, supplier_id, po_id, receipt_id, bill_ref, bill_date, amount, created_by)
    values (p_business_id, v_supplier, p_po_id, v_receipt, nullif(btrim(p_supplier_ref), ''), p_effective_date,
      round(v_total_value + coalesce(p_landed_cost, 0))::bigint, (select auth.uid()));
  end if;
  return v_receipt;
end;
$$;

-- Owner-only. Reverses the stock (refused if it's since been used) and reopens the PO quantities.
create or replace function public.reverse_goods_receipt(p_receipt_id uuid, p_reason text, p_idempotency_key uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.goods_receipts;
begin
  select * into v_r from public.goods_receipts where id = p_receipt_id;
  if v_r.id is null or not app.is_owner(v_r.business_id) then
    raise exception 'Only an owner can reverse a goods receipt.' using errcode = '42501';
  end if;
  if v_r.status = 'reversed' then
    return;
  end if;
  if exists (select 1 from public.supplier_returns where receipt_id = v_r.id) then
    raise exception 'Some of these goods were already returned to the supplier. Reverse is not possible; record a supplier return for the rest.' using errcode = 'P0001';
  end if;
  if v_r.document_id is not null then
    -- The engine hook below reopens the PO quantities and marks the receipt reversed.
    perform app.reverse_stock_document(v_r.document_id, p_reason, p_idempotency_key);
  else
    perform 1 from public.businesses where id = v_r.business_id for update;
    perform app.undo_goods_receipt(v_r.id, p_reason);
  end if;
end;
$$;

-- Reopens PO quantities and marks the receipt reversed (called from any reversal path).
create or replace function app.undo_goods_receipt(p_receipt_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.goods_receipts;
  l record;
begin
  select * into v_r from public.goods_receipts where id = p_receipt_id for update;
  if v_r.status = 'reversed' then
    return;
  end if;
  for l in select * from public.goods_receipt_lines where receipt_id = p_receipt_id and po_line_id is not null loop
    update public.purchase_order_lines
      set qty_received_base = greatest(qty_received_base - l.qty_accepted_base, 0),
          qty_rejected_base = greatest(qty_rejected_base - l.qty_rejected_base, 0)
      where id = l.po_line_id;
  end loop;
  update public.goods_receipts set status = 'reversed', reversal_reason = btrim(p_reason) where id = p_receipt_id;
  if v_r.po_id is not null then
    perform app.refresh_po_status(v_r.po_id);
  end if;
end;
$$;
revoke all on function app.undo_goods_receipt from public, anon, authenticated;

-- Goods sent back to the supplier after being accepted. Removed at the cost they came in at.
-- p_lines: [{ "receipt_line": uuid, "qty": numeric (base units) }]
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
  return v_id;
end;
$$;

-- Receipt line prices and costs, for callers who may see costs.
create or replace function public.goods_receipt_costs(p_receipt_id uuid)
returns table (line_id uuid, unit_price numeric, unit_cost numeric, landed_cost bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.unit_price, l.unit_cost, r.landed_cost
  from public.goods_receipt_lines l
  join public.goods_receipts r on r.id = l.receipt_id
  where l.receipt_id = p_receipt_id and app.can_view_costs(l.business_id)
$$;

-------------------------------------------------------------------------------
-- Supplier bills and payments (owners)
-------------------------------------------------------------------------------
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
  insert into public.supplier_bills (business_id, supplier_id, po_id, receipt_id, bill_ref, bill_date, amount, notes, created_by)
  values (p_business_id, p_supplier_id, p_po_id, p_receipt_id, nullif(btrim(p_bill_ref), ''), p_bill_date, p_amount,
    nullif(btrim(p_notes), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Money only. Never changes stock.
create or replace function public.record_supplier_payment(
  p_business_id uuid, p_supplier_id uuid, p_bill_id uuid, p_paid_on date, p_amount bigint,
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
    raise exception 'Only an owner can record supplier payments.' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount paid.' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  if p_bill_id is not null and not exists (
    select 1 from public.supplier_bills where id = p_bill_id and supplier_id = p_supplier_id and business_id = p_business_id and voided_at is null
  ) then
    raise exception 'That bill is not open for this supplier.' using errcode = 'P0001';
  end if;
  insert into public.supplier_payments (business_id, supplier_id, bill_id, paid_on, amount, method, reference, created_by)
  values (p_business_id, p_supplier_id, p_bill_id, p_paid_on, p_amount, p_method, nullif(btrim(p_reference), ''), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.void_supplier_record(p_kind text, p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bid uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason.' using errcode = 'P0001';
  end if;
  if p_kind = 'bill' then
    select business_id into v_bid from public.supplier_bills where id = p_id;
  elsif p_kind = 'payment' then
    select business_id into v_bid from public.supplier_payments where id = p_id;
  else
    raise exception 'Unknown record.' using errcode = 'P0001';
  end if;
  if v_bid is null or not app.is_owner(v_bid) then
    raise exception 'Only an owner can void supplier records.' using errcode = '42501';
  end if;
  if p_kind = 'bill' then
    update public.supplier_bills set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
  else
    update public.supplier_payments set voided_at = now(), void_reason = btrim(p_reason) where id = p_id and voided_at is null;
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- Keep receipts in step when reversed from the Movements page
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
revoke all on function public.save_purchase_order, public.approve_purchase_order, public.close_purchase_order,
  public.purchase_order_prices, public.receive_goods, public.reverse_goods_receipt, public.return_to_supplier,
  public.goods_receipt_costs, public.record_supplier_bill, public.record_supplier_payment,
  public.void_supplier_record from public, anon;
grant execute on function public.save_purchase_order, public.approve_purchase_order, public.close_purchase_order,
  public.purchase_order_prices, public.receive_goods, public.reverse_goods_receipt, public.return_to_supplier,
  public.goods_receipt_costs, public.record_supplier_bill, public.record_supplier_payment,
  public.void_supplier_record to authenticated;
comment on function public.save_purchase_order is 'Intentional SECURITY DEFINER: production check; prices only from callers who may see costs.';
comment on function public.receive_goods is 'Intentional SECURITY DEFINER: production check, then the posting engine; quick purchases and freight need cost permission.';
comment on function public.purchase_order_prices is 'Intentional SECURITY DEFINER: returns rows only when the caller may see costs.';
comment on function public.goods_receipt_costs is 'Intentional SECURITY DEFINER: returns rows only when the caller may see costs.';
comment on function public.record_supplier_payment is 'Intentional SECURITY DEFINER: owner-only; never touches stock.';

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.supplier_returns enable row level security;
alter table public.supplier_return_lines enable row level security;
alter table public.supplier_bills enable row level security;
alter table public.supplier_payments enable row level security;

revoke all on public.purchase_orders, public.purchase_order_lines, public.goods_receipts, public.goods_receipt_lines,
  public.supplier_returns, public.supplier_return_lines, public.supplier_bills, public.supplier_payments,
  public.supplier_balances from anon;
-- Everything is written through the RPCs above.
revoke insert, update, delete on public.purchase_orders, public.purchase_order_lines, public.goods_receipts,
  public.goods_receipt_lines, public.supplier_returns, public.supplier_return_lines, public.supplier_bills,
  public.supplier_payments from authenticated;

create policy "production reads purchase orders" on public.purchase_orders
  for select to authenticated using (app.is_production(business_id));
create policy "production reads purchase order lines" on public.purchase_order_lines
  for select to authenticated using (app.is_production(business_id));
create policy "production reads goods receipts" on public.goods_receipts
  for select to authenticated using (app.is_production(business_id));
create policy "production reads goods receipt lines" on public.goods_receipt_lines
  for select to authenticated using (app.is_production(business_id));
create policy "production reads supplier returns" on public.supplier_returns
  for select to authenticated using (app.is_production(business_id));
create policy "production reads supplier return lines" on public.supplier_return_lines
  for select to authenticated using (app.is_production(business_id));
create policy "owners read supplier bills" on public.supplier_bills
  for select to authenticated using (app.is_owner(business_id));
create policy "owners read supplier payments" on public.supplier_payments
  for select to authenticated using (app.is_owner(business_id));

-- Prices and landed costs are never selectable directly.
revoke select on public.purchase_order_lines, public.goods_receipts, public.goods_receipt_lines from authenticated;
grant select (id, business_id, po_id, line_no, stock_item_id, qty, unit, factor, qty_base, qty_received_base, qty_rejected_base)
  on public.purchase_order_lines to authenticated;
grant select (id, business_id, number, po_id, supplier_id, location_id, effective_date, supplier_ref, notes, status,
  document_id, posted_by, created_at, reversal_reason)
  on public.goods_receipts to authenticated;
grant select (id, business_id, receipt_id, po_line_id, stock_item_id, qty_accepted_base, qty_rejected_base, reject_reason,
  qty_returned_base)
  on public.goods_receipt_lines to authenticated;

create trigger audit_purchase_orders after insert or update on public.purchase_orders
  for each row execute function app.write_audit();
create trigger audit_goods_receipts after insert or update on public.goods_receipts
  for each row execute function app.write_audit();
create trigger audit_supplier_bills after insert or update on public.supplier_bills
  for each row execute function app.write_audit();
create trigger audit_supplier_payments after insert or update on public.supplier_payments
  for each row execute function app.write_audit();
