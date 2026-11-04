-- Phase 3: quotations, confirmation, reservations, linked production, dispatch, cancellation,
-- customer returns and gross profit. Spec 2 tests G, H, I, J, K, M (single session) and N.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(43);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
create or replace function tests.item(p_code text) returns uuid language sql stable security definer as $$
  select id from public.stock_items where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and code = p_code
$$;
create or replace function tests.on_hand(p_code text, p_loc text default null) returns numeric language sql stable security definer as $$
  select coalesce(sum(quantity), 0) from public.stock_movements
  where stock_item_id = tests.item(p_code) and (p_loc is null or location_id = tests.loc(p_loc))
$$;
create or replace function tests.available(p_code text) returns numeric language sql stable security definer as $$
  select available from public.stock_availability where stock_item_id = tests.item(p_code)
$$;
create or replace function tests.reserved_for(p_order uuid) returns numeric language sql stable security definer as $$
  select coalesce(sum(r.qty_base), 0) from public.stock_reservations r join public.order_items i on i.id = r.source_id
  where r.source_type = 'sales_order' and r.status = 'active' and i.order_id = p_order
$$;
create or replace function tests.items(p_order uuid, p_qty integer default null) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('item', id, 'qty', coalesce(p_qty, quantity - dispatched_quantity))) from public.order_items where order_id = p_order
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): a dress with 5 in the showroom at ₦6,000 cost; 10 m of fabric.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name, category) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress', 'clothing');
insert into public.product_variants (business_id, product_id, size, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'M', 'DRESS-M' from public.products where name = 'Wrap dress';
insert into t select 'variant', id from public.product_variants where sku = 'DRESS-M';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'DRESS-M', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 5, 'unit', 'pc', 'unit_cost', '600000'),
  jsonb_build_object('line', 3, 'code', 'FAB', 'name', 'Ankara', 'kind', 'raw_material', 'base_unit', 'm',
    'location_id', tests.loc('Raw material store'), 'quantity', 10, 'unit', 'm', 'unit_cost', '40000'))), gen_random_uuid());
reset role;

---------------------------------------------------------------------------
-- Quotation → confirmed order reserves stock (test G)
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
insert into t select 'o1', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M', 'variant_id', (select id from t where k = 'variant'),
    'quantity', 3, 'unit_price_minor', 1500000, 'item_type', 'ready_made')), gen_random_uuid());
select is(tests.reserved_for((select id from t where k = 'o1')), 0::numeric, 'A quotation reserves nothing');
select throws_like($$ select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o1')), gen_random_uuid()) $$, 'Confirm the order before dispatching%',
  'A quotation cannot be dispatched (it is not a sale)');
select is(public.confirm_order((select id from t where k = 'o1')), 0, 'Confirming needs no production: the dresses are in stock');
select is(tests.reserved_for((select id from t where k = 'o1')), 3::numeric, 'Confirming reserves 3 dresses');
select is(tests.available('DRESS-M'), 2::numeric, 'Available drops to 2');
select is(tests.on_hand('DRESS-M'), 5::numeric, 'Physical stock is unchanged by reserving');
select is(public.confirm_order((select id from t where k = 'o1')), 0, 'Confirming twice does nothing');
select is(tests.reserved_for((select id from t where k = 'o1')), 3::numeric, '... and reserves nothing twice');
select throws_ok($$ update public.order_items set quantity = 5 where order_id = (select id from t where k = 'o1') $$, 'P0001', null,
  'A confirmed order''s items are fixed');

---------------------------------------------------------------------------
-- Deposits and balance (test H)
---------------------------------------------------------------------------
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 2000000, 'bank_transfer');
select results_eq($$ select total_minor, balance_minor, payment_status from public.order_summaries where id = (select id from t where k = 'o1') $$,
  $$ values (4500000::bigint, 2500000::bigint, 'part_paid'::text) $$, 'A deposit leaves the right balance; the sale is counted once');
select throws_like($$ select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o1'), 1), gen_random_uuid()) $$, '%still owed%',
  'Money still owed blocks dispatch');
select throws_ok($$ select public.approve_unpaid_dispatch((select id from t where k = 'o1'), 'Trusted') $$, '42501', null,
  'The front office cannot approve unpaid dispatch');
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 2500000, 'cash');
select results_eq($$ select balance_minor, payment_status from public.order_summaries where id = (select id from t where k = 'o1') $$,
  $$ values (0::bigint, 'paid'::text) $$, 'The balance payment settles it');

