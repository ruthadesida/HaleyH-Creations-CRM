import type { AccountGroup } from "./books";
import { parseCsv } from "./csv";

/**
 * Reading an owner's own chart of accounts (a Zoho Books export, or any CSV with code, name and type)
 * and suggesting how it maps onto the app: where each account belongs, which accounts the app should
 * post to automatically ("roles"), and Zoho's housekeeping accounts to leave out. The owner reviews and
 * changes all of it before anything is saved; roles left unmapped get the app's standard account.
 * Keep SYSTEM_ROLES in step with app.chart_template() (migration 0027).
 */

export const SYSTEM_ROLES: { key: string; label: string; group: AccountGroup; code: string }[] = [
  { key: "cash", label: "Cash in hand", group: "current_assets", code: "1000" },
  { key: "bank_main", label: "Main business bank account", group: "current_assets", code: "1010" },
  { key: "clearing", label: "POS and transfer clearing", group: "current_assets", code: "1050" },
  { key: "receivables", label: "Trade receivables", group: "current_assets", code: "1100" },
  { key: "prepayments", label: "Prepayments", group: "current_assets", code: "1160" },
  { key: "vat_input", label: "VAT receivable (input VAT)", group: "current_assets", code: "1170" },
  { key: "due_from_directors", label: "Due from directors", group: "current_assets", code: "1180" },
  { key: "share_capital_unpaid", label: "Share capital unpaid", group: "current_assets", code: "1190" },
  { key: "inv_raw", label: "Inventory: raw materials", group: "current_assets", code: "1200" },
  { key: "inv_wip", label: "Inventory: work in progress", group: "current_assets", code: "1210" },
  { key: "inv_finished", label: "Inventory: finished goods", group: "current_assets", code: "1220" },
  { key: "inv_quarantine", label: "Inventory: in quarantine", group: "current_assets", code: "1230" },
  { key: "ppe_machinery", label: "Plant and machinery", group: "non_current_assets", code: "1500" },
  { key: "ppe_machinery_dep", label: "Plant and machinery: accumulated depreciation", group: "non_current_assets", code: "1505" },
  { key: "ppe_furniture", label: "Furniture and fittings", group: "non_current_assets", code: "1510" },
  { key: "ppe_furniture_dep", label: "Furniture and fittings: accumulated depreciation", group: "non_current_assets", code: "1515" },
  { key: "ppe_computers", label: "Computers and phones", group: "non_current_assets", code: "1520" },
  { key: "ppe_computers_dep", label: "Computers and phones: accumulated depreciation", group: "non_current_assets", code: "1525" },
  { key: "ppe_equipment", label: "Generators and equipment", group: "non_current_assets", code: "1530" },
  { key: "ppe_equipment_dep", label: "Generators and equipment: accumulated depreciation", group: "non_current_assets", code: "1535" },
  { key: "ppe_vehicles", label: "Motor vehicles", group: "non_current_assets", code: "1540" },
  { key: "ppe_vehicles_dep", label: "Motor vehicles: accumulated depreciation", group: "non_current_assets", code: "1545" },
  { key: "payables", label: "Trade payables", group: "current_liabilities", code: "2000" },
  { key: "grni", label: "Goods received not invoiced", group: "current_liabilities", code: "2010" },
  { key: "maker_payables", label: "Maker fees payable", group: "current_liabilities", code: "2020" },
  { key: "customer_deposits", label: "Customer deposits", group: "current_liabilities", code: "2030" },
  { key: "vat_output", label: "VAT payable (output VAT)", group: "current_liabilities", code: "2100" },
  { key: "paye", label: "PAYE payable", group: "current_liabilities", code: "2110" },
  { key: "wht", label: "Withholding tax payable", group: "current_liabilities", code: "2120" },
  { key: "pension", label: "Pension payable", group: "current_liabilities", code: "2130" },
  { key: "cit", label: "Company income tax payable", group: "current_liabilities", code: "2140" },
  { key: "accruals", label: "Accruals", group: "current_liabilities", code: "2150" },
  { key: "net_pay", label: "Net pay payable", group: "current_liabilities", code: "2160" },
  { key: "director_1", label: "Director's current account 1", group: "current_liabilities", code: "2200" },
  { key: "director_2", label: "Director's current account 2", group: "current_liabilities", code: "2210" },
  { key: "loans_short", label: "Short-term loans", group: "current_liabilities", code: "2300" },
  { key: "loans_long", label: "Long-term loans", group: "non_current_liabilities", code: "2500" },
  { key: "share_capital", label: "Share capital", group: "equity", code: "3000" },
  { key: "bn_capital", label: "Business-name capital taken over", group: "equity", code: "3100" },
  { key: "retained_earnings", label: "Retained earnings", group: "equity", code: "3200" },
  { key: "opening_equity", label: "Opening balance equity", group: "equity", code: "3300" },
  { key: "dividends", label: "Dividends", group: "equity", code: "3400" },
  { key: "sales_clothing", label: "Sales: clothing", group: "income", code: "4000" },
  { key: "sales_shoes", label: "Sales: shoes", group: "income", code: "4010" },
  { key: "sales_bags", label: "Sales: bags", group: "income", code: "4020" },
  { key: "sales_other", label: "Sales: other", group: "income", code: "4030" },
  { key: "repair_income", label: "Repair income", group: "income", code: "4100" },
  { key: "delivery_income", label: "Delivery charges", group: "income", code: "4200" },
  { key: "discounts", label: "Discounts given", group: "income", code: "4300" },
  { key: "sales_returns", label: "Sales returns", group: "income", code: "4310" },
  { key: "other_income", label: "Other income", group: "other_income", code: "4900" },
  { key: "cogs", label: "Cost of goods sold", group: "cost_of_sales", code: "5000" },
  { key: "materials", label: "Materials and fabrics", group: "cost_of_sales", code: "5010" },
  { key: "production_labour", label: "Production labour and maker fees", group: "cost_of_sales", code: "5020" },
  { key: "packaging", label: "Printing, labels and packaging", group: "cost_of_sales", code: "5030" },
  { key: "production_losses", label: "Production losses and rework", group: "cost_of_sales", code: "5040" },
  { key: "stock_writeoffs", label: "Stock write-offs and count differences", group: "cost_of_sales", code: "5050" },
  { key: "inbound_delivery", label: "Inbound delivery", group: "cost_of_sales", code: "5060" },
  { key: "stock_change", label: "Opening and closing stock adjustment", group: "cost_of_sales", code: "5090" },
  { key: "salaries", label: "Salaries and wages", group: "operating_expenses", code: "6000" },
  { key: "contract_pay", label: "Contract staff pay", group: "operating_expenses", code: "6010" },
  { key: "pension_expense", label: "Pension (employer)", group: "operating_expenses", code: "6020" },
  { key: "rent", label: "Rent", group: "operating_expenses", code: "6040" },
  { key: "delivery_out", label: "Delivery and logistics", group: "operating_expenses", code: "6070" },
  { key: "bank_charges", label: "Bank charges", group: "operating_expenses", code: "6130" },
  { key: "depreciation", label: "Depreciation", group: "operating_expenses", code: "6180" },
  { key: "tax_borne", label: "PAYE and withholding tax borne by the company", group: "operating_expenses", code: "6190" },
  { key: "interest", label: "Interest", group: "finance_costs", code: "7000" },
  { key: "income_tax", label: "Income tax expense", group: "tax", code: "7900" },
  { key: "rounding", label: "Rounding", group: "operating_expenses", code: "9999" },
];
export const ROLE_BY_KEY = new Map(SYSTEM_ROLES.map((r) => [r.key, r]));

