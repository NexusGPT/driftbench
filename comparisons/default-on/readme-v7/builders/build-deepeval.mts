/**
 * deepeval lane: builds manifest.json and CHECKS.json for the 9 DeepEval README rows. No network, no model call.
 *
 * Run:  <repo>/node_modules/.bin/tsx build.mts
 * The orchestrator reads committed repo files only (working-tree copies of clean committed files, plus
 * `git show` / `git archive` of pinned commits). It extracts each pinned packages/judges/src + packages/core/src
 * tree into .pinned/<commit>/ and re-renders every request in a child process (`build.mts --render`) whose tsx
 * tsconfig maps @agent-nexus/driftbench-* to that pinned tree, so buildPrompt is the pinned one.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../wt-371c');

// ---------- render mode (child process, pinned tsconfig) ----------
if (process.argv[2] === '--render') {
  const tree = resolve(process.argv[3]!);
  const { buildPrompt } = await import(pathToFileURL(join(tree, 'packages/judges/src/prompt.ts')).href);
  const jobs = JSON.parse(readFileSync(0, 'utf8')) as { id: string; request: unknown }[];
  const out = JSON.stringify(jobs.map((j) => ({ id: j.id, ...buildPrompt(j.request) })));
  await new Promise<void>((done) => process.stdout.write(out, () => done())); // flush the pipe before exit
  process.exit(0);
}

// ---------- orchestrator ----------
const git = (...args: string[]) => execFileSync('git', ['-C', REPO, ...args], { maxBuffer: 1 << 30 });
const show = (commit: string, path: string) => git('show', `${commit}:${path}`).toString('utf8');
const readRepo = (path: string) => readFileSync(join(REPO, path), 'utf8');
const json = (path: string) => JSON.parse(readRepo(path));
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
// Python json.dumps(..., ensure_ascii=False) of a flat or nested list of strings: ", " separators.
const pyList = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(pyList).join(', ')}]` : JSON.stringify(v);
const callKey = (system: string, user: string) => sha256(pyList(['haiku', system, user]));
const yaml = createRequire(join(REPO, 'packages/core/package.json'))('yaml') as { parse: (t: string) => any };

// Clean-tree guard: every working-tree input below must equal HEAD (the lane reads committed files only).
const INPUT_DIRS = [
  'comparisons/deepeval',
  'examples/criteria',
  'examples/acme/criteria',
  'packages/judges/src',
];
const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', ...INPUT_DIRS])
  .toString()
  .trim();
if (dirty) throw new Error(`Inputs differ from HEAD:\n${dirty}`);
const HEAD = git('rev-parse', 'HEAD').toString().trim();

const PIN_HARD = 'e1d3a49108f31ae47d52f4558d99749c038aa18e'; // last commit writing baseline-prompts-heldout.json
const PIN_LEAD = 'd4474011208d9d69923606cf858f37802ff0633e'; // fresh-freeze.json commit (settings_freeze_commit)
const TSX = join(REPO, 'node_modules/.bin/tsx');
// The judges package and every internal package it (transitively) imports at both pins.
const PINNED_PACKAGES = ['judges', 'core', 'stats', 'artifacts', 'checks'];

function extract(commit: string): string {
  const dir = join(HERE, '.pinned', commit.slice(0, 9));
  if (!existsSync(join(dir, 'packages/judges/src/prompt.ts'))) {
    mkdirSync(dir, { recursive: true });
    const tar = git(
      'archive',
      commit,
      ...PINNED_PACKAGES.map((p) => `packages/${p}/src`),
      'tsconfig.json',
      'tsconfig.base.json',
    );
    execFileSync('tar', ['-x', '-C', dir], { input: tar });
    // Third-party deps only (zod, yaml, ...); @agent-nexus/driftbench-* resolves to the pinned tree via tsconfig paths.
    for (const pkg of PINNED_PACKAGES)
      symlinkSync(join(REPO, 'packages', pkg, 'node_modules'), join(dir, 'packages', pkg, 'node_modules'));
  }
  return dir;
}

function render(commit: string, jobs: { id: string; request: unknown }[]) {
  const tree = extract(commit);
  const out = execFileSync(
    TSX,
    ['--tsconfig', join(tree, 'tsconfig.json'), fileURLToPath(import.meta.url), '--render', tree],
    {
      input: JSON.stringify(jobs),
      maxBuffer: 1 << 30,
      cwd: tree,
    },
  );
  const rows = JSON.parse(out.toString('utf8')) as { id: string; system: string; user: string }[];
  return new Map(rows.map((r) => [r.id, r]));
}

type Case = {
  id: string;
  truth: boolean;
  turns: { role: string; content: string }[];
  contexts?: string[];
  role?: string;
  tool_receipts?: {
    name: string;
    input_parameters: Record<string, unknown>;
    output: Record<string, unknown>;
  }[];
};
const criterionAt = (commit: string, path: string) => yaml.parse(show(commit, path)).criterion;

/** comparisons/deepeval/hard/render.mts request construction, unchanged in meaning. */
function hardRequest(criterion: unknown, row: Case) {
  const transcript: any[] = row.turns.map((m) => ({
    role: m.role === 'assistant' ? 'agent' : 'user',
    text: m.content,
  }));
  if (row.contexts)
    transcript.splice(transcript.length - 1, 0, {
      role: 'tool_result',
      tool: 'catalog.search',
      text: row.contexts.join('\n'),
    });
  for (const receipt of row.tool_receipts ?? [])
    transcript.splice(
      transcript.length - 1,
      0,
      { role: 'tool_call', tool: receipt.name, text: JSON.stringify(receipt.input_parameters) },
      { role: 'tool_result', tool: receipt.name, text: JSON.stringify(receipt.output) },
    );
  const inputs = row.role ? [{ path: 'role.txt', text: row.role }] : undefined;
  return { criterion, transcript, ...(inputs ? { inputs } : {}) };
}