---------------------------------------------------------------------------
-- Partial dispatch (tests G and I)
---------------------------------------------------------------------------
insert into t select 'd1', public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  'GIG', 'GIG-1', tests.items((select id from t where k = 'o1'), 2), '00000000-0000-0000-0000-00000000d001');
select is(tests.on_hand('DRESS-M'), 3::numeric, 'Dispatching 2 takes 2 out of stock');
select is(tests.reserved_for((select id from t where k = 'o1')), 1::numeric, '... using up 2 of the order''s reservation');
select is(tests.available('DRESS-M'), 2::numeric, '... so availability for others is unchanged');
select results_eq($$ select dispatched_quantity, fulfilment_stage::text from public.order_items i join public.orders o on o.id = i.order_id
  where o.id = (select id from t where k = 'o1') $$, $$ values (2, 'ready_for_dispatch'::text) $$, 'Partly dispatched: 1 still to go, and it is reserved, so ready');
select is(public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o1'), 2), '00000000-0000-0000-0000-00000000d001'),
  (select id from t where k = 'd1'), 'A retried dispatch returns the same record');
select is(tests.on_hand('DRESS-M'), 3::numeric, '... and takes nothing more');
select throws_like($$ select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o1'), 2), gen_random_uuid()) $$, 'Only 1 of%', 'You cannot dispatch more than remains');
select throws_like($$ select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Quarantine'), current_date,
  null, null, tests.items((select id from t where k = 'o1')), gen_random_uuid()) $$, '%not Quarantine%', 'Nothing is dispatched from Quarantine');
select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o1')), gen_random_uuid());
select is(tests.on_hand('DRESS-M'), 2::numeric, 'Dispatch reduced stock exactly once per dress (5 − 3)');
select results_eq($$ select fulfilment_stage::text from public.orders where id = (select id from t where k = 'o1') $$,
  array['dispatched'], 'Everything out: dispatched');

---------------------------------------------------------------------------
-- Confirming more than is in stock creates one linked job; cancelling releases it (test J)
---------------------------------------------------------------------------
insert into t select 'o2', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M', 'variant_id', (select id from t where k = 'variant'),
    'quantity', 4, 'unit_price_minor', 1500000, 'item_type', 'ready_made')), gen_random_uuid());
select is(public.confirm_order((select id from t where k = 'o2')), 1, '4 ordered, 2 in stock: one job is created for the other 2');
select results_eq($$ select planned_qty, kind from public.production_jobs where order_item_id = (select id from public.order_items where order_id = (select id from t where k = 'o2')) $$,
  $$ values (2.0000::numeric, 'order'::text) $$, 'The job makes exactly the shortfall, linked to the order');
select is(tests.available('DRESS-M'), 0::numeric, 'The 2 in stock are reserved for this order');
select lives_ok($$ select public.cancel_order((select id from t where k = 'o2'), 'Customer changed mind') $$, 'The order is cancelled');
select is(tests.available('DRESS-M'), 2::numeric, 'Cancelling releases the reservation');
select results_eq($$ select status from public.production_jobs where order_item_id = (select id from public.order_items where order_id = (select id from t where k = 'o2')) $$,
  array['cancelled'], 'The unstarted job is cancelled with it');

-- A made-to-order job that has started is kept, for stock.
insert into t select 'o3', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Custom dress', 'variant_id', (select id from t where k = 'variant'),
    'quantity', 1, 'unit_price_minor', 2000000, 'item_type', 'made_to_order')), gen_random_uuid());
select public.confirm_order((select id from t where k = 'o3'));
insert into t select 'job3', id from public.production_jobs where order_item_id = (select id from public.order_items where order_id = (select id from t where k = 'o3'));
reset role;
select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager
select public.set_job_material((select id from t where k = 'job3'), tests.item('FAB'), 2, 'm');
select public.issue_job_materials((select id from t where k = 'job3'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 2)), gen_random_uuid());
select throws_ok($$ select public.cancel_order((select id from t where k = 'o3'), 'x') $$, '42501', null,
  'The production manager cannot cancel customer orders');
reset role;
select tests.login('a0000000-0000-0000-0000-000000000002');
select matches(public.cancel_order((select id from t where k = 'o3'), 'Customer moved abroad'), 'finishing for stock',
  'Cancelling says what happened to work in progress');
