-- Phase 2b/c: recipes, production jobs, reservations, WIP, external makers, QC.
-- Spec 2 tests C (reserve, issue, maker, WIP), D (returns), E (QC failure / rework), F (no double
-- consumption), L (external maker stock stays business stock).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(43);

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
create or replace function tests.on_hand_at(p_code text, p_loc uuid) returns numeric language sql stable security definer as $$
  select coalesce(sum(quantity), 0) from public.stock_movements where stock_item_id = tests.item(p_code) and location_id = p_loc
$$;
create or replace function tests.available(p_code text) returns numeric language sql stable security definer as $$
  select available from public.stock_availability where stock_item_id = tests.item(p_code)
$$;
create or replace function tests.job(p_id uuid) returns public.production_jobs language sql stable security definer as $$
  select * from public.production_jobs where id = p_id
$$;
create or replace function tests.avg_cost(p_code text) returns numeric language sql stable security definer as $$
  select round(avg_cost, 2) from public.stock_items where id = tests.item(p_code)
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

---------------------------------------------------------------------------
-- Setup (owner A): a product with a variant, opening stock of fabric and zips, an external maker
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name, category) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress', 'clothing');
insert into t select 'product', id from public.products where name = 'Wrap dress';
insert into public.product_variants (business_id, product_id, size, sku)
  values ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'product'), 'M', 'WRAP-M');
insert into t select 'variant', id from public.product_variants where sku = 'WRAP-M';
-- 20 m of fabric at ₦400/m and 10 zips at ₦100 each.
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'FAB', 'name', 'Ankara', 'kind', 'raw_material', 'base_unit', 'm',
    'location_id', tests.loc('Raw material store'), 'quantity', 20, 'unit', 'm', 'unit_cost', '40000'),
  jsonb_build_object('line', 3, 'code', 'ZIP', 'name', 'Zip', 'kind', 'raw_material', 'base_unit', 'pc',
    'location_id', tests.loc('Raw material store'), 'quantity', 10, 'unit', 'pc', 'unit_cost', '10000'))), gen_random_uuid());
insert into public.makers (business_id, name, trade, is_external) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Tunde', 'tailor', true);
insert into t select 'maker', id from public.makers where name = 'Tunde';
reset role;

---------------------------------------------------------------------------
-- Recipe (BOM)
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager, no cost permission
insert into t select 'bom', public.save_bom('aaaaaaaa-0000-0000-0000-000000000000', null, (select id from t where k = 'product'),
  'Wrap dress', false, 999, 999, 'Double-stitch the hem', jsonb_build_array(
    jsonb_build_object('item', tests.item('FAB'), 'qty', 2.5, 'unit', 'm', 'wastage_pct', 4),
    jsonb_build_object('item', tests.item('ZIP'), 'qty', 1, 'unit', 'pc')));
select is_empty($$ select 1 from public.bom_costs((select id from t where k = 'bom')) $$, 'The production manager sees no recipe costs');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select results_eq($$ select labour_cost from public.bom_costs((select id from t where k = 'bom')) $$, array[0::numeric],
  'Costs typed by someone who cannot see costs are not stored');
-- ₦5,000 labour per dress.
select public.save_bom('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'bom'), (select id from t where k = 'product'),
  'Wrap dress', false, 500000, 0, 'Double-stitch the hem', jsonb_build_array(
    jsonb_build_object('item', tests.item('FAB'), 'qty', 2.5, 'unit', 'm', 'wastage_pct', 4),
    jsonb_build_object('item', tests.item('ZIP'), 'qty', 1, 'unit', 'pc')));
select lives_ok($$ select public.activate_bom((select id from t where k = 'bom')) $$, 'The owner activates the recipe');
select throws_ok($$ select public.save_bom('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'bom'),
  (select id from t where k = 'product'), 'X', false, 0, 0, null,
  jsonb_build_array(jsonb_build_object('item', tests.item('ZIP'), 'qty', 1))) $$,
  'P0001', null, 'An active recipe cannot be edited (make a new version)');
reset role;

---------------------------------------------------------------------------
-- Job, allocation and shortages (test C)
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
insert into t select 'job', public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'),
  2, (select id from t where k = 'bom'), (select id from t where k = 'maker'), current_date + 7, null,
  '00000000-0000-0000-0000-0000000000f1');
