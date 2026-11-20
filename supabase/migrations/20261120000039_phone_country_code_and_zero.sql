-- Numbers written with both the country code and the leading 0 ("+234-08031112222", as Zoho exports them)
-- were normalised to "+23408031112222": WhatsApp links failed and duplicates went unnoticed. Drop the 0.
create or replace function app.normalize_phone(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when raw is null or btrim(raw) = '' then null
    else (
      with d as (select regexp_replace(raw, '\D', '', 'g') as digits)
      select case
        when length(digits) = 0 then null
        when digits like '0%' and length(digits) = 11 then '+234' || substr(digits, 2)
        when digits like '2340%' and length(digits) = 14 then '+234' || substr(digits, 5)
        when digits like '234%' then '+' || digits
        else '+' || digits
      end
      from d
    )
  end
$$;

-- Stored generated columns keep the old value until the row is written: recompute the affected rows.
update public.customers set phone = phone
where phone_normalized like '+2340%' or whatsapp_normalized like '+2340%';
