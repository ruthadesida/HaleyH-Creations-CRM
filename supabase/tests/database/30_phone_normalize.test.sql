-- Phone numbers with both the country code and the leading 0 normalise like any other copy of the number.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

select is(app.normalize_phone('+234-08031112222'), '+2348031112222', 'Country code plus leading 0 drops the 0');
select is(app.normalize_phone('08031112222'), '+2348031112222', 'Local format is unchanged');
select is(app.normalize_phone('+234 803 111 2222'), '+2348031112222', 'International format is unchanged');
select is(app.normalize_phone('+44 20 7946 0958'), '+442079460958', 'Other countries are unchanged');

select * from finish();
rollback;
