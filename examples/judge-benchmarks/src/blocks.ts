import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detect } from '../../../packages/checks/src/support/language';
import { CallFailed, createCaller, Recordings, SpendCapReached, type Caller } from './call';
import { loadBenchmark, type PairItem, type PointItem, splitOf } from './data';
import { extractPython, pythonOutput } from './extras';
import { alignedBlockView } from './wp-segments';

/**
 * Block-native judging for the long benchmarks.
 *
 * driftbench evaluates a conversation as a succession of blocks: each block has its initial conditions
 * (Given), its stimulus (When) and its expected output (Then). Machine checks run first and a machine fail is
 * final; judged criteria apply per block; the verdict is computed in code from the block verdicts.
 *
 * Here the same model is applied to one long answer:
 * - verify: the answer is compiled into derivation blocks. Each block states its Given (the facts it reads,
 *   from the question or an earlier block) and its Then (the claimed output state). Arithmetic blocks carry a
 *   program that is run as a machine check; the other blocks are judged one by one by a narrow judge that
 *   sees the question and the blocks, never the persuasive narrative. The first failing block decides.
 * - writing: the request alone, blind to both drafts, is compiled into requirement blocks with their expected
 *   content and, where an ask is checkable, a machine check (language, length). Machine checks run first; a
 *   draft that fails a hard check loses that block unless both fail. A narrow pairwise judge then gives a
 *   winner per block, in both presentation orders; code aggregates the block winners.
 */

const ROOT = join(import.meta.dirname, '..');
const LEDGER =
  '/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]!();
      }
    }),
  );
  return out;
}

