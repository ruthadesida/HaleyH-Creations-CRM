-- The production manager needs the finished-goods catalogue (products and variants) to plan
-- work, count stock and, in Phase 2, build bills of materials. Selling prices are not
-- restricted from production by Spec 2; costs are (they live in the ledger, not here).

drop policy if exists "office reads products" on public.products;
create policy "office and production read products" on public.products
  for select to authenticated using (app.is_office(business_id) or app.is_production(business_id));

drop policy if exists "office reads variants" on public.product_variants;
create policy "office and production read variants" on public.product_variants
  for select to authenticated using (app.is_office(business_id) or app.is_production(business_id));
