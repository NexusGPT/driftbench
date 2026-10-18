import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import {
  canonical,
  initialize,
  load,
  observed,
  type RawSpec,
  type RunRecord,
  run,
  scriptedAdapter,
} from '../../blocks/harness';
import { type Action, plantedAgent } from '../../blocks/kinds';
import { type BlocksProduct, need } from '../../blocks/product';
import type { C2Cause } from './causes';
import { type BankItem, c2, type ItemContext, said, show, type Tier, tok, unless } from './kit';

/**
 * Attribution, the evidence step, and the section registry and localize (docs/reference/block-contracts.md,
 * "Attribution", "Evidence names", "Section registry and localize"): when attributionOf answers at all, runs
 * unassigned with no failure, the rate written with its denominator, the badge's hash8 and the HTML badge, a fix
 * kept whole; blame's order R2 before R1, R3's disposition, a case-only change, the value facts on the verdict and
 * no extra agent call; computeEvidence's names, its read-only input, its subject tool and its file classes; init's
 * unique quotes and the link statuses localize counts.
 */

const FAMILY = 'c2-reports';
const ATTRIBUTION = 'packages/report/src/attribution.ts';
const SCORECARD = 'packages/report/src/scorecard.ts';
const BLAME = 'packages/checks/src/blame/attribute.ts';
const VALUES = 'packages/checks/src/blame/values.ts';
const EVIDENCE = 'packages/core/src/evidence/index.ts';
const SECTIONS_CLI = 'packages/cli/src/commands/radius-sections.ts';
const LOCALIZE = 'packages/core/src/radius/localize.ts';

type Probe = (ctx: ItemContext) => Promise<ReadonlyArray<string | undefined>>;
type Case = { id: string; tier: Tier; cause: C2Cause; component: string; title: string; run: Probe };

// ---------------------------------------------------------------------------------------------------------------
// attributionOf and the scorecard

type Summary = {
  agent?: { k?: number; n?: number };
  unassigned?: number;
  fixes?: unknown[];
  nonDefault?: string[];
};
type AttributionOf = (data: unknown, options?: Record<string, unknown>) => Summary | undefined;
const attributionOf = (product: BlocksProduct) =>
  need<AttributionOf>(product.report, 'report', 'attributionOf');

/** A spec of two blocks; the second fails its `must` when `failing`. */
function twoBlocks(ctx: ItemContext, tag: string): RawSpec {
  return {
    id: `spec-${tok(ctx, tag, 'spec', 8)}`,
    channel: 'chat',
    blocks: [0, 1].map((index) => ({
      id: `b${index}`,
      user: `[${tok(ctx, tag, 'marker', 8)}:${index}] Is the bike free?`,
      expect: { must: [`ok${index}`] },
    })),
  };
}

/** One real run of the two-block spec: both blocks pass, or the second fails. */
async function oneRun(ctx: ItemContext, tag: string, failing: boolean, runId: string): Promise<RunRecord> {
  const raw = twoBlocks(ctx, tag);
  const adapter = scriptedAdapter(ctx.product, (turn) => {
    const index = Number(/:(\d+)\]/.exec(turn.user)?.[1] ?? 0);
    return observed(failing && index === 1 ? 'Sorry.' : `Yes, ok${index}.`);
  });
  const record = await run(ctx.product, raw, adapter);
  record.runId = runId;
  return record;
}

/** The campaign data the report package reads: the campaign, its specs by id and hash, and the runs. */
function campaignData(ctx: ItemContext, tag: string, runs: RunRecord[]) {
  const validateSpec = need<(raw: unknown, path: string) => unknown>(
    ctx.product.core,
    'core',
    'validateSpec',
  );
  initialize(ctx.product);
  const specs = new Map(
    runs.map(
      (record) => [`${record.specId}@${record.specHash}`, validateSpec(twoBlocks(ctx, tag), 'c2')] as const,
    ),
  );
  return {
    campaign: {
      campaignId: 'c-c2',
      specs: runs.map((record) => ({ id: record.specId, hash: record.specHash })),
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 1,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-16T00:00:00.000Z',
    },
    specs,
    runs,
  };
}

/** Marks every failing gating verdict of a run with a diagnosis of `disposition`, as a run with blame writes one. */
function diagnose(record: RunRecord, disposition: string): void {
  for (const block of record.blocks) {
    const failing = block.verdicts.filter((verdict) => verdict.gating && verdict.outcome !== 'pass');
    if (failing.length === 0) continue;
    (block as unknown as { diagnoses: unknown[] }).diagnoses = failing.map((verdict) => ({
      verdictRef: verdict.id,
      disposition,
      rule: 'policy/blame:default@0a1b2c3d4e5f#planted',
      diagnostic: 'diagnostic:code-agent-liability@0a1b2c3d',
    }));
  }
}

const FIX = { fixLocation: 'skill.content', fixAction: 'Say the code.', blocks: 1, agentBlocks: 1 };
const HEX12 = (ctx: ItemContext, tag: string) =>
  Array.from(
    { length: 12 },
    (_, i) => '0123456789abcdef'[tok(ctx, tag, `hex${i}`, 1).charCodeAt(0) % 16],
  ).join('');

