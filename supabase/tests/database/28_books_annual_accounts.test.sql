-- Books Phase F: annual accounts text, directors' approval, accountant sign-off (only for a closed year, locks the
-- accounts, lapses when the year is reopened), account movements for the notes, owners only.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(20);

create temp table t (k text primary key, id uuid, d date);
grant all on t to authenticated;
insert into t (k, d) values ('start', (date_trunc('year', current_date) - interval '1 year')::date);

select tests.login('a0000000-0000-0000-0000-000000000001'); -- owner A
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', (select d from t where k = 'start'), false, null, false, null);
insert into t (k, id) select 'year', id from public.fiscal_years
  where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and start_date = (select d from t where k = 'start');

-- One sale last year: 500,000 into the bank.
reset role;
select app.post_journal('aaaaaaaa-0000-0000-0000-000000000000', (select d from t where k = 'start') + 40, 'Sale', 'manual', null,
  jsonb_build_array(app.books_line('aaaaaaaa-0000-0000-0000-000000000000', 'bank_main', 500000),
                    app.books_line('aaaaaaaa-0000-0000-0000-000000000000', 'sales_other', -500000)),
  gen_random_uuid());
-- A mistaken 100,000 entry, reversed within the year: it drops out of the movements.
insert into t (k, id) select 'mistake', app.post_journal('aaaaaaaa-0000-0000-0000-000000000000', (select d from t where k = 'start') + 50, 'Mistake', 'manual', null,
  jsonb_build_array(app.books_line('aaaaaaaa-0000-0000-0000-000000000000', 'bank_main', 100000),
                    app.books_line('aaaaaaaa-0000-0000-0000-000000000000', 'sales_other', -100000)),
  gen_random_uuid());

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.reverse_journal((select id from t where k = 'mistake'), (select d from t where k = 'start') + 60, 'Posted by mistake', gen_random_uuid());
select lives_ok($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"company_name": "Business A Ltd", "rc_number": "RC 123", "policies": "Revenue on delivery."}'::jsonb) $$,
  'An owner saves the company details and policies');
select is((select company_name || ' / ' || policies from public.annual_accounts where fiscal_year_id = (select id from t where k = 'year')),
  'Business A Ltd / Revenue on delivery.', 'They are kept');
select lives_ok($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"going_concern": "Trading continues."}'::jsonb) $$, 'Saving one field ...');
select is((select company_name from public.annual_accounts where fiscal_year_id = (select id from t where k = 'year')), 'Business A Ltd',
  '... leaves the others as they were');
select throws_like($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"profit": "lots"}'::jsonb) $$, '%Unknown field%', 'Unknown fields are refused');
select throws_like($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    jsonb_build_object('approved_on', (select d from t where k = 'start') + 100)) $$, '%after the year end%',
  'The directors can''t approve the accounts before the year has ended');
select throws_like($ select public.sign_off_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    'A. Accountant', 'ICAN', current_date, null) $, '%Close the year%', 'Accounts for an open year can''t be signed off');
select throws_like($ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    jsonb_build_object('approved_on', current_date, 'approved_by', 'Director One')) $, '%once the year is closed%',
  'The directors can''t approve the accounts while the year is open');

select public.close_fiscal_year('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'), gen_random_uuid());
select throws_like($$ select public.sign_off_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    'A. Accountant', 'ICAN', current_date, null) $$, '%directors'' approval%', 'The directors approve before an accountant signs off');
select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
  jsonb_build_object('approved_on', current_date, 'approved_by', 'Director One, Director Two'));
select throws_like($ select public.sign_off_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    'A. Accountant', 'ICAN member', current_date - 1, null) $, '%before the directors approved%', 'The review can''t be dated before the approval');
select lives_ok($ select public.sign_off_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    'A. Accountant', 'ICAN member', current_date, 'Reviewed, not audited') $, 'Then the accountant''s review is recorded');
select throws_like($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"policies": "Changed"}'::jsonb) $$, '%signed off%', 'Signed-off accounts can''t be changed');
select public.withdraw_annual_accounts_sign_off('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'));
select lives_ok($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"policies": "Changed"}'::jsonb) $$, 'After withdrawing the sign-off they can');

-- Reopening the year makes a sign-off lapse.
select public.sign_off_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'), 'A. Accountant', 'ICAN', current_date, null);
select public.reopen_fiscal_year('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'), 'A correction', gen_random_uuid());
select lives_ok($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"events_after": "None"}'::jsonb) $$, 'Once the year is reopened the sign-off no longer stands, so the accounts can change');
select is((select signed_off_name from public.annual_accounts where fiscal_year_id = (select id from t where k = 'year')), null,
  '... and the old sign-off is cleared');
reset role;
select is(app.annual_accounts_approved((select id from t where k = 'year')), false, 'The directors'' approval lapses with the reopen too');
select tests.login('a0000000-0000-0000-0000-000000000001');

select is((select (m.debit_minor, m.credit_minor, m.closing_minor)::text from public.account_movements('aaaaaaaa-0000-0000-0000-000000000000',
    (select d from t where k = 'start'), ((select d from t where k = 'start') + interval '1 year')::date - 1) m
    join public.accounts a on a.id = m.account_id where a.system_key = 'bank_main'),
  '(500000,0,500000)', 'Account movements give debits and credits for the notes');

reset role;
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office A
select throws_like($$ select public.save_annual_accounts('aaaaaaaa-0000-0000-0000-000000000000', (select id from t where k = 'year'),
    '{"policies": "x"}'::jsonb) $$, '%Only owners%', 'Staff who aren''t owners can''t write the accounts');
select is((select count(*)::int from public.annual_accounts), 0, '... or read them');

reset role;
select tests.login('b0000000-0000-0000-0000-000000000001'); -- owner B
select is((select count(*)::int from public.annual_accounts), 0, 'Another business can''t see them');

select * from finish();
rollback;
