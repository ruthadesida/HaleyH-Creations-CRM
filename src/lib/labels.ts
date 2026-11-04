import type { Tone } from "@/components/ui/bits";
import type { PaymentStatus } from "./money";
import type { Database } from "./supabase/database.types";

type Enums = Database["public"]["Enums"];

export const SOURCE_LABEL: Record<Enums["contact_source"], string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  website: "Website",
  walk_in: "Walk-in",
  referral: "Referral",
  other: "Other",
};

export const ENQUIRY_STAGES: Enums["enquiry_stage"][] = ["new", "contacted", "choosing", "awaiting_payment", "won", "lost"];
export const ENQUIRY_STAGE_LABEL: Record<Enums["enquiry_stage"], string> = {
  new: "New enquiry",
  contacted: "Contacted",
  choosing: "Choosing item/size",
  awaiting_payment: "Awaiting payment",
  won: "Won",
  lost: "Lost",
};
export const ENQUIRY_STAGE_TONE: Record<Enums["enquiry_stage"], Tone> = {
  new: "gold",
  contacted: "neutral",
  choosing: "neutral",
  awaiting_payment: "warn",
  won: "success",
  lost: "danger",
};

export const FULFILMENT_STAGES: Enums["fulfilment_stage"][] = [
  "confirmed", "in_production", "quality_check", "ready_for_dispatch", "dispatched", "delivered",
];
export const FULFILMENT_LABEL: Record<Enums["fulfilment_stage"], string> = {
  confirmed: "Confirmed",
  in_production: "In production",
  quality_check: "Quality check",
  ready_for_dispatch: "Ready for dispatch",
  dispatched: "Dispatched",
  delivered: "Delivered",
};

/** Business-specific stage names override the defaults. */
export function stageLabel(stage: Enums["fulfilment_stage"], custom: unknown): string {
  const map = (custom && typeof custom === "object" ? custom : {}) as Record<string, unknown>;
  const v = map[stage];
  return typeof v === "string" && v.trim() ? v : FULFILMENT_LABEL[stage];
}

export const PAYMENT_TONE: Record<PaymentStatus, Tone> = {
  unpaid: "danger",
  part_paid: "warn",
  paid: "success",
  overpaid: "gold",
  settled: "neutral",
};

export const PAYMENT_METHOD_LABEL: Record<Enums["payment_method"], string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  pos: "POS",
  online: "Online",
  other: "Other",
};

export const DELIVERY_LABEL: Record<Enums["delivery_method"], string> = {
  home_delivery: "Home delivery",
  station_pickup: "Station / locker pickup",
  store_pickup: "Store pickup",
};

export const TASK_KIND_LABEL: Record<Enums["task_kind"], string> = {
  follow_up: "Follow-up",
  unpaid_order: "Unpaid order",
  delivery_confirmation: "Delivery confirmation",
  fit_check: "Fit & satisfaction check",
  complaint: "Complaint",
  alteration: "Alteration",
  return: "Return",
  exchange: "Exchange",
  other: "Other",
};

export const CATEGORY_LABEL: Record<Enums["product_category"], string> = {
  clothing: "Clothing",
  shoes: "Shoes",
  bags: "Bags",
  other: "Other",
};

export const ROLE_LABEL: Record<Enums["member_role"], string> = {
  owner: "Owner",
  front_office: "Front office manager",
  production_manager: "Production manager / QC",
  sales: "Front office (retired role)",
};

/** Roles an owner can give (the retired 'sales' value is never offered). */
export const ASSIGNABLE_ROLES = ["owner", "front_office", "production_manager"] as const;

export const OWNER_TITLES = ["Managing Director / CEO", "Creative Director"] as const;

export const STOCK_KIND_LABEL = {
  raw_material: "Raw material",
  packaging: "Packaging & consumables",
  finished_good: "Finished good",
} as const;

export const LOCATION_KIND_LABEL = {
  store: "Store",
  production: "Production floor",
  showroom: "Showroom / finished goods",
  external_maker: "With an external maker",
  quarantine: "Quarantine",
} as const;

export const MAKER_TRADE_LABEL = {
  tailor: "Tailor",
  shoemaker: "Shoemaker",
  bag_maker: "Bag maker",
  other: "Other",
} as const;

export const STOCK_DOC_LABEL: Record<string, string> = {
  opening_balance: "Opening balance",
  purchase_receipt: "Purchase receipt",
  supplier_return: "Supplier return",
  transfer: "Transfer",
  material_issue: "Issue to production",
  material_return: "Return from production",
  production_completion: "Production completed",
  customer_dispatch: "Dispatched to customer",
  customer_return: "Customer return",
  scrap: "Write-off",
  adjustment: "Count adjustment",
  reversal: "Reversal",
};

export const BATCH_STATUS = {
  draft: { label: "Waiting for owner approval", tone: "warn" },
  posted: { label: "Posted", tone: "success" },
  reversed: { label: "Reversed", tone: "neutral" },
  discarded: { label: "Discarded", tone: "neutral" },
} as const;

export const PO_STATUS = {
  draft: { label: "Request: waiting for owner approval", short: "Request", tone: "warn" },
  ordered: { label: "Ordered", short: "Ordered", tone: "gold" },
  part_received: { label: "Part received", short: "Part received", tone: "gold" },
  received: { label: "Received", short: "Received", tone: "success" },
  cancelled: { label: "Cancelled", short: "Cancelled", tone: "neutral" },
  closed: { label: "Closed (rest not coming)", short: "Closed", tone: "neutral" },
} as const;

export const JOB_STATUS = {
  planned: { label: "Planned", tone: "neutral" },
  allocated: { label: "Materials allocated", tone: "gold" },
  in_progress: { label: "In progress", tone: "gold" },
  in_qc: { label: "Waiting for QC", tone: "warn" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
} as const;

export const BOM_STATUS = {
  draft: { label: "Draft", tone: "warn" },
  active: { label: "In use", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
} as const;
