import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { parse } from 'yaml';
import type { FixtureSuite, SuiteSpec } from './fixture-suite';
import { FIXTURE, fixtureSuite } from './fixture-suite';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { TEST_TYPES } from './genquality';
import { type AskEnv, checkAsk, checkTrace, envOf, firstAskOf, type TraceNeed } from './task-check';
import { observeOnFake } from './task-trace';

/**
 * gen.task, version 2: every first ask of a complete spec of a test type is judged from ids, structure and the
 * trace of the fake agent, not from its words (`task-check.ts`). One item per test type, as in version 1.
 */

const GENERATE = 'packages/generate/src/estate/generate.ts';

/**
 * The tie of a piece of a code-written ask to the text it cites: the share of the character 5-grams of the
 * piece found in the pooled text of the cited atom and the atoms of its row. Measured on the Northwind suite:
 * 624 real pieces score 0.68 or more. A planted ask that shares a word with the pool (an invoice number in an
 * invoice rule) scores 0.5, one that shares nothing at most 0.18. The floor sits between the two.
 */
export const TIE = { floor: 0.6, gram: 5 };

export const TASK_TYPES = TEST_TYPES;

export async function envOfSuite(suite: FixtureSuite): Promise<AskEnv> {
  const map = await loadEstateMap(suite.map);
  if (!map.ok) throw new Error('the fixture map does not load');
  const bank = parse(await readFile(join(FIXTURE, 'phrases.yaml'), 'utf8'));
  const sessions = parse(
    await readFile(join(FIXTURE, 'sessions', 'index.yaml'), 'utf8').catch(() => 'sessions: []'),
  );
  return envOf(map.map.atoms, bank, sessions, TIE);
}

export type SpecVerdict = { id: string; testType: string; reasons: string[] };

/** The verdict of every complete spec: its static reasons, then its trace for an explicit live ask. */
export async function judgeSpecs(
  specs: readonly SuiteSpec[],
  env: AskEnv,
  observe: (
    paths: readonly string[],
  ) => Promise<ReturnType<typeof observeOnFake> extends Promise<infer M> ? M : never> = observeOnFake,
): Promise<SpecVerdict[]> {
  const verdicts = specs.map((spec) => ({ spec, ...checkAsk(spec, env) }));
  const needing = verdicts.filter(
    (entry): entry is typeof entry & { trace: TraceNeed } => entry.trace !== undefined,
  );
  const observed = await observe(needing.map((entry) => entry.spec.path));
  return verdicts.map(({ spec, reasons, trace }) => {
    const all = [...reasons];
    if (trace && reasons.length === 0) {
      const why = checkTrace(trace, observed.get(spec.id));
      if (why) all.push(why);
    }
    return { id: spec.id, testType: spec.testType, reasons: all };
  });
}

export function taskFamilyV2(): Family {
  const items = itemsOf(
    'gen.task',
    4,
    GENERATE,
    TASK_TYPES.map((type) => ({
      key: type,
      tier: 2 as Tier,
      title: `every first ask of a complete ${type} spec holds a task: a verb and its object`,
      cause: 'write every ask as a task, never as a restated rule or a bare condition',
    })),
  );
  return {
    id: 'gen.task',
    level: 4,
    component: GENERATE,
    items,
    seedFree: true,
    async evaluate() {
      const out = new Map<string, ItemResult>();
      let verdicts: SpecVerdict[];
      let suite: FixtureSuite;
      try {
        suite = await fixtureSuite();
        const specs = suite.specs.filter(
          (spec) => spec.complete && (TASK_TYPES as readonly string[]).includes(spec.testType),
        );
        verdicts = await judgeSpecs(specs, await envOfSuite(suite));
      } catch (cause) {
        for (const item of items)
          out.set(item.id, {
            pass: false,
            detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        return out;
      }
      for (const type of TASK_TYPES) {
        const own = verdicts.filter((entry) => entry.testType === type);
        const bad = own.filter((entry) => entry.reasons.length > 0);
        out.set(
          `gen.task.${type}`,
          own.length === 0
            ? { pass: false, detail: `no complete ${type} spec` }
            : bad.length === 0
              ? { pass: true, detail: `holds (${own.length})` }
              : {
                  pass: false,
                  detail: `${bad.length} of ${own.length} asks hold no task, such as ${bad
                    .slice(0, 3)
                    .map((entry) => `${entry.id} (${entry.reasons[0]})`)
                    .join('; ')}`,
                },
        );
      }
      return out;
    },
  };
}

export { firstAskOf };
