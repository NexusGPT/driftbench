export const flip = (x: string | null) => x === 'A' ? 'B' : x === 'B' ? 'A' : x;
export function score(benchmark: string, games: (string | null)[], gold: string) {
  if (benchmark === 'jb') {
    const net = games.reduce((n, g) => n + (g === gold ? 1 : g === null || g === 'tie' ? 0 : -1), 0);
    return net > 0 ? 1 : 0;
  }
  return games.reduce((n, g) => n + (g === gold ? 1 : benchmark === 'mm' && g === 'tie' ? .5 : 0), 0) / 2;
}
function tail(n: number, k: number, p = .5) {
  let sum = 0;
  for (let i = k; i <= n; i++) {
    let logC = 0;
    for (let j = 1; j <= i; j++) logC += Math.log(n - j + 1) - Math.log(j);
    sum += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return Math.min(1, sum);
}
export function exactSign(wins: number, losses: number) {
  return wins + losses === 0 ? 1 : Math.min(1, 2 * tail(wins + losses, Math.max(wins, losses)));
}
export function comparison(rows: {ledger: number; promptfoo: number; baseline: number}[]) {
  const n = rows.length;
  const wins = rows.filter(r => r.ledger > r.promptfoo).length;
  const losses = rows.filter(r => r.ledger < r.promptfoo).length;
  const discordant = wins + losses;
  let critical = null;
  for (let k = Math.ceil(discordant / 2); k <= discordant; k++) {
    if (exactSign(k, discordant - k) <= .05) { critical = k; break; }
  }
  let p80 = null;
  if (critical !== null) {
    let lo = .5, hi = 1 - 1e-12;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (tail(discordant, critical, mid) >= .8) hi = mid; else lo = mid;
    }
    p80 = hi;
  }
  return {n, wins, losses, ties: n - discordant, p: exactSign(wins, losses),
    ledger: n ? rows.reduce((s, r) => s + r.ledger, 0) / n : null,
    promptfoo: n ? rows.reduce((s, r) => s + r.promptfoo, 0) / n : null,
    baseline: n ? rows.reduce((s, r) => s + r.baseline, 0) / n : null,
    improvedFromBaseline: rows.filter(r => r.ledger > r.baseline).length,
    worseThanBaseline: rows.filter(r => r.ledger < r.baseline).length,
    power: {discordantPairs: discordant, alpha: .05, criticalWins: critical,
      minimumSignificantNetPairWins: critical === null ? null : 2 * critical - discordant,
      minimumSignificantNetPairMargin: critical === null || !n ? null : (2 * critical - discordant) / n,
      conditional80PercentPowerWinProbability: p80,
      conditional80PercentPowerNetPairMargin: p80 === null || !n ? null : (2 * p80 - 1) * discordant / n,
      note: 'Conditional exact sign test; margins concern net pair wins, not directional game accuracy. Fewer than six discordant pairs cannot reject at two-sided alpha .05.'}};
}
