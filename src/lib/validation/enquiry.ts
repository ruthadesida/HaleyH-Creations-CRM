import { z } from "zod";
import { normalizePhone } from "../phone";
import { enumOrNull, optionalText, optionalUuid } from "./common";
import { SOURCES } from "./customer";

export const ENQUIRY_STAGE_VALUES = ["new", "contacted", "choosing", "awaiting_payment", "won", "lost"] as const;

export const enquirySchema = z
  .object({
    customer_id: optionalUuid,
    new_customer_name: optionalText(120),
    new_customer_phone: optionalText(40),
    product_interest: optionalText(300),
    product_id: optionalUuid,
    source: enumOrNull(SOURCES),
    stage: z.enum(ENQUIRY_STAGE_VALUES).default("new"),
    assigned_to: optionalUuid,
    notes: optionalText(4000),
    next_action: optionalText(300),
    follow_up_local: z.string().trim().default(""),
    lost_reason: optionalText(300),
  })
  .superRefine((e, ctx) => {
    if (!e.customer_id) {
      if (!e.new_customer_name) {
        ctx.addIssue({ code: "custom", path: ["new_customer_name"], message: "Choose a customer or enter a new customer's name." });
      }
      if (!e.new_customer_phone || (normalizePhone(e.new_customer_phone)?.length ?? 0) < 9) {
        ctx.addIssue({ code: "custom", path: ["new_customer_phone"], message: "Enter the new customer's phone number." });
      }
    }
    if (e.follow_up_local && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.follow_up_local)) {
      ctx.addIssue({ code: "custom", path: ["follow_up_local"], message: "Choose a valid date and time." });
    }
    if (e.stage === "lost" && !e.lost_reason) {
      ctx.addIssue({ code: "custom", path: ["lost_reason"], message: "Say why it was lost, so we can learn from it." });
    }
  });

export const moveEnquirySchema = z.object({
  id: z.string().uuid(),
  stage: z.enum(ENQUIRY_STAGE_VALUES),
  position: z.number().finite(),
  lost_reason: z.string().trim().max(300).optional(),
});
