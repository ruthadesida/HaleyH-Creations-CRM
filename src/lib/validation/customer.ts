import { z } from "zod";
import { normalizePhone } from "../phone";
import { enumOrNull, optionalDate, optionalText, optionalUuid, requiredText } from "./common";

export const SOURCES = ["instagram", "whatsapp", "website", "walk_in", "referral", "other"] as const;
export const CONTACT_PREFS = ["whatsapp", "phone", "sms", "email"] as const;

const measurement = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : Number(v)))
  .pipe(z.number().positive("Use a positive number.").lt(1000).nullable())
  .optional()
  .transform((v) => v ?? null);

const phone = optionalText(40).refine((v) => v === null || (normalizePhone(v)?.length ?? 0) >= 9, {
  message: "Enter a full phone number, e.g. 0803 123 4567.",
});

export const customerSchema = z
  .object({
    full_name: requiredText(120, "Enter the customer's name."),
    phone,
    whatsapp: phone,
    email: optionalText(254).refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: "Enter a valid email address.",
    }),
    address_line: optionalText(300),
    city: optionalText(80),
    state: optionalText(80),
    country: z.string().trim().max(80).transform((v) => v || "Nigeria"),
    source: enumOrNull(SOURCES),
    clothing_size: optionalText(20),
    shoe_size: optionalText(20),
    bust: measurement,
    waist: measurement,
    hip: measurement,
    measurement_unit: enumOrNull(["cm", "in"] as const),
    measured_on: optionalDate,
    preferred_colours: optionalText(300),
    preferred_products: optionalText(300),
    fit_notes: optionalText(2000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20),
    assigned_to: optionalUuid,
    contact_preferences: z.array(z.enum(CONTACT_PREFS)),
    marketing_consent: z.boolean(),
    notes: optionalText(4000),
  })
  .superRefine((c, ctx) => {
    const hasMeasure = c.bust !== null || c.waist !== null || c.hip !== null;
    if (hasMeasure && !c.measurement_unit) {
      ctx.addIssue({ code: "custom", path: ["measurement_unit"], message: "Choose cm or inches for the measurements." });
    }
    if (!c.phone && !c.whatsapp && !c.email) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Add at least a phone number, WhatsApp number or email." });
    }
  });

export type CustomerInput = z.infer<typeof customerSchema>;

/** Builds the raw object for customerSchema from a submitted form. */
export function customerFromForm(formData: FormData) {
  const get = (k: string) => (formData.get(k) ?? "").toString();
  const sameAsPhone = formData.get("whatsapp_same") === "on";
  return {
    full_name: get("full_name"),
    phone: get("phone"),
    whatsapp: sameAsPhone ? get("phone") : get("whatsapp"),
    email: get("email"),
    address_line: get("address_line"),
    city: get("city"),
    state: get("state"),
    country: get("country"),
    source: get("source"),
    clothing_size: get("clothing_size"),
    shoe_size: get("shoe_size"),
    bust: get("bust"),
    waist: get("waist"),
    hip: get("hip"),
    measurement_unit: get("measurement_unit"),
    measured_on: get("measured_on"),
    preferred_colours: get("preferred_colours"),
    preferred_products: get("preferred_products"),
    fit_notes: get("fit_notes"),
    tags: get("tags").split(",").map((t) => t.trim()).filter(Boolean),
    assigned_to: get("assigned_to"),
    contact_preferences: formData.getAll("contact_preferences").map(String),
    marketing_consent: formData.get("marketing_consent") === "on",
    notes: get("notes"),
  };
}
