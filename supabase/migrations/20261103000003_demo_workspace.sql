-- Demo workspace: a separate business flagged is_demo, filled with fictional sample data.
-- It never touches live businesses. Every name and number below is invented.

create or replace function public.create_demo_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_biz uuid;
  v_slug text;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  p_dress uuid; p_kaftan uuid; p_mules uuid; p_tote uuid;
  e1 uuid;
  o1 uuid; o2 uuid; o3 uuid;
  lagos_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  -- One demo per user is enough; return the existing one.
  select b.id into v_biz
    from public.businesses b
    join public.memberships m on m.business_id = b.id
    where m.user_id = v_uid and b.is_demo and b.archived_at is null
    limit 1;
  if v_biz is not null then
    return v_biz;
  end if;

  v_slug := 'demo-' || substr(replace(v_uid::text, '-', ''), 1, 10);
  insert into public.businesses (name, slug, currency, timezone, order_prefix, is_demo, created_by)
    values ('Demo boutique', v_slug, 'NGN', 'Africa/Lagos', 'DEMO', true, v_uid)
    returning id into v_biz;
  insert into public.memberships (business_id, user_id, role) values (v_biz, v_uid, 'owner');
  insert into public.business_subscriptions (business_id, status, notes)
    values (v_biz, 'trial', 'Demo workspace');

  insert into public.customers (business_id, full_name, phone, whatsapp, email, city, state, source,
      clothing_size, shoe_size, tags, contact_preferences, marketing_consent, created_by)
    values (v_biz, 'Demo: Ada Okafor', '08030000001', '08030000001', 'ada.demo@example.com', 'Lekki', 'Lagos',
      'instagram', 'UK 12', '40', array['repeat customer'], array['whatsapp'], true, v_uid)
    returning id into c1;
  insert into public.customers (business_id, full_name, phone, whatsapp, city, state, source,
      clothing_size, bust, waist, hip, measurement_unit, measured_on, fit_notes, tags, contact_preferences, created_by)
    values (v_biz, 'Demo: Tolu Bello', '08030000002', '08030000002', 'Ikeja', 'Lagos', 'whatsapp',
      'UK 10', 92, 74, 100, 'cm', lagos_today - 10, 'Prefers a relaxed fit at the waist.', array['new customer'],
      array['whatsapp', 'phone'], v_uid)
    returning id into c2;
  insert into public.customers (business_id, full_name, phone, city, state, source, tags, created_by)
    values (v_biz, 'Demo: Ngozi Eze', '08030000003', 'Wuse', 'Abuja', 'walk_in', array['wholesale'], v_uid)
    returning id into c3;
  insert into public.customers (business_id, full_name, email, city, state, source, created_by)
    values (v_biz, 'Demo: Kemi Adeyemi', 'kemi.demo@example.com', 'Ibadan', 'Oyo', 'referral', v_uid)
    returning id into c4;

  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo Ankara wrap dress', 'clothing', 4500000, 'made_to_order') returning id into p_dress;
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo Adire kaftan', 'clothing', 3800000, 'ready_made') returning id into p_kaftan;
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo leather mules', 'shoes', 2500000, 'ready_made') returning id into p_mules;
  insert into public.products (business_id, name, category, base_price_minor, default_item_type)
    values (v_biz, 'Demo woven tote', 'bags', 1800000, 'ready_made') returning id into p_tote;
  insert into public.product_variants (business_id, product_id, size, colour)
    values (v_biz, p_mules, '39', 'Tan'), (v_biz, p_mules, '40', 'Tan'), (v_biz, p_mules, '40', 'Black'),
           (v_biz, p_tote, null, 'Natural'), (v_biz, p_kaftan, 'M', 'Indigo'), (v_biz, p_kaftan, 'L', 'Indigo');

  insert into public.enquiries (business_id, customer_id, product_interest, product_id, source, stage,
      next_action, follow_up_at, assigned_to, created_by)
    values (v_biz, c2, 'Ankara wrap dress for a wedding', p_dress, 'whatsapp', 'choosing',
      'Send fabric options', now() - interval '1 day', v_uid, v_uid)
    returning id into e1;
  insert into public.enquiries (business_id, customer_id, product_interest, source, stage, next_action,
      follow_up_at, assigned_to, created_by)
    values
      (v_biz, c4, 'Leather mules, size 40', 'referral', 'new', 'Call to confirm colour', now() + interval '3 hours', v_uid, v_uid),
      (v_biz, c3, 'Wholesale totes (20 units)', 'walk_in', 'awaiting_payment', 'Confirm deposit received', now() + interval '1 day', v_uid, v_uid),
      (v_biz, c1, 'Matching kaftan for husband', 'instagram', 'contacted', 'Share size chart', now() + interval '2 days', v_uid, v_uid);
  insert into public.enquiries (business_id, customer_id, product_interest, source, stage, lost_reason, created_by)
    values (v_biz, c4, 'Beaded clutch', 'instagram', 'lost', 'Found a cheaper option elsewhere', v_uid);

  -- Orders: one made-to-order part-paid, one ready-made paid and dispatched, one awaiting payment.
  insert into public.orders (business_id, customer_id, channel, fulfilment_stage, promised_date,
      delivery_fee_minor, delivery_method, delivery_address, delivery_city, delivery_state,
      delivery_instructions, assigned_to, created_by)
    values (v_biz, c1, 'instagram', 'in_production', lagos_today + 5, 300000, 'home_delivery',
      '12 Demo Close', 'Lekki', 'Lagos', 'Call before delivery', v_uid, v_uid)
    returning id into o1;
  insert into public.order_items (business_id, order_id, product_id, description, size, colour, quantity, unit_price_minor, item_type)
    values (v_biz, o1, p_dress, 'Demo Ankara wrap dress', 'UK 12', 'Blue print', 1, 4500000, 'made_to_order'),
           (v_biz, o1, p_mules, 'Demo leather mules', '40', 'Tan', 1, 2500000, 'ready_made');
  insert into public.payments (business_id, order_id, kind, amount_minor, method, reference, recorded_by, paid_on)
    values (v_biz, o1, 'payment', 3500000, 'bank_transfer', 'DEMO-REF-001', v_uid, lagos_today - 3);

  insert into public.orders (business_id, customer_id, channel, fulfilment_stage, delivery_method,
      pickup_location, courier_name, tracking_reference, dispatched_at, assigned_to, created_by)
    values (v_biz, c3, 'walk_in', 'dispatched', 'station_pickup', 'Demo park, Wuse', 'Demo Couriers', 'DEMO-TRK-778',
      now() - interval '1 day', v_uid, v_uid)
    returning id into o2;
  insert into public.order_items (business_id, order_id, product_id, description, colour, quantity, unit_price_minor)
    values (v_biz, o2, p_tote, 'Demo woven tote', 'Natural', 3, 1800000);
  insert into public.payments (business_id, order_id, kind, amount_minor, method, recorded_by, paid_on)
    values (v_biz, o2, 'payment', 5400000, 'cash', v_uid, lagos_today - 2);

  insert into public.orders (business_id, customer_id, enquiry_id, channel, promised_date, assigned_to, created_by)
    values (v_biz, c2, null, 'whatsapp', lagos_today - 1, v_uid, v_uid)
    returning id into o3;
  insert into public.order_items (business_id, order_id, product_id, description, size, colour, quantity, unit_price_minor)
    values (v_biz, o3, p_kaftan, 'Demo Adire kaftan', 'M', 'Indigo', 1, 3800000);

  insert into public.tasks (business_id, kind, title, due_at, assigned_to, customer_id, order_id, created_by)
    values
      (v_biz, 'unpaid_order', 'Remind about kaftan payment', now() - interval '2 hours', v_uid, c2, o3, v_uid),
      (v_biz, 'delivery_confirmation', 'Confirm totes were collected', now() + interval '1 day', v_uid, c3, o2, v_uid),
      (v_biz, 'fit_check', 'Fitting for wrap dress', now() + interval '4 days', v_uid, c1, o1, v_uid);

  return v_biz;
end;
$$;

revoke all on function public.create_demo_workspace from public, anon;
grant execute on function public.create_demo_workspace to authenticated;
