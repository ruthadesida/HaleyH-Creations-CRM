import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(120),
  orderPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,6}$/, "Use 1–6 letters or numbers, e.g. HC."),
  currency: z.enum(["NGN", "GHS", "KES", "ZAR", "USD", "GBP", "EUR"]),
  timezone: z.string().min(1),
});

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "workspace"
  );
}
