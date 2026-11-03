import { describe, expect, it } from "vitest";
import { customerFromForm, customerSchema } from "./customer";

function form(entries: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

describe("customerSchema", () => {
  it("accepts the short form: name and phone", () => {
    const r = customerSchema.safeParse(customerFromForm(form({ full_name: "Ada Okafor", phone: "0803 111 2222" })));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.country).toBe("Nigeria");
      expect(r.data.email).toBeNull();
      expect(r.data.tags).toEqual([]);
    }
  });

  it("copies phone to WhatsApp when 'same as phone' is ticked", () => {
    const r = customerSchema.parse(customerFromForm(form({ full_name: "Ada", phone: "08031112222", whatsapp_same: "on" })));
    expect(r.whatsapp).toBe("08031112222");
  });

  it("requires some way to contact the customer", () => {
    const r = customerSchema.safeParse(customerFromForm(form({ full_name: "Ada" })));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["phone"]);
  });

  it("requires a unit when measurements are given", () => {
    const r = customerSchema.safeParse(customerFromForm(form({ full_name: "Ada", phone: "08031112222", bust: "92" })));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "measurement_unit")).toBe(true);
  });

  it("splits tags and reads checkboxes", () => {
    const r = customerSchema.parse(
      customerFromForm(form({
        full_name: "Ada", email: "ada@example.com", tags: "repeat customer, wholesale ,",
        contact_preferences: ["whatsapp", "email"], marketing_consent: "on",
      })),
    );
    expect(r.tags).toEqual(["repeat customer", "wholesale"]);
    expect(r.contact_preferences).toEqual(["whatsapp", "email"]);
    expect(r.marketing_consent).toBe(true);
  });

  it.each([
    [{ full_name: "", phone: "08031112222" }, "full_name"],
    [{ full_name: "Ada", phone: "123" }, "phone"],
    [{ full_name: "Ada", email: "not-an-email" }, "email"],
    [{ full_name: "Ada", phone: "08031112222", waist: "-5", measurement_unit: "cm" }, "waist"],
    [{ full_name: "Ada", phone: "08031112222", source: "tiktok" }, "source"],
  ])("rejects bad input %j", (input, field) => {
    const r = customerSchema.safeParse(customerFromForm(form(input)));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === field)).toBe(true);
  });
});
