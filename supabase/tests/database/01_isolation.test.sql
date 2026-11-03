-- One business must never see or change another business's data,
-- whatever route it tries: direct table reads, writes, RPCs, views or forged foreign keys.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(19);

---------------------------------------------------------------------------
-- Owner of business B attacks business A
---------------------------------------------------------------------------
select tests.login('b0000000-0000-0000-0000-000000000001');

select is_empty($$ select 1 from public.customers where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'B cannot read A''s customers');
select is_empty($$ select 1 from public.customers where id = 'cccccccc-0000-0000-0000-00000000000a' $$,
  'B cannot read an A customer by direct id');
select is_empty($$ select 1 from public.orders where id = 'dddddddd-0000-0000-0000-00000000000a' $$,
  'B cannot read A''s order by direct id');
select is_empty($$ select 1 from public.order_summaries where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'B cannot read A''s order figures through the summary view');
select is_empty($$ select 1 from public.payments where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'B cannot read A''s payments');
select is_empty($$ select 1 from public.audit_log where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'B cannot read A''s audit history');
select is_empty($$ select 1 from public.memberships where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' $$,
  'B cannot list A''s staff');
select results_eq($$ select count(*)::int from public.businesses $$, array[1],
  'B sees only its own business');

select throws_ok(
  $$ insert into public.customers (business_id, full_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Planted') $$,
  '42501', null, 'B cannot create a customer inside A');

select throws_ok(
  $$ select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[{"description":"x","quantity":1,"unit_price_minor":1}]'::jsonb, gen_random_uuid()) $$,
  '42501', null, 'B cannot create an order inside A through the RPC');

select throws_ok(
  $$ select public.create_order('bbbbbbbb-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[{"description":"x","quantity":1,"unit_price_minor":1}]'::jsonb, gen_random_uuid()) $$,
  '23503', null, 'B cannot attach A''s customer to a B order (composite foreign key)');

select throws_ok(
  $$ select public.create_invitation('aaaaaaaa-0000-0000-0000-000000000000', 'spy@test.dev', 'manager') $$,
  '42501', null, 'B cannot invite itself into A');

-- Updates silently match nothing under RLS; verify the row is unchanged afterwards.
update public.customers set full_name = 'Hijacked' where id = 'cccccccc-0000-0000-0000-00000000000a';
update public.orders set internal_notes = 'Hijacked' where id = 'dddddddd-0000-0000-0000-00000000000a';

reset role;
select results_eq($$ select full_name from public.customers where id = 'cccccccc-0000-0000-0000-00000000000a' $$,
  array['Amaka Test'], 'B''s update to A''s customer had no effect');
select results_eq($$ select coalesce(internal_notes, '') from public.orders where id = 'dddddddd-0000-0000-0000-00000000000a' $$,
  array[''], 'B''s update to A''s order had no effect');

---------------------------------------------------------------------------
-- Deactivated staff, platform admins and anonymous visitors
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000004');
select is_empty($$ select 1 from public.customers $$, 'Deactivated staff lose all access');
reset role;

select tests.login('c0000000-0000-0000-0000-000000000001');
select results_eq($$ select count(*)::int from public.businesses $$, array[2],
  'Platform admin can list business accounts');
select is_empty($$ select 1 from public.customers $$,
  'Platform admin cannot read any business''s customer records');
reset role;

set local role anon;
select throws_ok($$ select 1 from public.customers $$, '42501', null, 'Anonymous visitors are refused outright');
select throws_ok($$ select public.create_demo_workspace() $$, '42501', null,
  'Anonymous visitors cannot call RPCs');
reset role;

select * from finish();
rollback;
