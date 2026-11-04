-- Phase 4: CSV imports are previewable, idempotent by external ID, never duplicate people, and role-limited.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(10);

select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
create temp table f (rows jsonb);
grant all on f to authenticated;
insert into f values ('[
  {"line": 2, "external_id": "Z-1", "full_name": "Funmi Bello", "phone": "0802 000 1111", "city": "Lagos"},
  {"line": 3, "external_id": "Z-2", "full_name": "Chidi Eze", "email": "chidi@example.com"},
  {"line": 4, "full_name": "Amaka Again", "phone": "0803 111 2222"},
  {"line": 5, "full_name": "Bad Email", "email": "not-an-email"}
]');
select results_eq($$ select action from public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', (select rows from f), true) order by line $$,
  array['create', 'create', 'skip', 'error'], 'The preview says what would happen line by line');
select is((select count(*)::int from public.customers where external_id in ('Z-1', 'Z-2')), 0, '... and writes nothing');
select public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', (select rows from f), false);
select is((select count(*)::int from public.customers where external_id in ('Z-1', 'Z-2')), 2, 'Importing creates the two new customers');
select is((select count(*)::int from public.customers where phone = '0803 111 2222'), 1,
  'An existing customer (same phone) is not duplicated');
update f set rows = '[{"line": 2, "external_id": "Z-1", "full_name": "Funmilayo Bello", "phone": "0802 000 1111"}]';
select results_eq($$ select action from public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', (select rows from f), false) $$,
  array['update'], 'Importing the same external ID again updates instead of duplicating');
select is((select full_name from public.customers where external_id = 'Z-1'), 'Funmilayo Bello', '... with the new details');
select throws_ok($$ select * from public.import_products('aaaaaaaa-0000-0000-0000-000000000000', '[{"line":2,"product_name":"X"}]', true) $$,
  '42501', null, 'Only owners import products (they carry prices)');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001'); -- owner
select results_eq($$ select action from public.import_products('aaaaaaaa-0000-0000-0000-000000000000', '[
  {"line": 2, "external_id": "W-10", "product_name": "Ankara tote", "category": "bags", "sku": "TOTE-RED", "colour": "Red", "price": "1500000"},
  {"line": 3, "external_id": "W-11", "product_name": "Ankara tote", "category": "bags", "sku": "TOTE-BLU", "colour": "Blue", "price": "1500000"}
]', false) order by line $$, array['create', 'create'], 'Two variants of one new product');
select results_eq($$ select count(distinct p.id)::int, count(*)::int, count(s.id)::int from public.product_variants v
  join public.products p on p.id = v.product_id left join public.stock_items s on s.variant_id = v.id where v.external_id in ('W-10', 'W-11') $$,
  $$ values (1, 2, 2) $$, 'One product, two variants, each with its stock item');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003');
select throws_ok($$ select * from public.import_customers('aaaaaaaa-0000-0000-0000-000000000000', '[{"line":2,"full_name":"X"}]', true) $$,
  '42501', null, 'The production manager cannot import customers');
reset role;

select * from finish();
rollback;
