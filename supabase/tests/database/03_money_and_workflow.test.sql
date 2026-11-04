-- Order totals, balances, refunds, cancellation and the enquiry-to-delivery workflow.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(26);

select tests.login('a0000000-0000-0000-0000-000000000001');

-- 3 × ₦100 + 1 × ₦50 = ₦350; minus ₦50 discount; plus ₦20 delivery = ₦320 (32,000 kobo).
create temp table t (order_id uuid, enquiry_id uuid) on commit drop;
grant all on t to authenticated;
insert into t (order_id) select public.create_order(
  'aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  '[{"description":"Dress","quantity":3,"unit_price_minor":10000},
    {"description":"Bag","quantity":1,"unit_price_minor":5000}]'::jsonb,
  '11111111-1111-1111-1111-111111111111', p_discount_minor => 5000, p_delivery_fee_minor => 2000);

select results_eq($$ select order_number from public.orders where id = (select order_id from t) $$,
  array['HA-00002'], 'Order numbers are sequential per business');
select results_eq(
  $$ select subtotal_minor, total_minor, net_paid_minor, balance_minor, payment_status
     from public.order_summaries where id = (select order_id from t) $$,
  $$ values (35000::bigint, 32000::bigint, 0::bigint, 32000::bigint, 'unpaid'::text) $$,
  'Total = items − discount + delivery; nothing paid yet');

-- Same idempotency key: the double-tap returns the same order, not a second one.
select results_eq(
  $$ select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[{"description":"Dress","quantity":3,"unit_price_minor":10000}]'::jsonb, '11111111-1111-1111-1111-111111111111') $$,
  $$ select order_id from t $$, 'A repeated submit returns the existing order');

select throws_ok(
  $$ select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[{"description":"Dress","quantity":1,"unit_price_minor":1000}]'::jsonb, gen_random_uuid(), p_discount_minor => 2000) $$,
  'P0001', null, 'A discount larger than the items total is rejected');
select throws_ok(
  $$ select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[]'::jsonb, gen_random_uuid()) $$,
  'P0001', null, 'An order needs at least one item');

-- Deposit, then the rest.
insert into public.payments (business_id, order_id, amount_minor, method)
  select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 10000, 'bank_transfer' from t;
select results_eq($$ select balance_minor, payment_status from public.order_summaries where id = (select order_id from t) $$,
  $$ values (22000::bigint, 'part_paid'::text) $$, 'A deposit leaves the correct balance');
select results_eq($$ select verification::text, recorded_by from public.payments where order_id = (select order_id from t) $$,
  $$ values ('recorded_manually'::text, 'a0000000-0000-0000-0000-000000000001'::uuid) $$,
  'Payments are labelled as recorded manually, with who recorded them');

insert into public.payments (business_id, order_id, amount_minor, method)
  select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 22000, 'cash' from t;
select results_eq($$ select balance_minor, payment_status from public.order_summaries where id = (select order_id from t) $$,
  $$ values (0::bigint, 'paid'::text) $$, 'Paying the rest settles the order');

-- Refunds reduce what was received; they can never exceed it.
insert into public.payments (business_id, order_id, kind, amount_minor, method)
  select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 'refund', 5000, 'bank_transfer' from t;
select results_eq($$ select net_paid_minor, balance_minor, payment_status from public.order_summaries where id = (select order_id from t) $$,
  $$ values (27000::bigint, 5000::bigint, 'part_paid'::text) $$, 'A refund is subtracted from money received');
select throws_ok(
  $$ insert into public.payments (business_id, order_id, kind, amount_minor, method)
     select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 'refund', 27001, 'cash' from t $$,
  'P0001', null, 'A refund larger than the amount received is rejected');

-- Overpayment, then voiding the mistake.
insert into public.payments (business_id, order_id, amount_minor, method, reference)
  select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 10000, 'pos', 'typo' from t;
select results_eq($$ select balance_minor, payment_status from public.order_summaries where id = (select order_id from t) $$,
  $$ values (-5000::bigint, 'overpaid'::text) $$, 'Overpayment shows as a negative balance');
update public.payments set void_reason = 'Entered twice' where reference = 'typo';
select results_eq($$ select balance_minor, payment_status from public.order_summaries where id = (select order_id from t) $$,
  $$ values (5000::bigint, 'part_paid'::text) $$, 'A voided payment no longer counts');