select results_eq($$ select i.code, m.planned_qty_base from public.job_materials m join public.stock_items i on i.id = m.stock_item_id
  where m.job_id = (select id from t where k = 'job') order by i.code $$,
  $$ values ('FAB'::text, 5.2000::numeric), ('ZIP'::text, 2.0000::numeric) $$,
  'The recipe is copied into the job: 2 dresses × 2.5 m + 4% wastage = 5.2 m; 2 zips');
select is(public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'),
  2, (select id from t where k = 'bom'), null, null, null, '00000000-0000-0000-0000-0000000000f1'),
  (select id from t where k = 'job'), 'A double tap does not create a second job');
select is((tests.job((select id from t where k = 'job'))).maker_id, (select id from t where k = 'maker'), 'The job records its maker');
select throws_ok($$ select labour_cost from public.production_jobs $$, '42501', null, 'Job costs cannot be selected directly');
select lives_ok($$ select public.allocate_job_materials((select id from t where k = 'job')) $$, 'Materials are allocated');
select is(tests.available('FAB'), 14.8000::numeric, 'Allocation reserves 5.2 m: 14.8 m left available');
select is(tests.on_hand('FAB'), 20.0000::numeric, '... but physical stock is unchanged');
insert into t select 'big', public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'),
  10, (select id from t where k = 'bom'), null, null, null, gen_random_uuid());
select throws_like($$ select public.allocate_job_materials((select id from t where k = 'big')) $$,
  'Not enough material. Ankara: need 26 m, 14.8 available.%', 'A shortage is reported before production starts');
select is(tests.available('ZIP'), 8.0000::numeric, '... and nothing is reserved for a job that cannot be fully allocated');

---------------------------------------------------------------------------
-- External maker (test L) and issue (test C)
---------------------------------------------------------------------------
insert into t select 'makerloc', public.maker_location((select id from t where k = 'maker'));
select public.move_job_materials((select id from t where k = 'job'), tests.loc('Raw material store'), (select id from t where k = 'makerloc'),
  current_date, jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 5.2),
                                  jsonb_build_object('item', tests.item('ZIP'), 'qty', 2)), gen_random_uuid());
select is(tests.on_hand_at('FAB', (select id from t where k = 'makerloc')), 5.2000::numeric, 'Fabric sent to the maker shows at their location');
select is(tests.on_hand('FAB'), 20.0000::numeric, '... and is still business stock (total unchanged)');
select is(tests.available('FAB'), 14.8000::numeric, '... still reserved for the job');
insert into t select 'issue', public.issue_job_materials((select id from t where k = 'job'), (select id from t where k = 'makerloc'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 5.2), jsonb_build_object('item', tests.item('ZIP'), 'qty', 2)),
  '00000000-0000-0000-0000-0000000000f2');
select is(tests.on_hand('FAB'), 14.8000::numeric, 'Issuing consumes the fabric (it is now work in progress)');
select is(tests.available('FAB'), 14.8000::numeric, '... and uses up the reservation instead of reserving twice');
select is((tests.job((select id from t where k = 'job'))).status, 'in_progress', 'The job is in progress');
select is(public.issue_job_materials((select id from t where k = 'job'), (select id from t where k = 'makerloc'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 5.2)), '00000000-0000-0000-0000-0000000000f2'),
  (select id from t where k = 'issue'), 'A retried issue returns the same document');
select is(tests.on_hand('FAB'), 14.8000::numeric, '... and consumes nothing more');

---------------------------------------------------------------------------
-- Returns (test D)
---------------------------------------------------------------------------
select public.return_job_materials((select id from t where k = 'job'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 0.7)), gen_random_uuid());
select is(tests.on_hand('FAB'), 15.5000::numeric, '0.7 m of unused fabric comes back to the store');
select is(tests.avg_cost('FAB'), 40000.00::numeric, '... at the cost it was issued at');
select throws_ok($$ select public.return_job_materials((select id from t where k = 'job'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 5)), gen_random_uuid()) $$,
  'P0001', null, 'You cannot return more than is still with the job');

---------------------------------------------------------------------------
-- QC: rework, then pass (tests E and F)
---------------------------------------------------------------------------
select throws_ok($$ select public.record_qc_inspection((select id from t where k = 'job'), 2, 0, 0, '{}', null, null,
  tests.loc('Finished goods / showroom'), current_date, gen_random_uuid()) $$, 'P0001', null, 'QC needs the job submitted first');
