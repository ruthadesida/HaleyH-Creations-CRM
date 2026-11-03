import { z } from "zod";
import { parseMoneyInput } from "../money";

/** Empty form strings become null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Keep this under ${max} characters.`);

export const optionalUuid = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().uuid().nullable())
  .optional()
  .transform((v) => v ?? null);

export const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.").nullable())
  .optional()
  .transform((v) => v ?? null);

/** Amount typed in naira → integer kobo. */
export const moneyInput = (message = "Enter an amount like 45000 or 45,000.50.") =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      const minor = parseMoneyInput(v === "" ? "0" : v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return minor;
    });

export const positiveMoney = (message = "Enter an amount greater than zero.") =>
  moneyInput().refine((v) => v > 0, message);

export function enumOrNull<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((v) => (v === "" ? null : v))
    .pipe(z.enum(values).nullable())
    .optional()
    .transform((v) => v ?? null);
}

/** Reads all values of a repeated field (checkboxes). */
export function many(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((v): v is string => typeof v === "string" && v !== "");
}
