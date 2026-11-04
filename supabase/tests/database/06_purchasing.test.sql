-- Phase 2a: purchasing. Spec 2 test B (a receipt increases stock; a payment doesn't),
-- partial and rejected receipts, landed cost, supplier returns, reversals, and who can see prices.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(35);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
create or replace function tests.item(p_code text) returns uuid language sql stable security definer as $$
  select id from public.stock_items where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and code = p_code
$$;
create or replace function tests.on_hand(p_code text) returns numeric language sql stable security definer as $$
  select coalesce(sum(quantity), 0) from public.stock_movements where stock_item_id = tests.item(p_code)
$$;
create or replace function tests.avg_cost(p_code text) returns numeric language sql stable security definer as $$
  select round(avg_cost, 2) from public.stock_items where id = tests.item(p_code)
$$;
create or replace function tests.po_status(p_id uuid) returns text language sql stable security definer as $$
  select status from public.purchase_orders where id = p_id
$$;
create or replace function tests.first_line(p_po uuid) returns uuid language sql stable security definer as $$
  select id from public.purchase_order_lines where po_id = p_po order by line_no limit 1
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup as owner A: a supplier, fabric bought by the 50 m roll, and zips by the piece.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.suppliers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Balogun Fabrics');
insert into t select 'sup', id from public.suppliers where name = 'Balogun Fabrics';
insert into public.stock_items (business_id, kind, code, name, base_unit, purchase_unit, purchase_factor)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'raw_material', 'FAB', 'Ankara', 'm', 'roll', 50);
insert into public.stock_items (business_id, kind, code, name, base_unit)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'raw_material', 'ZIP', 'Zip', 'pc');
reset role;

---------------------------------------------------------------------------
-- Purchase requests and approval
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager, no cost permission
insert into t select 'po', public.save_purchase_order('aaaaaaaa-0000-0000-0000-000000000000', null, (select id from t where k = 'sup'),
  current_date + 7, 'For the Eid collection',
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 2, 'unit', 'roll', 'unit_price', 999)));
select is(tests.po_status((select id from t where k = 'po')), 'draft', 'The production manager can raise a purchase request');
select is_empty($$ select 1 from public.purchase_order_prices((select id from t where k = 'po')) $$,
  'They see no prices');
select throws_ok($$ select unit_price from public.purchase_order_lines $$, '42501', null,
  'Purchase prices cannot be selected directly');
select throws_ok($$ select public.approve_purchase_order((select id from t where k = 'po')) $$, '42501', null,
  'Only an owner can approve a purchase order');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select results_eq($$ select unit_price from public.purchase_order_prices((select id from t where k = 'po')) $$,
  array[null::numeric], 'A price typed by someone who cannot see costs is not stored');
select throws_ok($$ select public.approve_purchase_order((select id from t where k = 'po')) $$, 'P0001', null,
  'An unpriced order cannot be approved');
-- ₦20,000 a roll.
select public.save_purchase_order('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), (select id from t where k = 'sup'),
  current_date + 7, 'For the Eid collection',
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 2, 'unit', 'roll', 'unit_price', 2000000)));
select lives_ok($$ select public.approve_purchase_order((select id from t where k = 'po')) $$, 'The owner prices and approves it');
select is(tests.po_status((select id from t where k = 'po')), 'ordered', 'Approved: ordered');
select is(tests.on_hand('FAB'), 0::numeric, 'An approved purchase order does not change stock');
select throws_ok($$ select public.save_purchase_order('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'),
  (select id from t where k = 'sup'), null, null, jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 9, 'unit', 'roll')))) $$,
  'P0001', null, 'An approved order can no longer be edited');
reset role;

---------------------------------------------------------------------------
-- Receiving against the order (partial, rejected, retries)
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, 'INV-1', 0,
  jsonb_build_array(jsonb_build_object('po_line', tests.first_line((select id from t where k = 'po')), 'accepted', 1, 'rejected', 0.5)),
  false, gen_random_uuid()) $$, 'P0001', null, 'Rejected goods need a reason');
insert into t select 'gr1', public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, 'INV-1', 0,
  jsonb_build_array(jsonb_build_object('po_line', tests.first_line((select id from t where k = 'po')), 'accepted', 1, 'rejected', 0.5,
    'reject_reason', 'Water damaged')),
  false, '00000000-0000-0000-0000-0000000000e1');
select is(tests.on_hand('FAB'), 50.0000::numeric, 'Receiving 1 roll adds 50 m; the rejected half roll is not stocked');
select is(tests.po_status((select id from t where k = 'po')), 'part_received', 'The order is part received');
select is(public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, 'INV-1', 0,
  jsonb_build_array(jsonb_build_object('po_line', tests.first_line((select id from t where k = 'po')), 'accepted', 1)),
  false, '00000000-0000-0000-0000-0000000000e1'), (select id from t where k = 'gr1'), 'A retry returns the same receipt');
select is(tests.on_hand('FAB'), 50.0000::numeric, '... and adds nothing');
select throws_ok($$ select public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, null, 0,
  jsonb_build_array(jsonb_build_object('po_line', tests.first_line((select id from t where k = 'po')), 'accepted', 1.5)),
  false, gen_random_uuid()) $$, 'P0001', null, 'Receiving more than is outstanding is refused');
