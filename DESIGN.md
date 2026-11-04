# HaleyH Creations CRM: design

## Brief

- **Subject:** HaleyH Creations, a Nigerian fashion business (clothing, shoes, bags), Lagos time, naira.
- **Audience:** front-office and sales staff on phones, all day; owners and managers on laptops; production staff on a shared phone or tablet in the workroom.
- **Job:** capture an enquiry in under a minute, never miss a follow-up, always know what's paid, what's owed and what's due.
- **Constraints from the owner:** warm ivory ground, deep charcoal text, muted gold accents, large buttons, short forms, phone-first navigation. "HaleyH Creations" set as text until the real logo arrives. No invented logo.
- **Scale of theatre:** this is a daily work tool, not a showcase. No loader, no WebGL, no scroll theatre. The craft goes into type, spacing, states and one signature detail. Speed beats spectacle.

## Concepts considered

| | Idea | Anchor | Signature | O / F / Fe / P |
|---|---|---|---|---|
| **A. Material: the swing tag** | Every customer order is treated like a garment's swing tag in an atelier: a tag that carries the order number, travels with the work and gets a stitch for each stage it passes | Fashion workrooms tag every garment-in-progress; HaleyH makes made-to-order pieces | The order's progress is a **seam**: a stitched line that sews itself forward one stitch per fulfilment stage | 4 / 5 / 5 / 2 |
| B. Process: the clothing rail | The pipeline is a rail of hangers; enquiries hang as tags and slide along the rail | How a boutique moves stock from rack to rack | Cards swing on their hook when dropped into a new column | 4 / 4 / 3 / 3 |
| C. Place: Balogun ledger | Set like a Lagos market trader's ledger book | Lagos commerce | Ledger-ruled lists | 3 / 3 / 4 / 3 |

**Picked A.** It fits a fashion business that makes clothes to order, and it creates rules for the whole app: status, order cards, the pipeline, the empty states and the 404. It's also cheap to build well with SVG and CSS. **Borrowed from B:** pipeline cards settle onto their column with a small swing, like a tag dropping onto a hook.

## Concept card

```
Idea:        Every order is a swing tag; its progress is a seam that sews itself forward.
Metaphor:    The atelier workroom: tags, seams, rails, a cutting table.
Signature:   The stage seam (stitched progress line) on order cards and the order page.
Emotion:     Calm and in control. "I know exactly where every order is."
Motion verb: settle like fabric — short ease-out, slight overshoot never more than 2px.
Screenshot:  An order page: big naira balance, the seam half-sewn to "Quality check".
```

## Palette

| Role | Hex | Use |
|---|---|---|
| ground (ivory) | `#F8F3EA` | App background |
| surface | `#FFFDF8` | Cards, sheets, inputs |
| ink (charcoal) | `#23211E` | Text, primary buttons |
| muted | `#655E54` | Secondary text (AA on ground and surface) |
| line | `#23211E1F` | Hairlines, borders |
| gold | `#B08D57` | Accent fills, seam stitches, focus ring, selection |
| gold-ink | `#76592A` | Gold used as text (AA on ivory) |
| success | `#2F6B4F` | Paid, delivered |
| warn | `#8A5A00` | Due soon, part-paid |
| info | `#33557D` | Work under way: confirmed, in production, in QC, ordered from a supplier |

**Status chips by meaning:** grey = not started or finished with (quotation, cancelled, planned); indigo = under way; gold = the next move is ours (ready to dispatch); amber = needs attention or part-paid; red = unpaid or late; green = done (paid, delivered, received). Chips are 28px tall with 13px text. Soft chip backgrounds stay at 10% tint so the coloured text keeps AA contrast.
| danger | `#A63A2B` | Overdue, cancelled, errors |

The brief asked for cream and gold, which is close to a palette the art-direction guide warns is generic. Here it's the owner's brand direction, so we commit to it: muted gold instead of terracotta, and charcoal instead of pure black. The type pairing below gives it a fashion voice rather than a newspaper one.

## Type

- **Display:** Bodoni Moda (Google, optical sizes). Fashion-house contrast. Used **only** for the wordmark, page titles and the big money figure on an order. Never for small text.
- **Text and UI:** Instrument Sans (Google). Clear at 16px on a phone, condensed enough for tables.
- Numbers: `tabular-nums` everywhere money or counts appear. Money is always shown as `₦` with thousands separators, e.g. ₦125,000.
- Scale: body 16px (never smaller for inputs, which also stops iOS zooming in), UI meta 13–14px, page title `clamp(1.75rem, 1.2rem + 2vw, 2.75rem)`.

## Layout and navigation

- **Phone (below 768px):** a top bar with the wordmark and a search button; a fixed bottom tab bar with Home, Enquiries, Orders, Customers and More; a floating gold **+ New** button that opens a sheet (new enquiry, new order, new customer, record payment). Every primary action is reachable with one thumb.
- **Tablet and laptop (768px and up):** a left sidebar, with content capped at 1200px. Lists become tables.
- **Large monitors:** the content cap stays, so long lines never stretch.
- Tap targets are at least 44px. Forms use one column on phones and two at most on desktop. Each form asks only for the essentials, with "More details" folded away.
- One radius rule: 10px for cards and inputs, full-round for pills and the + button.

## Motion

- Ease `cubic-bezier(.2,.7,.2,1)`; 160ms for small things, 240ms for sheets.
- Hover on primary buttons: the fill deepens and the label nudges 1px. Press: scale 0.98. Focus: a 2px gold ring with a 2px offset.
- The seam animates its newest stitch when a stage changes. Pipeline cards settle with a 2px swing on drop.
- Under reduced motion, everything is instant.
- **Still at rest, as a decision:** this is a work tool, so nothing moves while staff are reading.

## Honesty rules (from the owner)

- Payments entered by staff are always labelled **"Recorded manually"**. They are never shown as verified.
- The WhatsApp button says **"Open in WhatsApp"**. It never says "sent" and never shows a synced conversation.
- Integrations that aren't connected show "Not connected", never a success state.
- Subscription controls are labelled **"Managed manually"** until a payment provider is connected.
- The demo workspace has a permanent banner: "Demo workspace — fictional sample data".
