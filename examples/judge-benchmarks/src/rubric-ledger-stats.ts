import { wilson } from '@agent-nexus/driftbench-stats';

export type PairedGames = {
  id: string;
  ours: readonly boolean[];
  peer: readonly boolean[];
};

/** Exact two-sided binomial test over discordances; equivalently exact McNemar. */
export function exactMcNemar(wins: number, losses: number): number {
  if (![wins, losses].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw new Error('Discordance counts must be nonnegative integers');
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let logProbability = -n * Math.LN2;
  let logSum = logProbability;
  for (let i = 1; i <= k; i++) {
    logProbability += Math.log(n - i + 1) - Math.log(i);
    const largest = Math.max(logSum, logProbability);
    logSum = largest + Math.log(Math.exp(logSum - largest) + Math.exp(logProbability - largest));
  }
  return Math.min(1, 2 * Math.exp(logSum));
}

/** Design section 4.6: normal approximation, 80% power, alpha=0.05/18 (two-sided). */
export function powerLine(wins: number, losses: number, units: number) {
  const discordant = wins + losses;
  const d = discordant / units;
  const w = discordant ? wins / discordant : 0.5;
  // Python statistics.NormalDist().inv_cdf(1 - .05/18/2), inv_cdf(.8).
  const za = 2.991316115183682;
  const zb = 0.8416212335729144;
  const neededDiscordant = w === 0.5 ? null :
    Math.ceil((za * 0.5 + zb * Math.sqrt(w * (1 - w))) ** 2 / (w - 0.5) ** 2);
  return { units, discordant, discordanceShare: d, winShare: w,
    alpha: 0.05 / 18, targetPower: 0.8, neededDiscordant,
    neededUnits: neededDiscordant === null || !d ? null : Math.ceil(neededDiscordant / d) };
}

export function pairedStatistics(rows: readonly PairedGames[]) {
  if (!rows.length || new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error('Require nonempty, unique pair ids');
  let wins = 0, losses = 0, bothRight = 0, bothWrong = 0, oursRight = 0, peerRight = 0;
  let pairWins = 0, pairLosses = 0;
  const differences: number[] = [];
  for (const row of rows) {
    if (row.ours.length !== 2 || row.peer.length !== 2) throw new Error('Require two matched games');
    let delta = 0;
    for (let j = 0; j < 2; j++) {
      const a = Number(row.ours[j]), b = Number(row.peer[j]);
      oursRight += a; peerRight += b; delta += a - b;
      if (a && !b) wins++;
      else if (b && !a) losses++;
      else if (a) bothRight++;
      else bothWrong++;
    }
    if (delta > 0) pairWins++;
    if (delta < 0) pairLosses++;
    differences.push(delta / 2);
  }
  // Deterministic cluster bootstrap: two orders stay together within each pair.
  let state = 0x52424c47;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 0x100000000; };
  const boot: number[] = [];
  for (let b = 0; b < 10000; b++) {
    let sum = 0;
    for (let i = 0; i < rows.length; i++) sum += differences[Math.floor(random() * rows.length)]!;
    boot.push(sum / rows.length);
  }
  boot.sort((a, b) => a - b);
  const n = rows.length * 2;
  return { pairs: rows.length, games: n, wins, losses, bothRight, bothWrong,
    ours: { correct: oursRight, ...wilson(oursRight, n) },
    peer: { correct: peerRight, ...wilson(peerRight, n) },
    difference: (oursRight - peerRight) / n,
    differencePairBootstrap95: [boot[249], boot[9749]],
    gameMcNemarP: exactMcNemar(wins, losses),
    gamePBonferroni18UpperBound: Math.min(1, exactMcNemar(wins, losses) * 18),
    holmP: null,
    holmStatus: 'pending complete 18-cell matrix; Bonferroni value is a bound, not Holm',
    pairSensitivity: { wins: pairWins, losses: pairLosses, p: exactMcNemar(pairWins, pairLosses) },
    power: powerLine(wins, losses, n),
    pairSensitivityPower: powerLine(pairWins, pairLosses, rows.length),
    caveat: 'Game Wilson and McNemar treat orders as independent. Canonical games share one judgment. Pair bootstrap and pair sign sensitivity retain dependence.' };
}