/** Zoho Books account types → where the account belongs here. */
const ZOHO_TYPES: Record<string, AccountGroup> = {
  "cash": "current_assets", "bank": "current_assets", "accounts receivable": "current_assets", "other current asset": "current_assets",
  "stock": "current_assets", "inventory": "current_assets", "payment clearing": "current_assets", "other asset": "non_current_assets",
  "fixed asset": "non_current_assets", "accounts payable": "current_liabilities", "other current liability": "current_liabilities",
  "credit card": "current_liabilities", "long term liability": "non_current_liabilities", "other liability": "non_current_liabilities",
  "equity": "equity", "income": "income", "other income": "other_income", "cost of goods sold": "cost_of_sales",
  "expense": "operating_expenses", "other expense": "finance_costs",
};
const GENERIC_TYPES: Record<string, AccountGroup> = {
  "asset": "current_assets", "current asset": "current_assets", "current assets": "current_assets", "non-current asset": "non_current_assets",
  "non-current assets": "non_current_assets", "liability": "current_liabilities", "current liability": "current_liabilities",
  "current liabilities": "current_liabilities", "non-current liability": "non_current_liabilities", "revenue": "income", "sales": "income",
  "cost of sales": "cost_of_sales", "expenses": "operating_expenses", "operating expense": "operating_expenses", "tax": "tax",
};

