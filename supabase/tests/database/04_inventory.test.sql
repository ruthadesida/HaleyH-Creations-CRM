-- Inventory ledger (Spec 2 §3, §4, §8, §18 A, L, M, N).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(36);

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
create or replace function tests.item(p_code text) returns uuid language sql stable as $$
  select id from public.stock_items where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and code = p_code
$$;
create or replace function tests.on_hand(p_code text, p_loc text) returns numeric language sql stable as $$
  select coalesce(sum(m.quantity), 0) from public.stock_movements m
  where m.stock_item_id = tests.item(p_code) and m.location_id = tests.loc(p_loc)
$$;
grant execute on all functions in schema tests to authenticated;

-- Owner sets the cutover date; production manager adds two materials.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 1 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003');
insert into public.stock_items (business_id, kind, code, name, base_unit) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'raw_material', 'FAB-001', 'Blue Ankara', 'm'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'raw_material', 'LIN-001', 'Cotton lining', 'm');

---------------------------------------------------------------------------
-- A. Opening stock: validated, owner-approved, imported exactly once
---------------------------------------------------------------------------
create temp table lines as select jsonb_build_array(
  jsonb_build_object('line', 1, 'code', 'FAB-001', 'location_id', tests.loc('Raw material store'), 'quantity', 50, 'unit', 'm', 'unit_cost', 200000),
  -- 10 yd at ₦914.40/yd = 9.144 m at exactly ₦1,000/m
  jsonb_build_object('line', 2, 'code', 'LIN-001', 'location_id', tests.loc('Raw material store'), 'quantity', 10, 'unit', 'yd', 'unit_cost', 91440),
  jsonb_build_object('line', 3, 'code', 'ZIP-01', 'name', 'Zip 20 cm', 'kind', 'raw_material', 'base_unit', 'pc',
                     'location_id', tests.loc('Raw material store'), 'quantity', 200, 'unit', 'pc', 'unit_cost', 5000)
) as j;
grant select on lines to authenticated;

select results_eq(
  $$ select line, ok, round(qty_base, 4), round(cost_base, 2), creates_item
     from public.validate_opening_lines('aaaaaaaa-0000-0000-0000-000000000000', (select j from lines)) order by line $$,
  $$ values (1, true, 50.0000::numeric, 200000.00::numeric, false),
            (2, true, 9.1440::numeric, 100000.00::numeric, false),
            (3, true, 200.0000::numeric, 5000.00::numeric, true) $$,
  'Preview validates lines and converts yards to metres with the right cost per metre');

select results_eq(
  $$ select ok from public.validate_opening_lines('aaaaaaaa-0000-0000-0000-000000000000',
       jsonb_build_array(jsonb_build_object('line', 1, 'code', 'FAB-001', 'location_id', tests.loc('Raw material store'),
         'quantity', 5, 'unit', 'pc', 'unit_cost', 1))) $$,
  array[false], 'Pieces cannot be mixed with metres');

select results_eq(
  $$ select ok from public.validate_opening_lines('aaaaaaaa-0000-0000-0000-000000000000',
       (select j || jsonb_build_array(jsonb_build_object('line', 4, 'code', 'FAB-001', 'location_id', tests.loc('Raw material store'),
         'quantity', 1, 'unit', 'm', 'unit_cost', 1)) from lines)) where line = 4 $$,
  array[false], 'The same item and location twice in one file is flagged as a duplicate');

create temp table batch (id uuid);
grant all on batch to authenticated;
select lives_ok(
  $$ insert into batch select public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'opening.csv', null, (select j from lines)) $$,
  'Production manager can prepare an opening batch');
select is_empty($$ select 1 from public.stock_balances $$, 'A draft batch posts nothing');
select throws_ok($$ select public.post_opening_batch((select id from batch), gen_random_uuid()) $$,
  '42501', null, 'Only an owner can approve and post opening stock');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.post_opening_batch((select id from batch), '00000000-0000-0000-0000-0000000000a1') $$,
  'Owner approves and posts the batch');
