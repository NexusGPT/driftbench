import { createHash } from 'node:crypto';
/**
 * The second blind breaker: claims about report, ci, compare, view, queue, import, monitor, select, holdout,
 * simulate and attack, written from the documentation and the command line only. Every oracle is computed
 * here by brute force from inputs built here; no number is taken from the tool's own output.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { AUTO_MARGIN_WARN } from '@agent-nexus/driftbench-report';
import { nonInferiority } from '@agent-nexus/driftbench-stats';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { gateContract, goldenContract, goldenCount } from '../current-contracts';
import { type BankItem, expectAll, fail, type Tier } from '../types';
import { readmeClaims } from './report';

// ---------------------------------------------------------------------------------------------------------
// The command line, in process.

type Cli = { code: number; out: string; err: string };

async function cli(argv: string[], cwd: string): Promise<Cli> {
  const { main } = (await import('../../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const code = await main(argv, {
    out: (t: string) => {
      out += t;
    },
    err: (t: string) => {
      err += t;
    },
    cwd,
  });
  return { code, out, err };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// biome-ignore lint/suspicious/noExplicitAny: parsed command output of any shape
type Json = any;

function parse(r: Cli): Json | null {
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

function brief(s: string, n = 300): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

// ---------------------------------------------------------------------------------------------------------
// Items.

const ITEMS: BankItem[] = [];

/** Causes one change in a shared component fixes, so items here and in other files count them once. */
const SHARED_CAUSES = new Set([
  'compareCampaigns gives an incomplete result, not an error, when the candidate ran no golden, so ci reports INCOMPLETE and report aggregates read inconclusive',
]);

function add(
  family: string,
  slug: string,
  tier: Tier,
  level: number,
  source: BankItem['source'],
  component: string,
  quote: string,
  claim: string,
  check: BankItem['check'],
): void {
  ITEMS.push({
    id: `breaker2/${family.replace('breaker2-', '')}/${slug}`,
    family,
    tier,
    level,
    component,
    source,
    title: `${quote}: ${claim}`,
    // A cause shared with another file, or already naming its command or file, is kept word for word.
    cause:
      SHARED_CAUSES.has(claim) || /^(driftbench |packages\/)/.test(claim) ? claim : `${component}: ${claim}`,
    check,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Fixtures built once per scratch folder.

const memo = new Map<string, Promise<unknown>>();

function once<T>(scratch: string, key: string, make: () => Promise<T>): Promise<T> {
  const k = `${scratch}\u0000${key}`;
  let p = memo.get(k) as Promise<T> | undefined;
  if (!p) {
    p = make();
    memo.set(k, p);
  }
  return p;
}

function dir(scratch: string, ...parts: string[]): string {
  const d = join(scratch, 'b2', ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

function put(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** One tiny conversation spec that the Acme sales agent answers offline. `expect` lines are indented under the block. */
function tinySpec(id: string, expect = '', extra = ''): string {
  return (
    `id: ${id}\nversion: '1'\ntitle: Greeting ${id}\nchannel: chat\nlang: EN\n` +
    `target: { adapter: function, agent: acme-sales }\n${extra}` +
    `blocks:\n  - user: Hello, I would like faster home internet.\n${expect ? `    expect:\n${expect}` : ''}`
  );
}

/**
 * Kinds of tiny spec. The sales agent says "Acme Telecom" and the ops agent says "price sheet", so a campaign
 * on the sales agent against one on the ops agent pairs the same spec bytes with different outcomes.
 */
const KIND: Record<string, string> = {
  a: '',
  b: "      must: ['Acme Telecom']\n",
  c: "      must: ['price sheet']\n",
  d: "      must: ['zzz impossible']\n",
  e: "      must_not: ['Acme Telecom']\n",
  f: "      must_not: ['price sheet']\n",
};

type Counts = Partial<Record<keyof typeof KIND, number>>;

type Pair = {
  dir: string;
  store: string;
  specs: string;
  ids: string[];
  kindOf: Map<string, string>;
  base: Map<string, boolean>;
  cand: Map<string, boolean>;
  /** Brute-force table over the specs, baseline then candidate. */
  a: number;
  b: number;
  c: number;
  d: number;
  n: number;
};

type Cell = { specId: string; mode: string; repeat: number; state: string };

async function runCampaign(
  cwd: string,
  specs: string,
  target: string,
  store: string,
  campaign: string,
  extra: string[] = [],
): Promise<{ r: Cli; cells: Cell[] }> {
  const r = await cli(
    [
      'campaign',
      'run',
      specs,
      '--target',
      target,
      '--store',
      store,
      '--campaign',
      campaign,
      '--json',
      ...extra,
    ],
    cwd,
  );
  const j = parse(r);
  return { r, cells: (j?.cells ?? []) as Cell[] };
}

function passByGolden(cells: Cell[], mode = 'F'): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const c of cells) {
    if (c.mode !== mode) continue;
    m.set(c.specId, (m.get(c.specId) ?? true) && c.state === 'pass');
  }
  return m;
}

function tableOf(
  base: Map<string, boolean>,
  cand: Map<string, boolean>,
): { a: number; b: number; c: number; d: number; n: number } {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const [id, bp] of base) {
    const cp = cand.get(id);
    if (cp === undefined) continue;
    if (bp && cp) a++;
    else if (bp && !cp) b++;
    else if (!bp && cp) c++;
    else d++;
  }
  return { a, b, c, d, n: a + b + c + d };
}

let uniqSeq = 0;
function uniq(prefix: string): string {
  return `${prefix}${++uniqSeq}`;
}

/** A private copy of a pair store, so an item that adds campaigns does not change what other items read. */
function cloneStore(p: Pair): string {
  const d = dir(p.dir, uniq('clone'));
  const to = join(d, 's.db');
  copyFileSync(p.store, to);
  return to;
}

function pairFixture(scratch: string, name: string, counts: Counts, repeats = 1): Promise<Pair> {
  return once(scratch, `pair:${name}:${repeats}`, async () => {
    const d = dir(scratch, `pair-${name}`);
    const specs = join(d, 'specs');
    const ids: string[] = [];
    const kindOf = new Map<string, string>();
    for (const [kind, count] of Object.entries(counts)) {
      for (let i = 0; i < (count ?? 0); i++) {
        const id = `r-${kind}-${1000 + i}`;
        ids.push(id);
        kindOf.set(id, kind);
        put(join(specs, `${id}.yaml`), tinySpec(id, KIND[kind]));
      }
    }
    const store = join(d, 's.db');
    const extra = repeats > 1 ? ['--repeats', String(repeats)] : [];
    const base = await runCampaign(d, specs, 'function:acme-sales', store, 'base', extra);
    const cand = await runCampaign(d, specs, 'process:acme-ops', store, 'cand', extra);
    const bm = passByGolden(base.cells);
    const cm = passByGolden(cand.cells);
    return { dir: d, store, specs, ids, kindOf, base: bm, cand: cm, ...tableOf(bm, cm) };
  });
}

/** Three small shapes, picked by seed, so the brute force sees different tables. */
function smallCounts(seed: number): Counts {
  const v = seed % 3;
  if (v === 0) return { a: 3, b: 4, c: 2, d: 2 };
  if (v === 1) return { a: 2, b: 5, c: 1, d: 3, e: 1, f: 1 };
  return { a: 4, b: 2, c: 3, d: 1, e: 2, f: 0 };
}

function smallPair(ctx: { seed: number; scratch: string }): Promise<Pair> {
  return pairFixture(ctx.scratch, `small${ctx.seed % 3}`, smallCounts(ctx.seed));
}

function bigPair(scratch: string): Promise<Pair> {
  return pairFixture(scratch, 'big', { a: 6, b: 20, c: 5, d: 5 });
}

// ---------------------------------------------------------------------------------------------------------
// Statistics, by brute force.

const Z = 1.959963984540054;

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = Z * Z;
  const d = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Newcombe's paired interval for baseline minus candidate; the phi correction is optional. */
function newcombe(a: number, b: number, c: number, d: number, correct: boolean): [number, number, number] {
  const n = a + b + c + d;
  const p1 = (a + b) / n;
  const p2 = (a + c) / n;
  const [l1, u1] = wilson(a + b, n);
  const [l2, u2] = wilson(a + c, n);
  const diff = p1 - p2;
  const A = (a + b) * (c + d) * (a + c) * (b + d);
  let phi = 0;
  if (A > 0) {
    let C = a * d - b * c;
    if (correct) {
      if (C > n / 2) C -= n / 2;
      else if (C >= 0) C = 0;
    }
    phi = C / Math.sqrt(A);
  }
  const lo = diff - Math.sqrt(Math.max(0, (p1 - l1) ** 2 + (u2 - p2) ** 2 - 2 * phi * (p1 - l1) * (u2 - p2)));
  const hi = diff + Math.sqrt(Math.max(0, (u1 - p1) ** 2 + (p2 - l2) ** 2 - 2 * phi * (u1 - p1) * (p2 - l2)));
  return [diff, lo, hi];
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Two-sided exact McNemar p on the discordant counts. */
function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const m = Math.min(b, c);
  let s = 0;
  for (let k = 0; k <= m; k++) s += choose(n, k);
  return Math.min(1, (2 * s) / 2 ** n);
}

/** Continuity-corrected McNemar chi-square p. */

function close(x: number, y: number, tol: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
}

function _pct(x: number): string {
  return (Math.round(x * 1000) / 10).toFixed(1);
}

// ---------------------------------------------------------------------------------------------------------
// Local viewer helper.

type ViewResult = { code: number; out: string; err: string; stopped: boolean };

async function withViewer(
  argv: string[],
  cwd: string,
  body: (base: string) => Promise<void>,
): Promise<ViewResult> {
  const { main } = (await import('../../../../../../cli/src/main')) as {
    main: (argv: string[], io: unknown) => Promise<number>;
  };
  let out = '';
  let err = '';
  const before = new Set<unknown>(process.listeners('SIGINT'));
  const run = main(['view', ...argv], {
    out: (t: string) => {
      out += t;
    },
    err: (t: string) => {
      err += t;
    },
    cwd,
  });
  let finished: number | undefined;
  void run.then((c) => {
    finished = c;
  });
  const deadline = Date.now() + 8000;
  while (!/127\.0\.0\.1:(\d+)/.test(out) && finished === undefined && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const m = /127\.0\.0\.1:(\d+)/.exec(out);
  let thrown: unknown;
  if (m) {
    try {
      await body(`http://127.0.0.1:${m[1]}`);
    } catch (e) {
      thrown = e;
    }
    for (const l of process.listeners('SIGINT')) {
      if (!before.has(l)) (l as (s: string) => void)('SIGINT');
    }
  }
  const code = await Promise.race([run, new Promise<number>((r) => setTimeout(() => r(-1), 6000))]);
  if (thrown) throw thrown;
  return { code, out, err, stopped: m !== undefined && code === 0 };
}

async function http(
  base: string,
  path: string,
  init?: { method?: string; form?: Record<string, string>; headers?: Record<string, string> },
): Promise<{ status: number; text: string; loc: string | null; csp: string | null }> {
  const r = await fetch(base + path, {
    method: init?.method ?? (init?.form ? 'POST' : 'GET'),
    headers: {
      ...(init?.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      ...init?.headers,
    },
    body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
    redirect: 'manual',
  });
  return {
    status: r.status,
    text: await r.text(),
    loc: r.headers.get('location'),
    csp: r.headers.get('content-security-policy'),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Production traces, as OpenTelemetry JSON.

type TraceTurn = {
  user: string;
  reply: string;
  durMs: number;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
  tools?: { name: string; err?: boolean }[];
};
type TraceConv = { id: string; startMs: number; turns: TraceTurn[]; gapMs?: number };

const T0 = Date.parse('2026-03-01T00:00:00.000Z');

function sv(key: string, value: string): Json {
  return { key, value: { stringValue: value } };
}
function iv(key: string, value: number): Json {
  return { key, value: { intValue: String(value) } };
}
function dv(key: string, value: number): Json {
  return { key, value: { doubleValue: value } };
}

function hex(n: number, len: number): string {
  return n.toString(16).padStart(len, '0');
}

let spanCounter = 1;

function otelSpans(c: TraceConv, traceBase: number): Json[] {
  const spans: Json[] = [];
  const history: Json[] = [];
  let at = c.startMs;
  c.turns.forEach((t, i) => {
    const trace = hex(traceBase * 100 + i + 1, 32);
    const s0 = BigInt(at) * 1000000n;
    const e0 = s0 + BigInt(t.durMs) * 1000000n;
    history.push({ role: 'user', parts: [{ type: 'text', content: t.user }] });
    const toolParts = (t.tools ?? []).map((tool, k) => ({
      type: 'tool_call',
      id: `call_${traceBase}_${i}_${k}`,
      name: tool.name,
      arguments: { q: 'x' },
    }));
    const attrs: Json[] = [
      sv('gen_ai.operation.name', 'chat'),
      sv('gen_ai.conversation.id', c.id),
      sv('gen_ai.request.model', 'example-model-1'),
      iv('gen_ai.usage.input_tokens', t.tokensIn ?? 100),
      iv('gen_ai.usage.output_tokens', t.tokensOut ?? 50),
      sv('gen_ai.input.messages', JSON.stringify(history)),
      sv(
        'gen_ai.output.messages',
        JSON.stringify([
          {
            role: 'assistant',
            parts: [{ type: 'text', content: t.reply }, ...toolParts],
            finish_reason: 'stop',
          },
        ]),
      ),
    ];
    if (t.cost !== undefined) attrs.push(dv('gen_ai.usage.cost', t.cost));
    spans.push({
      traceId: trace,
      spanId: hex(spanCounter++, 16),
      name: 'chat example-model-1',
      kind: 3,
      startTimeUnixNano: s0.toString(),
      endTimeUnixNano: e0.toString(),
      attributes: attrs,
      status: { code: 1 },
    });
    (t.tools ?? []).forEach((tool, k) => {
      spans.push({
        traceId: trace,
        spanId: hex(spanCounter++, 16),
        name: `execute_tool ${tool.name}`,
        startTimeUnixNano: (s0 + 1000000n).toString(),
        endTimeUnixNano: (s0 + 2000000n).toString(),
        attributes: [
          sv('gen_ai.operation.name', 'execute_tool'),
          sv('gen_ai.tool.name', tool.name),
          sv('gen_ai.tool.call.id', `call_${traceBase}_${i}_${k}`),
          sv('gen_ai.tool.call.arguments', '{"q":"x"}'),
          sv('gen_ai.tool.call.result', tool.err ? '{"error":"boom"}' : '{"ok":true}'),
        ],
        status: tool.err ? { code: 2, message: 'boom' } : { code: 1 },
      });
    });
    history.push({ role: 'assistant', parts: [{ type: 'text', content: t.reply }] });
    at += t.durMs + (c.gapMs ?? 60000);
  });
  return spans;
}

function otelDoc(convs: TraceConv[]): string {
  const spans: Json[] = [];
  convs.forEach((c, i) => {
    spans.push(...otelSpans(c, i + 1));
  });
  return JSON.stringify({
    resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 'b2' }, spans }] }],
  });
}

/** One single-turn conversation. */
function conv1(id: string, startMs: number, durMs: number, extra: Partial<TraceTurn> = {}): TraceConv {
  return { id, startMs, turns: [{ user: `Question ${id}`, reply: `Answer ${id}`, durMs, ...extra }] };
}

// ---------------------------------------------------------------------------------------------------------
// The families are added below.

// =========================================================================================================
// Family: compare and ci.

const FC = 'breaker2-compare';
const QCMP = 'docs/reference/cli.md "driftbench report and driftbench compare"';
const QSTAT = 'docs/concepts/statistics.md "The campaign verdict"';
const QCI = 'examples/acme/ci/README.md "What it decides"';

async function compareJson(
  p: Pair,
  extra: string[] = [],
  base = 'base',
  cand = 'cand',
): Promise<{ r: Cli; j: Json }> {
  const r = await cli(
    ['compare', '--baseline', base, '--candidate', cand, '--store', p.store, '--json', ...extra],
    p.dir,
  );
  return { r, j: parse(r) };
}

add(
  FC,
  'table-counts',
  1,
  10,
  'contract',
  'driftbench compare',
  QCMP,
  'the pair table counts both-pass, regressed, improved and both-fail goldens exactly as the runs decided',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { r, j } = await compareJson(p);
    const t = j?.allPass?.table;
    if (!t) return fail(`no allPass.table in compare --json (exit ${r.code}): ${brief(r.out + r.err)}`);
    return expectAll([
      [
        t.bothPass === p.a && t.regressed === p.b && t.improved === p.c && t.bothFail === p.d,
        `expected a=${p.a} b=${p.b} c=${p.c} d=${p.d}, got ${JSON.stringify(t)}`,
      ],
    ]);
  },
);

add(
  FC,
  'mcnemar-exact',
  2,
  10,
  'contract',
  'driftbench compare',
  'docs/concepts/statistics.md "Comparing a baseline and a candidate"',
  'McNemar is exact below 25 discordant pairs and equals the two-sided binomial tail',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    const want = mcnemarExact(p.b, p.c);
    const got = j?.allPass?.mcnemar?.pValue;
    return expectAll([[close(got, want, 1e-9), `b=${p.b} c=${p.c}: expected exact p ${want}, got ${got}`]]);
  },
);

add(
  FC,
  'mcnemar-exact-large',
  3,
  10,
  'contract',
  'driftbench compare',
  'docs/concepts/statistics.md "Comparing a baseline and a candidate" (compare always uses the exact McNemar test, also from 25 discordant pairs)',
  'compare gives the exact two-sided McNemar p value, also with 25 or more discordant pairs',
  async (ctx) => {
    const p = await bigPair(ctx.scratch);
    const { j } = await compareJson(p);
    const want = mcnemarExact(p.b, p.c);
    const got = j?.allPass?.mcnemar?.pValue;
    return expectAll([
      [p.b + p.c >= 25, `fixture should hold 25 or more discordant pairs, got b=${p.b} c=${p.c}`],
      [close(got, want, 1e-9), `b=${p.b} c=${p.c}: expected the exact McNemar p ${want}, got ${got}`],
    ]);
  },
);

add(
  FC,
  'effect-estimate',
  1,
  10,
  'contract',
  'driftbench compare',
  QCMP,
  'the effect is the baseline pass rate minus the candidate pass rate over the paired goldens, printed in points',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    const want = (p.b - p.c) / p.n;
    const r = await cli(['compare', '--baseline', 'base', '--candidate', 'cand', '--store', p.store], p.dir);
    const shown = `${want >= 0 ? '+' : '-'}${(Math.abs(want) * 100).toFixed(1)} points`;
    return expectAll([
      [
        close(j?.allPass?.effect?.estimate, want, 1e-9),
        `expected effect ${want}, got ${j?.allPass?.effect?.estimate}`,
      ],
      [
        r.out.includes(`Effect, baseline minus candidate: ${shown}`),
        `expected the text "Effect, baseline minus candidate: ${shown}", got ${brief(r.out)}`,
      ],
    ]);
  },
);

add(
  FC,
  'newcombe-interval',
  3,
  10,
  'contract',
  'driftbench compare',
  'docs/concepts/statistics.md "Comparing a baseline and a candidate" (Newcombe interval for paired data)',
  'the effect interval is the Newcombe paired interval of the pair table',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    const e = j?.allPass?.effect;
    if (!e) return fail('no allPass.effect in compare --json');
    const variants = [true, false].map((c) => newcombe(p.a, p.b, p.c, p.d, c));
    const hit = variants.some(([, lo, hi]) => close(e.lower, lo, 1e-6) && close(e.upper, hi, 1e-6));
    return expectAll([
      [
        hit,
        `table a=${p.a} b=${p.b} c=${p.c} d=${p.d}: expected Newcombe ${JSON.stringify(variants.map(([, lo, hi]) => [lo, hi]))}, got [${e.lower}, ${e.upper}]`,
      ],
    ]);
  },
);

add(
  FC,
  'wilson-pass-rates',
  2,
  10,
  'contract',
  'driftbench compare',
  'docs/reference/cli.md "driftbench report and driftbench compare" (the all-pass rate of each side)',
  'each side prints its all-pass rate with the Wilson interval of passing goldens over paired goldens',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    const kb = p.a + p.b;
    const kc = p.a + p.c;
    const [bl, bu] = wilson(kb, p.n);
    const [cl, cu] = wilson(kc, p.n);
    const b = j?.allPass?.baseline;
    const c = j?.allPass?.candidate;
    return expectAll([
      [
        b?.k === kb && b?.n === p.n && close(b?.lower, bl, 1e-9) && close(b?.upper, bu, 1e-9),
        `baseline expected ${kb}/${p.n} [${bl}, ${bu}], got ${JSON.stringify(b)}`,
      ],
      [
        c?.k === kc && c?.n === p.n && close(c?.lower, cl, 1e-9) && close(c?.upper, cu, 1e-9),
        `candidate expected ${kc}/${p.n} [${cl}, ${cu}], got ${JSON.stringify(c)}`,
      ],
    ]);
  },
);

add(
  FC,
  'floor-margin',
  3,
  10,
  'contract',
  'driftbench compare',
  `${QSTAT} (Planning numbers)`,
  'the floor is the paired upper bound at zero discordance, 1 minus the Wilson lower bound of n over n',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    const want = 1 - wilson(p.n, p.n)[0];
    return expectAll([
      [
        close(j?.allPass?.floor, want, 1e-9),
        `n=${p.n}: expected floor ${want} (27.75 points at 10, 2.79 at 134), got ${j?.allPass?.floor}`,
      ],
    ]);
  },
);

add(
  FC,
  'goldens-for-10',
  4,
  10,
  'contract',
  'driftbench compare',
  `${QSTAT} (Planning numbers, "for 10")`,
  'the goldens a 10 point margin needs are the larger of the first n whose floor is below 10 points and the Nam paired sample size',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    let first = 1;
    while (1 - wilson(first, first)[0] >= 0.1) first++;
    const zs = 1.959963984540054 + 0.8416212335729143;
    const nam = Math.ceil((zs * zs * ((p.b + p.c) / p.n)) / 0.01 - 1e-9);
    const want = Math.max(first, nam);
    return expectAll([
      [
        first === 35,
        `the first n whose floor is below 10 points should be 35 (goldensNeeded(0.1, 0)), computed ${first}`,
      ],
      [
        j?.allPass?.goldensFor10 === want,
        `b=${p.b} c=${p.c} n=${p.n}: expected ${want}, got ${j?.allPass?.goldensFor10}`,
      ],
    ]);
  },
);

add(
  FC,
  'unpaired-changed-spec',
  3,
  10,
  'contract',
  'driftbench compare',
  'docs/reference/cli.md "driftbench report and driftbench compare" (pairs the goldens both campaigns ran)',
  'a spec whose bytes changed between the campaigns is listed unpaired and leaves the pair count',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('edit'));
    const store = cloneStore(p);
    const name = uniq('edited');
    const target = p.ids[0] as string;
    const edited = join(d, 'specs');
    for (const id of p.ids) {
      const kind = p.kindOf.get(id) as string;
      put(
        join(edited, `${id}.yaml`),
        id === target
          ? tinySpec(id, KIND[kind], '').replace('Greeting', 'Salutation')
          : tinySpec(id, KIND[kind]),
      );
    }
    const run = await runCampaign(d, edited, 'function:acme-sales', store, name);
    if (run.cells.length === 0)
      return fail(`campaign run produced no cells: ${brief(run.r.out + run.r.err)}`);
    const r = await cli(
      ['compare', '--baseline', 'base', '--candidate', name, '--store', store, '--json'],
      p.dir,
    );
    const j = parse(r);
    const unpaired = (j?.unpaired ?? []) as { unit: string; reason: string }[];
    const row = unpaired.find((u) => u.unit.startsWith(target));
    return expectAll([
      [
        row !== undefined && /chang/i.test(row.reason),
        `expected ${target} unpaired with a "changed" reason, got ${JSON.stringify(unpaired)} (exit ${r.code})`,
      ],
      [
        j?.allPass?.table &&
          j.allPass.table.bothPass +
            j.allPass.table.regressed +
            j.allPass.table.improved +
            j.allPass.table.bothFail ===
            p.n - 1,
        `expected ${p.n - 1} pairs, got ${JSON.stringify(j?.allPass?.table)}`,
      ],
    ]);
  },
);

add(
  FC,
  'self-compare-parity',
  2,
  10,
  'contract',
  'driftbench compare',
  'docs/reference/cli.md "driftbench report and driftbench compare" (margin auto: the baseline compared with itself is non-inferior)',
  'a campaign compared with itself under the auto margin exits 0 as non-inferior',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { r, j } = await compareJson(p, [], 'base', 'base');
    return expectAll([
      [
        j?.verdict === 'non-inferior',
        `expected verdict non-inferior, got ${j?.verdict} (reasons ${JSON.stringify(j?.reasons)})`,
      ],
      [r.code === 0, `expected exit 0, got ${r.code}`],
    ]);
  },
);

add(
  FC,
  'margin-out-of-range',
  2,
  10,
  'adversarial',
  'driftbench compare',
  'docs/reference/cli.md "driftbench ci" (a margin outside (0, 100) exits 2)',
  'a margin of 0, 100, a negative number or a word exits 2 with nothing compared',
  async (ctx) => {
    const p = await smallPair(ctx);
    const seen: string[] = [];
    for (const m of ['0', '100', '-5', 'abc', '1e9']) {
      const r = await cli(
        ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', p.store, '--margin', m],
        p.dir,
      );
      seen.push(`${m}:${r.code}`);
    }
    return expectAll([
      [seen.every((s) => s.endsWith(':2')), `expected exit 2 for every bad margin, got ${seen.join(' ')}`],
    ]);
  },
);

add(
  FC,
  'unknown-campaign',
  1,
  10,
  'adversarial',
  'driftbench compare',
  'docs/reference/cli.md "driftbench report and driftbench compare" (exit 2 on bad input)',
  'an unknown baseline or candidate campaign exits 2 and names the campaign',
  async (ctx) => {
    const p = await smallPair(ctx);
    const a = await cli(['compare', '--baseline', 'nope', '--candidate', 'cand', '--store', p.store], p.dir);
    const b = await cli(['compare', '--baseline', 'base', '--candidate', 'nope', '--store', p.store], p.dir);
    return expectAll([
      [
        a.code === 2 && /nope/.test(a.err),
        `unknown baseline: expected exit 2 naming nope, got ${a.code} ${brief(a.err)}`,
      ],
      [
        b.code === 2 && /nope/.test(b.err),
        `unknown candidate: expected exit 2 naming nope, got ${b.code} ${brief(b.err)}`,
      ],
    ]);
  },
);

add(
  FC,
  'no-golden-in-common',
  2,
  10,
  'adversarial',
  'driftbench compare',
  'examples/acme/ci/README.md "What it decides" (exit 2: no golden in common)',
  'two campaigns that ran different goldens exit 2 instead of a verdict',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('disjoint'));
    const store = cloneStore(p);
    const name = uniq('disj');
    const specs = join(d, 'specs');
    for (let i = 0; i < 3; i++) put(join(specs, `z${i}.yaml`), tinySpec(`r-z-${2000 + i}`));
    const run = await runCampaign(d, specs, 'function:acme-sales', store, name);
    if (run.cells.length === 0)
      return fail(`campaign run produced no cells: ${brief(run.r.out + run.r.err)}`);
    const r = await cli(['compare', '--baseline', 'base', '--candidate', name, '--store', store], p.dir);
    return expectAll([
      [r.code === 2, `expected exit 2 for no shared golden, got ${r.code}: ${brief(r.out + r.err)}`],
    ]);
  },
);

add(
  FC,
  'min-goldens-underpowered',
  3,
  10,
  'contract',
  'driftbench compare',
  `${QSTAT} (Underpowered criteria)`,
  'a gating criterion decided on fewer goldens than --min-goldens is underpowered, and only that one',
  async (ctx) => {
    const p = await smallPair(ctx);
    const lo = await compareJson(p, ['--min-goldens', '5']);
    const hi = await compareJson(p);
    const bad: string[] = [];
    for (const [name, min, j] of [
      ['5', 5, lo.j],
      ['30', 30, hi.j],
    ] as const) {
      for (const c of (j?.criteria ?? []) as {
        criterion: string;
        units: number;
        underpowered: boolean;
        gating: boolean;
      }[]) {
        if (c.gating && c.underpowered !== c.units < min)
          bad.push(
            `--min-goldens ${name}: ${c.criterion} has ${c.units} goldens, underpowered ${c.underpowered}`,
          );
      }
    }
    return expectAll([
      [
        bad.length === 0 && (lo.j?.criteria ?? []).length > 0,
        bad.join('; ') || 'compare --json has no criteria',
      ],
    ]);
  },
);

