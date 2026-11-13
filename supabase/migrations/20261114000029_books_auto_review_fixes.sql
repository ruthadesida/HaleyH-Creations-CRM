-- Books Phase B review fixes:
-- 1. Returns of items with no stock record now reverse the sale (posted on the return itself, not its stock document).
-- 2. Re-approving a maker's fee at an earlier amount posts again (one key per approval).
-- 3. Voiding a customer or repair payment recomputes the deposit/receivable split instead of mirroring it.
-- 4. Order discounts are shared across partial dispatches (and returns) cumulatively, so no kobo is lost.
-- 5. A stock reversal posts only when the document it reverses was posted.
-- 6. Customer postings take the books lock before reading the customer's position (no stale reads).
-- 7. Returns use the VAT rate of the sale; in-house labour (no maker) moves from production labour into WIP.
-- 8. Posting existing records works in batches; payment accounts must be cash, bank or clearing accounts.

-- Serialises customer postings per business before positions are read (post_journal takes the same lock).
create or replace function app.books_lock(p_business_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.books_settings where business_id = p_business_id for update;
end;
$$;

-- An order's discount on a cumulative value, rounded once, so the parts add up to the whole.
create or replace function app.books_order_discount(p_order uuid, p_value numeric)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when s.subtotal > 0 then round(o.discount_minor::numeric * least(p_value, s.subtotal) / s.subtotal)::bigint else 0 end
  from public.orders o
  cross join lateral (select coalesce(sum(x.unit_price_minor * x.quantity), 0) as subtotal from public.order_items x where x.order_id = o.id) s
  where o.id = p_order
$$;

-- Customer payment void: the money leg mirrors the payment; the deposit/receivable split is worked out afresh.
create or replace function app.books_void_customer_payment(
  p_business_id uuid, p_source_type text, p_source_id uuid, p_ref_type text, p_ref_id uuid, p_account uuid, p_change bigint, p_date date, p_reason text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.journals;
  v_id uuid;
  v_lines jsonb;
begin
  select * into j from public.journals
    where business_id = p_business_id and idempotency_key = app.books_key(p_source_type, p_source_id, 'post') for update;
  if not found or j.reversed_by_id is not null then return; end if;
  -- Drop zero lines (e.g. no receivable either side), as automatic posting does.
  select jsonb_agg(e) into v_lines from jsonb_array_elements(
    jsonb_build_array(app.books_line(p_business_id, p_account::text, -p_change))
      || app.books_position_lines(p_business_id, app.books_customer_position(p_business_id, p_ref_type, p_ref_id), -p_change)) e
  where (e ->> 'debit')::bigint <> 0 or (e ->> 'credit')::bigint <> 0;
  v_id := app.post_journal(p_business_id, app.books_open_date(p_business_id, greatest(p_date, j.effective_date)),
    left('Reversal of ' || j.number || ': ' || p_reason, 500), 'reversal', null, v_lines,
    app.books_key(p_source_type, p_source_id, 'post:void'), j.id, p_source_type, p_source_id, false, 'post:void', p_ref_type, p_ref_id);
  update public.journals set reversed_by_id = v_id where id = j.id and reversed_by_id is null;
end;
$$;

create or replace function app.books_post_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
  v_no text;
  v_change bigint;
  v_account uuid;
begin
  select * into p from public.payments where id = p_payment;
  if not found then return; end if;
  perform app.books_lock(p.business_id);
  select order_number into v_no from public.orders where id = p.order_id;
  v_change := case when p.kind = 'payment' then p.amount_minor else -p.amount_minor end;
  v_account := app.books_payment_account(p.business_id, p.method);
  if not exists (select 1 from public.journals where business_id = p.business_id and idempotency_key = app.books_key('payment', p.id, 'post')) then
    perform app.books_auto_post(p.business_id, 'payment', p.id, 'post', p.paid_on,
      case when p.kind = 'payment' then 'Payment received for ' else 'Refund paid for ' end || coalesce(v_no, 'an order'),
      jsonb_build_array(app.books_line(p.business_id, v_account::text, v_change))
        || app.books_position_lines(p.business_id, app.books_customer_position(p.business_id, 'order', p.order_id), v_change),
      'order', p.order_id);
  end if;
  if p.voided_at is not null then
    perform app.books_void_customer_payment(p.business_id, 'payment', p.id, 'order', p.order_id, v_account, v_change,
      (p.voided_at at time zone app.business_tz(p.business_id))::date, 'payment voided: ' || coalesce(p.void_reason, ''));
  end if;
end;
$$;

create or replace function app.books_post_repair_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.repair_payments;
  v_no text;
  v_change bigint;
  v_account uuid;
begin
  select * into p from public.repair_payments where id = p_payment;
  if not found then return; end if;
  perform app.books_lock(p.business_id);
  select number into v_no from public.repairs where id = p.repair_id;
  v_change := case when p.kind = 'payment' then p.amount_minor else -p.amount_minor end;
  v_account := app.books_payment_account(p.business_id, p.method);
  if not exists (select 1 from public.journals where business_id = p.business_id and idempotency_key = app.books_key('repair_payment', p.id, 'post')) then
    perform app.books_auto_post(p.business_id, 'repair_payment', p.id, 'post', p.paid_on,
      case when p.kind = 'payment' then 'Payment received for repair ' else 'Refund paid for repair ' end || coalesce(v_no, ''),
      jsonb_build_array(app.books_line(p.business_id, v_account::text, v_change))
        || app.books_position_lines(p.business_id, app.books_customer_position(p.business_id, 'repair', p.repair_id), v_change),
      'repair', p.repair_id);
  end if;
  if p.voided_at is not null then
    perform app.books_void_customer_payment(p.business_id, 'repair_payment', p.id, 'repair', p.repair_id, v_account, v_change,
      (p.voided_at at time zone app.business_tz(p.business_id))::date, 'payment voided: ' || coalesce(p.void_reason, ''));
  end if;
end;
$$;

create or replace function app.books_post_repair(p_repair uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.repairs;
  v_date date;
  v_rate numeric;
  v_net bigint;
begin
  select * into r from public.repairs where id = p_repair;
  if not found or r.status <> 'collected' or r.charge_minor = 0 then return; end if;
  perform app.books_lock(r.business_id);
  v_date := (coalesce(r.collected_at, now()) at time zone app.business_tz(r.business_id))::date;
  v_rate := coalesce(app.books_vat_rate(r.business_id, v_date), 0);
  v_net := app.books_net_of_vat(r.charge_minor, v_rate);
  perform app.books_auto_post(r.business_id, 'repair', r.id, 'revenue', v_date, 'Repair income: ' || r.number || ' collected',
    jsonb_build_array(app.books_line(r.business_id, 'repair_income', -v_net), app.books_line(r.business_id, 'vat_output', -(r.charge_minor - v_net)))
      || app.books_position_lines(r.business_id, app.books_customer_position(r.business_id, 'repair', r.id), -r.charge_minor),
    'repair', r.id);
end;
$$;

-- Revenue at dispatch, with the discount shared cumulatively across the order's dispatches.
create or replace function app.books_post_dispatch(p_dispatch uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dsp public.order_dispatches;
  o public.orders;
  v_no text;
  v_rate numeric;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_net_sum bigint := 0;
  v_net bigint;
  v_before numeric;
  v_this numeric;
  r record;
begin
  select * into dsp from public.order_dispatches where id = p_dispatch;
  if not found then return; end if;
  perform app.books_lock(dsp.business_id);
  select * into o from public.orders where id = dsp.order_id;
  select order_number into v_no from public.orders where id = o.id;
  v_rate := coalesce(app.books_vat_rate(dsp.business_id, dsp.dispatched_on), 0);
  select coalesce(sum(i.unit_price_minor * dl.quantity), 0) into v_before
  from public.order_dispatch_lines dl join public.order_dispatches e on e.id = dl.dispatch_id join public.order_items i on i.id = dl.order_item_id
  where e.order_id = o.id and (e.created_at, e.id) < (dsp.created_at, dsp.id);
  select coalesce(sum(i.unit_price_minor * dl.quantity), 0) into v_this
  from public.order_dispatch_lines dl join public.order_items i on i.id = dl.order_item_id where dl.dispatch_id = dsp.id;
  for r in
    select x.acct, sum(x.amount)::bigint as amount from (
      select case p.category when 'clothing' then 'sales_clothing' when 'shoes' then 'sales_shoes' when 'bags' then 'sales_bags' else 'sales_other' end as acct,
             -(i.unit_price_minor * dl.quantity) as amount
      from public.order_dispatch_lines dl
      join public.order_items i on i.id = dl.order_item_id
      left join public.products p on p.id = i.product_id
      where dl.dispatch_id = dsp.id
      union all
      select 'discounts', app.books_order_discount(o.id, v_before + v_this) - app.books_order_discount(o.id, v_before)
      union all
      select 'delivery_income', -o.delivery_fee_minor
      where not exists (select 1 from public.order_dispatches e where e.order_id = o.id and (e.created_at, e.id) < (dsp.created_at, dsp.id))
    ) x group by x.acct
  loop
    if r.amount <> 0 then
      v_net := app.books_net_of_vat(r.amount, v_rate);
      v_lines := v_lines || jsonb_build_array(app.books_line(dsp.business_id, r.acct, v_net));
      v_total := v_total + r.amount;
      v_net_sum := v_net_sum + v_net;
    end if;
  end loop;
  if v_total = 0 then return; end if;
  v_lines := v_lines || jsonb_build_array(app.books_line(dsp.business_id, 'vat_output', v_total - v_net_sum))
    || app.books_position_lines(dsp.business_id, app.books_customer_position(dsp.business_id, 'order', o.id), v_total);
  perform app.books_auto_post(dsp.business_id, 'order_dispatch', dsp.id, 'revenue', dsp.dispatched_on,
    'Sales: ' || coalesce(v_no, 'order') || ' dispatched (' || dsp.number || ')', v_lines, 'order', o.id);
end;
$$;

-- Returns reverse the returned lines (discount shared cumulatively across returns), at the sale's VAT rate.
-- Posted on the return itself, so items with no stock record are covered too.
create or replace function app.books_post_return(p_return uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rt public.order_returns;
  v_no text;
  v_rate numeric;
  v_before numeric;
  v_this numeric;
  v_gross bigint;
  v_net bigint;
  v_sale_date date;
begin
  select * into rt from public.order_returns where id = p_return;
  if not found or rt.received_on is null then return; end if;
  perform app.books_lock(rt.business_id);
  select order_number into v_no from public.orders where id = rt.order_id;
  select coalesce(sum(i.unit_price_minor * rl.quantity), 0) into v_before
  from public.order_return_lines rl join public.order_returns e on e.id = rl.return_id join public.order_items i on i.id = rl.order_item_id
  where e.order_id = rt.order_id and e.received_on is not null and (e.created_at, e.id) < (rt.created_at, rt.id);
  select coalesce(sum(i.unit_price_minor * rl.quantity), 0) into v_this
  from public.order_return_lines rl join public.order_items i on i.id = rl.order_item_id where rl.return_id = rt.id;
  v_gross := (v_this - (app.books_order_discount(rt.order_id, v_before + v_this) - app.books_order_discount(rt.order_id, v_before)))::bigint;
  if v_gross = 0 then return; end if;
  select max(dispatched_on) into v_sale_date from public.order_dispatches where order_id = rt.order_id and dispatched_on <= rt.received_on;
  v_rate := coalesce(app.books_vat_rate(rt.business_id, coalesce(v_sale_date, rt.received_on)), 0);
  v_net := app.books_net_of_vat(v_gross, v_rate);
  perform app.books_auto_post(rt.business_id, 'order_return', rt.id, 'revenue', rt.received_on,
    'Sales return: ' || coalesce(v_no, 'order') || ' (' || coalesce(rt.number, 'return') || ')',
    jsonb_build_array(app.books_line(rt.business_id, 'sales_returns', v_net), app.books_line(rt.business_id, 'vat_output', v_gross - v_net))
      || app.books_position_lines(rt.business_id, app.books_customer_position(rt.business_id, 'order', rt.order_id), v_gross),
    'order', rt.order_id);
end;
$$;

-- Stock: a reversal posts only when the document it reverses is in the books.
create or replace function app.books_post_stock_document(p_doc uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d public.stock_documents;
  v_type text;
  v_contra text;
  v_lines jsonb := '[]'::jsonb;
  v_total bigint := 0;
  r record;
  v_label text;
begin
  select * into d from public.stock_documents where id = p_doc;
  if not found then return; end if;
  v_type := case when d.doc_type = 'reversal' then (select doc_type from public.stock_documents where id = d.reverses_id) else d.doc_type end;
  if v_type = 'opening_balance' then return; end if;
  if d.doc_type = 'reversal' and not exists (
       select 1 from public.journals where business_id = d.business_id and idempotency_key = app.books_key('stock_document', d.reverses_id, 'post')) then
    return;
  end if;
  v_contra := case v_type
    when 'purchase_receipt' then 'grni' when 'supplier_return' then 'grni'
    when 'material_issue' then 'inv_wip' when 'material_return' then 'inv_wip' when 'production_completion' then 'inv_wip'
    when 'customer_dispatch' then 'cogs' when 'customer_return' then 'cogs'
    when 'scrap' then 'stock_writeoffs' when 'adjustment' then 'stock_writeoffs'
    else 'rounding' end;
  for r in
    select case when l.kind = 'quarantine' then 'inv_quarantine' when i.kind = 'finished_good' then 'inv_finished' else 'inv_raw' end as acct,
           round(sum(m.quantity * m.unit_cost))::bigint as amt
    from public.stock_movements m
    join public.locations l on l.id = m.location_id
    join public.stock_items i on i.id = m.stock_item_id
    where m.document_id = d.id
    group by 1
  loop
    if r.amt <> 0 then
      v_lines := v_lines || jsonb_build_array(app.books_line(d.business_id, r.acct, r.amt));
      v_total := v_total + r.amt;
    end if;
  end loop;
  if v_total <> 0 then
    v_lines := v_lines || jsonb_build_array(app.books_line(d.business_id, v_contra, -v_total));
  end if;
  v_label := case v_type
    when 'purchase_receipt' then 'goods received' when 'supplier_return' then 'returned to supplier'
    when 'material_issue' then 'materials issued to production' when 'material_return' then 'materials returned from production'
    when 'production_completion' then 'finished goods from production' when 'customer_dispatch' then 'cost of goods dispatched'
    when 'customer_return' then 'customer return into Quarantine' when 'scrap' then 'written off'
    when 'adjustment' then 'stock count adjustment' when 'transfer' then 'moved between Quarantine and stock' else v_type end;
  perform app.books_auto_post(d.business_id, 'stock_document', d.id, 'post', d.effective_date,
    'Stock ' || d.number || ': ' || v_label || case when d.doc_type = 'reversal' then ' (reversal)' else '' end, v_lines,
    case when d.source_type = 'production_job' then 'job' end, case when d.source_type = 'production_job' then d.source_id end);
  if v_type = 'production_completion' and d.source_type = 'production_job' and d.doc_type <> 'reversal' then
    perform app.books_post_job_labour(d.source_id);
  end if;
end;
$$;

-- Labour joins WIP at the first completion: owed to the maker, or (no maker: in-house work) moved out of production labour.
create or replace function app.books_post_job_labour(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.production_jobs;
  v_labour bigint;
  v_other bigint;
  v_date date;
begin
  select * into j from public.production_jobs where id = p_job;
  if not found then return; end if;
  select min(d.effective_date) into v_date from public.stock_documents d
    where d.source_type = 'production_job' and d.source_id = j.id and d.doc_type = 'production_completion';
  if v_date is null then return; end if;
  v_labour := round(j.labour_cost)::bigint;
  v_other := round(j.other_cost)::bigint;
  perform app.books_auto_post(j.business_id, 'production_job', j.id, 'labour', v_date,
    'Job ' || j.number || ': labour and other direct costs added to work in progress',
    jsonb_build_array(app.books_line(j.business_id, 'inv_wip', v_labour + v_other),
      app.books_line(j.business_id, case when j.maker_id is null then 'production_labour' else 'maker_payables' end, -v_labour),
      app.books_line(j.business_id, 'accruals', -v_other)),
    'job', j.id);
  perform app.books_post_job_fee(j.id);
end;
$$;

-- Each fee approval gets its own key; the amount posted is whatever brings the total to the latest approval.
create or replace function app.books_post_job_fee(p_job uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  j public.production_jobs;
  v_posted bigint;
  v_diff bigint;
begin
  select * into j from public.production_jobs where id = p_job;
  if not found or j.fee_approved is null or j.maker_id is null then return; end if;
  if not exists (select 1 from public.journals where business_id = j.business_id and idempotency_key = app.books_key('production_job', j.id, 'labour')) then
    return;
  end if;
  perform app.books_lock(j.business_id);
  select coalesce(sum(l.debit_minor - l.credit_minor), 0) into v_posted
  from public.journal_lines l join public.journals jn on jn.id = l.journal_id join public.accounts a on a.id = l.account_id
  where jn.business_id = j.business_id and jn.source_type = 'production_job' and jn.source_id = j.id
    and jn.source_part like 'fee:%' and a.system_key = 'production_labour';
  v_diff := j.fee_approved - round(j.labour_cost)::bigint - v_posted;
  perform app.books_auto_post(j.business_id, 'production_job', j.id,
    'fee:' || to_char(coalesce(j.fee_approved_at, now()) at time zone 'UTC', 'YYYYMMDDHH24MISSUS'),
    coalesce((j.fee_approved_at at time zone app.business_tz(j.business_id))::date, (now() at time zone app.business_tz(j.business_id))::date),
    'Job ' || j.number || ': maker''s approved fee differs from the planned labour',
    jsonb_build_array(app.books_line(j.business_id, 'production_labour', v_diff), app.books_line(j.business_id, 'maker_payables', -v_diff)),
    'job', j.id);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['books_lock(uuid)', 'books_order_discount(uuid, numeric)',
    'books_void_customer_payment(uuid, text, uuid, text, uuid, uuid, bigint, date, text)'] loop
    execute format('revoke all on function app.%s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- Returns post when created (lines are in by commit), whether or not stock came back.
drop trigger if exists books_post_return_received on public.order_returns;

-- Posting existing records in batches, oldest first. Returns where to carry on (null when done).
drop function if exists public.books_post_existing(uuid);
create or replace function public.books_post_existing(
  p_business_id uuid, p_after_date date default null, p_after_created timestamptz default null, p_after_id uuid default null,
  p_limit integer default 200
)
returns table (posted integer, problems integer, next_date date, next_created timestamptz, next_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_from date;
  v_before integer;
  v_n integer := 0;
  v_last record;
  r record;
begin
  perform app.require_owner_books(p_business_id);
  v_from := app.books_auto_from(p_business_id);
  if v_from is null then
    raise exception 'Add a financial year kept in the app first (close the imported year).' using errcode = 'P0001';
  end if;
  select count(*) into v_before from public.journals where business_id = p_business_id and kind in ('auto', 'reversal');
  -- The first batch retries earlier problems.
  if p_after_id is null then
    for r in select source_type, source_id from public.books_posting_problems where business_id = p_business_id loop
      perform app.books_safe(p_business_id, r.source_type, r.source_id);
    end loop;
  end if;
  for r in
    select * from (
      select 'stock_document' as t, id, effective_date as d, created_at as c from public.stock_documents where business_id = p_business_id and effective_date >= v_from
      union all select 'payment', id, paid_on, created_at from public.payments where business_id = p_business_id and paid_on >= v_from
      union all select 'order_dispatch', id, dispatched_on, created_at from public.order_dispatches where business_id = p_business_id and dispatched_on >= v_from
      union all select 'order_return', id, received_on, created_at from public.order_returns where business_id = p_business_id and received_on >= v_from
      union all select 'repair_payment', id, paid_on, created_at from public.repair_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'repair', id, (collected_at at time zone app.business_tz(business_id))::date, collected_at from public.repairs
        where business_id = p_business_id and status = 'collected' and collected_at is not null and (collected_at at time zone app.business_tz(business_id))::date >= v_from
      union all select 'supplier_bill', id, bill_date, created_at from public.supplier_bills where business_id = p_business_id and bill_date >= v_from
      union all select 'supplier_payment', id, paid_on, created_at from public.supplier_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'maker_payment', id, paid_on, created_at from public.maker_payments where business_id = p_business_id and paid_on >= v_from
      union all select 'production_job', id, (fee_approved_at at time zone app.business_tz(business_id))::date, fee_approved_at from public.production_jobs
        where business_id = p_business_id and fee_approved is not null and fee_approved_at is not null
    ) e
    where p_after_id is null or (e.d, e.c, e.id) > (p_after_date, p_after_created, p_after_id)
    order by e.d, e.c, e.id
    limit greatest(least(coalesce(p_limit, 200), 1000), 1)
  loop
    perform app.books_safe(p_business_id, r.t, r.id);
    v_n := v_n + 1;
    v_last := r;
  end loop;
  return query select (select count(*)::integer from public.journals where business_id = p_business_id and kind in ('auto', 'reversal')) - v_before,
    (select count(*)::integer from public.books_posting_problems where business_id = p_business_id),
    case when v_n >= greatest(least(coalesce(p_limit, 200), 1000), 1) then v_last.d end,
    case when v_n >= greatest(least(coalesce(p_limit, 200), 1000), 1) then v_last.c end,
    case when v_n >= greatest(least(coalesce(p_limit, 200), 1000), 1) then v_last.id end;
end;
$$;
revoke all on function public.books_post_existing from public, anon;
grant execute on function public.books_post_existing to authenticated;

-- Payments land only in cash, bank or clearing accounts (not stock, receivables or fixed assets).
create or replace function public.set_books_payment_account(p_business_id uuid, p_method public.payment_method, p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_owner_books(p_business_id);
  if p_account_id is null then
    delete from public.books_payment_accounts where business_id = p_business_id and method = p_method;
    return;
  end if;
  if not exists (select 1 from public.accounts where id = p_account_id and business_id = p_business_id and archived_at is null
                 and account_group = 'current_assets' and (system_key is null or system_key in ('cash', 'bank_main', 'clearing'))) then
    raise exception 'Choose a bank, cash or clearing account.' using errcode = 'P0001';
  end if;
  insert into public.books_payment_accounts (business_id, method, account_id) values (p_business_id, p_method, p_account_id)
  on conflict (business_id, method) do update set account_id = excluded.account_id;
end;
$$;
