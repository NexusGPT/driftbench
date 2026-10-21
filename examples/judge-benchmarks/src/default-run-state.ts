/** A retry appends a row: the latest receipt for each item is authoritative. */
export function lastPerId<T extends { id: string }>(rows: readonly T[]): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export function completedIds(rows: readonly { id: string; failure: string | null }[]): Set<string> {
  return new Set(
    lastPerId(rows)
      .filter((row) => row.failure === null)
      .map((row) => row.id),
  );
}

/** Compare identity sets as well as counts: duplicates must never hide a missing sealed item. */
export function requireSealedItems(items: readonly { id: string }[], sealed: ReadonlySet<string>): void {
  const loaded = new Set(items.map((item) => item.id));
  const absent = [...sealed].filter((id) => !loaded.has(id));
  const unexpected = [...loaded].filter((id) => !sealed.has(id));
  const duplicates = items.length - loaded.size;
  if (absent.length || unexpected.length || duplicates)
    throw new Error(
      `sealed ${sealed.size}, loaded ${items.length}: ${absent.length} absent, ${unexpected.length} unexpected, ${duplicates} duplicate ids; refusing to score a part`,
    );
}
