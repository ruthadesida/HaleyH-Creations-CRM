-- Books Phase B: records post their own journals. Deposits → dispatch revenue with VAT and cost of goods →
-- return → refund; voids; supplier bills and payments; opening stock not posted twice and the stock check;
-- posting problems never block a sale; posting existing records is safe to repeat; closed periods.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(30);

-- Deferred postings run at commit; tests never commit, so run the posting triggers as each statement finishes.
-- (The journal balance check stays deferred: it runs once all of a journal's lines are in.)
set constraints books_post_stock_document, books_post_dispatch, books_post_return, books_post_return_received immediate;

grant usage on schema tests to authenticated;
create or replace function tests.loc(p_name text) returns uuid language sql stable security definer as $$
  select id from public.locations where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and name = p_name
$$;
create or replace function tests.items(p_order uuid, p_qty integer default null) returns jsonb language sql stable security definer as $$
  select jsonb_agg(jsonb_build_object('item', id, 'qty', coalesce(p_qty, quantity - dispatched_quantity))) from public.order_items where order_id = p_order
$$;
-- Balance of an account by its app role in business A (debit positive).
create or replace function tests.gl(p_key text) returns bigint language sql stable security definer as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint from public.journal_lines l
  join public.accounts a on a.id = l.account_id
  where a.business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and a.system_key = p_key
$$;
create or replace function tests.journals_for(p_type text, p_id uuid) returns bigint language sql stable security definer as $$
  select count(*) from public.journals where source_type = p_type and source_id = p_id
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Books kept in the app from the start of this year, VAT 7.5% charged from then (included in prices).
select tests.login('a0000000-0000-0000-0000-000000000001');
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, false, null, true, 7.5);
select public.update_books_settings('aaaaaaaa-0000-0000-0000-000000000000', null, true, 7.5, date_trunc('year', current_date)::date);

-- Opening stock: 5 dresses at ₦6,000 and 10 m of fabric at ₦400.
update public.businesses set cutover_date = current_date - 5 where id = 'aaaaaaaa-0000-0000-0000-000000000000';
insert into public.products (business_id, name, category) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Wrap dress', 'clothing');
insert into public.product_variants (business_id, product_id, size, sku)
  select 'aaaaaaaa-0000-0000-0000-000000000000', id, 'M', 'DRESS-M' from public.products where name = 'Wrap dress';
insert into t select 'variant', id from public.product_variants where sku = 'DRESS-M';
select public.post_opening_batch(public.save_opening_batch('aaaaaaaa-0000-0000-0000-000000000000', 'o.csv', null, jsonb_build_array(
  jsonb_build_object('line', 2, 'code', 'DRESS-M', 'location_id', tests.loc('Finished goods / showroom'), 'quantity', 5, 'unit', 'pc', 'unit_cost', '600000'),
  jsonb_build_object('line', 3, 'code', 'FAB', 'name', 'Ankara', 'kind', 'raw_material', 'base_unit', 'm',
    'location_id', tests.loc('Raw material store'), 'quantity', 10, 'unit', 'm', 'unit_cost', '40000'))), gen_random_uuid());
select is((select count(*)::int from public.journals where source_type = 'stock_document'), 0,
  'Opening stock isn''t posted again (it''s in the opening figures)');

-- Sale: 3 dresses at ₦15,000, paid in two deposits, then dispatched.
reset role;
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
insert into t select 'o1', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Wrap dress M', 'variant_id', (select id from t where k = 'variant'),
    'product_id', (select id from public.products where name = 'Wrap dress'),
    'quantity', 3, 'unit_price_minor', 1500000, 'item_type', 'ready_made')), gen_random_uuid());
select public.confirm_order((select id from t where k = 'o1'));
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 2000000, 'bank_transfer');
insert into public.payments (business_id, order_id, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 2500000, 'cash');
reset role;
select is(tests.gl('customer_deposits'), -4500000::bigint, 'Money paid before dispatch is held as customer deposits');
select is(tests.gl('bank_main'), 2000000::bigint, 'A bank transfer lands in the bank account');
select is(tests.gl('cash'), 2500000::bigint, '... and cash in cash in hand');

select tests.login('a0000000-0000-0000-0000-000000000002');
insert into t select 'd1', public.dispatch_order((select id from t where k = 'o1'), tests.loc('Finished goods / showroom'), current_date,
  null, null, tests.items((select id from t where k = 'o1')), gen_random_uuid());
reset role;
select is(tests.gl('sales_clothing'), -4186047::bigint, 'Dispatch recognises the sale (clothing), net of VAT');
select is(tests.gl('vat_output'), -313953::bigint, '... VAT at 7.5% split out of the price');
select is(tests.gl('customer_deposits'), 0::bigint, '... the deposits are used up');
select is(tests.gl('receivables'), 0::bigint, '... nothing is left owed');
select is(tests.gl('cogs'), 1800000::bigint, 'Cost of goods sold is the dresses'' cost from the stock records');
select is(tests.gl('inv_finished'), -1800000::bigint, '... taken out of finished goods');

-- One dress comes back, then the money is refunded.
select tests.login('a0000000-0000-0000-0000-000000000002');
insert into t select 'r1', public.receive_customer_return((select id from t where k = 'o1'), 'return', 'Too small', current_date,
  jsonb_build_array(jsonb_build_object('item', (select id from public.order_items where order_id = (select id from t where k = 'o1')), 'qty', 1)),
  gen_random_uuid());
