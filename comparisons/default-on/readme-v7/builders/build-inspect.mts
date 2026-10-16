// Lane `inspect`: README v7 manifest for the four Inspect held-out rows.
// Deterministic, no network, no model call. Reads committed repo files only (git show), writes into this folder.
// Run: node --import <repo>/node_modules/tsx/dist/loader.mjs build.mts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', 'wt-371c');
const HARD = 'comparisons/inspect/hard';
const PIN = '40aab09551e1b8702d576d3f28b63b12848cf572'; // MAIN_COMMIT in main-deciding.ts
const REF = 'HEAD';

const git = (...args: string[]) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
const show = (path: string, ref = REF) => git('show', `${ref}:${path}`);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const headCommit = git('rev-parse', 'HEAD').trim();
const dirty = git('status', '--porcelain', '--', HARD, 'packages/judges/src').trim();

type Case = {
  id: string;
  family: string;
  label: 'pass' | 'fail';
  question: string;
  expert: string;
  criterion: { name: string; rubric: string; pass: string; fail: string };
  submission: string;
};
type Result = { id: string; label: string; outcome: string; request_sha256: string[]; votes: string[] };
type Rec = { right: number; items: number; setSha256: string; results: Result[] };

// 1. Pinned buildPrompt: prompt.ts at the pinned commit, checked against the committed snapshot the run used.
const snapshot = JSON.parse(show(`${HARD}/deciding/main-snapshot.json`)) as {
  commit: string;
  files: { path: string; sha256: string; source: string }[];
};
if (snapshot.commit !== PIN) throw new Error('snapshot commit mismatch');
const promptSource = show('packages/judges/src/prompt.ts', PIN);
const snapPrompt = snapshot.files.find((f) => f.path === 'prompt.ts');
if (!snapPrompt || snapPrompt.source !== promptSource || sha(promptSource) !== snapPrompt.sha256)
  throw new Error('pinned prompt.ts differs from main-snapshot.json');
// prompt.ts imports `contentHash` from @driftbench/core (used only for PROMPT_FINGERPRINT, not by buildPrompt)
// and contract.ts as types only (erased). The core shim serves the pinned commit's spec/hash.ts.
const pinRoot = join(HERE, '.pinned');
mkdirSync(join(pinRoot, 'judges', 'src'), { recursive: true });
mkdirSync(join(pinRoot, 'node_modules', '@driftbench', 'core'), { recursive: true });
writeFileSync(join(pinRoot, 'judges', 'src', 'prompt.ts'), promptSource);
const coreDir = join(pinRoot, 'node_modules', '@driftbench', 'core');
writeFileSync(join(coreDir, 'package.json'), JSON.stringify({ type: 'module', exports: './index.ts' }));
writeFileSync(join(coreDir, 'hash.ts'), show('packages/core/src/spec/hash.ts', PIN));
writeFileSync(join(coreDir, 'index.ts'), "export { canonicalJson, contentHash } from './hash.ts';\n");
const pinned = await import(pathToFileURL(join(pinRoot, 'judges', 'src', 'prompt.ts')).href);
const buildPrompt = pinned.buildPrompt as (r: unknown) => { system: string; user: string };

// Current request shape (packages/judges/src/contract.ts at the worktree head).
const current = await import(pathToFileURL(join(REPO, 'packages/judges/src/contract.ts')).href);
const REQUEST_KEYS = new Set([
  'referenceDisagreement',
  'answerContract',
  'criterionDecoderVersion',
  'criterionPromptVersion',
  'dialect',
  'reasoning',
  'requirements',
  'assessment',
  'candidates',
  'presentation',
  'factAudit',
  'criterion',
  'system',
  'transcript',
  'artifact',
  'inputs',
  'given',
  'reference',
  'budget',
]);
const shapeOk = (request: { criterion: unknown; transcript: unknown[] }) =>
  Object.keys(request).every((k) => REQUEST_KEYS.has(k)) &&
  current.CriterionText.safeParse(request.criterion).success &&
  Array.isArray(request.transcript) &&
  request.transcript.every((e) => current.TranscriptEntry.safeParse(e).success);

// harness.ts requestSha256, verbatim.
const requestSha256 = (prompt: { system: string; user: string }, repeat: number) =>
  sha(JSON.stringify({ model: 'haiku', prompt, repeat }));
