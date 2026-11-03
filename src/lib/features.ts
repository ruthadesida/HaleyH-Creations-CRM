/**
 * Which areas are built and usable. The UI hides links, buttons and summary
 * cards for anything still false, so staff never land on an unfinished screen.
 * Flip a flag only when the feature works end to end and is tested.
 */
export const FEATURES = {
  orders: false,
  payments: false,
  tasks: false,
  products: false,
  settings: false,
  production: false,
} as const;
