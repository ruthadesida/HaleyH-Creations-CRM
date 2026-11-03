-- Quick-add an enquiry and its new customer in one transaction, so a failed
-- enquiry can never leave an orphan customer behind. Runs as the caller (RLS applies).

create or replace function public.create_enquiry_with_customer(
  p_business_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_whatsapp text,
  p_enquiry jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer uuid;
  v_enquiry uuid;
begin
  if not app.is_office(p_business_id) then
    raise exception 'You do not have permission to add enquiries here.' using errcode = '42501';
  end if;

  insert into public.customers (business_id, full_name, phone, whatsapp, source, tags)
  values (
    p_business_id, btrim(p_customer_name), nullif(btrim(p_customer_phone), ''), nullif(btrim(p_customer_whatsapp), ''),
    nullif(p_enquiry ->> 'source', '')::public.contact_source, array['new customer']
  )
  returning id into v_customer;

  insert into public.enquiries (
    business_id, customer_id, product_interest, product_id, source, stage, assigned_to,
    notes, next_action, follow_up_at
  ) values (
    p_business_id, v_customer,
    nullif(p_enquiry ->> 'product_interest', ''),
    nullif(p_enquiry ->> 'product_id', '')::uuid,
    nullif(p_enquiry ->> 'source', '')::public.contact_source,
    coalesce(nullif(p_enquiry ->> 'stage', ''), 'new')::public.enquiry_stage,
    nullif(p_enquiry ->> 'assigned_to', '')::uuid,
    nullif(p_enquiry ->> 'notes', ''),
    nullif(p_enquiry ->> 'next_action', ''),
    nullif(p_enquiry ->> 'follow_up_at', '')::timestamptz
  )
  returning id into v_enquiry;

  return v_enquiry;
end;
$$;

revoke all on function public.create_enquiry_with_customer from public, anon;
grant execute on function public.create_enquiry_with_customer to authenticated;
