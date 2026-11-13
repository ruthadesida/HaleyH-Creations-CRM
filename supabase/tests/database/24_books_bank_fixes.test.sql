-- Books Phase C review fixes: reopening a posted line reverses its journal; posting is idempotent and refuses
-- control accounts; clear import errors; reconciled periods are locked; expense VAT limited by the owner's rate.
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
create or replace function tests.line(p_desc text) returns uuid language sql stable security definer as $$
  select id from public.bank_statement_lines where description = p_desc
$$;
grant execute on all functions in schema tests to authenticated;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

select tests.login('a0000000-0000-0000-0000-000000000001');
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', date_trunc('year', current_date)::date, false, null, true, 7.5);
insert into t select 'bank', public.add_bank_account('aaaaaaaa-0000-0000-0000-000000000000', tests.acct('bank_main'), 'Zenith', 'bank');
select public.import_bank_statement((select id from t where k = 'bank'), 's.csv', jsonb_build_array(
  jsonb_build_object('date', current_date::text, 'description', 'SMS charge', 'amount', -500, 'balance', -500),
  jsonb_build_object('date', current_date::text, 'description', 'Account fee', 'amount', -700, 'balance', -1200)), null, gen_random_uuid());

-- Posting a line, repeating the request, reopening it, posting again: counted once.
insert into t select 'j1', public.post_bank_line(tests.line('SMS charge'), tests.acct('bank_charges'), null, 0, '00000000-0000-0000-0000-00000000c001');
select is(public.post_bank_line(tests.line('SMS charge'), tests.acct('bank_charges'), null, 0, '00000000-0000-0000-0000-00000000c001'),
  (select id from t where k = 'j1'), 'Repeating the same request returns the same journal');
select public.reopen_bank_line(tests.line('SMS charge'));
select ok((select reversed_by_id is not null from public.journals where id = (select id from t where k = 'j1')),
  'Reopening a line posted from the bank page reverses that journal');
select is(tests.gl('bank_charges'), 0::bigint, '... so nothing is left in the books');
select public.post_bank_line(tests.line('SMS charge'), tests.acct('bank_charges'), null, 0, gen_random_uuid());
select is(tests.gl('bank_charges'), 500::bigint, 'Posting it again counts it once');

select throws_like($$ select public.post_bank_line(tests.line('Account fee'), tests.acct('receivables'), null, 0, gen_random_uuid()) $$,
  '%kept by the app''s own records%', 'A statement line can''t be posted to receivables (record the payment on the order instead)');
select throws_like($$ select public.import_bank_statement((select id from t where k = 'bank'), 'bad.csv',
    '[{"date": "2026-13-45", "description": "x", "amount": 100}]'::jsonb, null, gen_random_uuid()) $$,
  '%isn''t a real date%', 'A bad date in a statement gets a clear message');

-- Reconcile, then the period is locked.
select throws_like($$ select public.reconcile_bank((select id from t where k = 'bank'), current_date, -1200) $$, '%open statement line%',
  'Open lines must be dealt with before reconciling');
select public.post_bank_line(tests.line('Account fee'), tests.acct('bank_charges'), null, 0, gen_random_uuid());
select lives_ok($$ select public.reconcile_bank((select id from t where k = 'bank'), current_date, -1200) $$, 'Then it reconciles');
select throws_like($$ select public.reopen_bank_line(tests.line('Account fee')) $$, '%reconciled period%',
  'A line in a reconciled period can''t be reopened');
select throws_like($$ select public.reconcile_bank((select id from t where k = 'bank'), current_date + 1, -1200) $$, '%up to today%',
  'You can''t reconcile a date that hasn''t come yet');

-- Expense VAT can't be more than the owner's rate allows.
select throws_like($$ select public.record_expense('aaaaaaaa-0000-0000-0000-000000000000', gen_random_uuid(), current_date, 'Shop', 'Paper',
    tests.acct('packaging'), 1000000, 500000, null, null, gen_random_uuid()) $$, '%more VAT than%',
  'VAT above what 7.5% gives on the amount is refused');

select * from finish();
rollback;