select results_eq(
  $$ select tests.on_hand('FAB-001', 'Raw material store'), tests.on_hand('LIN-001', 'Raw material store'),
            tests.on_hand('ZIP-01', 'Raw material store') $$,
  $$ values (50.0000::numeric, 9.1440::numeric, 200.0000::numeric) $$,
  'Opening quantities posted correctly, including the new zip item');
select results_eq(
  $$ select round(sum(value_kobo)) from public.stock_valuation('aaaaaaaa-0000-0000-0000-000000000000') $$,
  array[(50 * 200000 + 9.144 * 100000 + 200 * 5000)::numeric],
  'Opening stock value is correct');

-- Repeat clicks and a second approval cannot double the stock.
select lives_ok($$ select public.post_opening_batch((select id from batch), '00000000-0000-0000-0000-0000000000a1') $$, 'Repeat post is harmless');
select lives_ok($$ select public.post_opening_batch((select id from batch), gen_random_uuid()) $$, 'Posting a posted batch again is harmless');
select results_eq($$ select count(*)::int from public.stock_movements $$, array[3], 'Still exactly three movements');
select throws_ok(
  $$ select public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'again.csv', null, (select j from lines)) $$,
  'P0001', null, 'The same opening stock cannot be imported twice');
select results_eq($$ select count(*)::int from public.payments $$, array[1], 'Opening stock creates no payments');
select results_eq($$ select count(*)::int from public.orders $$, array[1], 'Opening stock creates no orders or sales');
reset role;

---------------------------------------------------------------------------
-- L. External maker stock and transfers
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
insert into public.makers (id, business_id, name, trade, is_external)
  values ('eeee0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'Tunde (bag maker)', 'bag_maker', true);
insert into public.locations (business_id, name, kind, maker_id)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'With Tunde', 'external_maker', 'eeee0000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('FAB-001'), tests.loc('Raw material store'),
       tests.loc('With Tunde'), 20, current_date, 'Bags batch', '00000000-0000-0000-0000-0000000000b1') $$,
  'Production manager sends 20 m to the external maker');
select results_eq(
  $$ select tests.on_hand('FAB-001', 'Raw material store'), tests.on_hand('FAB-001', 'With Tunde'),
            (select sum(quantity) from public.stock_movements where stock_item_id = tests.item('FAB-001')) $$,
  $$ values (30.0000::numeric, 20.0000::numeric, 50.0000::numeric) $$,
  'Stock with the maker is still business stock; the transfer did not change the total');

---------------------------------------------------------------------------
-- M. No double posting, no overselling, closed periods
---------------------------------------------------------------------------
select lives_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('FAB-001'), tests.loc('Raw material store'),
       tests.loc('With Tunde'), 20, current_date, 'Bags batch', '00000000-0000-0000-0000-0000000000b1') $$,
  'A retried transfer with the same key is accepted');
select results_eq($$ select tests.on_hand('FAB-001', 'Raw material store') $$, array[30.0000::numeric],
  '…but posts nothing a second time');
select throws_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('FAB-001'), tests.loc('Raw material store'),
       tests.loc('Production floor'), 31, current_date, null, gen_random_uuid()) $$,
  'P0001', null, 'Moving more than is on hand is refused (no negative stock)');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set stock_closed_through = current_date where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select throws_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('FAB-001'), tests.loc('Raw material store'),
       tests.loc('Production floor'), 1, current_date, null, gen_random_uuid()) $$,
  'P0001', null, 'Postings into a closed period are refused');
update public.businesses set stock_closed_through = null where id = 'aaaaaaaa-0000-0000-0000-000000000000';
reset role;

---------------------------------------------------------------------------
-- Counts and write-offs: requested by production, approved by an owner
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
create temp table req (id uuid, kind text);
grant all on req to authenticated;
insert into req select public.request_adjustment('aaaaaaaa-0000-0000-0000-000000000000', 'count', tests.loc('Raw material store'),
  'Monthly count', current_date, jsonb_build_array(jsonb_build_object('item', tests.item('FAB-001'), 'qty', 28))), 'count';
