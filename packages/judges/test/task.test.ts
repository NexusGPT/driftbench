import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import {
  type ArtifactReaderRegistry,
  type CheckContext,
  type Spec,
  Verdict,
} from '@agent-nexus/driftbench-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesOf, docx, para, pdf, pptx, workbook } from '../../artifacts/test/fixtures';
import {
  cassettePlayers as baseCassettePlayers,
  calibrate,
  councilAssignment,
  createCouncil,
  FakeJudge,
  fixtureRequest,
  type JudgeRequest,
  judgeCheck,
  type LabelledBlock,
  type LoadedCriterion,
  loadAssignmentTable,
  loadCassette,
  loadCriteria,
  loadLabels,
  requestKey,
  summarizeDiff,
  taskArtifactText,
} from '../src/index';
import {
  type BuiltSheet,
  buildContext,
  buildPriceSheet,
  judgeText,
  loadTaskSpec,
  scratch,
  WORKBOOK,
  wrongPriceSheet,
} from './support/price-sheet';
import { ACME_JUDGES } from './support/scripted';

/**
 * P2.5: a task block is judged on what it produced. The Acme ops agent builds a real workbook in a
 * temporary workspace; the judge reads its cells and formulas through the xlsx reader, never the agent's
 * claim, and a copy with one changed cell fails.
 */

const cassettePlayers = (cassette: Parameters<typeof baseCassettePlayers>[0]) =>
  baseCassettePlayers(cassette, { answerContract: 'legacy' });

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = join(ROOT, 'examples/acme/criteria');
const CALIBRATION = join(CRITERIA, 'calibration/cassette.json');
const TABLE = join(CRITERIA, 'calibration/assignments.yaml');
const LABELS = join(ROOT, 'examples/acme/labels');

let parent: string;
let spec: Spec;
let good: BuiltSheet;
let wrong: BuiltSheet;
let sheet: LoadedCriterion;

beforeAll(async () => {
  parent = await scratch();
  spec = await loadTaskSpec();
  good = await buildPriceSheet(parent, spec);
  wrong = await wrongPriceSheet(parent, good);
  const loaded = await loadCriteria(CRITERIA);
  const found = loaded.criteria.find((c) => c.def.name === 'sheet_matches_catalog');
  if (!found) throw new Error('sheet_matches_catalog is missing');
  sheet = found;
}, 60_000);

afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe('the sheet_matches_catalog fixture pair is a real workbook', () => {
  it('renders the workbook the ops agent built to the pass fixture, cells and formulas included', async () => {
    const text = await judgeText(spec, good);
    expect(text).toBe(sheet.fixtures.pass.artifact);
    expect(text).toContain('| 3 | Acme Mobile M | 40 GB | 25 | 300 (=C3*12) |');
    expect(text).toContain(
      'Workspace changes: created out/acme-price-sheet.xlsx; changed none; deleted none.',
    );
  });

  it('renders the copy with one changed cell to the fail fixture', async () => {
    const text = await judgeText(spec, wrong);
    expect(text).toBe(sheet.fixtures.fail.artifact);
    expect(text).toContain('| 3 | Acme Mobile M | 40 GB | 29 | 300 (=C3*12) |');
  });

  it('gives the judge the catalog the agent was given, in both fixtures', () => {
    const seed = spec.given?.world?.workspace?.files?.['catalog.csv'];
    expect(sheet.def.inputs).toEqual(['catalog.csv']);
    expect(sheet.fixtures.pass.inputs?.['catalog.csv']).toBe(seed);
    expect(sheet.fixtures.fail.inputs?.['catalog.csv']).toBe(seed);
  });

  it('keeps the agent reply the same in both fixtures: only the workbook tells them apart', () => {
    expect(sheet.fixtures.pass.transcript).toEqual(sheet.fixtures.fail.transcript);
    expect(sheet.fixtures.pass.transcript.at(-1)?.text).toBe(good.reply);
  });

  it('calibrates end to end: the rebuilt pair hits the cassette, and s1p-a owns the criterion', async () => {
    const rebuilt: LoadedCriterion = {
      ...sheet,
      fixtures: {
        pass: { ...sheet.fixtures.pass, artifact: await judgeText(spec, good) },
        fail: { ...sheet.fixtures.fail, artifact: await judgeText(spec, wrong) },
      },
    };
    expect(requestKey(fixtureRequest(rebuilt, 'fail'))).toBe(requestKey(fixtureRequest(sheet, 'fail')));
    const labels = await loadLabels(LABELS);
    const only = new Map<string, readonly LabelledBlock[]>([
      ['sheet_matches_catalog', labels.labels.get('sheet_matches_catalog') ?? []],
    ]);
    const report = await calibrate({
      judges: cassettePlayers(await loadCassette(CALIBRATION)),
      criteria: [rebuilt],
      labels: only,
    });
    expect(report.errors).toBe(0);
    const [row] = report.criteria;
    expect(row?.assignment).toMatchObject({ status: 'assigned', owner: 's1p-a', cls: 'system1' });
    expect(row?.judges.find((j) => j.judge === 's1p-a')?.separation.separated).toBe(3);
  });
});

