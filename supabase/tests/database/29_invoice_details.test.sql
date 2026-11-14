-- Invoice details: owners set how customers pay, the tax ID and the logo; the office reads the VAT rate an
-- invoice includes (and nothing else from the owners-only books settings); logos stay inside their business.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../shared/fixtures.psql

select plan(14);

select tests.login('a0000000-0000-0000-0000-000000000001'); -- owner A
select public.setup_books('aaaaaaaa-0000-0000-0000-000000000000', (date_trunc('month', current_date) - interval '1 year')::date, false, null, false, null);
reset role;
update public.books_settings set vat_registered = true, vat_rate = 7.5, vat_charged_from = current_date - 10
where business_id = 'aaaaaaaa-0000-0000-0000-000000000000';

-- VAT rate
select tests.login('a0000000-0000-0000-0000-000000000002'); -- front office A
select is(public.invoice_vat_rate('aaaaaaaa-0000-0000-0000-000000000000', current_date), 7.5::numeric,
  'The front office sees the VAT rate an invoice includes');
select is(public.invoice_vat_rate('aaaaaaaa-0000-0000-0000-000000000000', current_date - 11), 0::numeric,
  'No VAT on an invoice dated before the business started charging it');
select is_empty($q$ select 1 from public.books_settings $q$, 'The front office still can''t read the books settings');

select tests.login('a0000000-0000-0000-0000-000000000003'); -- production A
select throws_ok($q$ select public.invoice_vat_rate('aaaaaaaa-0000-0000-0000-000000000000', current_date) $q$,
  '42501', null, 'Production staff can''t see invoice figures');
select tests.login('b0000000-0000-0000-0000-000000000001'); -- owner B
select throws_ok($q$ select public.invoice_vat_rate('aaaaaaaa-0000-0000-0000-000000000000', current_date) $q$,
  '42501', null, 'Another business can''t read it');
select is(public.invoice_vat_rate('bbbbbbbb-0000-0000-0000-000000000000', current_date), 0::numeric,
  'A business without books charges no VAT');

-- Payment details and tax ID
select tests.login('a0000000-0000-0000-0000-000000000001');
update public.businesses set payment_details = 'Business A - Test Bank - 0000000000', tax_id = 'TIN-TEST'
where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is((select payment_details || ' / ' || tax_id from public.businesses where id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  'Business A - Test Bank - 0000000000 / TIN-TEST', 'An owner saves how customers pay and the tax ID');

select tests.login('a0000000-0000-0000-0000-000000000002');
update public.businesses set payment_details = 'Someone else - 1111111111' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select is((select payment_details from public.businesses where id = 'aaaaaaaa-0000-0000-0000-000000000000'),
  'Business A - Test Bank - 0000000000', 'The front office can''t change where customers pay');

select tests.login('a0000000-0000-0000-0000-000000000001');
select throws_ok($q$ update public.businesses set logo_path = 'bbbbbbbb-0000-0000-0000-000000000000/logo.png'
    where id = 'aaaaaaaa-0000-0000-0000-000000000000' $q$,
  '23514', null, 'A logo can only point into the business''s own folder');

-- Logo files
select lives_ok($q$ insert into storage.objects (bucket_id, name) values ('branding', 'aaaaaaaa-0000-0000-0000-000000000000/logo-test.png') $q$,
  'An owner uploads a logo into their own folder');
select throws_ok($q$ insert into storage.objects (bucket_id, name) values ('branding', 'bbbbbbbb-0000-0000-0000-000000000000/logo-test.png') $q$,
  '42501', null, 'An owner can''t upload into another business''s folder');

select tests.login('a0000000-0000-0000-0000-000000000002');
select throws_ok($q$ insert into storage.objects (bucket_id, name) values ('branding', 'aaaaaaaa-0000-0000-0000-000000000000/logo-2.png') $q$,
  '42501', null, 'Only owners change the logo');

select tests.login('a0000000-0000-0000-0000-000000000003');
select is((select count(*)::int from storage.objects where bucket_id = 'branding'), 1, 'Staff of the business can see its logo');

select tests.login('b0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from storage.objects where bucket_id = 'branding'), 0, 'Another business can''t see it');

select * from finish();
rollback;
