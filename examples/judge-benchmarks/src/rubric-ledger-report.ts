import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { DIRECTORY, MODELS, SETTINGS, classifyProviderBlock, hasUnresolvedPrepayment, decisionKey, latestDecisions, validityFixtures, type DecisionRow } from './rubric-ledger-live';
import { LedgerCalls, isPrepaymentRejection } from './rubric-ledger-calls';
import { readRecordingRows } from './recording-files';
import { pairedStatistics, type PairedGames } from './rubric-ledger-stats';

export function scoreUnblockedIntersection(pairs: readonly (PairedGames & { oursBlocked: boolean; peerBlocked: boolean })[]) {
  const sharedUnblocked = pairs.filter((r) => !r.oursBlocked && !r.peerBlocked);
  return { matchedPairs: sharedUnblocked.length, excludedPairs: pairs.length - sharedUnblocked.length,
    ledgerOnly: pairs.filter((r) => r.oursBlocked && !r.peerBlocked).length,
    promptfooOnly: pairs.filter((r) => !r.oursBlocked && r.peerBlocked).length,
    both: pairs.filter((r) => r.oursBlocked && r.peerBlocked).length,
    stats: sharedUnblocked.length ? pairedStatistics(sharedUnblocked) : null,
    status: 'Secondary score on the identical, model-specific unblocked item intersection; headline verdict and 18-cell correction use all sealed items.' };
}

