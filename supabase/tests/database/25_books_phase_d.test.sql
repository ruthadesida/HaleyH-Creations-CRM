-- Books Phase D: VAT summary and return, tax payment, payroll and its void, fixed asset purchase, depreciation and
-- disposal, loan and repayment, director money and share capital, who may do it.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(33);

grant usage on schema tests to authenticated;
create or replace function tests.acct(p_key text) returns uuid language sql stable security definer as $$
  select id from public.accounts where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = p_key
$$;
create or replace function tests.gl(p_key text) returns bigint language sql stable security definer as $$
  select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint from public.journal_lines l where l.account_id = tests.acct(p_key)
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, false, null, true, 7.5);
select public.add_bank_account('aaaaaaaa-0000-0000-0000-000000000000', tests.acct('bank_main'), 'Zenith', 'bank');

-- VAT ------------------------------------------------------------------------
select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, 'Sale with VAT', 'manual', null,
  jsonb_build_array(jsonb_build_object('account_id', tests.acct('bank_main'), 'debit', 107500, 'credit', 0),
    jsonb_build_object('account_id', tests.acct('sales_other'), 'debit', 0, 'credit', 100000),
    jsonb_build_object('account_id', tests.acct('vat_output'), 'debit', 0, 'credit', 7500)), gen_random_uuid());
select public.record_expense('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), date_trunc('year', current_date)::date, 'Shop', 'Paper',
  tests.acct('packaging'), 5375, 375, tests.acct('bank_main'), null, gen_random_uuid());
select results_eq($$ select output_minor, input_minor, net_minor from public.vat_summary('aaaaaaaa-0000-0000-0000-000000000000',
    date_trunc('year', current_date)::date, current_date - 1) $$,
  $$ values (7500::bigint, 375::bigint, 7125::bigint) $$, 'The VAT summary shows output, input and the net to pay');
