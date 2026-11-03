-- Roles inside one business: production staff, sales staff, owners.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(16);

---------------------------------------------------------------------------
-- Production manager: production work, no customer payments or order values
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000003');
select is_empty($$ select 1 from public.customers $$, 'Production manager cannot read customer records');
select is_empty($$ select 1 from public.orders $$, 'Production manager cannot read orders');
select is_empty($$ select 1 from public.payments $$, 'Production manager cannot read payments');
select is_empty($$ select 1 from public.order_summaries $$, 'Production manager cannot see order values or balances');
select results_eq(
  $$ select order_number, item_description, bust::int from public.my_production_jobs('aaaaaaaa-0000-0000-0000-000000000000') $$,
  $$ values ('HA-00001'::text, 'Wrap dress'::text, 90) $$,
  'Production manager see their assigned job with the measurements they need');
select throws_ok(
  $$ insert into public.customers (business_id, full_name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'X') $$,
  '42501', null, 'Production manager cannot create customers');
reset role;

---------------------------------------------------------------------------
-- Front office: daily work, but no refunds, cancellations or audit history
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002');
select results_eq($$ select count(*)::int from public.customers $$, array[1], 'Front office read their business''s customers');
select lives_ok(
  $$ insert into public.payments (business_id, order_id, amount_minor, method)
     values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-00000000000a', 500000, 'cash') $$,
  'Front office can record a payment');
select throws_ok(
  $$ insert into public.payments (business_id, order_id, kind, amount_minor, method)
     values ('aaaaaaaa-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-00000000000a', 'refund', 1000, 'cash') $$,
  '42501', null, 'Front office cannot record refunds');
-- Voiding is an owner-only correction (Spec 2): RLS hides the row from the front office's update.
update public.payments set void_reason = 'front office tries' where order_id = 'dddddddd-0000-0000-0000-00000000000a';
select is_empty($$ select 1 from public.payments where void_reason is not null $$,
  'Front office cannot void (silently alter) a payment');
select is_empty($$ select 1 from public.audit_log $$, 'Front office cannot read the audit log');
select throws_ok(
  $$ select public.update_member((select id from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000003'), 'front_office') $$,
  '42501', null, 'Front office cannot change anyone''s role');
reset role;

---------------------------------------------------------------------------
-- Owners: history is protected even from them
---------------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');
select throws_ok($$ delete from public.customers where id = 'cccccccc-0000-0000-0000-00000000000a' $$,
  '42501', null, 'Records cannot be deleted, only archived');
select throws_ok($$ update public.audit_log set actor = null $$, '42501', null, 'The audit log cannot be edited');
select throws_ok($$ delete from public.payments $$, '42501', null, 'Payments cannot be deleted');
select throws_ok(
  $$ select public.update_member((select id from public.memberships where user_id = 'a0000000-0000-0000-0000-000000000001'), null, false) $$,
  'P0001', null, 'The last owner cannot deactivate themselves');
reset role;

select * from finish();
rollback;