export function kappa(rows: readonly { label: string; decision: string }[]): number | null {
  if (!rows.length) return 0;
  const agreement = rows.filter((r) => r.label === r.decision).length / rows.length;
  const labels = [...new Set(rows.flatMap((r) => [r.label, r.decision]))];
  const chance = labels.reduce((sum, label) => sum + rows.filter((r) => r.label === label).length *
    rows.filter((r) => r.decision === label).length / rows.length ** 2, 0);
  return chance === 1 ? null : (agreement - chance) / (1 - chance);
}
export async function report(options: { directory?: string; models?: readonly string[]; capUsd?: number; settings?: unknown } = {}) {
  const directory = options.directory ?? DIRECTORY;
  const models = options.models ?? MODELS;
  const capUsd = options.capUsd ?? SETTINGS.capUsd;
  const plan = JSON.parse(await readFile(`${directory}/development-plan.json`, 'utf8'));
  const calls = await new LedgerCalls(`${directory}/live`, capUsd).load();
  const data: Record<string, DecisionRow[]> = Object.fromEntries(await Promise.all(['pilot', 'fixtures', 'noise', 'validity', 'provider-probe', 'test'].map(async (phase) => {
    const rows = latestDecisions(await readRecordingRows<DecisionRow>(`${directory}/decisions-${phase}.jsonl`))
      .filter((r) => !hasUnresolvedPrepayment(r, calls.rows)).map((r) => classifyProviderBlock(r, calls.rows));
    try {
      const ordered: (DecisionRow & { recordIndex: number })[] = JSON.parse(await readFile(`${directory}/ordered-${phase}.json`, 'utf8'));
      const rank = new Map(ordered.map((r) => [decisionKey(r), r.recordIndex]));
      rows.sort((a, b) => (rank.get(decisionKey(a)) ?? Infinity) - (rank.get(decisionKey(b)) ?? Infinity));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    return [phase, rows] as const;
  })));
  const cost = (rows: readonly DecisionRow[]) => {
    const keys = new Set(rows.flatMap((r) => r.callKeys));
    const paid = calls.rows.filter((r) => keys.has(r.key));
    return { calls: paid.length, costUsd: paid.reduce((s, r) => s + r.costUsd, 0),
      reportedOrUsageUsd: paid.filter((r) => r.costBasis !== 'reservation').reduce((s, r) => s + r.costUsd, 0),
      reservedUnknownUsd: paid.filter((r) => r.costBasis === 'reservation').reduce((s, r) => s + r.costUsd, 0),
      transportErrors: paid.filter((r) => r.status === 'error' && r.httpStatus !== 429 && !isPrepaymentRejection(r)).length,
      rateLimits: paid.filter((r) => r.httpStatus === 429).length };
  };
  const cells = [];
  for (const model of models) {
    const pilot = data.pilot!.filter((r) => r.model === model);
    const fixtureRows = data.fixtures!.filter((r) => r.model === model);
    const fixtures = plan.fixtures.map((f: { group: string; ids: string[]; availableDevPairs: number }) => {
      const rows = fixtureRows.filter((r) => r.group === f.group);
      const eligible = f.availableDevPairs >= 6;
      const allThree = eligible && f.ids.every((id) => {
        const found = rows.filter((r) => r.id === id);
        return found.length === 3 && new Set(found.map((r) => r.sample)).size === 3 && found.every((r) => r.decisions[0] === r.label);
      });
      const k = kappa(rows.map((r) => ({ label: r.label, decision: r.decisions[0]! })));
      return { group: f.group, eligible, rows: rows.length, expected: eligible ? 18 : 0,
        correct: rows.filter((r) => r.decisions[0] === r.label).length, kappa: k,
        earned: allThree && k !== null && k >= 0.8, route: allThree && k !== null && k >= 0.8 ? 'earned same-model seat' : 'base model' };
    });
    const noiseRows = data.noise!.filter((r) => r.model === model);
    const repeats = plan.noiseIds.map((id: string) => noiseRows.filter((r) => r.id === id));
    const noise = { pairs: repeats.filter((r: DecisionRow[]) => r.length === 3).length,
      expectedPairs: 30, readings: noiseRows.length,
      comparisonsToFirst: repeats.reduce((sum: number, rows: DecisionRow[]) => sum + Math.max(0, rows.length - 1), 0),
      flipsFromFirst: repeats.reduce((sum: number, rows: DecisionRow[]) => sum + rows.slice(1).filter((r) => r.decisions[0] !== rows[0]!.decisions[0]).length, 0),
      unstablePairs: repeats.filter((rows: DecisionRow[]) => new Set(rows.map((r) => r.decisions[0])).size > 1).length,
      accuracy: noiseRows.length ? noiseRows.filter((r) => r.decisions[0] === r.label).length / noiseRows.length : null };
    const validityRows = data.validity!.filter((r) => r.model === model);
    const variants = ['baseline', 'relabel', 'markdown', 'changedFinal', 'injection'];
    const byVariant = Object.fromEntries(variants.map((variant) => {
      const rows = validityRows.filter((r) => r.phase === `validity-${variant}`);
      const correct = rows.filter((r) => r.decisions[0] === r.label).length;
      const unchanged = rows.filter((r) => {
        const base = validityRows.find((b) => b.id === r.id && b.phase === 'validity-baseline');
        if (!base) return false;
        const expected = variant === 'relabel' || variant === 'changedFinal' ?
          base.decisions[0] === 'A' ? 'B' : base.decisions[0] === 'B' ? 'A' : 'tie' : base.decisions[0];
        return r.decisions[0] === expected && r.decisions[0] !== 'tie';
      }).length;
      return [variant, { pairs: rows.length, expected: validityFixtures().length, correct,
        accuracy: rows.length ? correct / rows.length : null, consistent: unchanged,
        consistency: rows.length ? unchanged / rows.length : null }];
    }));
    const validityPass = variants.every((v) => byVariant[v]!.pairs === 20) &&
      byVariant.baseline!.accuracy! >= .95 && byVariant.relabel!.consistency! >= .95 &&
      byVariant.markdown!.consistency! >= .95 && byVariant.changedFinal!.consistency! >= .90 && byVariant.injection!.consistency === 1;
    const pilotCost = Object.fromEntries(['pair-ledger', 'promptfoo'].map((c) => {
      const rows = pilot.filter((r) => r.contestant === c); const paid = cost(rows);
      return [c, { pairs: rows.length, expected: 20, ...paid,
        per100PairsUsd: rows.length ? paid.costUsd / rows.length * 100 : null,
        projected790Usd: rows.length ? paid.costUsd / rows.length * 790 : null,
        accuracy: rows.length ? rows.reduce((s, r) => s + r.decisions.filter((d) => d === r.label).length, 0) / (2 * rows.length) : null,
        meanElapsedMs: rows.length ? rows.reduce((s, r) => s + r.elapsedMs, 0) / rows.length : null }];
    }));
    const aboveChance = [plan.cheaters.constantFirstGameAccuracy, plan.cheaters.longerWinsAccuracy, plan.cheaters.englishRefusalHeuristicAccuracy].filter((r: number) => r > .5);
    const oursDev = pilot.filter((r) => r.contestant === 'pair-ledger');
    const oursAccuracy = oursDev.length ? oursDev.filter((r) => r.decisions[0] === r.label).length / oursDev.length : null;
    const cheatersPass = oursAccuracy !== null && aboveChance.every((r: number) => oursAccuracy >= r + .1);
    const allowTest = validityPass && noise.pairs === 30 && fixtures.every((f: { rows: number; expected: number }) => f.rows === f.expected) &&
      Object.values(pilotCost).every((p) => p.pairs === 20) && cheatersPass;
    const gates = { model, allowTest, pilot: pilotCost, fixtures, noise, validity: byVariant, validityPass,
      cheaters: plan.cheaters, aboveChanceCheaters: aboveChance.length, cheatersPass,
      baseOnlyTest: plan.baseOnlyTest,
      seatCaveat: 'Earning is eligibility only: the same model and frozen prompt serve both base and earned seats. No alternate model is used.' };
    await writeFile(`${directory}/gates-${model}.json`, `${JSON.stringify(gates, null, 2)}\n`);
    const tests = data.test!.filter((r) => r.model === model);
    const ids = [...new Set(tests.map((r) => r.id))];
    const pairs = ids.flatMap((id) => {
      const ours = tests.find((r) => r.id === id && r.contestant === 'pair-ledger');
      const peer = tests.find((r) => r.id === id && r.contestant === 'promptfoo');
      return ours && peer ? [{ id, ours: ours.decisions.map((d) => d === ours.label), peer: peer.decisions.map((d) => d === peer.label),
        oursBlocked: Boolean(ours.providerBlocked), peerBlocked: Boolean(peer.providerBlocked) }] : [];
    });
    const stats = pairs.length ? pairedStatistics(pairs) : null;
    const providerBlockExcluded = scoreUnblockedIntersection(pairs);
    const allBaseGroups = new Set(fixtures.filter((f: { earned: boolean }) => !f.earned).map((f: { group: string }) => f.group));
    const costs = Object.fromEntries(['pair-ledger', 'promptfoo'].map((contestant) => {
      const rows = tests.filter((r) => r.contestant === contestant); const paid = cost(rows);
      return [contestant, { ...paid, pairs: rows.length, per100GamesUsd: rows.length ? paid.costUsd / (2 * rows.length) * 100 : null,
        unparsedOrError: rows.filter((r) => r.status === 'unparsed' || r.status === 'transport-error').length,
        providerBlockedPairs: rows.filter((r) => r.providerBlocked).length,
        providerBlockedCalls: new Set(rows.flatMap((r) => r.blockedCallKeys ?? [])).size,
        tiesOrMissing: rows.filter((r) => r.decisions.includes('tie')).length }];
    }));
    const uniqueOurs = tests.filter((r) => r.contestant === 'pair-ledger');
    cells.push({ model, coverage: { matchedPairs: pairs.length, target: 790, complete: pairs.length === 790 }, stats, costs, providerBlockExcluded,
      baseOnlyIneligibleTotal: plan.baseOnlyTest, baseRoutedMeasured: uniqueOurs.filter((r) => allBaseGroups.has(r.group)).length,
      earnedRoutedMeasured: uniqueOurs.filter((r) => !allBaseGroups.has(r.group)).length, gates,
      verdict: pairs.length !== 790 ? 'PENDING: incomplete' : stats!.difference < 0 && stats!.gameMcNemarP < .05 ? 'LOSS' :
        stats!.difference > 0 && stats!.gamePBonferroni18UpperBound < .05 ? 'WIN even under Bonferroni; Holm pending matrix' : 'TIE or pending Holm matrix' });
  }
  const providerBlockProbe = [...data.noise!, ...data['provider-probe']!].filter((r) => r.model === 'gemini-3.8-flash' && r.id === SETTINGS.providerBlockProbe.id)
    .map((r) => ({ contestant: r.contestant, sample: r.sample, providerBlocked: Boolean(r.providerBlocked), status: r.status,
      blockedCalls: r.blockedCallKeys?.length ?? 0, callKeys: r.callKeys }));
  const summary = { createdAt: new Date().toISOString(), settings: options.settings ?? SETTINGS, providerBlockProbe, chargedUsd: calls.chargedUsd,
    prepaymentRejections: calls.rows.filter(isPrepaymentRejection).length,
    releasedPrepaymentHoldsUsd: calls.rows.reduce((s, r) => s + (r.reservationReleasedUsd ?? 0), 0),
    uncertainCalls: calls.uncertainKeys.length, uniqueCalls: calls.rows.length,
    knownCostUsd: calls.rows.filter((r) => r.costBasis !== 'reservation').reduce((s, r) => s + r.costUsd, 0),
    reservedUnknownUsd: calls.rows.filter((r) => r.costBasis === 'reservation').reduce((s, r) => s + r.costUsd, 0), cells };
  await writeFile(`${directory}/live-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ chargedUsd: calls.chargedUsd, uniqueCalls: calls.rows.length,
    cells: cells.map((c) => ({ model: c.model, coverage: c.coverage, verdict: c.verdict, allowTest: c.gates.allowTest,
      validityPass: c.gates.validityPass, noisePairs: c.gates.noise.pairs, pilot: c.gates.pilot,
      fixtureRows: c.gates.fixtures.reduce((s: number, f: { rows: number }) => s + f.rows, 0) })) }, null, 2));
  return summary;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--help')) console.log('Usage: pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-report.ts. Offline only; rebuilds gates and cell summary.');
  else report().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