select results_eq($$ select kind, status, order_item_id is null from public.production_jobs where id = (select id from t where k = 'job3') $$,
  $$ values ('stock'::text, 'in_progress'::text, true) $$, 'The started job carries on for stock, unlinked from the order');

---------------------------------------------------------------------------
-- Made for an order: passed items are kept for it
---------------------------------------------------------------------------
insert into t select 'o4', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Custom dress', 'variant_id', (select id from t where k = 'variant'),
    'quantity', 1, 'unit_price_minor', 2000000, 'item_type', 'made_to_order')), gen_random_uuid());
select public.confirm_order((select id from t where k = 'o4'));
insert into t select 'job4', id from public.production_jobs where order_item_id = (select id from public.order_items where order_id = (select id from t where k = 'o4'));
reset role;
select tests.login('a0000000-0000-0000-0000-000000000003');
select public.submit_job_for_qc((select id from t where k = 'job4'));
select public.record_qc_inspection((select id from t where k = 'job4'),
  1, 0, 0, '{}', null, null, tests.loc('Finished goods / showroom'), current_date, gen_random_uuid());
select is(tests.reserved_for((select id from t where k = 'o4')), 1::numeric, 'The QC-passed dress is reserved for the customer who ordered it');
reset role;

---------------------------------------------------------------------------
-- Overselling is refused (test M, single session)
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');
-- Showroom: 3 dresses; 1 reserved for o4. A new order for 3 reserves the other 2 and makes 1.
insert into t select 'o5', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M', 'variant_id', (select id from t where k = 'variant'),
    'quantity', 3, 'unit_price_minor', 1500000, 'item_type', 'ready_made')), gen_random_uuid());
select public.confirm_order((select id from t where k = 'o5'));
select is(tests.reserved_for((select id from t where k = 'o5')), 2::numeric, 'Only what is unreserved can be reserved');
select public.approve_unpaid_dispatch((select id from t where k = 'o5'), 'Testing');
select throws_like($$ select public.dispatch_order((select id from t where k = 'o5'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o5')), gen_random_uuid()) $$, 'Not enough unreserved%',
  'Dispatching 3 when 1 of the 3 in the shop is another customer''s is refused');

---------------------------------------------------------------------------
-- Refunds, returns and inspection (test K), profit
---------------------------------------------------------------------------
insert into public.payments (business_id, order_id, kind, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 'refund', 500000, 'bank_transfer');
select is(tests.on_hand('DRESS-M'), 3::numeric, 'A refund without a return does not restock anything');
insert into t select 'r1', public.receive_customer_return((select id from t where k = 'o1'), 'return', 'Too small', current_date,
  jsonb_build_array(jsonb_build_object('item', (select id from public.order_items where order_id = (select id from t where k = 'o1')), 'qty', 1)),
  gen_random_uuid());
select is(tests.on_hand('DRESS-M', 'Quarantine'), 1::numeric, 'A returned dress goes to Quarantine');
select is(tests.available('DRESS-M'), 0::numeric, '... and is not available until inspected');
select throws_like($$ select public.receive_customer_return((select id from t where k = 'o1'), 'return', 'Again', current_date,
  jsonb_build_array(jsonb_build_object('item', (select id from public.order_items where order_id = (select id from t where k = 'o1')), 'qty', 3)),
  gen_random_uuid()) $$, 'Only 2 of%', 'You cannot return more than went out');
select public.decide_return_line((select id from public.order_return_lines where return_id = (select id from t where k = 'r1')),
  'restock', tests.loc('Finished goods / showroom'), gen_random_uuid());
select is(tests.on_hand('DRESS-M', 'Finished goods / showroom'), 4::numeric, 'After inspection it is restocked');
-- 3 sold at ₦15,000 less 1 returned = ₦30,000; cost 3 × ₦6,000 − 1 × ₦6,000 = ₦12,000.
select results_eq($$ select fulfilled_value, round(cogs), round(gross_profit), cost_complete from public.order_profit((select id from t where k = 'o1')) $$,
  $$ values (3000000::bigint, 1200000::numeric, 1800000::numeric, true) $$, 'Estimated gross profit: fulfilled sales less cost of goods');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002');
select is_empty($$ select 1 from public.order_profit((select id from t where k = 'o1')) $$, 'The front office does not see profit');
reset role;
select tests.login('b0000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.confirm_order((select id from t where k = 'o5')) $$, '42501', null, 'Another business cannot touch these orders');
reset role;

select * from finish();
rollback;
