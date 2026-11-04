-- Regression tests for the Phase 2 review findings (migration 0013).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(12);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
create or replace function tests.item(p_code text) returns uuid language sql stable security definer as $$
  select id from public.stock_items where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and code = p_code
$$;
create or replace function tests.on_hand(p_code text) returns numeric language sql stable security definer as $$
  select coalesce(sum(quantity), 0) from public.stock_movements where stock_item_id = tests.item(p_code)
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): 10 m of fabric, a product with a variant, a supplier.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'FAB', 'name', 'Ankara', 'kind', 'raw_material', 'base_unit', 'm',
    'location_id', tests.loc('Raw material store'), 'quantity', 10, 'unit', 'm', 'unit_cost', '40000'))), gen_random_uuid());
insert into public.products (business_id, name, category) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Tote', 'bags');
insert into public.product_variants (business_id, product_id, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'TOTE' from public.products where name = 'Tote';
insert into t select 'variant', id from public.product_variants where sku = 'TOTE';
insert into public.suppliers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Supplier One'), ('aaaaaaaa-0000-0000-0000-000000000000', 'Supplier Two');
insert into t select 'sup1', id from public.suppliers where name = 'Supplier One';
insert into t select 'sup2', id from public.suppliers where name = 'Supplier Two';
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager
-- Job A reserves 4 m, job B reserves 6 m: all 10 m are reserved.
insert into t select 'jobA', public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'), 1, null, null, null, null, gen_random_uuid());
insert into t select 'jobB', public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'), 1, null, null, null, null, gen_random_uuid());
select public.set_job_material((select id from t where k = 'jobA'), tests.item('FAB'), 4, 'm');
select public.set_job_material((select id from t where k = 'jobB'), tests.item('FAB'), 6, 'm');
select public.allocate_job_materials((select id from t where k = 'jobA'));
select public.allocate_job_materials((select id from t where k = 'jobB'));

select throws_like($$ select public.issue_job_materials((select id from t where k = 'jobA'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 6)), gen_random_uuid()) $$,
  'Not enough unreserved Ankara%', 'A job cannot issue beyond its reservation into stock reserved for another job');
select lives_ok($$ select public.request_adjustment('aaaaaaaa-0000-0000-0000-000000000000', 'write_off', tests.loc('Raw material store'),
  'Damaged', current_date, jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 1)), gen_random_uuid()) $$,
  'Write-offs are requested as normal (checked on approval)');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select throws_like($$ select public.decide_adjustment((select id from public.adjustment_requests order by created_at desc limit 1), true, null, gen_random_uuid()) $$,
  'Not enough unreserved Ankara%', 'An owner cannot approve a write-off that eats into reserved stock');
select throws_like($$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('FAB'), tests.loc('Raw material store'),
  tests.loc('Quarantine'), 1, current_date, null, gen_random_uuid()) $$,
  'Not enough unreserved Ankara%', 'Reserved stock cannot be moved into Quarantine');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.issue_job_materials((select id from t where k = 'jobA'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 4)), gen_random_uuid()) $$, 'Issuing within the reservation works');
-- Job A completes with materials only.
select public.submit_job_for_qc((select id from t where k = 'jobA'));
select public.record_qc_inspection((select id from t where k = 'jobA'), 1, 0, 0, '{}', null, null, tests.loc('Finished goods / showroom'), current_date, gen_random_uuid());
select throws_like($$ select public.return_job_materials((select id from t where k = 'jobA'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 1)), gen_random_uuid()) $$,
  'This job is completed%', 'Materials cannot be returned to a completed job');
select throws_like($$ select public.issue_job_materials((select id from t where k = 'jobB'), tests.loc('Quarantine'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 1)), gen_random_uuid()) $$,
  'Stock in Quarantine%', 'Quarantine stock cannot be issued to a job');
-- A job with no recorded cost at all is flagged rather than valued at ₦0.
insert into t select 'free', public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'), 1, null, null, null, null, gen_random_uuid());
select public.submit_job_for_qc((select id from t where k = 'free'));
select public.record_qc_inspection((select id from t where k = 'free'), 1, 0, 0, '{}', null, null, tests.loc('Finished goods / showroom'), current_date, gen_random_uuid());
select results_eq($$ select cost_missing from public.stock_items where code = 'TOTE' $$, array[true],
  'Completing with no recorded cost flags the item as cost missing');
reset role;

-- Maker pay stays owner-only even when the production manager may see costs.
update public.memberships set can_view_costs = true where user_id = 'a0000000-0000-0000-0000-000000000003';
select tests.login('a0000000-0000-0000-0000-000000000003');
select results_eq($$ select material_value > 0, fee_approved is null, paid is null from public.job_costs((select id from t where k = 'jobA')) $$,
  $$ values (true, true, true) $$, 'A production manager with cost permission sees job costs but not maker pay');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
-- Supplier bills only link that supplier's orders.
insert into t select 'po', public.save_purchase_order('aaaaaaaa-0000-0000-0000-000000000000', null, (select id from t where k = 'sup1'), null, null,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 5, 'unit', 'm', 'unit_price', 40000)));
select throws_like($$ select public.record_supplier_bill('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'sup2'),
  (select id from t where k = 'po'), null, 'X', current_date, 1000, null) $$,
  'That order is from a different supplier.', 'A bill cannot link another supplier''s order');
-- A supplier return reopens the quantity on the order.
select public.approve_purchase_order((select id from t where k = 'po'));
insert into t select 'gr', public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, null, 0,
  jsonb_build_array(jsonb_build_object('po_line', (select id from public.purchase_order_lines where po_id = (select id from t where k = 'po')), 'accepted', 5)),
  false, gen_random_uuid());
select public.return_to_supplier((select id from t where k = 'gr'), current_date, 'Wrong shade',
  jsonb_build_array(jsonb_build_object('receipt_line', (select id from public.goods_receipt_lines where receipt_id = (select id from t where k = 'gr')), 'qty', 2)),
  gen_random_uuid());
select results_eq($$ select status from public.purchase_orders where id = (select id from t where k = 'po') $$, array['part_received'],
  'Returning 2 m reopens them on the order (replacement expected)');
select is(public.receive_goods('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'po'), null,
  tests.loc('Raw material store'), current_date, null, 0,
  jsonb_build_array(jsonb_build_object('po_line', (select id from public.purchase_order_lines where po_id = (select id from t where k = 'po')), 'accepted', 2)),
  false, gen_random_uuid()) is not null, true, 'The replacement can be received against the same order');
reset role;

select * from finish();
rollback;
