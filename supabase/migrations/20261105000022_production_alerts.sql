-- Order to production: the production manager is told about new jobs that need a maker or have no materials planned.
-- (Confirming an order already creates a job per product line, with materials from the product's active recipe.)

create or replace function public.my_notifications(p_business_id uuid)
returns table (kind text, severity text, title text, detail text, ref_type text, ref_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
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
    -- New work: a job (often straight from a confirmed order) that has no maker yet, or no materials planned.
    return query
    select 'job_unassigned', 'warn', j.number || ' needs a maker',
      coalesce(s.name, 'Job') || coalesce(' · for ' || o.order_number, '') || coalesce(' · due ' || to_char(j.due_date, 'DD Mon'), ''), 'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
      left join public.order_items oi on oi.id = j.order_item_id left join public.orders o on o.id = oi.order_id
    where j.business_id = p_business_id and j.status in ('planned', 'allocated') and j.maker_id is null;
    return query
    select 'job_no_materials', 'warn', j.number || ' has no materials planned',
      coalesce(s.name, 'Job') || ' · add them on the job, or give the product a recipe', 'job', j.id
    from public.production_jobs j left join public.stock_items s on s.id = j.finished_item_id
    where j.business_id = p_business_id and j.status = 'planned'
      and not exists (select 1 from public.job_materials m where m.job_id = j.id);
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
