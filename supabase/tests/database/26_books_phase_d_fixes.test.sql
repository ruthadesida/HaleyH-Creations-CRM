-- Books Phase D review fixes: records before the first live year refused (or register-only), pay runs can't pay
-- someone twice in a month or pay a removed person, an asset added by mistake can be removed.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(11);

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

-- Last year imported; this year kept in the app.
select tests.login('a0000000-0000-0000-0000-000000000001');
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('year', current_date) - interval '1 year')::date, true, null, false, null);
select public.add_bank_account('aaaaaaaa-0000-0000-0000-000000000000', tests.acct('bank_main'), 'Zenith', 'bank');

select throws_like($$ select public.pay_tax('aaaaaaaa-0000-0000-0000-000000000000', 'paye', 1000, tests.acct('bank_main'),
    date_trunc('year', current_date)::date - 10, null, gen_random_uuid()) $$, '%before the books'' first live year%',
  'A tax payment dated in the imported year is refused, not saved without a journal');
select throws_like($$ select public.add_fixed_asset('aaaaaaaa-0000-0000-0000-000000000000', 'Old machine', 'ppe_machinery', 100000, 0, 4,
    date_trunc('year', current_date)::date - 100, tests.acct('bank_main'), 0, null, gen_random_uuid()) $$, '%already in the books%',
  'An asset bought in the imported year must be added as already in the books');
select throws_like($$ select public.add_fixed_asset('aaaaaaaa-0000-0000-0000-000000000000', 'Old machine', 'ppe_machinery', 100000, 0, 4,
    date_trunc('year', current_date)::date - 100, null, 5000, null, gen_random_uuid()) $$, '%up to what date%',
  '... with the date its depreciation is counted to');
select throws_like($$ select public.run_depreciation('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date - 1, gen_random_uuid()) $$,
  '%before the books'' first live year%', 'Depreciation can''t be run into the imported year');
select throws_like($$ select public.add_loan('aaaaaaaa-0000-0000-0000-000000000000', 'Uncle', 'short', 100000, date_trunc('year', current_date)::date - 30,
    tests.acct('bank_main'), null, gen_random_uuid()) $$, '%leave "Received into" blank%',
  'A loan from the imported year can''t be posted again');
select lives_ok($$ select public.add_loan('aaaaaaaa-0000-0000-0000-000000000000', 'Uncle', 'short', 100000, date_trunc('year', current_date)::date - 30,
    null, null, gen_random_uuid()) $$, '... but joins the list without posting');
select is(tests.gl('loans_short'), 0::bigint, '... and nothing is posted');

-- Pay runs.
insert into t select 'ada', public.save_payroll_person('aaaaaaaa-0000-0000-0000-000000000000', null, 'Ada', 'employee', null, false);
insert into t select 'gone', public.save_payroll_person('aaaaaaaa-0000-0000-0000-000000000000', null, 'Gone', 'employee', null, false);
select public.save_payroll_person('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'gone'), 'Gone', 'employee', null, true);
select public.post_payroll_run('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('month', current_date)::date, current_date, tests.acct('bank_main'),
  jsonb_build_array(jsonb_build_object('person_id', (select id from t where k = 'ada'), 'gross', 100000)), gen_random_uuid());
select throws_like($$ select public.post_payroll_run('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('month', current_date)::date, current_date,
    tests.acct('bank_main'), jsonb_build_array(jsonb_build_object('person_id', (select id from t where k = 'ada'), 'gross', 100000)), gen_random_uuid()) $$,
  '%already paid for this month%', 'Nobody is paid twice for the same month');
select throws_like($$ select public.post_payroll_run('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('month', current_date) - interval '1 month')::date,
    current_date, tests.acct('bank_main'), jsonb_build_array(jsonb_build_object('person_id', (select id from t where k = 'gone'), 'gross', 100000)), gen_random_uuid()) $$,
  '%current staff list%', 'Someone removed from the staff list can''t be paid');

-- An asset added by mistake.
insert into t select 'fa', public.add_fixed_asset('aaaaaaaa-0000-0000-0000-000000000000', 'Typo', 'ppe_computers', 50000, 0, 3, current_date,
  tests.acct('bank_main'), 0, null, gen_random_uuid());
select public.void_books_record('fixed_asset', (select id from t where k = 'fa'), 'Added by mistake');
select is(tests.gl('ppe_computers'), 0::bigint, 'An asset added by mistake can be removed: its purchase is reversed');
select is((select status from public.fixed_assets where id = (select id from t where k = 'fa')), 'removed', '... and it stays in the register, marked removed');

select * from finish();
rollback;
