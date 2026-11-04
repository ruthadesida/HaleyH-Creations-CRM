/** Which units an item can be counted or bought in: its own purchase pack, then units of the same kind. */
export type UnitRow = { code: string; name: string; dimension: string };
export type UnitItem = { base_unit: string; purchase_unit: string | null };

export function unitOptions(item: UnitItem | undefined, units: UnitRow[]): string[] {
  if (!item) return [];
  const dim = units.find((u) => u.code === item.base_unit)?.dimension;
  const same = units.filter((u) => u.dimension === dim).map((u) => u.code);
  const ordered = [item.base_unit, ...same.filter((c) => c !== item.base_unit)];
  return item.purchase_unit ? [item.purchase_unit, ...ordered] : ordered;
}
