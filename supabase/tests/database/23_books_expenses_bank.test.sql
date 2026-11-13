-- Books Phase C: expenses (front office submits, owner approves, VAT, paid by a director, paid later, void, receipts)
-- and the bank (accounts, statement import without duplicates, suggestions, auto-match, posting a line, ignore and
-- reopen, reconciliation).
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(29);

grant usage on schema tests to authenticated;
create or replace function tests.acct(p_key text) returns uuid language sql stable security definer as $$
  select id from public.accounts where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = p_key
$$;
create or replace function tests.gl(p_key text) returns bigint language sql stable security definer as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint from public.journal_lines l where l.account_id = tests.acct(p_key)
$$;
create or replace function tests.line(p_desc text) returns uuid language sql stable security definer as $$
  select id from public.bank_statement_lines where description = p_desc
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, false, null, true, 7.5);
insert into t select 'bank', public.add_bank_account('aaaaaaaa-0000-0000-0000-000000000000', tests.acct('bank_main'), 'Zenith', 'bank');
reset role;

-- Expenses -------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select is((select count(*)::int from public.expense_options('aaaaaaaa-0000-0000-0000-000000000000') where option_kind = 'paid_from'), 3,
  'The front office can pay from the bank, or note a director paid personally (two directors)');
select ok((select count(*) > 10 from public.expense_options('aaaaaaaa-0000-0000-0000-000000000000') where option_kind = 'category'),
  '... and choose from the expense categories');
select ok(not exists (select 1 from public.expense_options('aaaaaaaa-0000-0000-0000-000000000000') o
    join public.accounts a on a.id = o.id where o.option_kind = 'category' and a.system_key in ('inv_finished', 'cogs', 'bank_main')),
  'Stock, cost of goods sold and the bank itself aren''t expense categories');
insert into t values ('e1', 'eeeeeeee-0000-0000-0000-000000000001');
select public.record_expense('aaaaaaaa-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000001', current_date, 'Landlord',
  'Shop rent', tests.acct('rent'), 5000000, 0, tests.acct('bank_main'), null, gen_random_uuid());
select is((select status from public.expenses where id = 'eeeeeeee-0000-0000-0000-000000000001'), 'submitted',
  'A front office expense waits for an owner');
select is(tests.gl('rent'), 0::bigint, '... and isn''t in the books yet');
select throws_ok($$ select public.decide_expense('eeeeeeee-0000-0000-0000-000000000001', true, null) $$, '42501', null,
  'The front office can''t approve');
select throws_like($$ select public.record_expense('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), current_date, 'X', 'Y',
    tests.acct('rent'), 1000, 0, null, 'aaaaaaaa-0000-0000-0000-000000000000/nope/receipt.jpg', gen_random_uuid()) $$,
  '%didn''t upload%', 'A receipt that isn''t in storage is refused');
-- A director paid personally, with VAT.
select public.record_expense('aaaaaaaa-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000002', current_date, 'Printer',
  'Labels', tests.acct('packaging'), 5375000, 375000, tests.acct('director_1'), null, gen_random_uuid());
reset role;

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.decide_expense('eeeeeeee-0000-0000-0000-000000000001', true, null);
select public.decide_expense('eeeeeeee-0000-0000-0000-000000000002', true, null);
select is(tests.gl('rent'), 5000000::bigint, 'Approving posts the expense');
select is(tests.gl('bank_main'), -5000000::bigint, '... paid from the bank');
select is(tests.gl('vat_input'), 375000::bigint, 'VAT on an expense is input VAT');
select is(tests.gl('director_1'), -5375000::bigint, 'A director who paid personally is owed it (their current account)');
-- An owner's expense, not paid yet, then paid.
select public.record_expense('aaaaaaaa-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000003', current_date, 'NEPA',
  'Electricity', (select id from public.accounts where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and code = '6050'),
  1000000, 0, null, null, gen_random_uuid());
select is((select status from public.expenses where id = 'eeeeeeee-0000-0000-0000-000000000003'), 'approved', 'An owner''s expense is approved at once');
select is(tests.gl('accruals'), -1000000::bigint, '... and, unpaid, sits in accruals');
select public.pay_expense('eeeeeeee-0000-0000-0000-000000000003', tests.acct('bank_main'), current_date);
select is(tests.gl('accruals'), 0::bigint, 'Paying it clears accruals');
select is(tests.gl('bank_main'), -6000000::bigint, '... from the bank');
select public.void_expense('eeeeeeee-0000-0000-0000-000000000001', 'Entered twice');
select is(tests.gl('rent'), 0::bigint, 'Voiding an expense reverses it');
select is(tests.gl('bank_main'), -1000000::bigint, '... and the bank with it');

-- Bank statement -------------------------------------------------------------
select is((select imported from public.import_bank_statement((select id from t where k = 'bank'), 'zenith.csv', jsonb_build_array(
    jsonb_build_object('date', current_date::text, 'description', 'POS charges', 'amount', -50000, 'balance', -50000),
    jsonb_build_object('date', current_date::text, 'description', 'Electricity', 'amount', -1000000, 'balance', -1050000),
    jsonb_build_object('date', current_date::text, 'description', 'Customer transfer', 'amount', 2000000, 'balance', 950000)),
  '{"date": 0}'::jsonb, gen_random_uuid())), 3, 'A statement imports');
select is((select skipped from public.import_bank_statement((select id from t where k = 'bank'), 'zenith-again.csv', jsonb_build_array(
    jsonb_build_object('date', current_date::text, 'description', 'POS charges', 'amount', -50000, 'balance', -50000),
    jsonb_build_object('date', current_date::text, 'description', 'Electricity', 'amount', -1000000, 'balance', -1050000),
    jsonb_build_object('date', current_date::text, 'description', 'Customer transfer', 'amount', 2000000, 'balance', 950000)),
  null, gen_random_uuid())), 3, 'Importing the same lines again adds nothing');
select is((select count(*)::int from public.bank_line_suggestions(tests.line('Electricity'))), 1,
  'The electricity payment is suggested for its statement line');
select is(public.bank_auto_match((select id from t where k = 'bank')), 1, 'Auto-match matches the one obvious line');
select lives_ok($$ select public.post_bank_line(tests.line('POS charges'), tests.acct('bank_charges'), null, 0, gen_random_uuid()) $$,
  'A bank charge on the statement is posted from the line');
select is(tests.gl('bank_charges'), 50000::bigint, '... to bank charges');
select lives_ok($$ select public.ignore_bank_line(tests.line('Customer transfer'), 'Checking with the customer') $$, 'A line can be set aside with a reason');
select lives_ok($$ select public.reopen_bank_line(tests.line('Customer transfer')) $$, '... and reopened');
select public.post_bank_line(tests.line('Customer transfer'), tests.acct('sales_other'), 'Sale before the app', 0, gen_random_uuid());
select is((select difference_minor from public.bank_reconciliation_status((select id from t where k = 'bank'), current_date)), 0::bigint,
  'With every line dealt with, the books agree with the statement');
select throws_like($$ select public.reconcile_bank((select id from t where k = 'bank'), current_date, 900000) $$, '%don''t agree%',
  'A wrong statement balance can''t be reconciled');
select lives_ok($$ select public.reconcile_bank((select id from t where k = 'bank'), current_date, 950000) $$, 'The right one can');

reset role;
select tests.login('a0000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.import_bank_statement((select id from t where k = 'bank'), 'x.csv',
    '[{"date": "2026-01-01", "description": "x", "amount": 1}]'::jsonb, null, gen_random_uuid()) $$, '42501', null,
  'The front office can''t import statements');

select * from finish();
rollback;