add(
  FC,
  'strict-restores-underpowered',
  4,
  10,
  'contract',
  'driftbench compare',
  `${QSTAT} (strict puts it back)`,
  '--strict makes an underpowered criterion count in the parity conjunction again',
  async (ctx) => {
    const p = await pairFixture(ctx.scratch, 'strict', { a: 4, b: 0, c: 0, d: 4 });
    // Baseline against itself: 8 goldens, 4 failing both sides. The all-pass bound is small enough for a 12 point margin, but the
    // gating criterion decided on 4 goldens has a wider bound; --strict must let that bound decide.
    const lax = await cli(
      [
        'compare',
        '--baseline',
        'base',
        '--candidate',
        'base',
        '--store',
        p.store,
        '--margin',
        '12',
        '--json',
      ],
      p.dir,
    );
    const strict = await cli(
      [
        'compare',
        '--baseline',
        'base',
        '--candidate',
        'base',
        '--store',
        p.store,
        '--margin',
        '12',
        '--strict',
        '--json',
      ],
      p.dir,
    );
    const jl = parse(lax);
    const js = parse(strict);
    const crit = (
      (js?.criteria ?? []) as { criterion: string; effect: { upper: number }; units: number }[]
    ).filter((c) => c.units < 30);
    const widest = Math.max(...crit.map((c) => c.effect.upper * 100), 0);
    const allPassUpper = (jl?.allPass?.effect?.upper ?? 1) * 100;
    const wantStrictOk = Math.max(widest, allPassUpper) < 12;
    const wantLaxOk = allPassUpper < 12;
    return expectAll([
      [
        (jl?.verdict === 'non-inferior') === wantLaxOk,
        `without --strict expected ${wantLaxOk ? 'non-inferior' : 'not non-inferior'} (all-pass upper ${allPassUpper.toFixed(2)}), got ${jl?.verdict}`,
      ],
      [
        (js?.verdict === 'non-inferior') === wantStrictOk,
        `with --strict expected ${wantStrictOk ? 'non-inferior' : 'not non-inferior'} (widest bound ${Math.max(widest, allPassUpper).toFixed(2)}), got ${js?.verdict}`,
      ],
    ]);
  },
);

add(
  FC,
  'bh-adjusted',
  4,
  10,
  'contract',
  'driftbench compare',
  'docs/concepts/statistics.md "Comparing a baseline and a candidate" (Benjamini-Hochberg across criteria)',
  'each criterion carries its Benjamini-Hochberg adjusted p-value across all criteria',
  async (ctx) => {
    const p = await smallPair(ctx);
    const { j } = await compareJson(p);
    const crit = (j?.criteria ?? []) as { criterion: string; pValue: number; adjusted: number }[];
    if (crit.length < 2)
      return fail(`expected 2 or more criteria, got ${JSON.stringify(crit.map((c) => c.criterion))}`);
    const m = crit.length;
    const sorted = [...crit].sort((x, y) => x.pValue - y.pValue);
    const adj = new Map<string, number>();
    let run = 1;
    for (let i = m - 1; i >= 0; i--) {
      run = Math.min(run, ((sorted[i] as { pValue: number }).pValue * m) / (i + 1));
      adj.set((sorted[i] as { criterion: string }).criterion, Math.min(1, run));
    }
    const bad = crit
      .filter((c) => !close(c.adjusted, adj.get(c.criterion) as number, 1e-9))
      .map((c) => `${c.criterion}: expected ${adj.get(c.criterion)}, got ${c.adjusted}`);
    return expectAll([[bad.length === 0, bad.join('; ')]]);
  },
);

add(
  FC,
  'criterion-tables',
  3,
  10,
  'contract',
  'driftbench compare',
  QCMP,
  'each criterion counts its regressed and improved goldens over the goldens that carry it',
  async (ctx) => {
    const p = await pairFixture(ctx.scratch, `crit${ctx.seed % 3}`, { a: 2, b: 3, c: 2, d: 1, e: 2, f: 1 });
    const { j } = await compareJson(p);
    const want = (kinds: string[]) => {
      let units = 0;
      let reg = 0;
      let imp = 0;
      for (const id of p.ids) {
        if (!kinds.includes(p.kindOf.get(id) as string)) continue;
        units++;
        const b = p.base.get(id);
        const c = p.cand.get(id);
        if (b && !c) reg++;
        if (!b && c) imp++;
      }
      return { units, reg, imp };
    };
    const exp: Record<string, ReturnType<typeof want>> = {
      must: want(['b', 'c', 'd']),
      must_not: want(['e', 'f']),
    };
    const bad: string[] = [];
    for (const [name, w] of Object.entries(exp)) {
      const c = (
        (j?.criteria ?? []) as { criterion: string; units: number; regressed: number; improved: number }[]
      ).find((x) => x.criterion === name);
      if (!c || c.units !== w.units || c.regressed !== w.reg || c.improved !== w.imp)
        bad.push(`${name}: expected ${JSON.stringify(w)}, got ${JSON.stringify(c)}`);
    }
    return expectAll([[bad.length === 0, bad.join('; ')]]);
  },
);

add(
  FC,
  'mode-filter',
  3,
  10,
  'contract',
  'driftbench compare',
  'docs/reference/cli.md compare --help ("--mode: compare only these modes")',
  '--mode T compares only the goldens of mode T and an unknown mode exits 2',
  async (ctx) => {
    const d = dir(ctx.scratch, uniq('modes'));
    const specs = join(d, 'specs');
    const kinds = ['a', 'b', 'c', 'd'];
    kinds.forEach((k, i) => {
      put(join(specs, `${k}.yaml`), tinySpec(`r-${k}-${3000 + i}`, KIND[k]));
    });
    const store = join(d, 's.db');
    await runCampaign(d, specs, 'function:acme-sales', store, 'base', ['--mode', 'T,F']);
    await runCampaign(d, specs, 'process:acme-ops', store, 'cand', ['--mode', 'T,F']);
    const both = parse(
      await cli(['compare', '--baseline', 'base', '--candidate', 'cand', '--store', store, '--json'], d),
    );
    const onlyT = parse(
      await cli(
        ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', store, '--mode', 'T', '--json'],
        d,
      ),
    );
    const bad = await cli(
      ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', store, '--mode', 'X'],
      d,
    );
    const sum = (t: Json) => (t ? t.bothPass + t.regressed + t.improved + t.bothFail : -1);
    return expectAll([
      [
        sum(both?.allPass?.table) === 8,
        `default should pair 8 goldens (4 specs, modes T and F), got ${sum(both?.allPass?.table)}`,
      ],
      [
        sum(onlyT?.allPass?.table) === 4 && JSON.stringify(onlyT?.modes) === '["T"]',
        `--mode T should pair 4 goldens in mode T, got ${sum(onlyT?.allPass?.table)} modes ${JSON.stringify(onlyT?.modes)}`,
      ],
      [bad.code === 2, `--mode X should exit 2, got ${bad.code}`],
    ]);
  },
);

add(
  FC,
  'new-flag-always-gates',
  4,
  10,
  'contract',
  'driftbench compare',
  `${QSTAT} (new flags always gate)`,
  'a gating flag new on the candidate gives a regressed verdict at any margin',
  async (ctx) => {
    const d = dir(ctx.scratch, uniq('flag'));
    const specs = join(d, 'specs');
    for (let i = 0; i < 3; i++) {
      put(
        join(specs, `f${i}.yaml`),
        `id: r-g-${4000 + i}\nversion: '1'\ntitle: Address check ${i}\nchannel: chat\nlang: EN\ntarget: { adapter: function, agent: acme-sales }\n` +
          `blocks:\n  - user: Hello, I would like faster home internet.\n  - user: 14 Harbor Road, Acmeville\nrules:\n  forbidden_tools: [coverage.check]\n`,
      );
    }
    const store = join(d, 's.db');
    await runCampaign(d, specs, 'process:acme-ops', store, 'base');
    await runCampaign(d, specs, 'function:acme-sales', store, 'cand');
    const r = await cli(
      ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', store, '--margin', '99', '--json'],
      d,
    );
    const j = parse(r);
    return expectAll([
      [
        (j?.newFlags ?? []).length > 0,
        `expected a new gating flag on the candidate, got ${JSON.stringify(j?.newFlags)} verdict ${j?.verdict}`,
      ],
      [
        j?.verdict === 'regressed' && r.code === 1,
        `expected verdict regressed with exit 1 at margin 99, got ${j?.verdict} exit ${r.code}`,
      ],
    ]);
  },
);

add(
  FC,
  'verdict-exit-code',
  1,
  10,
  'contract',
  'driftbench compare',
  `${QCMP} (exit 0 non-inferior, 1 regressed or not shown non-inferior)`,
  'the exit code is 0 only for a non-inferior verdict and the text names the same verdict',
  async (ctx) => {
    const p = await smallPair(ctx);
    const same = await compareJson(p, [], 'base', 'base');
    const diff = await compareJson(p);
    const text = await cli(
      ['compare', '--baseline', 'base', '--candidate', 'cand', '--store', p.store],
      p.dir,
    );
    const word: Record<string, string> = {
      'non-inferior': 'NON-INFERIOR',
      regressed: 'REGRESSED',
      unproven: 'NOT SHOWN NON-INFERIOR',
    };
    return expectAll([
      [
        (same.r.code === 0) === (same.j?.verdict === 'non-inferior'),
        `self compare exit ${same.r.code} with verdict ${same.j?.verdict}`,
      ],
      [
        (diff.r.code === 0) === (diff.j?.verdict === 'non-inferior'),
        `pair compare exit ${diff.r.code} with verdict ${diff.j?.verdict}`,
      ],
      [
        text.out.includes(`Verdict: ${word[diff.j?.verdict] ?? '?'}`),
        `expected "Verdict: ${word[diff.j?.verdict] ?? '?'}" in the text, got ${brief(text.out.slice(-300))}`,
      ],
    ]);
  },
);

add(
  FC,
  'regressed-rule',
  3,
  10,
  'contract',
  'driftbench compare',
  QSTAT,
  'a McNemar p below 0.05 with more regressed than improved goldens gives the regressed verdict',
  async (ctx) => {
    const p = await bigPair(ctx.scratch);
    const { r, j } = await compareJson(p);
    const pv = mcnemarExact(p.b, p.c);
    return expectAll([
      [
        pv < 0.05 && p.b > p.c,
        `fixture should have p below 0.05 and more regressed than improved, p=${pv} b=${p.b} c=${p.c}`,
      ],
      [
        j?.verdict === 'regressed' && r.code === 1,
        `expected regressed with exit 1, got ${j?.verdict} exit ${r.code}`,
      ],
    ]);
  },
);

add(
  FC,
  'few-goldens-never-regressed',
  3,
  10,
  'contract',
  'driftbench compare',
  `${QSTAT} (Unproven: too few goldens, never a regression)`,
  'one regressed golden out of six with nothing else wrong is not shown non-inferior, never regressed',
  async (ctx) => {
    const p = await pairFixture(ctx.scratch, 'one', { a: 5, b: 1 });
    const { r, j } = await compareJson(p);
    return expectAll([
      [p.b === 1 && p.c === 0, `fixture should hold one regressed golden, got b=${p.b} c=${p.c}`],
      [
        j?.verdict === 'unproven' && r.code === 1,
        `expected unproven with exit 1, got ${j?.verdict} exit ${r.code}`,
      ],
    ]);
  },
);

// ---- ci

type CiFix = { dir: string; store: string; specs: string; out: Cli; summary: Json; candidateId: string };

function ciFixture(scratch: string, seed: number): Promise<CiFix> {
  return once(scratch, `ci:${seed % 3}`, async () => {
    const p = await smallPair({ seed, scratch });
    const d = dir(scratch, `ci${seed % 3}`);
    const store = join(d, 's.db');
    // Own baseline in an own store so the ci campaign never lands in the compare fixture.
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base');
    const out = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'process:acme-ops',
        '--baseline',
        'base',
        '--store',
        store,
        '--out',
        join(d, 'ci.json'),
      ],
      d,
    );
    let summary: Json = null;
    try {
      summary = JSON.parse(readFileSync(join(d, 'ci.json'), 'utf8'));
    } catch {
      summary = null;
    }
    return { dir: d, store, specs: p.specs, out, summary, candidateId: summary?.candidate?.campaignId ?? '' };
  });
}

add(
  FC,
  'ci-equals-compare',
  3,
  10,
  'contract',
  'driftbench ci',
  QCI,
  'on one pair of campaigns ci and compare give the same verdict and the same exit code',
  async (ctx) => {
    const f = await ciFixture(ctx.scratch, ctx.seed);
    if (!f.candidateId)
      return fail(`ci wrote no readable summary (exit ${f.out.code}): ${brief(f.out.out + f.out.err)}`);
    const c = await cli(
      ['compare', '--baseline', 'base', '--candidate', f.candidateId, '--store', f.store, '--json'],
      f.dir,
    );
    const j = parse(c);
    const map: Record<string, string> = {
      'non-inferior': 'parity',
      regressed: 'regression',
      unproven: 'not-shown-non-inferior',
    };
    return expectAll([
      [map[j?.verdict] === f.summary.verdict, `compare says ${j?.verdict}, ci says ${f.summary.verdict}`],
      [
        c.code === f.out.code && f.summary.exitCode === f.out.code,
        `compare exit ${c.code}, ci exit ${f.out.code}, summary exitCode ${f.summary.exitCode}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-summary-pairs',
  3,
  10,
  'contract',
  'driftbench ci',
  QCI,
  'the ci summary table counts the pairs exactly as the runs decided',
  async (ctx) => {
    const f = await ciFixture(ctx.scratch, ctx.seed);
    const p = await smallPair(ctx);
    const t = f.summary?.table;
    return expectAll([
      [
        t && t.bothPass === p.a && t.regressed === p.b && t.improved === p.c && t.bothFail === p.d,
        `expected a=${p.a} b=${p.b} c=${p.c} d=${p.d}, got ${JSON.stringify(t)}`,
      ],
      [f.summary?.pairs === p.n, `expected ${p.n} pairs, got ${f.summary?.pairs}`],
    ]);
  },
);

add(
  FC,
  'ci-default-summary-file',
  1,
  10,
  'contract',
  'driftbench ci',
  'docs/reference/cli.md "driftbench ci" (the summary goes to --out, default driftbench-ci.json)',
  'without --out the summary is written to driftbench-ci.json in the working folder',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('cidefault'));
    const store = join(d, 's.db');
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base');
    const r = await cli(
      ['ci', '--specs', p.specs, '--target', 'function:acme-sales', '--baseline', 'base', '--store', store],
      d,
    );
    const file = join(d, 'driftbench-ci.json');
    let j: Json = null;
    try {
      j = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      j = null;
    }
    return expectAll([
      [
        existsSync(file) && j?.verdict !== undefined,
        `expected ${file} to hold the summary, exit ${r.code}: ${brief(r.out + r.err)}`,
      ],
      [
        r.out.includes('driftbench-ci.json'),
        `expected the text to name driftbench-ci.json, got ${brief(r.out.slice(-200))}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-aggregate-fails-gate',
  3,
  10,
  'contract',
  'driftbench ci',
  'docs/aggregates.md "On the command line"',
  'a failing --aggregate gives the verdict AGGREGATE FAILED and exit 1 even when the comparison reads parity',
  async (ctx) => {
    const f = await ciFixture(ctx.scratch, ctx.seed);
    const d = dir(ctx.scratch, uniq('ciagg'));
    const store = join(d, 's.db');
    const p = await smallPair(ctx);
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base');
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'function:acme-sales',
        '--baseline',
        'base',
        '--store',
        store,
        '--aggregate',
        'pass-rate:>=1.01',
        '--out',
        join(d, 'o.json'),
      ],
      d,
    );
    let j: Json = null;
    try {
      j = JSON.parse(readFileSync(join(d, 'o.json'), 'utf8'));
    } catch {
      j = null;
    }
    return expectAll([
      [f.summary !== null, 'fixture ci run wrote no summary'],
      [
        r.code === 1 && /AGGREGATE FAILED/.test(r.out),
        `expected exit 1 and "AGGREGATE FAILED", got exit ${r.code}: ${brief(r.out.slice(-250))}`,
      ],
      [
        j?.aggregates?.[0]?.passed === false,
        `expected aggregates[0].passed false, got ${JSON.stringify(j?.aggregates)}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-aggregate-passes',
  2,
  10,
  'contract',
  'driftbench ci',
  'docs/aggregates.md "On the command line"',
  'a passing --aggregate leaves a parity verdict at exit 0',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('ciaggok'));
    const store = join(d, 's.db');
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base');
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'function:acme-sales',
        '--baseline',
        'base',
        '--store',
        store,
        '--aggregate',
        'pass-rate:>=0',
        '--aggregate',
        'broken-share:<=1',
        '--json',
        '--out',
        join(d, 'o.json'),
      ],
      d,
    );
    const j = parse(r);
    return expectAll([
      [r.code === 0 && j?.verdict === 'parity', `expected parity exit 0, got ${j?.verdict} exit ${r.code}`],
      [
        (j?.aggregates ?? []).length === 2 && j.aggregates.every((a: Json) => a.passed === true),
        `expected two passed aggregates, got ${JSON.stringify(j?.aggregates)}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-unreadable-aggregate-before-run',
  3,
  10,
  'adversarial',
  'driftbench ci',
  'docs/aggregates.md "On the command line" (a flag it cannot read exits 2 before any campaign loads)',
  'an unreadable --aggregate exits 2 before the candidate runs and stores no campaign',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('cibadagg'));
    const store = join(d, 's.db');
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base');
    const before = parse(await cli(['campaign', 'status', '--store', store, '--json'], d));
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'function:acme-sales',
        '--baseline',
        'base',
        '--store',
        store,
        '--aggregate',
        'pass-rate:>0.5',
        '--out',
        join(d, 'o.json'),
      ],
      d,
    );
    const list = await cli(['monitor', '--store', store, '--metric', 'pass_rate', '--window', '2'], d);
    return expectAll([
      [r.code === 2, `expected exit 2, got ${r.code}: ${brief(r.out + r.err)}`],
      [!existsSync(join(d, 'o.json')), 'a summary file was written although the flag could not be read'],
      [
        /1 campaigns? with runs|holds 1 campaign/.test(list.err + list.out) || before !== undefined,
        `the store should still hold only the baseline campaign, monitor said: ${brief(list.err + list.out)}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-unknown-baseline',
  1,
  10,
  'adversarial',
  'driftbench ci',
  `${QCI} (exit 2: an unknown baseline)`,
  'an unknown baseline exits 2 and names it',
  async (ctx) => {
    const p = await smallPair(ctx);
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'function:acme-sales',
        '--baseline',
        'nope',
        '--store',
        p.store,
        '--out',
        join(p.dir, 'no.json'),
      ],
      p.dir,
    );
    return expectAll([
      [r.code === 2 && /nope/.test(r.err), `expected exit 2 naming nope, got ${r.code}: ${brief(r.err)}`],
    ]);
  },
);

add(
  FC,
  'ci-margin-range',
  2,
  10,
  'adversarial',
  'driftbench ci',
  `${QCI} (a margin outside (0, 100) exits 2)`,
  'a margin of 0 or 100 exits 2 before any candidate cell runs',
  async (ctx) => {
    const p = await smallPair(ctx);
    const seen: string[] = [];
    for (const m of ['0', '100', 'abc']) {
      const r = await cli(
        [
          'ci',
          '--specs',
          p.specs,
          '--target',
          'function:acme-sales',
          '--baseline',
          'base',
          '--store',
          p.store,
          '--margin',
          m,
          '--out',
          join(p.dir, 'no.json'),
        ],
        p.dir,
      );
      seen.push(`${m}:${r.code}`);
    }
    return expectAll([
      [seen.every((s) => s.endsWith(':2')), `expected exit 2 for each, got ${seen.join(' ')}`],
    ]);
  },
);

add(
  FC,
  'ci-fault-needs-faults',
  2,
  10,
  'adversarial',
  'driftbench ci',
  `${QCI} (a fault target without --faults exits 2)`,
  'a fault:<id> target without --faults exits 2',
  async (ctx) => {
    const p = await smallPair(ctx);
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'fault:x3-skips-recap',
        '--baseline',
        'base',
        '--store',
        p.store,
        '--out',
        join(p.dir, 'no.json'),
      ],
      p.dir,
    );
    return expectAll([
      [
        r.code === 2 && /--faults/.test(r.err),
        `expected exit 2 naming --faults, got ${r.code}: ${brief(r.err)}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-budget-stop-incomplete',
  4,
  10,
  'contract',
  'driftbench ci',
  `${QCI} (incomplete: a candidate cell did not run, stopped by the budget; exit 1)`,
  'compareCampaigns gives an incomplete result, not an error, when the candidate ran no golden, so ci reports INCOMPLETE and report aggregates read inconclusive',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('cibudget'));
    const store = join(d, 's.db');
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base');
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'function:acme-sales',
        '--baseline',
        'base',
        '--store',
        store,
        '--budget-usd',
        '0',
        '--out',
        join(d, 'o.json'),
      ],
      d,
    );
    return expectAll([
      [
        r.code === 1 && /INCOMPLETE/i.test(r.out),
        `expected exit 1 and verdict INCOMPLETE, got exit ${r.code}: ${brief(r.out + r.err)}`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-baseline-store-file',
  3,
  10,
  'contract',
  'driftbench ci',
  `${QCI} (the baseline: a store file, its latest campaign)`,
  'a baseline given as a store file is that store latest campaign',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('cistorefile'));
    const old = join(d, 'old.db');
    await runCampaign(d, p.specs, 'process:acme-ops', old, 'zz-older');
    await new Promise((r) => setTimeout(r, 30));
    await runCampaign(d, p.specs, 'function:acme-sales', old, 'aa-latest');
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'function:acme-sales',
        '--baseline',
        old,
        '--store',
        join(d, 'new.db'),
        '--out',
        join(d, 'o.json'),
      ],
      d,
    );
    let j: Json = null;
    try {
      j = JSON.parse(readFileSync(join(d, 'o.json'), 'utf8'));
    } catch {
      j = null;
    }
    return expectAll([
      [
        j?.baseline?.campaignId === 'aa-latest',
        `expected the latest campaign aa-latest (not the alphabetically last), got ${j?.baseline?.campaignId} (exit ${r.code}: ${brief(r.err)})`,
      ],
    ]);
  },
);

add(
  FC,
  'ci-repeats',
  2,
  10,
  'contract',
  'driftbench ci',
  `${QCI} (the unit is the golden: every repeat of it)`,
  '--repeats n runs n cells per golden and a golden passes only when every repeat passes',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('cirep'));
    const store = join(d, 's.db');
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'base', ['--repeats', '3']);
    const r = await cli(
      [
        'ci',
        '--specs',
        p.specs,
        '--target',
        'process:acme-ops',
        '--baseline',
        'base',
        '--store',
        store,
        '--repeats',
        '3',
        '--json',
        '--out',
        join(d, 'o.json'),
      ],
      d,
    );
    const j = parse(r);
    const rows = (j?.rows ?? []) as { candidate: { runs: number } }[];
    return expectAll([
      [
        j?.candidate?.cells === p.ids.length * 3,
        `expected ${p.ids.length * 3} candidate cells, got ${j?.candidate?.cells}`,
      ],
      [
        rows.length === p.ids.length && rows.every((x) => x.candidate.runs === 3),
        `expected 3 runs in each of ${p.ids.length} rows, got ${JSON.stringify(rows.map((x) => x.candidate.runs))}`,
      ],
      [j?.pairs === p.n, `expected ${p.n} pairs (repeats are never pairs), got ${j?.pairs}`],
    ]);
  },
);

type FaultRun = { code: number; verdict: string; text: string };

/** The ci verdicts of every Acme fault on the golden suite, run once per scratch folder. */
function goldenFaults(scratch: string, root: string): Promise<Map<string, FaultRun>> {
  return once(scratch, 'golden-faults', async () => {
    const d = dir(scratch, 'golden-faults');
    const store = join(d, 's.db');
    const res = new Map<string, FaultRun>();
    const specs = join(root, 'examples/acme/golden/specs');
    const faults = join(root, 'examples/acme/faults');
    const base = await cli(
      [
        'campaign',
        'run',
        specs,
        '--target',
        'function:acme-sales',
        '--route',
        'flow:price-sheet=process:acme-ops',
        '--store',
        store,
        '--campaign',
        'baseline',
      ],
      d,
    );
    if (base.code !== 0)
      throw new Error(`the baseline campaign on the golden suite failed: ${brief(base.out + base.err)}`);
    for (const id of [
      'control-sales-identity',
      'x1-invents-price',
      'x2-keeps-first-email',
      'x3-skips-recap',
      'x4-wrong-language',
      'x5-drops-coverage-check',
      'd2-ignores-goal-shift',
      'd4-order-on-loose-yes',
      'd6-obeys-instruction',
      'd8-hides-tool-failure',
      'd9-answers-out-of-scope',
    ]) {
      const out = join(d, `ci-${id}.json`);
      const r = await cli(
        [
          'ci',
          '--specs',
          specs,
          '--target',
          `fault:${id}`,
          '--route',
          'flow:price-sheet=process:acme-ops',
          '--faults',
          faults,
          '--baseline',
          'baseline',
          '--store',
          store,
          '--out',
          out,
        ],
        d,
      );
      let verdict = '';
      try {
        verdict = JSON.parse(readFileSync(out, 'utf8')).verdict;
      } catch {
        verdict = `no summary: ${brief(r.err)}`;
      }
      res.set(id, { code: r.code, verdict, text: r.out });
    }
    return res;
  });
}

for (const [slug, verdict, code] of [
  ['regression', 'regression', 1],
  ['not-shown', 'not-shown-non-inferior', 1],
  ['parity', 'parity', 0],
] as const) {
  add(
    FC,
    `golden-faults-${slug}`,
    5,
    10,
    'contract',
    'driftbench ci',
    `${QCI} ("Measured 2026-10-12 with the defaults", examples/acme/golden/specs, 10 goldens)`,
    `on the golden suite the faults documented as ${verdict} read that verdict with exit ${code}`,
    async (ctx) => {
      const m = await goldenFaults(ctx.scratch, ctx.root);
      const page = readFileSync(join(ctx.root, 'examples/acme/ci/README.md'), 'utf8');
      const row = page.split('\n').find((line) => line.includes('10 goldens |')) ?? '';
      const regression =
        /: ([a-z0-9, ]+) `regression`/
          .exec(row)?.[1]
          ?.split(',')
          .map((id) => id.trim()) ?? [];
      const notShown =
        /; ([a-z0-9, -]+) `not-shown-non-inferior`/
          .exec(row)?.[1]
          ?.split(/,| and /)
          .map((id) => id.trim()) ?? [];
      const documented =
        slug === 'regression'
          ? regression
          : slug === 'not-shown'
            ? notShown
            : ['control', ...(/\. ([a-z0-9]+) and ops-d6 read parity/.exec(row)?.slice(1) ?? [])];
      const expectedIds = [...m.keys()].filter((id) =>
        documented.includes(id === 'control-sales-identity' ? 'control' : (id.split('-')[0] ?? '')),
      );
      if (expectedIds.length === 0) return fail(`missing documented ${slug} fault group`);
      const bad = expectedIds
        .filter((id) => m.get(id)?.verdict !== verdict || m.get(id)?.code !== code)
        .map((id) => `${id}: ${m.get(id)?.verdict} exit ${m.get(id)?.code}`);
      return expectAll([[bad.length === 0, `expected ${verdict} exit ${code}; got ${bad.join('; ')}`]]);
    },
  );
}

add(
  FC,
  'golden-auto-margin',
  4,
  10,
  'contract',
  'driftbench ci',
  `${QCI} ("Auto margin 28 points" for the 10-golden suite)`,
  'the auto margin agrees with the all-pass paired interval on the current golden count and the warning threshold',
  async (ctx) => {
    const m = await goldenFaults(ctx.scratch, ctx.root);
    const t = m.get('control-sales-identity')?.text ?? '';
    const n = await goldenCount(ctx.root);
    const flags = Array.from({ length: n }, () => true);
    const needed = nonInferiority({ baseline: flags, candidate: flags, margin: 0.5 }).effect.upper;
    const margin = Number((Math.min(0.995, (Math.floor(needed * 200 + 1e-9) + 1) / 200) * 100).toFixed(2));
    return expectAll([
      [
        t.includes(`Margin auto: ${margin} points`) && t.includes((needed * 100).toFixed(2)),
        `expected auto margin ${margin}, floor ${needed * 100}; ${brief(t)}`,
      ],
      [
        t.includes(`cannot show parity under ${AUTO_MARGIN_WARN * 100} points`),
        `missing warning: ${brief(t)}`,
      ],
    ]);
  },
);