/** comparisons/deepeval/lead/bridge.mts request construction, unchanged in meaning. */
function leadRequest(criterion: unknown, row: Case, setting: string) {
  const assessment = setting === 'response-relevance' ? { kind: 'response-relevance' } : undefined;
  if (setting !== 'default' && !assessment) throw new Error(setting);
  return {
    criterion,
    transcript: row.turns.map((m) => ({ role: m.role === 'assistant' ? 'agent' : 'user', text: m.content })),
    ...(assessment ? { assessment } : {}),
  };
}

const CRIT = {
  relevancy: 'examples/criteria/relevancy.yaml',
  role: 'examples/criteria/role.yaml',
  completeness: 'examples/criteria/conversation_completeness.yaml',
  task: 'examples/criteria/task_completion.yaml',
  grounding: 'examples/acme/criteria/no_invented_data.yaml',
  knowledge: 'examples/criteria/knowledge_retention.yaml',
} as const;
const lastTouch = (path: string, at: string) =>
  git('log', '-1', '--format=%h %cs %s', at, '--', path).toString().trim();

const datasets: any[] = [];
const rows: any[] = [];
const equivalence: any[] = [];
const totals: any[] = [];
const pinNotes: any[] = [];
const deviations: string[] = [];

function pinNote(
  dataset: string,
  commit: string,
  criterionPath: string,
  extra: Record<string, unknown> = {},
) {
  pinNotes.push({
    dataset,
    renderCommit: commit,
    buildPromptBlob: git('rev-parse', `${commit}:packages/judges/src/prompt.ts`).toString().trim(),
    buildPromptLastChange: lastTouch('packages/judges/src/prompt.ts', commit),
    criterionPath,
    criterionBlob: git('rev-parse', `${commit}:${criterionPath}`).toString().trim(),
    criterionLastChange: lastTouch(criterionPath, commit),
    ...extra,
  });
}