const ATTRIBUTION_CASES: Case[] = [
  {
    id: 'undefined-without-diagnosis-or-fix',
    tier: 2,
    cause: 'attribution-undefined',
    component: ATTRIBUTION,
    title:
      'attributionOf returns undefined for failing runs with no diagnosis and no fix plan, and a summary once a fix plan is given',
    run: async (ctx) => {
      const data = campaignData(ctx, 'a-undef', [await oneRun(ctx, 'a-undef', true, 'r0')]);
      const bare = attributionOf(ctx.product)(data, {});
      const planned = attributionOf(ctx.product)(data, { fixes: [FIX] });
      return [
        unless(
          bare === undefined,
          `with no diagnosis and no fix plan it should return undefined; it returned ${show(bare)}`,
        ),
        unless(planned !== undefined, 'with a fix plan it should return a summary; it returned undefined'),
      ];
    },
  },
  {
    id: 'defined-when-a-block-carries-a-diagnosis',
    tier: 3,
    cause: 'attribution-undefined',
    component: ATTRIBUTION,
    title:
      'attributionOf returns a summary when a block of a run carries a diagnosis, with no option given, and counts that run as failed for the agent',
    run: async (ctx) => {
      const record = await oneRun(ctx, 'a-carried', true, 'r0');
      diagnose(record, 'agent');
      const got = attributionOf(ctx.product)(campaignData(ctx, 'a-carried', [record]), {});
      return [
        unless(
          got !== undefined,
          'a block carries a diagnosis, so attributionOf should answer; it returned undefined',
        ),
        unless(
          got?.agent?.k === 0 && got?.agent?.n === 1,
          `the run fails for the agent: 0 of 1; the summary reads ${show(got?.agent)}`,
        ),
      ];
    },
  },
  {
    id: 'end-state-mismatch-is-unassigned',
    tier: 3,
    cause: 'attribution-unassigned-no-failure',
    component: ATTRIBUTION,
    title:
      'a run with no block failure whose end state does not match is unassigned and out of the agent rate, and the same run with a matching end state passes for the agent',
    run: async (ctx) => {
      const base = await oneRun(ctx, 'a-end', false, 'r0');
      const off = { ...structuredClone(base), runId: 'r1', endState: { match: false } } as RunRecord;
      const on = { ...structuredClone(base), runId: 'r2', endState: { match: true } } as RunRecord;
      const bad = attributionOf(ctx.product)(campaignData(ctx, 'a-end', [off]), { fixes: [FIX] });
      const good = attributionOf(ctx.product)(campaignData(ctx, 'a-end', [on]), { fixes: [FIX] });
      return [
        unless(
          bad?.unassigned === 1 && bad?.agent?.n === 0,
          `the mismatched run should be unassigned, out of the agent rate; the summary reads ${show({ unassigned: bad?.unassigned, agent: bad?.agent })}`,
        ),
        unless(
          good?.unassigned === 0 && good?.agent?.k === 1 && good?.agent?.n === 1,
          `the matching run passes for the agent; the summary reads ${show({ unassigned: good?.unassigned, agent: good?.agent })}`,
        ),
      ];
    },
  },
  {
    id: 'run-without-blocks-is-unassigned',
    tier: 3,
    cause: 'attribution-unassigned-no-failure',
    component: ATTRIBUTION,
    title:
      'a run with no blocks is unassigned and out of the agent rate, beside a passing run counted 1 of 1',
    run: async (ctx) => {
      const base = await oneRun(ctx, 'a-empty', false, 'r0');
      const empty = { ...structuredClone(base), runId: 'r1', blocks: [] } as RunRecord;
      const got = attributionOf(ctx.product)(campaignData(ctx, 'a-empty', [base, empty]), { fixes: [FIX] });
      return [
        unless(
          got?.unassigned === 1 && got?.agent?.k === 1 && got?.agent?.n === 1,
          `the empty run should be unassigned and the passing one 1 of 1; the summary reads ${show({ unassigned: got?.unassigned, agent: got?.agent })}`,
        ),
      ];
    },
  },
  {
    id: 'rate-written-with-its-denominator',
    tier: 3,
    cause: 'attribution-rate-text',
    component: SCORECARD,
    title:
      'the HTML scorecard writes the agent rate as 1 of 2 assigned runs; 1 unassigned for a passing run, an agent failure and an undiagnosed failure',
    run: async (ctx) => {
      const pass = await oneRun(ctx, 'a-text', false, 'r0');
      const agent = await oneRun(ctx, 'a-text', true, 'r1');
      const open = await oneRun(ctx, 'a-text', true, 'r2');
      diagnose(agent, 'agent');
      const buildScorecard = need<(data: unknown) => unknown>(ctx.product.report, 'report', 'buildScorecard');
      const renderHtml = need<(card: unknown) => string>(ctx.product.report, 'report', 'renderHtml');
      const html = renderHtml(buildScorecard(campaignData(ctx, 'a-text', [pass, agent, open])));
      const want = '1 of 2 assigned runs; 1 unassigned';
      return [
        unless(
          html.includes(want),
          `the scorecard should read "${want}"; it holds no such text (${html.length} characters)`,
        ),
      ];
    },
  },
];

