-- Phase 4 review fixes.
-- 1. Gross profit report counts only what was dispatched/returned in the period (was whole-life per order).
-- 2. Owner overview computes sales by product once.
-- 3. Customer import: the same phone/email twice in one file is created once (preview matches the real run);
--    an archived customer matched by external ID is left alone.
-- 4. Product import without SKU or external ID matches the same product + size/colour/length, so re-importing
--    the same file updates instead of duplicating.
-- 5. Search returns production jobs only to people who can open them (owners and production).
-- Estimated gross profit per order for what was dispatched (less returned) in the period only, so an order sent out
-- across two periods is split between them, matching "Sales by product".
create or replace function public.report_gross_profit(p_business_id uuid, p_from date, p_to date)
returns table (order_number text, customer text, fulfilled_sales numeric, cogs numeric, gross_profit numeric, margin_pct numeric, cost_complete boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_business_id);
  return query
  with lines as (
    select dl.order_item_id, dl.quantity::numeric as qty, d.document_id, d.order_id
    from public.order_dispatch_lines dl join public.order_dispatches d on d.id = dl.dispatch_id
    where d.business_id = p_business_id and d.dispatched_on between p_from and p_to
    union all
    select rl.order_item_id, -rl.quantity::numeric, r.document_id, r.order_id
    from public.order_return_lines rl join public.order_returns r on r.id = rl.return_id
    where r.business_id = p_business_id and r.received_on between p_from and p_to
  ),
  priced as (
    select l.order_id, l.qty,
      l.qty * i.unit_price_minor * (1 - coalesce(s.discount_minor::numeric / nullif(s.subtotal_minor, 0), 0)) as value,
      (select sum(abs(m.quantity) * m.unit_cost) / nullif(sum(abs(m.quantity)), 0) from public.stock_movements m
        where m.document_id = l.document_id and m.stock_item_id = app.order_item_stock_item(l.order_item_id)) as unit_cost
    from lines l
    join public.order_items i on i.id = l.order_item_id
    join public.order_summaries s on s.id = l.order_id
  ),
  per_order as (
    select p.order_id, sum(p.value) as value, sum(p.qty * coalesce(p.unit_cost, 0)) as cogs, bool_and(coalesce(p.unit_cost, 0) > 0) as complete
    from priced p group by p.order_id
  )
  select s.order_number, c.full_name, round(o.value), round(o.cogs), round(o.value - o.cogs),
    round(100 * (o.value - o.cogs) / nullif(o.value, 0), 1), o.complete
  from per_order o
  join public.order_summaries s on s.id = o.order_id
  join public.customers c on c.id = s.customer_id
  order by 5 desc nulls last;
end;
$$;