// main-deciding.ts mainRequest, verbatim shape: no reference, assessment, answerContract or system override.
const mainRequest = (c: Case) => ({
  criterion: c.criterion,
  transcript: [{ role: 'agent' as const, text: c.submission }],
});

// 2. Recordings: calls/part-*.jsonl (checked against calls/manifest.json) plus calls.jsonl.
const callsManifest = JSON.parse(show(`${HARD}/calls/manifest.json`)) as {
  parts: { file: string; sha256: string }[];
};
const recorded = new Map<
  string,
  { row: string; variant: string; id: string; repeat: number; prompt: unknown }
>();
let recordingLines = 0;
const partsChecked: string[] = [];
for (const part of callsManifest.parts) {
  const body = show(`${HARD}/calls/${part.file}`);
  if (sha(body) !== part.sha256) throw new Error(`recording part hash mismatch ${part.file}`);
  partsChecked.push(part.file);
  for (const line of body.split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    recordingLines++;
    recorded.set(r.request_sha256 ?? r.key, r);
  }
}
for (const line of show(`${HARD}/calls.jsonl`).split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  recordingLines++;
  recorded.set(r.request_sha256 ?? r.key, r);
}

// 3. Inputs, frozen hashes, recorded per-case results.
const freeze = JSON.parse(show(`${HARD}/heldout-freeze.json`)) as { sha256: Record<string, string> };
const summary = JSON.parse(show(`${HARD}/summary.json`)) as {
  rows: { row: string; records: { heldout: Record<string, Rec> } }[];
};
const chartData = show('.github/readme/src/chart-data.js');
const README_LABEL: Record<string, string> = {
  qa: 'Model-graded QA',
  fact: 'Model-graded fact',
  panel: 'Grader panel',
  borderline: 'Panel, borderline',
};
const REPEATS: Record<string, number> = { qa: 1, fact: 1, panel: 3, borderline: 3 };
const DATASET: Record<string, string> = {
  qa: 'inspect-heldout-qa-fact',
  fact: 'inspect-heldout-qa-fact',
  panel: 'inspect-heldout-panel',
  borderline: 'inspect-heldout-borderline',
};
const mapFactId = (id: string) => id.replace('-fact-', '-qa-');

const checks: Record<string, unknown> = {};
const inputChecks: string[] = [];
const equivalence: Record<string, unknown> = {};
const totals: Record<string, unknown> = {};
const shape: Record<string, unknown> = {};
const mismatches: string[] = [];
const datasets: Record<
  string,
  { name: string; baselines: object; optional: false; note: string; items: unknown[] }
> = {};
const rowsOut: unknown[] = [];

