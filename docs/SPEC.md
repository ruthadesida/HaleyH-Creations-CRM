# Owner's specification

Two specifications from the owner, verbatim in substance. **Spec 2 extends Spec 1 and wins any conflict.**
Read this before planning work. Progress against it is tracked in [STATUS.md](STATUS.md) and [GAP-ANALYSIS.md](GAP-ANALYSIS.md).

---

## Spec 2 (2026-11-03): Complete HaleyH business management system

Extend the current build. Inspect current code, database and features first. Extend the existing implementation and preserve existing data. Resolve conflicts in favour of this updated specification.

Build an integrated CRM, sales, purchasing, inventory and production system for HaleyH Creations, a Nigerian business producing and selling clothing, shoes and bags.

The system must connect:
**Customer enquiry → Sales order → Available stock or production → Quality control → Dispatch → Delivery → After-sales care.**

It must also connect:
**Opening inventory / purchases → Raw materials → Work in progress → Finished goods → Sale / return.**

Deliver in working phases. Complete and verify each core workflow before adding advanced features. Do not produce screens that imply functionality which has not been implemented.

### 1. Team and access
- **Owners:** two separate owner accounts: Managing Director / CEO (front office, sales, operations) and Creative Director (design, production, quality). Both have full access. Owners manage permissions, opening balances, stock adjustments, payment corrections and refunds. Prevent removal of the last active owner.
- **Front Office Manager:** customers, enquiries, quotations, sales orders, payment records, delivery, after-sales. Views available finished goods and production progress. Reserves available stock for confirmed orders. Cannot change opening balances, costs, staff permissions or approve write-offs. Cannot approve production QC or silently alter payment history.
- **Production Manager / QC:** material requirements, production jobs, assignments, material issues, progress and QC. Receives purchases and counts stock where authorised. Sees production costs only if an owner permits. No customer payment records or financial reports by default. Only the customer details needed to fulfil the job.
- **Makers:** directory of tailors, the shoemaker and freelance bag makers. Maker records don't require a login. Production Manager assigns work to a named maker. Optional restricted maker logins later (not needed for the first release): assigned work and progress only; never selling prices, customer contacts, financial records or other makers' jobs.
- Enforce permissions and business separation on the server/database, including exports, files and direct requests.

### 2. Product and material catalogue
Separate raw materials; packaging and consumables; work in progress; finished goods. Clothing, shoes and bags.
- Finished-good variants: product/SKU, category, size, colour, length or other configurable options, selling price, cost, active/archived, optional product and specification images.
- Materials: unique code, name/category, colour and specs, base unit, purchase unit with explicit conversion, supplier, reorder level, stock location, cost. (Fabric, lining, thread, zips, buttons, leather, soles, buckles, bag hardware, labels, packaging.)
- Decimal quantities for measured materials. Never combine yards, metres, pieces, pairs or other units without a defined conversion.

### 3. Inventory locations and opening balances
- Locations: raw material store, production floor, finished goods/showroom, stock held by an external maker, quarantine/rejected.
- Opening inventory import: downloadable CSV template, preview and field mapping, validation and duplicate checks, quantity, unit cost, location and effective date, **owner approval before posting**, import batch reference and audit history, safe reversal of an incorrect batch without deleting history.
- Opening inventory must not create sales, purchase expenses or cash receipts.
- Owner-controlled cutover date. Historical orders/payments imported for reference must not double-count opening stock or balances.

### 4. Inventory movement ledger
- Auditable ledger is the source of truth. Movement types: opening balance, purchase receipt, supplier return, transfer, material issue to production, unused material return, production completion, customer dispatch, customer return, scrap/write-off, approved stock adjustment.
- Each movement: item/variant, quantity and unit, source/destination, date, responsible user, linked source document, reason where required.
- Show physical on hand, reserved, available, incoming, WIP. Reservation reduces availability, not physical stock. Dispatch reduces finished goods. Prevent negative stock by default.
- Prevent duplicate posting from repeated clicks, retries or concurrent requests. Transfers must not increase total inventory.

