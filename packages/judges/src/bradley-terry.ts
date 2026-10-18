/**
 * The Bradley-Terry model of a round robin: the maximum likelihood strength of each player, from a matrix where
 * wins[i][j] counts the wins of i over j (a tie counts half to each). Found by the minorization-maximization
 * iteration of Hunter (2004). A maximum exists only when every player reaches every other along wins, so a
 * comparison graph that is not strongly connected is refused with a RangeError.
 */

function stronglyConnected(wins: readonly (readonly number[])[]): boolean {
  const n = wins.length;
  const reaches = (forward: boolean) => {
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      for (let j = 0; j < n; j += 1) {
        const won = forward ? (wins[i]?.[j] ?? 0) : (wins[j]?.[i] ?? 0);
        if (won > 0 && !seen.has(j)) {
          seen.add(j);
          stack.push(j);
        }
      }
    }
    return seen.size === n;
  };
  return reaches(true) && reaches(false);
}

/** The strengths of the players, summing to 1, in the order of the matrix. */
export function bradleyTerry(wins: readonly (readonly number[])[]): number[] {
  const n = wins.length;
  if (!stronglyConnected(wins)) {
    throw new RangeError(
      'the comparison graph is not strongly connected: no maximum likelihood strength exists',
    );
  }
  let p = new Array<number>(n).fill(1 / n);
  for (let iter = 0; iter < 100000; iter += 1) {
    const next = p.map((pi, i) => {
      let w = 0;
      let d = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const nij = (wins[i]?.[j] ?? 0) + (wins[j]?.[i] ?? 0);
        w += wins[i]?.[j] ?? 0;
        if (nij > 0) d += nij / (pi + (p[j] as number));
      }
      return d === 0 ? pi : w / d;
    });
    const sum = next.reduce((s, v) => s + v, 0);
    const norm = next.map((v) => v / sum);
    const change = Math.max(...norm.map((v, i) => Math.abs(v - (p[i] as number))));
    p = norm;
    if (change < 1e-13) break;
  }
  return p;
}
