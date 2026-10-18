import { createHash } from 'node:crypto';

/**
 * The witness for families/more.ts: one implementation of every capability those items ask for, proving the items
 * can pass. Test-only, under the protected path; an executor never reads it.
 */

type Entry = { role: string; text: string };
type Vote = { judge: string; outcome: string; score?: number };
type Pair = { a: string; b: string; winner: string };
type CEntry = { judge: string; key: string; answer: unknown };
type Cassette = { version?: number; judges: string[]; entries: CEntry[] };

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function cohenKappa(a: string[], b: string[]): number {
  if (a.length !== b.length || a.length === 0) throw new RangeError('two non-empty lists of the same length');
  const n = a.length;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce(
    (s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n),
    0,
  );
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

function fleissKappa(table: number[][]): number {
  const N = table.length;
  const n = (table[0] ?? []).reduce((a, b) => a + b, 0);
  const k = (table[0] ?? []).length;
  const p = Array.from({ length: k }, (_, j) => table.reduce((s, r) => s + (r[j] ?? 0), 0) / (N * n));
  const P = table.map((r) => (r.reduce((s, x) => s + x * x, 0) - n) / (n * (n - 1)));
  const Pb = mean(P);
  const Pe = p.reduce((s, x) => s + x * x, 0);
  return (Pb - Pe) / (1 - Pe);
}

function confusionMatrix(pred: string[], gold: string[]) {
  const m = { tp: 0, fp: 0, tn: 0, fn: 0 };
  pred.forEach((p, i) => {
    const g = gold[i];
    if (p === 'inconclusive' || g === 'inconclusive' || g === undefined) return;
    if (p === 'fail' && g === 'fail') m.tp += 1;
    else if (p === 'fail') m.fp += 1;
    else if (g === 'fail') m.fn += 1;
    else m.tn += 1;
  });
  return m;
}
const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
function precisionRecall(pred: string[], gold: string[]) {
  const { tp, fp, fn } = confusionMatrix(pred, gold);
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return { precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
}
function matthews(pred: string[], gold: string[]): number {
  const { tp, fp, tn, fn } = confusionMatrix(pred, gold);
  const d = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  return d === 0 ? 0 : (tp * tn - fp * fn) / d;
}
function balancedAccuracy(pred: string[], gold: string[]): number {
  const { tp, fp, tn, fn } = confusionMatrix(pred, gold);
  return (ratio(tp, tp + fn) + ratio(tn, tn + fp)) / 2;
}
const y = (l: boolean) => (l ? 1 : 0);
function brierScore(p: number[], l: boolean[]): number {
  return mean(p.map((x, i) => (x - y(l[i] as boolean)) ** 2));
}
function expectedCalibrationError(p: number[], l: boolean[], bins = 10): number {
  let total = 0;
  for (let b = 0; b < bins; b += 1) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const idx = p.map((x, i) => [x, i] as const).filter(([x]) => (x > lo || (b === 0 && x >= 0)) && x <= hi);
    if (idx.length === 0) continue;
    const conf = mean(idx.map(([x]) => x));
    const acc = mean(idx.map(([, i]) => y(l[i] as boolean)));
    total += (idx.length / p.length) * Math.abs(acc - conf);
  }
  return total;
}
function logLoss(p: number[], l: boolean[]): number {
  const e = 1e-15;
  return -mean(
    p.map((x, i) => {
      const c = Math.min(Math.max(x, e), 1 - e);
      return l[i] ? Math.log(c) : Math.log(1 - c);
    }),
  );
}
function wilsonInterval(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const ph = k / n;
  const d = 1 + (z * z) / n;
  const c = (ph + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}
function ranks(x: number[]): number[] {
  const order = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]?.[0] === order[i]?.[0]) j += 1;
    for (let t = i; t <= j; t += 1) r[order[t]?.[1] as number] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let s = 0;
  let sa = 0;
  let sb = 0;
  a.forEach((x, i) => {
    const d = (b[i] as number) - mb;
    s += (x - ma) * d;
    sa += (x - ma) ** 2;
    sb += d * d;
  });
  return s / Math.sqrt(sa * sb);
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));
function kendallTau(x: number[], z: number[]): number {
  let nc = 0;
  let nd = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < x.length; i += 1)
    for (let j = i + 1; j < x.length; j += 1) {
      const dx = (x[i] as number) - (x[j] as number);
      const dy = (z[i] as number) - (z[j] as number);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tx += 1;
      else if (dy === 0) ty += 1;
      else if (dx * dy > 0) nc += 1;
      else nd += 1;
    }
  return (nc - nd) / Math.sqrt((nc + nd + tx) * (nc + nd + ty));
}
function rocAuc(s: number[], l: boolean[]): number {
  const pos = s.filter((_, i) => l[i]);
  const neg = s.filter((_, i) => !l[i]);
  let t = 0;
  for (const p of pos) for (const q of neg) t += p > q ? 1 : p === q ? 0.5 : 0;
  return t / (pos.length * neg.length);
}
function mcnemar(a: boolean[], b: boolean[]) {
  const b01 = a.filter((x, i) => x && !b[i]).length;
  const b10 = a.filter((x, i) => !x && b[i]).length;
  return { b01, b10, chi2: b01 + b10 === 0 ? 0 : (Math.abs(b01 - b10) - 1) ** 2 / (b01 + b10) };
}
function agreementWithGold(v: string[], g: string[]) {
  const kept = v.map((x, i) => [x, g[i]] as const).filter(([x]) => x !== 'inconclusive');
  return {
    agreement: ratio(kept.filter(([x, z]) => x === z).length, kept.length),
    coverage: kept.length / v.length,
  };
}
function thresholdSweep(s: number[], l: boolean[]) {
  let best: { threshold: number; accuracy: number } | undefined;
  for (const t of [...new Set(s)].sort((a, b) => a - b)) {
    const accuracy = s.filter((x, i) => x >= t === l[i]).length / s.length;
    if (!best || accuracy > best.accuracy) best = { threshold: t, accuracy };
  }
  return best;
}
const back = (w: string) => (w === 'a' ? 'b' : w === 'b' ? 'a' : w);
const swapConsistent = (first: string, swapped: string) => back(swapped) === first;
const positionBias = (pairs: { first: string; swapped: string }[]) =>
  pairs.filter((p) => !swapConsistent(p.first, p.swapped)).length / pairs.length;
