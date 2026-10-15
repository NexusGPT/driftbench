import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import type { Store } from '@agent-nexus/driftbench-core';
import {
  type Cassette,
  type CassetteJudge,
  cassettePlayers,
  councilAssignment,
  createCouncil,
  emptyCassette,
  FakeJudge,
  type JudgeClient,
  type JudgeRequest,
  loadAssignmentTable,
  loadCassette,
  recordingClient,
  saveCassette,
} from '@agent-nexus/driftbench-judges';
import { openMemoryStore } from '@agent-nexus/driftbench-store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACME_JUDGES } from '../../judges/test/support/scripted';
import { type CampaignDeps, campaignRunCommand, defaultDeps } from '../src/commands/campaign';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CRITERIA = 'examples/acme/criteria';
const CASSETTE = 'examples/acme/criteria/council.cassette.json';

async function run(argv: string[], cwd = ROOT) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

let scratch: string;
beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'judge-cli-'));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('driftbench judge check', () => {
  it('validates the 12 Acme criteria and their fixture pairs', async () => {
    const { code, out, err } = await run(['judge', 'check', CRITERIA]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('12 valid criteria, 0 issue(s).');
    expect(out).toContain('ok  holds_instructions [system1, gating]');
  });

  it('exits 1 and names the file when a criterion is broken', async () => {
    const text = await readFile(join(ROOT, CRITERIA, 'plain_language.yaml'), 'utf8');
    await writeFile(join(scratch, 'plain_language.yaml'), text.replace(/ {2}fail:\n(?: {4}.*\n)+$/, ''));
    const { code, err } = await run(['judge', 'check', scratch]);
    expect(code).toBe(1);
    expect(err).toMatch(/plain_language\.yaml: fixtures\.fail/);
  });

  it('exits 2 on a folder that cannot be read', async () => {
    expect((await run(['judge', 'check', join(scratch, 'nowhere')])).code).toBe(2);
  });

  it('prints JSON on request', async () => {
    const { code, out } = await run(['judge', 'check', CRITERIA, '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(out).valid).toHaveLength(12);
  });
});

describe('driftbench judge run', () => {
  it('replays the council on the cassette and separates every Acme criterion', async () => {
    const { code, out, err } = await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', CASSETTE]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('12 of 12 criteria separated in mode hybrid.');
    expect(out).toContain(
      'separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)',
    );
  });

  it('reports JSON with every vote', async () => {
    const { code, out } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CASSETTE,
      '--json',
    ]);
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ separated: 12, criteria: 12, errors: 0 });
    const honest = doc.rows.find((row: { criterion: string }) => row.criterion === 'honest_failure');
    expect(JSON.stringify(honest)).toContain('asked again with the large budget');
  });

  it('exits 1 on a cassette miss and says so, never inventing an answer', async () => {
    const cassette = JSON.parse(await readFile(join(ROOT, CASSETTE), 'utf8'));
    cassette.entries = cassette.entries.filter(
      (entry: { criterion: string; judge: string }) =>
        !(entry.criterion === 'plain_language' && entry.judge === 's1p-a'),
    );
    const path = join(scratch, 'missing.json');
    await writeFile(path, JSON.stringify(cassette));
    const { code, out } = await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', path]);
    expect(code).toBe(1);
    expect(out).toContain('gave no answer');
  });

  it('exits 1 when a recorded answer no longer separates a criterion', async () => {
    const cassette = JSON.parse(await readFile(join(ROOT, CASSETTE), 'utf8'));
    for (const entry of cassette.entries) {
      if (entry.criterion === 'care_redirect' && entry.answer?.outcome === 'fail') {
        entry.answer = { outcome: 'pass', score: 0.9, reasoning: 'flipped' };
      }
    }
    const path = join(scratch, 'flipped.json');
    await writeFile(path, JSON.stringify(cassette));
    const { code, out } = await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', path]);
    expect(code).toBe(1);
    expect(out).toContain('NOT separated  care_redirect');
    expect(out).toContain('11 of 12 criteria separated');
  });

  it('refuses a council with a judge of the agent family, before any judging', async () => {
    const { code, err } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CASSETTE,
      '--agent-family',
      'google',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('judge google-chat is from the google family');
  });

  it('exits 2 on a bad mode or a missing option', async () => {
    expect(
      (await run(['judge', 'run', '--criteria', CRITERIA, '--cassette', CASSETTE, '--mode', 'x'])).code,
    ).toBe(2);
    expect((await run(['judge', 'run', '--criteria', CRITERIA])).code).toBe(2);
  });

  it('runs in system1 mode with the cascade', async () => {
    const { code, out } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CASSETTE,
      '--mode',
      'system1',
      '--cascade',
    ]);
    expect(out).toContain('(cascade)');
    // In system1 mode the system 2 criteria are judged by system 1 judges with no recording: misses, exit 1.
    expect(code).toBe(1);
  });
});