for (const row of ['qa', 'fact', 'panel', 'borderline']) {
  const file = `${row}-heldout.json`;
  const body = show(`${HARD}/${file}`);
  const cases = JSON.parse(body) as Case[];
  const rec = summary.rows.find((r) => r.row === row)!.records.heldout;
  const ours = rec.ours!;
  const theirs = rec.theirs!;
  if (sha(body) !== freeze.sha256[file]) throw new Error(`frozen hash mismatch ${file}`);
  if (ours.setSha256 !== sha(body) || theirs.setSha256 !== sha(body))
    throw new Error(`setSha256 mismatch ${row}`);
  for (const v of ['ours', 'theirs']) {
    const perRow = JSON.parse(show(`${HARD}/${row}-heldout-${v}.json`));
    if (JSON.stringify(perRow.results) !== JSON.stringify(rec[v]!.results))
      throw new Error(`summary.json ${row}/${v} differs from ${row}-heldout-${v}.json`);
  }
  inputChecks.push(
    `${file}: sha256 equals heldout-freeze.json and records.heldout.{ours,theirs}.setSha256; summary.json results equal ${row}-heldout-{ours,theirs}.json`,
  );
  if (cases.length !== 60 || new Set(cases.map((c) => c.id)).size !== 60) throw new Error(`n ${row}`);
  const oursById = new Map(ours.results.map((r) => [r.id, r]));
  const theirsById = new Map(theirs.results.map((r) => [r.id, r]));
  const dsName = DATASET[row]!;
  const idOf = (id: string) => (row === 'fact' ? mapFactId(id) : id);

  // Equivalence: render each request with the pinned buildPrompt, hash it per repeat, compare.
  let hashSame = 0,
    hashTotal = 0,
    promptSame = 0,
    promptTotal = 0,
    shapeSame = 0;
  for (const c of cases) {
    const request = mainRequest(c);
    if (shapeOk(request)) shapeSame++;
    else mismatches.push(`${row}/${c.id}: request not accepted by current CriterionText/TranscriptEntry`);
    const prompt = buildPrompt(request);
    const stored = oursById.get(c.id)?.request_sha256 ?? [];
    if (stored.length !== REPEATS[row]) mismatches.push(`${row}/${c.id}: ${stored.length} stored hashes`);
    for (let repeat = 0; repeat < REPEATS[row]!; repeat++) {
      hashTotal++;
      const mine = requestSha256(prompt, repeat);
      if (stored[repeat] === mine) hashSame++;
      else mismatches.push(`${row}/${c.id} repeat ${repeat}: rendered ${mine} stored ${stored[repeat]}`);
      promptTotal++;
      const call = recorded.get(stored[repeat] ?? '');
      if (call && JSON.stringify(call.prompt) === JSON.stringify(prompt) && call.repeat === repeat)
        promptSame++;
      else
        mismatches.push(`${row}/${c.id} repeat ${repeat}: recorded prompt ${call ? 'differs' : 'missing'}`);
    }
    if (!datasets[dsName]) {
      datasets[dsName] = {
        name: dsName,
        baselines: {},
        optional: false,
        note: '',
        items: [],
      };
    }
    if (row !== 'fact') datasets[dsName].items.push({ id: c.id, gold: c.label, request });
    else {
      // fact shares the qa dataset: same criterion, submission and label under the mapped id.
      const qaItem = datasets[dsName].items.find((i: any) => i.id === idOf(c.id)) as any;
      if (!qaItem || qaItem.gold !== c.label || JSON.stringify(qaItem.request) !== JSON.stringify(request))
        mismatches.push(`fact/${c.id}: does not equal dataset item ${idOf(c.id)}`);
    }
  }
  equivalence[row] = {
    requestHashes: `${hashSame} of ${hashTotal} identical`,
    recordedPrompts: `${promptSame} of ${promptTotal} identical`,
  };
  shape[row] = `${shapeSame} of ${cases.length} accepted`;

  const peerCorrect: Record<string, boolean> = {};
  const oldOursCorrect: Record<string, boolean> = {};
  for (const c of cases) {
    const t = theirsById.get(c.id),
      o = oursById.get(c.id);
    if (!t || !o || t.label !== c.label || o.label !== c.label)
      throw new Error(`per-case record ${row}/${c.id}`);
    peerCorrect[idOf(c.id)] = t.outcome === t.label;
    oldOursCorrect[idOf(c.id)] = o.outcome === o.label;
  }
  const sumPeer = Object.values(peerCorrect).filter(Boolean).length;
  const sumOurs = Object.values(oldOursCorrect).filter(Boolean).length;
  const label = README_LABEL[row]!;
  const chartIdx = chartData.indexOf(`"label": "${label}"`);
  const chartSlice = chartData.slice(chartIdx, chartIdx + 400);
  const chartTexts = [...chartSlice.matchAll(/"text": "(\d+)"/g)].map((m) => Number(m[1]));
  totals[row] = {
    peer: `${sumPeer} == recorded theirs ${theirs.right}: ${sumPeer === theirs.right}`,
    ours: `${sumOurs} == recorded ours ${ours.right}: ${sumOurs === ours.right}`,
    readmeChart: `chart-data.js "${label}" bars ${chartTexts.slice(0, 2).join(' / ')} (driftbench / Inspect) == ${ours.right} / ${theirs.right}: ${chartIdx >= 0 && chartTexts[0] === ours.right && chartTexts[1] === theirs.right}`,
  };
  if (sumPeer !== theirs.right || sumOurs !== ours.right) mismatches.push(`${row}: totals differ`);
  rowsOut.push({
    row: label,
    dataset: dsName,
    n: cases.length,
    peerSource: `${HARD}/summary.json rows[row=${row}].records.heldout.theirs (same results as ${HARD}/${row}-heldout-theirs.json)`,
    peerCorrect,
    oldOursCorrect,
    recorded: { ours: ours.right, theirs: theirs.right, n: cases.length },
    ...(row === 'fact'
      ? {
          idMapping:
            'Keys are dataset ids: fact case heldout-20261013-fact-<rest> = dataset item heldout-20261013-qa-<rest> (identical criterion, submission, label and driftbench request_sha256).',
        }
      : {}),
  });
  if (row === 'fact') {
    const qaOurs = summary.rows.find((r) => r.row === 'qa')!.records.heldout.ours!;
    const qaBy = new Map(qaOurs.results.map((r) => [r.id, r]));
    let same = 0;
    for (const r of ours.results) {
      const q = qaBy.get(mapFactId(r.id));
      if (
        q &&
        JSON.stringify(q.request_sha256) === JSON.stringify(r.request_sha256) &&
        q.outcome === r.outcome
      )
        same++;
      else mismatches.push(`fact/${r.id}: driftbench request or outcome differs from qa twin`);
    }
    checks.qaFactShared = `${same} of ${ours.results.length} fact cases have the same driftbench request_sha256 and outcome as their qa twin`;
  }
}

