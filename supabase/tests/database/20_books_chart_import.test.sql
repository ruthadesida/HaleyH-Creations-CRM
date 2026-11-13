-- Books: setting up from the owner's own chart of accounts.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(13);

\set A '\'aaaaaaaa-0000-0000-0000-000000000000\''
\set B '\'bbbbbbbb-0000-0000-0000-000000000000\''

select tests.login('a0000000-0000-0000-0000-000000000001'); -- owner A
select lives_ok($$ select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', '2025-01-01', true, null, true, 7.5, '[
    {"code": "1013", "name": "Main Bank", "group": "current_assets", "system_key": "bank_main"},
    {"code": "1001", "name": "Equipment and Machinery", "group": "non_current_assets", "system_key": "ppe_machinery"},
    {"code": "1001 - 1", "name": "Solar System", "group": "non_current_assets", "system_key": null},
    {"code": "6001", "name": "Owner''s Contribution Account", "group": "equity", "system_key": "director_1"},
    {"code": "1000", "name": "Petty Cash", "group": "current_assets", "system_key": null},
    {"code": "5102", "name": "Rent Expense", "group": "operating_expenses", "system_key": "rent"}
  ]'::jsonb) $$, 'An owner sets up the books from their own chart');

select is((select code || ' ' || name from public.accounts where business_id = :A and system_key = 'bank_main'), '1013 Main Bank',
  'A mapped role uses the owner''s account');
select is((select code from public.accounts where business_id = :A and name = 'Solar System'), '1001-1', 'Sub-codes are kept (spaces removed)');
select is((select account_group from public.accounts where business_id = :A and system_key = 'director_1'), 'current_liabilities',
  'An account given an app role sits where the role needs it');
select is((select code from public.accounts where business_id = :A and system_key = 'cash'), '1002',
  'A role the chart doesn''t cover gets the standard account on the next free code');
select is((select contra_of from public.accounts where business_id = :A and system_key = 'ppe_machinery_dep'),
  (select id from public.accounts where business_id = :A and system_key = 'ppe_machinery'),
  'Accumulated depreciation is paired with the owner''s asset account');
select is((select count(distinct system_key)::int from public.accounts where business_id = :A and system_key is not null), 70,
  'Every role the app posts to is covered');
select is((select count(*)::int from public.accounts where business_id = :A and system_key is null), 2, 'Accounts without a role come in as they are');
select lives_ok($$ select public.create_account('aaaaaaaa-0000-0000-0000-000000000000', '1001-2', 'Inverter', 'non_current_assets', null) $$,
  'New accounts can use sub-codes too');

reset role;
select tests.login('b0000000-0000-0000-0000-000000000001'); -- owner B
select throws_like($$ select public.setup_books('bbbbbbbb-0000-0000-0000-000000000000', '2025-01-01', false, null, false, null,
    '[{"code": "4001", "name": "A", "group": "income", "system_key": null}, {"code": "4001", "name": "B", "group": "income", "system_key": null}]'::jsonb) $$,
  '%used twice%', 'A code used twice is refused');
select throws_like($$ select public.setup_books('bbbbbbbb-0000-0000-0000-000000000000', '2025-01-01', false, null, false, null,
    '[{"code": "4001", "name": "A", "group": "income", "system_key": "sales_bags"}, {"code": "4002", "name": "B", "group": "income", "system_key": "sales_bags"}]'::jsonb) $$,
  '%same app role%', 'One role on two accounts is refused');
select throws_like($$ select public.setup_books('bbbbbbbb-0000-0000-0000-000000000000', '2025-01-01', false, null, false, null,
    '[{"code": "X1", "name": "A", "group": "income", "system_key": null}]'::jsonb) $$,
  '%start with a digit%', 'A code that doesn''t start with a digit is refused');
select is((select count(*)::int from public.accounts where business_id = :B), 0, '... and a refused chart leaves nothing behind');

select * from finish();
rollback;
