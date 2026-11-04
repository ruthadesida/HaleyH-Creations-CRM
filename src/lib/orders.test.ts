import { describe, expect, it } from "vitest";
import { orderProgress } from "./orders";

describe("orderProgress", () => {
  const base = { status: "open", confirmed_at: "2026-11-04T10:00:00Z", fulfilment_stage: "confirmed" };
  it("calls an unconfirmed order a quotation (not a sale)", () => {
    expect(orderProgress({ ...base, confirmed_at: null }).label).toBe("Quotation");
  });
  it("cancelled wins over everything", () => {
    expect(orderProgress({ ...base, status: "cancelled", fulfilment_stage: "dispatched" }).label).toBe("Cancelled");
  });
  it("follows the fulfilment records", () => {
    expect(orderProgress(base).label).toBe("Confirmed");
    expect(orderProgress({ ...base, fulfilment_stage: "ready_for_dispatch" }).label).toBe("Ready to dispatch");
    expect(orderProgress({ ...base, fulfilment_stage: "dispatched" }).label).toBe("Dispatched");
    expect(orderProgress({ ...base, fulfilment_stage: "delivered" }).label).toBe("Delivered");
  });
});