reset role;
select is(tests.gl('sales_returns'), 1395349::bigint, 'A return reverses the sale for that item, net of VAT');
select is(tests.gl('customer_deposits'), -1500000::bigint, '... and the customer is owed the money back');
select is(tests.gl('inv_quarantine'), 600000::bigint, '... the dress goes into Quarantine at its cost');
select tests.login('a0000000-0000-0000-0000-000000000001');
insert into public.payments (business_id, order_id, kind, amount_minor, method) values
  ('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o1'), 'refund', 1500000, 'bank_transfer');
reset role;
select is(tests.gl('customer_deposits'), 0::bigint, 'The refund settles what the customer was owed');
select is(tests.gl('bank_main'), 500000::bigint, '... paid from the bank');

-- A voided payment is cancelled in the books.
select tests.login('a0000000-0000-0000-0000-000000000001');
insert into t select 'o2', public.create_order('aaaaaaaa-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-00000000000a',
  jsonb_build_array(jsonb_build_object('description', 'Alteration', 'quantity', 1, 'unit_price_minor', 300000, 'item_type', 'made_to_order')), gen_random_uuid());
insert into public.payments (id, business_id, order_id, amount_minor, method) values
  ('dddddddd-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o2'), 100000, 'cash');
update public.payments set void_reason = 'Entered twice'
  where id = 'dddddddd-0000-0000-0000-0000000000b1';
reset role;
select is(tests.journals_for('payment', 'dddddddd-0000-0000-0000-0000000000b1'), 2::bigint, 'A voided payment is reversed, not deleted');
select is(tests.gl('cash'), 2500000::bigint, '... and cash is back where it was');

-- Owners can't hand-reverse an automatic journal.
select tests.login('a0000000-0000-0000-0000-000000000001');
select throws_like($$ select public.reverse_journal((select id from public.journals where source_type = 'order_dispatch' limit 1),
    current_date, 'test', gen_random_uuid()) $$, '%Correct that record instead%', 'Automatic journals are corrected at their record');

-- Supplier bill and part payment.
insert into public.suppliers (business_id, name) values ('aaaaaaaa-0000-0000-0000-000000000000', 'Fabric House');
insert into t select 'bill', public.record_supplier_bill('aaaaaaaa-0000-0000-0000-000000000000',
  (select id from public.suppliers where name = 'Fabric House'), null, null, 'INV-1', current_date, 900000, null);
select public.record_supplier_payment('aaaaaaaa-0000-0000-0000-000000000000', (select id from public.suppliers where name = 'Fabric House'),
  null, current_date, 400000, 'bank_transfer', null);
reset role;
select is(tests.gl('payables'), -500000::bigint, 'A supplier bill less a payment leaves the balance owed');
select is(tests.gl('grni'), 900000::bigint, '... the bill clears goods received not invoiced');

-- Posting existing records: picks up what was recorded before the books were set up, and is safe to repeat.
select tests.login('a0000000-0000-0000-0000-000000000001');
select ok((select posted from public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000')) >= 1,
  'Posting existing records brings in earlier records (the fixture order''s payment)');
select is((select posted from public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000')), 0, '... and doing it again posts nothing twice');
select is((select sum(debit_minor - credit_minor)::bigint from public.journal_lines where business_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'Everything posted balances');

-- The stock check: opening stock wasn't posted, so the books show less than the stock records until matched.
select ok((select difference_minor <> 0 from public.books_checks('aaaaaaaa-0000-0000-0000-000000000000', current_date) where check_key = 'stock:inv_finished'),
  'The stock check shows the difference');
select lives_ok($$ select public.books_match_stock('aaaaaaaa-0000-0000-0000-000000000000', current_date, gen_random_uuid()) $$,
  'An owner brings the books into line with the stock records');
select is((select sum(abs(difference_minor))::bigint from public.books_checks('aaaaaaaa-0000-0000-0000-000000000000', current_date) where check_key like 'stock:%'),
  0::bigint, '... and every stock account matches');

-- A posting problem never stops a sale: it's recorded, then posted once fixed.
reset role;
update public.accounts set archived_at = now() where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = 'clearing';
select tests.login('a0000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into public.payments (id, business_id, order_id, amount_minor, method) values
  ('dddddddd-0000-0000-0000-0000000000b2', 'aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'o2'), 50000, 'pos') $$,
  'A POS payment is saved even though its account is missing');
reset role;
select is((select count(*)::int from public.books_posting_problems where source_id = 'dddddddd-0000-0000-0000-0000000000b2'), 1,
  '... and the problem is recorded for the owner');
update public.accounts set archived_at = null where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = 'clearing';
select tests.login('a0000000-0000-0000-0000-000000000001');
select public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000');
reset role;
select is(tests.journals_for('payment', 'dddddddd-0000-0000-0000-0000000000b2'), 1::bigint, 'Once fixed, posting existing records posts it');

-- Who can run it.
select tests.login('a0000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.books_post_existing('aaaaaaaa-0000-0000-0000-000000000000') $$, '42501', null,
  'The front office can''t run posting or see the checks');

select * from finish();
rollback;
