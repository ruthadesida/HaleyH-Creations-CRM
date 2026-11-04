-- Phase 4: editable message templates (Spec 2 §13). They only prepare a WhatsApp message that staff review
-- and send themselves: nothing is sent automatically. Placeholders like {first_name} are filled in the app.

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  key text not null check (key in ('order_confirmed', 'payment_reminder', 'order_ready', 'order_dispatched', 'delivery_followup')),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, key)
);

create or replace function app.seed_message_templates(p_business_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.message_templates (business_id, key, title, body) values
    (p_business_id, 'order_confirmed', 'Order confirmed',
     'Hello {first_name}, thank you for your order {order_number} with {business}. Total {total}; received so far {paid}; balance {balance}.'),
    (p_business_id, 'payment_reminder', 'Payment reminder',
     'Hello {first_name}, a gentle reminder that {balance} is still due on your order {order_number}. Thank you!'),
    (p_business_id, 'order_ready', 'Ready for collection or delivery',
     'Hello {first_name}, good news: your order {order_number} is ready. Let us know when suits you for delivery or collection.'),
    (p_business_id, 'order_dispatched', 'On its way',
     'Hello {first_name}, your order {order_number} is on its way{courier}. Thank you for shopping with {business}!'),
    (p_business_id, 'delivery_followup', 'After delivery',
     'Hello {first_name}, we hope you love your order {order_number}. If anything needs adjusting, just reply here.')
  on conflict (business_id, key) do nothing
$$;
revoke all on function app.seed_message_templates from public, anon, authenticated;

create or replace function app.seed_business_templates()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.seed_message_templates(new.id);
  return new;
end;
$$;
create trigger businesses_seed_templates after insert on public.businesses
  for each row execute function app.seed_business_templates();
select app.seed_message_templates(id) from public.businesses;

create trigger touch_message_templates before update on public.message_templates for each row execute function app.touch_updated_at();
create trigger audit_message_templates after update on public.message_templates for each row execute function app.write_audit();

alter table public.message_templates enable row level security;
revoke all on public.message_templates from anon;
revoke insert, delete on public.message_templates from authenticated;
create policy "office reads templates" on public.message_templates for select to authenticated using (app.is_office(business_id));
create policy "owners edit templates" on public.message_templates for update to authenticated
  using (app.is_owner(business_id)) with check (app.is_owner(business_id));
revoke update on public.message_templates from authenticated;
grant update (title, body) on public.message_templates to authenticated;
