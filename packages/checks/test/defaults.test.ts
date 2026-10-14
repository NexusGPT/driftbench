import type { BlockResult, Check, CheckContext, Observed, Spec, Verdict } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import * as checks from '../src';
import { defaultChecks } from '../src/defaults';
import { acme } from './support/acme';
import { context, observed } from './support/context';
import { fakeXlsx, files, PRICE_SHEET, registry } from './support/readers';

const NAMES = [
  'tools',
  'tools_offered',
  'forbidden',
  'must',
  'must_not',
  'regex',
  'exact',
  'injection',
  'length',
  'markup',
  'starts_with',
  'finish_reason',
  'json',
  'tool_f1',
  'refusal',
  'rouge_l',
  'bleu',
  'sql',
  'similarity',
  'relevancy',
  'knowledge_retention',
  'lang',
  'pii',
  'cards',
  'stage',
  'skills',
  'guards',
  'references',
  'subagents',
  'execution',
  'workspace',
  'safety',
  'artifacts',
  'schema_strict',
  'budget',
  'end_state',
  'custom',
];

/** Runs every default check on every block of a run, as the runner does, and returns the verdicts per block. */
async function runAll(
  spec: Spec,
  blocks: Observed[],
  extra: (index: number) => Partial<CheckContext> = () => ({}),
): Promise<Verdict[][]> {
  const history: BlockResult[] = [];
  const out: Verdict[][] = [];
  for (const [index, seen] of blocks.entries()) {
    const ctx = context(spec, index, seen, { history: [...history], ...extra(index) });
    const verdicts: Verdict[] = [];
    for (const check of defaultChecks()) {
      if (check.applies(ctx)) verdicts.push(...(await check.evaluate(ctx)));
    }
    out.push(verdicts);
    history.push({
      index,
      givenHash: 'given-test',
      observed: seen,
      verdicts,
      ledgerCheck: { ok: true, contradictions: [] },
      drift: [],
      pass: verdicts.every((item) => item.outcome === 'pass' || !item.gating),
    });
  }
  return out;
}

const gatingFailures = (perBlock: Verdict[][]) =>
  perBlock.flatMap((verdicts, index) =>
    verdicts.filter((item) => item.gating && item.outcome !== 'pass').map((item) => `${index} ${item.id}`),
  );

/** acme-new-customer-coverage as the Acme agent plays it, block by block. */
const coverageRun: Observed[] = [
  observed(
    "Hi, I'm the Acme Telecom sales assistant. I can check what is available at your address. What is the street address?",
    [],
    { runtime: { stages: [{ name: 'address' }] } },
  ),
  observed(
    'Fiber is not available at 88 Summit Avenue, Acmeville yet, but 5G home internet is. The plan available there: Acme Air 5G, up to 200 Mbps for $35 a month. Would you like Acme Air 5G?',
    [
      { label: 'coverage.check', input: { address: '88 Summit Avenue, Acmeville' } },
      { label: 'catalog.search', input: { category: 'home', address_id: 'addr-103' } },
    ],
    { runtime: { stages: [{ name: 'offer' }] } },
  ),
  observed('Sure. A sales advisor can call you back. What phone number should they use?', [], {
    runtime: { stages: [{ name: 'callback' }] },
  }),
  observed(
    'Done. A sales advisor will call you at +1 202 555 0131 about home internet at 88 Summit Avenue, Acmeville. Your reference is LEAD-10C86C.',
    [
      {
        label: 'notify_sales',
        input: {
          reason: 'callback',
          customer: { phone: '+12025550131' },
          summary: 'New customer at 88 Summit Avenue, Acmeville wants fiber. Offered: Acme Air 5G.',
        },
      },
    ],
    { runtime: { stages: [{ name: 'handover' }] } },
  ),
];
const notifyPayload = coverageRun[3]?.toolCalls[0]?.input;

