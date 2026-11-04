-- Phase 4 reports: figures, and who may see what (Spec 2 §14, test N).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(16);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): 4 dresses at ₦6,000 cost and 10 m fabric; one order for 2 dresses at ₦15,000, paid and dispatched.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress');
insert into public.product_variants (business_id, product_id, size, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'M', 'DRESS-M' from public.products where name = 'Wrap dress';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'DRESS-M', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 4, 'unit', 'pc', 'unit_cost', '600000'),
  jsonb_build_object('line', 3, 'code', 'FAB', 'name', 'Ankara', 'kind', 'raw_material', 'base_unit', 'm',
    'location_id', tests.loc('Raw material store'), 'quantity', 10, 'unit', 'm', 'unit_cost', '40000'))), gen_random_uuid());
insert into t select 'order', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M',
    'variant_id', (select id from public.product_variants where sku = 'DRESS-M'), 'quantity', 2, 'unit_price_minor', 1500000)),
  gen_random_uuid(), p_channel => 'instagram');
select public.confirm_order((select id from t where k = 'order'));
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'order'), 3000000, 'bank_transfer');
select public.dispatch_order((select id from t where k = 'order'), tests.loc('Finished goods / showroom'), current_date, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 2)) from public.order_items where order_id = (select id from t where k = 'order')), gen_random_uuid());

select results_eq($$ select units, sales, cogs, gross_profit, cost_complete from public.report_sales_by_product('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, current_date) $$,
  $$ values (2::numeric, 3000000::numeric, 1200000::numeric, 1800000::numeric, true) $$, 'Owner: 2 dresses sold for ₦30,000, cost ₦12,000, estimated profit ₦18,000');
select results_eq($$ select channel, orders, order_value from public.report_sales_by_channel('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, current_date) $$,
  $$ values ('instagram'::text, 1::bigint, 3000000::numeric) $$, 'Sales by channel counts confirmed orders');
select results_eq($$ select sum(cash_received) from public.report_sales_by_period('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, current_date, 'day') $$,
  array[4000000::numeric], 'Cash received by day adds up (this order''s ₦30,000 + the fixture order''s ₦10,000 deposit)');
select results_eq($$ select value from public.report_valuation('aaaaaaaa-0000-0000-0000-000000000000') where kind = 'finished_good' $$,
  array[1200000::numeric], 'Valuation: 2 dresses left at ₦6,000');
select results_eq($$ select confirmed_value, cash_received, fulfilled_sales, gross_profit from public.owner_overview('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, current_date) $$,
  $$ values (3000000::numeric, 4000000::numeric, 3000000::numeric, 1800000::numeric) $$, 'The owner overview agrees with the reports');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select results_eq($$ select sales, cogs is null, gross_profit is null from public.report_sales_by_product('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, current_date) $$,
  $$ values (3000000::numeric, true, true) $$, 'Front office sees sales but no cost or profit');
select is_empty($$ select 1 from public.report_stock_by_location('aaaaaaaa-0000-0000-0000-000000000000') where kind <> 'finished_good' $$,
  'Front office sees finished goods only');
select throws_ok($$ select * from public.report_valuation('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null, 'Front office cannot value stock');
select throws_ok($$ select * from public.owner_overview('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) $$, '42501', null,
  'Front office cannot open the owner overview');
select throws_ok($$ select * from public.report_wip('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null, 'Front office cannot see production reports');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager, no cost permission
select throws_ok($$ select * from public.report_cash('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) $$, '42501', null,
  'The production manager gets no customer payment reports');
select throws_ok($$ select * from public.report_sales_by_product('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) $$, '42501', null,
  'The production manager gets no sales reports');
select throws_ok($$ select * from public.report_valuation('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null,
  'Without cost permission, no stock valuation');
select results_eq($$ select count(*) filter (where value is not null) from public.report_stock_by_location('aaaaaaaa-0000-0000-0000-000000000000') $$,
  array[0::bigint], 'Stock by location shows no values without cost permission');
select throws_ok($$ select * from public.report_supplier_balances('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null,
  'Supplier money is owners only');
reset role;

select tests.login('b0000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.owner_overview('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) $$, '42501', null,
  'Another business''s owner cannot read these reports');
reset role;

select * from finish();
rollback;
