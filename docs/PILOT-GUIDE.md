# Starting the HaleyH pilot

_Last updated: 2026-11-04 (Phase 3)_

A step-by-step guide for the owners. It covers staff, the catalogue, stock, opening stock, purchasing, production, and selling (orders, payments, dispatch, returns). Reports and integrations arrive in Phase 4.

## 1. Set up the workspace (owner, ~10 minutes)

1. Sign up at the app's address and create the **HaleyH Creations** workspace (₦, Lagos time).
2. **Settings → Business details:** check the name and the order prefix (e.g. `HC`).
3. **Settings → Staff:** invite the second owner, the front office manager and the production manager.
   - Each invite is a link that works once, for that person's email, for 7 days. Copy it or tap **Share on WhatsApp**.
   - Give each owner their title (Managing Director / CEO, Creative Director).
   - Tick **Can see production costs** for the production manager only if you want them to see stock values.

## 2. Build the catalogue (owner + production manager)

1. **Stock → Products** (owner): add each product once with its sizes, colours and lengths. Every combination becomes a variant with its own SKU and stock. Shoes are counted in pairs automatically.
2. **Stock → Locations:** the four standard locations already exist (Raw material store, Production floor, Finished goods / showroom, Quarantine). Add more if needed, including one per external maker who holds your materials (e.g. "With Tunde").
3. **Stock → Makers:** add tailors, the shoemaker and freelance bag makers. No logins needed.
4. **Stock → Suppliers:** add the shops and markets you buy from.
5. Materials can be added one by one (**Stock → Add material**) or created automatically during the opening import (next step).

## 3. Choose the cutover date (owner)

