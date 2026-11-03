/**
 * Where a dragged card lands in a column, as a sortable `position` number.
 * Cards are ordered by position; we place the card between its new neighbours.
 */
export type Positioned = { id: string; position: number };

export function dropPosition(
  column: Positioned[], // cards in the target column, sorted by position (may include the dragged card)
  activeId: string,
  overId: string | null, // card dropped on, or null when dropped on the column itself
): number {
  const fromIndex = column.findIndex((c) => c.id === activeId);
  const others = column.filter((c) => c.id !== activeId);
  if (!overId || overId === activeId) {
    // Dropped on empty space: go to the end (or stay put if already in this column).
    if (fromIndex !== -1 && !overId) return (others.at(-1)?.position ?? 0) + 1;
    return fromIndex !== -1 ? column[fromIndex].position : (others.at(-1)?.position ?? 0) + 1;
  }
  const overIndex = column.findIndex((c) => c.id === overId);
  const over = column[overIndex];
  // Moving down within the same column lands *below* the card dropped on; otherwise above.
  const movingDown = fromIndex !== -1 && fromIndex < overIndex;
  const otherIndex = others.findIndex((c) => c.id === overId);
  if (movingDown) {
    const after = others[otherIndex + 1];
    return after ? (over.position + after.position) / 2 : over.position + 1;
  }
  const before = others[otherIndex - 1];
  return before ? (before.position + over.position) / 2 : over.position - 1;
}