/** acme-price-sheet as a code agent plays it: the workbook built, then a summary sheet added. */
const book = 'out/acme-price-sheet.xlsx';
const summarySheet = {
  ...PRICE_SHEET,
  Summary: [
    ['Category', 'Plan', 'Monthly price (USD)'],
    ['Mobile', 'Acme Mobile S', 15],
    ['Home', 'Acme Air 5G', 35],
  ],
};
const taskRun: Observed[] = [
  observed(
    'I wrote out/acme-price-sheet.xlsx with the sheets Mobile and Home, each with a yearly price formula.',
    [],
    {
      runtime: {
        skills: [{ name: 'xlsx' }],
        guards: [{ name: 'no_destructive_ops', verdict: 'pass' }],
        stages: [{ name: 'build_sheet' }],
      },
      executions: [
        { command: 'python build_sheet.py catalog.csv out/acme-price-sheet.xlsx', exitCode: 0 },
        { command: 'python check_sheet.py out/acme-price-sheet.xlsx', exitCode: 0 },
      ],
      workspaceDiff: { created: [book], changed: [], deleted: [] },
      cost: { usd: 0.12 },
      latencyMs: 42000,
    },
  ),
  observed('I added a Summary sheet with the cheapest plan of each category, Mobile first.', [], {
    runtime: {
      skills: [{ name: 'xlsx' }],
      guards: [{ name: 'no_destructive_ops', verdict: 'pass' }],
      stages: [{ name: 'add_summary' }],
    },
    executions: [{ command: 'python add_summary.py out/acme-price-sheet.xlsx', exitCode: 0 }],
    workspaceDiff: { created: [], changed: [book], deleted: [] },
    cost: { usd: 0.08 },
    latencyMs: 30000,
  }),
];

describe('defaultChecks', () => {
  it('returns every machine check once, in the order the runner applies them', () => {
    const list = defaultChecks();
    expect(list.map((check) => check.name)).toEqual(NAMES);
    expect(defaultChecks()).not.toBe(list);
    for (const check of list) {
      expect(typeof check.applies).toBe('function');
      expect(typeof check.evaluate).toBe('function');
    }
  });

  it('exports every check by name from the package', () => {
    const exported = Object.values(checks).filter(
      (value): value is Check => typeof value === 'object' && value !== null && 'evaluate' in value,
    );
    expect(new Set(exported.map((check) => check.name))).toEqual(new Set(NAMES));
  });

  it('passes acme-new-customer-coverage end to end, the end state included', async () => {
    const perBlock = await runAll(acme('acme-new-customer-coverage'), coverageRun, (index) =>
      index === 3 ? { endState: notifyPayload } : {},
    );
    expect(gatingFailures(perBlock)).toEqual([]);
    expect(perBlock.flat().length).toBeGreaterThan(60);
  });

  it('mutation: the agent searches the catalog before checking coverage; the run fails on that block only', async () => {
    const broken = [...coverageRun];
    const offer = coverageRun[1] as Observed;
    broken[1] = { ...offer, toolCalls: [...offer.toolCalls].reverse() };
    const perBlock = await runAll(acme('acme-new-customer-coverage'), broken, (index) =>
      index === 3 ? { endState: notifyPayload } : {},
    );
    expect(gatingFailures(perBlock)).toEqual(['1 tools.order']);
  });

  it('passes acme-price-sheet end to end with a reader for the workbook', async () => {
    const workbooks = [PRICE_SHEET, summarySheet];
    const perBlock = await runAll(acme('acme-price-sheet'), taskRun, (index) => ({
      artifacts: registry(fakeXlsx),
      readArtifact: files({ [book]: workbooks[index] }),
    }));
    expect(gatingFailures(perBlock)).toEqual([]);
    const ids = perBlock.flat().map((item) => item.id.split('.')[0]);
    for (const family of [
      'skills',
      'guards',
      'execution',
      'workspace',
      'safety',
      'artifacts',
      'budget',
      'stage',
    ]) {
      expect(ids).toContain(family);
    }
  });

  it('mutation: the summary step also rewrites catalog.csv; others_untouched and safety fail on that block', async () => {
    const broken = [...taskRun];
    const summary = taskRun[1] as Observed;
    broken[1] = { ...summary, workspaceDiff: { created: [], changed: [book, 'catalog.csv'], deleted: [] } };
    const perBlock = await runAll(acme('acme-price-sheet'), broken, (index) => ({
      artifacts: registry(fakeXlsx),
      readArtifact: files({ [book]: index === 0 ? PRICE_SHEET : summarySheet }),
    }));
    expect(gatingFailures(perBlock)).toEqual([
      '1 workspace.others_untouched',
      '1 safety.max_destructive_ops',
      '1 safety.confirm_before.overwrite',
    ]);
  });
});