-- Same figures as before; "Sales by product" now runs once instead of three times.
create or replace function public.owner_overview(p_business_id uuid, p_from date, p_to date)
returns table (confirmed_value numeric, cash_received numeric, owed_by_customers numeric, fulfilled_sales numeric,
  gross_profit numeric, profit_complete boolean, stock_value numeric, wip_value numeric, owed_to_suppliers numeric,
  open_jobs bigint, overdue_jobs bigint, shortages bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  perform app.require_owner(p_business_id);
  return query
  with sp as (
    select coalesce(sum(r.sales), 0) as sales, coalesce(sum(r.gross_profit), 0) as profit, coalesce(bool_and(r.cost_complete), true) as complete
    from public.report_sales_by_product(p_business_id, p_from, p_to) r
  )
  select
    (select coalesce(sum(s.total_minor), 0) from public.order_summaries s where s.business_id = p_business_id and s.status = 'open'
      and s.confirmed_at is not null and (s.confirmed_at at time zone 'Africa/Lagos')::date between p_from and p_to)::numeric,
    (select coalesce(sum(case when y.kind = 'refund' then -y.amount_minor else y.amount_minor end), 0) from public.payments y
      where y.business_id = p_business_id and y.voided_at is null and y.paid_on between p_from and p_to)::numeric,
    (select coalesce(sum(s.balance_minor), 0) from public.order_summaries s where s.business_id = p_business_id and s.status = 'open'
      and s.confirmed_at is not null and s.balance_minor > 0)::numeric,
    sp.sales, sp.profit, sp.complete,
    (select coalesce(round(sum(b.on_hand * i.avg_cost)), 0) from public.stock_balances b join public.stock_items i on i.id = b.stock_item_id
      where b.business_id = p_business_id),
    (select coalesce(round(sum(app.job_wip_value(j.id))), 0) from public.production_jobs j
      where j.business_id = p_business_id and j.status in ('allocated', 'in_progress', 'in_qc')),
    (select coalesce(sum(greatest(b.balance, 0)), 0) from public.supplier_balances b where b.business_id = p_business_id)::numeric,
    (select count(*) from public.production_jobs j where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc')),
    (select count(*) from public.production_jobs j where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc') and j.due_date < v_today),
    (select count(*) from public.report_shortages(p_business_id))
  from sp;
end;
$$;
-- Customer import
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
  v_seen_contact text[] := '{}';
  v_archived timestamptz;
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
      select id, archived_at into v_id, v_archived from public.customers where business_id = p_business_id and external_id = v_ext;
      if v_id is not null and v_archived is not null then
        line := v_line; action := 'skip'; message := 'This customer was archived here, so it is left as is.'; return next; continue;
      end if;
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

    -- The same person twice in this file (by phone or email) is created once, in the preview as in the real run.
    if (v_phone is not null and ('p:' || app.normalize_phone(v_phone)) = any (v_seen_contact)) or (v_email is not null and ('e:' || v_email) = any (v_seen_contact)) then
      line := v_line; action := 'skip'; message := 'Same phone or email as an earlier line in this file.'; return next; continue;
    end if;
    if v_phone is not null then v_seen_contact := v_seen_contact || ('p:' || app.normalize_phone(v_phone)); end if;
    if v_email is not null then v_seen_contact := v_seen_contact || ('e:' || v_email); end if;

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

-- Product import
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
    if v_variant is null and v_ext is null and v_sku is null then
      select v.id into v_variant from public.product_variants v join public.products p on p.id = v.product_id
      where v.business_id = p_business_id and lower(p.name) = lower(v_name)
        and v.size is not distinct from nullif(btrim(r ->> 'size'), '') and v.colour is not distinct from nullif(btrim(r ->> 'colour'), '')
        and v.length is not distinct from nullif(btrim(r ->> 'length'), '')
      limit 1;
    end if;
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

-- Search
create or replace function public.search_everything(p_business_id uuid, p_query text)
returns table (kind text, ref_id uuid, title text, subtitle text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
  v_digits text;
  v_office boolean := app.is_office(p_business_id);
  v_prod boolean := app.is_production(p_business_id);
begin
  if char_length(v_q) < 2 or not (v_office or v_prod) then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digits := regexp_replace(v_q, '\D', '', 'g');

  if v_office then
    return query
    select 'customer'::text, c.id, c.full_name, coalesce(c.phone, c.email, '')
    from public.customers c
    where c.business_id = p_business_id and c.archived_at is null
      and (c.full_name ilike v_like or c.email ilike v_like
           or (char_length(v_digits) >= 4 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'))
    order by c.updated_at desc limit 8;
    return query
    select 'order'::text, o.id, o.order_number, c.full_name
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.business_id = p_business_id and (o.order_number ilike v_like or c.full_name ilike v_like)
    order by o.created_at desc limit 8;
  end if;

  return query
  select 'item'::text, i.id, i.name, i.code
  from public.stock_items i
  where i.business_id = p_business_id and i.archived_at is null and (v_prod or i.kind = 'finished_good')
    and (i.name ilike v_like or i.code ilike v_like)
  order by i.name limit 8;

  if v_prod then
    return query
    select 'job'::text, j.id, j.number, coalesce(s.name, '')
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and (j.number ilike v_like or s.name ilike v_like)
    order by j.created_at desc limit 8;
    return query
    select 'purchase_order'::text, p.id, p.number, s.name
    from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
    where p.business_id = p_business_id and (p.number ilike v_like or s.name ilike v_like)
    order by p.created_at desc limit 8;
  end if;
end;
$$;
