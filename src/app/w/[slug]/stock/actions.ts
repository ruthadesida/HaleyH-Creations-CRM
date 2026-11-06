"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";
import {
  listInput, locationSchema, makeSku, makerSchema, materialSchema, productSchema, supplierSchema, transferSchema,
} from "@/lib/validation/stock";

type Result = { ok: boolean; message: string };

/* ----------------------------- Materials ----------------------------- */

export async function saveMaterial(slug: string, id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.production);
  const values = formValues(formData);
  const parsed = materialSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { kind, base_unit, ...editable } = parsed.data;
  if (id) {
    // Kind and base unit can't change once stock may exist in that unit.
    const { error } = await supabase.from("stock_items").update(editable).eq("id", id).eq("business_id", business.id);
    if (error) return { message: error.code === "23505" ? "Another item already uses that code." : friendlyDbError(error), values };
    redirect(`/w/${slug}/stock/items/${id}?saved=1`);
  }
  const { data, error } = await supabase.from("stock_items")
    .insert({ ...editable, kind, base_unit, business_id: business.id }).select("id").single();
  if (error) {
    return error.code === "23505"
      ? { fieldErrors: { code: "Another item already uses that code." }, values }
      : { message: friendlyDbError(error), values };
  }
  redirect(`/w/${slug}/stock/items/${data.id}?created=1`);
}

export async function setItemArchived(slug: string, id: string, archived: boolean): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const supabase = await createClient();
  const { data, error } = await supabase.from("stock_items")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id).eq("business_id", business.id).in("kind", ["raw_material", "packaging"]).select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "Finished goods are archived from Products." };
  refresh();
  return { ok: true, message: archived ? "Item archived. Its history is kept." : "Item restored." };
}

/* ----------------------------- Locations ----------------------------- */

export async function addLocation(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.production);
  const values = formValues(formData);
  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.from("locations").insert({ ...parsed.data, business_id: business.id });
  if (error) return { message: error.code === "23505" ? "A location with that name already exists." : friendlyDbError(error), values };
  refresh();
  return { ok: true, message: "Location added." };
}

export async function setLocationArchived(slug: string, id: string, archived: boolean): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const supabase = await createClient();
  if (archived) {
    const { data: held } = await supabase.from("stock_balances").select("on_hand").eq("business_id", business.id).eq("location_id", id).limit(1);
    if (held?.length) return { ok: false, message: "Move the stock out of this location before archiving it." };
  }
  const { error } = await supabase.from("locations").update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: archived ? "Location archived." : "Location restored." };
}

/* ------------------------------- Makers ------------------------------- */

export async function saveMaker(slug: string, id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.production);
  const values = formValues(formData);
  const parsed = makerSchema.safeParse({ ...Object.fromEntries(formData), is_external: formData.get("is_external") === "on" });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("makers").update(parsed.data).eq("id", id).eq("business_id", business.id)
    : await supabase.from("makers").insert({ ...parsed.data, business_id: business.id });
  if (error) return { message: friendlyDbError(error), values };
  refresh();
  return { ok: true, message: id ? "Maker updated." : "Maker added." };
}

export async function setMakerArchived(slug: string, id: string, archived: boolean): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const supabase = await createClient();
  const { error } = await supabase.from("makers").update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: archived ? "Maker archived." : "Maker restored." };
}

/* ------------------------------ Suppliers ------------------------------ */

export async function saveSupplier(slug: string, id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.production);
  const values = formValues(formData);
  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("suppliers").update(parsed.data).eq("id", id).eq("business_id", business.id)
    : await supabase.from("suppliers").insert({ ...parsed.data, business_id: business.id });
  if (error) return { message: friendlyDbError(error), values };
  refresh();
  return { ok: true, message: id ? "Supplier updated." : "Supplier added." };
}

/* ------------------------------ Products ------------------------------ */