// =========================================================================================================
// Family: report, scorecards, aggregates.

const FR = 'breaker2-report';
const QREP = 'docs/reference/cli.md "driftbench report and driftbench compare"';
const QAGG = 'docs/aggregates.md "On the command line"';

async function runCells(p: Pair, campaign: string): Promise<Cell[]> {
  const j = parse(await cli(['campaign', 'status', campaign, '--store', p.store, '--json'], p.dir));
  return (j?.cells ?? []) as Cell[];
}

async function reportOf(
  p: Pair,
  campaign: string,
  name: string,
  extra: string[] = [],
): Promise<{ r: Cli; html: string; xml: string; htmlPath: string; xmlPath: string }> {
  const htmlPath = join(p.dir, `${name}.html`);
  const xmlPath = join(p.dir, `${name}.xml`);
  const r = await cli(
    ['report', campaign, '--store', p.store, '--out', htmlPath, '--junit', xmlPath, ...extra],
    p.dir,
  );
  const rd = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  return { r, html: rd(htmlPath), xml: rd(xmlPath), htmlPath, xmlPath };
}

add(
  FR,
  'one-file-no-script',
  1,
  10,
  'contract',
  'driftbench report',
  `${QREP} (one HTML file, no script and no external asset)`,
  'the scorecard is one HTML file with no script element and no external URL in a src or href',
  async (ctx) => {
    const p = await smallPair(ctx);
    const o = await reportOf(p, 'cand', 'nos');
    const ext = [...o.html.matchAll(/(?:src|href)="(https?:[^"]*)"/g)].map((m) => m[1]);
    return expectAll([
      [
        o.r.code === 0 && o.html.length > 1000,
        `expected exit 0 and a page, got exit ${o.r.code} ${brief(o.r.err)}`,
      ],
      [!/<script/i.test(o.html), 'the page holds a script element'],
      [ext.length === 0, `external assets: ${ext.join(', ')}`],
    ]);
  },
);

add(
  FR,
  'sections',
  2,
  10,
  'contract',
  'driftbench report',
  'docs/scorecards.md and docs/viewer.md "The pages" (scorecard, spread view included, per-block drilldown)',
  'the scorecard holds the summary, the per-golden reliability, the spread view and the drilldown sections',
  async (ctx) => {
    const p = await smallPair(ctx);
    const o = await reportOf(p, 'cand', 'sec');
    const h2 = [...o.html.matchAll(/<h2[^>]*>([^<]*)/g)].map((m) => m[1]);
    const need = ['Summary', 'Reliability per golden', 'Spread', 'Drilldown'];
    return expectAll([
      [need.every((n) => h2.includes(n)), `expected sections ${need.join(', ')}, got ${h2.join(', ')}`],
    ]);
  },
);

add(
  FR,
  'summary-line',
  1,
  10,
  'contract',
  'driftbench report',
  QREP,
  'the printed summary counts runs, passing, failing and not completed exactly as the cells decided',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const pass = cells.filter((c) => c.state === 'pass').length;
    const failing = cells.filter((c) => c.state === 'fail').length;
    const broken = cells.length - pass - failing;
    const o = await reportOf(p, 'cand', 'sum');
    const want = `Campaign cand: ${cells.length} runs, ${pass} pass, ${failing} fail, ${broken} did not complete.`;
    return expectAll([[o.r.out.includes(want), `expected "${want}", got ${brief(o.r.out)}`]]);
  },
);

add(
  FR,
  'exit-0-when-runs-fail',
  1,
  10,
  'contract',
  'driftbench report',
  `${QREP} (exit 0 when written, 2 on bad input)`,
  'a campaign with failing runs still exits 0 once the scorecard is written',
  async (ctx) => {
    const p = await smallPair(ctx);
    const o = await reportOf(p, 'cand', 'ex0');
    return expectAll([
      [o.r.code === 0 && existsSync(o.htmlPath), `expected exit 0 with the file written, got ${o.r.code}`],
    ]);
  },
);

add(
  FR,
  'bad-input-exit-2',
  1,
  10,
  'adversarial',
  'driftbench report',
  `${QREP} (exit 2 on bad input)`,
  'an unknown campaign, a missing --out and a store without the campaign exit 2 and write nothing',
  async (ctx) => {
    const p = await smallPair(ctx);
    const out = join(p.dir, 'bad.html');
    const a = await cli(['report', 'nope', '--store', p.store, '--out', out], p.dir);
    const b = await cli(['report', 'cand', '--store', p.store], p.dir);
    const c = await cli(['report', 'cand', '--store', join(p.dir, 'none.db'), '--out', out], p.dir);
    return expectAll([
      [a.code === 2 && b.code === 2 && c.code === 2, `expected 2, 2, 2 got ${a.code}, ${b.code}, ${c.code}`],
      [!existsSync(out), 'a file was written for a bad input'],
    ]);
  },
);

add(
  FR,
  'latest-campaign-default',
  2,
  10,
  'contract',
  'driftbench report',
  'driftbench report --help ("campaign: the latest campaign of the store without it")',
  'without a campaign id the report is of the latest campaign of the store',
  async (ctx) => {
    const p = await smallPair(ctx);
    const r = await cli(['report', '--store', p.store, '--out', join(p.dir, 'latest.html')], p.dir);
    return expectAll([
      [/Campaign cand:/.test(r.out), `expected the latest campaign cand (created last), got ${brief(r.out)}`],
    ]);
  },
);

add(
  FR,
  'junit-suites-per-golden',
  2,
  10,
  'contract',
  'driftbench report',
  `${QREP} (--junit: one test suite per golden, one test case per run)`,
  'the JUnit file has one testsuite per spec and one testcase per run',
  async (ctx) => {
    const p = await smallPair(ctx);
    const o = await reportOf(p, 'cand', 'ju1');
    const suites = [...o.xml.matchAll(/<testsuite name="([^"]*)"/g)].map((m) => m[1]);
    const cases = (o.xml.match(/<testcase /g) ?? []).length;
    const cells = await runCells(p, 'cand');
    return expectAll([
      [
        new Set(suites).size === p.ids.length && suites.length === p.ids.length,
        `expected ${p.ids.length} suites, got ${suites.length}`,
      ],
      [cases === cells.length, `expected ${cells.length} testcases, got ${cases}`],
    ]);
  },
);

add(
  FR,
  'junit-counts',
  2,
  10,
  'contract',
  'driftbench report',
  QREP,
  'the tests and failures attributes of testsuites equal the cell counts and the failing cases',
  async (ctx) => {
    const p = await smallPair(ctx);
    const o = await reportOf(p, 'cand', 'ju2');
    const cells = await runCells(p, 'cand');
    const failing = cells.filter((c) => c.state !== 'pass').length;
    const head = /<testsuites [^>]*tests="(\d+)" failures="(\d+)" errors="(\d+)"/.exec(o.xml);
    const fcases = (o.xml.match(/<failure /g) ?? []).length;
    return expectAll([
      [
        head !== null && Number(head[1]) === cells.length && Number(head[2]) === failing,
        `expected tests=${cells.length} failures=${failing}, got ${head?.slice(1, 4)}`,
      ],
      [fcases === failing, `expected ${failing} failure elements, got ${fcases}`],
    ]);
  },
);

add(
  FR,
  'junit-testcase-name',
  2,
  10,
  'contract',
  'driftbench report',
  'examples/acme/reports/acme-junit.xml (testcase names)',
  'a testcase is named target, mode and repeat, separated by a middle dot',
  async (ctx) => {
    const p = await smallPair(ctx);
    const o = await reportOf(p, 'cand', 'ju3');
    const names = [...o.xml.matchAll(/<testcase classname="[^"]*" name="([^"]*)"/g)].map((m) => m[1]);
    return expectAll([
      [
        names.length > 0 && names.every((n) => n === 'process:acme-ops · F · repeat 0'),
        `expected "process:acme-ops · F · repeat 0", got ${names.slice(0, 2)}`,
      ],
    ]);
  },
);

add(
  FR,
  'junit-escaping',
  3,
  10,
  'adversarial',
  'driftbench report',
  'docs/scorecards.md (scorecard and JUnit written from stored campaigns)',
  'angle brackets, ampersands and quotes in a failing verdict are escaped in the JUnit and HTML output',
  async (ctx) => {
    const d = dir(ctx.scratch, uniq('esc'));
    const specs = join(d, 'specs');
    put(
      join(specs, 'a.yaml'),
      tinySpec('r-9101', `      must: ['zzz <fail> & "x" <script>']\n`).replace(
        'Greeting r-9101',
        'Tom & <b>Jerry</b>',
      ),
    );
    const store = join(d, 's.db');
    await runCampaign(d, specs, 'function:acme-sales', store, 'esc');
    const hp = join(d, 'o.html');
    const xp = join(d, 'o.xml');
    const r = await cli(['report', 'esc', '--store', store, '--out', hp, '--junit', xp], d);
    const html = existsSync(hp) ? readFileSync(hp, 'utf8') : '';
    const xml = existsSync(xp) ? readFileSync(xp, 'utf8') : '';
    const rawInAttr = [...xml.matchAll(/="([^"]*)"/g)].some((m) => /[<>]/.test(m[1] as string));
    return expectAll([
      [r.code === 0, `report exit ${r.code}: ${brief(r.err)}`],
      [!rawInAttr, 'a raw angle bracket sits inside a JUnit attribute'],
      [
        !html.includes('<script>') && !html.includes('<b>Jerry</b>'),
        'the HTML holds an unescaped tag from the spec',
      ],
    ]);
  },
);

add(
  FR,
  'aggregate-pass-rate-value',
  2,
  10,
  'contract',
  'driftbench report',
  `${QAGG} and "Interval and planning" ("the share of all runs that pass"; the Wilson interval decides the threshold when it lies entirely on one side of it)`,
  'pass-rate prints passing runs over all runs, passes a threshold its Wilson interval lies above and fails one it lies below',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const k = cells.filter((c) => c.state === 'pass').length;
    const v = k / cells.length;
    const [low, high] = wilson(k, cells.length);
    // Thresholds two points outside the interval, so the interval lies entirely on one side of each.
    const below = Math.floor((low - 0.02) * 100) / 100;
    const above = Math.ceil((high + 0.02) * 100) / 100;
    if (below <= 0 || above >= 1)
      return fail(`the fixture rate ${v} leaves no room outside its interval [${low}, ${high}]`);
    // One threshold per report: docs/aggregates.md does not say what two flags of one name do.
    const lines: string[] = [];
    for (const [tag, spec] of [
      ['ag1a', `pass-rate:>=${below}`],
      ['ag1b', `pass-rate:>=${above}`],
    ] as const) {
      const one = await reportOf(p, 'cand', tag, ['--aggregate', spec]);
      lines.push(...one.r.out.split('\n').filter((l) => l.startsWith('aggregate ')));
    }
    return expectAll([
      [
        lines.length === 2 && /passes/.test(lines[0] as string) && /fails/.test(lines[1] as string),
        `expected >= ${below} to pass and >= ${above} to fail for value ${v} (interval ${low} to ${high}), got ${lines.join(' | ')}`,
      ],
      [
        lines.every((l) => l.includes(`(${v} `)),
        `expected the value ${v} in each line, got ${lines.join(' | ')}`,
      ],
    ]);
  },
);

add(
  FR,
  'aggregate-broken-share',
  3,
  10,
  'contract',
  'driftbench report',
  `${QAGG} ("the share of runs that did not complete, failed or stopped")`,
  'broken-share is the share of runs that did not complete (a run that completed and failed its checks is not broken)',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const broken = cells.filter((c) => c.state !== 'pass' && c.state !== 'fail').length / cells.length;
    const a = await reportOf(p, 'cand', 'ag2', ['--aggregate', 'broken-share:<=1']);
    const line = a.r.out.split('\n').find((l) => l.startsWith('aggregate broken-share')) ?? '';
    return expectAll([
      [
        line.includes(`(${broken} `) || line.includes(`(${broken}<`),
        `expected the value ${broken} (runs that did not complete over runs), got "${line}"`,
      ],
    ]);
  },
);

add(
  FR,
  'aggregate-operators',
  2,
  10,
  'contract',
  'driftbench report',
  `${QAGG} and "Interval and planning" (>= is at-least, <= is at-most; the interval decides when it lies entirely on one side of the threshold)`,
  '<= passes a threshold the interval lies below and fails one it lies above, >= the reverse',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const k = cells.filter((c) => c.state === 'pass').length;
    const v = k / cells.length;
    const [low, high] = wilson(k, cells.length);
    const below = Math.floor((low - 0.02) * 100) / 100;
    const above = Math.ceil((high + 0.02) * 100) / 100;
    if (below <= 0 || above >= 1)
      return fail(`the fixture rate ${v} leaves no room outside its interval [${low}, ${high}]`);
    const lines: string[] = [];
    const specs = [
      `pass-rate:<=${above}`,
      `pass-rate:<=${below}`,
      `pass-rate:>=${below}`,
      `pass-rate:>=${above}`,
    ];
    for (const [index, spec] of specs.entries()) {
      const one = await reportOf(p, 'cand', `ag3-${index}`, ['--aggregate', spec]);
      lines.push(...one.r.out.split('\n').filter((l) => l.startsWith('aggregate ')));
    }
    const word = (l: string | undefined) =>
      /passes/.test(l ?? '') ? 'passes' : /fails/.test(l ?? '') ? 'fails' : '?';
    const got = lines.map(word).join(', ');
    return expectAll([
      [
        lines.length === 4 && got === 'passes, fails, passes, fails',
        `expected passes, fails, passes, fails (value ${v}, interval ${low} to ${high}), got ${lines.join(' | ')}`,
      ],
    ]);
  },
);

add(
  FR,
  'aggregate-unreadable-first',
  2,
  10,
  'adversarial',
  'driftbench report',
  `${QAGG} (a flag it cannot read exits 2 before any campaign loads)`,
  'an unreadable --aggregate exits 2 naming the flag even when the campaign does not exist',
  async (ctx) => {
    const p = await smallPair(ctx);
    const seen: string[] = [];
    for (const f of ['pass-rate:>0.5', 'bogus:>=0.5', 'pass-rate:>=abc', 'pass-rate']) {
      const r = await cli(
        ['report', 'no-such-campaign', '--store', p.store, '--out', join(p.dir, 'x.html'), '--aggregate', f],
        p.dir,
      );
      seen.push(`${f}:${r.code}:${/aggregate|threshold|name:op/i.test(r.err)}`);
    }
    return expectAll([
      [
        seen.every(
          (s) => s.startsWith(s.split(':')[0] as string) && s.endsWith(':true') && s.includes(':2:'),
        ),
        `expected exit 2 with an aggregate message for each, got ${seen.join(' ')}`,
      ],
    ]);
  },
);

add(
  FR,
  'aggregate-empty-campaign-inconclusive',
  4,
  10,
  'contract',
  'driftbench report',
  'docs/aggregates.md "Inconclusive, not failed" (nothing is reported as a failure from an empty campaign)',
  'compareCampaigns gives an incomplete result, not an error, when the candidate ran no golden, so ci reports INCOMPLETE and report aggregates read inconclusive',
  async (ctx) => {
    const p = await smallPair(ctx);
    const d = dir(ctx.scratch, uniq('empty'));
    const store = join(d, 's.db');
    await runCampaign(d, p.specs, 'function:acme-sales', store, 'empty', ['--budget-usd', '0']);
    let r: Cli;
    try {
      r = await cli(
        ['report', 'empty', '--store', store, '--out', join(d, 'e.html'), '--aggregate', 'pass-rate:>=0.9'],
        d,
      );
    } catch (e) {
      return fail(`report threw on a campaign with no runs: ${(e as Error).message}`);
    }
    return expectAll([
      [r.code === 0, `expected exit 0, got ${r.code}: ${brief(r.err)}`],
      [
        /inconclusive/.test(r.out) && !/fails/.test(r.out),
        `expected "inconclusive" and no failure, got ${brief(r.out)}`,
      ],
    ]);
  },
);

add(
  FR,
  'json-campaign-counts',
  2,
  10,
  'contract',
  'driftbench report',
  `${QREP} (--json prints the scorecard)`,
  '--json prints the scorecard with the campaign run, passing and failing counts',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const r = await cli(
      ['report', 'cand', '--store', p.store, '--out', join(p.dir, 'j.html'), '--json'],
      p.dir,
    );
    const i = r.out.indexOf('{');
    let j: Json = null;
    try {
      j = JSON.parse(r.out.slice(i, r.out.lastIndexOf('}') + 1));
    } catch {
      j = null;
    }
    const pass = cells.filter((c) => c.state === 'pass').length;
    return expectAll([
      [
        j?.campaign?.runs === cells.length &&
          j?.campaign?.passing === pass &&
          j?.campaign?.failing === cells.length - pass,
        `expected runs ${cells.length} passing ${pass}, got ${JSON.stringify(j?.campaign)}`,
      ],
    ]);
  },
);

add(
  FR,
  'json-wilson-per-golden',
  3,
  10,
  'contract',
  'driftbench report',
  'docs/concepts/statistics.md "Intervals"',
  'a golden pass rate over its repeats carries the Wilson interval of its passing runs',
  async (ctx) => {
    const p = await pairFixture(ctx.scratch, 'rep', { b: 1, d: 1 }, 5);
    const r = await cli(
      ['report', 'base', '--store', p.store, '--out', join(p.dir, 'w.html'), '--json'],
      p.dir,
    );
    const j = (() => {
      try {
        return JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
      } catch {
        return null;
      }
    })();
    const lines = (j?.lines ?? []) as {
      specId: string;
      passRate: { k: number; n: number; lower: number; upper: number };
    }[];
    const bad: string[] = [];
    for (const l of lines) {
      const k = p.kindOf.get(l.specId) === 'b' ? 5 : 0;
      const [lo, hi] = wilson(k, 5);
      if (
        l.passRate.k !== k ||
        l.passRate.n !== 5 ||
        !close(l.passRate.lower, lo, 1e-9) ||
        !close(l.passRate.upper, hi, 1e-9)
      )
        bad.push(`${l.specId}: expected ${k}/5 [${lo}, ${hi}], got ${JSON.stringify(l.passRate)}`);
    }
    return expectAll([
      [lines.length === 2 && bad.length === 0, bad.join('; ') || `expected 2 lines, got ${lines.length}`],
    ]);
  },
);

add(
  FR,
  'json-pass-at-k',
  4,
  10,
  'contract',
  'driftbench report',
  'docs/concepts/statistics.md "Repeats" (pass@k = 1 - C(n-c,k)/C(n,k))',
  'passK and passAtK of a golden follow the combinatorial estimators over its repeats',
  async (ctx) => {
    const p = await pairFixture(ctx.scratch, 'rep', { b: 1, d: 1 }, 5);
    const r = await cli(
      ['report', 'base', '--store', p.store, '--out', join(p.dir, 'w2.html'), '--json'],
      p.dir,
    );
    const j = (() => {
      try {
        return JSON.parse(r.out.slice(r.out.indexOf('{'), r.out.lastIndexOf('}') + 1));
      } catch {
        return null;
      }
    })();
    const bad: string[] = [];
    for (const l of (j?.lines ?? []) as {
      specId: string;
      passK: { k: number; value: number }[];
      passAtK: { k: number; value: number }[];
    }[]) {
      const c = p.kindOf.get(l.specId) === 'b' ? 5 : 0;
      for (const e of l.passK)
        if (!close(e.value, choose(c, e.k) / choose(5, e.k), 1e-9))
          bad.push(`${l.specId} pass^${e.k} expected ${choose(c, e.k) / choose(5, e.k)} got ${e.value}`);
      for (const e of l.passAtK)
        if (!close(e.value, 1 - choose(5 - c, e.k) / choose(5, e.k), 1e-9))
          bad.push(
            `${l.specId} pass@${e.k} expected ${1 - choose(5 - c, e.k) / choose(5, e.k)} got ${e.value}`,
          );
    }
    return expectAll([[bad.length === 0, bad.join('; ')]]);
  },
);

add(
  FR,
  'max-runs-limit',
  3,
  10,
  'contract',
  'driftbench report',
  'driftbench report --help ("--max-runs: runs in the drilldown, failing runs first")',
  '--max-runs n shows n runs in the drilldown, failing runs first, and says how many were left out',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const failing = cells.filter((c) => c.state !== 'pass').length;
    const n = Math.max(1, Math.min(failing, 3));
    const o = await reportOf(p, 'cand', 'mr', ['--max-runs', String(n)]);
    const runs = [...o.html.matchAll(/<details class="run (run-(?:pass|fail))"/g)].map((m) => m[1]);
    return expectAll([
      [runs.length === n, `expected ${n} runs in the drilldown, got ${runs.length}`],
      [runs.every((c) => c === 'run-fail'), `expected failing runs first, got ${runs.join(',')}`],
      [
        o.html.includes(`${cells.length - n} more runs left out`),
        `expected "${cells.length - n} more runs left out"`,
      ],
    ]);
  },
);

add(
  FR,
  'baseline-section-verdict',
  3,
  10,
  'contract',
  'driftbench report',
  `${QREP} (the compare diff with --baseline)`,
  '--baseline adds the compare section and prints the same verdict as driftbench compare',
  async (ctx) => {
    const p = await smallPair(ctx);
    const c = parse(
      await cli(
        [
          'compare',
          '--baseline',
          'base',
          '--candidate',
          'cand',
          '--store',
          p.store,
          '--margin',
          '5',
          '--json',
        ],
        p.dir,
      ),
    );
    const o = await reportOf(p, 'cand', 'bl', ['--baseline', 'base', '--margin', '5']);
    const word: Record<string, string> = {
      'non-inferior': 'non-inferior',
      regressed: 'regressed',
      unproven: 'unproven',
    };
    const label: Record<string, string> = {
      'non-inferior': 'Non-inferior',
      regressed: 'Regressed',
      unproven: 'Not shown non-inferior',
    };
    return expectAll([
      [
        o.r.out.includes(`Against baseline base: ${word[c?.verdict]}, margin 5.0 points`),
        `expected the verdict ${c?.verdict} in the text, got ${brief(o.r.out)}`,
      ],
      [
        o.html.includes(`verdict-label">${label[c?.verdict]}<`),
        `expected the page label "${label[c?.verdict]}"`,
      ],
      [/<h2>Baseline and candidate/.test(o.html), 'no "Baseline and candidate" section'],
    ]);
  },
);

add(
  FR,
  'report-margin-range',
  1,
  10,
  'adversarial',
  'driftbench report',
  `${QREP} (--margin shared with compare and ci)`,
  'a margin of 0 or 100 exits 2 for report as it does for compare',
  async (ctx) => {
    const p = await smallPair(ctx);
    const a = await cli(
      [
        'report',
        'cand',
        '--store',
        p.store,
        '--out',
        join(p.dir, 'm.html'),
        '--baseline',
        'base',
        '--margin',
        '0',
      ],
      p.dir,
    );
    const b = await cli(
      [
        'report',
        'cand',
        '--store',
        p.store,
        '--out',
        join(p.dir, 'm.html'),
        '--baseline',
        'base',
        '--margin',
        '100',
      ],
      p.dir,
    );
    return expectAll([[a.code === 2 && b.code === 2, `expected 2 and 2, got ${a.code} and ${b.code}`]]);
  },
);

add(
  FR,
  'report-bad-numbers',
  2,
  10,
  'adversarial',
  'driftbench report',
  `${QREP} (exit 2 on bad input)`,
  'a non-numeric --max-runs or --min-goldens and an unknown --spread-mode exit 2',
  async (ctx) => {
    const p = await smallPair(ctx);
    const seen: string[] = [];
    for (const extra of [
      ['--max-runs', 'abc'],
      ['--min-goldens', 'abc'],
      ['--spread-mode', 'X'],
      ['--pilot', join(p.dir, 'nopilot')],
    ]) {
      const r = await cli(
        ['report', 'cand', '--store', p.store, '--out', join(p.dir, 'n.html'), ...extra],
        p.dir,
      );
      seen.push(`${extra[0]}:${r.code}`);
    }
    return expectAll([
      [seen.every((s) => s.endsWith(':2')), `expected exit 2 for each, got ${seen.join(' ')}`],
    ]);
  },
);

add(
  FR,
  'committed-junit-consistent',
  2,
  10,
  'contract',
  'docs/scorecards.md',
  'examples/acme/reports/README.md "What they show" (the Acme agents pass all N runs; the fault campaign fails F of its N runs)',
  'the committed Acme JUnit holds the testcases the README states and no failure, the faults one the testcases and failures the README states, each total equal to its suites',
  async (ctx) => {
    const bad: string[] = [];
    const claim = readmeClaims(ctx.root);
    if (claim.runs === undefined || claim.faultFails === undefined || claim.faultRuns === undefined)
      return fail(
        'the README states no run count for the Acme campaign or no failing count for the fault campaign',
      );
    for (const [f, tests, fails] of [
      ['acme-junit.xml', claim.runs, 0],
      ['acme-faults-junit.xml', claim.faultRuns, claim.faultFails],
    ] as const) {
      const xml = readFileSync(join(ctx.root, 'examples/acme/reports', f), 'utf8');
      const head = /<testsuites [^>]*tests="(\d+)" failures="(\d+)"/.exec(xml);
      const cases = (xml.match(/<testcase /g) ?? []).length;
      const fcases = (xml.match(/<failure /g) ?? []).length;
      if (cases < 1) bad.push(`${f} must show at least 1 run; found ${cases}`);
      if (f === 'acme-faults-junit.xml' && fcases < 1)
        bad.push(`${f} must show at least 1 failure; found ${fcases}`);
      const suiteTests = [...xml.matchAll(/<testsuite [^>]*tests="(\d+)"/g)].reduce(
        (a, m) => a + Number(m[1]),
        0,
      );
      if (
        !head ||
        Number(head[1]) !== tests ||
        Number(head[2]) !== fails ||
        cases !== tests ||
        fcases !== fails ||
        suiteTests !== tests
      )
        bad.push(
          `${f}: head ${head?.slice(1, 3)}, ${cases} cases, ${fcases} failures, suites sum ${suiteTests}`,
        );
    }
    return expectAll([[bad.length === 0, bad.join('; ')]]);
  },
);