### 5. Suppliers and purchasing
- Purchase request → purchase order → goods receipt → supplier bill/payment record.
- Supplier details; items, quantities, units, prices, expected date; partial receipts; damaged/rejected receipts; supplier returns; outstanding quantities; supplier payment status where tracked.
- A PO doesn't increase stock; an accepted goods receipt does; a supplier payment never increases it again.
- Allocate freight/landed costs by a documented method, never twice.
- Simple combined receive-and-record-purchase workflow for small purchases, with distinct stock and financial events underneath.

### 6. Bill of materials and production specs
- BOM/recipe per product or variant: expected quantities, units, expected wastage, maker labour rate, other direct costs, instructions and reference images. Consumption can vary by size/length/variant.
- Save the version used on each production job (later changes don't alter history).
- Owner or authorised Production Manager can create one-off specs for custom orders.

### 7. Production and WIP
- For customer orders or stock replenishment; clothing, footwear and bags; multiple makers and partial completion; internal and freelance.
- Stages: Planned → Materials allocated → In progress → Submitted for QC → Passed / Rework / Rejected → Completed.
- Track job number, linked order, variants and planned quantities, assigned maker, start/due dates, planned vs actual material, material issued and returned, completed/rejected/scrapped quantities, labour and direct costs, notes, attachments, activity history.
- Allocation reserves raw materials; issue moves value into WIP; QC-passed completion moves value from WIP to finished goods. Don't consume material again at dispatch.
- Show shortages before production starts. Never claim an order is ready when stock or materials are unavailable.

### 8. External / freelance makers
- Track materials sent: issue date, quantities, business-owned materials still held, expected output, due date, finished items received, unused materials returned, losses/discrepancies, agreed labour fee and approved amount payable.
- Moving materials to an external maker is a stock transfer, not a sale or expense.
- Maker earnings and payments are owner-controlled. Production staff can confirm completion without authority to record payments.

### 9. Quality control
- Short editable checklists by category (clothing: measurements, stitching, finishing, stains, colour/size, order instructions; footwear: size, matching pair, sole attachment, finishing, defects; bags: stitching, lining, hardware, straps, closures, finishing).
- Record inspector, date, quantity inspected, passed, rework, rejected, defects and corrective instructions.
- Only passed items become saleable. Rejected/returned items stay in quarantine until inspected. Track rework materials and costs. A maker can't approve their own work.

### 10. Sales and order fulfilment
- Quotations, confirmed sales orders, customer invoices, deposits and balances, walk-in sales, ready-made, made-to-order, mixed orders, partial dispatch and delivery, cancellation, returns, exchanges, refunds.
- On confirmation: reserve available finished goods, identify quantities needing production, create linked production jobs without re-entry, prevent duplicate jobs and reservations.
- Keep separate: sales/commercial status, payment status, production status, fulfilment status. Clear overall progress summary.
- Order changes after reservation/production show effects on materials, quantities, price and promised dates; preserve original history.
- Only authorised dispatch of available, QC-passed stock. Owner-approved exception required to dispatch with an unpaid balance.

### 11. Sales, cash and costing
- Distinguish confirmed order value, invoiced amount, fulfilled sales (documented policy), payments received, customer balances, refunds and credits, COGS, gross profit.
- A quotation isn't a sale; a deposit isn't a second sale; cancelled orders don't inflate sales; refunds and physical returns are separate; returned goods are available only after inspection.
- Documented valuation method (e.g. moving weighted average). Track actual job materials, labour and direct costs and how they become finished-goods cost.
- Label profit "estimated" when costs are missing. Never present gross profit as net profit. Owner-configurable taxes, no assumed rates.

### 12. Returns and exchanges
- Link to original order items and quantities. Record reason, physical receipt, QC outcome, restock/rework/scrap decision, credit/refund status.
- Exchanges link returned and replacement items, including price difference. Never restock just because money was refunded.

### 13. Customers and after-sales
Keep Spec 1 CRM features: history, measurements and preferences, enquiries and follow-ups, editable message templates, delivery and satisfaction follow-up, complaints and alterations. Link everything into one customer journey. WhatsApp buttons only prepare messages for manual sending.

### 14. Reports
Orders due/overdue/awaiting action; sales by product, channel, period; cash received and outstanding balances; raw materials and finished goods by location; available vs reserved; stock movement history; inventory valuation; WIP by job and age; shortages and reorder needs; planned vs actual material; production output and QC failures; maker assignments and overdue work; supplier balances; estimated gross profit with cost-completeness indicators. Each with definitions, date filters and role-appropriate exports.

### 15. Zoho and WooCommerce
- This app manages operational orders, production and inventory after cutover.
- Never let Zoho, WooCommerce and this app independently deduct the same stock without a defined sync design.
- Keep external IDs; idempotent imports; start with validated CSV import/export; live integrations only after core workflows pass testing; never show an integration as connected until configured and verified.
- Not a full statutory accounting or payroll system; keep records clean for accounting export and reconciliation with Zoho.

### 16. Usability and continuity
Mobile-first; role-specific home screens (sales/dispatch for front office, production/QC for Production Manager, business overview for owners); search by customer, order, SKU, job number (permission-aware); in-app notifications for assignments, shortages, overdue work, QC completion; printable order summaries and job sheets; paginated lists and efficient queries; clear empty states and errors; never show a save as successful until the server confirms; clear network-error handling without losing work; automated backups and a documented, tested restore; separate demo/test and live data.

### 17. Engineering
Reuse the stack; data-preserving migrations; transactional posting for linked stock, production and financial events; decimal quantities and exact currency; reverse, never delete, posted documents; separate effective date from creation timestamp; restrict backdating into closed stock periods; server-side validation of quantities and linked IDs; tenant separation everywhere; no secrets or sensitive fields in frontend responses; meaningful automated tests for stock, permissions, costing and order workflows.

### 18. Required end-to-end tests
A. Opening material stock imports once, with correct quantities and values.
B. A purchase receipt increases stock; payment does not increase it again.
C. A production job reserves and issues materials, records a maker, and tracks WIP.
D. Unused materials return correctly.
E. QC failure keeps goods unavailable; successful rework allows completion.
F. Passed production increases finished stock without duplicating material consumption.
G. A customer order reserves stock; dispatch reduces it exactly once.
H. Deposits and balance payments calculate correctly without duplicating sales.
I. Partial production and dispatch leave accurate remaining quantities.
J. Cancellation releases reservations and handles existing WIP explicitly.
K. Refund without physical return does not restock goods.
L. External maker materials remain visible as business-owned stock.
M. Concurrent actions cannot oversell or duplicate stock movements.
N. Restricted staff cannot retrieve unauthorised records or fields.
O. Backup restoration recovers linked records consistently.

### Delivery order
1. Staff permissions, catalogue, inventory ledger and opening balances.
2. Purchasing, materials, production, WIP and QC.
3. Sales reservations, payments, dispatch, returns and costing.
4. Reports, CRM refinements and integrations.

Keep each phase usable and tested. Don't describe the system as complete while major workflows are placeholders. Finish with: implemented features, test results, configuration still required, known limitations, and instructions for importing opening balances and starting the HaleyH pilot.

---

## Spec 1 (2026-11-03): CRM and order management (original)

A working, mobile-friendly CRM and order management web app for HaleyH Creations (Nigerian fashion: clothing, shoes, bags). Test with HaleyH first, then offer to other businesses on a monthly subscription. Multi-business structure from the start; first version focused on HaleyH's daily operations. Purpose: capture enquiries, follow up, track orders and payments, coordinate production and delivery, encourage repeat purchases. Simple enough for a busy front-office employee on a phone.

1. **Business accounts and access:** private workspace per business (customers, orders, products, settings, staff), enforced on the server/database; roles owner, manager, sales/front office, production (production sees only what their work needs); owners invite and deactivate staff; platform administrator manages business accounts and subscription status without seeing customer records by default; each business configures name, logo, currency, order stages; HaleyH defaults NGN (₦) and Africa/Lagos.
2. **Dashboard:** new enquiries; follow-ups due today and overdue; orders awaiting payment; outstanding balances; orders in production; orders due soon or overdue; ready for dispatch; payments received in a selected period. Every summary clickable. Clearly distinguish order value from money received.
3. **Customer records:** name, phone, WhatsApp, email; delivery address, city, state, country; source (Instagram, WhatsApp, website, walk-in, referral, other); clothing and shoe sizes; optional bust/waist/hip with units and date; preferred colours, products, fit notes; tags (new, repeat, wholesale); assigned staff; communication preferences and marketing consent; linked enquiries, orders, payments, follow-ups. Warn about duplicate phone/email before creating.
4. **Enquiries and follow-ups:** list and drag-and-drop pipeline (New → Contacted → Choosing item/size → Awaiting payment → Won/Lost); linked customer, product of interest, source, assigned staff, notes, next action and follow-up date, lost reason. Highlight overdue follow-ups, in-app reminders. Won enquiry → linked order without re-entering customer details; prevent duplicate orders.
5. **Products and orders:** clothing, shoes, bags with size/colour variants. Orders: unique number, customer, channel, items with quantities, variants, unit prices, ready-made or made-to-order per item, discount, delivery fee, total, payments and automatic balance, order date, promised date, delivery details, assigned staff, internal notes. Separate payment and fulfilment status. Stages Confirmed → In production → Quality check → Ready for dispatch → Dispatched → Delivered; ready-made can skip production. Cancellation, return and exchange records without deleting history.
6. **Payments:** full, deposit, subsequent payments; amount, date, method, reference, recorder; automatic balances; refunds with audit trail; "Recorded manually" label, never presented as verified; never collect or store card details.
7. **Production and delivery:** jobs, assigned staff, deadlines, overdue; QC checklist before dispatch; courier, tracking, dispatch date, delivery confirmation; home delivery vs station/locker vs store pickup; pickup address and special instructions; partial fulfilment.
8. **Customer care:** follow-up tasks (unpaid orders, delivery confirmation, fit and satisfaction, complaints, alterations, returns, exchanges); editable templates (confirmation, payment reminder, production update, dispatch, after-sales); a button that opens WhatsApp with a prepared message for staff to review and send, never presented as automated or synced.
9. **Reports:** date filters and CSV export for enquiry conversion, sales by product and channel, payments received, outstanding balances, repeat customers, overdue orders and follow-ups. Define each metric; exclude cancelled orders; account for refunds.
10. **Future subscription business:** data structure for multiple workspaces, configurable plans and limits, trial/active/past-due/cancelled, onboarding. No live recurring billing; label subscription controls as managed manually.
11. **Existing systems:** Zoho (accounting/inventory), moving to WooCommerce. v1: customer and product CSV import with preview, validation and duplicate checks; CSV exports; integrations later; never claim syncing that isn't connected and tested; don't build a replacement accounting system.
12. **Design:** polished, uncluttered boutique style: warm ivory, deep charcoal, muted gold; readable type; large buttons, short forms; mobile navigation for daily phone use; search and filters across customers, enquiries and orders. "HaleyH Creations" as text until the official logo is uploaded; don't invent a logo.
13. **Reliability:** working auth, persistent storage, role permissions; audit history for orders, payments, permissions; validation, loading/empty states, useful errors; archive instead of damaging deletes; clearly marked demo workspace with fictional data; test cross-business isolation including direct URLs and database requests; test payment calculations, permissions and the enquiry-to-delivery workflow.

Build approach: concise plan and external-service costs first, then the core (auth, workspace, customers, enquiries, follow-ups, orders, manual payments, dashboard). Prioritise reliable daily workflows. State what works, what's a placeholder, what needs configuration. Never show fake integration success or simulated payment verification.