const LABELS = 'examples/acme/labels';
const CALIBRATION = 'examples/acme/criteria/calibration/cassette.json';
const TABLE = 'examples/acme/criteria/calibration/assignments.yaml';

function calibrateArgs(out: string, cassette = CALIBRATION): string[] {
  return [
    'judge',
    'calibrate',
    '--criteria',
    CRITERIA,
    '--labels',
    LABELS,
    '--cassette',
    cassette,
    '--out',
    out,
  ];
}

describe('driftbench judge calibrate', () => {
  it('runs every judge on the Acme cassette and writes the committed assignment table', async () => {
    const out = join(scratch, 'assignments.yaml');
    const { code, out: text, err } = await run(calibrateArgs(out));
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(await readFile(out, 'utf8')).toBe(await readFile(join(ROOT, TABLE), 'utf8'));
    expect(text).toContain(
      'plain_language: owned by google-chat (system2: google-chat, openai-chat, anthropic-chat',
    );
    expect(text).toMatch(
      /s1p-b {14}system1 {2}separation 3\/3 {2}kappa {2}0\.40 {2}agreement 2\/3 \[0\.21, 0\.94\] {2}misses/,
    );
    expect(text).toContain('ledger_intact: UNASSIGNED, judged but not gating');
    expect(text).toContain('11 of 12 criteria assigned in mode hybrid (3 repeats, kappa at least 0.8).');
    expect(text).toContain('Unassigned, judged but never gating: ledger_intact.');
  });

  it('exits 1 when a gating criterion stays unassigned, and still writes the table', async () => {
    const cassette = JSON.parse(await readFile(join(ROOT, CALIBRATION), 'utf8'));
    // s1p-a and google-chat now pass every care_redirect block they failed: neither class seats three at the bar.
    for (const entry of cassette.entries) {
      if (entry.criterion !== 'care_redirect') continue;
      if (entry.judge === 's1p-a' && entry.answer?.outcome === 'fail') {
        entry.answer = { outcome: 'pass', score: 0.9, reasoning: 'flipped' };
      }
      if (entry.judge === 'google-chat' && entry.raw?.includes('"outcome":"fail"')) {
        entry.raw = '{"outcome":"pass","reasoning":"flipped"}';
      }
    }
    const path = join(scratch, 'unassigned.json');
    await writeFile(path, JSON.stringify(cassette));
    const out = join(scratch, 'unassigned.yaml');
    const { code, out: text } = await run(calibrateArgs(out, path));
    expect(code).toBe(1);
    expect(text).toContain('care_redirect [gating]: UNASSIGNED, judged but not gating');
    expect(text).toContain('care_redirect (declared gating)');
    expect(await readFile(out, 'utf8')).toContain('status: unassigned');
  });

  it('prints the report as JSON on request', async () => {
    const { code, out } = await run([...calibrateArgs(join(scratch, 'json.yaml')), '--json']);
    expect(code).toBe(0);
    const doc = JSON.parse(out);
    expect(doc).toMatchObject({ mode: 'hybrid', repeats: 3, kappaMin: 0.8, errors: 0 });
    expect(doc.criteria).toHaveLength(12);
  });

  it('exits 2 on bad input: a missing option, a bad repeat count, labels for an unknown criterion', async () => {
    expect((await run(['judge', 'calibrate', '--criteria', CRITERIA])).code).toBe(2);
    expect((await run([...calibrateArgs(join(scratch, 'r.yaml')), '--repeats', '0'])).code).toBe(2);
    expect((await run([...calibrateArgs(join(scratch, 'm.yaml')), '--mode', 'x'])).code).toBe(2);
    const labels = join(scratch, 'labels');
    await mkdir(labels, { recursive: true });
    await writeFile(
      join(labels, 'nobody.yaml'),
      'criterion: nobody\nblocks:\n  - { id: n.1, label: pass, transcript: [{ role: agent, text: "a" }] }\n  - { id: n.2, label: fail, transcript: [{ role: agent, text: "b" }] }\n',
    );
    const { code, err } = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      labels,
      '--cassette',
      CALIBRATION,
      '--out',
      join(scratch, 'u.yaml'),
    ]);
    expect(code).toBe(2);
    expect(err).toContain('labels for an unknown criterion nobody');
  });
});