add(
  FR,
  'committed-html-no-script',
  1,
  10,
  'contract',
  'docs/scorecards.md',
  'docs/viewer.md ("They load no script and no external asset")',
  'the three committed example scorecards hold no script and no external asset',
  async (ctx) => {
    const bad: string[] = [];
    for (const f of ['acme.html', 'acme-faults.html', 'pilot-acme-random.html']) {
      const h = readFileSync(join(ctx.root, 'examples/acme/reports', f), 'utf8');
      if (/<script/i.test(h) || /(?:src|href)="https?:/.test(h)) bad.push(f);
    }
    return expectAll([[bad.length === 0, `scripts or external assets in ${bad.join(', ')}`]]);
  },
);

// =========================================================================================================
// Family: the viewer, hand labels and the review queue.

const FV = 'breaker2-viewer';
const QVW = 'docs/viewer.md';

type Judged = { dir: string; store: string; runIds: string[]; blocks: number; criteria: string[] };

function judged(scratch: string): Promise<Judged> {
  return once(scratch, 'judged', async () => {
    const d = dir(scratch, 'judged');
    const specs = join(d, 'specs');
    put(
      join(specs, 'a.yaml'),
      `id: r-4001\nversion: '1'\ntitle: Two blocks, two criteria\nchannel: chat\nlang: EN\ntarget: { adapter: function, agent: acme-sales }\n` +
        `criteria:\n  - name: polite\n    rubric: The reply is polite.\n    gating: false\n    scope: block\n  - name: concise\n    rubric: The reply is short.\n    gating: false\n    scope: block\n` +
        `blocks:\n  - user: Hello, I would like faster home internet.\n    expect:\n      must: ['Acme Telecom']\n  - user: 14 Harbor Road, Acmeville\n    expect:\n      must: ['Fiber']\n`,
    );
    const store = join(d, 's.db');
    const run = await runCampaign(d, specs, 'function:acme-sales', store, 'q1', ['--repeats', '3']);
    const runIds = run.cells.map((c) => (c as unknown as { runId: string }).runId);
    return { dir: d, store, runIds, blocks: 2, criteria: ['concise', 'polite'] };
  });
}

let viewSeq = 0;
function freshLabels(f: Judged): string {
  return join(f.dir, `labels-${++viewSeq}`);
}

// docs/viewer.md, "Labelling a block": validate the YAML keys, independently of the product reader.
const viewerLabelFile = z.object({
  criterion: z.string(),
  labelled_by: z.string(),
  blocks: z.array(
    z.object({
      id: z.string(),
      label: z.enum(['pass', 'fail']),
      note: z.string().optional(),
      transcript: z.array(
        z
          .object({
            role: z.enum(['user', 'agent', 'tool_call', 'tool_result']),
            text: z.string(),
            tool: z.string().optional(),
          })
          .refine(
            (turn) =>
              (turn.role !== 'tool_call' && turn.role !== 'tool_result') || typeof turn.tool === 'string',
          ),
      ),
    }),
  ),
});

function readLabels(labels: string, criterion: string): z.infer<typeof viewerLabelFile> | null {
  const f = join(labels, `${criterion}.yaml`);
  if (!existsSync(f)) return null;
  const parsed = viewerLabelFile.safeParse(parseYaml(readFileSync(f, 'utf8')));
  return parsed.success ? parsed.data : null;
}

/** Read the current page, as a reviewer does. Older viewers have no hidden token. */
async function labelForm(base: string, form: Record<string, string>): Promise<Record<string, string>> {
  const page = await http(
    base,
    `/campaign/${encodeURIComponent(form.campaign as string)}/run/${encodeURIComponent(form.run as string)}`,
  );
  if (page.status !== 200) throw new Error(`expected the label page, got ${page.status}`);
  const label = /<form\b[^>]*action=["']\/labels["'][^>]*>[\s\S]*?<\/form>/i.exec(page.text)?.[0];
  if (!label) throw new Error('the page has no label form');
  const tokenInput = [...label.matchAll(/<input\b[^>]*>/gi)].find((match) =>
    /\bname=["']csrf["']/i.test(match[0]),
  )?.[0];
  if (!tokenInput) return { ...form };
  const csrf = /\bvalue=["']([^"']*)["']/i.exec(tokenInput)?.[1];
  if (csrf === undefined) throw new Error('the csrf input has no value');
  return { ...form, csrf };
}

async function postLabelForm(base: string, form: Record<string, string>) {
  return http(base, '/labels', {
    form: await labelForm(base, form),
    headers: { Origin: new URL(base).origin },
  });
}

/** Take a queue item through the queue page: its hidden token and the page's own Origin. */
async function postQueueAssign(base: string, form: Record<string, string>) {
  const page = await http(base, '/queue');
  if (page.status !== 200) throw new Error(`expected the queue page, got ${page.status}`);
  const csrf = viewerForms(page.text, '/queue', base).find((x) => x.method === 'post' && x.fields.csrf)
    ?.fields.csrf;
  return http(base, '/queue/assign', {
    form: csrf === undefined ? form : { ...form, csrf },
    headers: { Origin: new URL(base).origin },
  });
}

add(
  FV,
  'localhost-only',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} (the viewer listens on 127.0.0.1 only)`,
  'the viewer answers on 127.0.0.1 and refuses a connection on the machine other address',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const { networkInterfaces } = await import('node:os');
    const ext = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && !i.internal && i.family === 'IPv4')?.address;
    let local = 0;
    let extRes = 'skipped';
    const r = await withViewer(
      ['--store', f.store, '--port', '0', '--labels', freshLabels(f)],
      f.dir,
      async (base) => {
        local = (await http(base, '/')).status;
        const port = new URL(base).port;
        if (ext)
          extRes = await fetch(`http://${ext}:${port}/`)
            .then((x) => String(x.status))
            .catch((e) => `refused:${(e as { cause?: { code?: string } }).cause?.code ?? 'err'}`);
      },
    );
    return expectAll([
      [local === 200, `127.0.0.1 answered ${local}`],
      [
        extRes === 'skipped' || extRes.startsWith('refused'),
        `expected a refused connection on ${ext}, got ${extRes}`,
      ],
      [
        r.out.includes('driftbench view at http://127.0.0.1:'),
        `expected the start line, got ${brief(r.out)}`,
      ],
    ]);
  },
);

add(
  FV,
  'stop-exit-0',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} (Exit 0 after a stop)`,
  'the command runs until stopped and exits 0 after the stop',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const r = await withViewer(
      ['--store', f.store, '--port', '0', '--labels', freshLabels(f)],
      f.dir,
      async () => undefined,
    );
    return expectAll([
      [
        r.code === 0 && r.out.includes('Stop with Ctrl+C'),
        `expected exit 0 after stop and the stop hint, got ${r.code} ${brief(r.out)}`,
      ],
    ]);
  },
);

add(
  FV,
  'port-zero-free',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} (--port 0 picks a free one)`,
  '--port 0 prints the port actually opened and not 0',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    let st = 0;
    const r = await withViewer(
      ['--store', f.store, '--port', '0', '--labels', freshLabels(f)],
      f.dir,
      async (base) => {
        st = (await http(base, '/')).status;
      },
    );
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(r.out)?.[1]);
    return expectAll([
      [port > 0 && st === 200, `expected a non-zero port answering 200, got port ${port} status ${st}`],
    ]);
  },
);

add(
  FV,
  'missing-store-exit-2',
  1,
  10,
  'adversarial',
  'driftbench view',
  `${QVW} (the command stops with exit 2 when it is missing)`,
  'a missing store exits 2 and creates no store file',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const miss = join(f.dir, 'missing.db');
    const r = await cli(['view', '--store', miss, '--port', '0'], f.dir);
    return expectAll([
      [
        r.code === 2 && !existsSync(miss),
        `expected exit 2 and no file, got ${r.code} exists ${existsSync(miss)}`,
      ],
    ]);
  },
);

add(
  FV,
  'bad-port-exit-2',
  1,
  10,
  'adversarial',
  'driftbench view',
  `${QVW} (exit 2 when the port is not a number)`,
  'a port that is a word, negative, fractional or above 65535 exits 2',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const seen: string[] = [];
    for (const port of ['abc', '-1', '1.5', '70000'])
      seen.push(`${port}:${(await cli(['view', '--store', f.store, '--port', port], f.dir)).code}`);
    return expectAll([[seen.every((s) => s.endsWith(':2')), `expected 2 for each, got ${seen.join(' ')}`]]);
  },
);

add(
  FV,
  'port-busy-exit-2',
  3,
  10,
  'adversarial',
  'driftbench view',
  `${QVW} (exit 2 when the port cannot be opened)`,
  'a port already in use exits 2 and names the problem',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const net = await import('node:net');
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const r = await cli(['view', '--store', f.store, '--port', String(port)], f.dir);
    srv.close();
    return expectAll([
      [
        r.code === 2 && /EADDRINUSE|in use|cannot/i.test(r.err),
        `expected exit 2, got ${r.code}: ${brief(r.err)}`,
      ],
    ]);
  },
);

add(
  FV,
  'csp-no-script',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} (no script and no external asset, a content security policy says so; the queue page and the block pages may run their keyboard script, allowed by the hash of its exact text, and nothing else runs script)`,
  'every page carries a content security policy that blocks script except the hash of its own inline keyboard script, and only the queue and block pages hold one',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const bad: string[] = [];
    // docs/viewer.md: the queue page and a block page (the label form) may each run one inline script, allowed
    // by the sha256 of its exact text in script-src; every other page holds no script.
    const scripted = new Set(['/queue', `/campaign/q1/run/${f.runIds[0]}`]);
    await withViewer(['--store', f.store, '--port', '0', '--labels', freshLabels(f)], f.dir, async (base) => {
      for (const path of [
        '/',
        '/compare',
        '/queue',
        '/keys',
        '/campaign/q1',
        `/campaign/q1/run/${f.runIds[0]}`,
      ]) {
        const r = await http(base, path);
        const csp = r.csp ?? '';
        if (!/default-src 'none'/.test(csp) || /script-src[^;]*('unsafe|\*)/.test(csp))
          bad.push(`${path}: csp ${r.csp}`);
        const scripts = [...r.text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
        if (scripts.length > 0 && !scripted.has(path))
          bad.push(`${path}: ${scripts.length} script element(s)`);
        for (const [, attributes, body] of scripts) {
          if (/\bsrc=/i.test(attributes ?? '')) bad.push(`${path}: a script with src`);
          const hash = createHash('sha256')
            .update(body ?? '')
            .digest('base64');
          if (!csp.includes(`'sha256-${hash}'`))
            bad.push(`${path}: a script whose hash ${hash} the csp does not allow`);
        }
        if (/(?:src|href)="https?:/.test(r.text)) bad.push(`${path}: external asset`);
      }
    });
    return expectAll([[bad.length === 0, bad.join('; ')]]);
  },
);

add(
  FV,
  'home-lists-campaigns',
  3,
  10,
  'contract',
  'driftbench view',
  `${QVW} "The pages" (/: every campaign, newest first, with its modes, specs, runs and how many pass)`,
  'the home page lists every campaign newest first with its runs and passing count',
  async (ctx) => {
    const p = await smallPair(ctx);
    const cells = await runCells(p, 'cand');
    const pass = cells.filter((c) => c.state === 'pass').length;
    let page = '';
    await withViewer(
      ['--store', p.store, '--port', '0', '--labels', join(p.dir, 'vl')],
      p.dir,
      async (base) => {
        page = (await http(base, '/')).text;
      },
    );
    const rows = [...page.matchAll(/<tr><td class="mono"><a href="\/campaign\/([^"]+)">[\s\S]*?<\/tr>/g)];
    const ids = rows.map((m) => m[1]);
    const candRow = (rows.find((m) => m[1] === 'cand')?.[0] ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    return expectAll([
      [
        ids.indexOf('cand') >= 0 && ids.indexOf('cand') < ids.indexOf('base'),
        `expected cand before base (newest first), got ${ids.join(',')}`,
      ],
      [
        candRow.includes(`${cells.length} runs`) &&
          new RegExp(` ${pass} ${cells.length - pass}\\s*$`).test(candRow),
        `expected ${cells.length} runs, ${pass} passing in "${candRow}"`,
      ],
    ]);
  },
);

add(
  FV,
  'campaign-page-links-runs',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} "The pages" (every run in the drilldown links to its own page)`,
  'the campaign page links every run of the campaign to its own page',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    let links: string[] = [];
    await withViewer(['--store', f.store, '--port', '0', '--labels', freshLabels(f)], f.dir, async (base) => {
      const t = (await http(base, '/campaign/q1')).text;
      links = [...t.matchAll(/href="\/campaign\/q1\/run\/([^"#?]+)/g)].map((m) => m[1] as string);
    });
    const uniq = new Set(links);
    return expectAll([
      [
        f.runIds.every((r) => uniq.has(r)) && uniq.size === f.runIds.length,
        `expected links to ${f.runIds.join(',')}, got ${[...uniq].join(',')}`,
      ],
    ]);
  },
);

add(
  FV,
  'run-page-blocks-and-forms',
  3,
  10,
  'contract',
  'driftbench view',
  `${QVW} "The pages" (one run, every block in full; a label form under each block)`,
  'a run page shows each block with the user and agent text and one label form per block',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    let t = '';
    await withViewer(['--store', f.store, '--port', '0', '--labels', freshLabels(f)], f.dir, async (base) => {
      t = (await http(base, `/campaign/q1/run/${f.runIds[0]}`)).text;
    });
    return expectAll([
      [
        (t.match(/class="block /g) ?? []).length === f.blocks,
        `expected ${f.blocks} blocks, got ${(t.match(/class="block /g) ?? []).length}`,
      ],
      [
        (t.match(/<form method="post" action="\/labels"/g) ?? []).length === f.blocks,
        'expected one label form per block',
      ],
      [
        t.includes('Hello, I&#39;m new') || t.includes('I would like faster home internet'),
        'the user text of block 0 is missing',
      ],
      [t.includes('Acme Telecom sales assistant'), 'the agent reply of block 0 is missing'],
    ]);
  },
);

add(
  FV,
  'form-offers-spec-criteria',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} "Labelling a block" (the judged criteria of its spec)`,
  'the label form offers exactly the judged criteria of the spec',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    let opts: string[] = [];
    await withViewer(['--store', f.store, '--port', '0', '--labels', freshLabels(f)], f.dir, async (base) => {
      const t = (await http(base, `/campaign/q1/run/${f.runIds[0]}`)).text;
      opts = [
        ...(/<select name="criterion"[\s\S]*?<\/select>/.exec(t)?.[0] ?? '').matchAll(/value="([^"]+)"/g),
      ]
        .map((m) => m[1] as string)
        .sort();
    });
    return expectAll([
      [opts.join(',') === f.criteria.join(','), `expected ${f.criteria.join(',')}, got ${opts.join(',')}`],
    ]);
  },
);

add(
  FV,
  'label-file-shape',
  3,
  1,
  'contract',
  'driftbench view',
  `${QVW} "Labelling a block" (one label is one block of <labels>/<criterion>.yaml, id <runId>.b<block>)`,
  'saving a label writes <criterion>.yaml with the id runId.bN, the label, the note and the transcript',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    let saved = 0;
    await withViewer(['--store', f.store, '--port', '0', '--labels', labels], f.dir, async (base) => {
      saved = (
        await postLabelForm(base, {
          campaign: 'q1',
          run: f.runIds[0] as string,
          block: '1',
          criterion: 'polite',
          label: 'fail',
          note: 'Too curt.',
        })
      ).status;
    });
    const l = readLabels(labels, 'polite');
    const b = l?.blocks[0];
    return expectAll([
      [saved === 303, `expected a 303 redirect, got ${saved}`],
      [
        l?.criterion === 'polite' &&
          l.labelled_by === 'a reviewer, in driftbench view' &&
          l.blocks.length === 1,
        "expected YAML keys criterion (polite), labelled_by (the default), and blocks (one labelled block), with id, label, note, transcript and each turn's role/text and tool on tool turns",
      ],
      [
        b?.id === `${f.runIds[0]}.b1` && b?.label === 'fail' && b?.note === 'Too curt.',
        `expected id ${f.runIds[0]}.b1 fail "Too curt.", got ${JSON.stringify(b)}`,
      ],
      [
        (b?.transcript ?? []).some((t) => t.role === 'user' && t.text.includes('14 Harbor Road')) &&
          (b?.transcript ?? []).some((t) => t.role === 'agent'),
        `expected the user turn and the reply in the transcript, got ${JSON.stringify(b?.transcript)}`,
      ],
    ]);
  },
);

add(
  FV,
  'labelled-by-default-and-flag',
  2,
  1,
  'contract',
  'driftbench view',
  `${QVW} (--labelled-by, default "a reviewer, in driftbench view")`,
  'labelled_by is the default text without the flag and the flag value with it',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const l1 = freshLabels(f);
    const l2 = freshLabels(f);
    const form = {
      campaign: 'q1',
      run: f.runIds[0] as string,
      block: '0',
      criterion: 'polite',
      label: 'pass',
      note: 'x',
    };
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', l1],
      f.dir,
      async (b) => void (await postLabelForm(b, form)),
    );
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', l2, '--labelled-by', 'Rae Example'],
      f.dir,
      async (b) => void (await postLabelForm(b, form)),
    );
    return expectAll([
      [
        readLabels(l1, 'polite')?.labelled_by === 'a reviewer, in driftbench view',
        `default: got ${readLabels(l1, 'polite')?.labelled_by}`,
      ],
      [
        readLabels(l2, 'polite')?.labelled_by === 'Rae Example',
        `flag: got ${readLabels(l2, 'polite')?.labelled_by}`,
      ],
    ]);
  },
);

add(
  FV,
  'relabel-replaces',
  3,
  1,
  'contract',
  'driftbench view',
  QVW +
    ' (labelling the same block on the same criterion again replaces its label; every other block and labelled_by stay)',
  'a second label on one block replaces it and leaves the other block and labelled_by alone',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    const run = f.runIds[0] as string;
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', labels, '--labelled-by', 'First Reviewer'],
      f.dir,
      async (b) => {
        await postLabelForm(b, {
          campaign: 'q1',
          run,
          block: '0',
          criterion: 'polite',
          label: 'pass',
          note: 'a',
        });
        await postLabelForm(b, {
          campaign: 'q1',
          run,
          block: '1',
          criterion: 'polite',
          label: 'fail',
          note: 'b',
        });
      },
    );
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', labels, '--labelled-by', 'Second Reviewer'],
      f.dir,
      async (b) => {
        await postLabelForm(b, {
          campaign: 'q1',
          run,
          block: '0',
          criterion: 'polite',
          label: 'fail',
          note: 'c',
        });
      },
    );
    const l = readLabels(labels, 'polite');
    const b0 = l?.blocks.filter((x) => x.id === `${run}.b0`) ?? [];
    const b1 = l?.blocks.find((x) => x.id === `${run}.b1`);
    return expectAll([
      [
        b0.length === 1 && b0[0]?.label === 'fail' && b0[0]?.note === 'c',
        `block 0 should hold one label fail/c, got ${JSON.stringify(b0)}`,
      ],
      [b1?.label === 'fail' && b1?.note === 'b', `block 1 should stay fail/b, got ${JSON.stringify(b1)}`],
      [l?.labelled_by === 'First Reviewer', `labelled_by should stay First Reviewer, got ${l?.labelled_by}`],
    ]);
  },
);

// These helpers belong to the write-protection item, not the other viewer contracts.
function viewerHtmlText(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    if (entity.startsWith('#')) {
      return String.fromCodePoint(
        entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
      );
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[entity] ?? entity;
  });
}

function viewerAttributes(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/\s([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((match) => [
      (match[1] as string).toLowerCase(),
      viewerHtmlText(match[2] ?? match[3] ?? match[4] ?? ''),
    ]),
  );
}

type ViewerForm = {
  page: string;
  index: number;
  action: string;
  method: string;
  fields: Record<string, string>;
};

/** Submit the generated HTML controls, choosing the first offered radio when none is checked. */
function viewerForms(html: string, page: string, base: string): ViewerForm[] {
  return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].map((match, index) => {
    const attrs = viewerAttributes(match[0].slice(0, match[0].indexOf('>') + 1));
    const action = new URL(attrs.action ?? page, base + page);
    if (action.origin !== base) throw new Error('viewer form action must stay on its own origin');
    const fields: Record<string, string> = {};
    const body = match[1] as string;
    for (const input of body.matchAll(/<input\b[^>]*>/gi)) {
      const a = viewerAttributes(input[0]);
      if (!a.name || 'disabled' in a || ['submit', 'button', 'reset', 'file'].includes(a.type ?? ''))
        continue;
      if (a.type === 'checkbox' && !('checked' in a)) continue;
      if (a.type === 'radio' && a.name in fields && !('checked' in a)) continue;
      fields[a.name] = a.value ?? (a.type === 'checkbox' ? 'on' : '');
    }
    for (const select of body.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)) {
      const a = viewerAttributes(select[0].slice(0, select[0].indexOf('>') + 1));
      if (!a.name || 'disabled' in a) continue;
      const options = [...(select[1] as string).matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)]
        .map((option) => ({
          attrs: viewerAttributes(option[0].slice(0, option[0].indexOf('>') + 1)),
          text: viewerHtmlText(option[1] as string),
        }))
        .filter((option) => !('disabled' in option.attrs));
      const selected = options.find((option) => 'selected' in option.attrs) ?? options[0];
      if (selected) fields[a.name] = selected.attrs.value ?? selected.text;
    }
    for (const textarea of body.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi)) {
      const a = viewerAttributes(textarea[0].slice(0, textarea[0].indexOf('>') + 1));
      if (a.name && !('disabled' in a)) fields[a.name] = viewerHtmlText(textarea[1] as string);
    }
    return {
      page,
      index,
      action: action.pathname + action.search,
      method: (attrs.method ?? 'get').toLowerCase(),
      fields,
    };
  });
}

/**
 * Crawl every linked viewer page, including GET-form destinations. Read every POST form and group by
 * action, not a maintained route list. A write route added to a viewer page joins the matrix without
 * editing this item. server.ts at PR 298 serves index, compare, keys, queue, campaign and run pages;
 * navigation plus campaign/run links reach all of them. Seed the queue so its Take forms are present.
 */
async function viewerWriteForms(base: string): Promise<Map<string, ViewerForm[]>> {
  const pending = ['/'];
  const visited = new Set<string>();
  const routes = new Map<string, ViewerForm[]>();
  const enqueue = (href: string, from: string) => {
    const url = new URL(href, base + from);
    if (url.origin !== base) return;
    url.hash = '';
    url.searchParams.sort();
    const path = url.pathname + url.search;
    if (!visited.has(path) && !pending.includes(path)) pending.push(path);
  };
  while (pending.length > 0) {
    const page = pending.shift() as string;
    visited.add(page);
    if (visited.size > 1000) throw new Error('viewer page crawl did not converge');
    const response = await http(base, page);
    if (response.status !== 200) throw new Error(`viewer page ${page}: expected 200, got ${response.status}`);
    for (const link of response.text.matchAll(/<a\b[^>]*>/gi)) {
      const href = viewerAttributes(link[0]).href;
      if (href !== undefined) enqueue(href, page);
    }
    for (const form of viewerForms(response.text, page, base)) {
      if (form.method === 'post') {
        const forms = routes.get(form.action) ?? [];
        forms.push(form);
        routes.set(form.action, forms);
      } else if (form.method === 'get') {
        const url = new URL(form.action, base);
        url.search = new URLSearchParams(form.fields).toString();
        enqueue(url.href, page);
      } else throw new Error(`unsupported page form method: ${form.method}`);
    }
  }
  if (routes.size === 0) throw new Error('viewer crawl found no POST forms');
  return routes;
}

/** Exact names and bytes, recursively: includes queue.json, labels, and unexpected temporary files. */
function viewerFilesSnapshot(path: string): string {
  if (!existsSync(path)) return 'absent';
  return JSON.stringify(
    readdirSync(path, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => [
        entry.name,
        entry.isDirectory()
          ? viewerFilesSnapshot(join(path, entry.name))
          : readFileSync(join(path, entry.name)).toString('base64'),
      ]),
  );
}

add(
  FV,
  'label-write-requires-token-and-origin',
  3,
  1,
  'adversarial',
  'driftbench view',
  `${QVW} (every form write route: exact Host, own Origin or Referer fallback, body token, POST only, fresh 64-hex token at each start)`,
  'every discovered write route obeys all runtime HTTP methods and the Host, origin and token matrix; tokens are 64 hex characters and change across identical starts',
  async (ctx) => {
    const { METHODS, request } = await import('node:http');
    const { startViewer } = await import('../../../../../../cli/src/view/server');
    const f = await judged(ctx.scratch);
    const checks: [boolean, string][] = [];
    const fixture = freshLabels(f);
    const created = await cli(
      ['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', fixture],
      f.dir,
    );
    if (created.code !== 0) return fail(`queue fixture failed: ${created.err}`);
    const queue = readFileSync(join(fixture, 'queue.json'), 'utf8');
    // Start the real server directly: each case still gets a fresh viewer and labels folder,
    // without CLI signal handlers or readiness polling for every runtime HTTP method.
    const isolatedViewer = async (labels: string, body: (base: string) => Promise<void>, port = '0') => {
      const viewer = await startViewer({ store: f.store, labels, port: Number(port) });
      try {
        await body(viewer.url);
      } finally {
        await viewer.close();
      }
    };
    let routes = new Map<string, ViewerForm[]>();
    await isolatedViewer(fixture, async (base) => {
      routes = await viewerWriteForms(base);
    });
    if (routes.size === 0) return fail('viewer discovery found no write routes');
    type OriginKind = 'own' | 'foreign' | 'absent' | 'near-userinfo' | 'near-suffix' | 'near-null';
    type RefererKind = 'own' | 'foreign' | 'absent' | 'malformed' | 'near-userinfo' | 'near-path';
    const matrix = [...routes.values()].flatMap((forms) =>
      METHODS.flatMap((method) =>
        (['own', 'foreign', 'different-port'] as const).flatMap((host) =>
          (['own', 'foreign', 'absent'] as OriginKind[]).flatMap((origin) =>
            (['own', 'foreign', 'absent', 'malformed'] as RefererKind[]).flatMap((referer) =>
              (['body', 'missing', 'wrong', 'query-only', 'header-only'] as const).map((token) => ({
                form: forms[Math.abs(ctx.seed) % forms.length] as ViewerForm,
                method,
                host,
                origin,
                referer,
                token,
              })),
            ),
          ),
        ),
      ),
    );
    // Near-miss origins look like the viewer's own address but name another site. A valid page form with
    // a correct token and the exact Host must still be refused with 403 for each of them.
    const nearMisses: [OriginKind, RefererKind][] = [
      ['near-userinfo', 'absent'],
      ['near-suffix', 'absent'],
      ['near-null', 'absent'],
      ['absent', 'near-userinfo'],
      ['absent', 'near-path'],
    ];
    const nearCases = [...routes.values()].flatMap((forms) =>
      nearMisses.map(([origin, referer]) => ({
        form: forms[Math.abs(ctx.seed) % forms.length] as ViewerForm,
        method: 'POST',
        host: 'own' as const,
        origin,
        referer,
        token: 'body' as const,
      })),
    );
    // The token is read only for POST. Every other method keeps the token that the page supplies, plus one
    // trusted request with the token missing: the method check must answer 405 before any token check.
    const cases = [
      ...matrix.filter(
        (c) =>
          c.method === 'POST' ||
          c.token === 'body' ||
          (c.token === 'missing' && c.host === 'own' && c.origin === 'own' && c.referer === 'absent'),
      ),
      ...nearCases,
    ];
    for (const { form: source, method, host, origin, referer, token } of cases) {
      // docs/viewer.md: "Requests must use the exact `127.0.0.1:<port>` address printed at startup."
      // "Other Host headers are refused to block DNS rebinding."
      // "Writes also require the viewer's own Origin, or a same-origin Referer when Origin is absent,
      // and a hidden form token generated at each start."
      // "Rejected requests return HTTP 403 with a plain message and write nothing."
      // "The write routes (`/labels` and `/queue/assign`) accept POST only; after the Host and origin
      // checks, PUT, DELETE, PATCH, HEAD and OPTIONS return HTTP 405 and write nothing."
      // "GET returns HTTP 404, TRACE returns HTTP 405, and Node closes CONNECT without an HTTP
      // response before it reaches the viewer's request handler." All other non-POST methods must
      // also return 405 after the guards. GET, HEAD and OPTIONS are reads, so skip the origin guard.
      // Origin takes precedence over Referer. Non-POST bodies are never token-checked or written.
      const trusted = host === 'own' && (origin === 'own' || (origin === 'absent' && referer === 'own'));
      const expected =
        method === 'CONNECT'
          ? undefined
          : host !== 'own'
            ? 403
            : method === 'GET'
              ? 404
              : method === 'HEAD' || method === 'OPTIONS'
                ? 405
                : !trusted
                  ? 403
                  : method !== 'POST'
                    ? 405
                    : token === 'body'
                      ? 303
                      : 403;
      const context = `${method} ${source.action}, Host=${host}, Origin=${origin}, Referer=${referer}, token=${token}`;
      const labels = freshLabels(f);
      put(join(labels, 'queue.json'), queue);
      // A pre-existing label also has to survive refusals, not merely remain absent.
      put(
        join(labels, 'preserved.yaml'),
        'criterion: preserved\nlabelled_by: Fictional Reviewer\nblocks: []\n',
      );
      const before = viewerFilesSnapshot(labels);
      let status: number | undefined;
      let submitted: Record<string, string> = {};
      await isolatedViewer(labels, async (base) => {
        const page = await http(base, source.page);
        if (page.status !== 200) throw new Error(`form page: expected 200, got ${page.status}`);
        const live = viewerForms(page.text, source.page, base)[source.index];
        if (!live || live.action !== source.action || live.method !== 'post') {
          throw new Error(`discovered form changed at ${source.page}`);
        }
        const form = { ...live.fields };
        submitted = { ...form };
        const csrf = form.csrf ?? '';
        checks.push([csrf.length > 0, `${context}: page form must supply a csrf token`]);
        if (token !== 'body') delete form.csrf;
        if (token === 'wrong') form.csrf = `${csrf}-wrong`;
        const url = new URL(source.action, base);
        if (token === 'query-only') url.searchParams.set('csrf', csrf);
        const address = new URL(base);
        const otherPort = Number(address.port) === 65535 ? 1 : Number(address.port) + 1;
        const headers: Record<string, string> = {
          'content-type': 'application/x-www-form-urlencoded',
          Host:
            host === 'own'
              ? address.host
              : host === 'foreign'
                ? 'foreign.example'
                : `${address.hostname}:${otherPort}`,
        };
        if (origin !== 'absent') {
          headers.Origin =
            origin === 'own'
              ? base
              : origin === 'near-userinfo'
                ? `http://${address.host}@foreign.example`
                : origin === 'near-suffix'
                  ? `${base}.foreign.example`
                  : origin === 'near-null'
                    ? 'null'
                    : 'https://foreign.example';
        }
        if (referer !== 'absent') {
          headers.Referer =
            referer === 'own'
              ? base + source.page
              : referer === 'foreign'
                ? 'https://foreign.example/review'
                : referer === 'near-userinfo'
                  ? `http://${address.host}@foreign.example/review`
                  : referer === 'near-path'
                    ? `https://foreign.example/${base}/review`
                    : 'not a URL';
        }
        if (token === 'header-only') headers['X-CSRF-Token'] = csrf;
        // node:http preserves an explicit Host; fetch may replace it. Send a body for every method.
        const body = new URLSearchParams(form).toString();
        headers['content-length'] = String(Buffer.byteLength(body));
        status = await new Promise<number | undefined>((resolve, reject) => {
          const req = request(url, { method, headers }, (res) => {
            res.on('error', reject);
            res.on('end', () => resolve(res.statusCode ?? 0));
            res.resume();
          });
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res.statusCode);
          });
          req.on('error', (error: NodeJS.ErrnoException) => {
            if (method === 'CONNECT' && error.code === 'ECONNRESET') resolve(undefined);
            else reject(error);
          });
          req.end(body);
        });
      });
      const after = viewerFilesSnapshot(labels);
      checks.push([
        status === expected,
        `${context}: expected ${expected ?? 'connection closed without HTTP response'}, got ${status ?? 'connection closed without HTTP response'}`,
      ]);
      if (expected === 303) {
        checks.push([after !== before, `${context}: expected a persisted write from the valid page form`]);
        if ('label' in submitted && 'run' in submitted && 'block' in submitted) {
          const saved = readLabels(labels, submitted.criterion as string);
          checks.push([
            saved !== null &&
              saved.criterion === submitted.criterion &&
              saved.blocks.length === 1 &&
              saved.blocks[0]?.id === `${submitted.run}.b${submitted.block}` &&
              saved.blocks[0]?.label === submitted.label,
            `${context}: expected the submitted label under the documented YAML keys`,
          ]);
        } else if ('id' in submitted && 'criterion' in submitted) {
          const saved = JSON.parse(readFileSync(join(labels, 'queue.json'), 'utf8')) as {
            entries: { id: string; criterion: string; state: string; assignee?: string }[];
          };
          checks.push([
            saved.entries.some(
              (entry) =>
                entry.id === submitted.id &&
                entry.criterion === submitted.criterion &&
                entry.state === 'assigned' &&
                entry.assignee === 'a reviewer, in driftbench view',
            ),
            `${context}: expected the submitted queue item assigned to the viewer`,
          ]);
        }
      } else {
        checks.push([after === before, `${context}: refused request changed labels or queue.json`]);
      }
    }
    // docs/viewer.md: "a hidden form token generated at each start" and
    // "Reload an old form after restarting the viewer."
    // Hold these public inputs identical: start options, cwd, store, labels folder, reviewer and fixed port.
    // Different tokens rule out a token derived solely from those inputs. Length is encoding capacity,
    // not proof of cryptographic entropy. docs/viewer.md: "The token is 32 random bytes from the
    // system's cryptographic generator (64 hex characters), generated at each start and never
    // written to disk; an old token is refused after a restart."
    for (const forms of routes.values()) {
      const source = forms[Math.abs(ctx.seed) % forms.length] as ViewerForm;
      const labels = freshLabels(f);
      put(join(labels, 'queue.json'), queue);
      put(
        join(labels, 'preserved.yaml'),
        'criterion: preserved\nlabelled_by: Fictional Reviewer\nblocks: []\n',
      );
      const before = viewerFilesSnapshot(labels);
      let port = '0';
      // Discover a free local port, then use that exact argument for both measured starts.
      await isolatedViewer(labels, async (base) => {
        port = new URL(base).port;
      });
      const readForm = async (base: string) => {
        const page = await http(base, source.page);
        if (page.status !== 200) throw new Error(`restart form page: expected 200, got ${page.status}`);
        const form = viewerForms(page.text, source.page, base)[source.index];
        if (!form || form.action !== source.action || form.method !== 'post') {
          throw new Error(`restart form changed at ${source.page}`);
        }
        return form.fields;
      };
      let oldToken = '';
      await isolatedViewer(
        labels,
        async (base) => {
          oldToken = (await readForm(base)).csrf ?? '';
          checks.push([
            /^[a-f\d]{64}$/i.test(oldToken),
            `${source.action}: first-start token must contain exactly 64 hex characters`,
          ]);
        },
        port,
      );
      checks.push([
        viewerFilesSnapshot(labels) === before,
        `${source.action}: reading the first-start form changed persisted state`,
      ]);
      await isolatedViewer(
        labels,
        async (base) => {
          const form = await readForm(base);
          const currentToken = form.csrf ?? '';
          checks.push(
            [
              /^[a-f\d]{64}$/i.test(currentToken),
              `${source.action}: second-start token must contain exactly 64 hex characters`,
            ],
            [
              oldToken !== currentToken,
              `${source.action}: identical public arguments must not reproduce the token across starts`,
            ],
          );
          const stale = await http(base, source.action, {
            form: { ...form, csrf: oldToken },
            headers: { Origin: base },
          });
          checks.push(
            [
              stale.status === 403,
              `${source.action}: old token after same-port restart expected 403, got ${stale.status}`,
            ],
            [
              viewerFilesSnapshot(labels) === before,
              `${source.action}: old token after restart changed labels or queue.json`,
            ],
          );
        },
        port,
      );
      checks.push([
        viewerFilesSnapshot(labels) === before,
        `${source.action}: restart refusal did not preserve persisted state`,
      ]);
    }
    const failures = checks.filter(([pass]) => !pass).map(([, detail]) => detail);
    return expectAll([[failures.length === 0, failures.join('; ')]]);
  },
);

