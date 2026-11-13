import { describe, expect, it } from "vitest";
import { guessColumns, parseStatementAmount, parseStatementDate, readStatement, statementLines } from "./bank-csv";

describe("parseStatementDate", () => {
  it("reads the common formats", () => {
    expect(parseStatementDate("2026-03-15")).toBe("2026-03-15");
    expect(parseStatementDate("15/03/2026")).toBe("2026-03-15");
    expect(parseStatementDate("15-Mar-2026")).toBe("2026-03-15");
    expect(parseStatementDate("15 Mar 2026 14:02")).toBe("2026-03-15");
    expect(parseStatementDate("2026-03-15T10:00:00")).toBe("2026-03-15");
    expect(parseStatementDate("15/03/26")).toBe("2026-03-15");
  });
  it("respects day-first or month-first, and refuses impossible dates", () => {
    expect(parseStatementDate("03/04/2026", true)).toBe("2026-04-03");
    expect(parseStatementDate("03/04/2026", false)).toBe("2026-03-04");
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementDate("Opening balance")).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it("reads commas, brackets, signs, currency and CR/DR into kobo", () => {
    expect(parseStatementAmount("45,000.50")).toBe(4500050);
    expect(parseStatementAmount("(1,200)")).toBe(-120000);
    expect(parseStatementAmount("-300")).toBe(-30000);
    expect(parseStatementAmount("1,000.00 CR")).toBe(100000);
    expect(parseStatementAmount("1,000.00DR")).toBe(-100000);
    expect(parseStatementAmount("₦2,500")).toBe(250000);
    expect(parseStatementAmount("")).toBeNull();
    expect(parseStatementAmount("abc")).toBeNull();
  });
});

describe("reading a statement", () => {
  // Account details above the header, separate debit/credit columns, a balance, an opening-balance row.
  const CSV = [
    "Account Name,HALEY HOUSE OF CREATIONS",
    "Period,01/03/2026 - 31/03/2026",
    "",
    "Trans. Date,Value Date,Narration,Debit,Credit,Balance,Reference",
    "Opening Balance,,,,,100000.00,",
    "02/03/2026,02/03/2026,POS PURCHASE FABRIC,\"5,000.00\",,\"95,000.00\",REF1",
    "03/03/2026,03/03/2026,TRANSFER FROM ADA,,\"20,000.00\",\"115,000.00\",REF2",
    "03/03/2026,03/03/2026,SMS CHARGES,4.00,,\"114,996.00\",",
  ].join("\n");

  it("finds the header below the account details and guesses the columns", () => {
    const { rows, guess } = readStatement(CSV);
    expect(guess).toMatchObject({ header: 3, date: 0, description: 2, moneyOut: 3, moneyIn: 4, balance: 5, reference: 6, dayFirst: true });
    const { lines, errors, skipped } = statementLines(rows, guess!);
    expect(errors).toEqual([]);
    expect(skipped).toBe(1); // the opening balance row
    expect(lines).toEqual([
      { date: "2026-03-02", description: "POS PURCHASE FABRIC", reference: "REF1", amount: -500000, balance: 9500000 },
      { date: "2026-03-03", description: "TRANSFER FROM ADA", reference: "REF2", amount: 2000000, balance: 11500000 },
      { date: "2026-03-03", description: "SMS CHARGES", reference: undefined, amount: -400, balance: 11499600 },
    ]);
  });

  it("reads a single signed amount column", () => {
    const rows = readStatement("Date,Description,Amount\n2026-03-02,Rent,-150000\n2026-03-03,Sale,25000.5\n").rows;
    const g = guessColumns(rows)!;
    expect(g.amount).toBe(2);
    expect(statementLines(rows, g).lines.map((l) => l.amount)).toEqual([-15000000, 2500050]);
  });

  it("returns no guess when there's no date and amount header", () => {
    expect(guessColumns([["a", "b"], ["1", "2"]])).toBeNull();
  });
});