function counts(labels: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of labels) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
function majorityLabel(labels: string[]): string {
  const sorted = [...counts(labels)].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0 || (sorted.length > 1 && sorted[0]?.[1] === sorted[1]?.[1])) return 'inconclusive';
  return sorted[0]?.[0] as string;
}
const stabilityRate = (o: string[]) => Math.max(...counts(o).values()) / o.length;
const flakyCriteria = (runs: Record<string, string[]>) =>
  Object.keys(runs)
    .filter((k) => new Set(runs[k]).size > 1)
    .sort();
function outcomeCounts(v: { outcome: string }[]) {
  return {
    pass: v.filter((x) => x.outcome === 'pass').length,
    fail: v.filter((x) => x.outcome === 'fail').length,
    inconclusive: v.filter((x) => x.outcome === 'inconclusive').length,
  };
}
function passRate(v: { outcome: string }[]) {
  const c = outcomeCounts(v);
  return c.pass + c.fail === 0 ? undefined : c.pass / (c.pass + c.fail);
}
function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(1, Math.ceil((p / 100) * s.length)) - 1] as number;
}
const latencySummary = (ms: number[]) => ({
  p50: percentile(ms, 50),
  p95: percentile(ms, 95),
  max: Math.max(...ms),
});
function scoreHistogram(scores: number[], bins: number): number[] {
  const out = new Array<number>(bins).fill(0);
  for (const s of scores) {
    const i = Math.min(bins - 1, Math.floor(s * bins));
    out[i] = (out[i] ?? 0) + 1;
  }
  return out;
}