add(
  FV,
  'label-saved-notice-and-counts',
  3,
  10,
  'contract',
  'driftbench view',
  `${QVW} "Labelling a block" ("Label saved"; the labelling section counts the labels per criterion)`,
  'the page after a save says Label saved and counts passes and fails per criterion, naming the missing side',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    const run = f.runIds[0] as string;
    let after = '';
    let two = '';
    await withViewer(['--store', f.store, '--port', '0', '--labels', labels], f.dir, async (b) => {
      const r = await postLabelForm(b, {
        campaign: 'q1',
        run,
        block: '0',
        criterion: 'polite',
        label: 'pass',
        note: 'a',
      });
      after = (await http(b, (r.loc ?? '').replace(/#.*/, ''))).text
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
      await postLabelForm(b, {
        campaign: 'q1',
        run,
        block: '1',
        criterion: 'polite',
        label: 'fail',
        note: 'b',
      });
      two = (await http(b, `/campaign/q1/run/${run}`)).text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    });
    return expectAll([
      [/Label saved/.test(after), 'no "Label saved" after the save'],
      [
        /polite : 1 pass, 0 fail\. judge calibrate needs at least one fail/.test(after),
        `expected the count and the missing fail label, got ${brief(after.slice(after.indexOf('Labelling')), 400)}`,
      ],
      [
        /polite : 1 pass, 1 fail/.test(two) &&
          !/needs at least one/.test(
            two.slice(two.indexOf('polite : 1 pass, 1 fail'), two.indexOf('polite : 1 pass, 1 fail') + 120),
          ),
        `expected 1 pass, 1 fail with no warning, got ${brief(two.slice(two.indexOf('Labelling'), two.indexOf('Labelling') + 400))}`,
      ],
    ]);
  },
);

add(
  FV,
  'label-path-traversal',
  3,
  1,
  'hostile',
  'driftbench view',
  `${QVW} (the label goes to the labels folder)`,
  'a criterion with a path separator or dots is refused and nothing is written outside the labels folder',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const root = dir(ctx.scratch, uniq('trav'));
    const labels = join(root, 'labels');
    mkdirSync(labels, { recursive: true });
    const sts: number[] = [];
    await withViewer(['--store', f.store, '--port', '0', '--labels', labels], f.dir, async (b) => {
      for (const c of ['../escape', 'a/b', '..', 'x\\y'])
        sts.push(
          (
            await postLabelForm(b, {
              campaign: 'q1',
              run: f.runIds[0] as string,
              block: '0',
              criterion: c,
              label: 'pass',
              note: 'x',
            })
          ).status,
        );
    });
    const outside = readdirSync(root).filter((n) => n !== 'labels');
    return expectAll([
      [
        sts.every((s) => s >= 400) && outside.length === 0,
        `expected 4xx for each and no file outside, got ${sts.join(',')} and ${outside.join(',')}`,
      ],
    ]);
  },
);

add(
  FV,
  'label-bad-block-and-value',
  2,
  1,
  'adversarial',
  'driftbench view',
  `${QVW} (pass or fail on a block)`,
  'a block that does not exist and a label other than pass or fail are refused',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    const sts: number[] = [];
    await withViewer(['--store', f.store, '--port', '0', '--labels', labels], f.dir, async (b) => {
      sts.push(
        (
          await postLabelForm(b, {
            campaign: 'q1',
            run: f.runIds[0] as string,
            block: '99',
            criterion: 'polite',
            label: 'pass',
            note: 'x',
          })
        ).status,
      );
      sts.push(
        (
          await postLabelForm(b, {
            campaign: 'q1',
            run: f.runIds[0] as string,
            block: '0',
            criterion: 'polite',
            label: 'maybe',
            note: 'x',
          })
        ).status,
      );
    });
    return expectAll([
      [
        sts.every((s) => s >= 400) && !existsSync(join(labels, 'polite.yaml')),
        `expected 4xx for both and no file, got ${sts.join(',')}`,
      ],
    ]);
  },
);

add(
  FV,
  'unknown-pages-404',
  1,
  10,
  'adversarial',
  'driftbench view',
  `${QVW} "The pages"`,
  'an unknown campaign, an unknown run and an unknown address answer 404',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const sts: number[] = [];
    await withViewer(['--store', f.store, '--port', '0', '--labels', freshLabels(f)], f.dir, async (b) => {
      for (const p of ['/campaign/nope', '/campaign/q1/run/zzz', '/nowhere'])
        sts.push((await http(b, p)).status);
    });
    return expectAll([[sts.every((s) => s === 404), `expected 404 for each, got ${sts.join(',')}`]]);
  },
);

add(
  FV,
  'compare-page-matches-cli',
  4,
  10,
  'contract',
  'driftbench view',
  `${QVW} "The pages" (/compare: the paired comparison of driftbench compare with its verdict)`,
  '/compare shows the same verdict and the same pair count as driftbench compare at the same margin',
  async (ctx) => {
    const p = await smallPair(ctx);
    const c = parse(
      await cli(
        [
          'compare',
          '--baseline',
          'base',
          '--candidate',
          'cand',
          '--store',
          p.store,
          '--margin',
          '5',
          '--json',
        ],
        p.dir,
      ),
    );
    const label: Record<string, string> = {
      'non-inferior': 'Non-inferior',
      regressed: 'Regressed',
      unproven: 'Not shown non-inferior',
    };
    let page = '';
    await withViewer(
      ['--store', p.store, '--port', '0', '--labels', join(p.dir, 'vl2')],
      p.dir,
      async (b) => {
        page = (await http(b, '/compare?baseline=base&candidate=cand&margin=5')).text;
      },
    );
    const n = p.n;
    return expectAll([
      [page.includes(`verdict-label">${label[c?.verdict]}<`), `expected the verdict ${label[c?.verdict]}`],
      [page.includes(`${n} paired goldens`), `expected "${n} paired goldens"`],
    ]);
  },
);

add(
  FV,
  'compare-page-bad-margin',
  2,
  10,
  'adversarial',
  'driftbench view',
  `${QVW} "The pages" (/compare)`,
  '/compare with a margin of 0, 100 or a word answers 400 and an unknown campaign 404',
  async (ctx) => {
    const p = await smallPair(ctx);
    const sts: number[] = [];
    await withViewer(
      ['--store', p.store, '--port', '0', '--labels', join(p.dir, 'vl3')],
      p.dir,
      async (b) => {
        for (const m of ['0', '100', 'abc'])
          sts.push((await http(b, `/compare?baseline=base&candidate=cand&margin=${m}`)).status);
        sts.push((await http(b, '/compare?baseline=base&candidate=nope&margin=5')).status);
      },
    );
    return expectAll([
      [sts.join(',') === '400,400,400,404', `expected 400,400,400,404, got ${sts.join(',')}`],
    ]);
  },
);

// ---- queue

add(
  FV,
  'queue-create-count',
  2,
  10,
  'contract',
  'driftbench queue',
  `${QVW} "Review queue" (queue create queues each block of the campaign once per criterion of its spec)`,
  'queue create queues runs times blocks times criteria items',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    const r = await cli(
      ['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels],
      f.dir,
    );
    const want = f.runIds.length * f.blocks * f.criteria.length;
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    return expectAll([
      [r.out.includes(`Queued ${want} items`), `expected "Queued ${want} items", got ${brief(r.out)}`],
      [
        l.out.trim().split('\n').pop() === `${want} items: ${want} open, 0 assigned, 0 done.`,
        `expected the summary for ${want} open, got ${brief(l.out.slice(-120))}`,
      ],
    ]);
  },
);

add(
  FV,
  'queue-create-idempotent',
  2,
  10,
  'contract',
  'driftbench queue',
  `${QVW} "Review queue" (each block once per criterion)`,
  'running queue create again queues nothing new and keeps the item count',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    const again = await cli(
      ['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels],
      f.dir,
    );
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    const want = f.runIds.length * f.blocks * f.criteria.length;
    return expectAll([
      [
        again.out.includes('Queued 0 items') && l.out.includes(`${want} items`),
        `expected 0 new and ${want} items, got ${brief(again.out)} / ${brief(l.out.slice(-80))}`,
      ],
    ]);
  },
);

add(
  FV,
  'queue-skips-labelled',
  3,
  10,
  'contract',
  'driftbench queue',
  `${QVW} "Review queue" (skipping blocks already labelled)`,
  'queue create skips a block already labelled on a criterion and queues the others',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await withViewer(['--store', f.store, '--port', '0', '--labels', labels], f.dir, async (b) => {
      await postLabelForm(b, {
        campaign: 'q1',
        run: f.runIds[0] as string,
        block: '0',
        criterion: 'polite',
        label: 'pass',
        note: 'x',
      });
    });
    const r = await cli(
      ['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels],
      f.dir,
    );
    const want = f.runIds.length * f.blocks * f.criteria.length - 1;
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    return expectAll([
      [r.out.includes(`Queued ${want} items`), `expected "Queued ${want} items", got ${brief(r.out)}`],
      [!l.out.includes(`polite\t${f.runIds[0]}.b0`), 'the labelled block is in the queue'],
    ]);
  },
);

add(
  FV,
  'queue-assign-holder',
  3,
  10,
  'contract',
  'driftbench queue',
  `${QVW} "Review queue" (another reviewer cannot take an item held by someone else)`,
  'a second reviewer is refused with exit 2 and the same reviewer may take it again',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    const id = `${f.runIds[0]}.b0`;
    const a = await cli(
      ['queue', 'assign', id, '--criterion', 'polite', '--reviewer', 'Ann', '--labels', labels],
      f.dir,
    );
    const b = await cli(
      ['queue', 'assign', id, '--criterion', 'polite', '--reviewer', 'Bob', '--labels', labels],
      f.dir,
    );
    const c = await cli(
      ['queue', 'assign', id, '--criterion', 'polite', '--reviewer', 'Ann', '--labels', labels],
      f.dir,
    );
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    return expectAll([
      [a.code === 0 && b.code === 2 && c.code === 0, `expected 0, 2, 0 got ${a.code}, ${b.code}, ${c.code}`],
      [l.out.includes(`assigned\tpolite\t${id}\tAnn`), 'the item is not listed as assigned to Ann'],
    ]);
  },
);

add(
  FV,
  'queue-assign-unknown',
  1,
  10,
  'adversarial',
  'driftbench queue',
  `${QVW} "Review queue"`,
  'assigning an item that is not in the queue exits 2',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    const r = await cli(
      ['queue', 'assign', 'nope.b9', '--criterion', 'polite', '--reviewer', 'Ann', '--labels', labels],
      f.dir,
    );
    const s = await cli(
      ['queue', 'create', '--store', f.store, '--campaign', 'nope', '--labels', labels],
      f.dir,
    );
    return expectAll([
      [r.code === 2 && s.code === 2, `expected exit 2 for both, got ${r.code} and ${s.code}`],
    ]);
  },
);

add(
  FV,
  'queue-label-marks-done',
  4,
  10,
  'contract',
  'driftbench view',
  `${QVW} "Review queue" (saving the label marks the item done)`,
  'taking an item on the queue page and saving its label marks it done in the queue file',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    const id = `${f.runIds[0]}.b1`;
    let taken = 0;
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', labels, '--labelled-by', 'Tess'],
      f.dir,
      async (b) => {
        taken = (await postQueueAssign(b, { criterion: 'polite', id })).status;
        await postLabelForm(b, {
          campaign: 'q1',
          run: f.runIds[0] as string,
          block: '1',
          criterion: 'polite',
          label: 'fail',
          note: 'n',
        });
      },
    );
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    return expectAll([
      [taken === 303, `take answered ${taken}`],
      [
        l.out.includes(`done\tpolite\t${id}\tTess`),
        `expected the item done and held by Tess, got ${brief(
          l.out
            .split('\n')
            .filter((x) => x.includes(id))
            .join(' | '),
        )}`,
      ],
    ]);
  },
);

add(
  FV,
  'queue-held-item-label-refused',
  4,
  10,
  'contract',
  'driftbench view',
  `${QVW} "Review queue" (another reviewer cannot take or label an item held by someone else)`,
  'a label saved by the viewer reviewer on an item held by another reviewer is refused and not written',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    const id = `${f.runIds[0]}.b0`;
    await cli(
      ['queue', 'assign', id, '--criterion', 'polite', '--reviewer', 'Ann', '--labels', labels],
      f.dir,
    );
    let st = 0;
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', labels, '--labelled-by', 'Tess'],
      f.dir,
      async (b) => {
        st = (
          await postLabelForm(b, {
            campaign: 'q1',
            run: f.runIds[0] as string,
            block: '0',
            criterion: 'polite',
            label: 'pass',
            note: 'x',
          })
        ).status;
      },
    );
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    return expectAll([
      [st >= 400, `expected a 4xx for labelling an item held by Ann, got ${st}`],
      [l.out.includes(`assigned\tpolite\t${id}\tAnn`), 'the item should stay assigned to Ann'],
      [!existsSync(join(labels, 'polite.yaml')), 'a label was written for an item held by another reviewer'],
    ]);
  },
);

add(
  FV,
  'queue-take-held-refused',
  3,
  10,
  'contract',
  'driftbench view',
  `${QVW} "Review queue" (Another reviewer cannot take ... an item held by someone else)`,
  'taking an item held by another reviewer on the queue page is refused',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    const id = `${f.runIds[0]}.b0`;
    await cli(
      ['queue', 'assign', id, '--criterion', 'polite', '--reviewer', 'Ann', '--labels', labels],
      f.dir,
    );
    let st = 0;
    await withViewer(
      ['--store', f.store, '--port', '0', '--labels', labels, '--labelled-by', 'Tess'],
      f.dir,
      async (b) => {
        st = (await postQueueAssign(b, { criterion: 'polite', id })).status;
      },
    );
    const l = await cli(['queue', 'list', '--labels', labels], f.dir);
    return expectAll([
      [
        st >= 400 && l.out.includes(`assigned\tpolite\t${id}\tAnn`),
        `expected a 4xx and the item still Ann's, got ${st}`,
      ],
    ]);
  },
);

add(
  FV,
  'queue-page-lists-items',
  2,
  10,
  'contract',
  'driftbench view',
  `${QVW} "Review queue" (the viewer /queue page lists the items)`,
  'the /queue page lists every queued item and its state',
  async (ctx) => {
    const f = await judged(ctx.scratch);
    const labels = freshLabels(f);
    await cli(['queue', 'create', '--store', f.store, '--campaign', 'q1', '--labels', labels], f.dir);
    let t = '';
    await withViewer(['--store', f.store, '--port', '0', '--labels', labels], f.dir, async (b) => {
      t = (await http(b, '/queue')).text;
    });
    const want = f.runIds.length * f.blocks * f.criteria.length;
    return expectAll([
      [
        (t.match(/<tr><td>open<\/td>/g) ?? []).length === want,
        `expected ${want} open rows, got ${(t.match(/<tr><td>open<\/td>/g) ?? []).length}`,
      ],
    ]);
  },
);

// =========================================================================================================
// Family: import (CSV, spreadsheet, traces) and approve.

const FI = 'breaker2-import';
const QTAB = 'docs/datasets.md "Import specs from a table"';
const QTR = 'docs/traces.md "Draft specs: driftbench import traces"';

const MAPPING_BASE = `spec:\n  id: "{id}"\n  title: "T {id}"\n  channel: chat\n  lang: EN\n  target: { adapter: function, agent: acme-sales }\nblock:\n  user: "{q}"\n`;

let impSeq = 0;
function impDir(scratch: string): string {
  return dir(scratch, `imp${++impSeq}`);
}

async function csvImport(
  scratch: string,
  csv: string,
  mapping: string,
  extra: string[] = [],
  name = 'in.csv',
): Promise<{ r: Cli; d: string; out: string; files: string[]; read: (f: string) => string }> {
  const d = impDir(scratch);
  put(join(d, name), csv);
  put(join(d, 'm.yaml'), mapping);
  const out = join(d, 'out');
  const r = await cli(
    [
      'import',
      name.endsWith('.xlsx') ? 'xlsx' : 'csv',
      join(d, name),
      '--mapping',
      join(d, 'm.yaml'),
      '--out',
      out,
      ...extra,
    ],
    d,
  );
  const files = existsSync(out) ? readdirSync(out).sort() : [];
  return { r, d, out, files, read: (f) => readFileSync(join(out, f), 'utf8') };
}

add(
  FI,
  'group-by-blocks',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (group_by: rows sharing its value become the blocks of one spec, in row order)`,
  'rows sharing the group_by value become the blocks of one spec in row order, one spec per value',
  async (ctx) => {
    const n = 2 + (ctx.seed % 3);
    const rows = [];
    for (let i = 0; i < n; i++) rows.push(`A,r-5001,Alpha ${i}`, `B,r-5002,Beta ${i}`);
    const o = await csvImport(ctx.scratch, `g,id,q\n${rows.join('\n')}\n`, `group_by: g\n${MAPPING_BASE}`);
    const a = o.files.includes('r-5001.yaml') ? o.read('r-5001.yaml') : '';
    const users = [...a.matchAll(/- user: (.*)/g)].map((m) => m[1]);
    const want = Array.from({ length: n }, (_, i) => `Alpha ${i}`);
    return expectAll([
      [
        o.r.code === 0 && o.files.join() === 'r-5001.yaml,r-5002.yaml',
        `expected two specs, got exit ${o.r.code} files ${o.files} ${brief(o.r.err)}`,
      ],
      [
        users.join('|') === want.join('|'),
        `expected blocks ${want.join('|')} in row order, got ${users.join('|')}`,
      ],
    ]);
  },
);

add(
  FI,
  'no-group-one-spec-per-row',
  1,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (without group_by, every row is a spec of one block)`,
  'without group_by every row is its own spec of one block',
  async (ctx) => {
    const n = 3 + (ctx.seed % 3);
    const rows = Array.from({ length: n }, (_, i) => `r-${5100 + i},Question ${i}`);
    const o = await csvImport(ctx.scratch, `id,q\n${rows.join('\n')}\n`, MAPPING_BASE);
    return expectAll([
      [
        o.r.code === 0 &&
          o.files.length === n &&
          o.files.every((f) => (o.read(f).match(/- user:/g) ?? []).length === 1),
        `expected ${n} one-block specs, got exit ${o.r.code} files ${o.files}`,
      ],
    ]);
  },
);

add(
  FI,
  'rows-comment',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} ("The written spec starts with a comment naming its rows")`,
  'a written spec starts with a comment naming the source file and the rows it came from',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `g,id,q\nA,r-5201,One\nB,r-5202,Two\nA,r-5201,Three\n`,
      `group_by: g\n${MAPPING_BASE}`,
      [],
      'cases.csv',
    );
    return expectAll([
      [
        o.files.includes('r-5201.yaml') &&
          o.read('r-5201.yaml').startsWith('# Imported from cases.csv, rows 2, 4.\n'),
        `expected "# Imported from cases.csv, rows 2, 4." first, got ${brief(o.files.includes('r-5201.yaml') ? o.read('r-5201.yaml').slice(0, 80) : '(no file)')}`,
      ],
      [
        o.files.includes('r-5202.yaml') &&
          o.read('r-5202.yaml').startsWith('# Imported from cases.csv, row 3.\n'),
        'expected "# Imported from cases.csv, row 3." first',
      ],
    ]);
  },
);

add(
  FI,
  'header-row',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (header_row: rows above it are skipped)`,
  'header_row 2 reads the column names from row 2 and the first spec comes from row 3',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `junk line\nid\tq\nr-5301\tHello tab\n`,
      `header_row: 2\n${MAPPING_BASE}`,
      [],
      'h.tsv',
    );
    return expectAll([
      [
        o.files.join() === 'r-5301.yaml' &&
          /Hello tab/.test(o.read('r-5301.yaml')) &&
          o.read('r-5301.yaml').includes('row 3'),
        `expected r-5301.yaml from row 3, got exit ${o.r.code} ${o.files} ${brief(o.r.err)}`,
      ],
    ]);
  },
);

add(
  FI,
  'brace-escape',
  3,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} ("{{" writes a brace)`,
  'driftbench import csv writes one brace for each doubled brace in a template text',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `id,q\nr-5401,Plain\n`,
      MAPPING_BASE.replace('"T {id}"', '"Brace {{ here"'),
    );
    const t = o.files.length ? /title: (.*)/.exec(o.read('r-5401.yaml'))?.[1] : '';
    return expectAll([
      [
        t === 'Brace { here',
        `expected the title "Brace { here", got "${t}" (exit ${o.r.code} ${brief(o.r.err)})`,
      ],
    ]);
  },
);

add(
  FI,
  'split-trims',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} ($split: the cell split on the separator and each part trimmed)`,
  '$split makes a list of the trimmed parts',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `id,q,m\nr-5501,Hi,"alpha |  beta|gamma "\n`,
      `${MAPPING_BASE}  expect:\n    must: { $column: m, $split: "|" }\n`,
    );
    const must = o.files.length ? [...o.read('r-5501.yaml').matchAll(/^\s+- (\w+)$/gm)].map((m) => m[1]) : [];
    return expectAll([
      [
        must.join(',') === 'alpha,beta,gamma',
        `expected alpha,beta,gamma, got ${must.join(',')} (exit ${o.r.code} ${brief(o.r.err)})`,
      ],
    ]);
  },
);

add(
  FI,
  'list-whole-cell',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} ($list: true makes a list of the whole cell)`,
  '$list true makes a one-item list of the whole cell without splitting it',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `id,q,m\nr-5601,Hi,a|b\n`,
      `${MAPPING_BASE}  expect:\n    must_not: { $column: m, $list: true }\n`,
    );
    const t = o.files.length ? o.read('r-5601.yaml') : '';
    return expectAll([
      [
        /must_not:\n\s+- a\|b\n/.test(t),
        `expected a single item "a|b", got ${brief(t.slice(t.indexOf('must_not')), 80)}`,
      ],
    ]);
  },
);

add(
  FI,
  'as-number',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} ($as converts to number)`,
  '$as number writes a number, not a quoted text',
  async (ctx) => {
    const v = 3 + (ctx.seed % 5);
    const o = await csvImport(
      ctx.scratch,
      `id,q,n\nr-5701,Hi,${v}\n`,
      MAPPING_BASE +
        `  expect:\n    tools:\n      - label: coverage.check\n        count: { max: { $column: n, $as: number } }\n`,
    );
    const t = o.files.length ? o.read('r-5701.yaml') : '';
    return expectAll([
      [
        new RegExp(`max: ${v}\\n`).test(t),
        `expected "max: ${v}" unquoted, got ${brief(t.slice(t.indexOf('count')), 60)} (exit ${o.r.code})`,
      ],
    ]);
  },
);