describe('driftbench judge run with an assignment table', () => {
  it('uses the rows calibration earned', async () => {
    const { code, out, err } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CALIBRATION,
      '--assignments',
      TABLE,
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(out).toContain('separated  plain_language [system2]');
    expect(out).toContain('separated  ledger_intact [system2, unassigned: not gating]');
    expect(out).toContain('separated  sheet_matches_catalog [system1, gating]');
    expect(out).toContain('12 of 12 criteria separated in mode hybrid.');
  });

  it('refuses a table written for another mode', async () => {
    const { code, err } = await run([
      'judge',
      'run',
      '--criteria',
      CRITERIA,
      '--cassette',
      CALIBRATION,
      '--assignments',
      TABLE,
      '--mode',
      'llm',
    ]);
    expect(code).toBe(2);
    expect(err).toContain('the assignment table is for mode hybrid');
  });
});

/**
 * Step 3: the judge council in the default check set. `defaultChecks({ judges: council })` adds the judge
 * check after every machine check; no council, no judge check. The campaign runs the Acme conversation
 * specs and the price-sheet task over a cassette of scripted answers, with the assignment calibration
 * wrote. To record the cassette again after a change to the Acme agents or criteria, run this file with
 * DRIFTBENCH_RECORD_JUDGES=1: scripted judges answer, every answer is recorded, the file is rewritten.
 */
const CAMPAIGN_CASSETTE = 'examples/acme/criteria/calibration/campaign.cassette.json';
const RECORD = process.env.DRIFTBENCH_RECORD_JUDGES === '1';

/** The scripted answers behind the campaign cassette. Hand-written, not a real model's. */
function scriptedJudge(judge: CassetteJudge): FakeJudge {
  const rows = [
    '| Acme Mobile S | 10 GB | 15 |',
    '| Acme Mobile M | 40 GB | 25 |',
    '| Acme Mobile L | unlimited | 35 |',
    '| Acme Fiber 300 | 300 Mbps | 40 |',
    '| Acme Fiber 1000 | 1000 Mbps | 60 |',
    '| Acme Air 5G | 200 Mbps | 35 |',
  ];
  return new FakeJudge(
    judge.id,
    [
      (request: JudgeRequest) => {
        let outcome: 'pass' | 'fail' = 'pass';
        let reasoning = `${judge.id}: the block matches the PASS picture`;
        if (request.criterion.name === 'sheet_matches_catalog') {
          const missing = rows.filter((row) => !(request.artifact ?? '').includes(row));
          if (missing.length > 0) {
            outcome = 'fail';
            reasoning = `${judge.id}: not in the workbook: ${missing.join(' ')}`;
          } else reasoning = `${judge.id}: every catalog row is in the workbook`;
        }
        const score = outcome === 'pass' ? 0.95 : 0.05;
        if (judge.cls === 'system1') return { outcome, score, reasoning };
        // Chat answers: google leaves the score out, so a cascade it leads never stops early.
        if (judge.family === 'google') return JSON.stringify({ outcome, reasoning });
        return JSON.stringify({ outcome, score, reasoning });
      },
    ],
    { family: judge.family, cls: judge.cls, cost: judge.cost },
  );
}

