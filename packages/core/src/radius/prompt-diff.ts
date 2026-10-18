/** Offsets are UTF-16 code units after NFC and CRLF/CR -> LF normalization. Other whitespace is retained. */
export const normalizePrompt = (text: string): string => text.replace(/\r\n?/g, '\n').normalize('NFC');
export type PromptRegion = { oldStart: number; oldEnd: number; newStart: number; newEnd: number };

/**
 * Banded unit-cost Levenshtein alignment. Every optimal path of cost <= LIMIT stays in this band.
 * Tied paths are uncertain, never a reason to carry. Bounds only cause conservative fallback.
 */
export function promptDiff(
  before: string,
  after: string,
): {
  regions: PromptRegion[];
  equal: Map<number, number>;
  uncertainty?: string;
} {
  const LIMIT = 64;
  const width = LIMIT * 2 + 1;
  const unresolved = (uncertainty: string) => ({
    regions: [{ oldStart: 0, oldEnd: before.length, newStart: 0, newEnd: after.length }],
    equal: new Map<number, number>(),
    uncertainty,
  });
  if (Math.abs(before.length - after.length) > LIMIT || (before.length + 1) * width > 8_000_000)
    return unresolved('diff exceeds the exact alignment bound');
  const table = new Uint16Array((before.length + 1) * width).fill(LIMIT + 1);
  const get = (i: number, j: number) =>
    i < 0 || j < 0 || Math.abs(j - i) > LIMIT ? LIMIT + 1 : (table[i * width + j - i + LIMIT] ?? LIMIT + 1);
  for (let i = 0; i <= before.length; i++) {
    for (let j = Math.max(0, i - LIMIT); j <= Math.min(after.length, i + LIMIT); j++) {
      table[i * width + j - i + LIMIT] =
        i === 0
          ? j
          : j === 0
            ? i
            : Math.min(
                LIMIT + 1,
                get(i - 1, j) + 1,
                get(i, j - 1) + 1,
                get(i - 1, j - 1) + (before[i - 1] === after[j - 1] ? 0 : 1),
              );
    }
  }
  if (get(before.length, after.length) > LIMIT) return unresolved('diff exceeds the exact alignment bound');
  const steps: { i: number; j: number; same: boolean; di: number; dj: number }[] = [];
  let i = before.length,
    j = after.length,
    ambiguous = false;
  while (i > 0 || j > 0) {
    const choices: { di: number; dj: number; same: boolean }[] = [];
    if (i > 0 && j > 0 && get(i, j) === get(i - 1, j - 1) + (before[i - 1] === after[j - 1] ? 0 : 1))
      choices.push({ di: 1, dj: 1, same: before[i - 1] === after[j - 1] });
    if (i > 0 && get(i, j) === get(i - 1, j) + 1) choices.push({ di: 1, dj: 0, same: false });
    if (j > 0 && get(i, j) === get(i, j - 1) + 1) choices.push({ di: 0, dj: 1, same: false });
    const step = choices[0];
    if (!step) return unresolved('alignment cannot be proved');
    if (choices.length > 1) ambiguous = true;
    i -= step.di;
    j -= step.dj;
    steps.push({ i, j, ...step });
  }
  const equal = new Map<number, number>();
  const regions: PromptRegion[] = [];
  let region: PromptRegion | undefined;
  for (const step of steps.reverse()) {
    if (step.same) {
      equal.set(step.i, step.j);
      region = undefined;
    } else {
      if (!region) {
        region = { oldStart: step.i, oldEnd: step.i, newStart: step.j, newEnd: step.j };
        regions.push(region);
      }
      region.oldEnd = step.i + step.di;
      region.newEnd = step.j + step.dj;
    }
  }
  return { regions, equal, ...(ambiguous ? { uncertainty: 'ambiguous optimal diff alignment' } : {}) };
}
