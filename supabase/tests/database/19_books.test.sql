-- Bookkeeping core: setup, balancing, imported year and opening adjustments, reversals, locks, year close, isolation.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(34);

\set A '\'aaaaaaaa-0000-0000-0000-000000000000\''
\set B '\'bbbbbbbb-0000-0000-0000-000000000000\''

-- Helpers: an account id by its system key in business A, and one journal line.
create function pg_temp.acct(p_key text) returns uuid language sql stable as $$
  select id from public.accounts where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and system_key = p_key
$$;
create function pg_temp.ln(p_key text, p_dr bigint, p_cr bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('account_id', pg_temp.acct(p_key), 'debit', p_dr, 'credit', p_cr)
$$;
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;

-- Setup ----------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office
select throws_ok($$ select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', '2025-01-01', true, '2025-05-21', true, 7.5) $$,
  '42501', null, 'The front office can''t set up the books');

select tests.login('a0000000-0000-0000-0000-000000000001'); -- owner A
select lives_ok($$ select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', '2025-01-01', true, '2025-05-21', true, 7.5) $$,
  'An owner sets up the books with an imported first year');
select throws_like($$ select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', '2025-01-01', true, null, false, null) $$,
  '%already set up%', '... only once');
select results_eq($$ select kind from public.fiscal_years where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' order by start_date limit 2 $$,
  array['imported', 'live']::text[], 'FY2025 is imported; FY2026 is kept live');
select ok((select count(*) > 60 from public.accounts where business_id = :A), 'The chart of accounts is seeded');
select is((select vat_rate from public.books_settings where business_id = :A), 7.50::numeric(5,2), 'The VAT rate is the one the owner entered');
select is((select contra_of from public.accounts where business_id = :A and system_key = 'ppe_machinery_dep'), pg_temp.acct('ppe_machinery'),
  'Accumulated depreciation is paired with its asset');

-- Balancing and validation ---------------------------------------------------
select throws_like($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-12-31', 'Bad', 'opening_import', null,
    jsonb_build_array(pg_temp.ln('bank_main', 1000, 0), pg_temp.ln('sales_clothing', 0, 900)), gen_random_uuid()) $$,
  '%don''t match%', 'An unbalanced journal is refused');
select throws_like($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-12-31', 'Bad', 'manual', null,
    jsonb_build_array(pg_temp.ln('bank_main', 1000, 0)), gen_random_uuid()) $$,
  '%at least two lines%', 'A one-line journal is refused');
select throws_like($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-12-31', 'Bad', 'manual', null,
    jsonb_build_array(pg_temp.ln('bank_main', 1000, 1000), pg_temp.ln('sales_clothing', 0, 0)), gen_random_uuid()) $$,
  '%either a debit or a credit%', 'A line with both (or neither) sides is refused');
select throws_like($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2026-02-01', 'Wrong year', 'opening_import', null,
    jsonb_build_array(pg_temp.ln('bank_main', 1000, 0), pg_temp.ln('sales_clothing', 0, 1000)), gen_random_uuid()) $$,
  '%imported year%', 'Imported figures can''t go into a live year');

-- The FY2025 import: bank 10,000; materials 30,000; rent 15,000; sales 50,000; share capital 5,000.
insert into t select 'import', public.post_manual_journal(:A, '2025-12-31', 'FY2025 trial balance (draft)', 'opening_import', null,
  jsonb_build_array(pg_temp.ln('bank_main', 10000, 0), pg_temp.ln('materials', 30000, 0), pg_temp.ln('rent', 15000, 0),
    pg_temp.ln('sales_clothing', 0, 50000), pg_temp.ln('share_capital', 0, 5000)),
  '00000000-0000-0000-0000-0000000000a1');
select is(public.post_manual_journal(:A, '2025-12-31', 'FY2025 trial balance (draft)', 'opening_import', null,
    jsonb_build_array(pg_temp.ln('bank_main', 10000, 0), pg_temp.ln('sales_clothing', 0, 10000)), '00000000-0000-0000-0000-0000000000a1'),
  (select id from t where k = 'import'), 'Repeating the same request returns the same journal');
select is((select number from public.journals where id = (select id from t where k = 'import')), 'JN-00001', 'Journals are numbered');

-- Closing stock found later: an opening adjustment.
insert into t select 'stock', public.post_manual_journal(:A, '2025-12-31', 'Closing stock at 31 Dec 2025', 'opening_adjustment', 'stock',
  jsonb_build_array(pg_temp.ln('inv_finished', 8000, 0), pg_temp.ln('stock_change', 0, 8000)), gen_random_uuid());
select is((select adjustment_type from public.journals where id = (select id from t where k = 'stock')), 'stock', 'The adjustment is labelled as a stock adjustment');

select is((select sum(closing_minor)::bigint from public.trial_balance(:A, '2025-01-01', '2025-12-31')), 0::bigint, 'The trial balance balances');
select results_eq($$ select imported_minor, adjustments_minor, closing_minor from public.trial_balance('aaaaaaaa-0000-0000-0000-000000000000', '2025-01-01', '2025-12-31')
    where system_key in ('inv_finished', 'sales_clothing') order by code $$,
  $$ values (0::bigint, 8000::bigint, 8000::bigint), (-50000::bigint, 0::bigint, -50000::bigint) $$,
  'The trial balance shows imported figures and adjustments separately');

