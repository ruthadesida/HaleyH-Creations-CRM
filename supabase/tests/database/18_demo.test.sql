-- The demo workspace is built through the real functions, so it exercises every area; resetting archives it.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(14);

create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000002'); -- any signed-in person (here: business A's front office)
insert into t select 'demo', public.create_demo_workspace();
select ok((select is_demo from public.businesses where id = (select id from t where k = 'demo')), 'The demo is flagged as a demo');
select is((select role::text from public.memberships where business_id = (select id from t where k = 'demo')
    and user_id = 'a0000000-0000-0000-0000-000000000002'), 'owner', '... and the person who opened it owns it');
select is(public.create_demo_workspace(), (select id from t where k = 'demo'), 'Opening it again returns the same demo');
select ok((select bool_and(full_name like 'Demo%') from public.customers where business_id = (select id from t where k = 'demo')),
  'Every customer is clearly fictional');

-- Stock, costs and purchasing came through the ledger.
select ok((select count(*) > 0 from public.stock_movements where business_id = (select id from t where k = 'demo')), 'Opening stock was posted to the ledger');
select results_eq($$ select s.on_hand from public.stock_balances s join public.stock_items i on i.id = s.stock_item_id
    join public.locations l on l.id = s.location_id
    where i.business_id = (select id from t where k = 'demo') and i.code = 'DEMO-FAB' and l.kind = 'store' $$,
  array[83.7::numeric], 'Fabric: 60 m opening + 30 m received − 6.3 m issued to the stock run');
select is((select status from public.purchase_orders where business_id = (select id from t where k = 'demo')), 'received', 'The fabric order was received');

-- Production and orders at every stage.
select results_eq($$ select status from public.production_jobs where business_id = (select id from t where k = 'demo') order by status $$,
  array['allocated', 'completed']::text[],
  'A stock run finished through QC, and the order''s dress is allocated to its tailor');
select results_eq($$ select count(*) filter (where confirmed_at is null)::int, count(*) filter (where fulfilment_stage = 'delivered')::int
    from public.order_summaries where business_id = (select id from t where k = 'demo') $$,
  $$ values (1, 1) $$, 'One quotation and one delivered order among the others');
select ok((select count(*) = 1 from public.returns_to_inspect((select id from t where k = 'demo'))), 'A returned kaftan waits in Quarantine for inspection');

-- Repairs at every stage, and the owner's dashboard works.
select results_eq($$ select status from public.repairs where business_id = (select id from t where k = 'demo') order by number $$,
  array['in_repair', 'ready', 'received']::text[], 'Repairs in repair, ready and just received');
select ok((select gross_profit > 0 from public.owner_overview((select id from t where k = 'demo'), current_date, current_date)),
  'Today''s overview shows sales and estimated profit');

-- Starting again archives the old demo and builds a new one.
insert into t select 'demo2', public.reset_demo_workspace();
select isnt((select id from t where k = 'demo2'), (select id from t where k = 'demo'), 'Starting again builds a new demo');
reset role;
select ok((select archived_at is not null from public.businesses where id = (select id from t where k = 'demo')),
  '... and the old one is archived, not deleted');

select * from finish();
rollback;
