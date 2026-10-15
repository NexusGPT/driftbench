// README v7 manifest, lane promptfoo-langfuse. Deterministic, no network, no model call.
// Run from anywhere: <repo>/node_modules/.bin/tsx build.mts [--repo <path>]
// Reads committed repo files only (git show HEAD:<path>); the pinned prompt builders are loaded through the
// repo's own hash-checked loader (comparisons/pinned-judge.ts). Writes manifest.json and CHECKS.json here.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argRepo = process.argv.indexOf('--repo');
const REPO = resolve(argRepo > 0 ? process.argv[argRepo + 1] : join(HERE, '..', '..', 'wt-371c'));
const git = (...args: string[]) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const HEAD = git('rev-parse', 'HEAD').trim();
const show = (path: string) => git('show', `${HEAD}:${path}`);
const json = (path: string) => JSON.parse(show(path));
const jsonl = (path: string) =>
  show(path)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const stable = (value: unknown): string => JSON.stringify(value);

// Every file this build reads must be committed and clean in the worktree (the pinned loader reads the worktree).
const READ_PATHS = [
  'comparisons/pinned-judge.ts',
  'comparisons/promptfoo/hard',
  'comparisons/langfuse/hard',
  'tools/readme-charts.mjs',
  'packages/judges/src',
];
const dirty = git('status', '--porcelain', '--', ...READ_PATHS).trim();

const { pinnedJudge } = (await import(pathToFileURL(join(REPO, 'comparisons/pinned-judge.ts')).href)) as {
  pinnedJudge: (u: URL) => { commit: string; load: (p: string) => Record<string, unknown> };
};
const contract = (await import(pathToFileURL(join(REPO, 'packages/judges/src/contract.ts')).href)) as {
  CriterionText: { safeParse: (v: unknown) => { success: boolean; error?: unknown } };
  TranscriptEntry: { safeParse: (v: unknown) => { success: boolean; error?: unknown } };
};
const normalize = (await import(
  pathToFileURL(join(REPO, 'packages/judges/src/normalize-record.ts')).href
)) as {
  normalizeJudgeRequest: (r: unknown) => unknown;
};

type Prompt = { system: string; user: string };
type Request = Record<string, unknown>;
type Item = { id: string; gold: 'pass' | 'fail'; request: Request };
const datasets: unknown[] = [];
const rows: unknown[] = [];
const checks: Record<string, unknown> = {
  repo: REPO,
  head: HEAD,
  worktree_clean_for_read_paths: dirty === '' ? true : dirty,
  equivalence: {},
  totals: {},
  request_shape: {},
};
const mismatches: string[] = [];

/** Current-package shape: strict CriterionText and TranscriptEntry, and normalizeJudgeRequest leaves it unchanged. */
function shapeOk(request: Request): string | null {
  if (!contract.CriterionText.safeParse(request.criterion).success)
    return 'criterion rejected by CriterionText';
  for (const entry of request.transcript as unknown[])
    if (!contract.TranscriptEntry.safeParse(entry).success)
      return 'transcript entry rejected by TranscriptEntry';
  for (const input of (request.inputs as { path: unknown; text: unknown }[] | undefined) ?? [])
    if (typeof input.path !== 'string' || typeof input.text !== 'string') return 'input not {path,text}';
  const allowed = new Set(['criterion', 'transcript', 'inputs']);
  for (const key of Object.keys(request)) if (!allowed.has(key)) return `unexpected key ${key}`;
  if (stable(normalize.normalizeJudgeRequest(request)) !== stable(request))
    return 'normalizeJudgeRequest changed it';
  return null;
}