select results_eq($$ select tests.on_hand('FAB-001', 'Raw material store') $$, array[30.0000::numeric],
  'A count request changes nothing until approved');
select throws_ok($$ select public.decide_adjustment((select id from req where kind = 'count'), true, null, gen_random_uuid()) $$,
  '42501', null, 'Production manager cannot approve their own count');
insert into req select public.request_adjustment('aaaaaaaa-0000-0000-0000-000000000000', 'write_off', tests.loc('Raw material store'),
  'Water damage', current_date, jsonb_build_array(jsonb_build_object('item', tests.item('FAB-001'), 'qty', 3))), 'write_off';
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select lives_ok($$ select public.decide_adjustment((select id from req where kind = 'count'), true, 'Checked', gen_random_uuid()) $$,
  'Owner approves the count');
select lives_ok($$ select public.decide_adjustment((select id from req where kind = 'write_off'), true, null, gen_random_uuid()) $$,
  'Owner approves the write-off');
select results_eq($$ select tests.on_hand('FAB-001', 'Raw material store') $$, array[25.0000::numeric],
  'Count corrected 30 → 28, write-off removed 3 → 25');

---------------------------------------------------------------------------
-- Reversals never delete history and can't undo stock that's been used
---------------------------------------------------------------------------
select throws_ok($$ select public.reverse_opening_batch((select id from batch), 'Wrong file', gen_random_uuid()) $$,
  'P0001', null, 'Reversing opening stock that has since been moved or used is refused');
create temp table batch2 (id uuid);
grant all on batch2 to authenticated;
insert into batch2 select public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'buttons.csv', null,
  jsonb_build_array(jsonb_build_object('line', 1, 'code', 'BTN-01', 'name', 'Gold button', 'kind', 'raw_material',
    'base_unit', 'pc', 'location_id', tests.loc('Raw material store'), 'quantity', 100, 'unit', 'pc', 'unit_cost', 2000)));
select public.post_opening_batch((select id from batch2), gen_random_uuid());
select lives_ok($$ select public.reverse_opening_batch((select id from batch2), 'Counted the wrong box', gen_random_uuid()) $$,
  'An unused batch can be reversed');
select results_eq(
  $$ select tests.on_hand('BTN-01', 'Raw material store'), (select status from public.opening_batches where id = (select id from batch2)),
            (select count(*)::int from public.stock_movements where stock_item_id = tests.item('BTN-01')) $$,
  $$ values (0::numeric, 'reversed'::text, 2) $$,
  'Reversal leaves zero stock, keeps both the original and the mirror movements');
reset role;

---------------------------------------------------------------------------
-- N. Restricted staff and other businesses
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');
insert into public.products (id, business_id, name, category, base_price_minor)
  values ('ffff0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress', 'clothing', 4500000);
insert into public.product_variants (business_id, product_id, size, colour, sku)
  values ('aaaaaaaa-0000-0000-0000-000000000000', 'ffff0000-0000-0000-0000-000000000001', 'M', 'Blue', 'WD-M-BLU');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000002');
select results_eq($$ select kind from public.stock_items $$, array['finished_good'],
  'Front office sees finished goods only (variant stock item created automatically), not raw materials');
select throws_ok($$ select avg_cost from public.stock_items $$, '42501', null, 'Costs are never selectable directly');
select throws_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('WD-M-BLU'), tests.loc('Raw material store'),
       tests.loc('Production floor'), 1, current_date, null, gen_random_uuid()) $$,
  '42501', null, 'Front office cannot move stock');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.stock_valuation('aaaaaaaa-0000-0000-0000-000000000000') $$,
  'Production manager cannot see stock values without an owner''s permission');
select throws_ok($$ update public.stock_movements set quantity = 999 $$, '42501', null, 'Ledger rows cannot be edited');
reset role;

select tests.login('b0000000-0000-0000-0000-000000000001');
select is_empty($$ select 1 from public.stock_items where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'Another business cannot see this business''s stock items');
select throws_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', null, null, null, 1, current_date, null, gen_random_uuid()) $$,
  '42501', null, 'Another business cannot post stock movements here');
reset role;

select * from finish();
rollback;