/** Builds one dataset, renders it with the pinned buildPrompt and records the equivalence evidence. */
function addDataset(spec: {
  name: string;
  note: string;
  commit: string;
  cases: Case[];
  requestOf: (c: Case) => unknown;
  storedPrompts?: Record<string, { system: string; user: string }>;
  storedPromptsSource?: string;
  recordedKey: Map<string, string | undefined>;
  recordedKeySource: string;
}) {
  const items = spec.cases.map((c) => ({
    id: c.id,
    gold: c.truth ? 'pass' : 'fail',
    request: spec.requestOf(c),
  }));
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error(`duplicate ids in ${spec.name}`);
  const rendered = render(spec.commit, items);
  const promptMismatch: string[] = [];
  const keyMismatch: string[] = [];
  for (const item of items) {
    const r = rendered.get(item.id)!;
    if (spec.storedPrompts) {
      const s = spec.storedPrompts[item.id];
      if (!s || s.system !== r.system || s.user !== r.user) promptMismatch.push(item.id);
    }
    if (spec.recordedKey.get(item.id) !== callKey(r.system, r.user)) keyMismatch.push(item.id);
  }
  const n = items.length;
  const byHash = new Map<string, { id: string; gold: string }[]>();
  for (const item of items) {
    const r = rendered.get(item.id)!;
    const k = callKey(r.system, r.user);
    byHash.set(k, [...(byHash.get(k) ?? []), { id: item.id, gold: item.gold }]);
  }
  const shared = [...byHash.values()].filter((g) => g.length > 1);
  equivalence.push({
    dataset: spec.name,
    renderCommit: spec.commit,
    ...(spec.storedPrompts
      ? {
          storedPrompts: `${spec.storedPromptsSource}`,
          storedPromptsIdentical: `${n - promptMismatch.length} of ${n} identical`,
          storedPromptMismatches: promptMismatch,
        }
      : {}),
    recordedRequestHash: spec.recordedKeySource,
    recordedRequestHashIdentical: `${n - keyMismatch.length} of ${n} identical`,
    recordedRequestHashMismatches: keyMismatch,
    distinctRenderedRequests: byHash.size,
    itemsSharingARequest: shared.reduce((a, g) => a + g.length, 0),
    sharedRequestGroupsWithConflictingGold: shared
      .filter((g) => new Set(g.map((x) => x.gold)).size > 1)
      .map((g) => g.map((x) => x.id)),
  });
  datasets.push({ name: spec.name, baselines: {}, optional: false, note: spec.note, items });
  return items;
}

function addRow(row: {
  row: string;
  dataset: string;
  ids: string[];
  peerSource: string;
  peer: Map<string, boolean>;
  ours: Map<string, boolean>;
  recorded: { ours: number; theirs: number; n: number };
  extra?: Record<string, unknown>;
}) {
  const peerCorrect = Object.fromEntries(row.ids.map((id) => [id, row.peer.get(id)!]));
  const oldOursCorrect = Object.fromEntries(row.ids.map((id) => [id, row.ours.get(id)!]));
  for (const id of row.ids)
    if (typeof peerCorrect[id] !== 'boolean' || typeof oldOursCorrect[id] !== 'boolean')
      throw new Error(`${row.row}: ${id} missing`);
  const sumPeer = Object.values(peerCorrect).filter(Boolean).length;
  const sumOurs = Object.values(oldOursCorrect).filter(Boolean).length;
  rows.push({
    row: row.row,
    dataset: row.dataset,
    n: row.ids.length,
    peerSource: row.peerSource,
    peerCorrect,
    oldOursCorrect,
    recorded: row.recorded,
    ...(row.extra ?? {}),
  });
  totals.push({
    row: row.row,
    n: row.ids.length,
    nMatchesRecorded: row.ids.length === row.recorded.n,
    sumPeerCorrect: sumPeer,
    recordedTheirs: row.recorded.theirs,
    theirsOk: sumPeer === row.recorded.theirs,
    sumOldOursCorrect: sumOurs,
    recordedOurs: row.recorded.ours,
    oursOk: sumOurs === row.recorded.ours,
  });
}

