import { describe, expect, it } from "vitest";
import { newPassword, safeNext, signUpSchema } from "./auth";

describe("safeNext (open-redirect protection)", () => {
  it.each(["/workspaces", "/w/haleyh/orders?status=open"])("allows on-site path %s", (p) => {
    expect(safeNext(p)).toBe(p);
  });
  it.each(["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", null, 42])(
    "rejects %j",
    (p) => {
      expect(safeNext(p)).toBe("/workspaces");
    },
  );
});

describe("newPassword", () => {
  it("accepts 10+ characters with a letter and a number", () => {
    expect(newPassword.safeParse("haleyh2026x").success).toBe(true);
  });
  it.each(["short1", "onlyletterslong", "1234567890"])("rejects %s", (p) => {
    expect(newPassword.safeParse(p).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("normalises the email", () => {
    const r = signUpSchema.parse({ fullName: " Ada ", email: " Ada@Example.COM ", password: "haleyh2026x" });
    expect(r).toEqual({ fullName: "Ada", email: "ada@example.com", password: "haleyh2026x" });
  });
});
