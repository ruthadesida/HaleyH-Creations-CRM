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
  // Later phases:
  orders: false,
  payments: false,
  tasks: false,
  production: false,
} as const;
