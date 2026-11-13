import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chartPayload, checkChart, parseChartCsv, SYSTEM_ROLES } from "./chart-import";

// Zoho Books' export layout, with Zoho's standard accounts and a few made-up custom ones.
const ZOHO = [
  "Account ID,Account Name,Account Code,Description,Account Type,Account Status,Currency,Parent Account",
  "1,Undeposited Funds,,Zoho,Cash,Active,NGN,",
  "2,Cash on Hand,1011,,Cash,Active,NGN,",
  "3,Main Bank,1013,,Bank,Active,NGN,",
  "4,Accounts Receivable,1009,,Accounts Receivable,Active,NGN,",
  "5,Equipment and Machinery,1001,,Fixed Asset,Active,NGN,",
  "6,Solar System,1001 - 1,,Fixed Asset,Active,NGN,Equipment and Machinery",
  "7,Accounts Payable,2001,,Accounts Payable,Active,NGN,",
  "8,Unearned Revenue,2002,,Other Current Liability,Active,NGN,",
  "9,Owner's Equity,3001,,Equity,Active,NGN,",
  "10,Owner's Contribution Account,6001,,Equity,Active,NGN,",
  "11,Retained Earnings,3002,,Equity,Active,NGN,",
  "12,Sales - Clothes - Ready-to-Wear,4001,,Income,Active,NGN,",
  "13,Sales - Clothes - Amendments,4003,,Income,Active,NGN,",
  "14,COGS - Clothes - Fabric Purchase,5001,,Cost Of Goods Sold,Active,NGN,",
  "15,Rent Expense,5102,,Expense,Active,NGN,",
  "16,Rent,5299,,Other Income,Active,NGN,",
  "17,Bad Debt,,,Expense,Active,NGN,",
  "18,Old Account,8000,,Expense,Inactive,NGN,",
  "19,Exchange Gain or Loss,5500,,Other Expense,Active,NGN,",
].join("\n");

describe("parseChartCsv", () => {
  const { rows, error } = parseChartCsv(ZOHO);
  const byName = (n: string) => rows.find((r) => r.name === n)!;

  it("reads Zoho's export and maps account types", () => {
    expect(error).toBeUndefined();
    expect(byName("Main Bank").group).toBe("current_assets");
    expect(byName("Equipment and Machinery").group).toBe("non_current_assets");
    expect(byName("Exchange Gain or Loss").group).toBe("finance_costs");
  });

  it("leaves out Zoho housekeeping and inactive accounts, with a note", () => {
    expect(byName("Undeposited Funds")).toMatchObject({ include: false, note: expect.stringMatching(/housekeeping/) });
    expect(byName("Old Account")).toMatchObject({ include: false, note: expect.stringMatching(/Inactive/) });
  });

  it("tidies sub-codes and gives blank codes one in the group's range", () => {
    expect(byName("Solar System").code).toBe("1001-1");
    expect(byName("Bad Debt").code).toBe("6990");
  });

  it("suggests the accounts the app should post to", () => {
    expect(byName("Cash on Hand").role).toBe("cash");
    expect(byName("Main Bank").role).toBe("bank_main");
    expect(byName("Accounts Receivable").role).toBe("receivables");
    expect(byName("Unearned Revenue").role).toBe("customer_deposits");
    expect(byName("Owner's Equity").role).toBe("share_capital");
    expect(byName("Retained Earnings").role).toBe("retained_earnings");
    expect(byName("Equipment and Machinery").role).toBe("ppe_machinery");
    expect(byName("Sales - Clothes - Ready-to-Wear").role).toBe("sales_clothing");
    expect(byName("Sales - Clothes - Amendments").role).toBe("repair_income");
    expect(byName("COGS - Clothes - Fabric Purchase").role).toBe("materials");
    expect(byName("Rent Expense").role).toBe("rent");
  });

  it("treats an owner's contribution as a director's current account (a liability), and says so", () => {
    expect(byName("Owner's Contribution Account")).toMatchObject({ role: "director_1", group: "current_liabilities", note: expect.stringMatching(/liability/) });
  });

  it("turns a rent account typed as income into an expense, and says so", () => {
    expect(byName("Rent")).toMatchObject({ group: "operating_expenses", role: "", note: expect.stringMatching(/Other Income/) });
  });

  it("asks for the right columns", () => {
    expect(parseChartCsv("foo,bar\n1,2").error).toMatch(/Account Name/);
  });
});

describe("checkChart and chartPayload", () => {
  it("lists the roles the app will add, and sends only included accounts", () => {
    const { rows } = parseChartCsv(ZOHO);
    const { problems, added, included } = checkChart(rows);
    expect(problems).toEqual([]);
    expect(added.map((a) => a.key)).toEqual(expect.arrayContaining(["vat_input", "inv_wip", "inv_finished", "ppe_machinery_dep", "grni", "rounding"]));
    expect(added.map((a) => a.key)).not.toContain("cash");
    const payload = chartPayload(rows);
    expect(payload).toHaveLength(included.length);
    expect(payload.find((p) => p.name === "Undeposited Funds")).toBeUndefined();
    expect(payload.find((p) => p.name === "Main Bank")).toEqual({ code: "1013", name: "Main Bank", group: "current_assets", system_key: "bank_main" });
  });

  it("blocks duplicate codes, a role chosen twice and bad codes", () => {
    const { rows } = parseChartCsv(ZOHO);
    rows.find((r) => r.name === "Rent")!.code = "5102";
    rows.find((r) => r.name === "Rent")!.role = "rent";
    rows.find((r) => r.name === "Bad Debt")!.code = "abc";
    const { problems } = checkChart(rows);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringMatching(/Code 5102 is used 2 times/),
      expect.stringMatching(/Rent: chosen for 2 accounts/),
      expect.stringMatching(/Bad Debt: the code must start with a digit/),
    ]));
  });

  it("matches the database template role for role (code, group and key)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261113000027_books_chart_import.sql"), "utf8");
    const template = sql.slice(sql.indexOf("app.chart_template()"), sql.indexOf(") as t(code, name, grp, sk)"));
    const fromSql = [...template.matchAll(/\('(\d+)', '(?:[^']|'')*', '([a-z_]+)', '([a-z0-9_]+)'\)/g)]
      .map(([, code, group, key]) => ({ key, group, code }));
    expect(fromSql.length).toBeGreaterThan(60);
    expect(SYSTEM_ROLES.map(({ key, group, code }) => ({ key, group, code }))).toEqual(fromSql);
  });
});
