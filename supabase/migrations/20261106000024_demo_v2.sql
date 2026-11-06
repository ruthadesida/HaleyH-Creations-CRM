-- Demo workspace, rebuilt for the full system (owner request 2026-11-06: test everything in the demo before
-- real data goes in). Every record is fictional and named "Demo". Unlike the first version, the demo is built
-- through the same functions staff use, so stock, costs, reservations, production and money all follow the
-- real rules: opening stock with costs, a purchase received, a recipe, production jobs (one finished through
-- QC, one waiting on its tailor), orders at every stage (quotation, deposit paid, dispatched and delivered,
-- returned to Quarantine), repairs at every stage, enquiries and follow-ups.
--
-- reset_demo_workspace() archives the caller's demo (nothing is deleted) and builds a fresh one.

create or replace function public.create_demo_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_biz uuid;
  d date := (now() at time zone 'Africa/Lagos')::date;
  l_store uuid; l_show uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  p_dress uuid; p_kaftan uuid; p_mules uuid; p_tote uuid;
  v_wrap10 uuid; v_wrap12 uuid; v_kaf_m uuid; v_kaf_l uuid; v_mule40 uuid; v_tote uuid;
  i_fab uuid; i_lin uuid; i_zip uuid;
  m_tunde uuid; m_musa uuid; s_fab uuid;
  v_bom uuid; v_po uuid; v_job uuid;
  o1 uuid; o2 uuid; o3 uuid; o4 uuid;
  r1 uuid; r2 uuid; r3 uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  -- One demo at a time: open the existing one (owned, or joined by invite).
  select b.id into v_biz
    from public.businesses b join public.memberships m on m.business_id = b.id
    where m.user_id = v_uid and m.status = 'active' and b.is_demo and b.archived_at is null
    limit 1;
  if v_biz is not null then
    return v_biz;
  end if;

  insert into public.businesses (name, slug, currency, timezone, order_prefix, is_demo, created_by, cutover_date)
    values ('Demo boutique', 'demo-' || substr(replace(v_uid::text, '-', ''), 1, 8) || '-' || substr(md5(random()::text), 1, 4),
      'NGN', 'Africa/Lagos', 'DEMO', true, v_uid, d - 30)
    returning id into v_biz;
  insert into public.memberships (business_id, user_id, role) values (v_biz, v_uid, 'owner');
  insert into public.business_subscriptions (business_id, status, notes) values (v_biz, 'trial', 'Demo workspace');
  select id into l_store from public.locations where business_id = v_biz and kind = 'store';
  select id into l_show from public.locations where business_id = v_biz and kind = 'showroom';

  -- People.
  insert into public.customers (business_id, full_name, phone, whatsapp, email, city, state, source,
      clothing_size, shoe_size, tags, contact_preferences, marketing_consent, created_by)
    values (v_biz, 'Demo: Ada Okafor', '08030000001', '08030000001', 'ada.demo@example.com', 'Lekki', 'Lagos',
      'instagram', 'UK 12', '40', array['repeat customer'], array['whatsapp'], true, v_uid)
    returning id into c1;
  insert into public.customers (business_id, full_name, phone, whatsapp, city, state, source,
      clothing_size, bust, waist, hip, measurement_unit, measured_on, fit_notes, tags, contact_preferences, created_by)
    values (v_biz, 'Demo: Tolu Bello', '08030000002', '08030000002', 'Ikeja', 'Lagos', 'whatsapp',
      'UK 10', 92, 74, 100, 'cm', d - 10, 'Prefers a relaxed fit at the waist.', array['new customer'], array['whatsapp', 'phone'], v_uid)
    returning id into c2;
  insert into public.customers (business_id, full_name, phone, city, state, source, tags, created_by)
    values (v_biz, 'Demo: Ngozi Eze', '08030000003', 'Wuse', 'Abuja', 'walk_in', array['wholesale'], v_uid)
    returning id into c3;
  insert into public.customers (business_id, full_name, phone, email, city, state, source, created_by)
    values (v_biz, 'Demo: Kemi Adeyemi', '08030000004', 'kemi.demo@example.com', 'Ibadan', 'Oyo', 'referral', v_uid)
    returning id into c4;
  insert into public.makers (business_id, name, trade, is_external, phone)
    values (v_biz, 'Demo: Tunde Bakare', 'tailor', false, '08030000010') returning id into m_tunde;
  insert into public.makers (business_id, name, trade, is_external, phone, notes)
    values (v_biz, 'Demo: Musa Ibrahim', 'shoemaker', true, '08030000011', 'Works from his own shop in Yaba') returning id into m_musa;
  insert into public.suppliers (business_id, name, phone)
    values (v_biz, 'Demo: Balogun Market Fabrics', '08030000020') returning id into s_fab;

  -- Products and their sizes/colours (each variant gets its stock item, coded by its SKU).
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo Ankara wrap dress', 'clothing', 4500000, 'made_to_order') returning id into p_dress;
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo Adire kaftan', 'clothing', 3800000, 'ready_made') returning id into p_kaftan;
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo leather mules', 'shoes', 2500000, 'ready_made') returning id into p_mules;
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo woven tote', 'bags', 1800000, 'ready_made') returning id into p_tote;
  insert into public.product_variants (business_id, product_id, size, colour, sku)
    values (v_biz, p_dress, 'UK 10', 'Blue print', 'DEMO-WRAP-10') returning id into v_wrap10;
  insert into public.product_variants (business_id, product_id, size, colour, sku)
    values (v_biz, p_dress, 'UK 12', 'Blue print', 'DEMO-WRAP-12') returning id into v_wrap12;
  insert into public.product_variants (business_id, product_id, size, colour, sku)
    values (v_biz, p_kaftan, 'M', 'Indigo', 'DEMO-KAF-M') returning id into v_kaf_m;
  insert into public.product_variants (business_id, product_id, size, colour, sku)
    values (v_biz, p_kaftan, 'L', 'Indigo', 'DEMO-KAF-L') returning id into v_kaf_l;
  insert into public.product_variants (business_id, product_id, size, colour, sku)
    values (v_biz, p_mules, '40', 'Tan', 'DEMO-MULE-40') returning id into v_mule40;
  insert into public.product_variants (business_id, product_id, size, colour, sku)
    values (v_biz, p_mules, '39', 'Tan', 'DEMO-MULE-39');
  insert into public.product_variants (business_id, product_id, colour, sku)
    values (v_biz, p_tote, 'Natural', 'DEMO-TOTE') returning id into v_tote;

  -- Opening stock with costs: materials in the store, finished goods in the showroom.
  perform public.post_opening_batch(public.save_opening_batch(v_biz, 'demo-opening-stock.csv', 'Demo opening stock', jsonb_build_array(
    jsonb_build_object('line', 2, 'code', 'DEMO-FAB', 'name', 'Demo Ankara fabric', 'kind', 'raw_material', 'base_unit', 'm',
      'location_id', l_store, 'quantity', 60, 'unit', 'm', 'unit_cost', '350000'),
    jsonb_build_object('line', 3, 'code', 'DEMO-LIN', 'name', 'Demo lining', 'kind', 'raw_material', 'base_unit', 'm',
      'location_id', l_store, 'quantity', 40, 'unit', 'm', 'unit_cost', '120000'),
    jsonb_build_object('line', 4, 'code', 'DEMO-ZIP', 'name', 'Demo invisible zip 20 cm', 'kind', 'raw_material', 'base_unit', 'pc',
      'location_id', l_store, 'quantity', 100, 'unit', 'pc', 'unit_cost', '15000'),
    jsonb_build_object('line', 5, 'code', 'DEMO-KAF-M', 'location_id', l_show, 'quantity', 4, 'unit', 'pc', 'unit_cost', '1500000'),
    jsonb_build_object('line', 6, 'code', 'DEMO-KAF-L', 'location_id', l_show, 'quantity', 3, 'unit', 'pc', 'unit_cost', '1500000'),
    jsonb_build_object('line', 7, 'code', 'DEMO-MULE-40', 'location_id', l_show, 'quantity', 3, 'unit', 'pc', 'unit_cost', '900000'),
    jsonb_build_object('line', 8, 'code', 'DEMO-TOTE', 'location_id', l_show, 'quantity', 6, 'unit', 'pc', 'unit_cost', '600000'))),
    gen_random_uuid());
  select id into i_fab from public.stock_items where business_id = v_biz and code = 'DEMO-FAB';
  select id into i_lin from public.stock_items where business_id = v_biz and code = 'DEMO-LIN';
  select id into i_zip from public.stock_items where business_id = v_biz and code = 'DEMO-ZIP';
  update public.stock_items set reorder_level = 20 where id = i_fab;
  -- Cost prices on products (used for profit where an item has no ledger cost).
  perform public.set_product_cost(p_dress, null, 1800000);
  perform public.set_product_cost(p_mules, null, 900000);

  -- Purchasing: an approved order for more fabric, received in full with the supplier's bill, part-paid.
  v_po := public.save_purchase_order(v_biz, null, s_fab, d + 3, 'Demo: restock Ankara',
    jsonb_build_array(jsonb_build_object('item', i_fab, 'qty', 30, 'unit', 'm', 'unit_price', 380000)));
  perform public.approve_purchase_order(v_po);
  perform public.receive_goods(v_biz, v_po, null, l_store, d, 'DEMO-INV-001', 0,
    jsonb_build_array(jsonb_build_object('po_line', (select id from public.purchase_order_lines where po_id = v_po limit 1), 'accepted', 30)),
    true, gen_random_uuid());
  perform public.record_supplier_payment(v_biz, s_fab, null, d, 5000000, 'bank_transfer', 'DEMO-PAY-001');

  -- Production: the wrap dress recipe, and a stock run of 2 finished through QC.
  v_bom := public.save_bom(v_biz, null, p_dress, 'Demo wrap dress', false, 500000, 0, 'Double-stitch the hem. Press before QC.',
    jsonb_build_array(
      jsonb_build_object('item', i_fab, 'qty', 3, 'unit', 'm', 'wastage_pct', 5),
      jsonb_build_object('item', i_lin, 'qty', 2, 'unit', 'm'),
      jsonb_build_object('item', i_zip, 'qty', 1, 'unit', 'pc')));
  perform public.activate_bom(v_bom);
  v_job := public.create_production_job(v_biz, v_wrap10, 2, v_bom, m_tunde, d + 7, 'Demo: stock run for the showroom', gen_random_uuid());
  perform public.allocate_job_materials(v_job);
  perform public.issue_job_materials(v_job, l_store, d, jsonb_build_array(
    jsonb_build_object('item', i_fab, 'qty', 6.3), jsonb_build_object('item', i_lin, 'qty', 4), jsonb_build_object('item', i_zip, 'qty', 2)),
    gen_random_uuid());
  perform public.submit_job_for_qc(v_job);
  perform public.record_qc_inspection(v_job, 2, 0, 0, '{}'::jsonb, null, null, l_show, d, gen_random_uuid());

  -- Enquiries.
  insert into public.enquiries (business_id, customer_id, product_interest, product_id, source, stage, next_action, follow_up_at, assigned_to, created_by)
    values (v_biz, c2, 'Ankara wrap dress for a wedding', p_dress, 'whatsapp', 'choosing', 'Send fabric options', now() - interval '1 day', v_uid, v_uid);
  insert into public.enquiries (business_id, customer_id, product_interest, source, stage, next_action, follow_up_at, assigned_to, created_by)
    values
      (v_biz, c4, 'Leather mules, size 40', 'referral', 'new', 'Call to confirm colour', now() + interval '3 hours', v_uid, v_uid),
      (v_biz, c3, 'Wholesale totes (20 units)', 'walk_in', 'awaiting_payment', 'Confirm deposit received', now() + interval '1 day', v_uid, v_uid),
      (v_biz, c1, 'Matching kaftan for husband', 'instagram', 'contacted', 'Share size chart', now() + interval '2 days', v_uid, v_uid);
  insert into public.enquiries (business_id, customer_id, product_interest, source, stage, lost_reason, created_by)
    values (v_biz, c4, 'Beaded clutch', 'instagram', 'lost', 'Found a cheaper option elsewhere', v_uid);

  -- Order 1 (Ada): a made-to-order dress and ready-made mules, confirmed with a deposit. The dress goes to
  -- production with its recipe; the tailor is assigned and the materials reserved, not yet issued.
  o1 := public.create_order(v_biz, c1, jsonb_build_array(
      jsonb_build_object('description', 'Demo Ankara wrap dress', 'variant_id', v_wrap12, 'product_id', p_dress, 'size', 'UK 12', 'colour', 'Blue print',
        'quantity', 1, 'unit_price_minor', 4500000, 'item_type', 'made_to_order'),
      jsonb_build_object('description', 'Demo leather mules', 'variant_id', v_mule40, 'product_id', p_mules, 'size', '40', 'colour', 'Tan',
        'quantity', 1, 'unit_price_minor', 2500000, 'item_type', 'ready_made')),
    gen_random_uuid(), null, 'instagram', d + 5, 0, 300000, 'home_delivery', '12 Demo Close', 'Lekki', 'Lagos', null, 'Call before delivery');
  perform public.confirm_order(o1);
  insert into public.payments (business_id, order_id, kind, amount_minor, method, reference, paid_on)
    values (v_biz, o1, 'payment', 3500000, 'bank_transfer', 'DEMO-REF-001', d);
  select j.id into v_job from public.production_jobs j join public.order_items i on i.id = j.order_item_id
    where i.order_id = o1 limit 1;
  perform public.assign_job_maker(v_job, m_tunde, d + 4);
  perform public.allocate_job_materials(v_job);

  -- Order 2 (Ngozi): 3 totes, paid in full, dispatched and delivered.
  o2 := public.create_order(v_biz, c3, jsonb_build_array(
      jsonb_build_object('description', 'Demo woven tote', 'variant_id', v_tote, 'product_id', p_tote, 'colour', 'Natural',
        'quantity', 3, 'unit_price_minor', 1800000, 'item_type', 'ready_made')),
    gen_random_uuid(), null, 'walk_in', null, 0, 0, 'station_pickup', null, null, null, 'Demo park, Wuse');
  perform public.confirm_order(o2);
  insert into public.payments (business_id, order_id, kind, amount_minor, method, paid_on) values (v_biz, o2, 'payment', 5400000, 'cash', d);
  perform public.dispatch_order(o2, l_show, d, 'Demo Couriers', 'DEMO-TRK-778',
    (select jsonb_agg(jsonb_build_object('item', id, 'qty', quantity)) from public.order_items where order_id = o2), gen_random_uuid());
  perform public.mark_order_delivered(o2);

  -- Order 3 (Tolu): a quotation, not yet confirmed (reserves nothing, not a sale).
  o3 := public.create_order(v_biz, c2, jsonb_build_array(
      jsonb_build_object('description', 'Demo Adire kaftan', 'variant_id', v_kaf_m, 'product_id', p_kaftan, 'size', 'M', 'colour', 'Indigo',
        'quantity', 1, 'unit_price_minor', 3800000, 'item_type', 'ready_made')),
    gen_random_uuid(), null, 'whatsapp', d + 3);

  -- Order 4 (Kemi): a kaftan sold and sent, then returned: waiting in Quarantine for inspection.
  o4 := public.create_order(v_biz, c4, jsonb_build_array(
      jsonb_build_object('description', 'Demo Adire kaftan', 'variant_id', v_kaf_l, 'product_id', p_kaftan, 'size', 'L', 'colour', 'Indigo',
        'quantity', 1, 'unit_price_minor', 3800000, 'item_type', 'ready_made')),
    gen_random_uuid(), null, 'referral');
  perform public.confirm_order(o4);
  insert into public.payments (business_id, order_id, kind, amount_minor, method, reference, paid_on)
    values (v_biz, o4, 'payment', 3800000, 'pos', 'DEMO-POS-114', d);
  perform public.dispatch_order(o4, l_show, d, null, null,
    (select jsonb_agg(jsonb_build_object('item', id, 'qty', quantity)) from public.order_items where order_id = o4), gen_random_uuid());
  perform public.receive_customer_return(o4, 'return', 'Too tight across the shoulders', d,
    (select jsonb_agg(jsonb_build_object('item', id, 'qty', 1)) from public.order_items where order_id = o4), gen_random_uuid());

  -- Repairs: one in progress with a deposit, one ready for collection and paid, one just received with no maker.
  r1 := public.create_repair(v_biz, c1, 'Demo agbada', 'Torn sleeve; re-stitch the hem', d - 2, d + 2, 800000, m_tunde, null);
  perform public.set_repair_status(r1, 'in_repair', null);
  perform public.record_repair_payment(r1, 'payment', 300000, 'cash', d, null);
  r2 := public.create_repair(v_biz, c3, 'Demo leather handbag', 'Broken strap; replace the buckle', d - 5, d + 1, 500000, m_musa, null);
  perform public.set_repair_status(r2, 'ready', null);
  perform public.record_repair_payment(r2, 'payment', 500000, 'bank_transfer', d, 'DEMO-REF-202');
  r3 := public.create_repair(v_biz, c4, 'Demo Ankara skirt', 'Take in the waist by 2 cm', d, d + 4, 300000, null, null);

  -- Follow-ups.
  insert into public.tasks (business_id, kind, title, due_at, assigned_to, customer_id, order_id, created_by)
    values
      (v_biz, 'unpaid_order', 'Remind Ada about the dress balance', now() + interval '1 day', v_uid, c1, o1, v_uid),
      (v_biz, 'delivery_confirmation', 'Confirm the totes were collected', now() + interval '1 day', v_uid, c3, o2, v_uid),
      (v_biz, 'fit_check', 'Fitting for the wrap dress', now() + interval '3 days', v_uid, c1, o1, v_uid);

  return v_biz;
end;
$$;

revoke all on function public.create_demo_workspace from public, anon;
grant execute on function public.create_demo_workspace to authenticated;
comment on function public.create_demo_workspace is
  'Intentional SECURITY DEFINER: creates a demo business owned by the caller and fills it with fictional data through the normal functions.';

-- Start the demo again: the caller's demo (where they are an owner) is archived, never deleted, and a fresh
-- one is built. Staff who joined someone else's demo just get that demo back.
create or replace function public.reset_demo_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  update public.businesses b set archived_at = now()
  where b.is_demo and b.archived_at is null
    and exists (select 1 from public.memberships m where m.business_id = b.id and m.user_id = v_uid and m.role = 'owner' and m.status = 'active');
  return public.create_demo_workspace();
end;
$$;
revoke all on function public.reset_demo_workspace from public, anon;
grant execute on function public.reset_demo_workspace to authenticated;
comment on function public.reset_demo_workspace is 'Intentional SECURITY DEFINER: archives only demo workspaces the caller owns.';