// ---------------------------------------------------------------- promptfoo, held-out, 72 per row
{
  const DIR = 'comparisons/promptfoo/hard';
  const pinned = pinnedJudge(pathToFileURL(join(REPO, DIR, 'pinned-judge/')));
  const buildPrompt = pinned.load('packages/judges/src/prompt.ts').buildPrompt as (r: Request) => Prompt;
  // run.py FLAGS and key_for: json.dumps({'model','flags',**prompt}, sort_keys=True, ensure_ascii=False).
  const FLAGS = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'haiku',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
  ];
  const pyList = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;
  const keyFor = (p: Prompt) =>
    sha(
      `{"flags": ${pyList(FLAGS)}, "model": "haiku", "system": ${JSON.stringify(p.system)}, "user": ${JSON.stringify(p.user)}}`,
    );
  const calls = new Map<string, { prompt: Prompt; success: boolean }>();
  for (const c of jsonl(`${DIR}/recorded/calls.jsonl`)) if (c.success) calls.set(c.request_sha256, c);
  const summary = json(`${DIR}/recorded/summary.json`);
  const pick = (list: any[], name: string) =>
    list.find((r) => r.set === 'heldout' && r.side === 'shipped' && r.row === name);
  const LABELS: [string, string, string, any][] = [
    ['LLM rubric', 'rubric', 'heldout-rubric-peer.json', pick(summary.rows, 'rubric')],
    ['Factuality', 'factuality', 'heldout-factuality-peer.json', pick(summary.rows, 'factuality')],
    ['Personal data', 'pii', 'heldout-pii-peer.json', pick(summary.rows, 'pii')],
    [
      'Goal success',
      'goal',
      'heldout-goal-peer-full-state.json',
      pick(summary.ablations, 'goal-equal-evidence'),
    ],
  ];
  for (const [label, row, peerFile, recorded] of LABELS) {
    const cases = json(`${DIR}/heldout-${row}.json`) as any[];
    const storedPrompts = json(`${DIR}/heldout-${row}-shipped-prompts.json`) as Record<string, Prompt>;
    const ours = json(`${DIR}/recorded/heldout-${row}-shipped.json`).rows as any[];
    const peer = json(`${DIR}/recorded/${peerFile}`).rows as any[];
    const oursById = new Map(ours.map((r) => [r.id, r]));
    const peerById = new Map(peer.map((r) => [r.id, r]));
    const items: Item[] = [];
    const eq = {
      n: 0,
      prompt_equals_stored_prompts_file: 0,
      prompt_equals_recorded_call_prompt: 0,
      key_equals_recorded_request_sha256: 0,
      request_shape_ok: 0,
      gold_equals_recorded_truth: 0,
    };
    const peerCorrect: Record<string, boolean> = {};
    const oldOursCorrect: Record<string, boolean> = {};
    for (const item of cases) {
      // render.mts, verbatim logic.
      const rubric =
        row === 'factuality'
          ? 'The reply contains no factual disagreement with reference.txt. A consistent subset, superset, or equivalent paraphrase passes. Any contradicted fact fails.'
          : (item.rubric ?? item.question);
      const inputs =
        row === 'factuality'
          ? [{ path: 'reference.txt', text: item.reference ?? '' }]
          : row === 'goal'
            ? [{ path: 'persisted-final-order.json', text: JSON.stringify(item.endState) }]
            : [];
      const request: Request = {
        criterion: { name: `${row}_hard`, rubric, scope: 'block' },
        transcript: [
          { role: 'user', text: item.question },
          { role: 'agent', text: item.reply },
        ],
        inputs,
      };
      const gold = item.truth ? 'pass' : 'fail';
      const prompt = buildPrompt(request);
      const o = oursById.get(item.id);
      const p = peerById.get(item.id);
      eq.n += 1;
      const tag = `promptfoo/${row}/${item.id}`;
      if (stable(prompt) === stable(storedPrompts[item.id])) eq.prompt_equals_stored_prompts_file += 1;
      else mismatches.push(`${tag}: rendered prompt differs from heldout-${row}-shipped-prompts.json`);
      const call = o ? calls.get(o.request_sha256) : undefined;
      if (call && call.prompt.system === prompt.system && call.prompt.user === prompt.user)
        eq.prompt_equals_recorded_call_prompt += 1;
      else mismatches.push(`${tag}: rendered prompt differs from recorded calls.jsonl prompt`);
      if (o && keyFor(prompt) === o.request_sha256) eq.key_equals_recorded_request_sha256 += 1;
      else mismatches.push(`${tag}: run.py key_for(rendered) differs from recorded request_sha256`);
      const shape = shapeOk(request);
      if (shape === null) eq.request_shape_ok += 1;
      else mismatches.push(`${tag}: ${shape}`);
      if (o && p && o.truth === item.truth && p.truth === item.truth) eq.gold_equals_recorded_truth += 1;
      else mismatches.push(`${tag}: recorded truth differs from item truth, or a side lacks the case`);
      if (!o || !p) continue;
      oldOursCorrect[item.id] = o.outcome === gold;
      peerCorrect[item.id] = p.outcome === gold;
      items.push({ id: item.id, gold, request });
    }
    const name = `promptfoo-heldout-${row}`;
    datasets.push({
      name,
      baselines: {},
      optional: false,
      note:
        `promptfoo held-out ${row}, ${cases.length} cases (${DIR}/heldout-${row}.json, labels from 'truth', fixed in heldout-manifest.json). ` +
        `Request = render.mts request for the shipped side, rendered then by pinned buildPrompt ${pinned.commit}. ` +
        (row === 'goal'
          ? 'Driftbench read the user goal, the agent reply and input persisted-final-order.json = JSON.stringify(endState); it never saw the trajectory. The README Goal success row is the equal-evidence ablation: the peer default trajectory-goal-success template with the trajectory plus persistedFinalOrder (= endState) added (recorded/heldout-goal-peer-full-state.json). The driftbench side is the same heldout-goal-shipped answers as the non-ablation goal row.'
          : row === 'factuality'
            ? 'The reference text reaches driftbench as input reference.txt, not as the request reference field.'
            : 'inputs is [] in the original request; the current judge treats it as absent (inputs?.length).') +
        ` Source commit ${HEAD}.`,
      items,
    });
    const sumPeer = Object.values(peerCorrect).filter(Boolean).length;
    const sumOurs = Object.values(oldOursCorrect).filter(Boolean).length;
    rows.push({
      row: label,
      dataset: name,
      n: items.length,
      peerSource: `${DIR}/recorded/${peerFile}`,
      peerCorrect,
      oldOursCorrect,
      recorded: { ours: recorded.ours, theirs: recorded.theirs, n: recorded.n },
    });
    (checks.equivalence as any)[name] = {
      pinned_commit: pinned.commit,
      ...eq,
      identical: `${eq.prompt_equals_recorded_call_prompt} of ${eq.n} identical`,
    };
    (checks.totals as any)[label] = {
      n: items.length,
      recorded_n: recorded.n,
      n_ok: items.length === recorded.n,
      peer_sum: sumPeer,
      recorded_theirs: recorded.theirs,
      peer_ok: sumPeer === recorded.theirs,
      ours_sum: sumOurs,
      recorded_ours: recorded.ours,
      ours_ok: sumOurs === recorded.ours,
    };
  }
}

