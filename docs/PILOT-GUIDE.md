# Starting the HaleyH pilot: opening stock and staff

_Last updated: 2026-11-03 (Phase 1)_

A step-by-step guide for the owners. Phase 1 covers staff, the catalogue, stock locations and opening stock. Sales orders, purchasing and production arrive in later phases.

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

## 5. Day-to-day in Phase 1

- **Move stock** between locations (e.g. send leather to an external maker): Stock → Move stock.
- **Counts and write-offs:** the production manager records them; an owner approves before stock changes.
- **Stock closed up to:** after a month-end count, an owner can close that period so nobody can backdate changes into it.
- Every change is visible in **Stock → Movements**, numbered and attributed.

## Before going live with real data

- Decide on backups: the free Supabase plan has none (Supabase Pro, or a scheduled backup in Phase 4).
- Use a clean production Supabase project (the current one is used for development and testing).
- Set up a custom email provider if staff need emails beyond the Supabase team (invites work by link without it).
