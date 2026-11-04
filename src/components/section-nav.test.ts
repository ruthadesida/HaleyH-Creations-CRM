import { describe, expect, it } from "vitest";
import { activeTab } from "./section-nav";

const tabs = [
  { href: "/w/a/purchasing", label: "Purchase orders", exact: true },
  { href: "/w/a/purchasing/receipts", label: "Goods received" },
  { href: "/w/a/purchasing/suppliers", label: "Supplier balances" },
];

describe("section tabs", () => {
  it("highlights a tab's own pages", () => {
    expect(activeTab(tabs, "/w/a/purchasing")).toBe("/w/a/purchasing");
    expect(activeTab(tabs, "/w/a/purchasing/receipts/123")).toBe("/w/a/purchasing/receipts");
  });
  it("falls back to the closest parent for pages without a tab", () => {
    expect(activeTab(tabs, "/w/a/purchasing/0000-po-id")).toBe("/w/a/purchasing");
  });
  it("highlights nothing outside the section", () => {
    expect(activeTab(tabs, "/w/a/orders")).toBeUndefined();
  });
});