The cutover date is the day this app takes over stock from Zoho. From that day, stock changes are recorded here only. Zoho/WooCommerce must not deduct the same stock as well (there's no live sync yet).

**Settings → Stock dates → Cutover date.** Opening stock is dated on this day.

## 4. Count and import opening stock

1. On the cutover date, count everything at every location (including stock held by external makers).
2. **Stock → Opening stock → Import → Download template.** Fill one line per item per location:

   | Column | Example | Notes |
   |---|---|---|
   | code | FAB-001 | Required. Existing item code or SKU, or a new material code |
   | name | Blue Ankara print | New materials only |
   | kind | raw_material | New materials only: `raw_material` or `packaging` |
   | base_unit | m | New materials only: the unit stock is kept in |
   | category, colour | Fabric, Blue | Optional |
   | location | Raw material store | Must match a location name exactly |
   | quantity | 120 | Up to 4 decimals |
   | unit | yd | Converts to the base unit (yards → metres) |
   | unit_cost | 2500 | Naira per unit of the quantity |

   Finished goods must exist as product variants first (use the variant SKU as the code).
3. Choose the file, check the column matching, then **Check every line**. The database checks each line: unknown codes or locations, unit mismatches (e.g. pieces for a fabric counted in metres), duplicates in the file, and anything already imported.
4. Fix any problems in the spreadsheet and choose the file again.
5. **Save batch for owner approval.** Nothing is posted yet.
6. An owner opens the batch, checks it and taps **Approve and post**. Stock is now on hand, valued at the costs given.
7. Made a mistake? An owner can **Reverse this batch** (only if none of that stock has been moved yet), then import a corrected file.

You can import in several batches (e.g. one per location). The same item can't be opened twice at the same location.

## 5. Day-to-day stock

- **Move stock** between locations (e.g. send leather to an external maker): Stock → Move stock.
- **Counts and write-offs:** the production manager records them; an owner approves before stock changes.
- **Stock closed up to:** after a month-end count, an owner can close that period so nobody can backdate changes into it.
- Every change is visible in **Stock → Movements**, numbered and attributed.

## 6. Buying materials (Phase 2)

1. **Purchasing → New request** (production manager or owner): supplier, items, quantities in any unit that fits the item (rolls, metres, yards). The production manager doesn't see prices unless you allow costs.
2. An owner opens the request, taps **Edit** to add prices, then **Approve order**. Approving changes no stock.
3. When goods arrive: **Receive goods** on the order. Enter what was accepted and what was rejected (with a reason). Only accepted goods enter stock. Partial deliveries are fine; the order shows what's still to come.
4. Delivery or transport costs: an owner (or a production manager allowed to see costs) enters them once on the receipt; they're shared into the cost of the goods.
5. Bought something on the spot with no order? **Record a purchase** (needs cost permission).
6. Owners record the supplier's **bill** and **payments** (Purchasing → Supplier balances). Payments are "Recorded manually" and never change stock.
7. Faulty goods after receiving: open the receipt and **Return to supplier**.

## 7. Making things (Phase 2)

1. **Production → Recipes → New recipe**: the materials one finished item uses, with wastage %, labour per item (owners) and instructions. Add a line "only for" a variant when a size or length uses more. **Use for new jobs** makes it the standard; later changes are new versions, and old jobs keep their copy.
2. **Production → New job**: what to make, how many, the recipe and the maker.
3. **Reserve materials**. If anything is short, the job lists it with a link to raise a purchase request.
4. External maker? **Send to maker** moves the materials to "With [maker]": still your stock, still reserved.
5. **Issue materials** when work starts (from the store, or from the maker's location). This is when material is used up, once.
6. **Return unused** leftovers before the final QC.
7. **Ready for QC** → **Record QC**: tick the checklist, then enter how many passed, need rework or are rejected. Passed items become finished stock you can sell. Rejected items go to Quarantine. Rework goes back to the maker; record QC again when it's fixed.
8. Owners see each job's costs (materials used, labour, what's still in work in progress), approve what the maker is owed, and record maker payments.
9. Edit the QC checklists under **Production → QC checklists**.

## 8. Selling (Phase 3)

1. **Orders → New order**: choose the customer, then the products (or a custom item that isn't stock-tracked), quantities and prices. The form shows how many are available.
2. **Save as quotation** if the customer hasn't agreed yet: it's not a sale and reserves nothing. **Confirm order** when they agree: stock that's in is reserved for them, and a production job is created for anything that must be made.
3. **Record payment** for deposits and balances. Every payment is marked "Recorded manually". Owners record refunds and void mistakes (they stay in the history).
4. **Dispatch** when goods go out (in parts if needed). Only QC-passed stock can go, and it uses the order's reserved stock first. If money is still owed, an owner must first tap **Approve dispatch before payment**.
5. **Mark delivered** once the customer has it.
6. Something comes back? **Record a return**: it goes to Quarantine, then **Restock** or **Scrap** after inspection. A refund is recorded separately and never puts anything back in stock.
7. **Cancel order** before anything is dispatched: reservations are released; production jobs not started are cancelled, and jobs already in work finish for stock.
8. **Invoice** prints the quotation or invoice (or saves it as a PDF).
9. Owners see each order's estimated gross profit (fulfilled sales less cost of goods; not net profit).

## 9. Reports, search and tools (Phase 4)

- **Reports** (menu → Reports): each says exactly what it counts. Pick dates, then **Download CSV** for a spreadsheet. Owners see profit, supplier money and stock values; the front office and production manager see only what their role allows.
- **Today** shows owners a business overview: cash received, orders confirmed, fulfilled sales, estimated gross profit, what customers owe and what you owe suppliers, stock value and work in progress.
- **The bell** lists what needs attention now: late orders, overdue jobs, items waiting for QC, shortages, approvals.
- **Search** finds customers (by name or phone), orders, products/SKUs, jobs and purchase orders.
- **Job sheets**: open a job → Print job sheet.
- **Message templates** (Settings): edit the WhatsApp messages staff can prepare from an order.
- **Import** (Settings): bring customers and products in from Zoho or WooCommerce CSV exports. Preview first; re-importing never duplicates.

## Before going live with real data

- Set up backups: follow `docs/BACKUPS.md` (two GitHub secrets for the nightly encrypted backup, and/or Supabase Pro).
- Use a clean production Supabase project (the current one is used for development and testing).
- Set up a custom email provider if staff need emails beyond the Supabase team (invites work by link without it).
