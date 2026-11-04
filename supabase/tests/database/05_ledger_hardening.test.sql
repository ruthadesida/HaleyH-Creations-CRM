-- Regression tests for the Phase 1 review findings (migration 0010).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(24);

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
create or replace function tests.avg_cost(p_code text) returns numeric language sql stable security definer as $$
  select round(avg_cost, 2) from public.stock_items where id = tests.item(p_code)
$$;
create or replace function tests.opening(p_code text, p_loc text, p_qty numeric, p_cost text) returns uuid language plpgsql as $$
declare v_batch uuid;
begin
  v_batch := public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 't.csv', null, jsonb_build_array(jsonb_build_object(
    'line', 1, 'code', p_code, 'name', p_code, 'kind', 'raw_material', 'base_unit', 'pc',
    'location_id', tests.loc(p_loc), 'quantity', p_qty, 'unit', 'pc', 'unit_cost', p_cost)));
  perform public.post_opening_batch(v_batch, gen_random_uuid());
  return v_batch;
end;
$$;
grant execute on all functions in schema tests to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 1 where id = 'aaaaaaaa-0000-0000-0000-000000000000';

---------------------------------------------------------------------------
-- Moving average survives transfers and their reversal (finding 3)
---------------------------------------------------------------------------
select tests.opening('LEA-01', 'Raw material store', 10, '1000');
create temp table t (k text, id uuid);
grant all on t to authenticated;
insert into t select 'xfer', public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('LEA-01'),
  tests.loc('Raw material store'), tests.loc('Production floor'), 4, current_date, null, gen_random_uuid());
-- A second, dearer opening at another location moves the average to (10×1000 + 10×2000) / 20 = 1500.
insert into t select 'ob2', public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'q.csv', null,
  jsonb_build_array(jsonb_build_object('line', 1, 'code', 'LEA-01', 'location_id', tests.loc('Quarantine'),
    'quantity', 10, 'unit', 'pc', 'unit_cost', '2000')));
select public.post_opening_batch((select id from t where k = 'ob2'), gen_random_uuid());
select results_eq($$ select tests.avg_cost('LEA-01') $$, array[1500.00::numeric], 'A dearer receipt moves the average to 1500');
select lives_ok($$ select public.reverse_stock_document((select id from t where k = 'xfer'), 'Wrong shelf', gen_random_uuid()) $$,
  'Owner reverses the transfer');
select results_eq($$ select tests.avg_cost('LEA-01') $$, array[1500.00::numeric], 'Reversing a transfer leaves the average unchanged');
select results_eq(
  $$ select round(sum(value_kobo)) from public.stock_valuation('aaaaaaaa-0000-0000-0000-000000000000') v
     where v.stock_item_id = tests.item('LEA-01') $$,
  array[30000::numeric], 'Stock value equals on hand × average');

---------------------------------------------------------------------------
-- Idempotency keys can't be reused for a different action (finding 4)
---------------------------------------------------------------------------
select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('LEA-01'), tests.loc('Raw material store'),
  tests.loc('Production floor'), 1, current_date, null, '00000000-0000-0000-0000-0000000000c1');
select throws_ok(
  $$ select public.reverse_stock_document((select id from t where k = 'xfer'), 'x', '00000000-0000-0000-0000-0000000000c1') $$,
  'P0001', null, 'A key used for a transfer cannot be reused for a reversal');
select throws_ok(
  $$ select public.post_opening_batch((select public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'k.csv', null,
       jsonb_build_array(jsonb_build_object('line', 1, 'code', 'KEY-01', 'name', 'Key test', 'kind', 'raw_material', 'base_unit', 'pc',
         'location_id', tests.loc('Raw material store'), 'quantity', 1, 'unit', 'pc', 'unit_cost', '1')))),
       '00000000-0000-0000-0000-0000000000c1') $$,
  'P0001', null, 'A key used for a transfer cannot be reused to post an opening batch');

---------------------------------------------------------------------------
-- Generic reversal keeps the opening batch in step (findings 9, 10)
---------------------------------------------------------------------------
insert into t select 'ob3', tests.opening('THR-01', 'Raw material store', 5, '300');
select lives_ok(
  $$ select public.reverse_stock_document((select document_id from public.opening_batches where id = (select id from t where k = 'ob3')),
       'Imported twice', gen_random_uuid()) $$,
  'Opening stock can be reversed from the Movements page');
select results_eq($$ select status from public.opening_batches where id = (select id from t where k = 'ob3') $$,
  array['reversed'], 'The batch is marked reversed too');
select lives_ok($$ select public.reverse_opening_batch((select id from t where k = 'ob3'), 'again', gen_random_uuid()) $$,
  'Reversing an already-reversed batch is harmless');
select results_eq(
  $$ select ok from public.validate_opening_lines('aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object(
       'line', 1, 'code', 'THR-01', 'location_id', tests.loc('Raw material store'), 'quantity', 5, 'unit', 'pc', 'unit_cost', '300'))) $$,
  array[true], 'After reversal the item can be imported again');

