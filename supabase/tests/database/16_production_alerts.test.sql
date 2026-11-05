-- Order to production: confirming an order creates the job with its recipe's materials, and the production
-- manager is told about new jobs that need a maker or have no materials planned.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(8);

create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup (owner A): fabric in stock; an agbada made to order with a recipe; a gele made to order without one; a tailor.
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.stock_items (business_id, kind, code, name, base_unit) values ('aaaaaaaa-0000-0000-0000-000000000000', 'raw_material', 'FAB', 'Aso oke', 'm');
insert into public.products (business_id, name, default_item_type) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Agbada', 'made_to_order'), ('aaaaaaaa-0000-0000-0000-000000000000', 'Gele', 'made_to_order');
insert into public.product_variants (business_id, product_id, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, upper(name) from public.products where name in ('Agbada', 'Gele');
select public.activate_bom(public.save_bom('aaaaaaaa-0000-0000-0000-000000000000', null, (select id from public.products where name = 'Agbada'),
  'Agbada', false, 0, 0, '', jsonb_build_array(jsonb_build_object('item', (select id from public.stock_items where code = 'FAB'), 'qty', 4, 'unit', 'm'))));
insert into public.makers (business_id, name, trade) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Tunde Adeyemi', 'tailor');
reset role;

-- The front office takes and confirms the order.
select tests.login('a0000000-0000-0000-0000-000000000002');
insert into t select 'order', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(
    jsonb_build_object('description', 'Agbada', 'variant_id', (select id from public.product_variants where sku = 'AGBADA'), 'quantity', 2,
      'unit_price_minor', 9000000, 'item_type', 'made_to_order'),
    jsonb_build_object('description', 'Gele', 'variant_id', (select id from public.product_variants where sku = 'GELE'), 'quantity', 1,
      'unit_price_minor', 1500000, 'item_type', 'made_to_order')),
  gen_random_uuid());
select is(public.confirm_order((select id from t where k = 'order')), 2, 'Confirming the order sends both made-to-order lines to production');
select is_empty($$ select 1 from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind like 'job%' $$,
  'The front office is not sent production alerts');
reset role;

insert into t select 'agbada', j.id from public.production_jobs j join public.order_items i on i.id = j.order_item_id where i.description = 'Agbada';
select order_number as onum from public.orders where id = (select id from t where k = 'order') \gset
insert into t select 'gele', j.id from public.production_jobs j join public.order_items i on i.id = j.order_item_id where i.description = 'Gele';
select is((select planned_qty_base from public.job_materials where job_id = (select id from t where k = 'agbada')), 8.0000,
  'The agbada job arrives with its materials planned from the recipe (4 m × 2)');

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production manager
select results_eq($$ select count(*)::int from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000')
    where kind = 'job_unassigned' $$, array[2], 'The production manager is told both new jobs need a maker');
select results_eq($$ select ref_id from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind = 'job_no_materials' $$,
  $$ select id from t where k = 'gele' $$, '... and that the gele job has no materials planned');
select ok((select bool_and(detail like '%for ' || :'onum' || '%') from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000')
    where kind = 'job_unassigned'), 'The alert names the order it is for');
select public.assign_job_maker((select id from t where k = 'agbada'), (select id from public.makers where name = 'Tunde Adeyemi'), current_date + 7);
select results_eq($$ select ref_id from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') where kind = 'job_unassigned' $$,
  $$ select id from t where k = 'gele' $$, 'Once a tailor is assigned, that job leaves the list');
reset role;

select tests.login('b0000000-0000-0000-0000-000000000001');
select is_empty($$ select 1 from public.my_notifications('aaaaaaaa-0000-0000-0000-000000000000') $$,
  'Another business sees none of this');
reset role;

select * from finish();
rollback;
