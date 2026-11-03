import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyInput, paymentStatus, toMoneyInput } from "./money";

describe("paymentStatus (mirrors app.payment_status in SQL)", () => {
  it.each([
    [32000, 0, "unpaid"],
    [32000, -100, "unpaid"],
    [32000, 10000, "part_paid"],
    [32000, 32000, "paid"],
    [32000, 37000, "overpaid"],
    [0, 0, "settled"],
    [0, 27000, "overpaid"], // cancelled order with money still held: refund due
  ] as const)("due %i, received %i → %s", (due, paid, expected) => {
    expect(paymentStatus(due, paid)).toBe(expected);
  });
});

describe("formatMoney", () => {
  it("shows whole naira without kobo", () => {
    expect(formatMoney(12500000)).toBe("₦125,000");
  });
  it("shows kobo when present", () => {
    expect(formatMoney(4500050)).toBe("₦45,000.50");
  });
  it("formats negatives (refund due)", () => {
    expect(formatMoney(-500000)).toBe("-₦5,000");
  });
  it("formats zero", () => {
    expect(formatMoney(0)).toBe("₦0");
  });
});

describe("parseMoneyInput", () => {
  it.each([
    ["45000", 4500000],
    ["45,000", 4500000],
    ["₦45,000", 4500000],
    [" 45 000 ", 4500000],
    ["45000.5", 4500050],
    ["45000.05", 4500005],
    ["0", 0],
  ])("%s → %i kobo", (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each(["", "abc", "-500", "45.123", "4e5", "1.2.3", "₦", "Infinity"])("rejects %j", (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });

  it("round-trips with toMoneyInput", () => {
    for (const minor of [0, 1, 99, 100, 4500050, 123456789]) {
      expect(parseMoneyInput(toMoneyInput(minor))).toBe(minor);
    }
  });
});
