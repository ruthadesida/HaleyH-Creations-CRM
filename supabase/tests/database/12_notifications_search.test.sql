-- Phase 4: notifications and search respect each role.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(8);

-- Setup (owner A): a supplier with an unapproved request, a product, and an overdue job.
select tests.login('a0000000-0000-0000-0000-000000000001');
insert into public.suppliers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Balogun Fabrics');
insert into public.stock_items (business_id, kind, code, name, base_unit) values ('aaaaaaaa-0000-0000-0000-000000000000', 'raw_material', 'FAB', 'Ankara', 'm');
select public.save_purchase_order('aaaaaaaa-0000-0000-0000-000000000000', null,
  (select id from public.suppliers where name = 'Balogun Fabrics'), null, null,
  jsonb_build_array(jsonb_build_object('item', (select id from public.stock_items where code = 'FAB'), 'qty', 5, 'unit', 'm')));
insert into public.products (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Kaftan');
insert into public.product_variants (business_id, product_id, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'KAF' from public.products where name = 'Kaftan';
select public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from public.product_variants where sku = 'KAF'),
  1, null, null, current_date - 2, null, gen_random_uuid());

select ok((select count(*) > 0 from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind = 'po_approve'),
  'Owners are told a purchase request needs approval');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager
select ok((select count(*) > 0 from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind = 'job_overdue'),
  'The production manager is told a job is overdue');
select is_empty($$ select 1 from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind in ('po_approve', 'order_late') $$,
  'The production manager gets no owner or customer-order notifications');
select is_empty($$ select 1 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'Amaka') $$,
  'Search never shows customers to the production manager');
select ok((select count(*) > 0 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'ankara') where kind = 'item'),
  'The production manager can find materials');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select ok((select count(*) > 0 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', '1112222') where kind = 'customer'),
  'The front office finds a customer by phone digits');
select is_empty($$ select 1 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'ankara') where kind = 'item' $$,
  'The front office does not see raw materials in search');
reset role;

select tests.login('b0000000-0000-0000-0000-000000000001');
select is_empty($$ select 1 from public.search_everything('aaaaaaaa-0000-0000-0000-000000000000', 'Amaka') $$,
  'Another business finds nothing here');
reset role;

select * from finish();
rollback;