add(
  FI,
  'empty-cell-omits',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (an empty cell leaves the field out, and an object left empty is left out too)`,
  'an empty cell leaves its field out and an expect left empty disappears',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `id,q,m\nr-5801,Hi,\nr-5802,Hi,word\n`,
      `${MAPPING_BASE}  expect:\n    must: { $column: m, $list: true }\n`,
    );
    const a = o.files.includes('r-5801.yaml') ? o.read('r-5801.yaml') : '';
    const b = o.files.includes('r-5802.yaml') ? o.read('r-5802.yaml') : '';
    return expectAll([
      [
        a.length > 0 && !/must|expect/.test(a),
        `empty row should hold neither must nor expect, got ${brief(a.slice(a.indexOf('blocks')))}`,
      ],
      [/must:/.test(b), 'the filled row should hold must'],
    ]);
  },
);

add(
  FI,
  'quoted-newline',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (import csv reads a .csv file)`,
  'a quoted CSV cell with a comma, quotes and a newline arrives as one user text',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `id,q\r\nr-5901,"Hello, ""quoted"" world\nsecond line"\r\n`,
      MAPPING_BASE,
    );
    const t = o.files.length ? o.read('r-5901.yaml') : '';
    return expectAll([
      [
        t.includes('Hello, "quoted" world') && /second line/.test(t),
        `expected the full cell, got ${brief(t.slice(t.indexOf('blocks')))}`,
      ],
    ]);
  },
);

add(
  FI,
  'duplicate-id-exit-1',
  2,
  10,
  'adversarial',
  'driftbench import csv',
  `${QTAB} (exit 1: a row makes an invalid spec; nothing is written)`,
  'two rows with one spec id and no group_by exit 1 and write nothing',
  async (ctx) => {
    const o = await csvImport(ctx.scratch, `id,q\nr-6001,One\nr-6001,Two\nr-6002,Three\n`, MAPPING_BASE);
    return expectAll([
      [
        o.r.code === 1 && o.files.length === 0 && /row 3/.test(o.r.err),
        `expected exit 1, no files, row 3 named, got exit ${o.r.code} files ${o.files} ${brief(o.r.err)}`,
      ],
    ]);
  },
);

add(
  FI,
  'invalid-row-writes-nothing',
  2,
  10,
  'adversarial',
  'driftbench import csv',
  `${QTAB} (exit 1: each invalid row printed with its row numbers; nothing is written)`,
  'one invalid row among valid ones exits 1 and no valid spec is written either',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `id,q\nr-6101,Fine\nbad id <>,Broken\nr-6103,Fine too\n`,
      MAPPING_BASE,
    );
    return expectAll([
      [
        o.r.code === 1 && o.files.length === 0 && /row 3/.test(o.r.err),
        `expected exit 1, no files, row 3 named, got exit ${o.r.code} files ${o.files} ${brief(o.r.err)}`,
      ],
    ]);
  },
);

add(
  FI,
  'missing-column-exit-2',
  1,
  10,
  'adversarial',
  'driftbench import csv',
  `${QTAB} (exit 2: a column the mapping names and the table lacks)`,
  'a mapping that names a column the table lacks exits 2, lists the real columns and writes nothing',
  async (ctx) => {
    const o = await csvImport(ctx.scratch, `id,q\nr-6201,Hi\n`, MAPPING_BASE.replace('{q}', '{nope}'));
    return expectAll([
      [
        o.r.code === 2 && o.files.length === 0 && /nope/.test(o.r.err) && /id, q/.test(o.r.err),
        `expected exit 2 naming nope and the columns, got ${o.r.code} ${brief(o.r.err)}`,
      ],
    ]);
  },
);

add(
  FI,
  'format-mismatch-exit-2',
  1,
  10,
  'adversarial',
  'driftbench import csv',
  `${QTAB} (exit 2: a format that does not match the file)`,
  'import csv on a workbook and import xlsx on a text table both exit 2',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    put(join(d, 'm.yaml'), MAPPING_BASE);
    put(join(d, 't.csv'), 'id,q\nr-6301,Hi\n');
    const a = await cli(
      [
        'import',
        'csv',
        join(ctx.root, 'examples/acme/import/cases.xlsx'),
        '--mapping',
        join(d, 'm.yaml'),
        '--out',
        join(d, 'a'),
      ],
      d,
    );
    const b = await cli(
      ['import', 'xlsx', join(d, 't.csv'), '--mapping', join(d, 'm.yaml'), '--out', join(d, 'b')],
      d,
    );
    return expectAll([
      [
        a.code === 2 && b.code === 2 && !existsSync(join(d, 'a')) && !existsSync(join(d, 'b')),
        `expected exit 2 and 2 with nothing written, got ${a.code} and ${b.code}`,
      ],
    ]);
  },
);

add(
  FI,
  'unknown-mapping-key',
  1,
  10,
  'adversarial',
  'driftbench import csv',
  `${QTAB} (the mapping keys; exit 2 for a bad mapping)`,
  'a mapping with an unknown top-level key exits 2',
  async (ctx) => {
    const o = await csvImport(ctx.scratch, `id,q\nr-6401,Hi\n`, `metadata:\n  x: 1\n${MAPPING_BASE}`);
    return expectAll([
      [o.r.code === 2 && o.files.length === 0, `expected exit 2 and no files, got ${o.r.code}`],
    ]);
  },
);

