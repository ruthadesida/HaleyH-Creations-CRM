/**
 * The report catalogue: what each report shows, how it's defined, who may open it and how to read
 * its columns. The figures come from database functions that re-check the role (migration 0016).
 */
import type { Role } from "./dal";

export type ColumnType = "text" | "money" | "qty" | "int" | "date" | "pct" | "bool";
export type Column = { key: string; label: string; type: ColumnType };
export type Audience = "office" | "production" | "owner" | "costs" | "stock";

export type Report = {
  key: string;
  title: string;
  group: "Sales and money" | "Stock" | "Production";
  /** Plain-language definition shown above the table and in exports. */
  definition: string;
  audience: Audience;
  /** Whether it takes a date range. */
  range: boolean;
  fn: string;
  columns: Column[];
};

export const REPORTS: Report[] = [
  {
    key: "orders-attention", title: "Orders needing action", group: "Sales and money", audience: "office", range: false,
    fn: "report_orders_attention",
    definition: "Confirmed, open orders not yet dispatched that are past or within 3 days of their promised date, ready to dispatch, or still owe money.",
    columns: [
      { key: "order_number", label: "Order", type: "text" }, { key: "customer", label: "Customer", type: "text" },
      { key: "promised", label: "Promised", type: "date" }, { key: "progress", label: "Stage", type: "text" },
      { key: "owed", label: "Owed", type: "money" }, { key: "needs", label: "Needs", type: "text" },
    ],
  },
  {
    key: "sales-by-product", title: "Sales by product", group: "Sales and money", audience: "office", range: true,
    fn: "report_sales_by_product",
    definition: "Fulfilled sales: units dispatched in the period less units returned, at the order price after the order discount (delivery fees excluded). Owners also see cost of goods and estimated gross profit (not net profit); \"cost complete\" is no when any unit had no recorded cost.",
    columns: [
      { key: "product", label: "Product", type: "text" }, { key: "units", label: "Units", type: "qty" },
      { key: "sales", label: "Fulfilled sales", type: "money" }, { key: "cogs", label: "Cost of goods", type: "money" },
      { key: "gross_profit", label: "Est. gross profit", type: "money" }, { key: "cost_complete", label: "Cost complete", type: "bool" },
    ],
  },
  {
    key: "sales-by-channel", title: "Sales by channel", group: "Sales and money", audience: "office", range: true,
    fn: "report_sales_by_channel",
    definition: "Orders confirmed in the period (quotations and cancelled orders excluded), by where the customer came from, with money received so far on those orders.",
    columns: [
      { key: "channel", label: "Channel", type: "text" }, { key: "orders", label: "Orders", type: "int" },
      { key: "order_value", label: "Order value", type: "money" }, { key: "received", label: "Received", type: "money" },
    ],
  },
  {
    key: "sales-by-period", title: "Sales and cash by day", group: "Sales and money", audience: "office", range: true,
    fn: "report_sales_by_period",
    definition: "For each day: value of orders confirmed, fulfilled sales (dispatched, after discount) and cash received net of refunds. Cash is recorded manually by staff.",
    columns: [
      { key: "period", label: "Day", type: "date" }, { key: "confirmed_value", label: "Orders confirmed", type: "money" },
      { key: "fulfilled_sales", label: "Fulfilled sales", type: "money" }, { key: "cash_received", label: "Cash received", type: "money" },
    ],
  },
  {
    key: "cash", title: "Cash received", group: "Sales and money", audience: "office", range: true, fn: "report_cash",
    definition: "Customer payments and refunds recorded in the period, by method. Recorded manually: not checked against the bank. Voided records are excluded.",
    columns: [
      { key: "method", label: "Method", type: "text" }, { key: "payments", label: "Payments", type: "int" },
      { key: "received", label: "Received", type: "money" }, { key: "refunded", label: "Refunded", type: "money" },
      { key: "net", label: "Net", type: "money" },
    ],
  },
  {
    key: "balances", title: "Customer balances", group: "Sales and money", audience: "office", range: false, fn: "report_balances",
    definition: "Confirmed, open orders that still owe money: order value less money received (net of refunds).",
    columns: [
      { key: "order_number", label: "Order", type: "text" }, { key: "customer", label: "Customer", type: "text" },
      { key: "ordered", label: "Ordered", type: "date" }, { key: "order_value", label: "Order value", type: "money" },
      { key: "received", label: "Received", type: "money" }, { key: "owed", label: "Owed", type: "money" },
      { key: "progress", label: "Stage", type: "text" },
    ],
  },
  {
    key: "gross-profit", title: "Estimated gross profit by order", group: "Sales and money", audience: "owner", range: true,
    fn: "report_gross_profit",
    definition: "Orders with a dispatch in the period: fulfilled sales (after discount, less returns) minus cost of goods at moving average. Estimated, before delivery, overheads and tax. Never net profit.",
    columns: [
      { key: "order_number", label: "Order", type: "text" }, { key: "customer", label: "Customer", type: "text" },
      { key: "fulfilled_sales", label: "Fulfilled sales", type: "money" }, { key: "cogs", label: "Cost of goods", type: "money" },
      { key: "gross_profit", label: "Est. gross profit", type: "money" }, { key: "margin_pct", label: "Margin", type: "pct" },
      { key: "cost_complete", label: "Cost complete", type: "bool" },
    ],
  },
  {
    key: "supplier-balances", title: "Supplier balances", group: "Sales and money", audience: "owner", range: false,
    fn: "report_supplier_balances",
    definition: "Supplier bills less payments (both recorded manually; voided records excluded).",
    columns: [
      { key: "supplier", label: "Supplier", type: "text" }, { key: "billed", label: "Billed", type: "money" },
      { key: "paid", label: "Paid", type: "money" }, { key: "owed", label: "Owed", type: "money" },
    ],
  },
  {
    key: "stock-by-location", title: "Stock by location", group: "Stock", audience: "stock", range: false, fn: "report_stock_by_location",
    definition: "Physical stock on hand from the ledger, by item and location (including stock held by external makers and in Quarantine). Value at moving average, for people allowed to see costs. The front office sees finished goods only.",
    columns: [
      { key: "kind", label: "Kind", type: "text" }, { key: "code", label: "Code", type: "text" }, { key: "item", label: "Item", type: "text" },
      { key: "location", label: "Location", type: "text" }, { key: "on_hand", label: "On hand", type: "qty" },
      { key: "unit", label: "Unit", type: "text" }, { key: "value", label: "Value", type: "money" },
    ],
  },
  {
    key: "availability", title: "Available vs reserved", group: "Stock", audience: "stock", range: false, fn: "report_availability",
    definition: "On hand outside Quarantine, reserved for production jobs and customer orders, and available (on hand − reserved). Stock in Quarantine is shown separately and is never available.",
    columns: [
      { key: "kind", label: "Kind", type: "text" }, { key: "code", label: "Code", type: "text" }, { key: "item", label: "Item", type: "text" },
      { key: "on_hand", label: "On hand", type: "qty" }, { key: "reserved", label: "Reserved", type: "qty" },
      { key: "available", label: "Available", type: "qty" }, { key: "in_quarantine", label: "In Quarantine", type: "qty" },
      { key: "unit", label: "Unit", type: "text" },
    ],
  },
  {
    key: "valuation", title: "Inventory valuation", group: "Stock", audience: "costs", range: false, fn: "report_valuation",
    definition: "Stock on hand × moving average cost, by kind. Items flagged \"cost missing\" are counted so you know the value is incomplete.",
    columns: [
      { key: "kind", label: "Kind", type: "text" }, { key: "items", label: "Items", type: "int" },
      { key: "value", label: "Value", type: "money" }, { key: "items_missing_cost", label: "Items with missing cost", type: "int" },
    ],
  },
  {
    key: "movements", title: "Stock movements", group: "Stock", audience: "stock", range: true, fn: "report_movements",
    definition: "Every ledger line dated in the period: + into a location, − out of it. Unit cost for people allowed to see costs.",
    columns: [
      { key: "document", label: "Document", type: "text" }, { key: "type", label: "Type", type: "text" },
      { key: "effective", label: "Date", type: "date" }, { key: "item", label: "Item", type: "text" },
      { key: "location", label: "Location", type: "text" }, { key: "quantity", label: "Quantity", type: "qty" },
      { key: "unit", label: "Unit", type: "text" }, { key: "unit_cost", label: "Unit cost", type: "money" },
      { key: "reason", label: "Reason", type: "text" },
    ],
  },
  {
    key: "shortages", title: "Shortages and reorder needs", group: "Stock", audience: "production", range: false, fn: "report_shortages",
    definition: "Materials at or below their reorder level, or not enough for open jobs (what jobs still need beyond their reservations, compared with what's available).",
    columns: [
      { key: "code", label: "Code", type: "text" }, { key: "item", label: "Material", type: "text" },
      { key: "available", label: "Available", type: "qty" }, { key: "reorder_level", label: "Reorder level", type: "qty" },
      { key: "needed_by_jobs", label: "Still needed by jobs", type: "qty" }, { key: "short_by", label: "Short by", type: "qty" },
      { key: "unit", label: "Unit", type: "text" },
    ],
  },
  {
    key: "wip", title: "Work in progress by job", group: "Production", audience: "production", range: false, fn: "report_wip",
    definition: "Open jobs, how long since work started, units still to finish, and value in work in progress (materials issued less returned + labour − value already finished), for people allowed to see costs.",
    columns: [
      { key: "job", label: "Job", type: "text" }, { key: "item", label: "Making", type: "text" }, { key: "maker", label: "Maker", type: "text" },
      { key: "status", label: "Status", type: "text" }, { key: "started", label: "Started", type: "date" },
      { key: "age_days", label: "Days in work", type: "int" }, { key: "due", label: "Due", type: "date" },
      { key: "units_left", label: "Units left", type: "qty" }, { key: "wip_value", label: "WIP value", type: "money" },
    ],
  },
  {
    key: "material-variance", title: "Planned vs actual material", group: "Production", audience: "production", range: true,
    fn: "report_material_variance",
    definition: "For jobs completed in the period: material planned (recipe × quantity + wastage) against material actually used (issued − returned).",
    columns: [
      { key: "job", label: "Job", type: "text" }, { key: "item", label: "Made", type: "text" }, { key: "material", label: "Material", type: "text" },
      { key: "planned", label: "Planned", type: "qty" }, { key: "used", label: "Used", type: "qty" },
      { key: "variance", label: "Over (+) / under (−)", type: "qty" }, { key: "variance_pct", label: "Variance", type: "pct" },
      { key: "unit", label: "Unit", type: "text" },
    ],
  },
  {
    key: "qc", title: "Production output and QC failures", group: "Production", audience: "production", range: true, fn: "report_qc",
    definition: "Inspections recorded in the period by product: passed (now stock), sent for rework, rejected (to Quarantine), and the failure rate.",
    columns: [
      { key: "item", label: "Product", type: "text" }, { key: "inspected", label: "Inspected", type: "qty" },
      { key: "passed", label: "Passed", type: "qty" }, { key: "rework", label: "Rework", type: "qty" },
      { key: "rejected", label: "Rejected", type: "qty" }, { key: "failure_pct", label: "Failure rate", type: "pct" },
    ],
  },
  {
    key: "makers", title: "Maker workload", group: "Production", audience: "production", range: true, fn: "report_makers",
    definition: "Per maker: open jobs, open jobs past their due date, and units that passed QC in the period.",
    columns: [
      { key: "maker", label: "Maker", type: "text" }, { key: "external", label: "External", type: "bool" },
      { key: "open_jobs", label: "Open jobs", type: "int" }, { key: "overdue_jobs", label: "Overdue", type: "int" },
      { key: "units_completed", label: "Units passed", type: "qty" },
    ],
  },
];

/** Whether a role may open a report (the database checks again). */
export function canOpen(report: Report, role: Role, canSeeCosts: boolean): boolean {
  switch (report.audience) {
    case "owner": return role === "owner";
    case "office": return role === "owner" || role === "front_office";
    case "production": return role === "owner" || role === "production_manager";
    case "costs": return canSeeCosts;
    case "stock": return true;
  }
}

export function findReport(key: string): Report | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Formats a cell for display; money arrives in kobo. */
export function formatCell(value: unknown, type: ColumnType, currency = "NGN"): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "money": return new Intl.NumberFormat("en-NG", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(Number(value) / 100);
    case "qty": return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 4 }).format(Number(value));
    case "int": return new Intl.NumberFormat("en-NG").format(Number(value));
    case "pct": return `${Number(value)}%`;
    case "bool": return value ? "Yes" : "No";
    default: return String(value).replaceAll("_", " ");
  }
}

/** Value for CSV: money in naira (two decimals), everything else as is. */
export function csvValue(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return "";
  if (type === "money") return (Number(value) / 100).toFixed(2);
  if (type === "bool") return value ? "yes" : "no";
  return String(value);
}
