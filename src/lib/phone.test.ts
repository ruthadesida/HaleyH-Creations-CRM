import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, whatsappLink } from "./phone";

describe("normalizePhone (mirrors app.normalize_phone in SQL)", () => {
  it.each([
    ["08031112222", "+2348031112222"],
    ["0803 111 2222", "+2348031112222"],
    ["0803-111-2222", "+2348031112222"],
    ["+234 803 111 2222", "+2348031112222"],
    ["2348031112222", "+2348031112222"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", null, undefined])("returns null for %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("treats differently formatted copies of one number as duplicates", () => {
    expect(normalizePhone("0803 111 2222")).toBe(normalizePhone("+2348031112222"));
  });
});

describe("whatsappLink", () => {
  it("builds a wa.me link with the message encoded", () => {
    expect(whatsappLink("0803 111 2222", "Hello Ada, your order HC-00012 is ready & paid.")).toBe(
      "https://wa.me/2348031112222?text=Hello%20Ada%2C%20your%20order%20HC-00012%20is%20ready%20%26%20paid.",
    );
  });

  it("returns null without a usable number", () => {
    expect(whatsappLink("", "Hi")).toBeNull();
    expect(whatsappLink("123", "Hi")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("groups Nigerian numbers", () => {
    expect(formatPhone("08031112222")).toBe("+234 803 111 2222");
  });
  it("leaves other numbers as typed", () => {
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });
});