/** The first JSON object in a model answer, or undefined. */
export function parseJson(text: string): Record<string, unknown> | undefined {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- verify

export type DerivationBlock = {
  id: string;
  kind: 'reading' | 'arithmetic' | 'logic' | 'conclusion';
  given: string;
  claim: string;
  check?: string;
};

const COMPILE_SYSTEM =
  'You compile a worked answer into a chain of derivation blocks, like unit tests. You do not judge it. You copy what the answer claims, faithfully, including its mistakes. Output only JSON.';

function compilePrompt(item: PointItem) {
  return {
    system: COMPILE_SYSTEM,
    user: `Question:\n${item.question}\n\nAnswer to compile:\n${item.response}\n\nCompile the reasoning that leads to the answer's committed final answer into at most 8 blocks, in order. Skip abandoned attempts; keep the path the final answer actually rests on. Each block is one step:\n- kind: "reading" (the answer turns words of the question into quantities, conditions or rules), "arithmetic" (a calculation), "logic" (a deduction or rule application), or "conclusion" (the committed final answer as a reply to what the question asks).\n- given: the inputs the step uses, quoted or restated exactly as the answer uses them, and where each comes from (the question, or an earlier block id).\n- claim: the output the answer states for this step, copied exactly, wrong or not.\n- check: only for arithmetic blocks, a short self-contained Python 3 program (standard library, exact Fractions where possible) that recomputes the claim from the given values and prints PASS when the claim is arithmetically right, FAIL otherwise. Otherwise null.\nThe last block must be the conclusion block. If the answer commits to no final answer, return an empty final_answer.\n\nReturn: {"final_answer": "...", "blocks": [{"id": "b1", "kind": "...", "given": "...", "claim": "...", "check": null}]}`,
  };
}

const BLOCK_JUDGE_SYSTEM =
  'You judge derivation blocks one at a time, like unit tests. Each block is judged on its own: given its inputs, is its claim right? You are strict on facts and permissive on presentation. Output only JSON.';

function blockJudgePrompt(item: PointItem, finalAnswer: string, blocks: DerivationBlock[]) {
  const listed = blocks
    .map((b) => `${b.id} [${b.kind}]\n  Given: ${b.given}\n  Claim: ${b.claim}`)
    .join('\n');
  return {
    system: BLOCK_JUDGE_SYSTEM,
    user: `Question:\n${item.question}\n\nDerivation blocks taken from a submitted answer:\n${listed}\n\nCommitted final answer: ${finalAnswer}\n\nJudge each block alone.\n- reading: pass when the given matches what the question states, with no unstated assumption, invented quantity, or misread condition that the question does not support. A count of indivisible objects must be a whole number. Fail when the step adds a premise the question does not give, or changes its meaning.\n- arithmetic and logic: pass when the claim follows exactly from the given; for rules, every antecedent must hold.\n- conclusion: pass when the committed final answer is what the question asks for, in the requested form, and is correct. Solve the question yourself, carefully and independently, before judging this block; check every requested part.\nUse "inconclusive" only when the block cannot be judged from what is shown.\n\nReturn: {"blocks": [{"id": "b1", "verdict": "pass" | "fail" | "inconclusive", "why": "one sentence"}]}`,
  };
}

type VerifyOutcome = {
  id: string;
  label: boolean;
  pass: boolean | undefined;
  decidedBy: string;
  machineFail: boolean;
  judgedFail: boolean;
  blocks: number;
  costUsd: number;
};

async function verifyItem(item: PointItem, caller: Caller): Promise<VerifyOutcome> {
  let cost = 0;
  const base = { id: item.id, label: item.correct, machineFail: false, judgedFail: false, blocks: 0 };
  const compiled = await caller.call(compilePrompt(item), {
    bench: 'longjudge-verify',
    contestant: 'driftbench-blocks',
    item: item.id,
    order: 'compile',
  });
  cost += compiled.costUsd;
  const parsed = parseJson(compiled.text);
  const finalAnswer = typeof parsed?.final_answer === 'string' ? parsed.final_answer.trim() : '';
  const blocks = (Array.isArray(parsed?.blocks) ? parsed!.blocks : []) as DerivationBlock[];
  if (!parsed) return { ...base, pass: undefined, decidedBy: 'compile-unparsed', costUsd: cost };
  // Machine check 1: an answer with no committed final answer fails.
  if (finalAnswer === '')
    return { ...base, pass: false, decidedBy: 'machine:no-final-answer', machineFail: true, costUsd: cost };
  // Machine checks 2: arithmetic blocks run their program; FAIL is final for that block.
  const machine = new Map<string, 'pass' | 'fail'>();
  for (const b of blocks) {
    if (b.kind !== 'arithmetic' || typeof b.check !== 'string' || b.check.trim() === '') continue;
    const code = extractPython(b.check) ?? b.check;
    const out = await pythonOutput(code, 'python3', true);
    const last = out?.trim().split('\n').at(-1)?.trim();
    if (last === 'PASS') machine.set(b.id, 'pass');
    else if (last === 'FAIL') machine.set(b.id, 'fail');
  }
  const judged = await caller.call(blockJudgePrompt(item, finalAnswer, blocks), {
    bench: 'longjudge-verify',
    contestant: 'driftbench-blocks',
    item: item.id,
    order: 'judge',
  });
  cost += judged.costUsd;
  const verdicts = new Map<string, string>();
  const jp = parseJson(judged.text);
  for (const v of (Array.isArray(jp?.blocks) ? jp!.blocks : []) as { id: string; verdict: string }[])
    verdicts.set(String(v.id), String(v.verdict));
  // The first failing block decides, in chain order. A machine fail is final; a machine pass is not
  // overturned by the judge.
  for (const b of blocks) {
    const m = machine.get(b.id);
    if (m === 'fail')
      return { ...base, blocks: blocks.length, pass: false, decidedBy: `machine:${b.id}`, machineFail: true, costUsd: cost };
    if (m === 'pass') continue;
    if (verdicts.get(b.id) === 'fail')
      return { ...base, blocks: blocks.length, pass: false, decidedBy: `judge:${b.id}:${b.kind}`, judgedFail: true, costUsd: cost };
  }
  if (!jp) return { ...base, blocks: blocks.length, pass: undefined, decidedBy: 'judge-unparsed', costUsd: cost };
  return { ...base, blocks: blocks.length, pass: true, decidedBy: 'all-blocks-pass', costUsd: cost };
}

const RECOVERY_SYSTEM =
  'You trace one failed derivation block forward, like a drift and recovery check. A step can be wrong while the answer recovers later. Output only JSON.';

function recoveryPrompt(item: PointItem, finalAnswer: string, blocks: DerivationBlock[], failed: DerivationBlock, why: string) {
  const listed = blocks.map((b) => `${b.id} [${b.kind}]\n  Given: ${b.given}\n  Claim: ${b.claim}`).join('\n');
  return {
    system: RECOVERY_SYSTEM,
    user: `Question:\n${item.question}\n\nDerivation blocks taken from a submitted answer:\n${listed}\n\nCommitted final answer: ${finalAnswer}\n\nA reviewer marked block ${failed.id} as failing: ${why}\n\nFirst decide whether that criticism is right; a reviewer can be wrong. If it is right, correct block ${failed.id} and carry the correction through every later block that depends on it. Then decide whether the committed final answer is still exactly what the question asks for and correct. Only the committed final answer counts: an intermediate error that does not change it is recovered.\n\nReturn: {"criticism_right": true | false, "corrected_final": "...", "final_holds": true | false, "why": "one sentence"}`,
  };
}

/** Drift and recovery on a judged block fail: the item fails only when the failure reaches the final answer. */
async function verifyRecovery(item: PointItem, caller: Caller) {
  const first = await verifyItem(item, caller);
  if (!first.decidedBy.startsWith('judge:')) return { ...first, recovered: undefined as boolean | undefined, recoveryCostUsd: 0 };
  const compiled = await caller.call(compilePrompt(item), { bench: 'longjudge-verify', contestant: 'driftbench-blocks', item: item.id, order: 'compile' });
  const parsed = parseJson(compiled.text)!;
  const finalAnswer = String(parsed.final_answer).trim();
  const blocks = parsed.blocks as DerivationBlock[];
  const judged = await caller.call(blockJudgePrompt(item, finalAnswer, blocks), { bench: 'longjudge-verify', contestant: 'driftbench-blocks', item: item.id, order: 'judge' });
  const failedId = first.decidedBy.split(':')[1]!;
  const failed = blocks.find((b) => b.id === failedId)!;
  const jp = parseJson(judged.text);
  const why = String(((jp?.blocks ?? []) as { id: string; why?: string }[]).find((v) => String(v.id) === failedId)?.why ?? '');
  const r = await caller.call(recoveryPrompt(item, finalAnswer, blocks, failed, why), { bench: 'longjudge-verify', contestant: 'driftbench-blocks-recovery', item: item.id, order: 'recovery' });
  const rp = parseJson(r.text);
  const holds = rp?.final_holds === true;
  return { ...first, pass: rp ? holds : first.pass, recovered: rp ? holds : undefined, recoveryCostUsd: r.costUsd, costUsd: first.costUsd + r.costUsd };
}

// ---------------------------------------------------------------- writing

export type RequirementBlock = {
  id: string;
  ask: string;
  expected: string;
  hard: boolean;
  machine?: { type: 'min_units' | 'max_units' | 'language'; value: number | string } | null;
};

const REQ_SYSTEM =
  'You compile a writing request into requirement blocks, like unit tests, before any draft is seen. Output only JSON.';

function requirementPrompt(item: PairItem) {
  return {
    system: REQ_SYSTEM,
    user: `Writing request:\n${item.question}\n\nList what a reader of this request expects from the text, as 3 to 7 blocks:\n- ask: the phrase of the request this block comes from, quoted.\n- expected: what content or quality satisfies it, concretely.\n- hard: true only for an explicit, checkable demand (a stated length, a required section or element, a language, a format, a banned element); false for quality expectations.\n- machine: when the request states a length or a language, a machine check: {"type": "min_units" or "max_units", "value": number} (units are words for English, characters for Chinese), or {"type": "language", "value": "en" or "zh"}. Otherwise null. Never invent a length the request does not state.\nInclude at least one block for the substance a reader cares most about (accuracy, depth, usefulness, or story quality, as fits the request).\n\nReturn: {"language": "en" | "zh", "blocks": [{"id": "r1", "ask": "...", "expected": "...", "hard": true, "machine": null}]}`,
  };
}

function units(text: string, lang: string): number {
  if (lang === 'zh') return (text.match(/[一-鿿]/g) ?? []).length;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Machine verdict of one draft on one block: true pass, false fail, undefined no check. */
export function machineCheck(block: RequirementBlock, draft: string, lang: string): boolean | undefined {
  const m = block.machine;
  if (!m) return undefined;
  if (m.type === 'language') {
    const d = detect(draft.slice(0, 4000));
    const top = d.readings[0]?.top;
    if (!top || top === 'und') return undefined;
    const want = String(m.value);
    const zh = top === 'zh' || top === 'cmn';
    return want === 'zh' ? zh : !zh;
  }
  const n = Number(m.value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const u = units(draft, lang);
  // A stated length is met within a 10 percent tolerance.
  return m.type === 'min_units' ? u >= n * 0.9 : u <= n * 1.1;
}

const PAIR_SYSTEM =
  'You compare two drafts block by block against requirement blocks, like unit tests. For each block you read only what that block asks and decide which draft meets it better. Length is not quality: more words win a block only when they deliver more of what the block expects. Output only JSON.';

function pairBlockPrompt(item: PairItem, blocks: RequirementBlock[], first: string, second: string) {
  const listed = blocks.map((b) => `${b.id}: ${b.ask}\n  Expected: ${b.expected}`).join('\n');
  return {
    system: PAIR_SYSTEM,
    user: `Writing request:\n${item.question}\n\nRequirement blocks:\n${listed}\n\n<draft_A>\n${first}\n</draft_A>\n\n<draft_B>\n${second}\n</draft_B>\n\nFor each block, find the part of each draft that answers it, then decide: "A", "B", or "tie" only when they are genuinely equal on that block. Also check every factual claim you notice in that part: an error counts against the draft on that block.\n\nReturn: {"blocks": [{"id": "r1", "winner": "A" | "B" | "tie", "why": "one sentence"}]}`,
  };
}

/** The segment variant: each requirement block sees only the aligned passages of both drafts. */
function pairSegmentPrompt(item: PairItem, blocks: RequirementBlock[], first: string, second: string) {
  const listed = blocks
    .map((b) => `### Block ${b.id}: ${b.ask}\nExpected: ${b.expected}\n${alignedBlockView(`${b.ask} ${b.expected}`, first, second).replaceAll('response_A', 'draft_A').replaceAll('response_B', 'draft_B')}`)
    .join('\n\n');
  return {
    system: PAIR_SYSTEM,
    user: `Writing request:\n${item.question}\n\nFor each requirement block below you see the passages of draft A and draft B that align with it. Judge each block only on its own passages.\n\n${listed}\n\nFor each block decide: "A", "B", or "tie" only when they are genuinely equal on that block. A factual error in a passage counts against its draft on that block.\n\nReturn: {"blocks": [{"id": "r1", "winner": "A" | "B" | "tie", "why": "one sentence"}]}`,
  };
}

type WpOutcome = {
  rowKey: string;
  id: string;
  label: 'A' | 'B';
  group: string;
  games: (string | undefined)[];
  machineOnly: (string | undefined)[];
  holistic: (string | undefined)[];
  machineDecisive: number;
  costUsd: number;
};

export function writingRowKey(item: Pick<PairItem, 'question' | 'a' | 'b'>): string {
  return createHash('sha256').update(JSON.stringify([item.question, item.a, item.b])).digest('hex').slice(0, 20);
}

const WEIGHT_HARD = 2;
const WEIGHT_SOFT = 1;

async function wpItem(item: PairItem, caller: Caller, holistic: Map<string, string[]>, segments = false): Promise<WpOutcome> {
  const rowKey = writingRowKey(item);
  let cost = 0;
  const req = await caller.call(requirementPrompt(item), {
    bench: 'longjudge-wp',
    contestant: 'driftbench-blocks',
    item: rowKey,
    order: 'requirements',
  });
  cost += req.costUsd;
  const rp = parseJson(req.text);
  const lang = rp?.language === 'zh' ? 'zh' : rp?.language === 'en' ? 'en' : item.language === 'zh' ? 'zh' : 'en';
  const blocks = ((Array.isArray(rp?.blocks) ? rp!.blocks : []) as RequirementBlock[]).slice(0, 7);
  const hol = holistic.get(rowKey) ?? [];
  const games: (string | undefined)[] = [];
  const machineOnly: (string | undefined)[] = [];
  let machineDecisive = 0;
  // Machine checks, per block, on the original drafts.
  const mA = blocks.map((b) => machineCheck(b, item.a, lang));
  const mB = blocks.map((b) => machineCheck(b, item.b, lang));
  for (const order of ['AB', 'BA'] as const) {
    const [first, second] = order === 'AB' ? [item.a, item.b] : [item.b, item.a];
    const r = await caller.call((segments ? pairSegmentPrompt : pairBlockPrompt)(item, blocks, first, second), {
      bench: 'longjudge-wp',
      contestant: segments ? 'driftbench-blocks-segments' : 'driftbench-blocks',
      item: rowKey,
      order,
    });
    cost += r.costUsd;
    const jp = parseJson(r.text);
    const winners = new Map<string, string>();
    for (const v of (Array.isArray(jp?.blocks) ? jp!.blocks : []) as { id: string; winner: string }[]) {
      const w = String(v.winner);
      // Map the presentation label back to the original draft.
      const orig = w === 'tie' ? 'tie' : order === 'AB' ? w : w === 'A' ? 'B' : w === 'B' ? 'A' : 'tie';
      winners.set(String(v.id), orig);
    }
    let sA = 0;
    let sB = 0;
    let machA = 0;
    let machB = 0;
    blocks.forEach((b, i) => {
      const w = b.hard ? WEIGHT_HARD : WEIGHT_SOFT;
      // A machine fail is final: a draft that fails a hard check loses the block unless both fail.
      if (mA[i] === false && mB[i] !== false) {
        sB += w;
        machB += w;
        if (order === 'AB') machineDecisive += 1;
        return;
      }
      if (mB[i] === false && mA[i] !== false) {
        sA += w;
        machA += w;
        if (order === 'AB') machineDecisive += 1;
        return;
      }
      const win = winners.get(b.id);
      if (win === 'A') sA += w;
      else if (win === 'B') sB += w;
    });
    const h = hol[order === 'AB' ? 0 : 1];
    // Equal block scores fall back to the frozen holistic ballot of the same order (a cascade).
    games.push(!jp ? h : sA > sB ? 'A' : sB > sA ? 'B' : h);
    // Machine-only variant: the frozen holistic ballot, overridden only where machine checks decide.
    machineOnly.push(machA > machB ? 'A' : machB > machA ? 'B' : h);
  }
  return { rowKey, id: item.id, label: item.label as 'A' | 'B', group: item.group, games, machineOnly, holistic: hol, machineDecisive, costUsd: cost };
}

/** A meaning-preserving variant of a draft: the same words with markdown presentation removed. */
export function reformat(draft: string): string {
  return draft
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ');
}

/**
 * Metamorphic re-judging: the block judge reads the reformatted drafts with the same requirement blocks
 * (a replayed compile), in both orders. A game whose winner flips under the variant is inconclusive and falls
 * back to the frozen holistic ballot of that order.
 */
async function wpMetamorphic(item: PairItem, caller: Caller, base: WpOutcome) {
  const rowKey = writingRowKey(item);
  const req = await caller.call(requirementPrompt(item), { bench: 'longjudge-wp', contestant: 'driftbench-blocks', item: rowKey, order: 'requirements' });
  const rp = parseJson(req.text);
  const lang = rp?.language === 'zh' ? 'zh' : rp?.language === 'en' ? 'en' : item.language === 'zh' ? 'zh' : 'en';
  const blocks = ((Array.isArray(rp?.blocks) ? rp!.blocks : []) as RequirementBlock[]).slice(0, 7);
  const variant: PairItem = { ...item, a: reformat(item.a), b: reformat(item.b) };
  let cost = 0;
  const flipped: string[] = [];
  const variantGames: (string | undefined)[] = [];
  for (const order of ['AB', 'BA'] as const) {
    const [first, second] = order === 'AB' ? [variant.a, variant.b] : [variant.b, variant.a];
    const r = await caller.call(pairBlockPrompt(item, blocks, first, second), { bench: 'longjudge-wp', contestant: 'driftbench-blocks-metamorphic', item: rowKey, order });
    cost += r.costUsd;
    const jp = parseJson(r.text);
    let sA = 0;
    let sB = 0;
    const winners = new Map<string, string>();
    for (const v of (Array.isArray(jp?.blocks) ? jp!.blocks : []) as { id: string; winner: string }[]) {
      const w = String(v.winner);
      winners.set(String(v.id), w === 'tie' ? 'tie' : order === 'AB' ? w : w === 'A' ? 'B' : w === 'B' ? 'A' : 'tie');
    }
    blocks.forEach((b, i) => {
      const w = b.hard ? WEIGHT_HARD : WEIGHT_SOFT;
      const ma = machineCheck(b, item.a, lang);
      const mb = machineCheck(b, item.b, lang);
      if (ma === false && mb !== false) return void (sB += w);
      if (mb === false && ma !== false) return void (sA += w);
      const win = winners.get(b.id);
      if (win === 'A') sA += w;
      else if (win === 'B') sB += w;
    });
    const g = sA > sB ? 'A' : sB > sA ? 'B' : undefined;
    variantGames.push(g);
    const i = order === 'AB' ? 0 : 1;
    flipped.push(g !== undefined && g !== base.games[i] ? 'flip' : 'stable');
  }
  const guarded = base.games.map((g, i) => (flipped[i] === 'flip' ? base.holistic[i] : g));
  return { rowKey, label: base.label, group: base.group, games: base.games, variantGames, flipped, guarded, holistic: base.holistic, costUsd: cost };
}

// ---------------------------------------------------------------- main

async function main() {
  const bench = arg('bench') as 'longjudge-verify' | 'longjudge-wp';
  const cap = Number(arg('cap-usd') ?? '1');
  const limit = Number(arg('limit') ?? '1000');
  const concurrency = Math.min(2, Number(arg('concurrency') ?? '2'));
  const stopAt = arg('stop-at'); // HH:MM local, no new item starts after it
  const recordings = await new Recordings(join(ROOT, 'recordings', bench, 'haiku-blocks.jsonl')).load();
  const caller = createCaller(recordings, { model: 'haiku', timeoutMs: 300_000 }, { capUsd: cap });
  const data = await loadBenchmark(bench);
  const dev = data.items.filter((i) => splitOf(bench, i.id) === 'dev').slice(0, limit);
  const out = arg('out') ?? join(ROOT, 'results', `blocks-${bench}.json`);
  const late = () => {
    if (!stopAt) return false;
    const now = new Date();
    const [h, m] = stopAt.split(':').map(Number);
    return now.getHours() * 60 + now.getMinutes() >= h! * 60 + m!;
  };
  let results: unknown[];
  if (arg('metamorphic')) {
    // Metamorphic pass over the first --limit dev pairs; their block verdicts replay from the recordings.
    const hol = JSON.parse(await readFile(arg('holistic')!, 'utf8')) as { results: { rowKey: string; games: string[] }[] };
    const holistic = new Map(hol.results.map((r) => [r.rowKey, r.games]));
    results = await pool(
      (dev as PairItem[]).map((item) => async () => {
        if (late()) return { rowKey: writingRowKey(item), skipped: true };
        try {
          const base = await wpItem(item, caller, holistic);
          return await wpMetamorphic(item, caller, base);
        } catch (e) {
          if (e instanceof CallFailed || e instanceof SpendCapReached) return { rowKey: writingRowKey(item), error: String(e) };
          throw e;
        }
      }),
      concurrency,
    );
  } else if (bench === 'longjudge-verify') {
    const recovery = arg('recovery') !== undefined;
    results = await pool(
      (dev as PointItem[]).map((item) => async () => {
        if (late()) return { id: item.id, label: item.correct, pass: undefined, decidedBy: 'not-run', costUsd: 0 };
        try {
          return recovery ? await verifyRecovery(item, caller) : await verifyItem(item, caller);
        } catch (e) {
          if (e instanceof CallFailed || e instanceof SpendCapReached)
            return { id: item.id, label: item.correct, pass: undefined, decidedBy: String(e), costUsd: 0 };
          throw e;
        }
      }),
      concurrency,
    );
  } else {
    const hol = JSON.parse(await readFile(arg('holistic')!, 'utf8')) as { results: { rowKey: string; games: string[] }[] };
    const holistic = new Map(hol.results.map((r) => [r.rowKey, r.games]));
    results = await pool(
      (dev as PairItem[]).map((item) => async () => {
        const rowKey = writingRowKey(item);
        if (late()) return { rowKey, id: item.id, label: item.label, group: item.group, games: [], skipped: true };
        try {
          return await wpItem(item, caller, holistic, arg('segments') !== undefined);
        } catch (e) {
          if (e instanceof CallFailed || e instanceof SpendCapReached)
            return { rowKey, id: item.id, label: item.label, group: item.group, games: [], error: String(e) };
          throw e;
        }
      }),
      concurrency,
    );
  }
  await writeFile(out, `${JSON.stringify({ bench, items: dev.length, newSpendUsd: caller.spent(), newCalls: caller.calls(), replayed: caller.replayed(), results }, null, 1)}\n`);
  const line = `| ${new Date().toISOString()} | opus-blocks ${bench} block-native DEV run, ${dev.length} items, concurrency ${concurrency} | haiku | ${caller.calls()} | ${cap} cap | ${caller.spent().toFixed(8)} | replayed ${caller.replayed()} |\n`;
  await appendFile(LEDGER, line);
  console.log(line);
}

if (process.argv[1]?.endsWith('blocks.ts')) await main();
