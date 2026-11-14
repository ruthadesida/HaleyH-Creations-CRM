-- Books Phase E: aged receivables and payables from the ledger. Payments go to the oldest charges first;
-- reversed journals drop out; only owners can see it; totals agree with the ledger.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(15);

grant usage on schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001'); -- owner A
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('month', current_date) - interval '1 year')::date, false, null, false, null);

reset role;
insert into public.orders (id, business_id, customer_id) values
  ('dddddddd-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a'),
  ('dddddddd-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a');
insert into public.suppliers (id, business_id, name) values
  ('ffffffff-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000000', 'Fabric House'),
  ('ffffffff-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000000', 'Thread Co');

-- A journal against an order or supplier, posted the way the app's own posting functions do.
create function tests.post(p_days_ago int, p_dr text, p_cr text, p_amount bigint, p_ref_type text, p_ref uuid) returns uuid
language sql as $$
  select app.post_journal('aaaaaaaa-0000-0000-0000-000000000000', current_date - p_days_ago, 'Test', 'manual', null,
    jsonb_build_array(app.books_line('aaaaaaaa-0000-0000-0000-000000000000', p_dr, p_amount),
                      app.books_line('aaaaaaaa-0000-0000-0000-000000000000', p_cr, -p_amount)),
    gen_random_uuid(), null, null, null, false, null, p_ref_type, p_ref)
$$;

-- Order 1 (fixture order): sold 100,000 150 days ago and 50,000 75 days ago; paid 120,000 40 days ago.
select tests.post(150, 'receivables', 'sales_other', 100000, 'order', 'dddddddd-0000-0000-0000-00000000000a');
select tests.post(75, 'receivables', 'sales_other', 50000, 'order', 'dddddddd-0000-0000-0000-00000000000a');
select tests.post(40, 'bank_main', 'receivables', 120000, 'order', 'dddddddd-0000-0000-0000-00000000000a');
-- Order 2: sold 80,000 ten days ago.
select tests.post(10, 'receivables', 'sales_other', 80000, 'order', 'dddddddd-0000-0000-0000-0000000000a2');
-- Order 3: sold 60,000 twenty days ago, reversed five days ago.
insert into t select 'o3', tests.post(20, 'receivables', 'sales_other', 60000, 'order', 'dddddddd-0000-0000-0000-0000000000a3');
-- An opening balance not linked to any order, 100 days old.
select tests.post(100, 'receivables', 'retained_earnings', 25000, null, null);
-- Supplier: billed 70,000 95 days ago and 30,000 35 days ago, paid 70,000 20 days ago.
select tests.post(95, 'grni', 'payables', 70000, 'supplier', 'ffffffff-0000-0000-0000-0000000000a1');
select tests.post(35, 'grni', 'payables', 30000, 'supplier', 'ffffffff-0000-0000-0000-0000000000a1');
select tests.post(20, 'payables', 'bank_main', 70000, 'supplier', 'ffffffff-0000-0000-0000-0000000000a1');
-- Another supplier paid 40,000 ahead of the bill, five days ago.
select tests.post(5, 'payables', 'bank_main', 40000, 'supplier', 'ffffffff-0000-0000-0000-0000000000a2');
-- An opening deposit held with no order: it isn't netted against the unlinked 25,000 owed.
select tests.post(100, 'bank_main', 'customer_deposits', 15000, null, null);

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.reverse_journal((select id from t where k = 'o3'), current_date - 5, 'Cancelled', gen_random_uuid());

select is((select (total_minor, current_minor, d31_60_minor, d61_90_minor, over_90_minor)::text
    from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date)
    where ref_id = 'dddddddd-0000-0000-0000-00000000000a'),
  '(30000,0,0,30000,0)', 'The payment clears the oldest sale first, so the 30,000 left is from the 75-day-old sale');
select is((select party || ' ' || reference from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date)
    where ref_id = 'dddddddd-0000-0000-0000-00000000000a'),
  'Amaka Test ' || (select order_number from public.orders where id = 'dddddddd-0000-0000-0000-00000000000a'), 'Rows name the customer and the order');
select is((select current_minor from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date)
    where ref_id = 'dddddddd-0000-0000-0000-0000000000a2'), 80000::bigint, 'A ten-day-old sale is current');
select is((select count(*)::int from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date)
    where ref_id = 'dddddddd-0000-0000-0000-0000000000a3'), 0, 'A reversed sale drops out');
select is((select total_minor from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date - 10)
    where ref_id = 'dddddddd-0000-0000-0000-0000000000a3'), 60000::bigint, '... but still shows as at a date before it was reversed');
select is((select over_90_minor from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date)
    where ref_id is null), 25000::bigint, 'Balances not linked to an order are listed in one row');
select is((select sum(total_minor)::bigint from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date)),
  (select closing_minor from public.trial_balance('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('month', current_date) - interval '1 year')::date, current_date)
    where system_key = 'receivables'),
  'The aged receivables add up to the receivables balance in the ledger');
select is((select (total_minor, current_minor, d31_60_minor, over_90_minor)::text
    from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'payables', current_date) where ref_id = 'ffffffff-0000-0000-0000-0000000000a1'),
  '(30000,0,30000,0)', 'Supplier payments clear the oldest bill first');
select is((select party from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'payables', current_date) where ref_id = 'ffffffff-0000-0000-0000-0000000000a1'), 'Fabric House',
  'Payable rows name the supplier');
select is((select total_minor from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'payables', current_date - 30) where ref_id = 'ffffffff-0000-0000-0000-0000000000a1'),
  100000::bigint, 'As at an earlier date, before the payment, both bills are owed');

select is((select (total_minor, current_minor + d31_60_minor + d61_90_minor + over_90_minor)::text
    from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'payables', current_date) where ref_id = 'ffffffff-0000-0000-0000-0000000000a2'),
  '(-40000,0)', 'A supplier paid ahead of the bill is listed as a credit, not dropped');
select is((select sum(total_minor)::bigint from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'payables', current_date)),
  (select -closing_minor from public.trial_balance('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('month', current_date) - interval '1 year')::date, current_date)
    where system_key = 'payables'),
  'The aged payables add up to the payables balance in the ledger');
select is((select count(*)::int from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date) where total_minor < 0), 0,
  'A deposit held with no order isn''t listed as a credit against receivables');

select throws_like($$ select * from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'stock', current_date) $$,
  '%receivables or payables%', 'Only receivables or payables can be aged');

reset role;
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office A
select throws_like($$ select * from public.aged_balances('aaaaaaaa-0000-0000-0000-000000000000', 'receivables', current_date) $$,
  '%Only owners%', 'Staff who aren''t owners can''t see aged balances');

select * from finish();
rollback;