select is((select count(*)::int from public.vat_documents('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, current_date - 1)), 2,
  '... with the documents behind it');
insert into t select 'vat', public.record_vat_return('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, current_date - 1,
  tests.acct('bank_main'), current_date - 1, 'FIRS ref 1', gen_random_uuid());
select is(tests.gl('vat_output'), 0::bigint, 'Recording the return clears output VAT');
select is(tests.gl('vat_input'), 0::bigint, '... against input VAT');
select is(tests.gl('bank_main'), 107500 - 5375 - 7125::bigint, '... and the net is paid from the bank');
select throws_like($$ select public.record_vat_return('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, current_date - 1,
    tests.acct('bank_main'), current_date - 1, null, gen_random_uuid()) $$, '%already covers%', 'A period can''t be returned twice');
select lives_ok($$ select public.void_books_record('vat_return', (select id from t where k = 'vat'), 'Wrong period') $$, 'A VAT return can be voided');
select is(tests.gl('vat_output'), -7500::bigint, '... putting the VAT back');

-- Tax payment ----------------------------------------------------------------
select public.pay_tax('aaaaaaaa-0000-0000-0000-000000000000', 'wht', 1000, tests.acct('bank_main'), current_date, 'LIRS', gen_random_uuid());
select is(tests.gl('wht'), 1000::bigint, 'Paying withholding tax reduces what''s owed');

-- Payroll --------------------------------------------------------------------
insert into t select 'ada', public.save_payroll_person('aaaaaaaa-0000-0000-0000-000000000000', null, 'Ada', 'employee', 'Tailor', false);
insert into t select 'bisi', public.save_payroll_person('aaaaaaaa-0000-0000-0000-000000000000', null, 'Bisi', 'contractor', null, false);
insert into t select 'run', public.post_payroll_run('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('month', current_date)::date, current_date,
  tests.acct('bank_main'), jsonb_build_array(
    jsonb_build_object('person_id', (select id from t where k = 'ada'), 'gross', 100000, 'paye', 5000, 'pension_employee', 8000, 'pension_employer', 10000),
    jsonb_build_object('person_id', (select id from t where k = 'bisi'), 'gross', 50000, 'wht', 2000)), gen_random_uuid());
select is(tests.gl('salaries'), 100000::bigint, 'Employees'' gross pay is salaries');
select is(tests.gl('contract_pay'), 50000::bigint, 'Contractors'' gross pay is contract pay');
select is(tests.gl('pension_expense'), 10000::bigint, 'The employer''s pension is a cost');
select is(tests.gl('paye'), -5000::bigint, 'PAYE deducted is owed to LIRS');
select is(tests.gl('pension'), -18000::bigint, 'Employee and employer pension is owed to the fund');
select is(tests.gl('wht'), -1000::bigint, 'Withholding tax on the contractor is owed (less what was paid)');
select is((select sum(net_minor)::bigint from public.payroll_lines where run_id = (select id from t where k = 'run')), 135000::bigint,
  'Net pay is gross less the deductions');
select throws_like($$ select public.post_payroll_run('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('month', current_date) - interval '1 month')::date, current_date,
    tests.acct('bank_main'), jsonb_build_array(jsonb_build_object('person_id', (select id from t where k = 'ada'), 'gross', 1000, 'paye', 2000)),
    gen_random_uuid()) $$, '%deductions less than gross%', 'Deductions can''t exceed gross pay');
select public.void_books_record('payroll_run', (select id from t where k = 'run'), 'Wrong month');
select is(tests.gl('salaries'), 0::bigint, 'Voiding a pay run reverses it');

-- Fixed assets ---------------------------------------------------------------
insert into t select 'fa', public.add_fixed_asset('aaaaaaaa-0000-0000-0000-000000000000', 'Generator', 'ppe_equipment', 365000, 0, 1,
  current_date - 9, tests.acct('bank_main'), 0, null, gen_random_uuid());
select is(tests.gl('ppe_equipment'), 365000::bigint, 'Buying an asset puts its cost in the register account');
select is((select total_minor from public.run_depreciation('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, gen_random_uuid())), 9000::bigint,
  'Depreciation: 9 days of a 1-year life');
select is(tests.gl('ppe_equipment_dep'), -9000::bigint, '... into accumulated depreciation');
select is((select total_minor from public.run_depreciation('aaaaaaaa-0000-0000-0000-000000000000', current_date - 1, gen_random_uuid())), 0::bigint,
  'Running it again for the same date adds nothing');
select public.dispose_fixed_asset((select id from t where k = 'fa'), current_date, 300000, tests.acct('bank_main'), 'Sold');
select is(tests.gl('ppe_equipment'), 0::bigint, 'Selling it clears the cost');
select is(tests.gl('ppe_equipment_dep'), 0::bigint, '... and its depreciation (one more day first)');
select is(tests.gl('other_income'), 55000::bigint, '... with the loss (₦3,550 book value, ₦3,000 received) in other income');
-- An asset already in the books joins the register without posting.
select public.add_fixed_asset('aaaaaaaa-0000-0000-0000-000000000000', 'Sewing machine', 'ppe_machinery', 50000000, 0, 4,
  date_trunc('year', current_date)::date - 200, null, 6849315, date_trunc('year', current_date)::date - 1, gen_random_uuid());
select is(tests.gl('ppe_machinery'), 0::bigint, 'An asset already in the books isn''t posted again');

-- Loans and directors --------------------------------------------------------
insert into t select 'loan', public.add_loan('aaaaaaaa-0000-0000-0000-000000000000', 'Cousin', 'short', 500000, current_date, tests.acct('bank_main'), 'No interest', gen_random_uuid());
select public.record_loan_repayment((select id from t where k = 'loan'), current_date, 200000, 10000, tests.acct('bank_main'), gen_random_uuid());
select is(tests.gl('loans_short'), -300000::bigint, 'A loan less repayments is what''s still owed');
select is(tests.gl('interest'), 10000::bigint, '... interest is a finance cost');
select throws_like($$ select public.record_loan_repayment((select id from t where k = 'loan'), current_date, 400000, 0, tests.acct('bank_main'), gen_random_uuid()) $$,
  '%more than%still owed%', 'You can''t repay more than is owed');
select public.record_equity_movement('aaaaaaaa-0000-0000-0000-000000000000', 'director_in', 'director_1', 50000, current_date, tests.acct('bank_main'), 'Float', gen_random_uuid());
select public.record_equity_movement('aaaaaaaa-0000-0000-0000-000000000000', 'share_capital', null, 100000, current_date, tests.acct('bank_main'), null, gen_random_uuid());
select is(tests.gl('director_1'), -50000::bigint, 'Money a director puts in is owed to them');
select is(tests.gl('share_capital'), -100000::bigint, 'Share capital paid in');
select is((select sum(debit_minor - credit_minor)::bigint from public.journal_lines where business_id = 'aaaaaaaa-0000-0000-0000-000000000000'), 0::bigint,
  'Everything balances');

reset role;
select tests.login('a0000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.pay_tax('aaaaaaaa-0000-0000-0000-000000000000', 'paye', 100, tests.acct('bank_main'), current_date, null, gen_random_uuid()) $$,
  '42501', null, 'The front office can''t record tax, payroll or the rest');

select * from finish();
rollback;