select results_eq($$ select voided_by from public.payments where reference = 'typo' $$,
  array['a0000000-0000-0000-0000-000000000001'::uuid], 'Voiding records who did it');
-- RLS hides already-voided payments from updates, so a second void changes nothing.
update public.payments set void_reason = 'again' where reference = 'typo';
select results_eq($$ select void_reason from public.payments where reference = 'typo' $$,
  array['Entered twice'], 'A voided payment cannot be voided again or re-edited');

-- Fulfilment comes from records: confirm, dispatch (owner approval while money is owed), deliver.
select throws_ok($$ update public.orders set fulfilment_stage = 'dispatched' where id = (select order_id from t) $$,
  '42501', null, 'The stage cannot be typed in; it comes from dispatch records');
select public.confirm_order((select order_id from t));
select throws_like($$ select public.dispatch_order((select order_id from t), (select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'showroom'),
  current_date, 'Test Courier', null, (select jsonb_agg(jsonb_build_object('item', id, 'qty', quantity)) from public.order_items where order_id = (select order_id from t)),
  gen_random_uuid()) $$, '%still owed%', 'Dispatching with money owed needs an owner''s approval');
select public.approve_unpaid_dispatch((select order_id from t), 'Trusted customer, pays on delivery');
select public.dispatch_order((select order_id from t), (select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and kind = 'showroom'),
  current_date, 'Test Courier', null, (select jsonb_agg(jsonb_build_object('item', id, 'qty', quantity)) from public.order_items where order_id = (select order_id from t)),
  gen_random_uuid());
select results_eq($$ select dispatched_at is not null, fulfilment_stage::text from public.orders where id = (select order_id from t) $$,
  $$ values (true, 'dispatched'::text) $$, 'Dispatching everything sets the stage and time');
select throws_ok(
  $$ update public.order_items set quantity = 9 where order_id = (select order_id from t) and description = 'Bag' $$,
  'P0001', null, 'Items cannot change after dispatch');
select public.mark_order_delivered((select order_id from t));
select results_eq($$ select delivered_at is not null from public.orders where id = (select order_id from t) $$,
  array[true], 'Delivery confirmation stamps the delivery time');
select throws_like($$ select public.cancel_order((select order_id from t), 'Too late') $$, 'Some items have already gone out%',
  'A dispatched order cannot be cancelled (record a return instead)');

-- Cancellation keeps the history and turns money received into a refund due.
create temp table t2 (order_id uuid) on commit drop;
grant all on t2 to authenticated;
insert into t2 (order_id) select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  '[{"description":"Agbada","quantity":1,"unit_price_minor":30000}]'::jsonb, gen_random_uuid());
insert into public.payments (business_id, order_id, amount_minor, method) select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 10000, 'cash' from t2;
select public.cancel_order((select order_id from t2), 'Customer changed mind');
select results_eq($$ select amount_due_minor, balance_minor from public.order_summaries where id = (select order_id from t2) $$,
  $$ values (0::bigint, -10000::bigint) $$, 'A cancelled order owes nothing and shows the refund due');
select throws_ok(
  $$ insert into public.payments (business_id, order_id, amount_minor, method)
     select 'aaaaaaaa-0000-0000-0000-000000000000', order_id, 100, 'cash' from t2 $$,
  'P0001', null, 'No new payments on a cancelled order');
select results_eq($$ select count(*)::int from public.order_items where order_id = (select order_id from t2) $$,
  array[1], 'Cancelling keeps the original items');

-- Enquiry → order, exactly once.
insert into public.enquiries (id, business_id, customer_id, stage)
  values ('99999999-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000',
          'cccccccc-0000-0000-0000-00000000000a', 'awaiting_payment');
select lives_ok(
  $$ select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[{"description":"Kaftan","quantity":1,"unit_price_minor":38000}]'::jsonb, gen_random_uuid(),
       p_enquiry_id => '99999999-0000-0000-0000-000000000001') $$,
  'A won enquiry converts into an order');
select results_eq($$ select stage::text from public.enquiries where id = '99999999-0000-0000-0000-000000000001' $$,
  array['won'], 'Converting marks the enquiry as won');
select throws_ok(
  $$ select public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
       '[{"description":"Kaftan","quantity":1,"unit_price_minor":38000}]'::jsonb, gen_random_uuid(),
       p_enquiry_id => '99999999-0000-0000-0000-000000000001') $$,
  '23505', null, 'The same enquiry cannot be converted into a second order');

reset role;

select * from finish();
rollback;
