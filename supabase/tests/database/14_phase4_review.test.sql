-- Phase 4 review fixes: period gross profit, import duplicates, search limited to what each role can open.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(12);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): 2 dresses at ₦6,000 cost; one order for both at ₦15,000 each, paid, sent out on two different days.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress');
insert into public.product_variants (business_id, product_id, size, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'M', 'DRESS-M' from public.products where name = 'Wrap dress';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'DRESS-M', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 2, 'unit', 'pc', 'unit_cost', '600000'))),
  gen_random_uuid());
insert into t select 'order', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M',
    'variant_id', (select id from public.product_variants where sku = 'DRESS-M'), 'quantity', 2, 'unit_price_minor', 1500000)),
  gen_random_uuid());
select public.confirm_order((select id from t where k = 'order'));
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'order'), 3000000, 'bank_transfer');
select public.dispatch_order((select id from t where k = 'order'), tests.loc('Finished goods / showroom'), current_date - 3, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = (select id from t where k = 'order')), gen_random_uuid());
select public.dispatch_order((select id from t where k = 'order'), tests.loc('Finished goods / showroom'), current_date, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = (select id from t where k = 'order')), gen_random_uuid());

select results_eq($$ select fulfilled_sales, cogs, gross_profit from public.report_gross_profit('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) $$,
  $$ values (1500000::numeric, 600000::numeric, 900000::numeric) $$, 'Gross profit for today counts only the dress sent out today');
select results_eq($$ select fulfilled_sales from public.report_gross_profit('aaaaaaaa-0000-0000-0000-000000000000', current_date - 3, current_date - 3) $$,
  array[1500000::numeric], '... and the earlier period counts only the earlier dress');
select results_eq($$ select g.gross_profit from public.report_gross_profit('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) g $$,
  $$ select o.gross_profit from public.owner_overview('aaaaaaaa-0000-0000-0000-000000000000', current_date, current_date) o $$,
  'The owner overview and the gross profit report agree');

-- Product import without SKU or external ID: importing the same file twice updates the variant.
select public.import_products('aaaaaaaa-0000-0000-0000-000000000000', '[{"line": 2, "product_name": "Aso oke cap", "category": "other", "size": "L", "price": "800000"}]', false);
select results_eq($$ select action from public.import_products('aaaaaaaa-0000-0000-0000-000000000000',
  '[{"line": 2, "product_name": "Aso oke cap", "category": "other", "size": "L", "price": "900000"}]', false) $$,
  array['update'], 'Re-importing a product with no SKU updates it');
select is((select count(*)::int from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'Aso oke cap'), 1,
  '... without creating a second variant');
select results_eq($$ select action from public.import_products('aaaaaaaa-0000-0000-0000-000000000000', '[
  {"line": 2, "product_name": "Gele", "category": "other", "colour": "Gold"},
  {"line": 3, "product_name": "gele", "category": "other", "colour": "gold"}]', true) order by line $$,
  array['create', 'error'], 'The same SKU-less product twice in one file is flagged in the preview');

select ok((select count(*) > 0 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'Amaka') where kind = 'order'),
  'Owners still find orders');
insert into public.products (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Kaftan');
insert into public.product_variants (business_id, product_id, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'KAF' from public.products where name = 'Kaftan';
select public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from public.product_variants where sku = 'KAF'),
  1, null, null, current_date + 7, null, gen_random_uuid());
select ok((select count(*) > 0 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'Kaftan') where kind = 'job'),
  'Owners find production jobs');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select is_empty($$ select 1 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'Kaftan') where kind = 'job' $$,
  'Search does not offer the front office job pages they cannot open');

-- The same person twice in one file is created once, and the preview says so.
create temp table f (rows jsonb);
insert into f values ('[
  {"line": 2, "full_name": "Kemi Ade", "phone": "0809 444 5555"},
  {"line": 3, "full_name": "Kemi Adeyemi", "phone": "+234 809 444 5555"}
]');
select results_eq($$ select action from public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', (select rows from f), true) order by line $$,
  array['create', 'skip'], 'The preview spots the same phone twice in one file');
select public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', (select rows from f), false);
select is((select count(*)::int from public.customers where full_name like 'Kemi Ade%'), 1, '... and the import creates one customer');

-- An archived customer matched by external ID is left as it is.
select public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', '[{"line": 2, "external_id": "Z-9", "full_name": "Old Name"}]', false);
reset role;
update public.customers set archived_at = now() where external_id = 'Z-9';
select tests.login('a0000000-0000-0000-0000-000000000002');
select public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', '[{"line": 2, "external_id": "Z-9", "full_name": "New Name"}]', false);
reset role;
select is((select full_name from public.customers where external_id = 'Z-9'), 'Old Name', 'An archived customer is not changed by an import');

select * from finish();
rollback;
