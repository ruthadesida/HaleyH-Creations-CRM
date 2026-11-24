/**
 * Security check (Cloudflare Turnstile) on the sign-in, sign-up and password-reset forms. (Joining by invite
 * needs none: the invite link is the proof, and the session starts without a password sign-in.)
 * Supabase verifies the token itself once CAPTCHA protection is switched on in its Attack Protection
 * settings; the widget only appears when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (see docs/DEPLOY.md).
 */

/** The field Turnstile adds to the form it sits in. */
export const CAPTCHA_FIELD = "cf-turnstile-response";

/** The token posted with the form, or undefined (no widget in development, or not finished yet). */
export function captchaToken(formData: FormData): string | undefined {
  const value = formData.get(CAPTCHA_FIELD);
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export const CAPTCHA_FAILED_MESSAGE =
  "The security check didn't go through. Wait for it to show a tick, then try again.";

/** Supabase's error code when the token is missing, expired or already used. */
export function isCaptchaError(code: string | undefined): boolean {
  return code === "captcha_failed";
}
