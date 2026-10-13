import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AnnotationAnchor,
  anchorNote,
  anchorProblem,
  calibrate,
  LabelledBlock,
  loadLabels,
} from '../src/calibration';
import { cassettePlayers as baseCassettePlayers, loadCassette } from '../src/cassette';
import { loadCriteria } from '../src/criteria';

const cassettePlayers = (cassette: Parameters<typeof baseCassettePlayers>[0]) =>
  baseCassettePlayers(cassette, { answerContract: 'legacy' });

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const transcript = [
  { role: 'user' as const, text: 'Is fiber available at 12 Main St?' },
  { role: 'tool_call' as const, text: '{"address":"12 Main St"}', tool: 'coverage.lookup' },
  { role: 'tool_result' as const, text: '{"fiber":true}' },
  { role: 'agent' as const, text: 'Yes, Acme Fiber is available there.' },
  { role: 'tool_call' as const, text: '{"address":"12 Main St"}', tool: 'coverage.lookup' },
];

const block = (anchor?: unknown): LabelledBlock =>
  ({
    id: 'b1',
    label: 'pass' as const,
    transcript,
    given: { ledger: { order: { total: 35, currency: 'USD' } } },
    ...(anchor === undefined ? {} : { anchor }),
  }) as LabelledBlock;

describe('annotation anchors', () => {
  it('accepts a message, a tool call, a field path and a span', () => {
    for (const anchor of [
      { kind: 'message', index: 3 },
      { kind: 'tool_call', tool: 'coverage.lookup', occurrence: 2 },
      { kind: 'field', path: 'order.total' },
      { kind: 'span', span_id: 'a1b2c3' },
    ]) {
      expect(AnnotationAnchor.safeParse(anchor).success, JSON.stringify(anchor)).toBe(true);
      expect(LabelledBlock.safeParse(block(anchor)).success, JSON.stringify(anchor)).toBe(true);
    }
  });

  it('refuses an unknown kind and an extra key', () => {
    expect(AnnotationAnchor.safeParse({ kind: 'paragraph', index: 1 }).success).toBe(false);
    expect(AnnotationAnchor.safeParse({ kind: 'message', index: 1, extra: true }).success).toBe(false);
  });

  it('a message anchor must name an existing transcript line', () => {
    expect(anchorProblem(block({ kind: 'message', index: 3 }))).toBeUndefined();
    expect(anchorProblem(block({ kind: 'message', index: 9 }))).toMatch(/no transcript line 9/);
  });

  it('a tool call anchor names a tool the transcript called, and an occurrence it reached', () => {
    expect(
      anchorProblem(block({ kind: 'tool_call', tool: 'coverage.lookup', occurrence: 2 })),
    ).toBeUndefined();
    expect(anchorProblem(block({ kind: 'tool_call', tool: 'order.create' }))).toMatch(
      /calls no order\.create/,
    );
    expect(anchorProblem(block({ kind: 'tool_call', tool: 'coverage.lookup', occurrence: 3 }))).toMatch(
      /calls coverage\.lookup 2 times/,
    );
  });

  it('a field anchor is a path into the ledger of the block', () => {
    expect(anchorProblem(block({ kind: 'field', path: 'order.total' }))).toBeUndefined();
    expect(anchorProblem(block({ kind: 'field', path: 'order.tax' }))).toMatch(
      /no ledger field or tool output field order\.tax/,
    );
  });

  it('a span anchor is accepted, with a note that the transcript cannot check it', () => {
    expect(anchorProblem(block({ kind: 'span', span_id: 'a1b2c3' }))).toBeUndefined();
    expect(anchorNote(block({ kind: 'span', span_id: 'a1b2c3' }))).toMatch(/not checkable/);
    expect(anchorNote(block({ kind: 'message', index: 0 }))).toBeUndefined();
  });

  it('a block with no anchor has no problem', () => {
    expect(anchorProblem(block())).toBeUndefined();
  });

  it('loadLabels reports a bad anchor as an issue and keeps the block', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-anchors-'));
    made.push(dir);
    const file = {
      criterion: 'coverage',
      blocks: [
        { id: 'p', label: 'pass', transcript, anchor: { kind: 'message', index: 3 } },
        { id: 'f', label: 'fail', transcript, anchor: { kind: 'message', index: 42 } },
      ],
    };
    await writeFile(join(dir, 'coverage.yaml'), JSON.stringify(file));
    const loaded = await loadLabels(dir);
    expect(loaded.labels.get('coverage')?.map((entry) => entry.id)).toEqual(['p', 'f']);
    expect(loaded.issues.map((issue) => issue.message).join('\n')).toMatch(/no transcript line 42/);
  });
});

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = join(ROOT, 'examples/acme/criteria');
const LABELS = join(ROOT, 'examples/acme/labels');

describe('calibrate reads anchors', () => {
  it('carries the anchor of a label into the calibration row of each judge', async () => {
    const criteria = (await loadCriteria(CRITERIA)).criteria;
    const labels = new Map((await loadLabels(LABELS)).labels);
    const named = 'one_question_per_turn';
    const blocks = labels.get(named) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    labels.set(
      named,
      blocks.map((block, i) =>
        i === 0 ? { ...block, anchor: { kind: 'message' as const, index: 1 } } : block,
      ),
    );
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(join(CRITERIA, 'calibration/cassette.json'))),
      criteria,
      labels,
    });
    const row = report.criteria.find((entry) => entry.criterion === named)?.judges[0]?.labels.blocks[0];
    expect(row?.id).toBe(blocks[0]?.id);
    expect(row?.anchor).toEqual({ kind: 'message', index: 1 });
  });
});

describe('field anchors may name a field of a tool output, and a span names a runtime event', () => {
  const withOutput = {
    id: 'b2',
    label: 'pass' as const,
    transcript: [
      { role: 'user' as const, text: 'Is fiber available?' },
      { role: 'tool_call' as const, text: '{"address":"12 Main St"}', tool: 'coverage.lookup' },
      {
        role: 'tool_result' as const,
        text: '{"coverage":{"fiber":true},"price":35}',
        tool: 'coverage.lookup',
      },
      { role: 'agent' as const, text: 'Yes.' },
    ],
  } as LabelledBlock;

  it('resolves a field path against the JSON output of a tool result in the transcript', () => {
    expect(
      anchorProblem({ ...withOutput, anchor: { kind: 'field', path: 'coverage.fiber' } }),
    ).toBeUndefined();
    expect(anchorProblem({ ...withOutput, anchor: { kind: 'field', path: 'price' } })).toBeUndefined();
    expect(anchorProblem({ ...withOutput, anchor: { kind: 'field', path: 'coverage.tax' } })).toMatch(
      /no ledger field/,
    );
  });

  it('a span anchor is accepted for a runtime event such as a guard, with the note', () => {
    expect(
      anchorProblem({ ...withOutput, anchor: { kind: 'span', span_id: 'guard:billing' } }),
    ).toBeUndefined();
    expect(anchorNote({ ...withOutput, anchor: { kind: 'span', span_id: 'guard:billing' } })).toMatch(
      /not checkable/,
    );
  });
});