// Identical driftbench requests across datasets (the original cache served them from one recording).
const seen = new Map<string, string>();
const crossDuplicates: string[] = [];
for (const d of Object.values(datasets))
  for (const item of d.items as { id: string; gold: string; request: unknown }[]) {
    const key = JSON.stringify(item.request);
    const prior = seen.get(key);
    if (prior)
      crossDuplicates.push(`${d.name}/${item.id} (gold ${item.gold}) has the same request as ${prior}`);
    else seen.set(key, `${d.name}/${item.id} (gold ${item.gold})`);
  }
checks.crossDatasetDuplicateRequests = crossDuplicates;

datasets['inspect-heldout-qa-fact']!.note =
  'Inspect hard held-out (seed 20261013), rows qa and fact: 60 cases. Driftbench request = mainRequest(c) of comparisons/inspect/hard/main-deciding.ts (criterion + one agent transcript line; the trusted reference sits inside criterion.rubric; no reference/assessment/system field), rendered originally by buildPrompt pinned at 40aab095. The fact row reused the qa recordings byte for byte (same request hashes, 0 fresh calls). One call per case originally. gold = case label (scorer counted outcome === label; inconclusive = wrong).';
datasets['inspect-heldout-panel']!.note =
  'Inspect hard held-out (seed 20261013), row panel: 60 cases. Driftbench request = mainRequest(c) of main-deciding.ts, pinned buildPrompt 40aab095. Originally BOTH sides made 3 calls per case (run.mts repeats = 3 for panel/borderline, for ours and theirs): ours sent the identical prompt 3 times (repeat 0,1,2 only enter the cache key) and took harness.panel() = weightedPanel equal-weight majority, split -> inconclusive. v7 receives ONE request per case; createDefaultJudge makes its own internal calls. gold = case label.';
datasets['inspect-heldout-borderline']!.note =
  'Inspect hard held-out (seed 20261013), row borderline: 60 cases. Same request form and same 3-call majority on both original sides as the panel row; v7 receives ONE request per case and makes its own internal calls. gold = case label.';

const manifest = {
  version: 1,
  model: 'claude-haiku-5-5',
  datasets: Object.values(datasets),
  rows: rowsOut,
};
writeFileSync(join(HERE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const out = {
  lane: 'inspect',
  source: {
    repo: 'SP/wt-371c',
    commit: headCommit,
    readFrom: 'git show HEAD:<path>',
    dirtyInputs: dirty || 'none',
  },
  pinnedBuildPrompt: {
    commit: PIN,
    file: 'packages/judges/src/prompt.ts',
    sha256: sha(promptSource),
    equalsMainSnapshot: true,
    coreShim:
      '@driftbench/core resolved to packages/core/src/spec/hash.ts at the pinned commit (contentHash only; not used by buildPrompt)',
  },
  recordings: { parts: partsChecked, partHashesEqualCallsManifest: true, lines: recordingLines },
  inputs: inputChecks,
  equivalence,
  totals,
  requestShapeCurrent: shape,
  ...checks,
  mismatches,
  manifestSha256: sha(readManifest()),
};
function readManifest() {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
writeFileSync(join(HERE, 'CHECKS.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  JSON.stringify({ equivalence, totals, shape, ...checks, mismatches: mismatches.length }, null, 1),
);