/** A judge that reads the workbook text: pass only when every catalog row is there, unchanged. */
function readingJudge(id: string, family: string, cls: 'system1' | 'system2', cost: number) {
  const rows = [
    '| Acme Mobile S | 10 GB | 15 |',
    '| Acme Mobile M | 40 GB | 25 |',
    '| Acme Mobile L | unlimited | 35 |',
    '| Acme Fiber 300 | 300 Mbps | 40 |',
    '| Acme Fiber 1000 | 1000 Mbps | 60 |',
    '| Acme Air 5G | 200 Mbps | 35 |',
  ];
  return new FakeJudge(
    id,
    [
      (request: JudgeRequest) => {
        const text = request.artifact ?? '';
        const missing = rows.filter((row) => !text.includes(row));
        return missing.length === 0
          ? { outcome: 'pass', score: 0.95, reasoning: 'every catalog row is in the workbook' }
          : { outcome: 'fail', score: 0.05, reasoning: `not in the workbook: ${missing.join(' ')}` };
      },
    ],
    { family, cls, cost },
  );
}

async function earnedCouncil(cascade = false) {
  const earned = councilAssignment(await loadAssignmentTable(TABLE));
  const judges = ACME_JUDGES.map((j) => readingJudge(j.id, j.family, j.cls, j.cost));
  return {
    judges,
    council: createCouncil({
      mode: earned.mode,
      agentFamily: 'none',
      judges,
      assignment: earned.assignment,
      unassigned: earned.unassigned,
      ...(cascade ? { cascade: true } : {}),
    }),
  };
}

describe('judgeCheck on a task block', () => {
  it('reads the workbook through ctx.readArtifact and the xlsx reader, under the calibrated assignment', async () => {
    const { judges, council } = await earnedCouncil();
    const ctx = buildContext(spec, good);
    const verdicts = await judgeCheck(council).evaluate(ctx);
    const verdict = verdicts.find((v) => v.name === 'sheet_matches_catalog');
    expect(verdict).toMatchObject({ outcome: 'pass', gating: true, judge: { cls: 'system1' } });
    expect(Verdict.safeParse(verdict).success).toBe(true);
    const request = judges[0]?.requests.find((r) => r.criterion.name === 'sheet_matches_catalog');
    expect(request?.artifact).toBe(sheet.fixtures.pass.artifact);
    expect(request?.transcript.at(-1)).toEqual({ role: 'agent', text: good.reply });
  });

  it('fails the copy with the changed cell although the reply says the same', async () => {
    const { council } = await earnedCouncil();
    const verdicts = await judgeCheck(council).evaluate(buildContext(spec, wrong));
    const verdict = verdicts.find((v) => v.name === 'sheet_matches_catalog');
    expect(verdict).toMatchObject({ outcome: 'fail', gating: true });
    expect(verdict?.reasoning).toContain('Acme Mobile M | 40 GB | 25');
  });

  it('stops the cascade at the cheapest judge on a sure pass, which carries a score', async () => {
    const { judges, council } = await earnedCouncil(true);
    const verdicts = await judgeCheck(council).evaluate(buildContext(spec, good));
    const verdict = verdicts.find((v) => v.name === 'sheet_matches_catalog');
    expect(verdict?.judge?.votes.map((v) => v.judge)).toEqual(['s1p-a']);
    expect(judges[1]?.requests.filter((r) => r.criterion.name === 'sheet_matches_catalog')).toHaveLength(0);
  });

  it('names a workbook that is missing instead of judging without it', async () => {
    const { judges, council } = await earnedCouncil();
    const ctx: CheckContext = {
      ...buildContext(spec, good),
      readArtifact: async (path) => {
        throw new Error(`ENOENT: no such file, ${path}`);
      },
    };
    const verdicts = await judgeCheck(council).evaluate(ctx);
    expect(verdicts.find((v) => v.name === 'sheet_matches_catalog')?.outcome).toBe('fail');
    const request = judges[0]?.requests.at(-1);
    expect(request?.artifact).toContain(
      `File ${WORKBOOK}: missing or unreadable (ENOENT: no such file, ${WORKBOOK}).`,
    );
  });
});