function answerOf(outcome: string | undefined, reasoning: string) {
  const ok = outcome === 'pass' || outcome === 'fail' || outcome === 'inconclusive';
  return { outcome: ok ? outcome : 'inconclusive', reasoning };
}
function parseAnswerXml(text: string) {
  const get = (tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim();
  return answerOf(get('outcome'), get('reasoning') ?? '');
}
function parseAnswerYaml(text: string) {
  const get = (key: string) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(text)?.[1]?.trim();
  return answerOf(get('outcome'), get('reasoning') ?? '');
}
function clampReasoning<T extends { reasoning: string }>(answer: T, max: number): T {
  return answer.reasoning.length <= max
    ? answer
    : { ...answer, reasoning: `${answer.reasoning.slice(0, max - 1)}…` };
}
const ANSWER_SCHEMA = {
  type: 'object',
  required: ['outcome', 'reasoning'],
  properties: {
    outcome: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
    reasoning: { type: 'string' },
    score: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const redactSecrets = (t: string) =>
  t.replace(/sk-[A-Za-z0-9_-]{20,}/g, '[secret]').replace(/AKIA[0-9A-Z]{16}/g, '[secret]');
const redactPii = (t: string) =>
  t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]').replace(/\+\d(?: ?\d){7,}/g, '[phone]');
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = max - 5;
  const head = Math.ceil(room / 2);
  return `${text.slice(0, head)} […] ${text.slice(text.length - (room - head))}`;
}
const dedupeTranscript = (t: Entry[]) =>
  t.filter((e, i) => i === 0 || e.role !== t[i - 1]?.role || e.text !== t[i - 1]?.text);
const normaliseTranscript = (t: Entry[]) =>
  t.map((e) => ({ ...e, text: e.text.replace(/\s+/g, ' ').trim() }));
const formatToolCall = (name: string, args: Record<string, unknown>) =>
  `${name}(${Object.keys(args)
    .sort()
    .map((k) => `${k}=${JSON.stringify(args[k])}`)
    .join(', ')})`;
const transcriptStats = (t: Entry[]) => ({
  entries: t.length,
  userTurns: t.filter((e) => e.role === 'user').length,
  characters: t.reduce((n, e) => n + e.text.length, 0),
});
const splitSentences = (text: string) =>
  text
    .split(/(?<=[.!?;])\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean);

function cassetteStats(c: Cassette) {
  const judges: Record<string, number> = {};
  for (const e of c.entries) judges[e.judge] = (judges[e.judge] ?? 0) + 1;
  return { entries: c.entries.length, judges };
}
const unusedEntries = (c: Cassette, keys: string[]) => c.entries.filter((e) => !keys.includes(e.key));
function diffCassettes(a: Cassette, b: Cassette) {
  const id = (e: CEntry) => `${e.judge}\u0000${e.key}`;
  const ma = new Map(a.entries.map((e) => [id(e), e]));
  const mb = new Map(b.entries.map((e) => [id(e), e]));
  const keys = (list: CEntry[]) => [...new Set(list.map((e) => e.key))].sort();
  return {
    added: keys(b.entries.filter((e) => !ma.has(id(e)))),
    removed: keys(a.entries.filter((e) => !mb.has(id(e)))),
    changed: keys(
      a.entries.filter(
        (e) => mb.has(id(e)) && JSON.stringify(mb.get(id(e))?.answer) !== JSON.stringify(e.answer),
      ),
    ),
  };
}
const cassetteToJsonl = (c: Cassette) => `${c.entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
function cassetteFromJsonl(text: string): Cassette {
  const entries = text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CEntry);
  return { version: 1, judges: [...new Set(entries.map((e) => e.judge))], entries };
}

const criterionNameProblem = (name: string) =>
  /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name) ? undefined : `criterion name ${name} is not snake_case`;
function duplicateCriteria(list: { name: string }[]) {
  const c = counts(list.map((x) => x.name));
  return [...c]
    .filter(([, n]) => n > 1)
    .map(([k]) => k)
    .sort();
}
const criterionHash = (c: { name: string; rubric: string }) =>
  createHash('sha256').update(`${c.name}\n${c.rubric}`).digest('hex');
const rubricWordCount = (r: string) => r.split(/\s+/).filter(Boolean).length;
const uncoveredCriteria = (criteria: { name: string }[], verdicts: { criterion: string }[]) =>
  criteria.map((c) => c.name).filter((n) => !verdicts.some((v) => v.criterion === n));

const costOf = (u: { input: number; output: number }, p: { input: number; output: number }) =>
  (u.input * p.input + u.output * p.output) / 1e6;
const totalCost = (c: number[]) => Math.round(c.reduce((a, b) => a + b, 0) * 1e6) / 1e6;
function budgetGuard(cap: number) {
  const guard = {
    spent: 0,
    spend(usd: number) {
      if (guard.spent + usd > cap + 1e-12) throw new RangeError(`the budget of ${cap} would be exceeded`);
      guard.spent += usd;
    },
  };
  return guard;
}
const estimateTokens = (t: string) => Math.ceil(t.length / 4);
const retryDelays = (n: number, base: number, cap: number) =>
  Array.from({ length: n }, (_, i) => Math.min(cap, base * 2 ** i));
function retryAfterMs(header: string, now: number): number | undefined {
  if (/^\s*\d+\s*$/.test(header)) return Number(header.trim()) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) || !/[a-z]/i.test(header) || !/\d{4}/.test(header)
    ? undefined
    : Math.max(0, at - now);
}

function unanimity(votes: Vote[]): string {
  const o = new Set(votes.map((v) => v.outcome));
  const only = [...o][0];
  return o.size === 1 && (only === 'pass' || only === 'fail') ? only : 'inconclusive';
}
function supermajority(votes: Vote[], share: number): string {
  for (const o of ['pass', 'fail', 'inconclusive'])
    if (votes.filter((v) => v.outcome === o).length > share * votes.length) return o;
  return 'inconclusive';
}
const dissent = (votes: Vote[], outcome: string) =>
  votes
    .filter((v) => v.outcome !== outcome)
    .map((v) => v.judge)
    .sort();
function medianScore(votes: Vote[]) {
  const s = votes
    .map((v) => v.score)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  if (s.length === 0) return undefined;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
function trimmedMeanScore(votes: Vote[], trim: number) {
  const s = votes
    .map((v) => v.score)
    .filter((x): x is number => x !== undefined)
    .sort((a, b) => a - b);
  const k = Math.floor(trim * s.length);
  return mean(s.slice(k, s.length - k));
}
const councilCost = (votes: Vote[], costs: Record<string, number>) =>
  votes.reduce((s, v) => s + (costs[v.judge] ?? 0), 0);

function winnerOf(p: Pair): string | undefined {
  return p.winner === 'a' ? p.a : p.winner === 'b' ? p.b : undefined;
}
function winRate(results: Pair[], id: string) {
  const mine = results.filter((p) => p.a === id || p.b === id);
  return mine.reduce((s, p) => s + (p.winner === 'tie' ? 0.5 : winnerOf(p) === id ? 1 : 0), 0) / mine.length;
}
function winMatrix(results: Pair[]) {
  const m: Record<string, Record<string, number>> = {};
  for (const p of results) {
    const w = winnerOf(p);
    if (!w) continue;
    const l = w === p.a ? p.b : p.a;
    m[w] = m[w] ?? {};
    (m[w] as Record<string, number>)[l] = ((m[w] as Record<string, number>)[l] ?? 0) + 1;
  }
  return m;
}
function copelandRanking(results: Pair[]) {
  const m = winMatrix(results);
  const ids = [...new Set(results.flatMap((p) => [p.a, p.b]))];
  const score = (a: string) =>
    ids.reduce((s, b) => {
      if (a === b) return s;
      const w = m[a]?.[b] ?? 0;
      const l = m[b]?.[a] ?? 0;
      return s + (w > l ? 1 : w < l ? -1 : 0);
    }, 0);
  return ids.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}
function bordaRanking(rankings: string[][]) {
  const pts = new Map<string, number>();
  for (const r of rankings) {
    r.forEach((id, i) => {
      pts.set(id, (pts.get(id) ?? 0) + r.length - 1 - i);
    });
  }
  return [...pts.keys()].sort((a, b) => (pts.get(b) ?? 0) - (pts.get(a) ?? 0) || a.localeCompare(b));
}

function turnPairs(t: Entry[]) {
  const out: { user: string; agent: string }[] = [];
  for (const e of t) {
    if (e.role === 'user') out.push({ user: e.text, agent: '' });
    else if (e.role === 'agent' && out.length > 0) {
      const last = out[out.length - 1] as { user: string; agent: string };
      last.agent = last.agent ? `${last.agent} ${e.text}` : e.text;
    }
  }
  return out;
}
function lastAgentTurn(t: Entry[]) {
  for (let i = t.length - 1; i >= 0; i -= 1) if (t[i]?.role === 'agent') return i;
  return -1;
}
const firstTurnMatching = (t: Entry[], re: RegExp) => t.findIndex((e) => re.test(e.text));
function recoveryRate(o: string[]) {
  const f = o.indexOf('fail');
  if (f < 0 || f === o.length - 1) return undefined;
  const after = o.slice(f + 1);
  return after.filter((x) => x === 'pass').length / after.length;
}

function quoteSpan(text: string, quote: string) {
  const start = text.indexOf(quote);
  return start < 0 ? undefined : { start, end: start + quote.length };
}
const loose = (t: string) => t.toLowerCase().replace(/\s+/g, ' ');
const findQuoteLoosely = (text: string, quote: string) => loose(text).includes(loose(quote));
const highlightEvidence = (text: string, quote: string) => text.split(quote).join(`«${quote}»`);
function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = d[0] as number;
    d[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = d[j] as number;
      d[j] = Math.min((d[j] as number) + 1, (d[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return d[b.length] as number;
}
function jaccardWords(a: string, b: string) {
  const sa = new Set(a.split(/\s+/).filter(Boolean));
  const sb = new Set(b.split(/\s+/).filter(Boolean));
  const inter = [...sa].filter((w) => sb.has(w)).length;
  return inter / new Set([...sa, ...sb]).size;
}

function maskHeaders(h: Record<string, string>) {
  const secret = new Set(['authorization', 'x-api-key', 'x-goog-api-key']);
  return Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k, secret.has(k.toLowerCase()) ? `****${v.slice(-4)}` : v]),
  );
}
function usageFromResponse(provider: string, body: Record<string, Record<string, number>>) {
  if (provider === 'openai')
    return { input: body.usage?.prompt_tokens, output: body.usage?.completion_tokens };
  if (provider === 'anthropic') return { input: body.usage?.input_tokens, output: body.usage?.output_tokens };
  return { input: body.usageMetadata?.promptTokenCount, output: body.usageMetadata?.candidatesTokenCount };
}

function chunkTranscript(t: Entry[], maxChars: number) {
  const out: Entry[][] = [];
  let cur: Entry[] = [];
  let size = 0;
  for (const e of t) {
    if (cur.length > 0 && size + e.text.length > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(e);
    size += e.text.length;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export const moreWitness = {
  cohenKappa,
  fleissKappa,
  confusionMatrix,
  precisionRecall,
  matthews,
  balancedAccuracy,
  brierScore,
  expectedCalibrationError,
  logLoss,
  wilsonInterval,
  spearman,
  kendallTau,
  rocAuc,
  mcnemar,
  agreementWithGold,
  thresholdSweep,
  positionBias,
  majorityLabel,
  stabilityRate,
  flakyCriteria,
  passRate,
  outcomeCounts,
  percentile,
  latencySummary,
  scoreHistogram,
  verbosityBias: spearman,
  parseAnswerXml,
  parseAnswerYaml,
  clampReasoning,
  ANSWER_SCHEMA,
  redactSecrets,
  redactPii,
  truncateMiddle,
  dedupeTranscript,
  normaliseTranscript,
  formatToolCall,
  transcriptStats,
  splitSentences,
  cassetteStats,
  unusedEntries,
  diffCassettes,
  cassetteToJsonl,
  cassetteFromJsonl,
  criterionNameProblem,
  duplicateCriteria,
  criterionHash,
  rubricWordCount,
  uncoveredCriteria,
  costOf,
  totalCost,
  budgetGuard,
  estimateTokens,
  retryDelays,
  retryAfterMs,
  unanimity,
  supermajority,
  dissent,
  medianScore,
  trimmedMeanScore,
  councilCost,
  winRate,
  winMatrix,
  copelandRanking,
  bordaRanking,
  swapConsistent,
  turnPairs,
  lastAgentTurn,
  firstTurnMatching,
  recoveryRate,
  quoteSpan,
  findQuoteLoosely,
  highlightEvidence,
  levenshtein,
  jaccardWords,
  maskHeaders,
  usageFromResponse,
  chunkTranscript,
};
