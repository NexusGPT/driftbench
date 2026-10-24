const SYLLABLES = ['ba', 'lo', 'ri', 'ten', 'mu', 'sa', 'dro', 'vi', 'ko', 'pel', 'zan', 'ur', 'fe', 'gol'];

/** Invented names for the items of lint.defect: the same seed and index give the same name, none repeats. */
export function invent(seed: number, count: number, prefix: string): string[] {
  const out: string[] = [];
  let state = (seed * 2654435761) >>> 0;
  for (let index = 0; index < count; index += 1) {
    state = (Math.imul(state ^ (index + 1), 1103515245) + 12345) >>> 0;
    const a = SYLLABLES[state % SYLLABLES.length];
    const b = SYLLABLES[(state >>> 8) % SYLLABLES.length];
    out.push(`${prefix}-${a}${b}-${index}`);
  }
  return out;
}
