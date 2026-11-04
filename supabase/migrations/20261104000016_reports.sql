-- Phase 4: reports (Spec 2 §14). Each report is a function that checks the caller's role and returns only
-- what that role may see. Costs need cost permission; profit, supplier money and maker pay are owners only;
-- production staff never get customer payments or financial reports. Definitions are in src/lib/reports.ts.

-------------------------------------------------------------------------------
-- Guards
-------------------------------------------------------------------------------
create or replace function app.require_office(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_office(p_business_id) then
    raise exception 'This report is for owners and the front office.' using errcode = '42501';
  end if;
end;
$$;

create or replace function app.require_production(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_production(p_business_id) then
    raise exception 'This report is for owners and the production manager.' using errcode = '42501';
  end if;
end;
$$;

create or replace function app.require_owner(p_business_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_owner(p_business_id) then
    raise exception 'This report is for owners.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.require_office, app.require_production, app.require_owner from public, anon, authenticated;

-- A variant's display name, e.g. "Wrap dress · M / Blue".
create or replace function app.variant_label(p_variant uuid)
returns text language sql stable security definer set search_path = '' as $$
  select p.name || coalesce(' · ' || nullif(concat_ws(' / ', v.size, v.colour, v.length), ''), '')
  from public.product_variants v join public.products p on p.id = v.product_id where v.id = p_variant
$$;
revoke all on function app.variant_label from public, anon, authenticated;

-------------------------------------------------------------------------------
-- Sales
-------------------------------------------------------------------------------
-- Fulfilled sales by product in a period: units dispatched less units returned, value after the order discount.
-- Cost of goods and estimated gross profit for owners only (null for the front office).
create or replace function public.report_sales_by_product(p_business_id uuid, p_from date, p_to date)
returns table (product text, units numeric, sales numeric, cogs numeric, gross_profit numeric, cost_complete boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_owner boolean := app.is_owner(p_business_id);
begin
  perform app.require_office(p_business_id);
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
    select coalesce(app.variant_label(i.variant_id), i.description) as name, l.qty,
      l.qty * i.unit_price_minor * (1 - coalesce(s.discount_minor::numeric / nullif(s.subtotal_minor, 0), 0)) as value,
      (select sum(abs(m.quantity) * m.unit_cost) / nullif(sum(abs(m.quantity)), 0) from public.stock_movements m
        where m.document_id = l.document_id and m.stock_item_id = app.order_item_stock_item(l.order_item_id)) as unit_cost
    from lines l
    join public.order_items i on i.id = l.order_item_id
    join public.order_summaries s on s.id = l.order_id
  )
  select p.name, sum(p.qty), round(sum(p.value)),
    case when v_owner then round(sum(p.qty * coalesce(p.unit_cost, 0))) end,
    case when v_owner then round(sum(p.value) - sum(p.qty * coalesce(p.unit_cost, 0))) end,
    case when v_owner then bool_and(coalesce(p.unit_cost, 0) > 0) end
  from priced p group by p.name order by 3 desc nulls last;
end;
$$;

-- Confirmed order value (orders confirmed in the period, not cancelled) by channel.
create or replace function public.report_sales_by_channel(p_business_id uuid, p_from date, p_to date)
returns table (channel text, orders bigint, order_value numeric, received numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_business_id);
  return query
  select coalesce(s.channel::text, 'not recorded'), count(*), sum(s.total_minor)::numeric, sum(s.net_paid_minor)::numeric
  from public.order_summaries s
  where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
    and (s.confirmed_at at time zone 'Africa/Lagos')::date between p_from and p_to
  group by 1 order by 3 desc;
end;
$$;

-- Day by day (or month by month): confirmed order value, fulfilled sales, cash received (net of refunds).
create or replace function public.report_sales_by_period(p_business_id uuid, p_from date, p_to date, p_grain text)
returns table (period date, confirmed_value numeric, fulfilled_sales numeric, cash_received numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_grain text := case when p_grain in ('day', 'week', 'month') then p_grain else 'day' end;
begin
  perform app.require_office(p_business_id);
  return query
  with periods as (
    select generate_series(date_trunc(v_grain, p_from::timestamp), date_trunc(v_grain, p_to::timestamp), ('1 ' || v_grain)::interval)::date as p
  ),
  conf as (
    select date_trunc(v_grain, (s.confirmed_at at time zone 'Africa/Lagos'))::date as p, sum(s.total_minor) as v
    from public.order_summaries s
    where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
      and (s.confirmed_at at time zone 'Africa/Lagos')::date between p_from and p_to
    group by 1
  ),
  ful as (
    select date_trunc(v_grain, d.dispatched_on::timestamp)::date as p,
      sum(dl.quantity * i.unit_price_minor * (1 - coalesce(s.discount_minor::numeric / nullif(s.subtotal_minor, 0), 0))) as v
    from public.order_dispatch_lines dl
    join public.order_dispatches d on d.id = dl.dispatch_id
    join public.order_items i on i.id = dl.order_item_id
    join public.order_summaries s on s.id = d.order_id
    where d.business_id = p_business_id and d.dispatched_on between p_from and p_to
    group by 1
  ),
  cash as (
    select date_trunc(v_grain, y.paid_on::timestamp)::date as p, sum(case when y.kind = 'refund' then -y.amount_minor else y.amount_minor end) as v
    from public.payments y where y.business_id = p_business_id and y.voided_at is null and y.paid_on between p_from and p_to
    group by 1
  )
  select periods.p, coalesce(conf.v, 0)::numeric, round(coalesce(ful.v, 0)), coalesce(cash.v, 0)::numeric
  from periods left join conf on conf.p = periods.p left join ful on ful.p = periods.p left join cash on cash.p = periods.p
  order by 1;
end;
$$;

-- Money received by method in the period (recorded manually), and refunds.
create or replace function public.report_cash(p_business_id uuid, p_from date, p_to date)
returns table (method text, payments bigint, received numeric, refunded numeric, net numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_business_id);
  return query
  select y.method::text, count(*) filter (where y.kind = 'payment'),
    coalesce(sum(y.amount_minor) filter (where y.kind = 'payment'), 0)::numeric,
    coalesce(sum(y.amount_minor) filter (where y.kind = 'refund'), 0)::numeric,
    coalesce(sum(case when y.kind = 'refund' then -y.amount_minor else y.amount_minor end), 0)::numeric
  from public.payments y
  where y.business_id = p_business_id and y.voided_at is null and y.paid_on between p_from and p_to
  group by 1 order by 5 desc;
end;
$$;

-- Confirmed open orders with money still owed.
create or replace function public.report_balances(p_business_id uuid)
returns table (order_number text, customer text, ordered date, order_value numeric, received numeric, owed numeric, progress text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_business_id);
  return query
  select s.order_number, c.full_name, s.order_date, s.total_minor::numeric, s.net_paid_minor::numeric, s.balance_minor::numeric,
    s.fulfilment_stage::text
  from public.order_summaries s join public.customers c on c.id = s.customer_id
  where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null and s.balance_minor > 0
  order by s.balance_minor desc;
end;
$$;

-- Orders needing action: overdue, due within 3 days, ready to dispatch, or waiting on payment.
create or replace function public.report_orders_attention(p_business_id uuid)
returns table (order_number text, customer text, promised date, progress text, owed numeric, needs text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  perform app.require_office(p_business_id);
  return query
  select s.order_number, c.full_name, s.promised_date, s.fulfilment_stage::text, greatest(s.balance_minor, 0)::numeric,
    concat_ws('; ',
      case when s.promised_date < v_today then 'Past promised date' end,
      case when s.promised_date between v_today and v_today + 3 then 'Due within 3 days' end,
      case when s.fulfilment_stage = 'ready_for_dispatch' then 'Ready to dispatch' end,
      case when s.balance_minor > 0 then 'Money owed' end)
  from public.order_summaries s join public.customers c on c.id = s.customer_id
  where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
    and s.fulfilment_stage not in ('dispatched', 'delivered')
    and (s.promised_date <= v_today + 3 or s.fulfilment_stage = 'ready_for_dispatch' or s.balance_minor > 0)
  order by s.promised_date nulls last;
end;
$$;

-- Estimated gross profit per dispatched order in the period (owners).
create or replace function public.report_gross_profit(p_business_id uuid, p_from date, p_to date)
returns table (order_number text, customer text, fulfilled_sales numeric, cogs numeric, gross_profit numeric, margin_pct numeric, cost_complete boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_business_id);
  return query
  select s.order_number, c.full_name, p.fulfilled_value::numeric, round(p.cogs), round(p.gross_profit),
    round(100 * p.gross_profit / nullif(p.fulfilled_value, 0), 1), p.cost_complete
  from public.order_summaries s
  join public.customers c on c.id = s.customer_id
  cross join lateral public.order_profit(s.id) p
  where s.business_id = p_business_id
    and exists (select 1 from public.order_dispatches d where d.order_id = s.id and d.dispatched_on between p_from and p_to)
  order by 5 desc nulls last;
end;
$$;

-------------------------------------------------------------------------------
-- Stock
-------------------------------------------------------------------------------
-- On hand by item and location. The front office sees finished goods only; values need cost permission.
create or replace function public.report_stock_by_location(p_business_id uuid)
returns table (kind text, code text, item text, location text, on_hand numeric, unit text, value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_costs boolean := app.can_view_costs(p_business_id);
  v_prod boolean := app.is_production(p_business_id);
begin
  perform app.require_office(p_business_id) where not v_prod;
  return query
  select i.kind, i.code, i.name, l.name, b.on_hand, i.base_unit, case when v_costs then round(b.on_hand * i.avg_cost) end
  from public.stock_balances b
  join public.stock_items i on i.id = b.stock_item_id
  join public.locations l on l.id = b.location_id
  where b.business_id = p_business_id and (v_prod or i.kind = 'finished_good')
  order by i.kind, i.name, l.name;
end;
$$;

-- On hand (outside Quarantine), reserved and available per item; in Quarantine shown separately.
create or replace function public.report_availability(p_business_id uuid)
returns table (kind text, code text, item text, on_hand numeric, reserved numeric, available numeric, in_quarantine numeric, unit text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_prod boolean := app.is_production(p_business_id);
begin
  perform app.require_office(p_business_id) where not v_prod;
  return query
  select i.kind, i.code, i.name, a.on_hand, a.reserved, a.available,
    coalesce((select sum(m.quantity) from public.stock_movements m join public.locations l on l.id = m.location_id
              where m.stock_item_id = i.id and l.kind = 'quarantine'), 0),
    i.base_unit
  from public.stock_availability a join public.stock_items i on i.id = a.stock_item_id
  where i.business_id = p_business_id and i.archived_at is null and (v_prod or i.kind = 'finished_good')
    and (a.on_hand <> 0 or a.reserved <> 0)
  order by i.kind, i.name;
end;
$$;

-- Value of stock by kind at moving average (cost permission).
create or replace function public.report_valuation(p_business_id uuid)
returns table (kind text, items bigint, value numeric, items_missing_cost bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_view_costs(p_business_id) then
    raise exception 'This report needs permission to see costs.' using errcode = '42501';
  end if;
  return query
  select i.kind, count(distinct i.id), round(sum(b.on_hand * i.avg_cost)), count(distinct i.id) filter (where i.cost_missing)
  from public.stock_balances b join public.stock_items i on i.id = b.stock_item_id
  where b.business_id = p_business_id
  group by 1 order by 1;
end;
$$;

-- Movement history in a period (lines), for export. Costs need cost permission.
create or replace function public.report_movements(p_business_id uuid, p_from date, p_to date)
returns table (document text, type text, effective date, item text, location text, quantity numeric, unit text, unit_cost numeric, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_costs boolean := app.can_view_costs(p_business_id);
  v_prod boolean := app.is_production(p_business_id);
begin
  perform app.require_office(p_business_id) where not v_prod;
  return query
  select d.number, d.doc_type, d.effective_date, i.name, l.name, m.quantity, i.base_unit, case when v_costs then round(m.unit_cost, 2) end, d.reason
  from public.stock_movements m
  join public.stock_documents d on d.id = m.document_id
  join public.stock_items i on i.id = m.stock_item_id
  join public.locations l on l.id = m.location_id
  where m.business_id = p_business_id and d.effective_date between p_from and p_to and (v_prod or i.kind = 'finished_good')
  order by d.effective_date, d.number, m.id;
end;
$$;

-- Items at or below their reorder level, and materials short for open jobs.
create or replace function public.report_shortages(p_business_id uuid)
returns table (code text, item text, available numeric, reorder_level numeric, needed_by_jobs numeric, short_by numeric, unit text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_production(p_business_id);
  return query
  with need as (
    select m.stock_item_id, sum(greatest(m.planned_qty_base - m.issued_qty_base + m.returned_qty_base
      - coalesce((select sum(r.qty_base) from public.stock_reservations r where r.source_type = 'production_job'
                  and r.source_id = j.id and r.stock_item_id = m.stock_item_id and r.status = 'active'), 0), 0)) as q
    from public.job_materials m join public.production_jobs j on j.id = m.job_id
    where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress')
    group by 1
  )
  select i.code, i.name, a.available, i.reorder_level, coalesce(n.q, 0),
    -- Whichever is larger: what open jobs still need beyond what's available, or the gap to the reorder level.
    greatest(coalesce(n.q, 0) - greatest(a.available, 0), coalesce(i.reorder_level, 0) - a.available, 0),
    i.base_unit
  from public.stock_items i
  join public.stock_availability a on a.stock_item_id = i.id
  left join need n on n.stock_item_id = i.id
  where i.business_id = p_business_id and i.archived_at is null and i.kind <> 'finished_good'
    and ((i.reorder_level is not null and a.available <= i.reorder_level) or coalesce(n.q, 0) > greatest(a.available, 0))
  order by 6 desc, i.name;
end;
$$;

-------------------------------------------------------------------------------
-- Production
-------------------------------------------------------------------------------
-- Open jobs with their age and value in work in progress (value needs cost permission).
create or replace function public.report_wip(p_business_id uuid)
returns table (job text, item text, maker text, status text, started date, age_days integer, due date, units_left numeric, wip_value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_costs boolean := app.can_view_costs(p_business_id);
begin
  perform app.require_production(p_business_id);
  return query
  select j.number, s.name, mk.name, j.status, j.start_date,
    case when j.start_date is not null then ((now() at time zone 'Africa/Lagos')::date - j.start_date) end,
    j.due_date, j.planned_qty - j.qty_passed - j.qty_rejected, case when v_costs then round(app.job_wip_value(j.id)) end
  from public.production_jobs j
  left join public.stock_items s on s.id = j.finished_item_id
  left join public.makers mk on mk.id = j.maker_id
  where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc')
  order by j.start_date nulls last, j.number;
end;
$$;

-- Planned vs actual material for jobs completed in the period.
create or replace function public.report_material_variance(p_business_id uuid, p_from date, p_to date)
returns table (job text, item text, material text, planned numeric, used numeric, variance numeric, variance_pct numeric, unit text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_production(p_business_id);
  return query
  select j.number, s.name, i.name, m.planned_qty_base, m.issued_qty_base - m.returned_qty_base,
    m.issued_qty_base - m.returned_qty_base - m.planned_qty_base,
    round(100 * (m.issued_qty_base - m.returned_qty_base - m.planned_qty_base) / nullif(m.planned_qty_base, 0), 1),
    i.base_unit
  from public.job_materials m
  join public.production_jobs j on j.id = m.job_id
  join public.stock_items i on i.id = m.stock_item_id
  left join public.stock_items s on s.id = j.finished_item_id
  where j.business_id = p_business_id and j.status = 'completed'
    and (j.completed_at at time zone 'Africa/Lagos')::date between p_from and p_to
  order by j.number, i.name;
end;
$$;

-- QC results in the period by product.
create or replace function public.report_qc(p_business_id uuid, p_from date, p_to date)
returns table (item text, inspected numeric, passed numeric, rework numeric, rejected numeric, failure_pct numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_production(p_business_id);
  return query
  select coalesce(s.name, 'Unknown'), sum(q.qty_inspected), sum(q.qty_passed), sum(q.qty_rework), sum(q.qty_rejected),
    round(100 * sum(q.qty_rework + q.qty_rejected) / nullif(sum(q.qty_inspected), 0), 1)
  from public.qc_inspections q
  join public.production_jobs j on j.id = q.job_id
  left join public.stock_items s on s.id = j.finished_item_id
  where q.business_id = p_business_id and q.inspected_on between p_from and p_to
  group by 1 order by 6 desc nulls last;
end;
$$;

-- Work per maker: open jobs, overdue jobs, units completed in the period.
create or replace function public.report_makers(p_business_id uuid, p_from date, p_to date)
returns table (maker text, external boolean, open_jobs bigint, overdue_jobs bigint, units_completed numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  perform app.require_production(p_business_id);
  return query
  select mk.name, mk.is_external,
    count(j.id) filter (where j.status in ('planned', 'allocated', 'in_progress', 'in_qc')),
    count(j.id) filter (where j.status in ('planned', 'allocated', 'in_progress', 'in_qc') and j.due_date < v_today),
    coalesce((select sum(q.qty_passed) from public.qc_inspections q join public.production_jobs j2 on j2.id = q.job_id
              where j2.maker_id = mk.id and q.inspected_on between p_from and p_to), 0)
  from public.makers mk
  left join public.production_jobs j on j.maker_id = mk.id
  where mk.business_id = p_business_id and mk.archived_at is null
  group by mk.id, mk.name, mk.is_external
  order by 4 desc, 3 desc, mk.name;
end;
$$;

-- Billed, paid and owed per supplier (owners).
create or replace function public.report_supplier_balances(p_business_id uuid)
returns table (supplier text, billed numeric, paid numeric, owed numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_owner(p_business_id);
  return query
  select s.name, b.billed::numeric, b.paid::numeric, b.balance::numeric
  from public.supplier_balances b join public.suppliers s on s.id = b.supplier_id
  where b.business_id = p_business_id and (b.billed <> 0 or b.paid <> 0)
  order by 4 desc;
end;
$$;

-------------------------------------------------------------------------------
-- Owner overview (one call for the home screen)
-------------------------------------------------------------------------------
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
  select
    (select coalesce(sum(s.total_minor), 0) from public.order_summaries s where s.business_id = p_business_id and s.status = 'open'
      and s.confirmed_at is not null and (s.confirmed_at at time zone 'Africa/Lagos')::date between p_from and p_to)::numeric,
    (select coalesce(sum(case when y.kind = 'refund' then -y.amount_minor else y.amount_minor end), 0) from public.payments y
      where y.business_id = p_business_id and y.voided_at is null and y.paid_on between p_from and p_to)::numeric,
    (select coalesce(sum(s.balance_minor), 0) from public.order_summaries s where s.business_id = p_business_id and s.status = 'open'
      and s.confirmed_at is not null and s.balance_minor > 0)::numeric,
    (select coalesce(sum(r.sales), 0) from public.report_sales_by_product(p_business_id, p_from, p_to) r),
    (select coalesce(sum(r.gross_profit), 0) from public.report_sales_by_product(p_business_id, p_from, p_to) r),
    (select coalesce(bool_and(r.cost_complete), true) from public.report_sales_by_product(p_business_id, p_from, p_to) r),
    (select coalesce(round(sum(b.on_hand * i.avg_cost)), 0) from public.stock_balances b join public.stock_items i on i.id = b.stock_item_id
      where b.business_id = p_business_id),
    (select coalesce(round(sum(app.job_wip_value(j.id))), 0) from public.production_jobs j
      where j.business_id = p_business_id and j.status in ('allocated', 'in_progress', 'in_qc')),
    (select coalesce(sum(greatest(b.balance, 0)), 0) from public.supplier_balances b where b.business_id = p_business_id)::numeric,
    (select count(*) from public.production_jobs j where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc')),
    (select count(*) from public.production_jobs j where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc') and j.due_date < v_today),
    (select count(*) from public.report_shortages(p_business_id));
end;
$$;

-------------------------------------------------------------------------------
-- Grants
-------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'report_sales_by_product(uuid,date,date)', 'report_sales_by_channel(uuid,date,date)', 'report_sales_by_period(uuid,date,date,text)',
    'report_cash(uuid,date,date)', 'report_balances(uuid)', 'report_orders_attention(uuid)', 'report_gross_profit(uuid,date,date)',
    'report_stock_by_location(uuid)', 'report_availability(uuid)', 'report_valuation(uuid)', 'report_movements(uuid,date,date)',
    'report_shortages(uuid)', 'report_wip(uuid)', 'report_material_variance(uuid,date,date)', 'report_qc(uuid,date,date)',
    'report_makers(uuid,date,date)', 'report_supplier_balances(uuid)', 'owner_overview(uuid,date,date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
    execute format('comment on function public.%s is %L', f, 'Intentional SECURITY DEFINER: checks the caller''s role first; costs, profit and supplier money only for permitted roles.');
  end loop;
end $$;
