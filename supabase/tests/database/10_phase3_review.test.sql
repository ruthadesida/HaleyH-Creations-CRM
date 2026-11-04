-- Regression tests for the Phase 3 review findings (migration 0015).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(7);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Kaftan');
insert into public.product_variants (business_id, product_id, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'KAF' from public.products where name = 'Kaftan';
insert into t select 'variant', id from public.product_variants where sku = 'KAF';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'KAF', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 4, 'unit', 'pc', 'unit_cost', ''))), gen_random_uuid());

-- An order whose only line is a custom made-to-order item stays "confirmed" (nothing is being made here).
insert into t select 'custom', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  '[{"description":"Custom agbada","quantity":1,"unit_price_minor":5000000,"item_type":"made_to_order"}]'::jsonb, gen_random_uuid());
select public.confirm_order((select id from t where k = 'custom'));
select results_eq($$ select fulfilment_stage::text from public.orders where id = (select id from t where k = 'custom') $$,
  array['confirmed'], 'A custom made-to-order order is not called ready to dispatch');

-- An order with no items cannot be confirmed (and so can never look dispatched).
insert into t select 'empty', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  '[{"description":"Temp","quantity":1,"unit_price_minor":100}]'::jsonb, gen_random_uuid());
reset role;
delete from public.order_items where order_id = (select id from t where k = 'empty');
select tests.login('a0000000-0000-0000-0000-000000000001');
select throws_like($$ select public.confirm_order((select id from t where k = 'empty')) $$, 'Add at least one item%',
  'An empty order cannot be confirmed');

-- Discounts are shared into fulfilled sales; goods with no recorded cost are flagged on return.
insert into t select 'disc', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Kaftan', 'variant_id', (select id from t where k = 'variant'),
    'quantity', 2, 'unit_price_minor', 1000000, 'item_type', 'ready_made')), gen_random_uuid(), p_discount_minor => 500000);
select public.confirm_order((select id from t where k = 'disc'));
insert into public.payments (business_id, order_id, amount_minor, method) values ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'disc'), 1500000, 'cash');
select public.dispatch_order((select id from t where k = 'disc'), tests.loc('Finished goods / showroom'), current_date, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 2)) from public.order_items where order_id = (select id from t where k = 'disc')), gen_random_uuid());
select results_eq($$ select fulfilled_value, cost_complete from public.order_profit((select id from t where k = 'disc')) $$,
  $$ values (1500000::bigint, false) $$, 'Fulfilled sales are after the discount; missing costs make it incomplete');
select throws_like($$ select public.dispatch_order((select id from t where k = 'disc'), tests.loc('Finished goods / showroom'), current_date, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = (select id from t where k = 'disc')), gen_random_uuid()) $$,
  'Everything on this order has already gone out%', 'An order that is fully out cannot be dispatched again');
select throws_like($$ select public.receive_customer_return((select id from t where k = 'disc'), 'return', 'Too big', current_date - 3,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = (select id from t where k = 'disc')), gen_random_uuid()) $$,
  'A return cannot be dated before%', 'A return cannot be dated before the goods went out');
select public.receive_customer_return((select id from t where k = 'disc'), 'return', 'Too big', current_date,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = (select id from t where k = 'disc')), gen_random_uuid());
select results_eq($$ select cost_missing from public.stock_items where code = 'KAF' $$, array[true],
  'Goods that came back with no recorded cost stay flagged as cost missing');

-- The derived-stage bypass can't be borrowed by a signed-in user.
select set_config('app.stage_refresh', 'on', true);
select throws_ok($$ update public.orders set fulfilment_stage = 'confirmed' where id = (select id from t where k = 'disc') $$,
  '42501', null, 'Staff cannot move a stage directly, whatever session settings they try');
reset role;

select * from finish();
rollback;