// ---------- held-out hard sets (72 each) ----------
const HARD = 'comparisons/deepeval/hard';
const heldSets = json(`${HARD}/sets-heldout.json`) as Record<string, Case[]>;
const heldPrompts = json(`${HARD}/baseline-prompts-heldout.json`);
const heldRec = json(`${HARD}/baseline-heldout.json`);
const heldScores = json(`${HARD}/baseline-heldout-scores.json`) as any[];
const recScore = (scores: any[], row: string) => {
  const s = scores.find((x) => x.row === row);
  return { ours: s.ours, theirs: s.theirs, n: s.n };
};
const firstKey = (recRows: any[], filter: (r: any) => boolean) => {
  const m = new Map<string, string | undefined>();
  for (const r of recRows.filter(filter)) {
    const k = r.ours.request_sha256s?.[0];
    if (m.has(r.id) && m.get(r.id) !== k) throw new Error(`ours key differs across rows for ${r.id}`);
    m.set(r.id, k);
  }
  return m;
};
const correctMaps = (recRows: any[], row: string) => {
  const sel = recRows.filter((r) => r.row === row);
  return {
    ids: sel.map((r) => r.id as string),
    ours: new Map<string, boolean>(sel.map((r) => [r.id, r.ours.prediction === r.truth])),
    peer: new Map<string, boolean>(sel.map((r) => [r.id, r.theirs.prediction === r.truth])),
    truth: new Map<string, boolean>(sel.map((r) => [r.id, r.truth])),
  };
};

const HARD_PLAN: { set: keyof typeof CRIT; dataset: string; rows: [string, string][] }[] = [
  {
    set: 'relevancy',
    dataset: 'deepeval-heldout-relevancy',
    rows: [
      ['turn relevancy', 'Turn relevancy'],
      ['DAG', 'DAG, one node'],
    ],
  },
  { set: 'role', dataset: 'deepeval-heldout-role', rows: [['role adherence', 'Role adherence']] },
  {
    set: 'completeness',
    dataset: 'deepeval-heldout-completeness',
    rows: [['conversation completeness', 'Completeness']],
  },
  {
    set: 'grounding',
    dataset: 'deepeval-heldout-grounding',
    rows: [
      ['hallucination', 'Hallucination'],
      ['faithfulness', 'Faithfulness'],
    ],
  },
];
for (const plan of HARD_PLAN) {
  const criterion = criterionAt(PIN_HARD, CRIT[plan.set]);
  const cases = heldSets[plan.set]!;
  addDataset({
    name: plan.dataset,
    note: `Held-out hard set '${plan.set}' (${HARD}/sets-heldout.json, 72 cases), request as ${HARD}/render.mts heldout built it; criterion ${CRIT[plan.set]} and buildPrompt at ${PIN_HARD.slice(0, 9)}. README rows: ${plan.rows.map((r) => r[1]).join(', ')}.`,
    commit: PIN_HARD,
    cases,
    requestOf: (c) => hardRequest(criterion, c),
    storedPrompts: heldPrompts,
    storedPromptsSource: `${HARD}/baseline-prompts-heldout.json`,
    recordedKey: firstKey(heldRec.rows, (r) => r.set === plan.set),
    recordedKeySource: `${HARD}/baseline-heldout.json rows[].ours.request_sha256s[0] (sha256 of json.dumps(["haiku", system, user]))`,
  });
  pinNote(plan.dataset, PIN_HARD, CRIT[plan.set], {
    storedPromptsLastChange: lastTouch(`${HARD}/baseline-prompts-heldout.json`, HEAD),
    recordingLastChange: lastTouch(`${HARD}/baseline-heldout.json`, HEAD),
  });
  const caseIds = cases.map((c) => c.id);
  for (const [scoreRow, label] of plan.rows) {
    const m = correctMaps(heldRec.rows, scoreRow);
    if (m.ids.join() !== caseIds.join()) throw new Error(`${scoreRow}: id order differs from set`);
    for (const c of cases)
      if (m.truth.get(c.id) !== c.truth) throw new Error(`${scoreRow}: truth differs ${c.id}`);
    addRow({
      row: label,
      dataset: plan.dataset,
      ids: m.ids,
      peerSource: `${HARD}/baseline-heldout.json`,
      peer: m.peer,
      ours: m.ours,
      recorded: recScore(heldScores, scoreRow),
      extra: {
        scoreRow,
        scoresFile: `${HARD}/baseline-heldout-scores.json`,
        correctRule: 'prediction is truth; a null (unparsed) prediction counts wrong',
      },
    });
  }
}