---------------------------------------------------------------------------
-- Counts use the quantity expected when counted (findings 1, 2)
---------------------------------------------------------------------------
-- LEA-01 at the store: 10 opening − 4 transfer + 4 reversed − 1 transfer = 9.
select results_eq($$ select tests.on_hand('LEA-01', 'Raw material store') $$, array[9.0000::numeric], 'Store starts at 9');
insert into t select 'count', public.request_adjustment('aaaaaaaa-0000-0000-0000-000000000000', 'count', tests.loc('Raw material store'),
  'Morning count', current_date, jsonb_build_array(jsonb_build_object('item', tests.item('LEA-01'), 'qty', 8)), gen_random_uuid());
select results_eq($$ select expected_qty from public.adjustment_lines where request_id = (select id from t where k = 'count') $$,
  array[9.0000::numeric], 'The count records what the ledger expected at count time');
-- Stock moves out after the count, before approval.
select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('LEA-01'), tests.loc('Raw material store'),
  tests.loc('Production floor'), 2, current_date, null, gen_random_uuid());
select public.decide_adjustment((select id from t where k = 'count'), true, null, gen_random_uuid());
select results_eq($$ select tests.on_hand('LEA-01', 'Raw material store') $$, array[6.0000::numeric],
  'The 1-unit loss found by the count is still posted after the later transfer (9 − 1 − 2 = 6)');
select results_eq($$ select status from public.adjustment_requests where id = (select id from t where k = 'count') $$,
  array['approved'], 'Count approved');
select lives_ok($$ select public.reverse_stock_document((select document_id from public.adjustment_requests where id = (select id from t where k = 'count')),
  'Recounted', gen_random_uuid()) $$, 'A count adjustment can be reversed');
select results_eq($$ select status from public.adjustment_requests where id = (select id from t where k = 'count') $$,
  array['reversed'], 'The count request is marked reversed too');
select throws_ok(
  $$ select public.request_adjustment('aaaaaaaa-0000-0000-0000-000000000000', 'count', tests.loc('Raw material store'),
       'Blank', current_date, jsonb_build_array(jsonb_build_object('item', tests.item('LEA-01'), 'qty', null)), gen_random_uuid()) $$,
  'P0001', null, 'A blank quantity is refused, never treated as zero');
select throws_ok(
  $$ select public.request_adjustment('aaaaaaaa-0000-0000-0000-000000000000', 'count', tests.loc('Raw material store'),
       'Twice', current_date, jsonb_build_array(jsonb_build_object('item', tests.item('LEA-01'), 'qty', 1),
                                                jsonb_build_object('item', tests.item('LEA-01'), 'qty', 2)), gen_random_uuid()) $$,
  'P0001', null, 'The same item twice in one count is refused');

---------------------------------------------------------------------------
-- Unknown costs, rounding, dates, tenancy (findings 11, 15, low)
---------------------------------------------------------------------------
select tests.opening('BOX-01', 'Raw material store', 50, '');
select results_eq($$ select cost_missing from public.stock_items where id = tests.item('BOX-01') $$, array[true],
  'Opening stock with a blank cost is flagged as cost missing, not valued at ₦0 silently');
select results_eq(
  $$ select ok from public.validate_opening_lines('aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_array(jsonb_build_object(
       'line', 1, 'code', 'TINY', 'name', 'Tiny', 'kind', 'raw_material', 'base_unit', 'm',
       'location_id', tests.loc('Raw material store'), 'quantity', 0.001, 'unit', 'mm', 'unit_cost', '1'))) $$,
  array[false], 'A quantity that rounds to zero in the base unit is refused with a message');
select throws_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', tests.item('LEA-01'), tests.loc('Production floor'),
       tests.loc('Raw material store'), 1, current_date + 2, null, gen_random_uuid()) $$,
  'P0001', null, 'Future-dated postings are refused');
reset role;

select tests.login('b0000000-0000-0000-0000-000000000001');
-- (Nobody can choose row ids: they're always generated.)
insert into public.stock_items (business_id, kind, code, name, base_unit)
  values ('bbbbbbbb-0000-0000-0000-000000000000', 'raw_material', 'B-ONLY', 'B item', 'pc');
insert into t select 'bitem', id from public.stock_items where code = 'B-ONLY';
reset role;
select tests.login('a0000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ select public.post_transfer('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'bitem'),
       tests.loc('Raw material store'), tests.loc('Production floor'), 1, current_date, null, gen_random_uuid()) $$,
  'P0001', null, 'Another business''s item cannot be moved through this business');
select throws_ok($$ insert into public.stock_movements (business_id, document_id, stock_item_id, location_id, quantity, effective_date)
  values ('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), tests.item('LEA-01'), tests.loc('Raw material store'), 1, current_date) $$,
  '42501', null, 'Ledger rows cannot be inserted directly, even by an owner');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.opening_batch_costs((select id from t where k = 'ob2')) $$,
  'Production manager without permission gets no opening costs');
reset role;

select * from finish();
rollback;
