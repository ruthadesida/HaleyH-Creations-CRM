import { describe, expect, it } from "vitest";
import { directorsNote, figureNotes, ppeNote, type Movement } from "./annual-notes";
import type { TbRow } from "./statements";

const row = (id: string, group: string, key: string | null, opening: number, closing: number, name = id): TbRow =>
  ({ account_id: id, code: id, name, account_group: group, system_key: key, opening_minor: opening, closing_minor: closing });
const mv = (id: string, opening: number, debit: number, credit: number): Movement =>
  ({ account_id: id, opening_minor: opening, debit_minor: debit, credit_minor: credit, closing_minor: opening + debit - credit });

describe("annual accounts notes", () => {
  it("builds the fixed asset movement per class", () => {
    const cur = [
      row("m", "non_current_assets", "ppe_machinery", 1_000_000, 1_300_000, "Plant and machinery"),
      row("md", "non_current_assets", "ppe_machinery_dep", -200_000, -350_000, "Plant: depreciation"),
      row("v", "non_current_assets", "ppe_vehicles", 2_000_000, 0, "Motor vehicles"),
      row("vd", "non_current_assets", "ppe_vehicles_dep", -800_000, 0, "Vehicles: depreciation"),
    ];
    const moves = [mv("m", 1_000_000, 300_000, 0), mv("md", -200_000, 0, 150_000), mv("v", 2_000_000, 0, 2_000_000), mv("vd", -800_000, 900_000, 100_000)];
    const note = ppeNote(cur, moves, [{ id: "md", contra_of: "m" }, { id: "vd", contra_of: null }, { id: "m", contra_of: null }, { id: "v", contra_of: null }])!;
    expect(note.columns).toEqual(["Plant and machinery", "Motor vehicles", "Total"]);
    const line = (label: string, nth = 0) => note.rows.filter((r) => r.label === label)[nth].values;
    expect(line("Additions")).toEqual([300_000, 0, 300_000]);
    expect(line("Disposals")).toEqual([0, -2_000_000, -2_000_000]);
    expect(line("At the end of the year", 0)).toEqual([1_300_000, 0, 1_300_000]); // cost
    expect(line("Charge for the year")).toEqual([150_000, 100_000, 250_000]);
    expect(line("On disposals")).toEqual([0, -900_000, -900_000]);
    expect(line("At the end of the year", 1)).toEqual([350_000, 0, 350_000]); // depreciation
    expect(line("At the end of the year", 2)).toEqual([950_000, 0, 950_000]); // carrying amount = balance sheet
    expect(line("At the start of the year", 2)).toEqual([800_000, 1_200_000, 2_000_000]);
  });

  it("shows directors' accounts as owed to the director", () => {
    const cur = [row("d1", "current_liabilities", "director_1", -100_000, -250_000, "Director 1")];
    const note = directorsNote(cur, [mv("d1", -100_000, 50_000, 200_000)])!;
    expect(note.rows[0].values).toEqual([100_000, 200_000, -50_000, 250_000]);
    expect(note.rows.at(-1)).toMatchObject({ style: "total", values: [100_000, 200_000, -50_000, 250_000] });
  });

  it("builds two-year notes that agree with the balance sheet", () => {
    const cur = [
      row("bank", "current_assets", "bank_main", 0, 900_000, "Bank"),
      row("rec", "current_assets", "receivables", 0, 300_000, "Trade receivables"),
      row("inv", "current_assets", "inv_finished", 0, 400_000, "Finished goods"),
      row("pay", "current_liabilities", "payables", 0, -200_000, "Trade payables"),
      row("loan", "current_liabilities", "loans_short", 0, -100_000, "Short-term loan"),
      row("d1", "current_liabilities", "director_1", 0, -50_000, "Director 1"),
      row("sc", "equity", "share_capital", 0, -1_000_000, "Share capital"),
      row("sales", "income", "sales_clothing", 0, -2_000_000, "Sales: clothing"),
      row("sal", "operating_expenses", "salaries", 0, 600_000, "Salaries"),
      row("tax", "tax", "income_tax", 0, 50_000, "Income tax"),
    ];
    const prev = [row("bank", "current_assets", "bank_main", 0, 100_000, "Bank"), row("sales", "income", "sales_clothing", 0, -500_000, "Sales: clothing")];
    const notes = figureNotes({ cur, prev, moves: [], accounts: [], cashAccountIds: new Set(["bank"]), curLabel: "2026", prevLabel: "2025" });
    const get = (k: string) => notes.find((n) => n.key === k)!;
    expect(get("revenue").rows[0].values).toEqual([2_000_000, 500_000]);
    expect(get("staff").rows.at(-1)!.values).toEqual([600_000, 0]);
    expect(get("tax_charge").rows.at(-1)!.values).toEqual([50_000, 0]);
    expect(get("cash").rows.at(-1)!.values).toEqual([900_000, 100_000]);
    expect(get("receivables").rows.map((r) => r.label)).toEqual(["Trade receivables", "Total receivables"]);
    expect(get("inventories").rows.at(-1)!.values).toEqual([400_000, 0]);
    expect(get("payables").rows.map((r) => r.label)).toEqual(["Trade payables", "Total payables"]);
    expect(get("borrowings").rows.at(-1)!.values).toEqual([100_000, 0]);
    expect(get("share_capital").rows[0].values).toEqual([1_000_000, 0]);
    expect(notes.find((n) => n.key === "ppe")).toBeUndefined();
  });

  it("uses balances after the year-end close", () => {
    const cur = [{ ...row("rec", "current_assets", "receivables", 0, 300_000, "Trade receivables"), closed_minor: 300_000 }];
    const notes = figureNotes({ cur, prev: null, moves: [], accounts: [], cashAccountIds: new Set(), curLabel: "2026", prevLabel: null });
    expect(notes.find((n) => n.key === "receivables")!.columns).toEqual(["2026"]);
  });
});
