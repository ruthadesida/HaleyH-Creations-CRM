-- Backlog: reports use each business's own time zone; a list of customer returns waiting for inspection
-- (for production staff, without customer details or prices); exchanges linked to their replacement order.

-------------------------------------------------------------------------------
-- 1. The business's time zone (Settings → time zone), for "today" and for turning timestamps into days.
--    Stock-posting checks ("not in the future") still use Lagos time; see docs/DECISIONS.md.
-------------------------------------------------------------------------------
create or replace function app.business_tz(p_business_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from public.businesses where id = p_business_id), 'Africa/Lagos')
$$;
revoke all on function app.business_tz from public, anon, authenticated;

-- A time zone Postgres doesn't know would break every report for that business: refuse it when saved.
create or replace function app.check_business_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %.', new.timezone using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_timezone_check on public.businesses;
create trigger businesses_timezone_check before insert or update of timezone on public.businesses
  for each row execute function app.check_business_timezone();
-- Report, overview and notification functions, unchanged except for the time zone.
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

create or replace function public.owner_overview(p_business_id uuid, p_from date, p_to date)
returns table (confirmed_value numeric, cash_received numeric, owed_by_customers numeric, fulfilled_sales numeric,
  gross_profit numeric, profit_complete boolean, stock_value numeric, wip_value numeric, owed_to_suppliers numeric,
  open_jobs bigint, overdue_jobs bigint, shortages bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
begin
  perform app.require_owner(p_business_id);
  return query
  with sp as (
    select coalesce(sum(r.sales), 0) as sales, coalesce(sum(r.gross_profit), 0) as profit, coalesce(bool_and(r.cost_complete), true) as complete
    from public.report_sales_by_product(p_business_id, p_from, p_to) r
  )
  select
    (select coalesce(sum(s.total_minor), 0) from public.order_summaries s where s.business_id = p_business_id and s.status = 'open'
      and s.confirmed_at is not null and (s.confirmed_at at time zone app.business_tz(p_business_id))::date between p_from and p_to)::numeric,
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

create or replace function public.report_makers(p_business_id uuid, p_from date, p_to date)
returns table (maker text, external boolean, open_jobs bigint, overdue_jobs bigint, units_completed numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
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
    and (j.completed_at at time zone app.business_tz(p_business_id))::date between p_from and p_to
  order by j.number, i.name;
end;
$$;

create or replace function public.report_orders_attention(p_business_id uuid)
returns table (order_number text, customer text, promised date, progress text, owed numeric, needs text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone app.business_tz(p_business_id))::date;
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

create or replace function public.report_sales_by_channel(p_business_id uuid, p_from date, p_to date)
returns table (channel text, orders bigint, order_value numeric, received numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_office(p_business_id);
  return query
  select coalesce(s.channel::text, 'not recorded'), count(*), sum(s.total_minor)::numeric, sum(s.net_paid_minor)::numeric
  from public.order_summaries s
  where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
    and (s.confirmed_at at time zone app.business_tz(p_business_id))::date between p_from and p_to
  group by 1 order by 3 desc;
end;
$$;

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
    select date_trunc(v_grain, (s.confirmed_at at time zone app.business_tz(p_business_id)))::date as p, sum(s.total_minor) as v
    from public.order_summaries s
    where s.business_id = p_business_id and s.status = 'open' and s.confirmed_at is not null
      and (s.confirmed_at at time zone app.business_tz(p_business_id))::date between p_from and p_to
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

create or replace function public.report_wip(p_business_id uuid)
returns table (job text, item text, maker text, status text, started date, age_days integer, due date, units_left numeric, wip_value numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_costs boolean := app.can_view_costs(p_business_id);
begin
  perform app.require_production(p_business_id);
  return query
  select j.number, s.name, mk.name, j.status, j.start_date,
    case when j.start_date is not null then ((now() at time zone app.business_tz(p_business_id))::date - j.start_date) end,
    j.due_date, j.planned_qty - j.qty_passed - j.qty_rejected, case when v_costs then round(app.job_wip_value(j.id)) end
  from public.production_jobs j
  left join public.stock_items s on s.id = j.finished_item_id
  left join public.makers mk on mk.id = j.maker_id
  where j.business_id = p_business_id and j.status in ('planned', 'allocated', 'in_progress', 'in_qc')
  order by j.start_date nulls last, j.number;
end;
$$;


-------------------------------------------------------------------------------
-- 2. Returns waiting for inspection, for owners, the front office and the production manager.
--    Only what inspection needs: the item, quantity, condition and reason; no customer, price or payment.
-------------------------------------------------------------------------------
create or replace function public.returns_to_inspect(p_business_id uuid)
returns table (line_id uuid, return_number text, order_number text, received_on date, item text, quantity integer,
  condition text, reason text, kind text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.is_production(p_business_id) or app.is_office(p_business_id)) then
    raise exception 'You do not have permission to inspect returns.' using errcode = '42501';
  end if;
  return query
  select l.id, r.number, o.order_number, r.received_on, i.description, l.quantity, l.condition, r.reason, r.kind::text
  from public.order_return_lines l
  join public.order_returns r on r.id = l.return_id
  join public.orders o on o.id = r.order_id
  join public.order_items i on i.id = l.order_item_id
  where l.business_id = p_business_id and l.decision is null
  order by r.received_on, r.number, i.description;
end;
$$;
revoke all on function public.returns_to_inspect from public, anon;
grant execute on function public.returns_to_inspect to authenticated;
comment on function public.returns_to_inspect is 'Intentional SECURITY DEFINER: checks the caller''s role; returns no customer, price or payment data.';

-------------------------------------------------------------------------------
-- 3. Link an exchange to the new order that replaces it (same customer, front office or owner).
-------------------------------------------------------------------------------
create or replace function public.link_exchange_replacement(p_return uuid, p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.order_returns;
  v_original_customer uuid;
  v_new public.orders;
begin
  select * into r from public.order_returns where id = p_return;
  if r.id is null or not app.is_office(r.business_id) then
    raise exception 'You do not have permission to link exchanges.' using errcode = '42501';
  end if;
  perform 1 from public.businesses where id = r.business_id for update;
  select * into r from public.order_returns where id = p_return for update;
  if r.kind <> 'exchange' then
    raise exception 'Only an exchange has a replacement order.' using errcode = 'P0001';
  end if;
  select * into v_new from public.orders where id = p_order and business_id = r.business_id;
  if v_new.id is null or v_new.id = r.order_id then
    raise exception 'Choose the new order that replaces the exchanged items.' using errcode = 'P0001';
  end if;
  if v_new.status = 'cancelled' then
    raise exception 'That order is cancelled. Choose an open order.' using errcode = 'P0001';
  end if;
  select customer_id into v_original_customer from public.orders where id = r.order_id;
  if v_new.customer_id <> v_original_customer then
    raise exception 'The replacement order must be for the same customer.' using errcode = 'P0001';
  end if;
  -- A replacement that was later cancelled can be swapped for a new one; an open one stays.
  if r.replacement_order_id is not null and exists (select 1 from public.orders where id = r.replacement_order_id and status <> 'cancelled') then
    if r.replacement_order_id = p_order then return; end if;
    raise exception 'This exchange already has a replacement order.' using errcode = 'P0001';
  end if;
  update public.order_returns set replacement_order_id = p_order where id = p_return;
end;
$$;
revoke all on function public.link_exchange_replacement from public, anon;
grant execute on function public.link_exchange_replacement to authenticated;
comment on function public.link_exchange_replacement is 'Intentional SECURITY DEFINER: front office or owner of the same business; same customer only.';