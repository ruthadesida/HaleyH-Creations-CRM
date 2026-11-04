# Inventory and costing

_Last updated: 2026-11-04 (Phase 3: sales, dispatch, returns, COGS)_

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

## Purchasing (Phase 2)

- **A purchase order never changes stock.** A production manager raises a *request* (a draft PO, no prices unless they may see costs); an owner prices and approves it.
- **Only the accepted part of a goods receipt enters stock**, at the PO price converted to the item's base unit (e.g. ₦20,000 a 50 m roll = ₦400/m). Rejected quantities are recorded with a reason and never stocked. Receiving more than is outstanding is refused.
- **Landed cost** (delivery, freight, duty) is entered once on the receipt and shared across its accepted lines **in proportion to their value**: each line's unit cost = price + price × landed ÷ total accepted value. It can't be edited afterwards; reverse the receipt and receive again.
- A **quick purchase** (no PO) sets its own prices, so it needs permission to see costs. The stock receipt and the supplier bill are separate records even when entered together.
- **Supplier returns** remove the goods at the cost they came in at and take that value back out of the average.
- **Supplier bills and payments** are owner-only money records labelled "Recorded manually". They never change stock. Supplier balance = bills − payments (voided records excluded).
- Reversing a receipt (owner) takes the stock back out (refused if it's been used or partly returned to the supplier) and reopens the PO quantities.

## Production and work in progress (Phase 2)

- **Reservation** (allocation) reduces *available* stock, never physical stock. Available = on hand outside Quarantine − active reservations. Allocation is all-or-nothing and lists shortages.
- **Issue to a job** removes material from a location at the current average cost. **The material is consumed here, once.** Its value becomes the job's work in progress (WIP). Issuing uses up the job's reservation first; anything beyond it must come from unreserved stock.
- **Returns from a job** come back at the job's average issue cost for that item.
- **External makers**: sending materials is a transfer to the maker's location ("With …"). It's still business stock, still visible, and still reserved for the job until issued.
- **Labour and other direct costs** (agreed with the maker, set from the recipe × quantity; owners can adjust before anything is completed) are added to WIP.
- **WIP value** = materials issued − returned + labour + other costs − value already completed.
- **QC completion**: each unit leaving WIP (passed or rejected) takes an equal share: unit cost = WIP value ÷ units still to finish. Passed units enter finished stock (saleable); rejected units go to Quarantine at the same cost; rework units stay in WIP. The last units take whatever value remains, so WIP ends at zero. Materials not returned before the final QC count as used.
- Production documents (issues, returns, completions) are corrected from the job, not reversed from the Movements page.
- **Maker pay**: an owner approves the amount owed after completion and records payments manually. Production staff can't record payments.

## Sales, dispatch and returns (Phase 3)

- **A quotation is not a sale** and reserves nothing. **Confirming** an order reserves finished goods that are available (ready-made lines) and creates one linked production job for whatever must be made (made-to-order lines, or the shortfall). Confirming twice does nothing.
- Items **passed by QC on an order's job** are reserved for that order, so they can't be sold to someone else.
- **Dispatch** posts a `customer_dispatch` document: finished goods leave a saleable location (never Quarantine) at the current average cost, using up the line's reservation first. This is the only time finished goods leave for a sale, once. Material was consumed at issue to production and is never consumed again.
- **Cost of goods sold (COGS)** = the value of dispatch movements for the order, less the value of customer returns. **Fulfilled sales** are recognised at dispatch: price × (dispatched − returned) per line, with the order discount shared across lines by value (delivery fees excluded).
- **Estimated gross profit** = fulfilled sales − COGS, shown to owners only, labelled "estimated", and flagged incomplete when any unit went out without a recorded cost. It is never net profit (no overheads, no tax).
- **Unpaid balance**: dispatching while money is owed needs an owner's approval (recorded with a reason).
- **Customer returns** go into Quarantine at the average cost they left this order at. Inspection either restocks them (a transfer back to a saleable location) or scraps them (a write-off). **A refund is money only and never restocks anything.**
- **Cancelling** a confirmed order releases its reservations. Linked jobs not yet started are cancelled; jobs already holding work in progress carry on for stock (unlinked) so nothing is wasted. Orders with anything dispatched can't be cancelled: record a return.
- The order's stage (confirmed, in production, ready for dispatch, dispatched) is derived from these records; delivered is confirmed by staff once everything is out.