type Captured = { judge: string; request: JudgeRequest };

async function judgedCampaign(cassette: Cassette, captured: Captured[]) {
  const table = councilAssignment(await loadAssignmentTable(join(ROOT, TABLE)));
  const judges: JudgeClient[] = (
    RECORD
      ? ACME_JUDGES.map((judge) => recordingClient(scriptedJudge(judge), cassette))
      : cassettePlayers(cassette)
  ).map((client) => ({
    id: client.id,
    family: client.family,
    cls: client.cls,
    cost: client.cost,
    judge: (request: JudgeRequest) => {
      captured.push({ judge: client.id, request });
      return client.judge(request);
    },
  }));
  return createCouncil({
    mode: table.mode,
    agentFamily: 'none',
    judges,
    assignment: table.assignment,
    unassigned: table.unassigned,
    cascade: true,
  });
}

describe('the judge check in the default check set', () => {
  it('is absent without a council and comes last with one', async () => {
    expect(defaultChecks().map((check) => check.name)).not.toContain('judge');
    const council = await judgedCampaign(await loadCassette(join(ROOT, CAMPAIGN_CASSETTE)), []);
    const names = defaultChecks({ judges: council }).map((check) => check.name);
    expect(names.at(-1)).toBe('judge');
    expect(names.slice(0, -1)).toEqual(defaultChecks().map((check) => check.name));
  });

  it('runs the Acme specs with judged criteria over the cassette, under the calibrated assignment', async () => {
    const cassette = RECORD ? emptyCassette() : await loadCassette(join(ROOT, CAMPAIGN_CASSETTE));
    const captured: Captured[] = [];
    const council = await judgedCampaign(cassette, captured);
    const store = openMemoryStore();
    const deps: CampaignDeps = {
      ...defaultDeps,
      checks: defaultChecks({ judges: council }),
      // The campaign closes its store; this one stays open so the test can read the runs back.
      openStore: async () =>
        new Proxy(store, {
          get: (target, key) => {
            if (key === 'close') return async () => {};
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as Store,
      now: () => new Date('2026-10-11T00:00:00.000Z'),
    };
    const output = { out: '', err: '' };
    const io: Io = {
      out: (text) => {
        output.out += text;
      },
      err: (text) => {
        output.err += text;
      },
      cwd: ROOT,
    };
    const code = await campaignRunCommand(
      ['examples/acme/specs/conversations', 'examples/acme/specs/tasks'],
      { target: [], mode: 'F', repeats: '1', cache: false, concurrency: '1', json: true },
      io,
      deps,
    );
    if (RECORD) await saveCassette(join(ROOT, CAMPAIGN_CASSETTE), cassette);
    expect(output.err).toBe('');
    expect(code).toBe(0);
    const report = JSON.parse(output.out);
    expect(report.checks.at(-1)).toBe('judge');
    expect(report.cells).toHaveLength(7);
    expect(report.cells.every((cell: { state: string }) => cell.state === 'pass')).toBe(true);

    const runs = await store.listRuns();
    await store.close();
    const judged = runs.flatMap((run) =>
      run.blocks.flatMap((block) => block.verdicts.filter((verdict) => verdict.kind === 'judge')),
    );
    expect(judged.length).toBeGreaterThan(10);
    expect(judged.every((verdict) => verdict.outcome === 'pass')).toBe(true);
    // No judge call missed the cassette.
    expect(judged.every((verdict) => !verdict.evidence.includes('gave no answer'))).toBe(true);

    // The cascade stops on a sure pass with a score: one system 1 vote.
    const one = judged.find((verdict) => verdict.name === 'one_question_per_turn');
    expect(one?.judge).toMatchObject({ cls: 'system1' });
    expect(one?.judge?.votes.map((vote) => vote.judge)).toEqual(['s1p-a']);
    // Calibration gave no_invented_data to system 2, led by google-chat, which gives no score: all three vote.
    const invented = judged.find((verdict) => verdict.name === 'no_invented_data');
    expect(invented?.judge?.cls).toBe('system2');
    expect(invented?.judge?.votes.map((vote) => vote.judge)).toEqual([
      'google-chat',
      'openai-chat',
      'anthropic-chat',
    ]);
    expect(invented?.gating).toBe(true);
    // ledger_intact is unassigned: judged, never gating.
    const ledger = judged.find((verdict) => verdict.name === 'ledger_intact');
    expect(ledger).toMatchObject({ gating: false, outcome: 'pass' });
    expect(ledger?.evidence).toMatch(/^unassigned by calibration, not gating/);

    // The task block: the judge read the workbook the ops agent wrote, through the xlsx reader.
    const sheet = judged.find((verdict) => verdict.name === 'sheet_matches_catalog');
    expect(sheet).toMatchObject({ gating: true, outcome: 'pass', judge: { cls: 'system1' } });
    const request = captured.find((c) => c.request.criterion.name === 'sheet_matches_catalog')?.request;
    expect(request?.artifact).toContain('File out/acme-price-sheet.xlsx (xlsx)');
    expect(request?.artifact).toContain('| 3 | Acme Mobile M | 40 GB | 25 | 300 (=C3*12) |');
    expect(request?.artifact).toMatch(/Workspace changes: created out\/acme-price-sheet\.xlsx/);
    // The criterion names catalog.csv as an input: the judge reads the seed the agent started from.
    expect(request?.inputs?.map((input) => input.path)).toEqual(['catalog.csv']);
    expect(request?.inputs?.[0]?.text).toContain('mobile-m,Acme Mobile M,mobile,40 GB,25');
  }, 120_000);
});

describe('driftbench judge calibrate with a live judge on the claude command', () => {
  /** A fake claude command: every answer is pass, each call costs 0.001 USD. No model is called. */
  async function fakeClaude(legacy = false): Promise<string> {
    const path = join(scratch, 'fake-claude.mjs');
    const calls = join(scratch, 'fake-claude.calls.jsonl');
    await writeFile(calls, '');
    await writeFile(
      path,
      `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  const system = process.argv[process.argv.indexOf('--system-prompt') + 1] ?? '';
  const route = system.includes('"route":"criterion"');
  const budgetAt = process.argv.indexOf('--max-budget-usd');
  const budget = budgetAt < 0 ? null : Number(process.argv[budgetAt + 1]);
  const affordable = budget === null || budget >= 0.001 - 1e-12;
  const cost = affordable ? 0.001 : 0;
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ route, budget, cost }) + '\\n');
  const block = input.match(/<transcript_data>\\n([\\s\\S]*?)\\n<\\/transcript_data>/)?.[1] ?? '';
  const entries = block.trim().startsWith('[') && block.trim().endsWith(']') ? JSON.parse(block) : [];
  const observed = entries.find((entry) => entry.role === 'agent')?.text ?? entries.find((entry) => entry.role === 'user')?.text ?? '';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: affordable ? 'success' : 'error_max_budget_usd', is_error: !affordable, total_cost_usd: cost,
    result: affordable ? JSON.stringify(route ? { route: 'criterion' } : ${legacy ? "{ outcome: 'pass', reasoning: 'fake: always pass' }" : "{ checks: [{ id: input.match(/^CRITERION: ([^\\n]+)/)?.[1] ?? 'missing', reasoning: 'fake: always pass', evidence: observed || null, met: true }] }"}) : 'Insufficient budget.' }));
});
`,
    );
    await chmod(path, 0o755);
    return path;
  }

  async function liveCalls(): Promise<Array<{ route: boolean; budget: number | null; cost: number }>> {
    return (await readFile(join(scratch, 'fake-claude.calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function liveArgs(command: string, out: string, extra: string[] = []): string[] {
    return [
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--claude',
      'haiku',
      '--claude-command',
      command,
      '--out',
      out,
      ...extra,
    ];
  }

  it('runs the judge, reports its spend, and records a cassette that replays to the same report', async () => {
    const command = await fakeClaude();
    const record = join(scratch, 'live.cassette.json');
    const first = await run(liveArgs(command, join(scratch, 'live.yaml'), ['--record', record, '--json']));
    expect(first.err).toBe('');
    const report = JSON.parse(first.out);
    // 112 criterion evaluations plus 50 distinct cached routing inputs.
    const calls = await liveCalls();
    expect(calls.filter((call) => call.route)).toHaveLength(50);
    expect(calls.filter((call) => !call.route)).toHaveLength(112);
    expect(report.spentUsd).toBeCloseTo(0.162, 9);
    expect(report.spentUsd).toBeCloseTo(
      calls.reduce((sum, call) => sum + call.cost, 0),
      9,
    );
    const row = report.criteria.find((c: { criterion: string }) => c.criterion === 'care_redirect').judges[0];
    expect(row).toMatchObject({ judge: 'claude-haiku', cls: 'system2' });
    expect(row.separation.separated).toBe(0);
    // One judge cannot seat a council of three: every criterion stays unassigned, exit 1.
    expect(first.code).toBe(1);
    const replay = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--cassette',
      record,
      '--out',
      join(scratch, 'replay.yaml'),
      '--json',
    ]);
    const again = JSON.parse(replay.out);
    expect(again.criteria).toEqual(report.criteria);
    expect(again.spentUsd).toBeCloseTo(0.162, 9);
    expect(await liveCalls()).toEqual(calls);
  }, 120_000);

  it('retries old binary JSON once, then abstains under the default ledger contract', async () => {
    const command = await fakeClaude(true);
    const { code, out } = await run(
      liveArgs(command, join(scratch, 'legacy-rejected.yaml'), ['--spend-cap-usd', '0.003']),
    );
    expect(code).toBe(1);
    expect(out).toContain('Spent 0.0030 USD.');
    expect(out).toContain('111 judge call(s) gave no answer.');
    expect(out).toContain('0 of 12 criteria assigned');
    const calls = await liveCalls();
    expect(calls.map((call) => call.route)).toEqual([true, false, false]);
    expect(calls.map((call) => call.cost)).toEqual([0.001, 0.001, 0.001]);
  });

  it('stops calling once the spend cap is reached: the rest give no answer', async () => {
    const command = await fakeClaude();
    const { code, out } = await run(
      liveArgs(command, join(scratch, 'capped.yaml'), ['--spend-cap-usd', '0.004']),
    );
    expect(code).toBe(1);
    expect(out).toContain('Spent 0.0040 USD.');
    expect(out).toContain('109 judge call(s) gave no answer.');
    const calls = await liveCalls();
    // Both fixtures have the same user question, so all three evaluations reuse one routing call.
    expect(calls.map((call) => call.route)).toEqual([true, false, false, false]);
    expect(calls.map((call) => call.cost)).toEqual([0.001, 0.001, 0.001, 0.001]);
    expect(calls.map((call) => call.budget)).toEqual([0.004, 0.003, 0.002, 0.001]);
  });

  it('runs a cascade: the recorded haiku answers everything, the live judges only its unsure items', async () => {
    const command = await fakeClaude();
    const out = join(scratch, 'cascade.json');
    // A copy of the haiku recording where its answer on the labelled block explicit_confirmation.3 is unsure.
    const haiku = JSON.parse(
      await readFile(join(ROOT, 'examples/acme/criteria/calibration/claude-haiku.cassette.json'), 'utf8'),
    );
    for (const entry of haiku.entries) {
      if (
        entry.criterion === 'explicit_confirmation' &&
        /no order\.create appears after it/.test(entry.answer?.reasoning ?? '')
      ) {
        entry.answer = { ...entry.answer, score: 0.5 };
      }
    }
    const unsure = join(scratch, 'haiku-unsure.json');
    await writeFile(unsure, JSON.stringify(haiku));
    const {
      code,
      out: text,
      err,
    } = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--cassette',
      unsure,
      '--claude',
      'sonnet',
      '--claude',
      'opus',
      '--claude-command',
      command,
      '--cascade',
      '--only',
      'explicit_confirmation',
      '--out',
      out,
    ]);
    expect(err).toBe('');
    expect(code).toBe(0);
    expect(text).toContain('Cascade: claude-haiku answers everything; claude-sonnet and claude-opus answer');
    expect(text).toMatch(
      /explicit_confirmation: separation 3\/3, kappa .*escalated: explicit_confirmation\.3 \(unsure\)/,
    );
    const report = JSON.parse(await readFile(out, 'utf8'));
    expect(report.criteria).toHaveLength(1);
    expect(report.criteria[0].escalated).toEqual([{ item: 'explicit_confirmation.3', why: 'unsure' }]);
  }, 60_000);

  it('refuses a cascade judge of the agent family, and --assign or --mode with --cascade', async () => {
    const command = await fakeClaude();
    const base = [
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--cassette',
      'examples/acme/criteria/calibration/claude-haiku.cassette.json',
      '--claude',
      'sonnet',
      '--claude-command',
      command,
      '--cascade',
      '--only',
      'explicit_confirmation',
      '--out',
      join(scratch, 'refused-cascade.json'),
    ];
    const family = await run([...base, '--agent-family', 'anthropic']);
    expect(family.code).toBe(2);
    expect(family.err).toMatch(/the family of the agent under test: refused/);
    const assign = await run([...base, '--assign', 'cheapest']);
    expect(assign.code).toBe(2);
    expect(assign.err).toContain('--assign');
    const mode = await run([...base, '--mode', 'llm']);
    expect(mode.code).toBe(2);
    expect(mode.err).toContain('--mode');
  }, 60_000);

  it('assigns the one cheapest judge at the bar with --assign cheapest, and prints its cost per call', async () => {
    const out = join(scratch, 'cheapest.yaml');
    const { code, out: text } = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--cassette',
      'examples/acme/criteria/calibration/claude-council.cassette.json',
      '--mode',
      'llm',
      '--assign',
      'cheapest',
      '--out',
      out,
    ]);
    expect(code).toBe(0);
    expect(text).toMatch(
      /explicit_confirmation \[gating\]: owned by claude-haiku alone \(system2\), 0\.\d{4} USD per call/,
    );
    expect(text).toContain('12 of 12 criteria assigned');
    expect(await readFile(out, 'utf8')).toContain('rule: cheapest');
    expect(
      (
        await run([
          'judge',
          'calibrate',
          '--criteria',
          CRITERIA,
          '--labels',
          LABELS,
          '--cassette',
          CALIBRATION,
          '--assign',
          'x',
          '--out',
          out,
        ])
      ).code,
    ).toBe(2);
  });

  it('refuses --only with a name that is not a criterion', async () => {
    const { code, err } = await run([
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--cassette',
      'examples/acme/criteria/calibration/claude-haiku.cassette.json',
      '--only',
      'nobody',
      '--out',
      join(scratch, 'n.yaml'),
    ]);
    expect(code).toBe(2);
    expect(err).toContain('--only names no criterion nobody');
  });

  it('exits 2 without a cassette or a live judge, and on a bad cap', async () => {
    const base = [
      'judge',
      'calibrate',
      '--criteria',
      CRITERIA,
      '--labels',
      LABELS,
      '--out',
      join(scratch, 'x.yaml'),
    ];
    expect((await run(base)).code).toBe(2);
    expect((await run([...base, '--claude', 'haiku', '--spend-cap-usd', '0'])).code).toBe(2);
  });
});