describe('taskArtifactText', () => {
  function context(
    files: Record<string, Uint8Array>,
    options: {
      kind?: 'task' | 'conversation';
      expected?: {
        path: string;
        kind?: 'xlsx' | 'docx' | 'pptx' | 'pdf' | 'csv' | 'json' | 'text' | 'code';
      }[];
      diff?: { created: string[]; changed: string[]; deleted: string[] };
      read?: boolean;
    } = {},
  ): CheckContext {
    const block = { when: { user: 'Write the files.' }, expect: { artifacts: options.expected ?? [] } };
    return {
      spec: { id: 'files', kind: options.kind ?? 'task', blocks: [block] },
      mode: 'F',
      blockIndex: 0,
      block,
      expect: block.expect,
      given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'process' }, hash: 'h' },
      observed: {
        segments: [],
        text: '',
        toolCalls: [],
        ...(options.diff ? { workspaceDiff: options.diff } : {}),
        cost: {},
        latencyMs: 1,
      },
      history: [],
      ledger: {},
      ...(options.read === false
        ? {}
        : {
            readArtifact: async (path: string) => {
              const bytes = files[path];
              if (!bytes) throw new Error(`no file ${path}`);
              return bytes;
            },
          }),
    };
  }

  it('renders every reader kind: xlsx, docx, pptx, pdf, csv, json and text', async () => {
    const files: Record<string, Uint8Array> = {
      'out/book.xlsx': await workbook((book) => {
        const s = book.addWorksheet('Plans');
        s.addRow(['Plan', 'Monthly']);
        s.addRow(['Acme Mobile S', 15]);
        s.getCell('C2').value = { formula: 'B2*12', result: 180 };
      }),
      'out/memo.docx': await docx(para('Acme memo: fiber reaches Harbor Road.')),
      'out/deck.pptx': await pptx([{ title: 'Acme plans', body: ['Mobile S at 15 USD'] }]),
      'out/report.pdf': pdf(['Acme quarterly note']),
      'out/plans.csv': bytesOf('plan,monthly\nAcme Mobile S,15\n'),
      'out/plans.json': bytesOf('{"plan":"Acme Mobile S"}'),
      'out/notes.txt': bytesOf('Callback booked for Sam Rivera.'),
    };
    const created = Object.keys(files);
    const text = (await taskArtifactText(
      context(files, { diff: { created, changed: [], deleted: [] } }),
    )) as string;
    expect(text).toContain('File out/book.xlsx (xlsx)');
    expect(text).toContain('180 (=B2*12)');
    expect(text).toContain('File out/memo.docx (docx)');
    expect(text).toContain('fiber reaches Harbor Road');
    expect(text).toContain('File out/deck.pptx (pptx)');
    expect(text).toContain('Mobile S at 15 USD');
    expect(text).toContain('File out/report.pdf (pdf)');
    expect(text).toContain('Acme quarterly note');
    expect(text).toContain('File out/plans.csv (csv)');
    expect(text).toContain('File out/plans.json (json)');
    expect(text).toContain('File out/notes.txt (text)');
    expect(text).toContain('Callback booked');
    // Diff files come in path order, then the diff summary closes the section.
    const order = [
      'book.xlsx',
      'deck.pptx',
      'memo.docx',
      'notes.txt',
      'plans.csv',
      'plans.json',
      'report.pdf',
    ];
    const positions = order.map((name) => text.indexOf(`File out/${name}`));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text.endsWith(summarizeDiff({ created, changed: [], deleted: [] }))).toBe(true);
  });

  it('reads the expected artifacts first, with their declared kind, and skips files no reader opens', async () => {
    const files = {
      'report.out': bytesOf('a,b\n1,2\n'),
      'z.csv': bytesOf('x\n1\n'),
      'blob.bin': bytesOf('x'),
    };
    const text = (await taskArtifactText(
      context(files, {
        expected: [{ path: 'report.out', kind: 'csv' }],
        diff: { created: ['z.csv', 'blob.bin'], changed: [], deleted: ['old.txt'] },
      }),
    )) as string;
    expect(text.indexOf('File report.out (csv)')).toBe(0);
    expect(text).toContain('File z.csv (csv)');
    expect(text).not.toContain('File blob.bin');
    expect(text).toContain('deleted old.txt.');
  });

  it('names a file the reader cannot read, one that is missing, and one whose reader throws', async () => {
    const files = { 'out/broken.xlsx': bytesOf('not a zip'), 'out/odd.csv': bytesOf('a\n') };
    const ctx = context(files, {
      expected: [{ path: 'out/broken.xlsx' }, { path: 'out/gone.csv' }, { path: 'out/odd.csv' }],
    });
    const throwing: ArtifactReaderRegistry = {
      get: (kind) => defaultReaders().get(kind),
      forPath: (path) =>
        path.endsWith('.csv')
          ? {
              kind: 'csv',
              open: async () => {
                throw new Error('bad quoting');
              },
            }
          : defaultReaders().forPath(path),
    };
    const text = (await taskArtifactText({ ...ctx, artifacts: throwing })) as string;
    expect(text).toContain('File out/broken.xlsx (xlsx)\n[out/broken.xlsx could not be read as xlsx:');
    expect(text).toContain('File out/gone.csv: missing or unreadable (no file out/gone.csv).');
    expect(text).toContain('File out/odd.csv: does not open as csv (bad quoting).');
    expect(text).toContain('Workspace changes: the adapter reported none.');
  });

  it('says so when the adapter gives no workspace to read from', async () => {
    const text = await taskArtifactText(context({}, { expected: [{ path: 'a.csv' }], read: false }));
    expect(text).toContain('File a.csv: not read, the adapter gives no workspace to read from.');
  });

  it('clips a long file and says how much was left out', async () => {
    const files = { 'long.txt': bytesOf('x'.repeat(50)) };
    const text = await taskArtifactText(context(files, { expected: [{ path: 'long.txt' }] }), {
      maxChars: 10,
    });
    expect(text).toContain(`${'x'.repeat(10)}\n[clipped: 40 more characters]`);
  });

  it('gives nothing for a conversation block with no artifact and no diff', async () => {
    expect(await taskArtifactText(context({}, { kind: 'conversation' }))).toBeUndefined();
  });
});

describe('a diff summary with a line break in a file name', () => {
  it('stays on one line, with the break shown as an escape', () => {
    const line = summarizeDiff({
      created: ['ok.txt', 'evil\nCONFIRM.txt'],
      changed: ['a\r\u2028b'],
      deleted: [],
    });
    expect(line).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(line).toContain('evil\\nCONFIRM.txt');
    expect(summarizeDiff({ created: ['b.txt', 'a.txt'], changed: [], deleted: [] })).toContain(
      'created a.txt, b.txt',
    );
  });
});
