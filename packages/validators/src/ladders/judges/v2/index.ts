import { type BankEntry, bankMeasure, defineLadder, type Ladder } from '../../../ladder';
import { type BankItem, type ItemResult, type JudgesApi, realApi, runItem } from './bank';
import { causeOf } from './causes';
import { agreementItems } from './families/agreement';
import { attackItems } from './families/attacks';
import { auditItems } from './families/audit';
import { calibrationItems } from './families/calibration';
import { clientItems } from './families/clients';
import { cassetteItems, consistencyItems } from './families/consistency';
import { contractItems } from './families/contract';
import { cascadeItems, councilItems } from './families/council';
import { checkItems, criteriaItems } from './families/criteria';
import { evidenceItems } from './families/evidence';
import { extraItems } from './families/extra';
import { injectionItems, precisionItems } from './families/injection';
import { billedMode, liveItems } from './families/live';
import { moreItems } from './families/more';
import { pairwiseItems } from './families/pairwise';
import { renderItems } from './families/render';
import { rubricItems } from './families/rubric';
import { scaleItems } from './families/scale';
import { budgetItems, turnItems } from './families/turns';
import { v1Items } from './families/v1';
import { ITEM_TIME_LIMIT_MS, runIsolated } from './isolate';
import { isQuarantined } from './needs';

export * from './bank';
export { causeOf } from './causes';
export { BILLED_APPROVAL, billedMode } from './families/live';
export { isQuarantined, QUARANTINED_FAMILIES, QUARANTINED_ITEMS } from './needs';
export { parseRendered, ruleVerdict } from './rules';

/**
 * The judge validator, ladder version 2 (docs/validators.md section 12): a bank of items in levels ordered by
 * the cost of diagnosis. Every level's threshold is 1: every item of the level passes, or the level fails and
 * names its failing items. The run stops at the first failing level; the bank score (`runBank`) runs every
 * item on every seed.
 */

export const LADDER_VERSION = 2;

/** The levels, in the order a builder diagnoses them. */
export const LEVELS: readonly { id: string; name: string }[] = [
  { id: 'v1', name: 'the seven levels of version 1' },
  { id: 'contract', name: 'the answer contract under hostile output' },
  { id: 'consistency', name: 'the same request, the same prompt, key and verdict' },
  { id: 'cassette', name: 'cassettes replay what they recorded' },
  { id: 'clients', name: 'judge clients read what providers send back' },
  { id: 'criteria', name: 'criteria files and their fixture pairs' },
  { id: 'check', name: 'the judge check beside machine verdicts' },
  { id: 'rubric', name: 'rubrics a judge can answer' },
  { id: 'render', name: 'rule judges read the rendered prompt under transforms' },
  { id: 'budget', name: 'a request fitted to a prompt budget' },
  { id: 'evidence', name: 'evidence quotes the data' },
  { id: 'injection', name: 'the screen flags instructions to the judge, not their twins' },
  { id: 'precision', name: "the judge's words in customer talk are not instructions" },
  { id: 'attacks', name: 'documented attacks on the judge' },
  { id: 'council', name: 'council majority: sizes, weights, correlated errors' },
  { id: 'cascade', name: 'cascade cost and agreement' },
  { id: 'turns', name: 'turn by turn judging: the lowest turn, drift onset, recovery' },
  { id: 'pairwise', name: 'pairwise judging and rankings' },
  { id: 'calibration', name: 'calibration coverage and skewed prevalence' },
  { id: 'scale', name: 'the same operations at 10 and 100 times the input' },
  { id: 'live', name: 'real judge clients, billed mode only' },
];

/**
 * Every item of the bank, deterministic and live, without the quarantined ones (validators/judges/NEEDS.md).
 * `quarantined: true` adds them back: they stay as code and still run when a caller passes them.
 */
export function judgesBank(options: { quarantined?: boolean } = {}): BankItem[] {
  const all: BankItem[] = [
    ...v1Items(),
    ...contractItems(),
    ...consistencyItems(),
    ...cassetteItems(),
    ...clientItems(),
    ...criteriaItems(),
    ...checkItems(),
    ...rubricItems(),
    ...renderItems(),
    ...budgetItems(),
    ...evidenceItems(),
    ...injectionItems(),
    ...precisionItems(),
    ...attackItems(),
    ...councilItems(),
    ...cascadeItems(),
    ...turnItems(),
    ...pairwiseItems(),
    ...calibrationItems(),
    ...agreementItems(),
    ...scaleItems(),
    ...auditItems(),
    ...extraItems(),
    ...moreItems(),
    ...liveItems(),
  ];
  return all
    .filter((entry) => options.quarantined || !isQuarantined(entry))
    .map((entry) => ({ ...entry, cause: causeOf(entry.id) }));
}

export type JudgesV2Options = {
  /** The package the items call. Default: @agent-nexus/driftbench-judges. Tests pass another table. */
  api?: JudgesApi;
  /** The items. Default: the whole bank. */
  bank?: BankItem[];
  /** Run the live items. Default: billedMode(), true only with the owner's approval in the environment. */
  billed?: boolean;
  /**
   * Run each item in a child process under a time limit, so a hang fails one item ("timed out") and never stalls
   * the run. Default: true for the real package; a table passed as `api` runs in this process.
   */
  isolate?: boolean;
  /** The time limit of one item when isolated. Default ITEM_TIME_LIMIT_MS. */
  timeLimitMs?: number;
};

