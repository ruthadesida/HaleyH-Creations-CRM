# Bookkeeping and annual accounts

_Last updated: 2026-11-13 (Phase A built: ledger core, FY2025 import, opening adjustments, year close. The accountant role is deferred, since both directors are owners)_

The owner decided on 2026-11-13 that the app keeps the books itself, from source documents all the way to annual accounts, under **IFRS for SMEs**. This replaces the earlier rule "don't build a replacement accounting system". Owner choices:

| Question | Decision |
|---|---|
| Scope | Full bookkeeping inside the app, through year-end close and annual accounts |
| Standard | IFRS for SMEs (FRC Nigeria) |
| Tax | Owner enters VAT and other rates; the app tracks and summarises, never guesses a rate, never files |
| Extra source documents | Expenses with receipts, bank statements, fixed assets and loans, payroll |
| Business type | Registered company (Ltd), incorporated during 2025; before that it traded as a business name. Two shareholders, 50% each, both directors and both app owners. Equity section uses **share capital** |
| VAT | Registered. Owner-entered rate: 7.5% (stored as a setting, not hard-coded). Still to confirm: the date VAT charging started, and whether app prices include VAT |
| Financial year | 1 January to 31 December |
| Who keeps the books | One owner is an accountant (also CEO, sales and branding) and reviews the books; the other owner is creative director and runs production. No separate accountant login needed yet; the accountant role stays optional for an outside firm |
| Starting point | The owner's **draft FY2025 statements** (prepared from bank statements, without opening stock and some fixed assets). Load them first, then post opening adjustment journals. See *Starting from the FY2025 draft* |

**Privacy:** this repository is public. Real figures (statements, balances, pay, personal account details) are never written into code, migrations, seed data, tests or docs. They are entered or imported inside the app, where only owners can see them.

## The flow

```
Source documents ──► Journals ──► General ledger ──► Trial balance ──► Statements ──► Year-end close
 (orders, payments,    (balanced,      (every account,     (debits =        (P&L, balance     (profit to
  receipts, bills,      one per         every line)          credits)         sheet, cash       retained
  expenses, bank…)      document)                                             flow, notes)      earnings, lock)
```

Most journals are **posted automatically** by the documents the app already creates. Staff never type a sale twice. Only the owner (or an accountant) writes manual journals, and those are for things no document covers (accruals, corrections, year-end adjustments).

## Core rules

- **Double entry in the database.** `journals` and `journal_lines`. A constraint trigger refuses any journal whose debits don't equal its credits. Amounts are whole kobo. Stock values carry fractional kobo; when they post, the rounding difference goes to a *Rounding* account so the journal still balances to the kobo.
- **Written only by posting functions**, in the same transaction as the source document, with an idempotency key. Clients can't insert, update or delete journal rows (RLS plus revoked grants), the same model as the stock ledger.
- **Never edited or deleted.** A mistake gets a reversing journal (exact mirror) that points at the original. Voiding a payment, reversing an opening batch or cancelling a bill posts its reversal automatically.
- **Linked both ways.** Each journal records `source_type` and `source_id`; every report line can open the document behind it.
- **Dates:** each journal has an effective date (when it happened) and a created-at time (when it was recorded). Owners **close a month** (no more postings dated in it) and **close a year** (closing journal to retained earnings, then locked). This joins the existing "Stock closed up to" date: closing a period closes stock too.
- **Bookkeeping start date.** The day after the last imported year (for HaleyH: 1 January 2026, after FY2025 is imported, adjusted and closed). Documents dated on or after it are posted automatically, including ones already in the app (a one-time backfill, idempotent). Documents before it are covered by the imported year and are not posted. A new business with no history can instead start on any month with an opening trial balance.
- **Reconciliation checks** run on demand and on the dashboard: inventory accounts = `stock_valuation()`; receivables and deposits = the order balances; payables = `supplier_balances`; bank accounts = reconciled statement balance. Any difference is shown, never hidden.

## Starting from the FY2025 draft

The business didn't keep books in 2025. An owner drafted FY2025 statements from the bank statements: the business account, plus business items from a director's personal accounts, routed through a **director's current account**. The draft treats stock as nil at every date and leaves out some fixed assets. The app starts from that draft:

1. **FY2025 is an imported year.** An owner enters (or uploads as CSV) the FY2025 **trial balance** in the app's account codes: one row per account with its debit or credit balance at 31 December 2025, including the income and expense totals for the year. The draft splits the year at the incorporation date (business-name period, then the company), so the import takes **two dated trial balances**: one for the business-name period and one for the company period. Each is posted as a single journal of source type `opening_import`, with the spreadsheet attached as its source document. It must balance or it's refused.
2. **Opening adjustment journals.** While FY2025 is still open, owners post adjustments as journals of type `opening_adjustment`, each with a narration, a date in FY2025 and an optional attachment (stock count sheet, receipt, valuation note). The app gives guided forms for the expected ones:
   - **Stock:** opening stock at 1 January 2025 and closing stock at 31 December 2025 (Dr Inventory · Cr Cost of sales for closing stock; opening stock against opening equity). The closing figure becomes the stock ledger's opening balances for 2026, item by item, through the existing opening-stock batch, so the general ledger and the stock ledger agree from day one.
   - **Fixed assets left out:** each asset goes into the fixed asset register with cost, date bought, how it was paid (business bank, a director personally, contributed for shares) and useful life. The app posts Dr Asset · Cr the right account (bank, director's current account, share capital), plus catch-up depreciation to 31 December 2025.
   - **Any other correction:** a free-form balanced journal (owner only).
   Every adjustment shows in a list of **FY2025 adjustments**, and the statements show the draft figure, the adjustments and the adjusted figure side by side, so the accountant can see exactly what changed from the draft.
3. **Close FY2025.** When the adjustments are agreed, an owner runs the year-end close: income and expenses go to retained earnings and FY2025 is locked. Its closing balances become the **opening balances on 1 January 2026**, and FY2025 becomes the comparative year in the 2026 accounts.
4. **2026 onwards.** From 1 January 2026 the books are kept in the app. Documents already in the app from that date are posted automatically (backfill). Months of 2026 before the app was in use are brought in from bank statements through the statement import and matching (Phase C).

The draft's working notes raise matters for the owner and accountant to settle before closing FY2025. The app records the decisions; it doesn't make them: whether the company's first accounts start at the incorporation date (and how the business-name period is presented), VAT on 2025 sales, withholding tax and PAYE estimates, and the director's current account balance (see *Open questions*).

## Chart of accounts

Seeded per business from a template that suits a Nigerian fashion business under IFRS for SMEs. Owners can add sub-accounts and rename non-system accounts; **system accounts** (the ones auto-posting uses) can't be deleted or retyped. Accounts are archived, never deleted, once used.

| Code | Group | Examples |
|---|---|---|
| 1000s | Current assets | Cash in hand, each bank account, Paystack/POS clearing, Trade receivables, Inventory: raw materials, Inventory: work in progress, Inventory: finished goods, Inventory: in quarantine, VAT receivable (input), Prepayments, Staff advances, Due from directors (when a director's current account is in debit), Share capital unpaid |
| 1500s | Non-current assets | Plant and machinery (sewing machines), Furniture and fittings, Generators and equipment, Motor vehicles, Computers, each with accumulated depreciation |
| 2000s | Current liabilities | Trade payables, Goods received not invoiced, Maker fees payable, Customer deposits, VAT payable (output), PAYE payable, Withholding tax payable, Pension payable, Company income tax payable, Accruals, Short-term loans, **Director's current account** (one per director: money the company owes a director, or is owed, when a director pays business costs personally or receives business money) |
| 2500s | Non-current liabilities | Long-term loans |
| 3000s | Equity | Share capital (company), Business-name capital taken over at incorporation, Retained earnings, Opening balance equity (cleared once FY2025 is closed), Dividends (when declared) |
| 4000s | Income | Sales: clothing, shoes, bags (split by product category), Repair income, Delivery charges, Discounts given (contra), Sales returns (contra), Other income (e.g. gifts received, non-trade) |
| 5000s | Cost of sales | Cost of goods sold, Production labour and maker fees, Production losses and rework, Stock write-offs and count differences, Inbound delivery |
| 6000s | Operating expenses | Rent, Salaries and wages, Contract staff pay, Staff welfare, Social media management, Cleaning, Photography and creatives, PAYE and withholding tax borne by the company, Pension (employer), Electricity and diesel, Internet and data, Transport and logistics, Marketing and adverts, Bank charges, Repairs and maintenance, Depreciation, Professional fees, Office and sundry |
| 7000s | Finance and tax | Interest, Income tax expense |
| 9999 | Rounding | Kobo rounding from stock values |

## Posting rules: existing documents

These documents already exist in the app; each will post the journal shown. (Dr = debit, Cr = credit.)

| Event | Journal |
|---|---|
| Customer payment received (before dispatch) | Dr Bank/Cash · Cr Customer deposits |
| Customer payment received (after dispatch) | Dr Bank/Cash · Cr Trade receivables |
| Order dispatched (revenue recognised: control passes to the customer) | Dr Customer deposits (up to what was paid) and Dr Trade receivables (the rest) · Cr Sales (by category) · Cr VAT payable (if a VAT rate applies) ; and Dr Cost of goods sold · Cr Inventory: finished goods (at the stock ledger's cost) |
| Refund paid | Dr Customer deposits or Trade receivables · Cr Bank/Cash |
| Customer return received into Quarantine | Dr Sales returns (contra income) · Cr Trade receivables/deposits, and Dr Inventory: in quarantine · Cr Cost of goods sold |
| Return inspected: restock / scrap | Dr Inventory: finished goods · Cr Inventory: in quarantine / Dr Stock write-offs · Cr Inventory: in quarantine |
| Repair payment / repair collected | Dr Bank/Cash · Cr Customer deposits; on collection Dr Customer deposits/receivables · Cr Repair income |
| Goods received from supplier | Dr Inventory: raw materials (or finished goods) · Cr Goods received not invoiced |
| Supplier bill recorded | Dr Goods received not invoiced (or an expense) · Dr VAT receivable (if any) · Cr Trade payables |
| Supplier payment | Dr Trade payables · Cr Bank/Cash |
| Supplier return | Dr Trade payables (or GRNI) · Cr Inventory |
| Materials issued to a job / returned unused | Dr Inventory: WIP · Cr Inventory: raw materials (reverse on return) |
| Job completed (QC passed) | Dr Inventory: finished goods · Cr Inventory: WIP |
| Maker fee approved / paid | Dr Inventory: WIP (or Production labour) · Cr Maker fees payable ; Dr Maker fees payable · Cr Bank/Cash |
| QC rejects, rework losses | Dr Production losses · Cr Inventory: WIP |
| Count difference / approved write-off | Dr or Cr Stock write-offs and count differences · Cr or Dr Inventory |
| Transfer between locations | No journal (same business, same value), except into/out of Quarantine, which moves between inventory accounts |
| Opening stock posted | Dr Inventory · Cr Opening balance equity (never revenue, never cash) |

The order, payment and stock records are unchanged: they keep their own commercial, payment and fulfilment status. The journal is an extra, linked record.

## New source documents

| Module | What staff do | Journal |
|---|---|---|
| **Expenses and receipts** | Enter an expense (supplier/payee, category, amount, VAT if any, paid from which account or "unpaid"), attach a photo of the receipt (Supabase Storage, private bucket, business-scoped). The front office can submit; an owner approves before it posts. | Dr Expense (+ VAT receivable) · Cr Bank/Cash or Accruals/Payables |
| **Bank and cash accounts** | Set up each bank account, cash box and payment processor. Import a statement (CSV from the bank's app; column mapping saved per bank). Match each line to existing payments/expenses, or create an expense/transfer from the line. A month is reconciled when the app balance equals the statement balance. | Matching posts nothing new; creating from a line posts that document's journal. Transfers between own accounts: Dr one · Cr the other |
| **Fixed assets** | Register an asset (cost, date, category, useful life, residual value, method: straight line or reducing balance, entered by the owner). A monthly depreciation run posts automatically. Disposal records proceeds and gain/loss. | Purchase: Dr Asset · Cr Bank/Payables. Depreciation: Dr Depreciation · Cr Accumulated depreciation |
| **Loans and owner money** | Record loans (lender, amount, interest rate entered by the owner, repayments), capital put in and drawings taken out. | Dr Bank · Cr Loan / Capital ; Dr Loan + Dr Interest · Cr Bank ; Dr Drawings · Cr Bank |
| **Payroll** | Staff pay list (can include people without logins). Each month: gross pay, and PAYE, pension and other deductions **as entered by the owner** (no built-in tax tables), net pay. Payslips as PDF. | Dr Salaries, Dr Pension (employer) · Cr PAYE payable, Cr Pension payable, Cr Net pay payable ; paying: Dr those payables · Cr Bank |
| **VAT** | Owner sets whether the business is VAT-registered and the rate(s). Sales, supplier bills and expenses carry a VAT amount. A VAT summary per period shows output VAT, input VAT and the net to pay, with the documents behind each figure. Filing is done by the owner on the FIRS portal; the app records the payment. | Payment: Dr VAT payable · Cr Bank |
| **Manual journals** | Owner/accountant only. Must balance; needs a narration; can attach a document. | As entered |

## Reports and statements

- **Day-to-day:** General ledger (per account, with running balance and links to documents), Journal list, Trial balance (any date), Aged receivables, Aged payables, Bank reconciliation status, VAT summary, Fixed asset register.
- **Financial statements** (any period, comparatives against the prior period): Statement of profit or loss, Statement of financial position (balance sheet), Statement of cash flows (indirect method), Statement of changes in equity.
- **Annual accounts pack (IFRS for SMEs):** the four statements plus notes: basis of preparation and accounting policies (inventory at moving weighted average, revenue on delivery, depreciation methods), property, plant and equipment movement, inventories, receivables, payables, loans, equity, related-party transactions (owner drawings and loans), and events after the reporting date (text the owner or accountant writes). Exported as PDF and CSV/Excel. Marked **"Prepared from the records in this app. Not audited."** until an accountant signs it off in the app.
- **Year-end close:** a checklist (bank reconciled for every month, stock counted, depreciation run, accruals entered, VAT agreed, reconciliation checks clean), then the closing journal (income and expenses to retained earnings) and the year lock. Reopening a closed year is owner-only and audited.

## Who sees what

| Role | Books |
|---|---|
| Owner | Everything; posts manual journals; closes periods |
| Accountant (new optional role, invited by an owner) | Read all finance records, post manual and adjusting journals, prepare year-end; cannot change sales, stock or staff |
| Front office manager | Submit expenses and receipts for approval; no ledger, no statements |
| Production manager | None (costs stay as today: only if an owner allows) |

Platform admins still can't read business records.

## Phases

Each phase is finished and tested (pgTAP for balancing, isolation, idempotency and closed periods; e2e for the screens) before the next, and stays behind `FEATURES.accounting*` until it works end to end.

| Phase | Delivers |
|---|---|
| **A. Ledger core and FY2025** | Chart of accounts (seeded template, owner edits), journals with the balancing trigger, manual journals, reversals, accounting periods and month close; **FY2025 trial balance import** (two dated parts, CSV or on-screen), **opening adjustment journals** with guided forms (stock, missing fixed assets, other), the draft vs adjusted view, FY2025 close into 2026 opening balances; general ledger and trial balance reports; VAT rate setting; accountant role |
| **B. Automatic posting** | Journals for every existing document in the table above, backfill from the start date, reconciliation checks (inventory, receivables/deposits, payables) |
| **C. Expenses and bank** | Expenses with receipt photos and approval, bank/cash/processor accounts, statement CSV import, matching and reconciliation |
| **D. Tax, payroll, assets, loans** | VAT settings and summary, payroll with owner-entered deductions and payslips, fixed asset register and depreciation run, loans, capital and drawings |
| **E. Financial statements** | Profit or loss, balance sheet, cash flow, changes in equity, aged receivables/payables, month-end checklist |
| **F. Year end and annual accounts** | Year-end checklist and close, notes, annual accounts pack (PDF/Excel), accountant sign-off |

## Open questions for the owner

Answered 2026-11-13: year end 31 December; company (Ltd) with two 50% shareholders; VAT-registered, rate 7.5%; start from the FY2025 draft with opening adjustments; an owner who is an accountant reviews the books.

Still open (none of these block building Phase A; they're decisions recorded in the app):

1. **VAT start date and pricing:** from what date must sales carry 7.5% VAT, and do the prices in the app include VAT? (The FY2025 draft has no VAT; turnover below the small-company threshold may explain that, so the accountant should confirm.)
2. **First company accounts:** do the company's first statutory accounts run from the incorporation date to 31 December 2025, with the business-name period shown separately (as the draft does), or something else?
3. **Bank, cash and payment accounts** to set up (business bank account, cash box, POS, transfer apps), and how business money paid through directors' personal accounts will be handled from 2026 (ideally: through the business account only, with the director's current account for the exceptions).
4. **Closing stock at 31 December 2025** and the **missing fixed assets**: figures and dates, to be entered as opening adjustments.
