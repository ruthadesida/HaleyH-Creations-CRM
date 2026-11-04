-- Phase 4: CSV imports with external IDs (Spec 2 §15). Customers and products (with variants) from a
-- Zoho or WooCommerce export. Idempotent: a row whose external ID was imported before updates that record
-- instead of creating a duplicate. Every import can be previewed first (p_dry_run) without writing anything.
-- Historical orders and payments are not imported: they would double-count opening stock and cash.

alter table public.customers add column external_id text check (char_length(external_id) <= 120);
create unique index customers_external_key on public.customers (business_id, external_id) where external_id is not null;
grant select (external_id) on public.customers to authenticated;

-- p_rows: [{ "line": int, "external_id", "full_name", "phone", "whatsapp", "email", "address", "city", "state", "notes" }]
create or replace function public.import_customers(p_business_id uuid, p_rows jsonb, p_dry_run boolean)
returns table (line integer, action text, message text)
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_line integer;
  v_ext text;
  v_name text;
  v_phone text;
  v_email text;
  v_id uuid;
  v_seen text[] := '{}';
begin
  if not app.is_office(p_business_id) then
    raise exception 'Only an owner or the front office can import customers.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import at most 5,000 customers at a time.' using errcode = 'P0001';
  end if;
  if not p_dry_run then
    perform 1 from public.businesses where id = p_business_id for update; -- one import at a time
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := coalesce((r ->> 'line')::integer, 0);
    v_ext := nullif(btrim(r ->> 'external_id'), '');
    v_name := nullif(btrim(r ->> 'full_name'), '');
    v_phone := nullif(btrim(r ->> 'phone'), '');
    v_email := nullif(lower(btrim(r ->> 'email')), '');
    v_id := null;

    if v_name is null then
      line := v_line; action := 'error'; message := 'Name is missing.'; return next; continue;
    end if;
    if char_length(v_name) > 120 then
      line := v_line; action := 'error'; message := 'Name is longer than 120 characters.'; return next; continue;
    end if;
    if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      line := v_line; action := 'error'; message := 'That email address doesn''t look right.'; return next; continue;
    end if;
    if v_ext is not null and v_ext = any (v_seen) then
      line := v_line; action := 'error'; message := 'This external ID appears twice in the file.'; return next; continue;
    end if;
    if v_ext is not null then
      v_seen := v_seen || v_ext;
      select id into v_id from public.customers where business_id = p_business_id and external_id = v_ext;
    end if;

    if v_id is not null then
      if not p_dry_run then
        update public.customers set full_name = v_name, phone = coalesce(v_phone, phone),
          whatsapp = coalesce(nullif(btrim(r ->> 'whatsapp'), ''), whatsapp), email = coalesce(v_email, email),
          address_line = coalesce(nullif(btrim(r ->> 'address'), ''), address_line),
          city = coalesce(nullif(btrim(r ->> 'city'), ''), city), state = coalesce(nullif(btrim(r ->> 'state'), ''), state)
        where id = v_id;
      end if;
      line := v_line; action := 'update'; message := 'Already imported: details refreshed.'; return next; continue;
    end if;

    -- No external ID match: don't create a second record for someone already here.
    select id into v_id from public.customers
      where business_id = p_business_id and archived_at is null
        and ((v_phone is not null and phone_normalized = app.normalize_phone(v_phone))
          or (v_email is not null and email_normalized = v_email))
      limit 1;
    if v_id is not null then
      if v_ext is not null and not p_dry_run then
        update public.customers set external_id = v_ext where id = v_id and external_id is null;
      end if;
      line := v_line; action := 'skip'; message := 'A customer with this phone or email already exists' ||
        case when v_ext is not null then ': linked to this external ID.' else '.' end;
      return next; continue;
    end if;

    if not p_dry_run then
      insert into public.customers (business_id, full_name, phone, whatsapp, email, address_line, city, state, notes, external_id)
      values (p_business_id, left(v_name, 120), left(v_phone, 40), left(nullif(btrim(r ->> 'whatsapp'), ''), 40), v_email,
        left(nullif(btrim(r ->> 'address'), ''), 300), left(nullif(btrim(r ->> 'city'), ''), 80), left(nullif(btrim(r ->> 'state'), ''), 80),
        left(nullif(btrim(r ->> 'notes'), ''), 4000), v_ext);
    end if;
    line := v_line; action := 'create'; message := 'New customer.'; return next;
  end loop;