/** Runs items on one seed: in child processes under the time limit, or in this process with the given table. */
function resultsFor(options: JudgesV2Options) {
  const isolate = options.isolate ?? options.api === undefined;
  const api = options.api ?? realApi;
  const cache = new Map<string, Promise<Map<string, ItemResult>>>();
  return (items: readonly BankItem[], seed: number, root: string): Promise<Map<string, ItemResult>> => {
    const key = `${seed}:${root}:${items.map((e) => e.id).join(',').length}:${items[0]?.id}`;
    let found = cache.get(key);
    if (!found) {
      found = isolate
        ? runIsolated(items, seed, root, options.timeLimitMs ?? ITEM_TIME_LIMIT_MS)
        : (async () => {
            const out = new Map<string, ItemResult>();
            for (const entry of items) out.set(entry.id, await runItem(entry, seed, root, api));
            return out;
          })();
      cache.set(key, found);
    }
    return found;
  };
}

/** The judges ladder, version 2. */
export function judgesLadderV2(options: JudgesV2Options = {}): Ladder {
  const bank = options.bank ?? judgesBank();
  const results = resultsFor(options);
  const billed = options.billed ?? billedMode();
  const levels = LEVELS.filter((level) => level.id !== 'live' || billed).filter((level) =>
    bank.some((entry) => entry.level === level.id),
  );
  return defineLadder({
    component: 'judges',
    version: LADDER_VERSION,
    levels: levels.map((level) => {
      const own = bank.filter((entry) => entry.level === level.id && (billed || !entry.live));
      return {
        id: level.id,
        name: level.name,
        metric: `items of ${level.id} passing / ${own.length} items`,
        threshold: 1,
        async compute({ seed, root }) {
          const entries: BankEntry[] = [];
          // One run per seed covers every level: the first level asks for the whole bank, the others reuse it.
          const all = bank.filter((entry) => billed || !entry.live);
          const byId = await results(all, seed, root);
          for (const entry of own) {
            const result = byId.get(entry.id) ?? { pass: false, detail: 'the item was not run' };
            entries.push({
              id: entry.id,
              component: entry.component,
              family: entry.family,
              tier: entry.tier,
              ...(entry.cause ? { cause: entry.cause } : {}),
              pass: result.pass,
              ...(result.pass ? {} : { detail: result.detail }),
            });
          }
          return bankMeasure(entries, `packages/validators/src/ladders/judges/v2 (${level.id})`);
        },
      };
    }),
  });
}

export type BankRun = {
  seeds: { seed: number; hidden: boolean }[];
  /** Per item: whether it passed on each seed, in the order of `seeds`. */
  results: { id: string; family: string; tier: number; level: string; passes: boolean[]; detail: string }[];
  /** Items passing on every seed over deterministic items. */
  score: number;
  passing: number;
  size: number;
  /** The level reached on each seed: the leading levels whose items all pass. */
  levels: number[];
};

/** Runs every deterministic item on every seed: the bank score of section 12.4. */
export async function runBank(
  seeds: readonly { seed: number; hidden: boolean }[],
  root: string,
  options: JudgesV2Options = {},
): Promise<BankRun> {
  const bank = (options.bank ?? judgesBank()).filter((entry) => !entry.live);
  const run = resultsFor(options);
  const perSeed: Map<string, ItemResult>[] = [];
  for (const spec of seeds) perSeed.push(await run(bank, spec.seed, root));
  const results: BankRun['results'] = [];
  for (const entry of bank) {
    const passes: boolean[] = [];
    let detail = '';
    for (const [s, spec] of seeds.entries()) {
      const result = perSeed[s]?.get(entry.id) ?? { pass: false, detail: 'the item was not run' };
      passes.push(result.pass);
      if (!result.pass && detail === '')
        detail = `seed ${spec.hidden ? 'hidden' : spec.seed}: ${result.detail}`;
    }
    results.push({
      id: entry.id,
      family: entry.family,
      tier: entry.tier,
      level: entry.level,
      passes,
      detail,
    });
  }
  const passing = results.filter((r) => r.passes.every(Boolean)).length;
  const order = LEVELS.map((level) => level.id).filter((id) => bank.some((entry) => entry.level === id));
  const levels = seeds.map((_, s) => {
    let reached = 0;
    for (const id of order) {
      if (results.filter((r) => r.level === id).every((r) => r.passes[s])) reached += 1;
      else break;
    }
    return reached;
  });
  return {
    seeds: [...seeds],
    results,
    score: bank.length === 0 ? 0 : passing / bank.length,
    passing,
    size: bank.length,
    levels,
  };
}

/** The bank per family and tier, deterministic and live. */
export function bankShape(bank: readonly BankItem[] = judgesBank()): {
  families: Record<string, { items: number; tiers: Record<string, number>; live: number }>;
  deterministic: number;
  live: number;
} {
  const families: Record<string, { items: number; tiers: Record<string, number>; live: number }> = {};
  for (const entry of bank) {
    const row = families[entry.family] ?? { items: 0, tiers: {}, live: 0 };
    row.items += 1;
    row.tiers[String(entry.tier)] = (row.tiers[String(entry.tier)] ?? 0) + 1;
    if (entry.live) row.live += 1;
    families[entry.family] = row;
  }
  const live = bank.filter((entry) => entry.live).length;
  return { families, deterministic: bank.length - live, live };
}

/** The gate of section 12.3 on bank shape: at least 300 deterministic items, no family under 20, every tier. */
export function shapeProblems(bank: readonly BankItem[] = judgesBank()): string[] {
  const det = bank.filter((entry) => !entry.live);
  const problems: string[] = [];
  if (det.length < 300) problems.push(`${det.length} deterministic items, under 300`);
  const shape = bankShape(det);
  for (const [family, row] of Object.entries(shape.families)) {
    if (row.items < 20) problems.push(`family ${family} has ${row.items} items, under 20`);
  }
  for (const tier of [1, 2, 3, 4, 5]) {
    if (!det.some((entry) => entry.tier === tier)) problems.push(`no item of tier ${tier}`);
  }
  return problems;
}