// ---------- task completion, receipts held-out (72) ----------
{
  const sets = json(`${HARD}/sets-receipts-heldout.json`) as Record<string, Case[]>;
  const prompts = json(`${HARD}/baseline-prompts-receipts-heldout.json`);
  const rec = json(`${HARD}/baseline-task-receipts-heldout.json`);
  const scores = json(`${HARD}/baseline-task-receipts-heldout-scores.json`);
  const criterion = criterionAt(PIN_HARD, CRIT.task);
  const name = 'deepeval-heldout-task-receipts';
  addDataset({
    name,
    note: `Held-out receipts corpus (${HARD}/sets-receipts-heldout.json, 72 cases, tool receipts as tool_call/tool_result entries before the last turn), request as ${HARD}/render.mts heldout receipt built it; criterion ${CRIT.task} and buildPrompt at ${PIN_HARD.slice(0, 9)}. README row: Task completion.`,
    commit: PIN_HARD,
    cases: sets.task!,
    requestOf: (c) => hardRequest(criterion, c),
    storedPrompts: prompts,
    storedPromptsSource: `${HARD}/baseline-prompts-receipts-heldout.json`,
    recordedKey: firstKey(rec.rows, () => true),
    recordedKeySource: `${HARD}/baseline-task-receipts-heldout.json rows[].ours.request_sha256s[0]`,
  });
  pinNote(name, PIN_HARD, CRIT.task, {
    storedPromptsLastChange: lastTouch(`${HARD}/baseline-prompts-receipts-heldout.json`, HEAD),
    recordingLastChange: lastTouch(`${HARD}/baseline-task-receipts-heldout.json`, HEAD),
    note: 'Stored receipts prompts were written at 06c6d8b43, whose prompt.ts differs from the pin only in the core import specifier (@driftbench/core); its render.mts differs only in formatting and the default corpus.',
  });
  const m = correctMaps(rec.rows, 'task completion');
  addRow({
    row: 'Task completion',
    dataset: name,
    ids: m.ids,
    peerSource: `${HARD}/baseline-task-receipts-heldout.json`,
    peer: m.peer,
    ours: m.ours,
    recorded: recScore(scores, 'task completion'),
    extra: {
      scoreRow: 'task completion',
      scoresFile: `${HARD}/baseline-task-receipts-heldout-scores.json`,
      correctRule: 'prediction is truth; a null (unparsed) prediction counts wrong',
    },
  });
}

// ---------- G-Eval strict, fresh 480, response-relevance ----------
const LEAD = 'comparisons/deepeval/lead';
const fresh = json(`${LEAD}/sets-fresh.json`) as Record<string, Case[]>;
const freshScores = json(`${LEAD}/fresh-scores.json`) as any[];
const freshFreeze = json(`${LEAD}/fresh-freeze.json`);
{
  const run = json(`${LEAD}/fresh-retry.json`);
  const firstPass = json(`${LEAD}/fresh.json`);
  const criterion = criterionAt(PIN_LEAD, CRIT.relevancy);
  const name = 'deepeval-fresh-relevancy-response-relevance';
  const sel = run.rows.filter((r: any) => r.row === 'G-Eval strict');
  const recordedKey = new Map<string, string | undefined>(sel.map((r: any) => [r.id, r.ours.request_sha256]));
  addDataset({
    name,
    note: `Fresh relevancy set (${LEAD}/sets-fresh.json, 480 cases, seed 20261114), request as ${LEAD}/bridge.mts built it with setting response-relevance: assessment {kind: 'response-relevance'} is part of every request (opt-in, kept exactly). Criterion ${CRIT.relevancy} and packages/judges/src at ${PIN_LEAD.slice(0, 9)} (fresh-freeze.json). README row: G-Eval strict.`,
    commit: PIN_LEAD,
    cases: fresh.relevancy!,
    requestOf: (c) => leadRequest(criterion, c, 'response-relevance'),
    recordedKey,
    recordedKeySource: `${LEAD}/fresh-retry.json rows[row=G-Eval strict].ours.request_sha256`,
  });
  pinNote(name, PIN_LEAD, CRIT.relevancy, {
    setting: 'response-relevance',
    recordingLastChange: lastTouch(`${LEAD}/fresh-retry.json`, HEAD),
  });
  const ids = fresh.relevancy!.map((c) => c.id);
  const byId = new Map<string, any>(sel.map((r: any) => [r.id, r]));
  const firstById = new Map<string, any>(
    firstPass.rows.filter((r: any) => r.row === 'G-Eval strict').map((r: any) => [r.id, r]),
  );
  const sameAsFirst = ids.filter(
    (id) =>
      byId.get(id).ours.prediction === firstById.get(id)?.ours.prediction &&
      byId.get(id).theirs.prediction === firstById.get(id)?.theirs.prediction,
  ).length;
  const s = freshScores.find((x) => x.row === 'G-Eval strict');
  addRow({
    row: 'G-Eval strict',
    dataset: name,
    ids,
    peerSource: `${LEAD}/fresh-retry.json`,
    peer: new Map(ids.map((id) => [id, byId.get(id).theirs.prediction === byId.get(id).truth])),
    ours: new Map(ids.map((id) => [id, byId.get(id).ours.prediction === byId.get(id).truth])),
    recorded: { ours: s.ours, theirs: s.theirs, n: s.n },
    extra: {
      scoresFile: `${LEAD}/fresh-scores.json`,
      setting: 'response-relevance (opt-in)',
      test: 'exact paired test (two-sided, discordant pairs) with Holm over the two fresh rows (G-Eval strict, Knowledge retention)',
      recordedPairedP: s.paired_p,
      recordedHolmP: s.paired_p_holm,
      correctRule: 'prediction == truth; a null (unparsed or inconclusive) prediction counts wrong',
      firstPassAgreement: `${sameAsFirst} of 480 cases have the same predictions in fresh.json (first pass) and fresh-retry.json`,
    },
  });
}

