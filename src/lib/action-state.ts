import type { z } from "zod";

/** The shape every Server Action returns to its form. */
export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** Echo of submitted values so the form keeps them after an error. */
  values?: Record<string, string>;
};

export const initialState: ActionState = {};

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export function formValues(formData: FormData, omit: string[] = ["password"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string" || omit.includes(k) || k.startsWith("$")) continue;
    // Repeated fields (checkboxes) are joined so they can be restored after an error.
    out[k] = k in out ? `${out[k]},${v}` : v;
  }
  return out;
}

/** Turns a Postgres/Supabase error into a message staff can act on. */
export function friendlyDbError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "42501":
      return error.message?.startsWith("Only") || error.message?.startsWith("You")
        ? error.message
        : "You don't have permission to do that.";
    case "23505":
      return error.message?.includes("enquiry")
        ? "An order already exists for this enquiry."
        : "That already exists.";
    case "23503":
      return "That record is no longer available.";
    case "P0001":
      return error.message ?? "That change isn't allowed.";
    default:
      return "Something went wrong saving that. Please try again.";
  }
}