select public.submit_job_for_qc((select id from t where k = 'job'));
select throws_ok($$ select public.record_qc_inspection((select id from t where k = 'job'), 1, 1, 0, '{}', '', null,
  tests.loc('Finished goods / showroom'), current_date, gen_random_uuid()) $$, 'P0001', null, 'Rework needs the defects described');
select public.record_qc_inspection((select id from t where k = 'job'), 1, 1, 0, '{"Stitching even and secure": false}',
  'Hem uneven', 'Redo the hem', tests.loc('Finished goods / showroom'), current_date, gen_random_uuid());
select is(tests.on_hand('WRAP-M'), 1.0000::numeric, 'Only the passed dress enters finished stock; the rework one stays unavailable');
select is((tests.job((select id from t where k = 'job'))).status, 'in_progress', 'The job goes back to work for the rework');
select public.submit_job_for_qc((select id from t where k = 'job'));
select public.record_qc_inspection((select id from t where k = 'job'), 1, 0, 0, '{}', null, null,
  tests.loc('Finished goods / showroom'), current_date, gen_random_uuid());
select is(tests.on_hand('WRAP-M'), 2.0000::numeric, 'After rework passes, both dresses are finished stock');
select is((tests.job((select id from t where k = 'job'))).status, 'completed', 'The job is completed');
select is(tests.on_hand('FAB'), 15.5000::numeric, 'Completion consumes no more fabric (consumed once, at issue)');
select is(tests.on_hand('ZIP'), 8.0000::numeric, '... and no more zips');
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
-- Materials 4.5 m × ₦400 + 2 zips × ₦100 = ₦2,000, plus labour 2 × ₦5,000 = ₦12,000 → ₦6,000 a dress.
select is(tests.avg_cost('WRAP-M'), 600000.00::numeric, 'Each dress costs ₦6,000: materials used + labour, from WIP');
select throws_ok($$ select public.reverse_stock_document((select id from t where k = 'issue'), 'x', gen_random_uuid()) $$,
  'P0001', null, 'Production documents are corrected from the job, not reversed from Movements');
select results_eq($$ select round(wip_value, 2) from public.job_costs((select id from t where k = 'job')) $$, array[0.00::numeric],
  'Nothing is left in WIP once the job is complete');
select throws_ok($$ select public.approve_maker_fee((select id from t where k = 'big'), 1) $$, 'P0001', null,
  'A fee is approved only for a completed job with a maker');
select lives_ok($$ select public.approve_maker_fee((select id from t where k = 'job'), 1000000) $$, 'The owner approves what Tunde is owed');
reset role;

---------------------------------------------------------------------------
-- Rejection to quarantine; cancellation
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
insert into t select 'one', public.create_production_job('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'variant'),
  1, null, null, null, null, gen_random_uuid());
select public.submit_job_for_qc((select id from t where k = 'one'));
select throws_ok($$ select public.approve_maker_fee((select id from t where k = 'job'), 5) $$, '42501', null,
  'The production manager cannot approve maker fees');
select public.record_qc_inspection((select id from t where k = 'one'), 0, 0, 1, '{}', 'Torn lining', null, null, current_date, gen_random_uuid());
select is(tests.on_hand_at('WRAP-M', tests.loc('Quarantine')), 1.0000::numeric, 'A rejected item goes to Quarantine');
select is(tests.available('WRAP-M'), 2.0000::numeric, '... and is not available to sell');
select lives_ok($$ select public.cancel_production_job((select id from t where k = 'big'), 'Order changed') $$,
  'A job with nothing issued can be cancelled');
reset role;

---------------------------------------------------------------------------
-- Other roles and businesses
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select is_empty($$ select 1 from public.boms $$, 'The front office cannot read recipes');
reset role;
select tests.login('b0000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.issue_job_materials((select id from t where k = 'job'), tests.loc('Raw material store'), current_date,
  jsonb_build_array(jsonb_build_object('item', tests.item('FAB'), 'qty', 1)), gen_random_uuid()) $$,
  '42501', null, 'Another business cannot touch this job');
reset role;

select * from finish();
rollback;
