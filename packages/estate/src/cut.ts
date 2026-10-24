/**
 * A list cut for a report. The cut is data: what is shown, how many there are, and how many the cut leaves out.
 * A report prints it, a check reads it.
 */
export type CutList<T> = {
  /** The first items, in their order: at most `limit`, all of them without a limit. */
  shown: T[];
  /** How many items there are. */
  total: number;
  /** How many items the cut leaves out. */
  omitted: number;
};

export function cutList<T>(items: readonly T[], limit?: number): CutList<T> {
  const shown = limit === undefined ? [...items] : items.slice(0, limit);
  return { shown, total: items.length, omitted: items.length - shown.length };
}