-- Never edited or deleted ----------------------------------------------------
select throws_ok($$ insert into public.journals (business_id, number, fiscal_year_id, effective_date, narration, kind, idempotency_key)
    select 'aaaaaaaa-0000-0000-0000-000000000000', 'JN-99999', id, '2025-06-01', 'x', 'manual', gen_random_uuid() from public.fiscal_years limit 1 $$,
  '42501', null, 'Owners can''t write journals directly');
reset role;
select throws_like($$ update public.journal_lines set debit_minor = 1 where journal_id = (select id from t where k = 'import') and line_no = 1 $$,
  '%can''t be changed or deleted%', 'Even the database owner can''t edit a posted line');
select throws_like($$ delete from public.journals where id = (select id from t where k = 'stock') $$,
  '%can''t be deleted%', '... or delete a journal');

-- Who can see the books ------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000002');
select is((select count(*)::int from public.journals), 0, 'The front office can''t read journals');
select throws_ok($$ select * from public.trial_balance('aaaaaaaa-0000-0000-0000-000000000000', '2025-01-01', '2025-12-31') $$,
  '42501', null, '... or run the trial balance');
select tests.login('b0000000-0000-0000-0000-000000000001'); -- owner of business B
select is((select count(*)::int from public.accounts where business_id = :A), 0, 'Another business''s owner can''t see the chart');
select throws_ok($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-12-31', 'x', 'manual', null, '[]'::jsonb, gen_random_uuid()) $$,
  '42501', null, '... or post into it');

-- Reversal -------------------------------------------------------------------
select tests.login('a0000000-0000-0000-0000-000000000001');
insert into t select 'rev', public.reverse_journal((select id from t where k = 'stock'), '2025-12-31', 'Count was wrong', gen_random_uuid());
select is((select reversed_by_id from public.journals where id = (select id from t where k = 'stock')), (select id from t where k = 'rev'),
  'A reversal is linked to the journal it reverses');
select throws_like($$ select public.reverse_journal((select id from t where k = 'stock'), '2025-12-31', 'Again', gen_random_uuid()) $$,
  '%already been reversed%', 'A journal is reversed only once');
select is((select closing_minor from public.trial_balance(:A, '2025-01-01', '2025-12-31') where system_key = 'inv_finished'), 0::bigint,
  'After the reversal the stock adjustment is gone from the balance');
select lives_ok($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-12-31', 'Closing stock at 31 Dec 2025 (recount)', 'opening_adjustment', 'stock',
    jsonb_build_array(pg_temp.ln('inv_finished', 8000, 0), pg_temp.ln('stock_change', 0, 8000)), gen_random_uuid()) $$,
  'The corrected adjustment is posted');

-- Period lock ----------------------------------------------------------------
select lives_ok($$ select public.set_books_lock('aaaaaaaa-0000-0000-0000-000000000000', '2025-06-30') $$, 'An owner closes the books up to 30 June');
select throws_like($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-03-01', 'Late', 'opening_adjustment', 'other',
    jsonb_build_array(pg_temp.ln('rent', 100, 0), pg_temp.ln('director_1', 0, 100)), gen_random_uuid()) $$,
  '%closed up to%', 'Postings dated in a closed period are refused');

-- Year-end close: profit = 50,000 + 8,000 - 30,000 - 15,000 = 13,000 -----------
select lives_ok($$ select public.close_fiscal_year('aaaaaaaa-0000-0000-0000-000000000000',
    (select id from public.fiscal_years where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and start_date = '2025-01-01'), gen_random_uuid()) $$,
  'An owner closes FY2025');
select results_eq($$ select opening_minor from public.trial_balance('aaaaaaaa-0000-0000-0000-000000000000', '2026-01-01', '2026-12-31')
    where system_key in ('retained_earnings', 'sales_clothing', 'inv_finished', 'bank_main') order by code $$,
  $$ values (10000::bigint), (8000::bigint), (-13000::bigint), (0::bigint) $$,
  'FY2026 opens with the balance sheet carried forward, the profit in retained earnings and income at zero');
select throws_like($$ select public.post_manual_journal('aaaaaaaa-0000-0000-0000-000000000000', '2025-12-31', 'Too late', 'opening_adjustment', 'other',
    jsonb_build_array(pg_temp.ln('rent', 100, 0), pg_temp.ln('director_1', 0, 100)), gen_random_uuid()) $$,
  '%closed%', 'Nothing can be posted into a closed year');

-- Reopen ---------------------------------------------------------------------
select lives_ok($$ select public.reopen_fiscal_year('aaaaaaaa-0000-0000-0000-000000000000',
    (select id from public.fiscal_years where business_id = 'aaaaaaaa-0000-0000-0000-000000000000' and start_date = '2025-01-01'), 'Accountant''s adjustments', gen_random_uuid()) $$,
  'An owner reopens FY2025');
select is((select sum(l.debit_minor - l.credit_minor)::bigint from public.journal_lines l where l.account_id = pg_temp.acct('retained_earnings')), 0::bigint,
  '... the closing journal is reversed and retained earnings go back to nil');

select * from finish();
rollback;