const BADGE_CASES: Case[] = [
  {
    id: 'option-hash-written-as-hash8',
    tier: 3,
    cause: 'badge-hash8',
    component: ATTRIBUTION,
    title:
      'an object of the objects option with a 12 hex hash is written kind:id@hash8, its first 8 hex, and the default object not at all',
    run: async (ctx) => {
      const id = tok(ctx, 'b-option', 'id', 8);
      const hash = HEX12(ctx, 'b-option');
      const got = attributionOf(ctx.product)(
        campaignData(ctx, 'b-option', [await oneRun(ctx, 'b-option', true, 'r0')]),
        {
          fixes: [FIX],
          objects: [
            { kind: 'policy/blame', id, hash },
            { kind: 'check-set', id: 'default', hash: HEX12(ctx, 'b-option-default') },
          ],
        },
      );
      const want = [`policy/blame:${id}@${hash.slice(0, 8)}`];
      return [
        unless(
          canonical(got?.nonDefault) === canonical(want),
          `nonDefault should be ${show(want)}; it is ${show(got?.nonDefault)}`,
        ),
      ];
    },
  },
  {
    id: 'recorded-hash-written-as-hash8',
    tier: 3,
    cause: 'badge-hash8',
    component: ATTRIBUTION,
    title:
      'an object recorded in BlockResult.resolved with a 12 hex hash is written kind:id@hash8, its first 8 hex',
    run: async (ctx) => {
      const id = tok(ctx, 'b-record', 'id', 8);
      const hash = HEX12(ctx, 'b-record');
      const record = await oneRun(ctx, 'b-record', true, 'r0');
      (record.blocks[0] as unknown as { resolved: unknown }).resolved = {
        objects: [{ kind: 'check-set', id, hash }],
      };
      const got = attributionOf(ctx.product)(campaignData(ctx, 'b-record', [record]), { fixes: [FIX] });
      const want = [`check-set:${id}@${hash.slice(0, 8)}`];
      return [
        unless(
          canonical(got?.nonDefault) === canonical(want),
          `nonDefault should be ${show(want)}; it is ${show(got?.nonDefault)}`,
        ),
      ];
    },
  },
  {
    id: 'html-non-default-badge',
    tier: 3,
    cause: 'badge-html',
    component: SCORECARD,
    title:
      'the HTML scorecard of runs scored with a non-default object prints a non-default badge, and of runs scored with the default objects prints none',
    run: async (ctx) => {
      const page = async (id: string, tag: string) => {
        const record = await oneRun(ctx, tag, true, 'r0');
        diagnose(record, 'agent');
        (record.blocks[1] as unknown as { resolved: unknown }).resolved = {
          objects: [{ kind: 'policy/blame', id, hash: HEX12(ctx, tag) }],
        };
        const buildScorecard = need<(data: unknown) => unknown>(
          ctx.product.report,
          'report',
          'buildScorecard',
        );
        const renderHtml = need<(card: unknown) => string>(ctx.product.report, 'report', 'renderHtml');
        return renderHtml(buildScorecard(campaignData(ctx, tag, [record])));
      };
      const tuned = await page(tok(ctx, 'b-html', 'id', 8), 'b-html-a');
      const plain = await page('default', 'b-html-b');
      return [
        unless(
          /non-default/.test(tuned),
          'the page of runs scored with a non-default object holds no non-default badge',
        ),
        unless(
          !/non-default/.test(plain),
          'the page of runs scored with the default objects only holds a non-default badge',
        ),
      ];
    },
  },
  {
    id: 'fix-keeps-its-fields',
    tier: 2,
    cause: 'fix-fields-kept',
    component: ATTRIBUTION,
    title: 'each fix of the plan comes back with every field it was given, its free-text fixAction included',
    run: async (ctx) => {
      const fixes = [0, 1, 2].map((index) => ({
        fixLocation: ['skill.content', 'tool.contract', 'test'][index],
        fixAction: `${tok(ctx, 'b-fix', `a${index}`, 7)} the ${tok(ctx, 'b-fix', `b${index}`, 5)}.`,
        blocks: index + 2,
        agentBlocks: index,
        costClass: ['low', 'medium', 'high'][index],
        [tok(ctx, 'b-fix', 'key', 6)]: tok(ctx, 'b-fix', `v${index}`, 8),
      }));
      const got = attributionOf(ctx.product)(
        campaignData(ctx, 'b-fix', [await oneRun(ctx, 'b-fix', true, 'r0')]),
        {
          fixes: structuredClone(fixes),
        },
      );
      return [
        unless(
          canonical(got?.fixes) === canonical(fixes),
          `the fixes should come back as given: ${show(fixes[0])}; got ${show(got?.fixes?.[0])}`,
        ),
      ];
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Blame on value facts, through a real run under the code-agent-liability diagnostic

type Diagnosis = { verdictRef?: string; rule?: string; disposition?: string; inherits?: string };

type ValueBlock = {
  user: string;
  value: string;
  error?: string;
  schema?: Record<string, unknown>;
  reply?: string;
  /** The compare mode of the block's tool expectation. */
  compare?: string;
};

/** Blocks each calling its own tool once with an email; returns the run, the block ids and the planted agent. */
async function valueRun(
  ctx: ItemContext,
  tag: string,
  golds: string[],
  blocks: ValueBlock[],
  diagnostics = true,
) {
  const actions = new Map<string, Action>();
  const schemas: Record<string, unknown> = {};
  const ids: string[] = [];
  const raws = blocks.map((block, index) => {
    const marker = tok(ctx, tag, `marker${index}`, 8);
    const tool = `customer.find${index}`;
    const id = tok(ctx, tag, `block${index}`, 6);
    ids.push(id);
    if (block.schema) schemas[tool] = block.schema;
    actions.set(marker, {
      reply: block.reply ?? 'Let me look that up.',
      calls: [
        {
          label: tool,
          input: { email: block.value },
          ...(block.error ? { error: block.error } : { output: { found: false } }),
        },
      ],
    });
    return {
      id,
      user: `${marker} ${block.user}`,
      expect: {
        tools: [
          {
            label: tool,
            count: 1,
            input: { email: golds[index] },
            ...(block.compare ? { compare: block.compare } : {}),
          },
        ],
      },
    };
  });
  const raw: RawSpec = {
    id: `spec-${tok(ctx, tag, 'spec', 8)}`,
    channel: 'chat',
    ...(diagnostics ? { uses: { diagnostics: ['code-agent-liability'] } } : {}),
    ...(Object.keys(schemas).length > 0 ? { metadata: { tool_schemas: schemas } } : {}),
    blocks: raws,
  };
  const agent = plantedAgent(ctx.product, 'normal', actions, { scratch: ctx.scratch });
  const record = await run(ctx.product, raw, agent.adapter);
  return { record, ids, agent };
}

/** The item and disposition of the root diagnoses of a block. */
function blameOf(record: RunRecord, blockId: string) {
  const block = record.blocks.find((each) => each.blockId === blockId) as unknown as
    | { diagnoses?: Diagnosis[] }
    | undefined;
  const roots = (block?.diagnoses ?? []).filter((one) => one.inherits === undefined);
  return roots.map((one) => ({ item: (one.rule ?? '').split('#')[1], disposition: one.disposition }));
}

const emailOf = (ctx: ItemContext, tag: string, slot: string) => `${tok(ctx, tag, slot, 8)}@larkspur.example`;

const BLAME_CASES: Case[] = [
  {
    id: 'r2-before-r1',
    tier: 4,
    cause: 'blame-facts',
    component: BLAME,
    title:
      'a value the agent changed from what the user gave, failed by the as-given rung and outside the enum the tool states, is blamed on R2, while a case-only change outside the enum is R1',
    run: async (ctx) => {
      const golds = [emailOf(ctx, 'bl-order', 'g0'), emailOf(ctx, 'bl-order', 'g1')];
      const enumOf = (gold: string) => ({
        type: 'object',
        properties: { email: { type: 'string', enum: [gold, `${gold}.alt`] } },
      });
      const { record, ids } = await valueRun(ctx, 'bl-order', golds, [
        {
          user: `My email is ${golds[0]}.`,
          value: `${golds[0]}x`,
          schema: enumOf(golds[0] as string),
          compare: 'as_given',
        },
        {
          user: `My email is ${golds[1]}.`,
          value: (golds[1] as string).toUpperCase(),
          schema: enumOf(golds[1] as string),
        },
      ]);
      const altered = blameOf(record, ids[0] as string);
      const caseOnly = blameOf(record, ids[1] as string);
      return [
        unless(
          altered.length > 0 && altered.every((one) => one.item === 'R2' && one.disposition === 'agent'),
          `the altered value should be R2, agent, whatever the contract says; got ${show(altered)}`,
        ),
        unless(
          caseOnly.length > 0 && caseOnly.every((one) => one.item === 'R1'),
          `the case-only value outside the enum should be R1; got ${show(caseOnly)}`,
        ),
      ];
    },
  },
  {
    id: 'r3-disposition-by-next-action',
    tier: 4,
    cause: 'blame-r3-disposition',
    component: BLAME,
    title:
      'a verbatim value the tool refused with no stated format is R3: setup when the agent then asked the user, shared when it went on',
    run: async (ctx) => {
      const golds = [emailOf(ctx, 'bl-r3', 'g0'), emailOf(ctx, 'bl-r3', 'g1')];
      const given = golds.map((gold) => gold.toUpperCase());
      const { record, ids } = await valueRun(ctx, 'bl-r3', golds, [
        {
          user: `My email is ${given[0]}.`,
          value: given[0] as string,
          error: 'no customer with that email',
          reply: 'Which email address should I use?',
        },
        {
          user: `My email is ${given[1]}.`,
          value: given[1] as string,
          error: 'no customer with that email',
          reply: 'Let me look that up.',
        },
      ]);
      const asked = blameOf(record, ids[0] as string);
      const went = blameOf(record, ids[1] as string);
      return [
        unless(
          asked.length > 0 && asked.every((one) => one.item === 'R3' && one.disposition === 'setup'),
          `after a question to the user, R3 is setup; got ${show(asked)}`,
        ),
        unless(
          went.length > 0 && went.every((one) => one.item === 'R3' && one.disposition === 'shared'),
          `after going on, R3 is shared; got ${show(went)}`,
        ),
      ];
    },
  },
  {
    id: 'case-only-is-no-altered-kind',
    tier: 4,
    cause: 'blame-facts',
    component: BLAME,
    title:
      'a value the agent wrote in another case than the user, refused with no stated format, is neither R2 nor R3, while an altered value is R2',
    run: async (ctx) => {
      const golds = [emailOf(ctx, 'bl-case', 'g0'), emailOf(ctx, 'bl-case', 'g1')];
      const { record, ids } = await valueRun(ctx, 'bl-case', golds, [
        {
          user: `My email is ${golds[0]}.`,
          value: (golds[0] as string).toUpperCase(),
          error: 'no customer with that email',
        },
        { user: `My email is ${golds[1]}.`, value: `${golds[1]}x`, error: 'no customer with that email' },
      ]);
      const caseOnly = blameOf(record, ids[0] as string);
      const altered = blameOf(record, ids[1] as string);
      return [
        unless(
          altered.length > 0 && altered.every((one) => one.item === 'R2'),
          `the altered value should be R2; got ${show(altered)}`,
        ),
        unless(
          caseOnly.length > 0 && caseOnly.every((one) => !['R2', 'R3', 'R1', 'R2b'].includes(one.item ?? '')),
          `case_only is neither verbatim nor an altered kind, so no value rule fires; got ${show(caseOnly)}`,
        ),
      ];
    },
  },
  {
    id: 'value-facts-on-the-verdict',
    tier: 4,
    cause: 'blame-facts-in-verdict',
    component: VALUES,
    title:
      'the verdict of a failing tool input holds its value facts with a rung family, source user and change altered, or change verbatim for a copy',
    run: async (ctx) => {
      const golds = [emailOf(ctx, 'bl-facts', 'g0'), emailOf(ctx, 'bl-facts', 'g1')];
      const given = (golds[1] as string).toUpperCase();
      const { record, ids } = await valueRun(ctx, 'bl-facts', golds, [
        { user: `My email is ${golds[0]}.`, value: `${golds[0]}x`, error: 'no customer with that email' },
        { user: `My email is ${given}.`, value: given, error: 'no customer with that email' },
      ]);
      const factOf = (index: number) => {
        const block = record.blocks.find((each) => each.blockId === ids[index]);
        const verdict = block?.verdicts.find((each) => each.id === `tools.customer.find${index}.input.email`);
        const found: Record<string, unknown>[] = [];
        const walk = (value: unknown) => {
          if (Array.isArray(value)) value.forEach(walk);
          else if (value !== null && typeof value === 'object') {
            const object = value as Record<string, unknown>;
            if ('source' in object && 'change' in object) found.push(object);
            Object.values(object).forEach(walk);
          }
        };
        walk(verdict);
        return { verdict, fact: found[0] };
      };
      const a = factOf(0);
      const b = factOf(1);
      const family = /^rung(1|2|2b|3|4)$/;
      return [
        unless(
          a.fact?.source === 'user' && a.fact.change === 'altered',
          `the altered value's verdict should hold source user and change altered; it holds ${show(a.verdict)}`,
        ),
        unless(
          family.test(String(a.fact?.rung ?? '')),
          `the value fact should name its rung family (rung1 to rung4); it names ${show(a.fact?.rung)}`,
        ),
        unless(
          b.fact?.source === 'user' && b.fact.change === 'verbatim',
          `the copied value's verdict should hold source user and change verbatim; it holds ${show(b.fact ?? b.verdict)}`,
        ),
      ];
    },
  },
  {
    id: 'blame-calls-no-agent',
    tier: 2,
    cause: 'blame-no-calls',
    component: BLAME,
    title:
      'a run under the code-agent-liability diagnostic sends each block to the agent once, as the same run without it does',
    run: async (ctx) => {
      const golds = [emailOf(ctx, 'bl-calls', 'g0'), emailOf(ctx, 'bl-calls', 'g1')];
      const blocks = [
        { user: `My email is ${golds[0]}.`, value: `${golds[0]}x`, error: 'no customer with that email' },
        { user: `My email is ${golds[1]}.`, value: golds[1] as string },
      ];
      const blamed = await valueRun(ctx, 'bl-calls', golds, blocks, true);
      const plain = await valueRun(ctx, 'bl-calls', golds, blocks, false);
      return [
        unless(
          blamed.agent.delivered().length === 2,
          `with blame the agent was sent ${blamed.agent.delivered().length} turns for 2 blocks`,
        ),
        unless(
          plain.agent.delivered().length === 2,
          `without blame the agent was sent ${plain.agent.delivered().length} turns for 2 blocks`,
        ),
      ];
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------
// The evidence step

type Obj = Record<string, unknown>;
type Evidence = { computeEvidence(input: unknown, names?: readonly string[]): Record<string, unknown> };
const evidence = (product: BlocksProduct) => need<Evidence>(product.core, 'core', 'evidence');

const machine = (id: string): Obj => ({
  id,
  name: id.split('.')[0],
  kind: 'machine',
  gating: true,
  outcome: 'fail',
  evidence: `${id} failed`,
});
type Call = { label: string; input?: Obj; output?: unknown; error?: string };
const stored = (calls: Call[], verdicts: Obj[], text = 'Done.'): Obj => ({
  observed: observed(text, calls),
  verdicts,
});
const inputOf = (block: Obj, extra: Obj = {}): Obj => ({
  block,
  verdict: (block.verdicts as Obj[])[0],
  ...extra,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const each of Object.values(value as Record<string, unknown>)) deepFreeze(each);
    Object.freeze(value);
  }
  return value;
}

/** Calls computeEvidence; a throw is the product's answer, returned as text. */
function compute(
  product: BlocksProduct,
  input: unknown,
  names?: readonly string[],
): { got?: Record<string, unknown>; threw?: string } {
  try {
    return { got: evidence(product).computeEvidence(input, names) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('the product has no export')) throw error;
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

const tool = (ctx: ItemContext, tag: string, slot = 'tool') => `t${tok(ctx, tag, slot, 6)}`;

const STEP_CASES: Case[] = [
  {
    id: 'no-names-computes-every-name',
    tier: 2,
    cause: 'step-names',
    component: EVIDENCE,
    title:
      'computeEvidence with no names, on an input of only the block and the verdict, answers verdict_check, verdict_kind and rule_mechanical and leaves out the unknown tests_fail_reverted',
    run: async (ctx) => {
      const t = tool(ctx, 'e-all');
      const { got, threw } = compute(
        ctx.product,
        inputOf(stored([{ label: t }], [machine(`tools.${t}.count`)])),
      );
      return [
        unless(threw === undefined, `the call threw: ${threw}`),
        unless(
          got?.verdict_check === 'tools' && got?.verdict_kind === 'machine' && got?.rule_mechanical === true,
          `every known name should be computed; got ${show(got)}`,
        ),
        unless(
          got !== undefined && !Object.hasOwn(got, 'tests_fail_reverted'),
          `tests_fail_reverted is unknown with nothing stored, so absent; got ${show(got?.tests_fail_reverted)}`,
        ),
      ];
    },
  },
  {
    id: 'only-known-names-asked',
    tier: 2,
    cause: 'step-names',
    component: EVIDENCE,
    title:
      'asked for verdict_kind and tests_fail_reverted with nothing stored, computeEvidence returns verdict_kind alone',
    run: async (ctx) => {
      const t = tool(ctx, 'e-known');
      const { got, threw } = compute(
        ctx.product,
        inputOf(stored([{ label: t }], [machine(`tools.${t}.count`)])),
        ['verdict_kind', 'tests_fail_reverted'],
      );
      return [
        unless(threw === undefined, `the call threw: ${threw}`),
        unless(
          canonical(Object.keys(got ?? {}).sort()) === canonical(['verdict_kind']),
          `the answer should hold verdict_kind only; it holds ${show(Object.keys(got ?? {}))}`,
        ),
      ];
    },
  },
  {
    id: 'unregistered-name-throws',
    tier: 2,
    cause: 'step-names',
    component: EVIDENCE,
    title:
      'asked for a name no provider registers, computeEvidence throws and lists the known names, and asked for a known one answers',
    run: async (ctx) => {
      const t = tool(ctx, 'e-throw');
      const input = inputOf(stored([{ label: t }], [machine(`tools.${t}.count`)]));
      const name = tok(ctx, 'e-throw', 'name', 9);
      const bad = compute(ctx.product, input, [name]);
      const good = compute(ctx.product, input, ['verdict_check']);
      return [
        unless(
          good.threw === undefined && good.got?.verdict_check === 'tools',
          `a known name should answer; got ${show(good)}`,
        ),
        unless(
          bad.threw !== undefined,
          `the name ${name} should be refused with a throw; it answered ${show(bad.got)}`,
        ),
        unless(
          /verdict_check/.test(bad.threw ?? ''),
          `the refusal should list the known names; it reads: ${(bad.threw ?? '').slice(0, 200)}`,
        ),
      ];
    },
  },
  {
    id: 'frozen-input-same-answer',
    tier: 3,
    cause: 'step-input-only',
    component: EVIDENCE,
    title:
      'computeEvidence on a deeply frozen input answers without a throw, and the same as on a fresh copy',
    run: async (ctx) => {
      const t = tool(ctx, 'e-frozen');
      const build = () =>
        inputOf(
          stored(
            [{ label: t, input: { email: 'x' }, error: 'refused' }],
            [machine(`tools.${t}.input.email`)],
            'Which email?',
          ),
          {
            values: [{ tool: t, field: 'email', value: 'x', gold: 'y' }],
            user: 'My email is y.',
          },
        );
      const fresh = compute(ctx.product, build());
      const frozen = compute(ctx.product, deepFreeze(build()));
      return [
        unless(
          frozen.threw === undefined,
          `a frozen input should be read, never written; the call threw: ${frozen.threw}`,
        ),
        unless(
          canonical(frozen.got) === canonical(fresh.got),
          `the frozen input gave another answer: ${show(frozen.got)} against ${show(fresh.got)}`,
        ),
      ];
    },
  },
  {
    id: 'subject-tool-from-first-value-fact',
    tier: 3,
    cause: 'step-subject',
    component: EVIDENCE,
    title:
      'tool_failed reads the tool of the first value fact before the tool the verdict id names: true when that tool errored, false with no fact',
    run: async (ctx) => {
      const [t, u] = [tool(ctx, 'e-subject', 't'), tool(ctx, 'e-subject', 'u')];
      const block = stored(
        [
          { label: t, input: { email: 'a' }, output: { found: 1 } },
          { label: u, input: { email: 'a' }, error: 'refused' },
        ],
        [machine(`tools.${t}.input.email`)],
      );
      const withFact = compute(
        ctx.product,
        inputOf(block, { values: [{ tool: u, field: 'email', value: 'a', gold: 'b' }] }),
        ['tool_failed'],
      );
      const without = compute(ctx.product, inputOf(block), ['tool_failed']);
      return [
        unless(
          withFact.got?.tool_failed === true,
          `the first value fact names ${u}, whose call errored: tool_failed is true; got ${show(withFact)}`,
        ),
        unless(
          without.got?.tool_failed === false,
          `with no fact the subject is ${t}, whose call was clean: false; got ${show(without)}`,
        ),
      ];
    },
  },
  {
    id: 'label-with-dots',
    tier: 3,
    cause: 'step-subject',
    component: EVIDENCE,
    title:
      'a verdict tools.<a>.<b>.count names the tool <a>.<b>: tool_failed is true when that tool errored and false when only <a> did',
    run: async (ctx) => {
      const head = tool(ctx, 'e-dots', 'a');
      const label = `${head}.${tok(ctx, 'e-dots', 'b', 5)}`;
      const dotted = compute(
        ctx.product,
        inputOf(stored([{ label, error: 'refused' }], [machine(`tools.${label}.count`)])),
        ['tool_failed'],
      );
      const other = compute(
        ctx.product,
        inputOf(
          stored(
            [
              { label: head, error: 'refused' },
              { label, output: { ok: true } },
            ],
            [machine(`tools.${label}.count`)],
          ),
        ),
        ['tool_failed'],
      );
      return [
        unless(
          dotted.got?.tool_failed === true,
          `the call of ${label} errored: tool_failed is true; got ${show(dotted)}`,
        ),
        unless(
          other.got?.tool_failed === false,
          `only ${head} errored, ${label} was clean: false; got ${show(other)}`,
        ),
      ];
    },
  },
  {
    id: 'skill-path-at-any-depth',
    tier: 3,
    cause: 'step-paths',
    component: EVIDENCE,
    title:
      'an atom file under <folder>/<folder>/skills/<name>/ belongs to the skill <name>, and a file under no skills/ folder to none',
    run: async (ctx) => {
      const skill = `s${tok(ctx, 'e-depth', 'skill', 6)}`;
      const atomId = `a.${tok(ctx, 'e-depth', 'atom', 8)}`;
      const at = (file: string) =>
        compute(
          ctx.product,
          inputOf(stored([], [machine('must.0')]), {
            ruleAtoms: [atomId],
            atoms: [{ id: atomId, kind: 'rule', provenance: { file, startLine: 3 } }],
          }),
          ['rule_skill'],
        );
      const deep = at(
        `${tok(ctx, 'e-depth', 'p', 5)}/${tok(ctx, 'e-depth', 'q', 5)}/skills/${skill}/notes/${tok(ctx, 'e-depth', 'f', 5)}.md`,
      );
      const none = at(`${tok(ctx, 'e-depth', 'p', 5)}/kills/${skill}/${tok(ctx, 'e-depth', 'f', 5)}.md`);
      return [
        unless(
          deep.got?.rule_skill === skill,
          `the file sits in skills/${skill}/ at depth 3: rule_skill is ${skill}; got ${show(deep)}`,
        ),
        unless(
          deep.got !== undefined && none.got !== undefined && !Object.hasOwn(none.got, 'rule_skill'),
          `a file outside every skill folder has no rule_skill; got ${show(none)}`,
        ),
      ];
    },
  },
  {
    id: 'main-file-classes',
    tier: 4,
    cause: 'step-paths',
    component: EVIDENCE,
    title:
      'a pointer to a reference forces it from a SKILL.md body or a core file, and never from a file under agents/ or guards/',
    run: async (ctx) => {
      const skill = `s${tok(ctx, 'e-main', 'skill', 6)}`;
      const ref = `.claude/skills/${skill}/references/${tok(ctx, 'e-main', 'ref', 6)}.md`;
      const [a, p] = [`a.${tok(ctx, 'e-main', 'a', 8)}`, `a.${tok(ctx, 'e-main', 'p', 8)}`];
      const from = (file: string) =>
        compute(
          ctx.product,
          inputOf(stored([], [machine('must.0')]), {
            ruleAtoms: [a],
            atoms: [
              { id: a, kind: 'rule', provenance: { file: ref, startLine: 3 } },
              { id: p, kind: 'reference', provenance: { file, startLine: 5 }, fields: { path: ref } },
            ],
          }),
          ['ref_forced'],
        ).got?.ref_forced;
      const cases: [string, boolean][] = [
        [`.claude/skills/${skill}/SKILL.md`, true],
        [`${tok(ctx, 'e-main', 'core', 6).toUpperCase()}.md`, true],
        [`.claude/agents/${tok(ctx, 'e-main', 'helper', 6)}.md`, false],
        [`.claude/guards/${tok(ctx, 'e-main', 'guard', 6)}.py`, false],
      ];
      return cases.map(([file, want]) => {
        const got = from(file);
        return unless(
          got === want,
          `a pointer from ${file} should give ref_forced ${want}; got ${show(got)}`,
        );
      });
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Section registry and localize

async function init(ctx: ItemContext, tag: string, text: string) {
  const dir = join(ctx.scratch, `c2-${tok(ctx, tag, 'dir', 8)}`);
  mkdirSync(dir, { recursive: true });
  const promptPath = join(dir, 'prompt.md');
  writeFileSync(promptPath, text);
  const out = join(dir, 'prompt.sections.yaml');
  const result = await ctx.product.cli(
    ['radius', 'sections', 'init', promptPath, '--id', 'larkspur', '--prompt-version', 'v1', '--out', out],
    dir,
  );
  return { result, dir, promptPath, out };
}

const title = (ctx: ItemContext, tag: string, slot: string) => {
  const raw = tok(ctx, tag, slot, 7);
  return `${raw[0]?.toUpperCase()}${raw.slice(1)}`;
};

const REGISTRY_CASES: Case[] = [
  {
    id: 'init-two-identical-sections',
    tier: 3,
    cause: 'init-unique-quote',
    component: SECTIONS_CLI,
    title:
      'init exits 2 on a prompt of two sections with the same heading and the same body, and exits 0 once one body differs',
    run: async (ctx) => {
      const head = title(ctx, 'r-twin', 'head');
      const [one, two] = [tok(ctx, 'r-twin', 'one', 9), tok(ctx, 'r-twin', 'two', 9)];
      const same = await init(
        ctx,
        'r-twin-a',
        `## ${head}\n\nSay ${one} when asked.\n\n## ${head}\n\nSay ${one} when asked.\n\n`,
      );
      const differ = await init(
        ctx,
        'r-twin-b',
        `## ${head}\n\nSay ${one} when asked.\n\n## ${head}\n\nSay ${two} when asked.\n\n`,
      );
      return [
        unless(
          differ.result.code === 0,
          `two sections with different bodies should init (exit 0); it exited ${differ.result.code}: ${said(differ.result).slice(0, 200)}`,
        ),
        unless(
          same.result.code === 2,
          `two identical sections hold no unique quote, so init exits 2; it exited ${same.result.code}: ${said(same.result).slice(0, 200)}`,
        ),
      ];
    },
  },
  {
    id: 'init-section-inside-another',
    tier: 4,
    cause: 'init-unique-quote',
    component: SECTIONS_CLI,
    title:
      'init exits 2 when the whole text of a section recurs inside a later section, and exits 0 once the later heading differs',
    run: async (ctx) => {
      const [head, other] = [title(ctx, 'r-inside', 'head'), title(ctx, 'r-inside', 'other')];
      const [one, two] = [tok(ctx, 'r-inside', 'one', 9), tok(ctx, 'r-inside', 'two', 9)];
      const body = `Say ${one} when asked.`;
      const inside = await init(
        ctx,
        'r-inside-a',
        `## ${head}\n\n${body}\n\n## ${head}\n\n${body}\n\nThen say ${two}.\n\n`,
      );
      const apart = await init(
        ctx,
        'r-inside-b',
        `## ${head}\n\n${body}\n\n## ${other}\n\n${body}\n\nThen say ${two}.\n\n`,
      );
      return [
        unless(
          apart.result.code === 0,
          `with another heading every section holds a unique quote (exit 0); it exited ${apart.result.code}: ${said(apart.result).slice(0, 200)}`,
        ),
        unless(
          inside.result.code === 2,
          `the first section's text recurs in the second, so it holds no unique quote and init exits 2; it exited ${inside.result.code}: ${said(inside.result).slice(0, 200)}`,
        ),
      ];
    },
  },
];

type Ranked = { section?: string; score?: number };

/**
 * One stored campaign of one spec: block 1 fails, linked `declared` to the planted section; every other block
 * passes, linked to the other sections; the decoy section is linked to the failing block with `status`.
 */
async function localize(ctx: ItemContext, tag: string, status: string, json = true) {
  const sectionTitles = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map(
    (each) => `${each} ${tok(ctx, tag, each, 4)}`,
  );
  const text = `${sectionTitles.map((each, index) => `## ${each}\n\nRule ${index}: say ${tok(ctx, tag, `rule${index}`, 8)} when asked.\n`).join('\n')}`;
  const made = await init(ctx, tag, text);
  if (made.result.code !== 0)
    return { problem: `init exited ${made.result.code}: ${said(made.result).slice(0, 160)}` };
  const registry = parse(readFileSync(made.out, 'utf8')) as {
    sections: { id: string; title?: string; scope?: string }[];
  };
  registry.sections = registry.sections.map((section) => ({ ...section, scope: 'local' }));
  writeFileSync(made.out, stringify(registry));
  const ids = registry.sections.map((section) => section.id);
  if (ids.length < 4) return { problem: `init wrote ${ids.length} sections for 4 headings` };
  const [planted, decoy, ...rest] = ids as [string, string, ...string[]];
  const link = (block: string, section: string, linkStatus: string) => ({
    block,
    to: { kind: 'prompt_section', prompt: 'larkspur', section },
    status: linkStatus,
  });
  const raw: RawSpec = {
    id: `spec-${tok(ctx, tag, 'spec', 8)}`,
    channel: 'chat',
    metadata: {
      links: [
        link('b0', rest[0] as string, 'declared'),
        link('b1', planted, 'declared'),
        link('b1', decoy, status),
        link('b2', rest[1] ?? (rest[0] as string), 'declared'),
      ],
    },
    blocks: [0, 1, 2].map((index) => ({
      id: `b${index}`,
      user: `[${tok(ctx, tag, 'm', 8)}:${index}] Question ${index}.`,
      expect: { must: [`ok-${index}`] },
    })),
  };
  const storePath = join(made.dir, 'store.db');
  const openStore = need<(path: string) => Record<string, (...args: unknown[]) => Promise<unknown>>>(
    ctx.product.store,
    'store',
    'openStore',
  );
  const store = openStore(storePath);
  try {
    const validateSpec = need<(raw: unknown, path: string) => { spec: { id: string }; hash: string }>(
      ctx.product.core,
      'core',
      'validateSpec',
    );
    load(ctx.product, raw);
    const loaded = validateSpec(raw, 'c2-localize');
    await (store.putSpec as (spec: unknown) => Promise<void>)(loaded);
    writeFileSync(join(made.dir, `${raw.id}.yaml`), stringify(raw));
    await (store.putCampaign as (campaign: unknown) => Promise<void>)({
      campaignId: 'c-localize',
      specs: [{ id: loaded.spec.id, hash: loaded.hash }],
      targets: [{ adapter: 'function' }],
      modes: ['F'],
      repeats: { T: 0, F: 1, P: 0 },
      budgetUsd: 1,
      judge: { mode: 'system1', judges: [] },
      createdAt: '2026-10-16T00:00:00.000Z',
    });
    const behave = (turn: { user: string }) => {
      const index = Number(/:(\d+)\] Question/.exec(turn.user)?.[1] ?? 0);
      return observed(index === 1 ? 'Sorry.' : `Answer ok-${index}.`);
    };
    await run(ctx.product, raw, scriptedAdapter(ctx.product, behave), { store, campaignId: 'c-localize' });
  } finally {
    await (store.close as () => Promise<void>)();
  }
  const result = await ctx.product.cli(
    [
      'radius',
      'localize',
      join(made.dir, `${raw.id}.yaml`),
      '--store',
      storePath,
      '--campaign',
      'c-localize',
      '--sections',
      made.out,
      ...(json ? ['--json'] : []),
    ],
    made.dir,
  );
  let ranked: Ranked[] = [];
  if (json) {
    try {
      const parsed = JSON.parse(result.out) as {
        localization?: { sections?: Ranked[] };
        sections?: Ranked[];
      };
      ranked = parsed.localization?.sections ?? parsed.sections ?? [];
    } catch {
      return {
        problem: `localize --json printed no JSON (exit ${result.code}): ${said(result).slice(0, 160)}`,
      };
    }
  }
  return { result, ranked, planted, decoy };
}

const scoreOf = (ranked: Ranked[], section: string) => ranked.find((each) => each.section === section)?.score;

const LOCALIZE_CASES: Case[] = [
  {
    id: 'stale-link-adds-nothing',
    tier: 4,
    cause: 'localize-stale',
    component: LOCALIZE,
    title:
      'a section linked to the failing block only by a stale link scores below the section its declared link names, and the stale link is reported',
    run: async (ctx) => {
      const out = await localize(ctx, 'z-stale', 'stale');
      if ('problem' in out) return [out.problem];
      const text = await localize(ctx, 'z-stale-text', 'stale', false);
      if ('problem' in text) return [text.problem];
      const planted = scoreOf(out.ranked, out.planted);
      const decoy = scoreOf(out.ranked, out.decoy);
      return [
        unless(
          out.result.code === 0,
          `localize should exit 0 with a ranking; it exited ${out.result.code}: ${said(out.result).slice(0, 160)}`,
        ),
        unless(
          out.ranked[0]?.section === out.planted,
          `the planted section should rank first; the ranking is ${show(out.ranked.slice(0, 3))}`,
        ),
        unless(
          decoy === undefined || (planted !== undefined && decoy < planted),
          `the stale link adds nothing, so ${out.decoy} scores below ${planted}; it scores ${decoy}`,
        ),
        unless(
          /stale/i.test(said(text.result)),
          `the stale link should be reported as advisory; the output reads: ${said(text.result).slice(0, 200)}`,
        ),
      ];
    },
  },
  {
    id: 'attributed-link-covers',
    tier: 3,
    cause: 'localize-covers',
    component: LOCALIZE,
    title:
      'a section linked to the failing block by an attributed link covers it: it scores as high as the section of the declared link',
    run: async (ctx) => {
      const out = await localize(ctx, 'z-attributed', 'attributed');
      if ('problem' in out) return [out.problem];
      const planted = scoreOf(out.ranked, out.planted);
      const decoy = scoreOf(out.ranked, out.decoy);
      return [
        unless(out.result.code === 0, `localize should exit 0; it exited ${out.result.code}`),
        unless(
          planted !== undefined && planted > 0 && decoy === planted,
          `the attributed link counts like the declared one: ${out.decoy} should score ${planted}; it scores ${decoy}`,
        ),
      ];
    },
  },
  {
    id: 'verified-link-covers',
    tier: 3,
    cause: 'localize-covers',
    component: LOCALIZE,
    title:
      'a section linked to the failing block by a verified link covers it: it scores as high as the section of the declared link',
    run: async (ctx) => {
      const out = await localize(ctx, 'z-verified', 'verified');
      if ('problem' in out) return [out.problem];
      const planted = scoreOf(out.ranked, out.planted);
      const decoy = scoreOf(out.ranked, out.decoy);
      return [
        unless(out.result.code === 0, `localize should exit 0; it exited ${out.result.code}`),
        unless(
          planted !== undefined && planted > 0 && decoy === planted,
          `the verified link counts like the declared one: ${out.decoy} should score ${planted}; it scores ${decoy}`,
        ),
      ];
    },
  },
];

const LEVELS: Record<string, number> = {
  attribution: 5,
  badge: 5,
  blame: 5,
  step: 5,
  registry: 6,
  localize: 6,
};

function items(group: string, cases: readonly Case[]): BankItem[] {
  return cases.map((each) =>
    c2(
      FAMILY,
      `c2.reports.${group}.${each.id}`,
      each.tier,
      LEVELS[group] ?? 5,
      each.component,
      each.cause,
      each.title,
      each.run,
    ),
  );
}

/** The items of the Attribution, Evidence names (the evidence step) and Section registry and localize sections. */
export function reportsItems(): BankItem[] {
  return [
    ...items('attribution', ATTRIBUTION_CASES),
    ...items('badge', BADGE_CASES),
    ...items('blame', BLAME_CASES),
    ...items('step', STEP_CASES),
    ...items('registry', REGISTRY_CASES),
    ...items('localize', LOCALIZE_CASES),
  ];
}
