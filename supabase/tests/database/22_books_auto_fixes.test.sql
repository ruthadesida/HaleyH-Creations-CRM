-- Books Phase B review fixes: discounts across partial dispatches, returns of custom (non-stock) items,
-- voiding a payment after dispatch, batched posting of existing records, payment account limits.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(13);

\set flush 'set constraints books_post_stock_document, books_post_dispatch, books_post_return immediate; set constraints books_post_stock_document, books_post_dispatch, books_post_return deferred;'

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
create or replace function tests.items(p_order uuid, p_qty integer default null) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('item', id, 'qty', coalesce(p_qty, quantity - dispatched_quantity))) from public.order_items where order_id = p_order
$$;
create or replace function tests.gl(p_key text) returns bigint language sql stable security definer as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint from public.journal_lines l
  join public.accounts a on a.id = l.account_id
  where a.business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and a.system_key = p_key
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, false, null, false, null);

-- Three custom kaftans at ₦100 each with a 100 kobo discount, paid, then dispatched one at a time.
insert into t select 'o1', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Custom kaftan', 'quantity', 3, 'unit_price_minor', 10000, 'item_type', 'ready_made')),
  gen_random_uuid(), p_discount_minor => 100);
select public.confirm_order((select id from t where k = 'o1'));
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 29900, 'cash');
select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date, null, null,
  tests.items((select id from t where k = 'o1'), 1), gen_random_uuid());
:flush
select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date, null, null,
  tests.items((select id from t where k = 'o1'), 1), gen_random_uuid());
:flush
select public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date, null, null,
  tests.items((select id from t where k = 'o1'), 1), gen_random_uuid());
:flush
select is(tests.gl('discounts'), 100::bigint, 'Partial dispatches share the discount exactly: 100 kobo in total, none lost');
select is(tests.gl('sales_other'), -30000::bigint, 'Custom items are sales: other');
select is(tests.gl('customer_deposits') + tests.gl('receivables'), 0::bigint, 'Paid in full and all dispatched: nothing held or owed');

-- One kaftan comes back. It has no stock record, but the sale is still reversed.
insert into t select 'r1', public.receive_customer_return((select id from t where k = 'o1'), 'return', 'Wrong size', current_date,
  jsonb_build_array(jsonb_build_object('item', (select id from public.order_items where order_id = (select id from t where k = 'o1')), 'qty', 1)),
  gen_random_uuid());
:flush
select is(tests.gl('sales_returns'), 9967::bigint, 'A return of a custom item reverses its sale less its share of the discount');
select is(tests.gl('customer_deposits'), -9967::bigint, '... and the customer is owed that back');

-- A payment voided after dispatch: the customer now owes the money (receivable), deposits aren't negative.
insert into t select 'o2', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Custom wrap', 'quantity', 1, 'unit_price_minor', 5000, 'item_type', 'ready_made')), gen_random_uuid());
select public.confirm_order((select id from t where k = 'o2'));
insert into public.payments (id, business_id, order_id, amount_minor, method) values
  ('dddddddd-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o2'), 5000, 'bank_transfer');
select public.dispatch_order((select id from t where k = 'o2'), tests.loc('Finished goods / showroom'), current_date, null, null,
  tests.items((select id from t where k = 'o2')), gen_random_uuid());
:flush
update public.payments set void_reason = 'Bounced' where id = 'dddddddd-0000-0000-0000-0000000000c1';
select is(tests.gl('receivables'), 5000::bigint, 'Voiding a payment after dispatch leaves the money owed as a receivable');
select is(tests.gl('customer_deposits'), -9967::bigint, '... without making deposits negative');
select is((select sum(debit_minor - credit_minor)::bigint from public.journal_lines where business_id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  0::bigint, 'Everything posted balances');

-- Posting existing records in batches carries on where it stopped and ends with nothing left.
-- (First bring in the fixtures' earlier records, so the checks below start from "all posted".)
select public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000', p_limit => 1000);
select ok((select next_id is not null from public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000', p_limit => 1)),
  'A batch says where to carry on');
select is((select posted from public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000', p_limit => 1000)), 0,
  'Running it all again posts nothing twice');
select ok((select next_id is null from public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000', p_limit => 1000)),
  '... and the last batch says it''s done');

-- Payments can only land in cash, bank or clearing accounts.
select throws_like($$ select public.set_books_payment_account('aaaaaaaa-0000-0000-0000-000000000000', 'cash',
    (select id from public.accounts where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = 'inv_finished')) $$,
  '%bank, cash or clearing%', 'A payment method can''t point at a stock account');
select lives_ok($$ select public.set_books_payment_account('aaaaaaaa-0000-0000-0000-000000000000', 'pos',
    (select id from public.accounts where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = 'bank_main')) $$,
  '... but can point at the bank');

select * from finish();
rollback;
