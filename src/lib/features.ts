/**
 * Which areas are built and usable. The UI hides links, buttons and summary
 * cards for anything still false, so staff never land on an unfinished screen.
 * Flip a flag only when the feature works end to end and is tested.
 */
export const FEATURES = {
  /** Phase 1: catalogue, locations, ledger, transfers, counts, opening stock, makers, suppliers. */
  inventory: true,
  /** Business settings, staff and permissions. */
  settings: true,
  /** Phase 2: purchase requests and orders, goods received, supplier returns, supplier bills and payments. */
  purchasing: true,
  /** Phase 2: recipes (BOMs), production jobs, reservations, WIP, external makers, QC. */
  production: true,
  /** Phase 3: quotations, orders, reservations, dispatch, returns; customer payments and refunds. */
  orders: true,
  payments: true,
  // Later phases:
  tasks: false,
} as const;
