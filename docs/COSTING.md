# Inventory and costing

_Last updated: 2026-11-03 (Phase 1)_

## Source of truth

The **stock ledger** (`stock_documents` + `stock_movements`) is the only record of stock. Physical on hand for an item at a location is the sum of its movement quantities there (`stock_balances` view). Nothing else stores a stock quantity.

- Every change is a numbered **stock document** (SD-00001…) with its lines, an **effective date** (when it happened) and a **created at** time (when it was recorded), the person who posted it, a reason where needed, and a link to its source (opening batch, count request…).
- Documents are written only by database posting functions, in one transaction. Nobody can insert, edit or delete ledger rows directly.
- Mistakes are corrected with a **reversal**: a mirror document with the exact opposite lines. Both stay in the history. A reversal is refused if it would take stock below zero (because the stock has since been moved or used).
- Each posting carries an **idempotency key**. Repeating the same request (double tap, network retry) returns the original document instead of posting again.
- While posting, the affected item rows are **locked** (in a fixed order), so two people can't oversell the same stock at the same moment, and the negative-stock check sees every earlier posting.
- **Negative stock is refused** at any location a document takes stock from.
- An owner can set **Stock closed up to** a date (Settings). Postings dated on or before it are refused, so counted periods can't be changed by backdating.

## Units

- Each item has a **base unit**; every quantity in the ledger is in that unit, with up to 4 decimals.
- Units convert only within the same dimension: length (m, cm, mm, yd, in), area (m², ft²), mass (kg, g), volume (l, ml), count (pc, dozen) and pair. Pieces never mix with pairs or metres.
- Items can also have their own **purchase unit** (e.g. "roll" = 50 m).

## Valuation: moving weighted average

Each item has one average cost (kobo per base unit) across all locations.

- **Stock coming in with a cost** (opening balance; later purchase receipts, production completion, customer returns):
  `new average = (on hand × old average + incoming qty × incoming cost) ÷ (on hand + incoming qty)`.
  If on hand was zero or below, the average becomes the incoming cost.
- **Stock going out** (transfers out, issues, dispatch, write-offs) is valued at the current average. The average doesn't change.
- **Transfers** move quantity and value between locations; the business total and the average are unchanged. Stock with an external maker is still business stock.
- **Count adjustments** that add stock use the current average (no new cost). Write-offs remove stock at the current average.
- **Reversals** of incoming stock remove it at its original cost and recalculate the average; reversals of outgoing stock bring it back at the cost it left with.

Costs are stored with fractional kobo (6 decimals) so small unit costs (e.g. ₦0.35 per metre of thread) stay exact. Prices and payments stay whole kobo.

## Who can see costs

Owners always. A production manager only if an owner ticks **Can see production costs and stock values** for them (Settings → Staff). The front office never sees costs. Cost columns can't be selected directly by any role; they're only returned by `stock_valuation()` and `opening_batch_costs()`, which check permission first.

## Opening balances

- Prepared from a CSV by an owner or the production manager, validated by the database, then **approved and posted by an owner**.
- Dated at the business's **cutover date**.
- Create only stock documents: never sales, purchase expenses or cash.
- Each item can have only **one live opening balance per location**. Re-importing requires reversing the earlier batch first.

## Coming in later phases

- Purchase receipts (with freight/landed-cost allocation), production WIP (material issue → job cost → completion), dispatch (cost of goods sold), customer returns via quarantine. These will use the same posting engine and average-cost rules, and this document will be extended.
