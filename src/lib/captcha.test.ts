import { describe, expect, it } from "vitest";
import { formValues } from "./action-state";
import { CAPTCHA_FIELD, captchaToken, isCaptchaError } from "./captcha";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe("captchaToken", () => {
  it("reads the token Turnstile adds to the form", () => {
    expect(captchaToken(form({ [CAPTCHA_FIELD]: "tok_123" }))).toBe("tok_123");
  });

  it("is undefined without a widget or before the check finishes", () => {
    expect(captchaToken(form({}))).toBeUndefined();
    expect(captchaToken(form({ [CAPTCHA_FIELD]: "  " }))).toBeUndefined();
  });
});

describe("isCaptchaError", () => {
  it("recognises Supabase's security-check failure only", () => {
    expect(isCaptchaError("captcha_failed")).toBe(true);
    expect(isCaptchaError("invalid_credentials")).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });
});

describe("formValues", () => {
  it("never echoes the password or the used security token back to the form", () => {
    const values = formValues(form({ email: "a@example.com", password: "secret12345", [CAPTCHA_FIELD]: "tok" }));
    expect(values).toEqual({ email: "a@example.com" });
  });
});
