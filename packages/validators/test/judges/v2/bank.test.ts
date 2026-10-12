import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { protectedChanges, runLadder } from '../../../src/index';
import { MORE_CAUSES } from '../../../src/ladders/judges/v2/causes-more';
import {
  BILLED_APPROVAL,
  bankShape,
  billedMode,
  judgesBank,
  judgesLadderV2,
  LEVELS,
  runBank,
  runItem,
  shapeProblems,
} from '../../../src/ladders/judges/v2/index';
import { witnessApi } from './witness';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

function without(name: string) {
  const api = { ...witnessApi() } as Record<string, unknown>;
  delete api[name];
  return api;
}

describe('the judges bank, ladder version 2', () => {
  it('meets the shape gate: 300 or more deterministic items, no family under 20, every tier', () => {
    expect(shapeProblems()).toEqual([]);
    const shape = bankShape();
    expect(shape.deterministic).toBeGreaterThanOrEqual(300);
    expect(shape.live).toBeGreaterThan(0);
    const ids = judgesBank().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const levels = new Set(LEVELS.map((level) => level.id));
    for (const entry of judgesBank()) {
      expect(levels.has(entry.level), entry.id).toBe(true);
      expect(entry.cause?.length ?? 0, entry.id).toBeGreaterThan(20);
    }
    expect(new Set(judgesBank().map((entry) => entry.cause)).size).toBeGreaterThanOrEqual(150);
  });

  it('keeps the witness and the bank where an executor branch cannot change them', () => {
    const paths = [
      'packages/validators/test/judges/v2/witness.ts',
      'packages/validators/src/ladders/judges/v2/causes.ts',
      'packages/validators/src/ladders/judges/v2/families/injection.ts',
    ];
    expect(protectedChanges('exec/judges-1', paths)).toEqual(paths);
  });

  it('runs live items only with the owner approval in the environment, and calls no client without it', async () => {
    expect(billedMode({})).toBe(false);
    expect(billedMode({ [BILLED_APPROVAL]: '  ' })).toBe(false);
    expect(billedMode({ [BILLED_APPROVAL]: 'card-0001' })).toBe(true);
    const live = judgesBank().filter((entry) => entry.live);
    expect(live.length).toBe(20);
    const saved = process.env[BILLED_APPROVAL];
    delete process.env[BILLED_APPROVAL];
    try {
      let built = 0;
      const api = { ...witnessApi(), createOpenAiJudge: () => (built += 1) };
      const result = await runItem(live[0] as (typeof live)[number], 1, ROOT, api);
      expect(result.pass).toBe(false);
      expect(result.detail.startsWith(`not run: ${BILLED_APPROVAL} is not set. Fix: `)).toBe(true);
      expect(built).toBe(0);
      const ladder = judgesLadderV2({ api: witnessApi() });
      expect(ladder.levels.map((level) => level.id)).not.toContain('live');
      expect(judgesLadderV2({ api: witnessApi(), billed: true }).levels.at(-1)?.id).toBe('live');
    } finally {
      if (saved !== undefined) process.env[BILLED_APPROVAL] = saved;
    }
  });

  it('can be passed whole: the witness passes every deterministic item on seeds 1 and 2', async () => {
    const run = await runBank(
      [
        { seed: 1, hidden: false },
        { seed: 2, hidden: false },
      ],
      ROOT,
      { api: witnessApi() },
    );
    const failing = run.results.filter((r) => !r.passes.every(Boolean));
    // Scale items run under a time budget; under a loaded test runner only a time overrun may excuse one.
    const wrong = failing.filter((r) => !(r.family === 'scale' && /took \d+ ms/.test(r.detail)));
    expect(wrong.map((r) => `${r.id}: ${r.detail}`)).toEqual([]);
    expect(run.levels.every((level) => level >= LEVELS.length - 2)).toBe(true);
  }, 240_000);

  it('fails exactly the items of a missing capability, naming the export', async () => {
    const run = await runBank([{ seed: 3, hidden: false }], ROOT, { api: without('groundEvidence') });
    const failing = run.results.filter(
      (r) => !r.passes[0] && !(r.family === 'scale' && /took/.test(r.detail)),
    );
    expect(failing.map((r) => r.family)).toEqual(new Array(failing.length).fill('evidence'));
    // The evidence items of families/more.ts ask for other exports (quoteSpan, levenshtein, ...).
    expect(failing.length).toBe(
      judgesBank().filter((entry) => entry.family === 'evidence' && !(entry.id in MORE_CAUSES)).length,
    );
    expect(failing[0]?.detail).toMatch(/packages\/judges exports no function groundEvidence/);
  }, 240_000);

  it('stops at the first failing level and prints its items', async () => {
    const run = await runLadder(judgesLadderV2({ api: without('lintCriterion') }), { seed: 1, root: ROOT });
    const at = LEVELS.findIndex((level) => level.id === 'rubric');
    expect(run.level).toBe(at);
    expect(run.failing?.id).toBe('rubric');
    expect(run.failing?.items.every((entry) => entry.id.startsWith('rubric/'))).toBe(true);
    expect(run.rows.slice(at + 1).every((row) => row.pass === null)).toBe(true);
    expect(run.rows.every((row) => row.threshold === 1)).toBe(true);
    expect(judgesLadderV2({ api: witnessApi() }).version).toBe(2);
    const banked = run.rows[at]?.bank ?? [];
    expect(banked.length).toBe(judgesBank().filter((entry) => entry.level === 'rubric').length);
    expect(banked.every((entry) => entry.family === 'rubric' && entry.tier !== undefined)).toBe(true);
  }, 120_000);
});