// ---------- Knowledge retention, power 1272 ----------
{
  const POWER = `${LEAD}/power`;
  const sets = json(`${POWER}/sets-power.json`) as Record<string, Case[]>;
  const after = json(`${POWER}/api/retry/results.json`);
  const powerFreeze = json(`${POWER}/power-freeze.json`);
  const criterion = criterionAt(PIN_LEAD, CRIT.knowledge);
  const name = 'deepeval-power-knowledge';
  const byId = new Map<string, any>(after.rows.map((r: any) => [r.id, r]));
  const recordedKey = new Map<string, string | undefined>(
    after.rows.map((r: any) => [r.id, r.ours.request_sha256s?.[0]]),
  );
  const cases = sets.knowledge!;
  const items = addDataset({
    name,
    note: `Powered fresh knowledge set (${POWER}/sets-power.json, 1,272 cases, seed 20261214), request as ${LEAD}/bridge.mts built it with setting default (no assessment). Criterion ${CRIT.knowledge} and packages/judges/src at ${PIN_LEAD.slice(0, 9)} (power-freeze settings_freeze_commit). All 1,272 items kept; the README's 2 incomplete pairs are excluded only from the paired test (see rows). README row: Knowledge retention.`,
    commit: PIN_LEAD,
    cases,
    requestOf: (c) => leadRequest(criterion, c, 'default'),
    recordedKey,
    recordedKeySource: `${POWER}/api/retry/results.json rows[].ours.request_sha256s[0]`,
  });
  pinNote(name, PIN_LEAD, CRIT.knowledge, {
    setting: 'default',
    recordingLastChange: lastTouch(`${POWER}/api/retry/results.json`, HEAD),
  });
  const ids = items.map((i) => i.id);
  for (const c of cases)
    if (byId.get(c.id)?.truth !== c.truth) throw new Error(`knowledge truth differs ${c.id}`);
  const isBool = (v: unknown) => typeof v === 'boolean';
  const excluded = ids.filter(
    (id) => !isBool(byId.get(id).ours.prediction) || !isBool(byId.get(id).theirs.prediction),
  );
  const s = freshScores.find((x) => x.row === 'knowledge retention');
  addRow({
    row: 'Knowledge retention',
    dataset: name,
    ids,
    peerSource: `${POWER}/api/retry/results.json`,
    peer: new Map(ids.map((id) => [id, byId.get(id).theirs.prediction === byId.get(id).truth])),
    ours: new Map(ids.map((id) => [id, byId.get(id).ours.prediction === byId.get(id).truth])),
    recorded: { ours: s.ours, theirs: s.theirs, n: s.n },
    extra: {
      scoresFile: `${LEAD}/fresh-scores.json`,
      correctRule:
        'prediction == truth over all 1,272 scheduled cases; a missing (non-boolean) prediction counts not correct in these maps',
      exclusionRule:
        'Paired exact test runs only on pairs where both sides returned a boolean prediction (power_retry.available_summary); a missing answer is excluded from the test, never counted as an incorrect verdict. Holm over the two fresh rows.',
      excludedFromPairedTest: excluded,
      recordedPairedN: s.paired_n,
      recordedPairedP: s.paired_p,
      recordedHolmP: s.paired_p_holm,
      readmeNote: '2 incomplete pairs excluded',
    },
  });
  const rendered = render(PIN_LEAD, items);
  const pySha = (m: Map<string, { system: string; user: string }>) =>
    sha256(pyList([...m.keys()].sort().map((k) => [k, m.get(k)!.system, m.get(k)!.user])));
  const powerSha = pySha(rendered);
  equivalence.push({
    dataset: name,
    check: 'power-freeze.json prompts_sha256 over all 1,272 rendered prompts',
    expected: powerFreeze.prompts_sha256,
    actual: powerSha,
    identical: powerSha === powerFreeze.prompts_sha256,
  });
  // fresh-freeze driftbench_prompts_sha256 covers 960 prompts: 480 relevancy (response-relevance) + 480 fresh knowledge (default).
  const rel = criterionAt(PIN_LEAD, CRIT.relevancy);
  const jobs = [
    ...fresh.relevancy!.map((c) => ({ id: c.id, request: leadRequest(rel, c, 'response-relevance') })),
    ...fresh.knowledge!.map((c) => ({ id: c.id, request: leadRequest(criterion, c, 'default') })),
  ];
  const all = render(PIN_LEAD, jobs);
  const freshSha = pySha(all);
  equivalence.push({
    dataset: 'deepeval-fresh-relevancy-response-relevance',
    check:
      'fresh-freeze.json driftbench_prompts_sha256 over 960 rendered prompts (480 relevancy + 480 fresh knowledge)',
    expected: freshFreeze.state.driftbench_prompts_sha256,
    actual: freshSha,
    identical: freshSha === freshFreeze.state.driftbench_prompts_sha256,
  });
}

