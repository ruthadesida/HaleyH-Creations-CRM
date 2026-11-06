-- Owner requests: product cost prices feed profit when the ledger has no cost; repairs are tracked apart from orders.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(18);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): 2 ready-made dresses loaded with no cost, 1 bag loaded at ₦5,000; a tailor.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name, base_price_minor) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress', 1500000), ('aaaaaaaa-0000-0000-0000-000000000000', 'Ankara bag', 2000000);
insert into public.product_variants (business_id, product_id, size, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'M', 'DRESS-M' from public.products where name = 'Wrap dress';
insert into public.product_variants (business_id, product_id, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'BAG' from public.products where name = 'Ankara bag';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'DRESS-M', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 2, 'unit', 'pc', 'unit_cost', ''),
  jsonb_build_object('line', 3, 'code', 'BAG', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 1, 'unit', 'pc', 'unit_cost', '500000'))),
  gen_random_uuid());
insert into public.makers (business_id, name, trade) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Tunde Adeyemi', 'tailor');

-- 1. Cost prices.
select public.set_product_cost((select id from public.products where name = 'Wrap dress'), null, 600000);
select public.set_product_cost((select id from public.products where name = 'Ankara bag'), null, 900000);
select is((select count(*)::int from public.product_costs), 2, 'The owner sets cost prices on products');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select throws_ok($$ select public.set_product_cost((select id from public.products where name = 'Wrap dress'), null, 1) $$,
  '42501', null, 'The front office cannot set cost prices');
select is_empty($$ select 1 from public.product_costs $$, 'The front office cannot see cost prices');
-- An order for one dress and the bag, paid and sent out.
insert into t select 'order', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(
    jsonb_build_object('description', 'Wrap dress M', 'variant_id', (select id from public.product_variants where sku = 'DRESS-M'), 'quantity', 1, 'unit_price_minor', 1500000),
    jsonb_build_object('description', 'Ankara bag', 'variant_id', (select id from public.product_variants where sku = 'BAG'), 'quantity', 1, 'unit_price_minor', 2000000)),
  gen_random_uuid());
select public.confirm_order((select id from t where k = 'order'));
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'order'), 3500000, 'cash');
select public.dispatch_order((select id from t where k = 'order'), tests.loc('Finished goods / showroom'), current_date, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = (select id from t where k = 'order')), gen_random_uuid());
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager without cost permission
select is_empty($$ select 1 from public.product_costs $$, 'A production manager without cost permission cannot see cost prices');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select results_eq($$ select fulfilled_value, cogs, gross_profit, cost_complete from public.order_profit((select id from t where k = 'order')) $$,
  $$ values (3500000::bigint, 1100000::numeric, 2400000::numeric, true) $$,
  'Profit uses the dress''s cost price (no ledger cost) and the bag''s ledger cost (₦5,000, not its ₦9,000 cost price)');
select results_eq($$ select product, cogs, cost_complete from public.report_sales_by_product('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) order by product $$,
  $$ values ('Ankara bag'::text, 500000::numeric, true), ('Wrap dress · M'::text, 600000::numeric, true) $$,
  'Sales by product uses the same costs');
select public.set_product_cost((select id from public.products where name = 'Wrap dress'),
  (select id from public.product_variants where sku = 'DRESS-M'), 700000);
select results_eq($$ select cogs from public.order_profit((select id from t where k = 'order')) $$,
  array[1200000::numeric], 'A size''s own cost price wins over the product''s');
reset role;

-- 2. Repairs.
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
insert into t select 'repair', public.create_repair('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  'Agbada', 'Torn sleeve, re-stitch the hem', current_date, current_date + 3, 800000, null, null);
select is((select number from public.repairs where id = (select id from t where k = 'repair')), 'RP-00001', 'A repair gets its own numbering (RP-)');
select public.record_repair_payment((select id from t where k = 'repair'), 'payment', 300000, 'cash', current_date, null);
select results_eq($$ select net_paid_minor, balance_minor from public.repair_summaries where id = (select id from t where k = 'repair') $$,
  $$ values (300000::bigint, 500000::bigint) $$, 'A deposit is recorded and the balance worked out');
select throws_ok($$ select public.record_repair_payment((select id from t where k = 'repair'), 'refund', 100000, 'cash', current_date, null) $$,
  '42501', null, 'Only an owner records a refund');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager
select is_empty($$ select 1 from public.repairs $$, 'Production cannot read repair records (customers and money)');
select results_eq($$ select number, item, maker from public.production_repairs('aaaaaaaa-0000-0000-0000-000000000000') $$,
  $$ values ('RP-00001'::text, 'Agbada'::text, null::text) $$, '... but sees the work to do');
select public.assign_repair_maker((select id from t where k = 'repair'), (select id from public.makers where name = 'Tunde Adeyemi'));
select public.set_repair_status((select id from t where k = 'repair'), 'in_repair', null);
select public.set_repair_status((select id from t where k = 'repair'), 'ready', null);
select throws_ok($$ select public.set_repair_status((select id from t where k = 'repair'), 'collected', null) $$,
  '42501', null, 'Production marks it ready but cannot hand it back');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002');
select ok((select count(*) > 0 from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind = 'repair_ready'),
  'The front office is told the repair is ready for collection');
select public.set_repair_status((select id from t where k = 'repair'), 'collected', null);
select throws_like($$ select public.update_repair((select id from t where k = 'repair'), 'Agbada', 'x', null, 0, null, null) $$,
  'This repair is closed%', 'A collected repair can''t be changed');
reset role;

-- A cancelled repair owes nothing: the deposit shows as to refund; a payment can't be voided out from under a refund.
select tests.login('a0000000-0000-0000-0000-000000000002');
insert into t select 'repair2', public.create_repair('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  'Loafers', 'Resole', current_date, null, 800000, null, null);
insert into t select 'deposit', public.record_repair_payment((select id from t where k = 'repair2'), 'payment', 300000, 'cash', current_date, null);
select public.set_repair_status((select id from t where k = 'repair2'), 'cancelled', 'Customer changed their mind');
select results_eq($$ select balance_minor from public.repair_summaries where id = (select id from t where k = 'repair2') $$,
  array[-300000::bigint], 'A cancelled repair owes nothing; the deposit shows as to refund');
reset role;
select tests.login('a0000000-0000-0000-0000-000000000001');
select public.record_repair_payment((select id from t where k = 'repair2'), 'refund', 300000, 'cash', current_date, null);
select throws_like($$ select public.void_repair_payment((select id from t where k = 'deposit'), 'Mistake') $$,
  'Void the refund first%', 'A payment can''t be voided if that would leave more refunded than received');
reset role;
select tests.login('b0000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.create_repair('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  'Bag', 'Strap', current_date, null, 0, null, null) $$, '42501', null, 'Another business cannot add repairs here');
reset role;

select * from finish();
rollback;