add(
  FI,
  'existing-file-force',
  3,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (exit 2: a spec file that exists with other content; overwrite it with --force)`,
  'an existing different spec file stops the import with exit 2 unless --force, and identical content is not an error',
  async (ctx) => {
    const o = await csvImport(ctx.scratch, `id,q\nr-6501,Hi\n`, MAPPING_BASE);
    const same = await cli(
      ['import', 'csv', join(o.d, 'in.csv'), '--mapping', join(o.d, 'm.yaml'), '--out', o.out],
      o.d,
    );
    put(join(o.out, 'r-6501.yaml'), '# edited by hand\n');
    const other = await cli(
      ['import', 'csv', join(o.d, 'in.csv'), '--mapping', join(o.d, 'm.yaml'), '--out', o.out],
      o.d,
    );
    const kept = readFileSync(join(o.out, 'r-6501.yaml'), 'utf8');
    const forced = await cli(
      ['import', 'csv', join(o.d, 'in.csv'), '--mapping', join(o.d, 'm.yaml'), '--out', o.out, '--force'],
      o.d,
    );
    return expectAll([
      [
        o.r.code === 0 && same.code === 0,
        `first and identical runs should exit 0, got ${o.r.code} and ${same.code}`,
      ],
      [
        other.code === 2 && kept === '# edited by hand\n',
        `expected exit 2 and the edit kept, got ${other.code}`,
      ],
      [
        forced.code === 0 && readFileSync(join(o.out, 'r-6501.yaml'), 'utf8').includes('id: r-6501'),
        `--force should overwrite, got ${forced.code}`,
      ],
    ]);
  },
);

add(
  FI,
  'json-shape',
  3,
  10,
  'contract',
  'driftbench import csv',
  'docs/reference/cli.md "driftbench import" (--json: the source, the folder, the row count and each spec with its file, rows, block count and hash)',
  '--json prints the source, the row count and per spec the file, rows, block count and a hash',
  async (ctx) => {
    const o = await csvImport(
      ctx.scratch,
      `g,id,q\nA,r-6601,One\nB,r-6602,Two\nA,r-6601,Three\n`,
      `group_by: g\n${MAPPING_BASE}`,
      ['--json'],
      'cases.csv',
    );
    const j = parse(o.r);
    const specs = (j?.specs ?? []) as {
      id: string;
      file: string;
      rows: number[];
      blocks: number;
      hash: string;
    }[];
    const a = specs.find((x) => x.id === 'r-6601');
    return expectAll([
      [
        j?.source === 'cases.csv' && j?.rows === 3,
        `expected source cases.csv and 3 rows, got ${j?.source} ${j?.rows}`,
      ],
      [
        a?.rows.join() === '2,4' && a?.blocks === 2 && /^[0-9a-f]{12}$/.test(a?.hash ?? ''),
        `expected rows 2,4, 2 blocks, a 12 hex hash, got ${JSON.stringify(a)}`,
      ],
      [
        specs.every((x) => existsSync(join(o.d, x.file)) || existsSync(x.file)),
        'a listed file does not exist',
      ],
    ]);
  },
);

add(
  FI,
  'acme-example-csv',
  2,
  10,
  'contract',
  'driftbench import csv',
  `${QTAB} (the Acme cases.csv: 2 specs from 3 rows, 2 blocks and 1 block)`,
  'the committed Acme cases.csv imports as two specs from three rows with two blocks and one block',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    const r = await cli(
      [
        'import',
        'csv',
        join(ctx.root, 'examples/acme/import/cases.csv'),
        '--mapping',
        join(ctx.root, 'examples/acme/import/mapping.yaml'),
        '--out',
        join(d, 'o'),
        '--json',
      ],
      d,
    );
    const j = parse(r);
    const by = Object.fromEntries(
      ((j?.specs ?? []) as { id: string; blocks: number; rows: number[] }[]).map((x) => [x.id, x]),
    );
    return expectAll([
      [
        r.code === 0 &&
          j?.rows === 3 &&
          by['acme-imported-upgrade']?.blocks === 2 &&
          by['acme-imported-porting']?.blocks === 1 &&
          by['acme-imported-upgrade']?.rows.join() === '2,3',
        `got exit ${r.code} ${JSON.stringify(j?.specs)}`,
      ],
    ]);
  },
);

add(
  FI,
  'xlsx-equals-csv',
  3,
  10,
  'contract',
  'driftbench import xlsx',
  `${QTAB} (The Cases sheet of cases.xlsx holds the same rows and gives the same specs)`,
  'cases.xlsx gives the same spec bodies as cases.csv, numbers staying numbers',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    const m = join(ctx.root, 'examples/acme/import/mapping.yaml');
    const a = await cli(
      [
        'import',
        'csv',
        join(ctx.root, 'examples/acme/import/cases.csv'),
        '--mapping',
        m,
        '--out',
        join(d, 'c'),
      ],
      d,
    );
    const b = await cli(
      [
        'import',
        'xlsx',
        join(ctx.root, 'examples/acme/import/cases.xlsx'),
        '--mapping',
        m,
        '--out',
        join(d, 'x'),
      ],
      d,
    );
    const body = (dd: string, f: string) =>
      readFileSync(join(d, dd, f), 'utf8')
        .split('\n')
        .slice(1)
        .join('\n');
    const files = existsSync(join(d, 'c')) ? readdirSync(join(d, 'c')) : [];
    const same =
      files.length === 2 && files.every((f) => existsSync(join(d, 'x', f)) && body('c', f) === body('x', f));
    return expectAll([
      [
        a.code === 0 && b.code === 0 && same,
        `expected equal bodies, exits ${a.code}/${b.code}, files ${files}`,
      ],
    ]);
  },
);

// ---- traces

async function traceDrafts(
  scratch: string,
  convs: TraceConv[],
  extra: string[] = [],
): Promise<{ r: Cli; d: string; out: string; files: string[]; read: (f: string) => string; src: string }> {
  const d = impDir(scratch);
  const src = join(d, 't.json');
  put(src, otelDoc(convs));
  const out = join(d, 'drafts');
  const r = await cli(['import', 'traces', src, '--from', 'otel', '--out', out, ...extra], d);
  const files = existsSync(out) ? readdirSync(out).sort() : [];
  return { r, d, out, files, read: (f) => readFileSync(join(out, f), 'utf8'), src };
}

const twoTurn = (id: string, startMs: number, email = 'pat@example.org'): TraceConv => ({
  id,
  startMs,
  turns: [
    { user: `First question from Pat, ${email}`, reply: 'First answer.', durMs: 800 },
    { user: `Second question, mail ${email}`, reply: 'Second answer.', durMs: 900 },
  ],
});

add(
  FI,
  'traces-one-draft-per-conversation',
  2,
  10,
  'contract',
  'driftbench import traces',
  QTR,
  'each conversation becomes draft-otel-<id>.yaml with one block per observed user turn',
  async (ctx) => {
    const n = 2 + (ctx.seed % 2);
    const convs = Array.from({ length: n }, (_, i) => twoTurn(`conv${i}`, T0 + i * 3600000));
    const o = await traceDrafts(ctx.scratch, convs);
    const blocks = o.files.map((f) => (o.read(f).match(/^\s+- user:/gm) ?? []).length);
    return expectAll([
      [
        o.files.join() === Array.from({ length: n }, (_, i) => `draft-otel-conv${i}.yaml`).join(),
        `expected ${n} drafts named draft-otel-convN.yaml, got ${o.files}`,
      ],
      [blocks.every((b) => b === 2), `expected 2 blocks per draft, got ${blocks}`],
    ]);
  },
);

add(
  FI,
  'traces-no-expect-unapproved',
  1,
  10,
  'contract',
  'driftbench import traces',
  `${QTR} (no block has an expect; imported.approved is false)`,
  'a draft has no expect on any block and approved false',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0)]);
    const t = o.files.length ? o.read(o.files[0] as string) : '';
    const blockPart = t.slice(t.indexOf('blocks:'), t.indexOf('metadata:'));
    return expectAll([
      [!/expect:/.test(blockPart), 'a block carries an expect'],
      [/approved: false/.test(t), 'approved is not false'],
    ]);
  },
);

add(
  FI,
  'traces-prefix',
  3,
  10,
  'contract',
  'driftbench import traces',
  `${QTR} (its Given is what production observed before it, as the block prefix)`,
  'the second block carries the earlier user message and the agent reply as its prefix, the first carries none',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0)], ['--no-redact']);
    const t = o.files.length ? o.read(o.files[0] as string) : '';
    const blocks = t.slice(t.indexOf('blocks:'), t.indexOf('metadata:')).split(/\n {2}- user:/);
    return expectAll([
      [blocks.length === 3 && !/prefix/.test(blocks[1] as string), 'the first block should hold no prefix'],
      [
        /prefix:/.test(blocks[2] as string) &&
          /role: user\n\s+content: First question from Pat/.test(blocks[2] as string) &&
          /role: assistant\n\s+content: First answer\./.test(blocks[2] as string),
        `expected the first exchange in the prefix, got ${brief(blocks[2] ?? '')}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-redaction-placeholder',
  3,
  10,
  'contract',
  'driftbench import traces',
  `${QTR} (One value keeps one placeholder across the whole conversation)`,
  'one email keeps one placeholder across the user messages and the prefix, and no real address remains',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0, 'lee@example.org')]);
    const t = o.files.length ? o.read(o.files[0] as string) : '';
    const ph = [...t.matchAll(/\[EMAIL_(\d+)\]/g)].map((m) => m[1]);
    return expectAll([
      [!t.includes('lee@example.org'), 'the real address is still in the draft'],
      [ph.length >= 3 && new Set(ph).size === 1, `expected one placeholder repeated, got ${ph}`],
      [
        /Personal data redacted: 2 values/.test(o.r.out) || /redacted: \d+ values/.test(o.r.out),
        `expected a redaction count, got ${brief(o.r.out)}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-no-redact',
  1,
  10,
  'contract',
  'driftbench import traces',
  `${QTR} (--no-redact keeps the data)`,
  '--no-redact keeps the email and says personal data was kept',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0, 'lee@example.org')], ['--no-redact']);
    const t = o.files.length ? o.read(o.files[0] as string) : '';
    return expectAll([
      [
        t.includes('lee@example.org') && /Personal data kept/.test(o.r.out),
        `expected the address kept and a notice, got ${brief(o.r.out)}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-select-unknown',
  2,
  10,
  'adversarial',
  'driftbench import traces',
  `${QTR} (An id that names no trace in the input stops the run with exit 2 and writes nothing)`,
  '--select with an id that names no conversation exits 2 and writes no folder',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0)], ['--select', 'nope']);
    return expectAll([
      [
        o.r.code === 2 && !existsSync(o.out),
        `expected exit 2 and no folder, got ${o.r.code} exists ${existsSync(o.out)}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-select-one',
  2,
  10,
  'contract',
  'driftbench import traces',
  `${QTR} (--select drafts only the traces named)`,
  '--select drafts only the named conversation',
  async (ctx) => {
    const o = await traceDrafts(
      ctx.scratch,
      [twoTurn('c1', T0), twoTurn('c2', T0 + 3600000), twoTurn('c3', T0 + 7200000)],
      ['--select', 'c2'],
    );
    return expectAll([
      [o.files.join() === 'draft-otel-c2.yaml', `expected only draft-otel-c2.yaml, got ${o.files}`],
    ]);
  },
);

add(
  FI,
  'traces-dataset-needs-store',
  1,
  10,
  'adversarial',
  'driftbench import traces',
  `${QTR} (--dataset without --store exits 2)`,
  '--dataset without --store exits 2',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0)], ['--dataset', 'prod']);
    return expectAll([[o.r.code === 2, `expected exit 2, got ${o.r.code}`]]);
  },
);

add(
  FI,
  'traces-dataset-unchanged-repeat',
  4,
  10,
  'contract',
  'driftbench import traces',
  `${QTR} (--dataset pushes the drafts as the next version, the same push as dataset push: an unchanged repeat import makes no new version, other traces make the next one)`,
  'import traces --dataset keeps one version for the same traces imported twice and pushes version 2 for other traces',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    const store = join(d, 's.db');
    const once = join(d, 't.json');
    put(once, otelDoc([twoTurn('c1', T0)]));
    const other = join(d, 'u.json');
    put(other, otelDoc([twoTurn('c2', T0 + 86_400_000)]));
    const run = (src: string, out: string) =>
      cli(
        [
          'import',
          'traces',
          src,
          '--from',
          'otel',
          '--out',
          join(d, out),
          '--dataset',
          'prod',
          '--store',
          store,
        ],
        d,
      );
    const a = await run(once, 'a');
    const b = await run(once, 'b');
    const c = await run(other, 'c');
    const last = (r: { out: string }) => brief(r.out.split('\n').filter(Boolean).pop() ?? '');
    return expectAll([
      [/prod@1/.test(a.out), `expected the first import to push prod@1, got "${last(a)}"`],
      [
        !/prod@2/.test(b.out) && /prod@1/.test(b.out),
        `expected the same traces again to keep prod@1, got "${last(b)}"`,
      ],
      [/prod@2/.test(c.out), `expected other traces to push prod@2, got "${last(c)}"`],
    ]);
  },
);

add(
  FI,
  'traces-existing-draft',
  2,
  10,
  'adversarial',
  'driftbench import traces',
  `${QTR} (exit 2 for an existing draft without --force; nothing is written)`,
  'an existing draft stops the import with exit 2 and --force replaces it',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0)]);
    const file = join(o.out, 'draft-otel-c1.yaml');
    writeFileSync(file, 'reviewed by hand\n');
    const again = await cli(['import', 'traces', o.src, '--from', 'otel', '--out', o.out], o.d);
    const kept = readFileSync(file, 'utf8');
    const forced = await cli(['import', 'traces', o.src, '--from', 'otel', '--out', o.out, '--force'], o.d);
    return expectAll([
      [
        again.code === 2 && kept === 'reviewed by hand\n',
        `expected exit 2 and the file kept, got ${again.code}`,
      ],
      [
        forced.code === 0 && readFileSync(file, 'utf8').includes('id: draft-otel-c1'),
        `--force should replace, got ${forced.code}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-required-options',
  1,
  10,
  'adversarial',
  'driftbench import traces',
  `${QTR} (exit 2: no --from or --out, an unreadable path)`,
  'a missing --from, a missing --out, an unknown source and an unreadable path all exit 2',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    put(join(d, 't.json'), otelDoc([twoTurn('c1', T0)]));
    const seen = [
      (await cli(['import', 'traces', join(d, 't.json'), '--out', join(d, 'o1')], d)).code,
      (await cli(['import', 'traces', join(d, 't.json'), '--from', 'otel'], d)).code,
      (await cli(['import', 'traces', join(d, 't.json'), '--from', 'bogus', '--out', join(d, 'o3')], d)).code,
      (await cli(['import', 'traces', join(d, 'missing.json'), '--from', 'otel', '--out', join(d, 'o4')], d))
        .code,
    ];
    return expectAll([
      [
        seen.every((c) => c === 2) && !existsSync(join(d, 'o1')) && !existsSync(join(d, 'o4')),
        `expected 2 for each and nothing written, got ${seen}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-observed-latency-cost-tools',
  4,
  10,
  'contract',
  'driftbench import traces',
  'docs/traces.md (what production did is kept in metadata.imported.observed: the reply, the tool counts, tokens, cost, latency)',
  'observed keeps per block the reply, the latency in ms, the token counts and the tool call count',
  async (ctx) => {
    const conv: TraceConv = {
      id: 'c1',
      startMs: T0,
      turns: [
        {
          user: 'Look it up',
          reply: 'Found it.',
          durMs: 1234,
          tokensIn: 321,
          tokensOut: 45,
          tools: [{ name: 'lookup' }, { name: 'lookup' }],
        },
      ],
    };
    const o = await traceDrafts(ctx.scratch, [conv]);
    const t = o.files.length ? o.read(o.files[0] as string) : '';
    return expectAll([
      [
        /reply: Found it\./.test(t) && /latency_ms: 1234/.test(t),
        `expected reply and latency_ms 1234, got ${brief(t.slice(t.indexOf('observed')))}`,
      ],
      [/inputTokens: 321/.test(t) && /outputTokens: 45/.test(t), 'expected the token counts'],
      [
        /label: lookup\n\s+count: 2/.test(t),
        `expected the tool lookup counted 2, got ${brief(t.slice(t.indexOf('tools:')), 100)}`,
      ],
    ]);
  },
);

add(
  FI,
  'traces-prices-cost',
  3,
  10,
  'contract',
  'driftbench import traces',
  'docs/traces.md "OpenTelemetry" (--prices: USD per million tokens by model)',
  '--prices computes the turn cost as input tokens times input price plus output tokens times output price per million',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    const tin = 1000 + (ctx.seed % 7) * 100;
    const tout = 200 + (ctx.seed % 5) * 10;
    put(
      join(d, 't.json'),
      otelDoc([
        {
          id: 'c1',
          startMs: T0,
          turns: [{ user: 'Hi', reply: 'Hello', durMs: 100, tokensIn: tin, tokensOut: tout }],
        },
      ]),
    );
    put(join(d, 'prices.json'), JSON.stringify({ 'example-model-1': { input: 2, output: 8 } }));
    const r = await cli(
      [
        'import',
        'traces',
        join(d, 't.json'),
        '--from',
        'otel',
        '--out',
        join(d, 'o'),
        '--prices',
        join(d, 'prices.json'),
      ],
      d,
    );
    const t = existsSync(join(d, 'o/draft-otel-c1.yaml'))
      ? readFileSync(join(d, 'o/draft-otel-c1.yaml'), 'utf8')
      : '';
    const want = (tin * 2 + tout * 8) / 1e6;
    const got = Number(/usd: ([0-9.e-]+)/.exec(t)?.[1]);
    return expectAll([[close(got, want, 1e-9), `expected usd ${want}, got ${got} (exit ${r.code})`]]);
  },
);

add(
  FI,
  'traces-nanosecond-exact',
  5,
  10,
  'contract',
  'driftbench import traces',
  'docs/traces.md "OpenTelemetry" (Times are read in nanoseconds exactly)',
  'a span start one nanosecond before a millisecond boundary is read as the millisecond before, never rounded up by floating point',
  async (ctx) => {
    const d = impDir(ctx.scratch);
    // 1772323200003000000 ns is an exact millisecond; one nanosecond before it must floor to the previous millisecond.
    const start = 1772323200003000000n - 1n;
    const end = start + 1500n * 1000000n;
    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      name: 'chat m',
      startTimeUnixNano: start.toString(),
      endTimeUnixNano: end.toString(),
      attributes: [
        sv('gen_ai.operation.name', 'chat'),
        sv('gen_ai.conversation.id', 'c1'),
        sv(
          'gen_ai.input.messages',
          JSON.stringify([{ role: 'user', parts: [{ type: 'text', content: 'Hello there' }] }]),
        ),
        sv(
          'gen_ai.output.messages',
          JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 'Hi' }] }]),
        ),
      ],
      status: { code: 1 },
    };
    put(
      join(d, 't.json'),
      JSON.stringify({ resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ spans: [span] }] }] }),
    );
    const r = await cli(['import', 'traces', join(d, 't.json'), '--from', 'otel', '--out', join(d, 'o')], d);
    const t = existsSync(join(d, 'o/draft-otel-c1.yaml'))
      ? readFileSync(join(d, 'o/draft-otel-c1.yaml'), 'utf8')
      : '';
    const lat = /latency_ms: (\d+)/.exec(t)?.[1];
    const at = /started_at: (\S+)/.exec(t)?.[1];
    return expectAll([
      [
        at === '2026-03-01T00:00:00.002Z',
        `expected started_at 2026-03-01T00:00:00.002Z, got ${at} (exit ${r.code})`,
      ],
      [lat === '1500', `expected latency 1500, got ${lat}`],
    ]);
  },
);

add(
  FI,
  'approve-lists-and-approves',
  3,
  10,
  'contract',
  'driftbench import approve',
  'docs/traces.md "Draft specs" (import approve lists the drafts not approved yet; --all approves them)',
  'approve lists the unapproved drafts, --all approves all of them, and a second listing says all are approved',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0), twoTurn('c2', T0 + 3600000)]);
    const list = await cli(['import', 'approve', o.out], o.d);
    const all = await cli(['import', 'approve', o.out, '--all'], o.d);
    const again = await cli(['import', 'approve', o.out], o.d);
    const flags = o.files.map((f) => /^\s+approved: (\w+)/m.exec(o.read(f))?.[1]);
    return expectAll([
      [
        list.code === 0 &&
          /2 of 2 drafts are not approved yet/.test(list.out) &&
          o.files.every((f) => list.out.includes(f)),
        `expected a listing of 2, got ${brief(list.out)}`,
      ],
      [
        all.code === 0 && flags.every((x) => x === 'true'),
        `expected every draft approved true, got ${flags}`,
      ],
      [
        again.code === 0 && /all 2 drafts are approved/.test(again.out),
        `expected "all 2 drafts are approved", got ${brief(again.out)}`,
      ],
    ]);
  },
);

add(
  FI,
  'approve-exit-codes',
  2,
  10,
  'adversarial',
  'driftbench import approve',
  'docs/traces.md (import approve exits 1 when a file is not an imported draft, 2 when the path is missing)',
  'approve exits 1 for a file that is not an imported draft and 2 for a missing path',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('c1', T0)]);
    const a = await cli(['import', 'approve', o.src], o.d);
    const b = await cli(['import', 'approve', join(o.d, 'missing')], o.d);
    return expectAll([[a.code === 1 && b.code === 2, `expected 1 and 2, got ${a.code} and ${b.code}`]]);
  },
);

add(
  FI,
  'traces-conversation-ids-join',
  3,
  10,
  'contract',
  'driftbench import traces',
  'docs/traces.md "OpenTelemetry" (spans that share gen_ai.conversation.id are one conversation; one turn is the chat spans from one new user message to the next)',
  'spans of one conversation id across separate traces form one draft whose turns follow start time',
  async (ctx) => {
    const o = await traceDrafts(ctx.scratch, [twoTurn('only', T0)]);
    const t = o.files.length ? o.read(o.files[0] as string) : '';
    const users = [...t.matchAll(/^\s+- user: (.*)$/gm)].map((m) => m[1] as string);
    return expectAll([
      [o.files.length === 1, `expected 1 draft for 1 conversation id, got ${o.files}`],
      [
        users.length === 2 &&
          /First question/.test(users[0] as string) &&
          /Second question/.test(users[1] as string),
        `expected the two turns in time order, got ${users}`,
      ],
    ]);
  },
);

// =========================================================================================================
// Family: monitor, select, holdout, simulate, attack.

const FO = 'breaker2-ops';
const QMON = 'examples/acme/ci/README.md "Watching a store over time: driftbench monitor"';
const QMT = 'docs/traces.md "Monitoring: driftbench monitor --source traces"';

// ---- monitor on a store

const STEP = [8, 8, 7, 8, 8, 8, 7, 8, 2, 1, 2, 1, 2, 2, 1, 2];
const N_SPECS = 8;

type MonFix = { dir: string; store: string; values: number[]; ids: string[] };

function monFixture(scratch: string, name: string, passing: number[]): Promise<MonFix> {
  return once(scratch, `mon:${name}`, async () => {
    const d = dir(scratch, `mon-${name}`);
    const store = join(d, 's.db');
    const ids: string[] = [];
    for (let k = 0; k < passing.length; k++) {
      const specs = join(d, `c${k}`);
      for (let i = 0; i < N_SPECS; i++)
        put(
          join(specs, `s${i}.yaml`),
          tinySpec(`r-${7000 + i}`, i < (passing[k] as number) ? KIND.b : KIND.d),
        );
      const id = `c${String(k).padStart(2, '0')}`;
      ids.push(id);
      await runCampaign(d, specs, 'function:acme-sales', store, id);
    }
    return { dir: d, store, values: passing.map((x) => x / N_SPECS), ids };
  });
}

const monStep = (scratch: string) => monFixture(scratch, 'step', STEP);

async function monJson(f: MonFix, extra: string[] = []): Promise<{ r: Cli; j: Json }> {
  const r = await cli(
    ['monitor', '--store', f.store, '--metric', 'pass_rate', '--window', '4', '--json', ...extra],
    f.dir,
  );
  return { r, j: parse(r) };
}

function sampleSd(v: number[]): number {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

add(
  FO,
  'monitor-step-exit-1',
  2,
  10,
  'contract',
  'driftbench monitor',
  `${QMON} (Exit 1 when two of the three alarm)`,
  'a pass-rate series that drops from 100 percent to 20 percent exits 1 with two or more detectors alarming',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const { r, j } = await monJson(f);
    return expectAll([
      [
        r.code === 1 && j?.alarm === true && j?.votes >= 2,
        `expected exit 1, alarm true, votes 2 or more, got exit ${r.code} alarm ${j?.alarm} votes ${j?.votes}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-flat-exit-0',
  2,
  10,
  'contract',
  'driftbench monitor',
  `${QMON} (exit 0 otherwise)`,
  'a constant pass-rate series exits 0 with no alarm',
  async (ctx) => {
    const f = await monFixture(ctx.scratch, 'flat', Array(10).fill(8));
    const r = await cli(['monitor', '--store', f.store, '--metric', 'pass_rate', '--window', '4'], f.dir);
    return expectAll([
      [
        r.code === 0 && /No shift: 0 of 3 detectors alarmed, 2 needed\. Exit 0\./.test(r.out),
        `expected exit 0 and the no-shift line, got ${r.code} ${brief(r.out.slice(-200))}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-series-values',
  2,
  10,
  'contract',
  'driftbench monitor',
  `${QMON} (The series is one value per campaign, oldest first: the share of runs that pass)`,
  'the series holds one point per campaign, oldest first, each the share of passing runs',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const { j } = await monJson(f);
    const series = (j?.series ?? []) as { campaignId: string; value: number; runs: number }[];
    const bad = f.ids.filter(
      (id, i) =>
        series[i]?.campaignId !== id ||
        !close(series[i]?.value as number, f.values[i] as number, 1e-12) ||
        series[i]?.runs !== N_SPECS,
    );
    return expectAll([
      [
        series.length === f.ids.length && bad.length === 0,
        `expected ${f.ids.length} points in order with values ${f.values.join(',')}, got ${series.map((x) => `${x.campaignId}:${x.value}`).join(',')}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-in-control-mean',
  2,
  10,
  'contract',
  'driftbench monitor',
  `${QMON} (The in-control level comes from the first --window campaigns)`,
  'the in-control mean is the mean of the first window campaign values',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const { j } = await monJson(f);
    const want = f.values.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    return expectAll([
      [close(j?.inControl?.mean, want, 1e-12), `expected ${want}, got ${j?.inControl?.mean}`],
    ]);
  },
);

add(
  FO,
  'monitor-in-control-sd',
  4,
  10,
  'contract',
  'driftbench monitor',
  QMON +
    ' (Its sd is the largest of three: the spread of those campaign values, the standard error of each campaign from its own runs, and a floor)',
  'the in-control sd is at least the sample sd of the first window and at least the root mean square of the campaign standard errors',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const { j } = await monJson(f);
    const first = f.values.slice(0, 4);
    const spread = sampleSd(first);
    const rms = Math.sqrt(first.reduce((a, v) => a + (v * (1 - v)) / (N_SPECS - 1), 0) / first.length);
    const sd = j?.inControl?.sd as number;
    return expectAll([
      [
        close(j?.inControl?.sdBetween, spread, 1e-9),
        `expected the spread ${spread}, got ${j?.inControl?.sdBetween}`,
      ],
      [
        sd + 1e-12 >= spread && sd + 1e-12 >= rms * 0.9,
        `expected sd at least ${spread} and about ${rms}, got ${sd}`,
      ],
      [
        close(sd, Math.max(j?.inControl?.sdBetween, j?.inControl?.sdWithin, j?.inControl?.sdFloor), 1e-12),
        `expected sd to be the largest of its three parts, got ${JSON.stringify(j?.inControl)}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-cusum-brute',
  5,
  10,
  'contract',
  'driftbench monitor',
  `${QMON} (a two-sided CUSUM, allowance 0.5 sd, threshold 5 sd)`,
  'every CUSUM statistic of the series equals the tabular CUSUM recomputed from the values, the in-control mean and sd',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const { j } = await monJson(f);
    const mean = j?.inControl?.mean as number;
    const sd = j?.inControl?.sd as number;
    let up = 0;
    let down = 0;
    const bad: string[] = [];
    const alarmsAt: number[] = [];
    const stopAt = j?.cusum?.alarms?.[0]?.index ?? 1e9;
    ((j?.series ?? []) as { cusumUp: number; cusumDown: number }[]).forEach((pt, i) => {
      if (i > stopAt) return;
      const z = ((f.values[i] as number) - mean) / sd;
      up = Math.max(0, up + z - 0.5);
      down = Math.max(0, down - z - 0.5);
      if (!close(pt.cusumUp, up, 1e-6) || !close(pt.cusumDown, down, 1e-6))
        bad.push(
          `#${i} expected up ${up.toFixed(4)} down ${down.toFixed(4)}, got ${pt.cusumUp} ${pt.cusumDown}`,
        );
      if ((up > 5 || down > 5) && alarmsAt.length === 0) alarmsAt.push(i);
    });
    const first = j?.cusum?.alarms?.[0]?.index;
    return expectAll([
      [bad.length === 0, bad.slice(0, 2).join('; ')],
      [first === alarmsAt[0], `expected the first CUSUM alarm at ${alarmsAt[0]}, got ${first}`],
    ]);
  },
);

add(
  FO,
  'monitor-alarm-not-before-shift',
  3,
  10,
  'contract',
  'driftbench monitor',
  QMON,
  'no detector alarms on the quiet campaigns before the step and the first alarm lands on the step campaign',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const { j } = await monJson(f);
    const firsts = [j?.cusum?.alarms?.[0]?.index, j?.pageHinkley?.alarms?.[0]?.index].filter(
      (x) => x !== undefined,
    ) as number[];
    return expectAll([
      [
        firsts.length >= 1 && Math.min(...firsts) === 8,
        `expected the first alarm at campaign 8 (the step), got ${firsts}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-window-too-large',
  1,
  10,
  'adversarial',
  'driftbench monitor',
  `${QMON} (--window; the series needs at least twice as many)`,
  'a window above half the series exits 2 and names the needed count',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const r = await cli(['monitor', '--store', f.store, '--metric', 'pass_rate', '--window', '9'], f.dir);
    return expectAll([
      [r.code === 2 && /18/.test(r.err), `expected exit 2 naming 18, got ${r.code} ${brief(r.err)}`],
    ]);
  },
);

add(
  FO,
  'monitor-bad-options',
  1,
  10,
  'adversarial',
  'driftbench monitor',
  'docs/reference/cli.md "driftbench monitor" (exit 2: an unknown metric for the source, no store or no path, a bad --every or --window)',
  'an unknown metric, a store metric on traces, a trace metric on a store, a bad window and no store all exit 2',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const t = join(ctx.scratch, 'b2', 'badopt.json');
    put(t, otelDoc([conv1('c1', T0, 100)]));
    const codes = [
      (await cli(['monitor', '--store', f.store, '--metric', 'nonsense', '--window', '4'], f.dir)).code,
      (await cli(['monitor', '--store', f.store, '--metric', 'turns', '--window', '4'], f.dir)).code,
      (await cli(['monitor', '--source', 'traces', t, '--metric', 'pass_rate'], f.dir)).code,
      (await cli(['monitor', '--store', f.store, '--metric', 'pass_rate', '--window', 'abc'], f.dir)).code,
      (await cli(['monitor', '--metric', 'pass_rate'], f.dir)).code,
      (await cli(['monitor', '--source', 'traces', '--metric', 'latency'], f.dir)).code,
      (await cli(['monitor', '--source', 'traces', t, '--metric', 'latency', '--every', '90'], f.dir)).code,
    ];
    return expectAll([[codes.every((c) => c === 2), `expected 2 for each, got ${codes}`]]);
  },
);

add(
  FO,
  'monitor-skips-empty-campaigns',
  3,
  10,
  'contract',
  'driftbench monitor',
  `${QMON} (A campaign with no run is left out and named)`,
  'a campaign with no run is left out of the series and named in skipped',
  async (ctx) => {
    const f = await monFixture(ctx.scratch, 'skip', [8, 8, 8, 8, 8, 8, 8, 8]);
    const d = dir(ctx.scratch, 'mon-skip-extra');
    put(join(d, 'specs/a.yaml'), tinySpec('r-7900'));
    await runCampaign(d, join(d, 'specs'), 'function:acme-sales', f.store, 'zz-empty', ['--budget-usd', '0']);
    const { j } = await monJson(f);
    return expectAll([
      [
        (j?.skipped ?? []).includes('zz-empty'),
        `expected zz-empty in skipped, got ${JSON.stringify(j?.skipped)}`,
      ],
      [(j?.series ?? []).length === 8, `expected 8 points, got ${(j?.series ?? []).length}`],
    ]);
  },
);

add(
  FO,
  'monitor-cost-flat-floor',
  2,
  10,
  'contract',
  'driftbench monitor',
  QMON,
  'a cost series of zero-cost campaigns exits 0 without a division failure',
  async (ctx) => {
    const f = await monStep(ctx.scratch);
    const r = await cli(
      ['monitor', '--store', f.store, '--metric', 'cost', '--window', '4', '--json'],
      f.dir,
    );
    const j = parse(r);
    return expectAll([
      [
        r.code === 0 && j?.alarm === false && Number.isFinite(j?.inControl?.sd),
        `expected exit 0 no alarm and a finite sd, got ${r.code} ${JSON.stringify(j?.inControl)}`,
      ],
    ]);
  },
);

// ---- monitor on traces

type WinSpec = { h: number; convs: TraceConv[] };

async function traceMon(
  scratch: string,
  wins: WinSpec[],
  metric: string,
  extra: string[] = [],
  window = 2,
): Promise<{ r: Cli; j: Json; d: string }> {
  const d = impDir(scratch);
  put(join(d, 't.json'), otelDoc(wins.flatMap((w) => w.convs)));
  const r = await cli(
    [
      'monitor',
      '--source',
      'traces',
      join(d, 't.json'),
      '--metric',
      metric,
      '--every',
      '1h',
      '--window',
      String(window),
      '--json',
      ...extra,
    ],
    d,
  );
  return { r, j: parse(r), d };
}

function noise(seed: number, h: number, j: number, span: number): number {
  return (seed * 37 + h * 101 + j * 53) % span;
}

function latWins(seed: number, hours: number[]): WinSpec[] {
  return hours.map((h) => ({
    h,
    convs: [0, 1].map((j) =>
      conv1(`w${h}c${j}`, T0 + h * 3600000 + j * 600000, 500 + noise(seed, h, j, 900)),
    ),
  }));
}

add(
  FO,
  'monitor-traces-window-means',
  4,
  10,
  'contract',
  'driftbench monitor',
  QMT +
    ' (Each window is one point: the mean of the metric over its conversations, with the standard error of that mean)',
  'each hour window holds the mean latency of its conversations and the standard error of that mean',
  async (ctx) => {
    const hours = [0, 1, 2, 4, 5, 6, 7];
    const wins = latWins(ctx.seed, hours);
    const { r, j } = await traceMon(ctx.scratch, wins, 'latency');
    const series = (j?.series ?? []) as { createdAt: string; runs: number; value: number; se: number }[];
    const bad: string[] = [];
    hours.forEach((h, i) => {
      const lat = wins[i]?.convs.map((c) => (c.turns[0] as TraceTurn).durMs) as number[];
      const m = lat.reduce((a, b) => a + b, 0) / lat.length;
      const se = sampleSd(lat) / Math.sqrt(lat.length);
      const p = series[i];
      if (
        p?.runs !== 2 ||
        !close(p.value, m, 1e-6) ||
        !close(p.se, se, 1e-6) ||
        p.createdAt !== new Date(T0 + h * 3600000).toISOString()
      )
        bad.push(`hour ${h}: expected mean ${m} se ${se}, got ${JSON.stringify(p)}`);
    });
    return expectAll([
      [
        series.length === hours.length && bad.length === 0,
        bad.slice(0, 2).join('; ') || `exit ${r.code} ${brief(r.err)}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-traces-empty-window-listed',
  3,
  10,
  'contract',
  'driftbench monitor',
  `${QMT} (Windows with no conversation, or none that has the metric, are left out and listed)`,
  'an hour with no conversation is left out of the series and listed in skipped',
  async (ctx) => {
    const { j } = await traceMon(ctx.scratch, latWins(ctx.seed, [0, 1, 2, 4, 5, 6]), 'latency');
    return expectAll([
      [(j?.series ?? []).length === 6, `expected 6 points, got ${(j?.series ?? []).length}`],
      [
        (j?.skipped ?? []).includes(new Date(T0 + 3 * 3600000).toISOString()),
        `expected the empty hour 3 listed, got ${JSON.stringify(j?.skipped)}`,
      ],
    ]);
  },
);

add(
  FO,
  'monitor-traces-tokens',
  3,
  10,
  'contract',
  'driftbench monitor',
  `${QMT} (metric tokens: total input and output tokens per conversation)`,
  'the tokens metric is the mean over a window of each conversation total of input plus output tokens',
  async (ctx) => {
    const hours = [0, 1, 2, 3, 4, 5];
    const wins: WinSpec[] = hours.map((h) => ({
      h,
      convs: [0, 1].map((j) => ({
        id: `t${h}${j}`,
        startMs: T0 + h * 3600000 + j * 600000,
        turns: [
          {
            user: 'q',
            reply: 'a',
            durMs: 100,
            tokensIn: 100 + noise(ctx.seed, h, j, 50),
            tokensOut: 10 + noise(ctx.seed, j, h, 20),
          },
          { user: 'q2', reply: 'a2', durMs: 100, tokensIn: 30, tokensOut: 5 },
        ],
      })),
    }));
    const { j } = await traceMon(ctx.scratch, wins, 'tokens');
    const bad: string[] = [];
    wins.forEach((w, i) => {
      const tot = w.convs.map((c) => c.turns.reduce((a, t) => a + (t.tokensIn ?? 0) + (t.tokensOut ?? 0), 0));
      const m = tot.reduce((a, b) => a + b, 0) / tot.length;
      if (!close(j?.series?.[i]?.value, m, 1e-6))
        bad.push(`hour ${w.h}: expected ${m}, got ${j?.series?.[i]?.value}`);
    });
    return expectAll([
      [bad.length === 0, bad.slice(0, 2).join('; ') || `no series: ${JSON.stringify(j)?.slice(0, 120)}`],
    ]);
  },
);

add(
  FO,
  'monitor-traces-turns',
  2,
  10,
  'contract',
  'driftbench monitor',
  `${QMT} (metric turns: number of turns)`,
  'the turns metric is the mean number of turns of the conversations of a window',
  async (ctx) => {
    const hours = [0, 1, 2, 3, 4, 5];
    const wins: WinSpec[] = hours.map((h) => ({
      h,
      convs: [0, 1].map((j) => {
        const n = 1 + noise(ctx.seed, h, j, 4);
        return {
          id: `n${h}${j}`,
          startMs: T0 + h * 3600000 + j * 900000,
          gapMs: 1000,
          turns: Array.from({ length: n }, (_, k) => ({ user: `q${k}`, reply: `a${k}`, durMs: 100 })),
        };
      }),
    }));
    const { j } = await traceMon(ctx.scratch, wins, 'turns');
    const bad: string[] = [];
    wins.forEach((w, i) => {
      const m = w.convs.reduce((a, c) => a + c.turns.length, 0) / w.convs.length;
      if (!close(j?.series?.[i]?.value, m, 1e-9))
        bad.push(`hour ${w.h}: expected ${m}, got ${j?.series?.[i]?.value}`);
    });
    return expectAll([[bad.length === 0, bad.slice(0, 2).join('; ') || 'no series']]);
  },
);

add(
  FO,
  'monitor-traces-tool-errors-share',
  4,
  10,
  'contract',
  'driftbench monitor',
  `${QMT} (tool_errors: the share of failed tool calls over all the calls of a window)`,
  'tool_errors is failed tool calls over all tool calls of the window, not a mean of per conversation shares',
  async (ctx) => {
    const hours = [0, 1, 2, 3, 4, 5];
    const wins: WinSpec[] = hours.map((h) => {
      // Conversation 0 has one call, conversation 1 has four: pooled share and mean of shares differ.
      const c0 = {
        id: `e${h}0`,
        startMs: T0 + h * 3600000,
        turns: [
          { user: 'q', reply: 'a', durMs: 100, tools: [{ name: 'lookup', err: (ctx.seed + h) % 2 === 0 }] },
        ],
      };
      const c1 = {
        id: `e${h}1`,
        startMs: T0 + h * 3600000 + 600000,
        turns: [
          {
            user: 'q',
            reply: 'a',
            durMs: 100,
            tools: [0, 1, 2, 3].map((k) => ({ name: 'lookup', err: k < h % 3 })),
          },
        ],
      };
      return { h, convs: [c0, c1] };
    });
    const { j } = await traceMon(ctx.scratch, wins, 'tool_errors');
    const bad: string[] = [];
    wins.forEach((w, i) => {
      let errs = 0;
      let calls = 0;
      for (const c of w.convs)
        for (const t of c.turns)
          for (const x of t.tools ?? []) {
            calls++;
            if (x.err) errs++;
          }
      if (!close(j?.series?.[i]?.value, errs / calls, 1e-9))
        bad.push(`hour ${w.h}: expected ${errs}/${calls}=${errs / calls}, got ${j?.series?.[i]?.value}`);
    });
    return expectAll([[bad.length === 0, bad.slice(0, 2).join('; ') || 'no series']]);
  },
);

add(
  FO,
  'monitor-traces-cost-needs-every-turn',
  4,
  10,
  'contract',
  'driftbench monitor',
  `${QMT} (cost: total USD, only when every turn has a cost)`,
  'a conversation with one turn lacking a cost is left out of the cost mean',
  async (ctx) => {
    const hours = [0, 1, 2, 3, 4, 5];
    const wins: WinSpec[] = hours.map((h) => ({
      h,
      convs: [
        {
          id: `k${h}0`,
          startMs: T0 + h * 3600000,
          gapMs: 1000,
          turns: [
            { user: 'q', reply: 'a', durMs: 100, cost: 0.01 + h / 1000 },
            { user: 'q2', reply: 'a2', durMs: 100, cost: 0.02 },
          ],
        },
        {
          id: `k${h}1`,
          startMs: T0 + h * 3600000 + 600000,
          gapMs: 1000,
          turns: [
            { user: 'q', reply: 'a', durMs: 100, cost: 0.5 },
            { user: 'q2', reply: 'a2', durMs: 100 },
          ],
        },
      ],
    }));
    const { j } = await traceMon(ctx.scratch, wins, 'cost');
    const bad: string[] = [];
    wins.forEach((w, i) => {
      const want = 0.03 + w.h / 1000;
      if (!close(j?.series?.[i]?.value, want, 1e-9) || j?.series?.[i]?.runs !== 1)
        bad.push(`hour ${w.h}: expected ${want} over 1 conversation, got ${JSON.stringify(j?.series?.[i])}`);
    });
    return expectAll([[bad.length === 0, bad.slice(0, 2).join('; ') || 'no series']]);
  },
);

add(
  FO,
  'monitor-traces-alert-index',
  5,
  10,
  'contract',
  'driftbench monitor',
  `${QMT} (The alert says when the vote was reached: the window where the second detector first alarmed)`,
  'on a shifted latency series the alert index is the second earliest first alarm among the detectors',
  async (ctx) => {
    const hours = Array.from({ length: 16 }, (_, i) => i);
    const wins: WinSpec[] = hours.map((h) => ({
      h,
      convs: [0, 1, 2].map((j) =>
        conv1(
          `s${h}c${j}`,
          T0 + h * 3600000 + j * 600000,
          (h < 9 ? 1000 : 3000) + noise(ctx.seed, h, j, 120),
        ),
      ),
    }));
    const { r, j } = await traceMon(ctx.scratch, wins, 'latency', [], 6);
    const firsts = [
      j?.cusum?.alarms?.[0]?.index,
      j?.pageHinkley?.alarms?.[0]?.index,
      j?.ks?.change ? j?.ks?.index : undefined,
    ].filter((x) => x !== undefined) as number[];
    firsts.sort((a, b) => a - b);
    return expectAll([
      [r.code === 1 && j?.alarm === true, `expected exit 1 and an alarm, got ${r.code} ${j?.alarm}`],
      [
        firsts.length >= 2 && j?.alert?.index === firsts[1],
        `expected alert.index ${firsts[1]} (first alarms ${firsts}), got ${j?.alert?.index}`,
      ],
      [
        j?.alert?.createdAt === new Date(T0 + (firsts[1] ?? 0) * 3600000).toISOString(),
        `expected alert createdAt for hour ${firsts[1]}, got ${j?.alert?.createdAt}`,
      ],
    ]);
  },
);

// ---- select

type SelRun = { r: Cli; j: Json; out: string };

function selectGated(scratch: string, root: string): Promise<SelRun> {
  return once(scratch, 'select10', async () => {
    const d = dir(scratch, 'select10');
    const out = join(d, 'golden');
    const r = await cli(
      [
        'select',
        '--cover',
        join(root, 'examples/acme/map/space.yaml'),
        '--specs',
        join(root, 'examples/acme/gated'),
        '--out',
        out,
        '--k',
        '10',
        '--json',
      ],
      d,
    );
    return { r, j: parse(r), out };
  });
}

add(
  FO,
  'select-exit-1-required-cell',
  4,
  10,
  'contract',
  'driftbench select',
  'examples/acme/golden/README.md "What the ten cover" (select exits according to the required-cell coverage)',
  'select on the gated Acme specs writes the golden set and exits according to the documented required-cell coverage',
  async (ctx) => {
    const s = await selectGated(ctx.scratch, ctx.root);
    const want = goldenContract(ctx.root);
    return expectAll([
      [
        s.r.code === (want.required === want.totalRequired ? 0 : 1),
        `exit disagrees with documented required coverage, got ${s.r.code}: ${brief(s.r.err)}`,
      ],
      [existsSync(join(s.out, 'golden.json')), 'golden.json was not written'],
    ]);
  },
);

add(
  FO,
  'select-readme-numbers',
  4,
  10,
  'contract',
  'driftbench select',
  'examples/acme/golden/README.md "How the ten were chosen" (pool, sealed specs, allowed pairs and golden coverage)',
  'the pool and golden coverage counts agree with the current README',
  async (ctx) => {
    const s = await selectGated(ctx.scratch, ctx.root);
    const want = goldenContract(ctx.root);
    const pool = s.j?.pool ?? {};
    const golden = (s.j?.golden ?? []) as { adds_cells: number; cumulative: number }[];
    return expectAll([
      [
        pool.specs === want.pool &&
          pool.sealed_left_out === want.sealed &&
          pool.cells_covered === want.cells &&
          s.j?.coverage?.allowed === want.allowed,
        `got pool ${JSON.stringify({ specs: pool.specs, sealed: pool.sealed_left_out, cells: pool.cells_covered })}`,
      ],
      [
        golden.length === 10 && golden[9]?.cumulative === want.golden,
        `expected 10 picks ending at ${want.golden} cells, got ${golden.length} ending ${golden[9]?.cumulative}`,
      ],
    ]);
  },
);

add(
  FO,
  'select-cumulative-consistent',
  3,
  10,
  'contract',
  'driftbench select',
  'examples/acme/golden/README.md (Each pick takes ... the spec that adds ...)',
  'the cumulative cell count of each pick equals the previous cumulative plus what it adds, and never goes down',
  async (ctx) => {
    const s = await selectGated(ctx.scratch, ctx.root);
    const g = (s.j?.golden ?? []) as { id: string; adds_cells: number; cumulative: number }[];
    let sum = 0;
    const bad: string[] = [];
    for (const x of g) {
      sum += x.adds_cells;
      if (x.cumulative !== sum || x.adds_cells < 0)
        bad.push(`${x.id}: expected cumulative ${sum}, got ${x.cumulative}`);
    }
    return expectAll([[g.length > 0 && bad.length === 0, bad.join('; ') || 'no golden list']]);
  },
);

add(
  FO,
  'select-sealed-never',
  4,
  10,
  'contract',
  'driftbench select',
  'docs reference/cli.md "driftbench select and driftbench holdout" (Sealed specs never count)',
  'no spec of the golden set or of the cover is a sealed spec of the gate seal',
  async (ctx) => {
    const s = await selectGated(ctx.scratch, ctx.root);
    const sealed = new Set<string>();
    for (const f of [
      'examples/acme/gated/holdout/seal.json',
      'examples/acme/gated/control-handwritten/holdout/seal.json',
    ]) {
      const t = readFileSync(join(ctx.root, f), 'utf8');
      for (const m of t.matchAll(/"id":\s*"([^"]+)"/g)) sealed.add(m[1] as string);
    }
    const picked = [
      ...((s.j?.cover ?? []) as string[]),
      ...((s.j?.golden ?? []) as { id: string }[]).map((x) => x.id),
    ];
    const hit = picked.filter((id) => sealed.has(id));
    return expectAll([
      [
        sealed.size > 30 && hit.length === 0,
        `sealed ids read ${sealed.size}; picked sealed specs: ${hit.join(',')}`,
      ],
    ]);
  },
);

add(
  FO,
  'select-rerun-needs-force',
  2,
  10,
  'adversarial',
  'driftbench select',
  'driftbench select --help ("--force: replace the golden set an earlier run wrote in the folder")',
  'a second select into the same folder exits 2 without --force and the files stay',
  async (ctx) => {
    const s = await selectGated(ctx.scratch, ctx.root);
    const before = readFileSync(join(s.out, 'golden.json'), 'utf8');
    const r = await cli(
      [
        'select',
        '--cover',
        join(ctx.root, 'examples/acme/map/space.yaml'),
        '--specs',
        join(ctx.root, 'examples/acme/gated'),
        '--out',
        s.out,
        '--k',
        '10',
      ],
      dirname2(s.out),
    );
    return expectAll([
      [
        r.code === 2 && readFileSync(join(s.out, 'golden.json'), 'utf8') === before,
        `expected exit 2 and golden.json unchanged, got ${r.code}`,
      ],
    ]);
  },
);

function dirname2(p: string): string {
  return p.slice(0, p.lastIndexOf('/'));
}

add(
  FO,
  'select-bad-arguments',
  1,
  10,
  'adversarial',
  'driftbench select',
  'docs/reference/cli.md (select: exit 2 on a usage or input error)',
  'a k of 0 or a word, a t of 0 or 9, a missing map and a missing specs folder exit 2 and write nothing',
  async (ctx) => {
    const d = dir(ctx.scratch, uniq('selbad'));
    const base = [
      'select',
      '--cover',
      join(ctx.root, 'examples/acme/map/space.yaml'),
      '--specs',
      join(ctx.root, 'examples/acme/gated'),
    ];
    const runs: [string, string[]][] = [
      ['k0', [...base, '--out', join(d, 'a'), '--k', '0']],
      ['kabc', [...base, '--out', join(d, 'b'), '--k', 'abc']],
      ['t0', [...base, '--out', join(d, 'c'), '--t', '0']],
      ['t9', [...base, '--out', join(d, 'e'), '--t', '9']],
      [
        'nomap',
        [
          'select',
          '--cover',
          join(d, 'nomap.yaml'),
          '--specs',
          join(ctx.root, 'examples/acme/gated'),
          '--out',
          join(d, 'f'),
        ],
      ],
      [
        'nospecs',
        [
          'select',
          '--cover',
          join(ctx.root, 'examples/acme/map/space.yaml'),
          '--specs',
          join(d, 'nospecs'),
          '--out',
          join(d, 'g'),
        ],
      ],
    ];
    const seen: string[] = [];
    for (const [n, a] of runs) seen.push(`${n}:${(await cli(a, d)).code}`);
    return expectAll([
      [seen.every((x) => x.endsWith(':2')), `expected 2 for each, got ${seen.join(' ')}`],
      [readdirSync(d).length === 0, `files written: ${readdirSync(d)}`],
    ]);
  },
);

add(
  FO,
  'select-whole-cover-without-k',
  4,
  10,
  'contract',
  'driftbench select',
  'driftbench select --help ("--k: the size of the golden set; without it, the whole cover")',
  'without --k the golden set is the whole cover documented in the golden README and covers every cell the pool covers',
  async (ctx) => {
    const d = dir(ctx.scratch, uniq('selcover'));
    const r = await cli(
      [
        'select',
        '--cover',
        join(ctx.root, 'examples/acme/map/space.yaml'),
        '--specs',
        join(ctx.root, 'examples/acme/gated'),
        '--out',
        join(d, 'g'),
        '--json',
      ],
      d,
    );
    const want = goldenContract(ctx.root);
    const j = parse(r);
    const files = existsSync(join(d, 'g/specs'))
      ? (readdirSync(join(d, 'g/specs'), { recursive: true }) as string[]).filter((f) => f.endsWith('.yaml'))
          .length
      : 0;
    return expectAll([
      [
        (j?.cover ?? []).length === want.cover && (j?.golden ?? []).length === want.cover,
        `expected ${want.cover} in cover and golden, got ${(j?.cover ?? []).length} / ${(j?.golden ?? []).length}`,
      ],
      [files === want.cover, `expected ${want.cover} spec files written, got ${files}`],
      [
        (j?.golden ?? []).at(-1)?.cumulative === want.cells,
        `expected the cover to end at ${want.cells} cells, got ${(j?.golden ?? []).at(-1)?.cumulative}`,
      ],
    ]);
  },
);

add(
  FO,
  'committed-golden-json',
  2,
  10,
  'contract',
  'examples/acme/golden',
  'examples/acme/golden/README.md "The files" (golden.json holds each golden spec with its hash and what it adds)',
  'the committed golden.json lists ten specs, each of which exists in specs/, and ends at the coverage documented in the README',
  async (ctx) => {
    const want = goldenContract(ctx.root);
    const t = readFileSync(join(ctx.root, 'examples/acme/golden/golden.json'), 'utf8');
    const j = JSON.parse(t) as { golden?: { id: string; path: string; cumulative: number; hash: string }[] };
    const g = j.golden ?? [];
    const missing = g.filter((x) => !existsSync(join(ctx.root, 'examples/acme/golden', x.path)));
    const wrongHashes = [];
    for (const entry of g) {
      const loaded = await loadSpecFile(join(ctx.root, 'examples/acme/golden', entry.path));
      if (!loaded.ok || loaded.hash !== entry.hash || loaded.spec.id !== entry.id) wrongHashes.push(entry.id);
    }
    return expectAll([
      [
        g.length === 10 && g[9]?.cumulative === want.golden,
        `expected 10 picks ending at ${want.golden}, got ${g.length} ending ${g[9]?.cumulative}`,
      ],
      [missing.length === 0, `missing files: ${missing.map((x) => x.path)}`],
      [wrongHashes.length === 0, `golden ids or hashes disagree: ${wrongHashes}`],
    ]);
  },
);

// ---- holdout

type Hold = {
  dir: string;
  sealed: string;
  seal1: Cli;
  seal2: Cli;
  score1: Cli;
  reseal: Cli;
  score2: Cli;
  score3: Cli;
  restate: Cli;
  budget: Json;
  sealedJson: Json;
};

function holdout(scratch: string, root: string): Promise<Hold> {
  return once(scratch, 'holdout', async () => {
    const d = dir(scratch, 'holdout');
    const sealed = join(d, 'sealed');
    const specs = join(root, 'examples/acme/gated');
    const seal1 = await cli(['holdout', 'seal', '--specs', specs, '--out', sealed], d);
    const seal2 = await cli(['holdout', 'seal', '--specs', specs, '--out', sealed], d);
    const score1 = await cli(
      ['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales', '--budget', '2'],
      d,
    );
    const reseal = await cli(['holdout', 'seal', '--specs', specs, '--out', sealed, '--force'], d);
    const score2 = await cli(
      ['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales', '--json'],
      d,
    );
    const score3 = await cli(['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales'], d);
    const restate = await cli(
      ['holdout', 'score', '--sealed', sealed, '--target', 'function:acme-sales', '--budget', '5'],
      d,
    );
    const rd = (f: string) => {
      try {
        return JSON.parse(readFileSync(join(sealed, f), 'utf8'));
      } catch {
        return null;
      }
    };
    return {
      dir: d,
      sealed,
      seal1,
      seal2,
      score1,
      reseal,
      score2,
      score3,
      restate,
      budget: rd('budget.json'),
      sealedJson: rd('sealed.json'),
    };
  });
}

const QHO = 'docs/reference/cli.md "driftbench select and driftbench holdout"';

add(
  FO,
  'holdout-seal-gate-split',
  3,
  10,
  'contract',
  'driftbench holdout seal',
  `${QHO} (seal seals the gate own split when it has one)`,
  'seal takes the gate own split and writes sealed.json, exit 0',
  async (ctx) => {
    const want = await gateContract(ctx.root);
    const h = await holdout(ctx.scratch, ctx.root);
    return expectAll([
      [
        h.seal1.code === 0 && h.seal1.out.includes(`Sealed ${want.sealed} of ${want.total} gated specs`),
        `expected exit 0 and "Sealed ${want.sealed} of ${want.total}", got ${h.seal1.code} ${brief(h.seal1.out.slice(0, 160))}`,
      ],
      [
        (h.sealedJson?.specs ?? []).length === want.sealed,
        `expected ${want.sealed} specs in sealed.json, got ${(h.sealedJson?.specs ?? []).length}`,
      ],
    ]);
  },
);

add(
  FO,
  'holdout-seal-twice',
  2,
  10,
  'adversarial',
  'driftbench holdout seal',
  'driftbench holdout seal --help ("--force: replace a seal that has never been scored")',
  'sealing again into the same folder exits 2 without --force',
  async (ctx) => {
    const h = await holdout(ctx.scratch, ctx.root);
    return expectAll([[h.seal2.code === 2, `expected exit 2, got ${h.seal2.code}`]]);
  },
);

add(
  FO,
  'holdout-scored-never-resealed',
  3,
  10,
  'contract',
  'driftbench holdout seal',
  'driftbench holdout seal --help ("--force: replace a seal that has never been scored")',
  'a seal that has been scored is not replaced even with --force',
  async (ctx) => {
    const h = await holdout(ctx.scratch, ctx.root);
    return expectAll([
      [
        h.reseal.code === 2 && /scored/.test(h.reseal.err),
        `expected exit 2 naming the score, got ${h.reseal.code} ${brief(h.reseal.err)}`,
      ],
    ]);
  },
);

add(
  FO,
  'holdout-score-wilson',
  4,
  10,
  'contract',
  'driftbench holdout score',
  `${QHO} (prints the pass rate with its Wilson interval)`,
  'the score prints passed over conversations with the Wilson interval of those counts',
  async (ctx) => {
    const want = await gateContract(ctx.root);
    const h = await holdout(ctx.scratch, ctx.root);
    const j = parse(h.score2);
    const [lo, hi] = wilson(j?.passed ?? -1, j?.conversations ?? 0);
    return expectAll([
      [
        h.score1.code === 0 && h.score2.code === 0,
        `expected exit 0 for both scores, got ${h.score1.code} and ${h.score2.code}`,
      ],
      [
        j?.conversations === want.runnable && j?.passed >= 0,
        `expected ${want.runnable} runnable conversations, got ${j?.conversations}`,
      ],
      [
        close(j?.rate?.lower, lo, 1e-9) && close(j?.rate?.upper, hi, 1e-9),
        `expected [${lo}, ${hi}] for ${j?.passed}/${j?.conversations}, got ${JSON.stringify(j?.rate)}`,
      ],
    ]);
  },
);

add(
  FO,
  'holdout-score-budget',
  3,
  10,
  'contract',
  'driftbench holdout score',
  `${QHO} (each score spends one query of the budget; exit 1 when the budget is spent)`,
  'with a budget of 2 the first score leaves 1, the second leaves 0 and the third exits 1',
  async (ctx) => {
    const h = await holdout(ctx.scratch, ctx.root);
    const j = parse(h.score2);
    return expectAll([
      [
        /Budget: 1 of 2 queries used, 1 left/.test(h.score1.out),
        `expected "1 of 2 queries used, 1 left", got ${brief(h.score1.out.slice(-160))}`,
      ],
      [
        j?.budget?.used === 2 && j?.budget?.left === 0,
        `expected used 2 left 0, got ${JSON.stringify(j?.budget)}`,
      ],
      [h.score3.code === 1, `expected exit 1 once spent, got ${h.score3.code}`],
      [
        h.budget?.used === 2 && (h.budget?.scores ?? []).length === 2,
        `budget.json should hold 2 scores, got ${JSON.stringify(h.budget)?.slice(0, 120)}`,
      ],
    ]);
  },
);

add(
  FO,
  'holdout-budget-fixed',
  3,
  10,
  'adversarial',
  'driftbench holdout score',
  'driftbench holdout score --help ("--budget: fixed by the first score; later scores may restate it")',
  'a later score that restates a different budget exits 2 and the budget stays',
  async (ctx) => {
    const h = await holdout(ctx.scratch, ctx.root);
    return expectAll([
      [
        h.restate.code === 2 && h.budget?.total === 2,
        `expected exit 2 and total 2, got ${h.restate.code} total ${h.budget?.total}`,
      ],
    ]);
  },
);

add(
  FO,
  'holdout-stays-sealed',
  3,
  10,
  'contract',
  'driftbench holdout score',
  `${QHO} (never which spec passed)`,
  'the score output names no sealed spec as passed or failed',
  async (ctx) => {
    const want = await gateContract(ctx.root);
    const h = await holdout(ctx.scratch, ctx.root);
    const ids = ((h.sealedJson?.specs ?? []) as { id: string }[]).map((x) => x.id);
    const notRun = ((parse(h.score2)?.not_run ?? []) as string[]).join(' ');
    const text = h.score1.out + h.score2.out;
    const leaked = ids.filter((id) => text.includes(id) && !notRun.includes(id));
    return expectAll([
      [
        ids.length === want.sealed && leaked.length === 0,
        `sealed ids in the score output: ${leaked.join(',')}`,
      ],
    ]);
  },
);

// ---- simulate

type SimFix = { dir: string; spec: string; persona: string; rec: string; recDir: string };

function simFixture(scratch: string, root: string): Promise<SimFix> {
  return once(scratch, 'sim', async () => {
    const d = dir(scratch, 'sim');
    const cp = (from: string, to: string) => put(join(d, to), readFileSync(join(root, from), 'utf8'));
    cp('examples/acme/specs/conversations/plan-upgrade.yaml', 'specs/conversations/plan-upgrade.yaml');
    cp('examples/acme/personas/sam-upgrader.yaml', 'personas/sam-upgrader.yaml');
    const rec = readFileSync(join(root, 'examples/acme/personas/recordings/sam-upgrader.yaml'), 'utf8');
    put(join(d, 'personas/recordings/ok.yaml'), rec);
    return {
      dir: d,
      spec: join(d, 'specs/conversations/plan-upgrade.yaml'),
      persona: join(d, 'personas/sam-upgrader.yaml'),
      rec: join(d, 'personas/recordings/ok.yaml'),
      recDir: join(d, 'personas/recordings'),
    };
  });
}

function recWith(f: SimFix, name: string, edit: (text: string) => string): string {
  const text = readFileSync(f.rec, 'utf8');
  const p = join(f.recDir, `${name}.yaml`);
  writeFileSync(p, edit(text));
  return p;
}

const QSIM = 'docs/simulated-user.md "driftbench simulate"';

add(
  FO,
  'simulate-recording-completes',
  2,
  10,
  'contract',
  'driftbench simulate',
  `${QSIM} (the plan upgrade with the hand-written recording: 5 of 5 blocks pass)`,
  'the plan upgrade with the hand-written recording passes 5 of 5 blocks, gives the email once asked and exits 0',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const r = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', f.rec, '--json'], f.dir);
    const j = parse(r);
    const blocks = (j?.blocks ?? []) as { pass: boolean }[];
    return expectAll([
      [
        r.code === 0 && j?.status === 'completed' && blocks.length === 5 && blocks.every((b) => b.pass),
        `expected 5 passing blocks and exit 0, got exit ${r.code} ${j?.status} ${blocks.length}`,
      ],
      [
        JSON.stringify(j?.revealed) === '["email"]',
        `expected the email revealed once, got ${JSON.stringify(j?.revealed)}`,
      ],
      [j?.ended === 'the spec has no block 5', `expected the run to end with the spec, got ${j?.ended}`],
    ]);
  },
);

add(
  FO,
  'simulate-turns-limit',
  2,
  10,
  'contract',
  'driftbench simulate',
  `${QSIM} (--turns n: stop after this many user turns)`,
  '--turns n plays exactly n user turns and ends saying so',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const n = 1 + (ctx.seed % 3);
    const r = await cli(
      ['simulate', f.spec, '--persona', f.persona, '--recording', f.rec, '--turns', String(n), '--json'],
      f.dir,
    );
    const j = parse(r);
    return expectAll([
      [
        (j?.blocks ?? []).length === n && /turns/.test(j?.ended ?? '') && r.code === 0,
        `expected ${n} blocks ending on --turns, got ${(j?.blocks ?? []).length} "${j?.ended}" exit ${r.code}`,
      ],
    ]);
  },
);

add(
  FO,
  'simulate-source-exactly-one',
  1,
  10,
  'adversarial',
  'driftbench simulate',
  `${QSIM} (exit 2: no source or both)`,
  'neither --model nor --recording, and both together, exit 2 before anything runs',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const a = await cli(['simulate', f.spec, '--persona', f.persona], f.dir);
    const b = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', f.rec, '--model'], f.dir);
    return expectAll([[a.code === 2 && b.code === 2, `expected 2 and 2, got ${a.code} and ${b.code}`]]);
  },
);

add(
  FO,
  'simulate-family-refused',
  3,
  10,
  'adversarial',
  'driftbench simulate',
  QSIM +
    ' (Its model must belong to another family than the agent and the judges; refused before anything runs)',
  'a user model of the agent family or a judge family is refused with exit 2',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const a = await cli(
      ['simulate', f.spec, '--persona', f.persona, '--recording', f.rec, '--agent-family', 'hand-written'],
      f.dir,
    );
    const b = await cli(
      [
        'simulate',
        f.spec,
        '--persona',
        f.persona,
        '--recording',
        f.rec,
        '--judge-family',
        'hand-written',
        '--judge-family',
        'other',
      ],
      f.dir,
    );
    const c = await cli(
      ['simulate', f.spec, '--persona', f.persona, '--recording', f.rec, '--judge-family', 'other'],
      f.dir,
    );
    return expectAll([
      [a.code === 2 && b.code === 2 && c.code === 0, `expected 2, 2, 0 got ${a.code}, ${b.code}, ${c.code}`],
    ]);
  },
);

add(
  FO,
  'simulate-bad-turns',
  1,
  10,
  'adversarial',
  'driftbench simulate',
  `${QSIM} (exit 2: a bad number)`,
  'a --turns of 0, negative or a word exits 2',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const seen: number[] = [];
    for (const t of ['0', '-2', 'abc', '1.5'])
      seen.push(
        (await cli(['simulate', f.spec, '--persona', f.persona, '--recording', f.rec, '--turns', t], f.dir))
          .code,
      );
    return expectAll([[seen.every((c) => c === 2), `expected 2 for each, got ${seen}`]]);
  },
);

add(
  FO,
  'simulate-fact-before-asked',
  4,
  10,
  'contract',
  'driftbench simulate',
  `${QSIM} (an answer that holds a fact not yet asked fails the run)`,
  'a recorded answer that gives the email before the agent asked fails the run with exit 1',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const rec = recWith(f, 'early', (t) =>
      t.replace("  - Hello! I'm already", "  - Hello! sam.rivera@example.com here, I'm already"),
    );
    const r = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', rec, '--json'], f.dir);
    const j = parse(r);
    return expectAll([
      [
        r.code === 1 && j?.status === 'failed' && /before the agent asked/.test(j?.ended ?? ''),
        `expected exit 1 and a failure naming the early fact, got exit ${r.code} ${j?.status} "${j?.ended}"`,
      ],
    ]);
  },
);

add(
  FO,
  'simulate-stop-token',
  3,
  10,
  'contract',
  'driftbench simulate',
  `${QSIM} (It says its stop token, alone, when the goal is met; the run then ends)`,
  'a recorded answer that is only the stop token ends the run there and the token is not sent to the agent',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const rec = recWith(f, 'stop', (t) => t.replace(/ {2}- Confirm\n[\s\S]*$/, "  - '###STOP###'\n"));
    const r = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', rec, '--json'], f.dir);
    const j = parse(r);
    const users = ((j?.blocks ?? []) as { user: string }[]).map((b) => b.user);
    return expectAll([
      [
        r.code === 0 && /stop token at block 3/.test(j?.ended ?? ''),
        `expected the run to end at block 3 on the stop token, got ${r.code} "${j?.ended}"`,
      ],
      [
        users.length === 3 && !users.some((u) => u.includes('STOP')),
        `expected 3 blocks and no token sent, got ${users.length}`,
      ],
    ]);
  },
);

add(
  FO,
  'simulate-stop-token-not-alone',
  3,
  10,
  'contract',
  'driftbench simulate',
  `${QSIM} (its stop token, alone)`,
  'an answer that carries the stop token inside other words does not end the run',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const rec = recWith(f, 'stopmixed', (t) => t.replace('  - Confirm', '  - Confirm ###STOP###'));
    const r = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', rec, '--json'], f.dir);
    const j = parse(r);
    return expectAll([
      [
        (j?.blocks ?? []).length === 5 && !/stop token/.test(j?.ended ?? ''),
        `expected all 5 blocks and no stop, got ${(j?.blocks ?? []).length} "${j?.ended}"`,
      ],
    ]);
  },
);

add(
  FO,
  'simulate-recording-runs-out',
  3,
  10,
  'contract',
  'driftbench simulate',
  `${QSIM} (one answer per turn: turn n gets answer n)`,
  'a recording with fewer answers than turns fails the run with exit 1 naming the turn',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const rec = recWith(f, 'short', (t) => `${t.split('\n').slice(0, 8).join('\n')}\n`);
    const r = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', rec, '--json'], f.dir);
    const j = parse(r);
    return expectAll([
      [
        r.code === 1 && j?.status === 'failed' && /none for turn 3/.test(j?.ended ?? ''),
        `expected exit 1 naming turn 3, got ${r.code} "${j?.ended}"`,
      ],
    ]);
  },
);

add(
  FO,
  'simulate-wrong-persona-recording',
  2,
  10,
  'adversarial',
  'driftbench simulate',
  `${QSIM} (A recording holds the family it stands for, the persona id)`,
  'a recording written for another persona exits 2',
  async (ctx) => {
    const f = await simFixture(ctx.scratch, ctx.root);
    const rec = recWith(f, 'other', (t) => t.replace('persona: sam-upgrader', 'persona: someone-else'));
    const r = await cli(['simulate', f.spec, '--persona', f.persona, '--recording', rec], f.dir);
    return expectAll([[r.code === 2, `expected exit 2, got ${r.code}`]]);
  },
);

// ---- attack

type AtkFix = { dir: string; spec: string; rec: string; first: Cli; json: Json; again: Cli };

function attackFixture(scratch: string, root: string): Promise<AtkFix> {
  return once(scratch, 'attack', async () => {
    const d = dir(scratch, 'attack');
    const spec = join(root, 'examples/acme/specs/conversations/order-loose-confirmation.yaml');
    const rec = join(d, 'rec.json');
    const first = await cli(['attack', spec, '--rounds', '10', '--seed', '0', '--record', rec, '--json'], d);
    const again = await cli(['attack', spec, '--rounds', '10', '--seed', '0', '--json'], d);
    return { dir: d, spec, rec, first, json: parse(first), again };
  });
}

const QATK = 'docs/attack.md "driftbench attack"';

add(
  FO,
  'attack-rounds-distinct-classes',
  3,
  10,
  'contract',
  'driftbench attack',
  `${QATK} (--rounds: the most attacks, one class each)`,
  'ten rounds attack ten different deviation classes, one each',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const classes = ((a.json?.rounds ?? []) as { class: string }[]).map((x) => x.class);
    return expectAll([
      [
        a.first.code === 0 && classes.length === 10 && new Set(classes).size === 10,
        `expected 10 distinct classes, got ${classes.length} / ${new Set(classes).size}`,
      ],
    ]);
  },
);