/** Accounts Zoho creates for its own bookkeeping that the app doesn't need; suggested "leave out". */
const ZOHO_HOUSEKEEPING = new Set([
  "undeposited funds", "opening balance adjustments", "opening balance offset", "dimension adjustments", "uncategorized",
  "credit card charges", "late fee income", "lodging",
]);

export type ChartRow = {
  row: number;
  include: boolean;
  code: string;
  name: string;
  group: AccountGroup | "";
  role: string;
  /** Why something was suggested or needs a look. */
  note?: string;
  sourceType: string;
};

type Rule = { role: string; test: RegExp; groups?: AccountGroup[]; types?: string[] };
// First matching account wins for each role. Only clear, conventional names.
const RULES: Rule[] = [
  { role: "bank_main", test: /./, types: ["bank"] },
  { role: "cash", test: /cash (on|in) hand/i },
  { role: "receivables", test: /./, types: ["accounts receivable"] },
  { role: "receivables", test: /receivable/i, groups: ["current_assets"] },
  { role: "payables", test: /./, types: ["accounts payable"] },
  { role: "payables", test: /payable/i, groups: ["current_liabilities"] },
  { role: "customer_deposits", test: /unearned revenue|customer deposit/i },
  { role: "prepayments", test: /prepaid|prepayment/i },
  { role: "vat_output", test: /vat payable|output vat|^tax payable$/i },
  { role: "vat_input", test: /input vat|vat receivable/i },
  { role: "retained_earnings", test: /retained earnings/i },
  { role: "share_capital", test: /share capital|^owner'?s equity$/i },
  { role: "opening_equity", test: /opening balance (equity|offset)/i },
  { role: "dividends", test: /dividend/i },
  { role: "director_1", test: /director|owner'?s contribution|shareholder'?s? loan/i, groups: ["equity", "current_liabilities", "non_current_liabilities"] },
  { role: "loans_short", test: /^loans? payable$|short.term loan/i },
  { role: "inv_raw", test: /./, types: ["stock", "inventory"] },
  { role: "ppe_machinery", test: /machinery/i, groups: ["non_current_assets"] },
  { role: "ppe_furniture", test: /furniture/i, groups: ["non_current_assets"] },
  { role: "ppe_computers", test: /computer|laptop|phone/i, groups: ["non_current_assets"] },
  { role: "ppe_vehicles", test: /vehicle/i, groups: ["non_current_assets"] },
  { role: "sales_clothing", test: /sales.*cloth/i, groups: ["income"] },
  { role: "sales_shoes", test: /sales.*shoe/i, groups: ["income"] },
  { role: "sales_bags", test: /sales.*bag/i, groups: ["income"] },
  { role: "repair_income", test: /repair|amendment|alteration/i, groups: ["income"] },
  { role: "delivery_income", test: /shipping charge|delivery charge/i, groups: ["income"] },
  { role: "discounts", test: /^discounts?( given)?$/i, groups: ["income"] },
  { role: "other_income", test: /^(general|other) income$/i },
  { role: "materials", test: /fabric|material/i, groups: ["cost_of_sales"] },
  { role: "production_labour", test: /labou?r/i, groups: ["cost_of_sales"] },
  { role: "packaging", test: /packaging/i, groups: ["cost_of_sales", "operating_expenses"] },
  { role: "salaries", test: /salar/i, groups: ["operating_expenses"] },
  { role: "rent", test: /^rent( expense)?$/i, groups: ["operating_expenses"] },
  { role: "delivery_out", test: /transport|logistics/i, groups: ["operating_expenses"] },
  { role: "bank_charges", test: /bank (fees|charges)/i, groups: ["operating_expenses"] },
  { role: "depreciation", test: /depreciation/i, groups: ["operating_expenses"] },
  { role: "interest", test: /^interest( expense)?$/i, groups: ["finance_costs", "operating_expenses"] },
];

const GROUP_BASE: Record<AccountGroup, number> = {
  current_assets: 1000, non_current_assets: 1500, current_liabilities: 2000, non_current_liabilities: 2500, equity: 3000,
  income: 4000, other_income: 4900, cost_of_sales: 5000, operating_expenses: 6000, finance_costs: 7000, tax: 7900,
};

export function normaliseCode(raw: string) {
  return raw.replace(/\s+/g, "");
}
export const CODE_PATTERN = /^[0-9][0-9A-Za-z-]{0,15}$/;

/** Reads the CSV and makes suggestions. Errors are about the file itself (missing columns). */
export function parseChartCsv(text: string): { rows: ChartRow[]; error?: string } {
  const all = parseCsv(text);
  const header = (all[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col("account name", "name", "account");
  const iCode = col("account code", "code", "account number", "account no");
  const iType = col("account type", "type", "group", "category");
  const iStatus = col("account status", "status");
  if (iName < 0 || iType < 0) {
    return { rows: [], error: "The first row needs column names, at least Account Name and Account Type (as Zoho exports), plus Account Code." };
  }
  const rows: ChartRow[] = [];
  all.slice(1).forEach((r, i) => {
    const name = (r[iName] ?? "").trim();
    if (!name) return;
    const status = iStatus >= 0 ? (r[iStatus] ?? "").trim().toLowerCase() : "active";
    const sourceType = (r[iType] ?? "").trim();
    const t = sourceType.toLowerCase();
    let group: AccountGroup | "" = ZOHO_TYPES[t] ?? GENERIC_TYPES[t] ?? "";
    let note: string | undefined;
    // A cost typed as income in the file (e.g. "Rent" as Other Income) is almost always a slip.
    if ((group === "income" || group === "other_income") && /^rent( expense)?$/i.test(name)) {
      group = "operating_expenses";
      note = `Typed "${sourceType}" in your file; set as an expense. Change it back if you receive this rent.`;
    }
    const housekeeping = ZOHO_HOUSEKEEPING.has(name.toLowerCase());
    rows.push({
      row: i + 2,
      include: status !== "inactive" && !housekeeping,
      code: normaliseCode(iCode >= 0 ? r[iCode] ?? "" : ""),
      name: name.slice(0, 120),
      group,
      role: "",
      note: housekeeping ? "Zoho housekeeping account; left out (tick to keep it)." : status === "inactive" ? "Inactive in your file; left out." : note,
      sourceType,
    });
  });
  suggestRoles(rows);
  fillCodes(rows);
  return { rows };
}

function suggestRoles(rows: ChartRow[]) {
  const taken = new Set<string>();
  for (const rule of RULES) {
    if (taken.has(rule.role)) continue;
    const hit = rows.find((r) => r.include && !r.role && r.group !== ""
      && (!rule.types || rule.types.includes(r.sourceType.toLowerCase()))
      && (!rule.groups || rule.groups.includes(r.group as AccountGroup))
      && rule.test.test(r.name));
    if (hit) {
      hit.role = rule.role;
      taken.add(rule.role);
    }
  }
  for (const r of rows) {
    if (r.role === "director_1" && r.group === "equity") {
      r.note = "Set as a director's current account (a liability): money an owner put in that the company repays. Pick another role or none if it's capital.";
    }
    if (r.role) r.group = ROLE_BY_KEY.get(r.role)!.group;
  }
}

/** Gives accounts with no code one in their group's range, after the codes already used. */
function fillCodes(rows: ChartRow[]) {
  const used = new Set(rows.filter((r) => r.code).map((r) => r.code));
  for (const r of rows) {
    if (r.code || !r.group) continue;
    let n = GROUP_BASE[r.group] + 990;
    while (used.has(String(n))) n++;
    r.code = String(n);
    used.add(r.code);
    r.note = r.note ?? `No code in your file; given ${r.code}.`;
  }
}

/** Problems that block saving, and the app roles the owner's chart doesn't cover (the app adds those). */
export function checkChart(rows: ChartRow[]) {
  const included = rows.filter((r) => r.include);
  const problems: string[] = [];
  const codes = new Map<string, number>();
  const roles = new Map<string, number>();
  for (const r of included) {
    if (!CODE_PATTERN.test(r.code)) problems.push(`${r.name}: the code must start with a digit, e.g. 1001 or 1001-1.`);
    if (!r.group && !r.role) problems.push(`${r.name}: choose where it belongs.`);
    if (!r.name.trim()) problems.push(`Row ${r.row}: give the account a name.`);
    codes.set(r.code, (codes.get(r.code) ?? 0) + 1);
    if (r.role) roles.set(r.role, (roles.get(r.role) ?? 0) + 1);
  }
  for (const [code, n] of codes) if (n > 1 && code) problems.push(`Code ${code} is used ${n} times.`);
  for (const [role, n] of roles) if (n > 1) problems.push(`${ROLE_BY_KEY.get(role)?.label}: chosen for ${n} accounts. Pick one.`);
  if (included.length === 0) problems.push("Choose at least one account to bring in.");
  const added = SYSTEM_ROLES.filter((s) => !roles.has(s.key));
  return { problems, added, included };
}

/** What the database receives: code, name, group and role for each account brought in. */
export function chartPayload(rows: ChartRow[]) {
  return rows.filter((r) => r.include).map((r) => ({ code: r.code, name: r.name.trim(), group: r.group, system_key: r.role || null }));
}
