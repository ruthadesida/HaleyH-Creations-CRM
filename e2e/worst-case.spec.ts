import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  SKIP_REASON, createBusiness, createUser, hasLocalSupabase, seedOpeningStock, seedPhase2, seedPhase3, signIn,
} from "./support/world";

/**
 * break-ui: the busiest screens filled with worst-case data (very long names, unbreakable emails, one-letter
 * names, Yoruba diacritics, emoji, huge quantities and amounts, a 12-line order). Fails on horizontal overflow
 * and saves full-page screenshots to e2e-shots/ (uploaded by CI) for a design review.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

const SHOT_PROJECTS = ["phone-small", "laptop"];
const LONG_NAME = "Oluwaseyifunmi Adebimpe-Ogunleye Abiodun-Fashola Olatunji-Bankole Adeyemi-Ogundipe (Mrs.)";
const LONG_PRODUCT = "Hand-beaded Aso-oke agbada with embroidered cap, matching sokoto trousers and extra-long gele, custom fitted";

test("busy screens survive worst-case data", async ({ page }) => {
  test.skip(!SHOT_PROJECTS.includes(test.info().project.name), "Screenshots at the smallest phone and a laptop only");
  test.setTimeout(600_000);

  const owner = await createUser("worst", LONG_NAME.slice(0, 60));
  const business = await createBusiness(owner, "Ẹ̀ṣọ́ Couture & Aṣọ Ẹbí Atelier — Lekki Phase 1 Showroom ✨");
  const c = owner.client;
  await seedOpeningStock(owner, business.id);
  const p2 = await seedPhase2(owner, business.id);
  const p3 = await seedPhase3(owner, business.id, p2.variant);

  // People with awkward names and contact details.
  const { data: long, error } = await c.from("customers").insert([
    { business_id: business.id, full_name: LONG_NAME, phone: "+234 803 555 0199 ext. 4421", email: "oluwaseyifunmi.adebimpe.ogunleye.abiodun.fashola@verylongdomainname-example.com.ng" },
    { business_id: business.id, full_name: "Ọ", phone: "0803 555 0198" },
    { business_id: business.id, full_name: "Chiamaka 👑💃🏾 Nwosu-Eze", phone: "0803 555 0197", email: "chi@x.ng" },
    { business_id: business.id, full_name: "Àdùkẹ́ Ọlábísí Ṣónúbí", phone: "0803 555 0196" },
  ]).select("id, full_name");
  if (error || !long) throw new Error(`customers failed: ${error?.message}`);
  const longId = long.find((x) => x.full_name === LONG_NAME)!.id as string;

  // A product with a very long name and long options, and a 12-line quotation with huge figures.
  const { data: product } = await c.from("products").insert({ business_id: business.id, name: LONG_PRODUCT, category: "clothing", base_price_minor: 9_999_999_900 }).select("id").single();
  const { data: variant } = await c.from("product_variants").insert({
    business_id: business.id, product_id: product!.id, size: "XXXXL / custom fit", colour: "Royal blue with gold metallic thread", sku: "AGBADA-ROYAL-BLUE-GOLD-XXXXL-CUSTOM-2026",
  }).select("id").single();
  const items = Array.from({ length: 12 }, (_, i) => ({
    description: i % 2 ? `${LONG_PRODUCT} (line ${i + 1})` : `Wrap dress M`,
    variant_id: i % 2 ? variant!.id : p2.variant, quantity: i === 0 ? 9999 : 1 + i, unit_price_minor: i === 0 ? 9_999_999_900 : 4_500_000, item_type: "ready_made",
  }));
  const { data: bigOrder, error: oError } = await c.rpc("create_order", {
    p_business_id: business.id, p_customer_id: longId, p_idempotency_key: randomUUID(), p_items: items,
  });
  if (oError || !bigOrder) throw new Error(`create_order failed: ${oError?.message}`);
  await c.from("suppliers").insert({ business_id: business.id, name: "Balogun Market Fabrics, Textiles, Laces and Haberdashery Wholesale Enterprises Nigeria Limited" });
  await c.from("makers").insert({ business_id: business.id, name: "Babatunde Olufemi-Ajayi-Ogunbiyi (external, Ikorodu workshop)", trade: "tailor", is_external: true });

  const w = `/w/${business.slug}`;
  const pages: [string, string][] = [
    ["today", w],
    ["customers", `${w}/customers`],
    ["customer-long", `${w}/customers/${longId}`],
    ["orders", `${w}/orders?view=quotes`],
    ["order-big", `${w}/orders/${bigOrder}`],
    ["order-confirmed", `${w}/orders/${p3.order}`],
    ["invoice-big", `${w}/orders/${bigOrder}/invoice`],
    ["payments", `${w}/payments`],
    ["stock", `${w}/stock`],
    ["products", `${w}/stock/products`],
    ["purchasing", `${w}/purchasing`],
    ["purchase-order", `${w}/purchasing/${p2.po}`],
    ["suppliers", `${w}/purchasing/suppliers`],
    ["production", `${w}/production`],
    ["job", `${w}/production/${p2.job}`],
    ["makers", `${w}/stock/makers`],
    ["reports", `${w}/reports`],
    ["report-orders-attention", `${w}/reports/orders-attention`],
    ["report-stock", `${w}/reports/stock-by-location`],
    ["search", `${w}/search?q=Olu`],
    ["notifications", `${w}/notifications`],
  ];

  await signIn(page, owner);
  const project = test.info().project.name;
  for (const [name, path] of pages) {
    await test.step(name, async () => {
      const res = await page.goto(path);
      expect.soft(res?.status(), path).toBe(200);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `${name} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
      if (name === "customer-long") {
        // This customer's only order is a quotation: not a sale, so nothing is owed.
        await expect.soft(page.getByRole("main").getByText(/· Quotation/)).toBeVisible();
        await expect.soft(page.getByRole("main").getByText("Unpaid", { exact: true })).toHaveCount(0);
      }
      await page.screenshot({ path: `e2e-shots/${project}/${name}.png`, fullPage: true });
    });
  }
});