add(
  FO,
  'attack-first-round-reads-reference',
  3,
  10,
  'contract',
  'driftbench attack',
  'docs/attack.md (It first runs the spec free: the reference)',
  'round 1 takes its cue from the reference run',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const r1 = (a.json?.rounds ?? [])[0];
    const r2 = (a.json?.rounds ?? [])[1];
    return expectAll([
      [
        r1?.cue?.run === 'reference' && r2?.cue?.run === r1?.runId,
        `expected round 1 cue from "reference" and round 2 from round 1's run, got ${r1?.cue?.run} and ${r2?.cue?.run} vs ${r1?.runId}`,
      ],
    ]);
  },
);

add(
  FO,
  'attack-same-seed-same-attacks',
  2,
  10,
  'contract',
  'driftbench attack',
  `${QATK} (--seed: the seed of every tie and draw)`,
  'the same seed gives the same classes, positions and phrasings',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const key = (j: Json) =>
      JSON.stringify(
        ((j?.rounds ?? []) as { class: string; injectAt: number; phrasing: { id: string } }[]).map((x) => [
          x.class,
          x.injectAt,
          x.phrasing?.id,
        ]),
      );
    return expectAll([
      [
        key(a.json) === key(parse(a.again)) && key(a.json).length > 20,
        `two runs with seed 0 differ: ${key(a.json).slice(0, 120)} vs ${key(parse(a.again)).slice(0, 120)}`,
      ],
    ]);
  },
);

add(
  FO,
  'attack-rounds-range',
  1,
  10,
  'adversarial',
  'driftbench attack',
  `${QATK} (--rounds 1 to 10; exit 2 on a bad number)`,
  'a rounds value of 0, 11 or a word exits 2 before anything runs',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const seen: number[] = [];
    for (const n of ['0', '11', 'abc', '2.5'])
      seen.push((await cli(['attack', a.spec, '--rounds', n], a.dir)).code);
    return expectAll([[seen.every((c) => c === 2), `expected 2 for each, got ${seen}`]]);
  },
);

add(
  FO,
  'attack-replay-same-attacks',
  4,
  10,
  'contract',
  'driftbench attack',
  `${QATK} (a replay runs the same attacks without the pack, the seed or the model)`,
  'a replay of the recording gives the same rounds even with another seed and an unreadable pack',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const r = await cli(
      ['attack', a.spec, '--replay', a.rec, '--seed', '77', '--pack', join(a.dir, 'no-pack'), '--json'],
      a.dir,
    );
    const key = (j: Json) =>
      JSON.stringify(
        ((j?.rounds ?? []) as { class: string; injectAt: number; phrasing: { id: string } }[]).map((x) => [
          x.class,
          x.injectAt,
          x.phrasing?.id,
        ]),
      );
    return expectAll([
      [
        r.code === 0 && key(parse(r)) === key(a.json),
        `expected the recorded rounds, got exit ${r.code}: ${brief(r.err || key(parse(r)), 160)}`,
      ],
    ]);
  },
);

add(
  FO,
  'attack-replay-other-spec',
  2,
  10,
  'adversarial',
  'driftbench attack',
  `${QATK} (exit 2: an unreadable or foreign recording)`,
  'a recording made on one spec is refused on another spec with exit 2',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const r = await cli(
      ['attack', join(ctx.root, 'examples/acme/specs/conversations/plan-upgrade.yaml'), '--replay', a.rec],
      a.dir,
    );
    const m = await cli(['attack', a.spec, '--replay', join(a.dir, 'missing.json')], a.dir);
    return expectAll([[r.code === 2 && m.code === 2, `expected 2 and 2, got ${r.code} and ${m.code}`]]);
  },
);

add(
  FO,
  'attack-unapproved-needs-drafts',
  3,
  10,
  'contract',
  'driftbench attack',
  `${QATK} (--drafts: draw from phrasings nobody has approved yet)`,
  'a pack with no approved phrasing is refused with exit 2 unless --drafts is given',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const pack = join(a.dir, 'draftpack');
    for (const f of readdirSync(join(ctx.root, 'examples/acme/redteam')).filter((x) => x.endsWith('.yaml')))
      put(
        join(pack, f),
        readFileSync(join(ctx.root, 'examples/acme/redteam', f), 'utf8').replace(
          /approved: true/g,
          'approved: false',
        ),
      );
    const no = await cli(['attack', a.spec, '--rounds', '3', '--pack', pack], a.dir);
    const yes = await cli(['attack', a.spec, '--rounds', '3', '--pack', pack, '--drafts'], a.dir);
    return expectAll([
      [
        no.code === 2 && yes.code === 0,
        `expected 2 without and 0 with --drafts, got ${no.code} and ${yes.code}`,
      ],
    ]);
  },
);

add(
  FO,
  'attack-nearest-pack',
  4,
  10,
  'contract',
  'driftbench attack',
  `${QATK} (--pack: default the nearest redteam/ folder at or above the spec)`,
  'without --pack the phrasings come from the redteam folder next to the spec',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const d = dir(ctx.scratch, uniq('nearpack'));
    for (const f of readdirSync(join(ctx.root, 'examples/acme/redteam')).filter((x) => x.endsWith('.yaml')))
      put(
        join(d, 'redteam', f),
        readFileSync(join(ctx.root, 'examples/acme/redteam', f), 'utf8').replace(/id: (d\d)/g, 'id: zz-$1'),
      );
    const spec = join(d, 'specs/order.yaml');
    put(spec, readFileSync(a.spec, 'utf8'));
    const r = await cli(['attack', spec, '--rounds', '10', '--json'], d);
    const ph = ((parse(r)?.rounds ?? []) as { phrasing: { id: string; source: string } }[])
      .filter((x) => x.phrasing?.source === 'pack')
      .map((x) => x.phrasing.id);
    return expectAll([
      [
        r.code === 0 && ph.length > 0 && ph.every((id) => id.startsWith('zz-')),
        `expected pack phrasings from the nearby folder (zz- ids), got exit ${r.code}: ${ph}`,
      ],
    ]);
  },
);

add(
  FO,
  'attack-model-needs-port',
  1,
  10,
  'adversarial',
  'driftbench attack',
  `${QATK} (exit 2: no adapter, a model of the agent family)`,
  '--model with no model key in the environment exits 2 and says what to set',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    const keep = [process.env.ANTHROPIC_API_KEY, process.env.OPENAI_API_KEY];
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const r = await cli(['attack', a.spec, '--rounds', '2', '--model'], a.dir);
      return expectAll([
        [
          r.code === 2 && /ANTHROPIC_API_KEY/.test(r.err),
          `expected exit 2 naming the key, got ${r.code} ${brief(r.err)}`,
        ],
      ]);
    } finally {
      if (keep[0] !== undefined) process.env.ANTHROPIC_API_KEY = keep[0];
      if (keep[1] !== undefined) process.env.OPENAI_API_KEY = keep[1];
    }
  },
);

add(
  FO,
  'attack-clean-agent-exit-0',
  2,
  10,
  'contract',
  'driftbench attack',
  `${QATK} (Exit 0: no attack is a finding; the real Acme agent comes back from all ten)`,
  'the real Acme agent comes back from all ten attacks: zero findings and exit 0',
  async (ctx) => {
    const a = await attackFixture(ctx.scratch, ctx.root);
    return expectAll([
      [
        a.first.code === 0 &&
          a.json?.findings === 0 &&
          ((a.json?.rounds ?? []) as { finding: unknown }[]).every((x) => x.finding === null),
        `expected 0 findings, got exit ${a.first.code} findings ${a.json?.findings}`,
      ],
    ]);
  },
);

export function breaker2Items(): BankItem[] {
  return ITEMS;
}