end;
$$;

-- p_rows: [{ "line", "external_id" (variant), "product_name", "category", "sku", "size", "colour", "length", "price" (kobo) }]
create or replace function public.import_products(p_business_id uuid, p_rows jsonb, p_dry_run boolean)
returns table (line integer, action text, message text)
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_line integer;
  v_ext text;
  v_name text;
  v_sku text;
  v_cat public.product_category;
  v_price bigint;
  v_product uuid;
  v_variant uuid;
  v_seen text[] := '{}';
  v_seen_sku text[] := '{}';
begin
  if not app.is_owner(p_business_id) then
    raise exception 'Only an owner can import products (they carry prices).' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Import at most 5,000 rows at a time.' using errcode = 'P0001';
  end if;
  if not p_dry_run then
    perform 1 from public.businesses where id = p_business_id for update;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := coalesce((r ->> 'line')::integer, 0);
    v_ext := nullif(btrim(r ->> 'external_id'), '');
    v_name := nullif(btrim(r ->> 'product_name'), '');
    v_sku := nullif(btrim(r ->> 'sku'), '');
    v_variant := null; v_product := null;

    if v_name is null then
      line := v_line; action := 'error'; message := 'Product name is missing.'; return next; continue;
    end if;
    begin
      v_cat := coalesce(nullif(lower(btrim(r ->> 'category')), ''), 'clothing')::public.product_category;
    exception when invalid_text_representation then
      line := v_line; action := 'error'; message := 'Category must be clothing, shoes, bags or other.'; return next; continue;
    end;
    v_price := case when coalesce(r ->> 'price', '') ~ '^\d+$' then (r ->> 'price')::bigint end;
    if nullif(r ->> 'price', '') is not null and v_price is null then
      line := v_line; action := 'error'; message := 'Price must be a number.'; return next; continue;
    end if;
    if (v_ext is not null and v_ext = any (v_seen)) or (v_sku is not null and lower(v_sku) = any (v_seen_sku)) then
      line := v_line; action := 'error'; message := 'This SKU or external ID appears twice in the file.'; return next; continue;
    end if;
    if v_ext is not null then v_seen := v_seen || v_ext; end if;
    if v_sku is not null then v_seen_sku := v_seen_sku || lower(v_sku); end if;

    select id into v_variant from public.product_variants
      where business_id = p_business_id and ((v_ext is not null and external_id = v_ext) or (v_sku is not null and lower(sku) = lower(v_sku)))
      limit 1;
    if v_variant is not null then
      if not p_dry_run then
        update public.product_variants set price_minor = coalesce(v_price, price_minor),
          external_id = coalesce(external_id, v_ext) where id = v_variant;
      end if;
      line := v_line; action := 'update'; message := 'Already here: price refreshed.'; return next; continue;
    end if;

    select id into v_product from public.products where business_id = p_business_id and lower(name) = lower(v_name) limit 1;
    if not p_dry_run then
      if v_product is null then
        insert into public.products (business_id, name, category, base_price_minor)
        values (p_business_id, left(v_name, 160), v_cat, coalesce(v_price, 0)) returning id into v_product;
      end if;
      insert into public.product_variants (business_id, product_id, size, colour, length, sku, price_minor, external_id)
      values (p_business_id, v_product, left(nullif(btrim(r ->> 'size'), ''), 30), left(nullif(btrim(r ->> 'colour'), ''), 40),
        left(nullif(btrim(r ->> 'length'), ''), 30), left(v_sku, 60), v_price, v_ext);
    end if;
    line := v_line; action := 'create';
    message := case when v_product is null then 'New product and variant.' else 'New variant of an existing product.' end;
    return next;
  end loop;
end;
$$;

revoke all on function public.import_customers, public.import_products from public, anon;
grant execute on function public.import_customers, public.import_products to authenticated;
comment on function public.import_customers is 'Intentional SECURITY DEFINER: office check; idempotent by external ID; dry run writes nothing.';
comment on function public.import_products is 'Intentional SECURITY DEFINER: owner check; idempotent by external ID or SKU; dry run writes nothing.';