// ---------- pinned-tree proof for the lead pin: every packages/judges/src file vs fresh-freeze.json ----------
{
  const tree = extract(PIN_LEAD);
  const frozen = freshFreeze.state.package as Record<string, string>;
  const mismatched = Object.entries(frozen)
    .filter(([p, h]) => !existsSync(join(tree, p)) || sha256(readFileSync(join(tree, p))) !== h)
    .map(([p]) => p);
  const listed = git('ls-tree', '-r', '--name-only', PIN_LEAD, 'packages/judges/src')
    .toString()
    .trim()
    .split('\n');
  const extra = listed.filter((p) => !(p in frozen));
  equivalence.push({
    check: `packages/judges/src at ${PIN_LEAD.slice(0, 9)} vs fresh-freeze.json state.package`,
    files: Object.keys(frozen).length,
    identical: `${Object.keys(frozen).length - mismatched.length} of ${Object.keys(frozen).length} identical`,
    mismatched,
    notInFreeze: extra,
  });
}

// ---------- pins named elsewhere, and deviations ----------
{
  const same = (a: string, b: string, p: string) =>
    git('rev-parse', `${a}:${p}`).toString() === git('rev-parse', `${b}:${p}`).toString();
  const hardCrit = [CRIT.relevancy, CRIT.role, CRIT.completeness, CRIT.task, CRIT.grounding];
  const importOnly = (a: string) =>
    git('diff', '-U0', a, PIN_HARD, '--', 'packages/judges/src/prompt.ts')
      .toString()
      .split('\n')
      .filter((l) => /^[+-][^+-]/.test(l));
  equivalence.push({
    check: `alternative hard pins vs ${PIN_HARD.slice(0, 9)}`,
    '12801e1b9 (named in lead/README.md as the held-out freeze)': {
      criteriaIdentical: hardCrit.every((p) => same('12801e1b9', PIN_HARD, p)),
      promptTsChangedLines: importOnly('12801e1b9'),
    },
    '06c6d8b43 (wrote baseline-prompts-receipts-heldout.json)': {
      criteriaIdentical: hardCrit.every((p) => same('06c6d8b43', PIN_HARD, p)),
      promptTsChangedLines: importOnly('06c6d8b43'),
    },
  });
}
deviations.push(
  'Request construction is re-implemented in build.mts (hard/render.mts and lead/bridge.mts logic, same meaning), not by running those scripts; the hash equivalence above is the proof.',
  'The pinned packages/{judges,core,stats,artifacts,checks}/src trees are extracted to .pinned/<commit>/ (git archive) and loaded with tsx tsconfig paths; third-party modules (zod, yaml) and the YAML parser come from the current repo node_modules. They only affect parsing, and the equivalence check covers the result.',
  'Held-out hard pin is e1d3a4910 (last commit writing baseline-prompts-heldout.json, frozen in candidate-freeze.json). lead/README.md names 12801e1 for the same prompts; prompt.ts differs there only in the core import specifier and every criterion blob is identical, so the rendered text is the same.',
  'Shared driftbench requests inside a dataset: completeness 60 distinct of 72, grounding 45 of 72, task receipts 54 of 72 (as baseline-*-scores.json ours_distinct_inputs). No shared group has conflicting gold. Every item id is kept, so n equals the README; the driver will call each item separately.',
  'Knowledge retention: knowledge-other-person-7-b and knowledge-other-person-46-b have no driftbench verdict (invalid evidence references). They stay in the dataset, count not-correct in oldOursCorrect (sum 1270 = README), and are listed in excludedFromPairedTest for the paired test.',
  'G-Eval strict: lead/fresh-scores.json "run" reads "G-Eval strict" because lead/score.py reuses the loop variable `name`; its counts come from fresh-retry.json (the default input), which matches 474/451, and fresh.json agrees on all 480 G-Eval predictions.',
  'Hard rows count DeepEval by its is_successful() prediction (the README "theirs"), not baseline-heldout-scores.json strict_theirs (e.g. completeness 66, hallucination 65).',
  'Transport of the originals: the held-out hard rows and G-Eval strict fresh ran through `claude -p --model haiku`; Knowledge retention ran 2585 of 2606 main calls on the Messages API with claude-haiku-5-5 and 21 on the CLI. The v7 driver uses the Messages API only.',
  'Hallucination: one original driftbench answer was unparsed (ours_unparsed 1); it counts wrong in oldOursCorrect, as in the recorded score.',
);