export async function createProduct(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.manage);
  const values = formValues(formData);
  const price = parseMoneyInput(String(formData.get("price") ?? ""));
  const parsed = productSchema.safeParse({
    ...Object.fromEntries(formData),
    sizes: listInput(formData.get("sizes")),
    colours: listInput(formData.get("colours")),
    lengths: listInput(formData.get("lengths")),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  if (price === null) return { fieldErrors: { price: "Enter a selling price like 45000." }, values };
  const costText = String(formData.get("cost") ?? "").trim();
  const cost = costText ? parseMoneyInput(costText) : null;
  if (costText && cost === null) return { fieldErrors: { cost: "Enter the cost price like 20000, or leave it blank." }, values };
  const p = parsed.data;

  const supabase = await createClient();
  const { data: product, error } = await supabase.from("products").insert({
    business_id: business.id, name: p.name, category: p.category, description: p.description,
    base_price_minor: price, default_item_type: p.default_item_type,
  }).select("id").single();
  if (error) return { message: friendlyDbError(error), values };

  // One variant per size × colour × length combination (at least one).
  const sizes = p.sizes.length ? p.sizes : [null];
  const colours = p.colours.length ? p.colours : [null];
  const lengths = p.lengths.length ? p.lengths : [null];
  const variants = sizes.flatMap((size) => colours.flatMap((colour) => lengths.map((length) => ({
    business_id: business.id, product_id: product.id, size, colour, length,
    sku: makeSku(p.sku_prefix, [size, colour, length]), price_minor: price,
  }))));
  if (variants.length > 200) return { message: "That's more than 200 variants. Add fewer sizes or colours at once.", values };
  const { error: vError } = await supabase.from("product_variants").insert(variants);
  if (vError) {
    return {
      message: vError.code === "23505"
        ? "Some SKUs already exist. Use a different SKU prefix. (The product was created; add its variants from its page.)"
        : friendlyDbError(vError),
      values,
    };
  }
  if (cost !== null) {
    const { error: cError } = await supabase.rpc("set_product_cost", { p_product: product.id, p_variant: orNull(""), p_cost_minor: cost });
    if (cError) return { message: `The product was created, but its cost price wasn't saved: ${friendlyDbError(cError)}`, values };
  }
  redirect(`/w/${slug}/stock/products/${product.id}?created=1`);
}

/** Owners set the cost price of a product (variantId null) or of one size/colour. Blank clears it. */
export async function setProductCost(slug: string, productId: string, variantId: string | null, costText: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!z.string().uuid().safeParse(productId).success || (variantId !== null && !z.string().uuid().safeParse(variantId).success)) {
    return { ok: false, message: "Refresh the page and try again." };
  }
  const text = costText.trim();
  const cost = text ? parseMoneyInput(text) : null;
  if (text && cost === null) return { ok: false, message: "Enter the cost price like 20000, or leave it blank." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_product_cost", {
    p_product: productId, p_variant: orNull(variantId ?? ""), p_cost_minor: cost as unknown as number,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: text ? "Cost price saved." : variantId ? "Cleared: this size uses the product's cost price." : "Cost price cleared." };
}

const variantPatch = z.object({ price: z.string(), sku: z.string().trim().max(60) });

export async function updateVariant(slug: string, id: string, input: z.input<typeof variantPatch>): Promise<Result> {
  const { business } = await authorize(slug, can.manage);
  const parsed = variantPatch.safeParse(input);
  const price = parsed.success ? parseMoneyInput(parsed.data.price) : null;
  if (!parsed.success || price === null) return { ok: false, message: "Enter a valid price." };
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants")
    .update({ price_minor: price, sku: parsed.data.sku || null }).eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, message: error.code === "23505" ? "Another variant already uses that SKU." : friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Variant saved." };
}

export async function setVariantArchived(slug: string, id: string, archived: boolean): Promise<Result> {
  const { business } = await authorize(slug, can.manage);
  const supabase = await createClient();
  const { error } = await supabase.from("product_variants")
    .update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: archived ? "Variant archived." : "Variant restored." };
}

/* --------------------------- Stock movements --------------------------- */

export async function transferStock(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.production);
  const values = formValues(formData);
  const parsed = transferSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const t = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_transfer", {
    p_business_id: business.id, p_item: t.item, p_from: t.from, p_to: t.to, p_qty: t.qty,
    p_effective_date: t.effective_date, p_note: t.note ?? "", p_idempotency_key: t.idempotency_key,
  });
  if (error) return { message: friendlyDbError(error), values };
  redirect(`/w/${slug}/stock/items/${t.item}?moved=1`);
}

const quantityText = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ""))
  // A blank quantity is never zero: zero must be typed.
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), "Enter a quantity for every item (type 0 if there are none).")
  .transform(Number);

const adjustmentSchema = z.object({
  kind: z.enum(["count", "write_off"]),
  location: z.string().uuid("Choose a location."),
  reason: z.string().trim().min(3, "Say why (e.g. monthly count, damaged).").max(500),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  idempotency_key: z.string().uuid(),
  lines: z.array(z.object({ item: z.string().uuid("Choose an item on every line."), qty: quantityText }))
    .min(1, "Add at least one item.")
    .refine((ls) => new Set(ls.map((l) => l.item)).size === ls.length, "The same item appears twice. Combine it into one line."),
});

const key = z.string().uuid();

export async function requestAdjustment(slug: string, input: z.input<typeof adjustmentSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const a = parsed.data;
  if (a.kind === "write_off" && a.lines.some((l) => l.qty <= 0)) {
    return { ok: false, message: "Write-off quantities must be more than zero." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_adjustment", {
    p_business_id: business.id, p_kind: a.kind, p_location: a.location, p_reason: a.reason,
    p_effective_date: a.effective_date, p_lines: a.lines, p_idempotency_key: a.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Sent for owner approval. Stock changes only once it's approved." };
}

export async function decideAdjustment(slug: string, id: string, approve: boolean, idempotencyKey: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!key.safeParse(idempotencyKey).success || !key.safeParse(id).success) return { ok: false, message: "Refresh the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_adjustment", {
    p_request_id: id, p_approve: approve, p_note: "", p_idempotency_key: idempotencyKey,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: approve ? "Approved and posted to stock." : "Rejected. Stock is unchanged." };
}

export async function reverseDocument(slug: string, id: string, reason: string, idempotencyKey: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!key.safeParse(idempotencyKey).success || !key.safeParse(id).success) return { ok: false, message: "Refresh the page and try again." };
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason for the reversal." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_stock_document", { p_doc_id: id, p_reason: reason.trim().slice(0, 500), p_idempotency_key: idempotencyKey });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Reversed. Both documents stay in the history." };
}
