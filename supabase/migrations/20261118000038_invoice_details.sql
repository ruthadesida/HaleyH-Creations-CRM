-- Invoice details: the business's logo, how customers pay, its tax ID, and the VAT included in the price.
-- Everything here is entered by an owner in Settings; nothing is assumed.

alter table public.businesses
  add column payment_details text check (payment_details is null or char_length(payment_details) between 1 and 500),
  add column tax_id text check (tax_id is null or char_length(tax_id) between 1 and 40),
  -- A logo always lives in the business's own folder of the branding bucket.
  add constraint businesses_logo_path_own_folder check (logo_path is null or logo_path like id::text || '/%');

grant update (payment_details, tax_id) on public.businesses to authenticated;

--------------------------------------------------------------------------------
-- Logos: a private bucket. Files live under <business id>/…; owners upload, members read.
-- No SVG: an uploaded SVG can carry script.
--------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "owners upload logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'branding' and app.is_owner(app.uuid_or_null((storage.foldername(name))[1])));
create policy "members read logos" on storage.objects for select to authenticated
  using (bucket_id = 'branding' and app.is_member(app.uuid_or_null((storage.foldername(name))[1])));
create policy "owners remove logos" on storage.objects for delete to authenticated
  using (bucket_id = 'branding' and app.is_owner(app.uuid_or_null((storage.foldername(name))[1])));

--------------------------------------------------------------------------------
-- The VAT rate an invoice dated p_date includes (0 when the business isn't charging VAT then).
-- The books settings are owners-only; this exposes just the rate, to staff who can see orders.
--------------------------------------------------------------------------------
create or replace function public.invoice_vat_rate(p_business_id uuid, p_date date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_office(p_business_id) then
    raise exception 'Only the office can see invoices.' using errcode = '42501';
  end if;
  return coalesce(app.books_vat_rate(p_business_id, p_date), 0);
end;
$$;
revoke all on function public.invoice_vat_rate(uuid, date) from public, anon;
grant execute on function public.invoice_vat_rate(uuid, date) to authenticated;
