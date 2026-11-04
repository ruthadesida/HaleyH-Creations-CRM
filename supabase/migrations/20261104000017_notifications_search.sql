-- Phase 4: in-app notifications and global search (Spec 2 §16).
-- Notifications are worked out from the records each time (never stored), so they can't go stale:
-- what's overdue, short, waiting for QC, waiting for an owner's approval, and so on, by role.
-- Search covers customers, orders, products/SKUs, materials, jobs and purchase orders, by role.

create or replace function public.my_notifications(p_business_id uuid)
returns table (kind text, severity text, title text, detail text, ref_type text, ref_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_office boolean := app.is_office(p_business_id);
  v_prod boolean := app.is_production(p_business_id);
  v_owner boolean := app.is_owner(p_business_id);
begin
  if not (v_office or v_prod) then
    return;
  end if;

  if v_office then
    return query
    select 'order_late'::text, 'danger'::text, s.order_number || ' is past its promised date',
      c.full_name || ' · promised ' || to_char(s.promised_date, 'DD Mon'), 'order'::text, s.id
    from public.order_summaries s join public.customers c on c.id = s.customer_id
    where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
      and s.fulfilment_stage not in ('dispatched', 'delivered') and s.promised_date < v_today;
    return query
    select 'order_ready', 'info', s.order_number || ' is ready to dispatch', c.full_name, 'order', s.id
    from public.order_summaries s join public.customers c on c.id = s.customer_id
    where s.business_id = p_business_id and s.status = 'open' and s.fulfilment_stage = 'ready_for_dispatch';
    return query
    select 'return_inspect', 'warn', r.number || ': returned items waiting for inspection', o.order_number, 'order', o.id
    from public.order_returns r join public.orders o on o.id = r.order_id
    where r.business_id = p_business_id and exists (select 1 from public.order_return_lines l where l.return_id = r.id and l.decision is null);
  end if;

  if v_prod then
    return query
    select 'job_overdue', 'danger', j.number || ' is overdue', coalesce(s.name, 'Job') || coalesce(' · ' || mk.name, '') || ' · due ' || to_char(j.due_date, 'DD Mon'),
      'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id left join public.makers mk on mk.id = j.maker_id
    where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc') and j.due_date < v_today;
    return query
    select 'job_qc', 'info', j.number || ' is waiting for QC', coalesce(s.name, 'Job'), 'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and j.status = 'in_qc';
    return query
    select 'shortage', 'warn', r.item || ' is short', 'Short by ' || app.fmt_qty(r.short_by) || ' ' || r.unit, 'report', null::uuid
    from public.report_shortages(p_business_id) r;
    return query
    select 'po_late', 'warn', p.number || ' is late from ' || s.name, 'Expected ' || to_char(p.expected_date, 'DD Mon'), 'purchase_order', p.id
    from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
    where p.business_id = p_business_id and p.status in ('ordered', 'part_received') and p.expected_date < v_today;
  end if;

  if v_owner then
    return query
    select 'po_approve', 'info', p.number || ' needs your approval', 'Purchase request from ' || s.name, 'purchase_order', p.id
    from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
    where p.business_id = p_business_id and p.status = 'draft';
    return query
    select 'count_approve', 'info', case a.kind when 'count' then 'A stock count' else 'A write-off' end || ' needs your approval',
      coalesce(a.reason, ''), 'adjustment', a.id
    from public.adjustment_requests a where a.business_id = p_business_id and a.status = 'pending';
    return query
    select 'opening_approve', 'info', b.reference || ': opening stock needs your approval', coalesce(b.file_name, ''), 'opening_batch', b.id
    from public.opening_batches b where b.business_id = p_business_id and b.status = 'draft';
    return query
    select 'fee_approve', 'info', j.number || ': approve what ' || mk.name || ' is owed', coalesce(s.name, ''), 'job', j.id
    from public.production_jobs j join public.makers mk on mk.id = j.maker_id left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and j.status = 'completed' and j.fee_approved is null;
    return query
    select 'unpaid_dispatch', 'info', s.order_number || ' is ready but money is owed', c.full_name, 'order', s.id
    from public.order_summaries s join public.customers c on c.id = s.customer_id
    join public.orders o on o.id = s.id
    where s.business_id = p_business_id and s.status = 'open' and s.fulfilment_stage = 'ready_for_dispatch'
      and s.balance_minor > 0 and o.unpaid_dispatch_approved_at is null;
  end if;
end;
$$;

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

  return query
  select 'job'::text, j.id, j.number, coalesce(s.name, '')
  from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
  where j.business_id = p_business_id and (j.number ilike v_like or s.name ilike v_like)
  order by j.created_at desc limit 8;

  if v_prod then
    return query
    select 'purchase_order'::text, p.id, p.number, s.name
    from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
    where p.business_id = p_business_id and (p.number ilike v_like or s.name ilike v_like)
    order by p.created_at desc limit 8;
  end if;
end;
$$;

revoke all on function public.my_notifications, public.search_everything from public, anon;
grant execute on function public.my_notifications, public.search_everything to authenticated;
comment on function public.my_notifications is 'Intentional SECURITY DEFINER: returns only what the caller''s role may see.';
comment on function public.search_everything is 'Intentional SECURITY DEFINER: searches only what the caller''s role may see.';