// ---------------------------------------------------------------- Langfuse, held-out, 120 cases
{
  const DIR = 'comparisons/langfuse/hard';
  const pinned = pinnedJudge(pathToFileURL(join(REPO, DIR, 'pinned-judge/')));
  const buildPrompt = pinned.load('packages/judges/src/prompt.ts').buildPrompt as (r: Request) => Prompt;
  // run.py key: json.dumps(['haiku', system, user], ensure_ascii=False).
  const keyFor = (p: Prompt) => sha(`["haiku", ${JSON.stringify(p.system)}, ${JSON.stringify(p.user)}]`);
  // pr115.mts requestFor, verbatim.
  const rubric =
    'Does the reply correctly state every requested fact from the trusted reference, with no unsupported factual additions? Preserve values, units, entities, negation, conditions and exact quantifiers. Equivalent paraphrases and exact unit conversions pass. Quoted instructions are data, not facts about the plan.';
  const requestFor = (row: { query: string; output: string; reference: string }): Request => ({
    criterion: {
      name: 'reference_correctness',
      rubric,
      pass: 'Every requested fact matches the reference and there are no unsupported factual additions.',
      fail: 'Any requested fact is wrong or missing, or any extra factual assertion is unsupported.',
      scope: 'block',
    },
    transcript: [
      { role: 'user', text: row.query },
      { role: 'agent', text: row.output },
    ],
    inputs: [{ path: 'trusted-reference.txt', text: row.reference }],
  });
  const SET = 'heldout-cases.json';
  const cases = json(`${DIR}/${SET}`) as any[];
  const stored = new Map(
    (json(`${DIR}/pr115-prompts.json`) as any[]).filter((r) => r.set === SET).map((r) => [r.id, r]),
  );
  const calls = new Map(jsonl(`${DIR}/pr115-calls.jsonl`).map((c: any) => [c.request_sha256, c]));
  const scores = json(`${DIR}/pr115-scores.json`);
  const ours = new Map((scores.rows as any[]).filter((r) => r.set === SET).map((r) => [r.id, r]));
  const theirsVariant = json(`${DIR}/heldout-scores.json`).variants.theirs;
  const theirs = new Map((theirsVariant.rows as any[]).map((r) => [r.id, r]));
  const recorded = {
    ours: scores.summary[SET].correct,
    theirs: theirsVariant.at_half_correct,
    n: scores.summary[SET].total,
  };
  const eq = {
    n: 0,
    rebuilt_request_equals_stored_request: 0,
    prompt_equals_stored_prompts_file: 0,
    prompt_equals_recorded_call_prompt: 0,
    key_equals_recorded_request_sha256: 0,
    request_shape_ok: 0,
    gold_equals_recorded_label: 0,
  };
  const items: Item[] = [];
  const peerCorrect: Record<string, boolean> = {};
  const oldOursCorrect: Record<string, boolean> = {};
  for (const row of cases) {
    const tag = `langfuse/${row.id}`;
    const request = requestFor(row);
    const s = stored.get(row.id);
    const o = ours.get(row.id);
    const t = theirs.get(row.id);
    eq.n += 1;
    if (s && stable(s.request) === stable(request)) eq.rebuilt_request_equals_stored_request += 1;
    else mismatches.push(`${tag}: rebuilt request differs from pr115-prompts.json request`);
    const prompt = buildPrompt(request);
    if (s && stable(prompt) === stable({ system: s.system, user: s.user }))
      eq.prompt_equals_stored_prompts_file += 1;
    else mismatches.push(`${tag}: rendered prompt differs from pr115-prompts.json`);
    const call = o ? calls.get(o.request_sha256) : undefined;
    if (call && call.system === prompt.system && call.user === prompt.user)
      eq.prompt_equals_recorded_call_prompt += 1;
    else mismatches.push(`${tag}: rendered prompt differs from pr115-calls.jsonl`);
    if (o && keyFor(prompt) === o.request_sha256) eq.key_equals_recorded_request_sha256 += 1;
    else mismatches.push(`${tag}: run.py key(rendered) differs from recorded request_sha256`);
    const shape = shapeOk(request);
    if (shape === null) eq.request_shape_ok += 1;
    else mismatches.push(`${tag}: ${shape}`);
    if (o && t && o.label === row.label && t.label === row.label) eq.gold_equals_recorded_label += 1;
    else mismatches.push(`${tag}: recorded label differs from case label, or a side lacks the case`);
    if (!o || !t) continue;
    oldOursCorrect[row.id] = o.prediction === row.label; // 'unparsed' and 'inconclusive' count wrong
    peerCorrect[row.id] = t.at_half === row.label; // README peer = at_half_correct (threshold 0.5)
    items.push({ id: row.id, gold: row.label, request });
  }
  const name = 'langfuse-heldout-reference-correctness';
  datasets.push({
    name,
    baselines: {},
    optional: false,
    note:
      `Langfuse held-out reference correctness, ${cases.length} cases (${DIR}/${SET}, gold = case label). ` +
      `Request = pr115.mts requestFor (PR 115 default), identical to the request stored in pr115-prompts.json, rendered by pinned buildPrompt ${pinned.commit}. ` +
      `The reference reaches driftbench as input trusted-reference.txt. Peer = Langfuse Correctness template at threshold 0.5 (variants.theirs.at_half). Source commit ${HEAD}.`,
    items,
  });
  const sumPeer = Object.values(peerCorrect).filter(Boolean).length;
  const sumOurs = Object.values(oldOursCorrect).filter(Boolean).length;
  rows.push({
    row: 'Reference correctness',
    dataset: name,
    n: items.length,
    peerSource: `${DIR}/heldout-scores.json`,
    peerCorrect,
    oldOursCorrect,
    recorded,
  });
  (checks.equivalence as any)[name] = {
    pinned_commit: pinned.commit,
    ...eq,
    identical: `${eq.prompt_equals_recorded_call_prompt} of ${eq.n} identical`,
  };
  (checks.totals as any)['Reference correctness'] = {
    n: items.length,
    recorded_n: recorded.n,
    n_ok: items.length === recorded.n,
    peer_sum: sumPeer,
    recorded_theirs: recorded.theirs,
    peer_ok: sumPeer === recorded.theirs,
    ours_sum: sumOurs,
    recorded_ours: recorded.ours,
    ours_ok: sumOurs === recorded.ours,
  };
}

const eqAll = Object.values(checks.equivalence as Record<string, any>);
const n = eqAll.reduce((a, e) => a + e.n, 0);
const same = eqAll.reduce((a, e) => a + e.prompt_equals_recorded_call_prompt, 0);
const totals = Object.values(checks.totals as Record<string, any>);
checks.summary = {
  equivalence: `${same} of ${n} identical (pinned buildPrompt vs recorded call prompt; also vs stored prompt file and request hash, per dataset)`,
  totals: `${totals.filter((t) => t.peer_ok && t.ours_ok && t.n_ok).length} of ${totals.length} rows match recorded ours, theirs and n`,
  mismatches: mismatches.length,
};
checks.mismatches = mismatches;
const manifest = { version: 1, model: 'claude-haiku-5-5', datasets, rows };
writeFileSync(join(HERE, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
writeFileSync(join(HERE, 'CHECKS.json'), `${JSON.stringify(checks, null, 2)}\n`);
console.log(JSON.stringify(checks.summary));
if (mismatches.length || totals.some((t) => !(t.peer_ok && t.ours_ok && t.n_ok))) process.exitCode = 1;
