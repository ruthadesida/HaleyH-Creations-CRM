import { z } from "zod";

export const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);

// Mirrors the Supabase project setting: 10+ characters with letters and digits.
export const newPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use 72 characters or fewer.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/\d/, "Include at least one number.");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120),
  email,
  password: newPassword,
});

export const resetRequestSchema = z.object({ email });
export const newPasswordSchema = z.object({ password: newPassword });

/** Only allow redirects to paths on this site ("/w/…"), never "//evil.com" or "https://…". */
export function safeNext(next: unknown, fallback = "/workspaces"): string {
  if (typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