select throws_ok($$ select public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, null, 5000,
  jsonb_build_array(jsonb_build_object('po_line', tests.first_line((select id from t where k = 'po')), 'accepted', 1)),
  false, gen_random_uuid()) $$, '42501', null, 'Freight needs permission to see costs');
select throws_ok($$ select public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', null, (select id from t where k = 'sup'),
  tests.loc('Raw material store'), current_date, null, 0,
  jsonb_build_array(jsonb_build_object('item', tests.item('ZIP'), 'unit', 'pc', 'accepted', 10, 'unit_price', 100)),
  false, gen_random_uuid()) $$, '42501', null, 'A quick purchase (which sets prices) needs permission to see costs');
select is_empty($$ select 1 from public.supplier_bills $$, 'The production manager cannot see supplier bills');
select throws_ok($$ select public.record_supplier_payment('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'sup'),
  null, current_date, 100, 'cash', null) $$, '42501', null, 'The production manager cannot record supplier payments');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select is(tests.avg_cost('FAB'), 40000.00::numeric, 'Fabric costs ₦400 a metre (₦20,000 a roll ÷ 50 m)');
reset role;

---------------------------------------------------------------------------
-- Quick purchase with freight, a bill and a payment (Spec test B)
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');
-- 100 zips at ₦100 each, plus ₦500 delivery shared across them: ₦105 each.
insert into t select 'gr2', public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', null, (select id from t where k = 'sup'),
  tests.loc('Raw material store'), current_date, 'CASH-77', 50000,
  jsonb_build_array(jsonb_build_object('item', tests.item('ZIP'), 'unit', 'pc', 'accepted', 100, 'unit_price', 10000)),
  true, gen_random_uuid());
select is(tests.on_hand('ZIP'), 100.0000::numeric, 'The quick purchase adds 100 zips');
select is(tests.avg_cost('ZIP'), 10500.00::numeric, 'Delivery is shared into the cost: ₦105 a zip');
select results_eq($$ select amount from public.supplier_bills where receipt_id = (select id from t where k = 'gr2') $$,
  array[1050000::bigint], 'The bill records ₦10,500 (goods + delivery)');
select public.record_supplier_payment('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'sup'),
  null, current_date, 600000, 'bank_transfer', 'TRF-1');
select is(tests.on_hand('ZIP'), 100.0000::numeric, 'Paying the supplier does not increase stock again');
select results_eq($$ select billed, paid, balance from public.supplier_balances where supplier_id = (select id from t where k = 'sup') $$,
  $$ values (1050000::bigint, 600000::bigint, 450000::bigint) $$, 'Supplier balance: billed − paid');
reset role;

---------------------------------------------------------------------------
-- Supplier return and reversals
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
insert into t select 'sr', public.return_to_supplier((select id from t where k = 'gr2'), current_date, 'Wrong colour',
  jsonb_build_array(jsonb_build_object('receipt_line', (select id from public.goods_receipt_lines where receipt_id = (select id from t where k = 'gr2')), 'qty', 20)),
  gen_random_uuid());
select is(tests.on_hand('ZIP'), 80.0000::numeric, 'Returning 20 zips to the supplier removes them');
select throws_ok($$ select public.return_to_supplier((select id from t where k = 'gr2'), current_date, 'More',
  jsonb_build_array(jsonb_build_object('receipt_line', (select id from public.goods_receipt_lines where receipt_id = (select id from t where k = 'gr2')), 'qty', 81)),
  gen_random_uuid()) $$, 'P0001', null, 'You cannot return more than was accepted');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select is(tests.avg_cost('ZIP'), 10500.00::numeric, 'A supplier return leaves the average of the rest unchanged');
select throws_ok($$ select public.reverse_goods_receipt((select id from t where k = 'gr2'), 'Oops', gen_random_uuid()) $$,
  'P0001', null, 'A receipt with goods already returned cannot be reversed');
-- Reverse the first receipt from the Movements page: the PO quantity reopens.
select public.reverse_stock_document((select document_id from public.goods_receipts where id = (select id from t where k = 'gr1')),
  'Booked against the wrong order', gen_random_uuid());
select is(tests.po_status((select id from t where k = 'po')), 'ordered', 'Reversing the receipt reopens the order');
select is(tests.on_hand('FAB'), 0::numeric, '... and removes the fabric');
reset role;

---------------------------------------------------------------------------
-- Other roles and businesses
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select is_empty($$ select 1 from public.purchase_orders $$, 'The front office cannot read purchase orders');
reset role;
select tests.login('b0000000-0000-0000-0000-000000000001'); -- owner of business B
select is_empty($$ select 1 from public.purchase_orders where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'Another business cannot read these purchase orders');
select throws_ok($$ select public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, null, 0,
  jsonb_build_array(jsonb_build_object('po_line', tests.first_line((select id from t where k = 'po')), 'accepted', 1)),
  false, gen_random_uuid()) $$, '42501', null, 'Another business cannot receive against this order');
reset role;

select * from finish();
rollback;
