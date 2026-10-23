import { cutList } from '@agent-nexus/driftbench-estate';

/** How many items of one list a report prints before it only counts the rest, unless `--verbose` is given. */
export const LIST_LIMIT = 10;

/** The cut of a list for a report: undefined (list every item) with `--verbose`, else the default limit. */
export function limitOf(verbose: boolean | undefined): number | undefined {
  return verbose === true ? undefined : LIST_LIMIT;
}

/** The line that stands for the items a list leaves out. */
export function moreLine(left: number): string {
  return `... ${left} more`;
}

/** A report line: the title, then every item, or the total and the first items when the list is cut. */
export function listLine(title: string, items: readonly string[], limit?: number): string {
  if (items.length === 0) return `  ${title}: none.`;
  const cut = cutList(items, limit);
  if (cut.omitted === 0) return `  ${title}: ${cut.shown.join(', ')}.`;
  return `  ${title}: ${cut.total}, the first ${cut.shown.length} are ${cut.shown.join(', ')}.`;
}