if (rows.length !== 9) throw new Error(`expected 9 rows, got ${rows.length}`);
const manifest = { version: 1, model: 'claude-haiku-5-5', datasets, rows };
writeFileSync(join(HERE, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

const eqItems = equivalence.filter((e) => e.recordedRequestHashIdentical);
const totalItems = eqItems.reduce(
  (a, e) => a + Number(e.recordedRequestHashIdentical.split(' of ')[1].split(' ')[0]),
  0,
);
const identicalItems = eqItems.reduce(
  (a, e) => a + Number(e.recordedRequestHashIdentical.split(' of ')[0]),
  0,
);
const checks = {
  version: 1,
  repoHead: HEAD,
  generatedBy: 'build.mts (no network, no model call)',
  manifestSha256: sha256(readFileSync(join(HERE, 'manifest.json'))),
  pins: pinNotes,
  equivalence: {
    summary: `${identicalItems} of ${totalItems} items: rendered request hash identical to the recorded driftbench request hash`,
    details: equivalence,
  },
  totals: {
    summary: `${totals.filter((t) => t.theirsOk && t.oursOk && t.nMatchesRecorded).length} of ${totals.length} rows: sum(peerCorrect)==recorded theirs, sum(oldOursCorrect)==recorded ours, n==recorded n`,
    details: totals,
  },
  deviations,
};
writeFileSync(join(HERE, 'CHECKS.json'), `${JSON.stringify(checks, null, 2)}\n`);
console.log(
  JSON.stringify({
    equivalence: checks.equivalence.summary,
    totals: checks.totals.summary,
    datasets: datasets.map((d) => [d.name, d.items.length]),
  }),
);
