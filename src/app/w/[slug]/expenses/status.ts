import type { Tone } from "@/components/ui/bits";

export const EXPENSE_STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  voided: { label: "Voided", tone: "neutral" },
};
