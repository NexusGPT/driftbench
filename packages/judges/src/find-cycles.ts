/**
 * The three-player cycles of a round robin: i beats j, j beats k and k beats i, each by majority (more wins than
 * losses). `wins[i][j]` counts the wins of i over j. Each cycle is listed once, as an index triple rotated to
 * start at its smallest index; the triples come in ascending order.
 */
export function findCycles(wins: readonly (readonly number[])[]): number[][] {
  const n = wins.length;
  const beats = (i: number, j: number) => (wins[i]?.[j] ?? 0) > (wins[j]?.[i] ?? 0);
  const cycles: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      for (let k = j + 1; k < n; k += 1) {
        // Read from the smallest index: i beats j, j beats k, k beats i, or the reverse ring i beats k, k beats j, j beats i.
        if (beats(i, j) && beats(j, k) && beats(k, i)) cycles.push([i, j, k]);
        if (beats(i, k) && beats(k, j) && beats(j, i)) cycles.push([i, k, j]);
      }
    }
  }
  return cycles;
}
