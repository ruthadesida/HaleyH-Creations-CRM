-- Backlog: reports follow the business's time zone; returns waiting for inspection; exchanges linked to replacements.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(13);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): 2 dresses in stock; an order for both, paid, dispatched, then 1 back as an exchange.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5, timezone = 'Pacific/Kiritimati' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress');
insert into public.product_variants (business_id, product_id, size, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'M', 'DRESS-M' from public.products where name = 'Wrap dress';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'DRESS-M', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 2, 'unit', 'pc', 'unit_cost', '600000'))),
  gen_random_uuid());
insert into t select 'order', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M',
    'variant_id', (select id from public.product_variants where sku = 'DRESS-M'), 'quantity', 2, 'unit_price_minor', 1500000)),
  gen_random_uuid(), p_channel => 'instagram');
select public.confirm_order((select id from t where k = 'order'));

-- 1. Time zone: "today" in the business's own zone (UTC+14 here), not Lagos.
select results_eq($$ select orders from public.report_sales_by_channel('aaaaaaaa-0000-0000-0000-000000000000',
    (now() at time zone 'Pacific/Kiritimati')::date, (now() at time zone 'Pacific/Kiritimati')::date) $$,
  array[1::bigint], 'An order confirmed now counts on today''s date in the business''s own time zone');

insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'order'), 3000000, 'bank_transfer');
select public.dispatch_order((select id from t where k = 'order'), tests.loc('Finished goods / showroom'), current_date - 1, null, null,
  (select jsonb_agg(jsonb_build_object('item', id, 'qty', 2)) from public.order_items where order_id = (select id from t where k = 'order')), gen_random_uuid());
insert into t select 'exchange', public.receive_customer_return((select id from t where k = 'order'), 'exchange', 'Wrong size', current_date - 1,
  jsonb_build_array(jsonb_build_object('item', (select id from public.order_items where order_id = (select id from t where k = 'order')), 'qty', 1)),
  gen_random_uuid());
reset role;

-- 2. Returns to inspect.
select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager
select results_eq($$ select quantity, item, kind from public.returns_to_inspect('aaaaaaaa-0000-0000-0000-000000000000') $$,
  $$ values (1, 'Wrap dress M'::text, 'exchange'::text) $$, 'The production manager sees the returned dress waiting for inspection');
select is_empty($$ select 1 from information_schema.routines r join information_schema.parameters p using (specific_schema, specific_name)
  where r.routine_name = 'returns_to_inspect' and p.parameter_mode = 'OUT' and p.parameter_name ~ 'customer|price|amount|phone' $$,
  'The list carries no customer, price or payment details');
select throws_ok($$ select public.link_exchange_replacement((select id from t where k = 'exchange'), (select id from t where k = 'order')) $$,
  '42501', null, 'The production manager cannot link exchanges');
reset role;

select tests.login('b0000000-0000-0000-0000-000000000001');
select throws_ok($$ select * from public.returns_to_inspect('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null,
  'Another business cannot see these returns');
reset role;

-- 3. Linking the replacement order (front office).
select tests.login('a0000000-0000-0000-0000-000000000002');
insert into t select 'replacement', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress L', 'quantity', 1, 'unit_price_minor', 1500000)), gen_random_uuid());
select throws_like($$ select public.link_exchange_replacement((select id from t where k = 'exchange'), (select id from t where k = 'order')) $$,
  'Choose the new order%', 'The original order cannot replace itself');
select lives_ok($$ select public.link_exchange_replacement((select id from t where k = 'exchange'), (select id from t where k = 'replacement')) $$,
  'The front office links the replacement order');
reset role;
select is((select replacement_order_id from public.order_returns where id = (select id from t where k = 'exchange')),
  (select id from t where k = 'replacement'), '... and the exchange records it');

select tests.login('a0000000-0000-0000-0000-000000000002');
insert into t select 'other', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Kaftan', 'quantity', 1, 'unit_price_minor', 1000000)), gen_random_uuid());
select throws_like($$ select public.link_exchange_replacement((select id from t where k = 'exchange'), (select id from t where k = 'other')) $$,
  'This exchange already has%', 'An exchange keeps the replacement it was linked to');
select public.cancel_order((select id from t where k = 'other'), 'Customer changed her mind');
select throws_like($$ select public.link_exchange_replacement((select id from t where k = 'exchange'), (select id from t where k = 'other')) $$,
  'That order is cancelled%', 'A cancelled order cannot be the replacement');
select public.cancel_order((select id from t where k = 'replacement'), 'Wrong item');
insert into t select 'replacement2', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress L', 'quantity', 1, 'unit_price_minor', 1500000)), gen_random_uuid());
select lives_ok($$ select public.link_exchange_replacement((select id from t where k = 'exchange'), (select id from t where k = 'replacement2')) $$,
  'If the replacement is cancelled, a new one can take its place');
select public.decide_return_line((select l.id from public.order_return_lines l join public.order_returns r on r.id = l.return_id
  where r.id = (select id from t where k = 'exchange')), 'restock', tests.loc('Finished goods / showroom'), gen_random_uuid());
select is_empty($$ select 1 from public.returns_to_inspect('aaaaaaaa-0000-0000-0000-000000000000') $$,
  'Once inspected, it leaves the list');
reset role;

select throws_like($$ update public.businesses set timezone = 'Lagos/Nowhere' where id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'Unknown time zone%', 'An unknown time zone is refused (it would break every report)');

select * from finish();
rollback;
