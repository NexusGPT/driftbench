import { createHash } from 'node:crypto';
import { type BankItem, fn, type JudgesApi, type Tier, value } from '../bank';

/**
 * More capabilities with independent causes (section 12.2), one export or one behaviour per item: the metrics a
 * team uses to validate its judges (agreement, calibration, ranking), more answer formats, what the judge reads
 * (redaction, truncation, normalisation), cassette housekeeping, criteria hygiene, cost and retry arithmetic,
 * council summaries, pairwise rankings, turn helpers, evidence matching, client usage and header masking, and
 * transcript chunking. Every oracle is a fixed case computed by hand or by an independent script; the causes
 * live in causes-more.ts.
 */

// biome-ignore lint/suspicious/noExplicitAny: items call package exports by name, with loose types.
type Any = any;

function call(api: JudgesApi, name: string, ...args: unknown[]): Any {
  return fn<(...a: unknown[]) => unknown>(api, name)(...args);
}

function item(
  level: string,
  id: string,
  tier: Tier,
  component: string,
  run: (api: JudgesApi) => Promise<string | undefined> | string | undefined,
): BankItem {
  return {
    id: `${level}/${id}`,
    family: level,
    tier,
    level,
    component,
    async run({ api }) {
      const problem = await run(api);
      return problem === undefined ? { pass: true, detail: '' } : { pass: false, detail: problem };
    },
  };
}

const near = (a: unknown, b: number, eps = 1e-9) => typeof a === 'number' && Math.abs(a - b) <= eps;
const show = (v: unknown) => JSON.stringify(v);
const same = (a: unknown, b: unknown) => show(a) === show(b);
function expect(name: string, observed: unknown, ok: boolean, expected: unknown): string | undefined {
  return ok ? undefined : `${name}: expected ${show(expected)}, observed ${show(observed)}`;
}
function throwsRange(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (cause) {
    return cause instanceof RangeError;
  }
}

const MET = 'packages/judges/src/metrics.ts';
const CON = 'packages/judges/src/contract.ts';
const PRO = 'packages/judges/src/prompt.ts';
const CAS = 'packages/judges/src/cassette.ts';
const CRI = 'packages/judges/src/criteria.ts';
const BUD = 'packages/judges/src/budget.ts';
const COU = 'packages/judges/src/council.ts';
const PAI = 'packages/judges/src/pairwise.ts';
const TUR = 'packages/judges/src/turns.ts';
const EVI = 'packages/judges/src/evidence.ts';
const CLI = 'packages/judges/src/clients/usage.ts';

const A = ['pass', 'pass', 'fail', 'fail', 'pass', 'inconclusive', 'fail', 'pass', 'pass', 'fail'];
const B = ['pass', 'fail', 'fail', 'fail', 'pass', 'inconclusive', 'pass', 'pass', 'pass', 'fail'];
const PRED = ['fail', 'fail', 'pass', 'pass', 'fail', 'pass', 'pass', 'fail', 'pass', 'pass', 'fail', 'pass'];
const GOLD = ['fail', 'pass', 'pass', 'fail', 'fail', 'pass', 'pass', 'fail', 'pass', 'fail', 'fail', 'pass'];
const PROBS = [0.9, 0.8, 0.3, 0.6, 0.1, 0.7, 0.95, 0.2, 0.4, 0.55];
const LABELS = [true, true, false, true, false, false, true, false, true, true];
const LENGTHS = [120, 340, 90, 560, 340, 210, 800, 150];
const SCORES = [0.6, 0.8, 0.5, 0.9, 0.7, 0.7, 1.0, 0.4];
const FLEISS = [
  [0, 0, 0, 0, 14],
  [0, 2, 6, 4, 2],
  [0, 0, 3, 5, 6],
  [0, 3, 9, 2, 0],
  [2, 2, 8, 1, 1],
  [7, 7, 0, 0, 0],
  [3, 2, 6, 3, 0],
  [2, 5, 3, 2, 2],
  [6, 5, 2, 1, 0],
  [0, 2, 2, 3, 7],
];
const TRANSCRIPT = [
  { role: 'user', text: 'My bill is wrong.' },
  { role: 'agent', text: 'Sorry to hear that.' },
  { role: 'agent', text: 'Acme Care can help.' },
  { role: 'user', text: 'Thanks.' },
  { role: 'agent', text: 'You are welcome.' },
];
const VOTES = [
  { judge: 'j1', outcome: 'pass', score: 0.9 },
  { judge: 'j2', outcome: 'pass', score: 0.7 },
  { judge: 'j3', outcome: 'fail', score: 0.2 },
  { judge: 'j4', outcome: 'pass' },
  { judge: 'j5', outcome: 'pass', score: 0.8 },
];
const PAIRS = [
  { a: 'x', b: 'y', winner: 'a' },
  { a: 'x', b: 'z', winner: 'tie' },
  { a: 'y', b: 'z', winner: 'b' },
  { a: 'z', b: 'x', winner: 'a' },
  { a: 'y', b: 'x', winner: 'b' },
];

function calibration(): BankItem[] {
  const L = 'calibration';
  return [
    item(L, 'cohen-kappa', 2, MET, (api) => {
      const k = call(api, 'cohenKappa', A, B);
      return expect('cohenKappa', k, near(k, 0.6551724137931035), 0.6551724137931035);
    }),
    item(L, 'cohen-kappa-length-mismatch', 3, MET, (api) => {
      const kappa = fn<(a: string[], b: string[]) => number>(api, 'cohenKappa');
      const ok = throwsRange(() => kappa(['pass'], ['pass', 'fail'])) && throwsRange(() => kappa([], []));
      return ok
        ? undefined
        : 'cohenKappa: lists of different lengths, or empty ones, must throw a RangeError';
    }),
    item(L, 'fleiss-kappa', 3, MET, (api) => {
      const k = call(api, 'fleissKappa', FLEISS);
      return expect('fleissKappa', k, near(k, 0.20993070442195522), 0.20993070442195522);
    }),
    item(L, 'confusion-fail-positive', 1, MET, (api) => {
      const m = call(api, 'confusionMatrix', [...PRED, 'inconclusive'], [...GOLD, 'fail']);
      const want = { tp: 4, fp: 1, tn: 5, fn: 2 };
      return expect('confusionMatrix', m, same({ tp: m?.tp, fp: m?.fp, tn: m?.tn, fn: m?.fn }, want), want);
    }),
    item(L, 'precision-recall-f1', 2, MET, (api) => {
      const r = call(api, 'precisionRecall', PRED, GOLD);
      const ok = near(r?.precision, 0.8) && near(r?.recall, 2 / 3) && near(r?.f1, 0.7272727272727272);
      const none = call(api, 'precisionRecall', ['pass'], ['pass']);
      const zero = near(none?.precision, 0) && near(none?.recall, 0) && near(none?.f1, 0);
      return expect('precisionRecall', [r, none], ok && zero, [
        { precision: 0.8, recall: 2 / 3, f1: 0.7272727272727272 },
        { precision: 0, recall: 0, f1: 0 },
      ]);
    }),
    item(L, 'matthews', 2, MET, (api) => {
      const m = call(api, 'matthews', PRED, GOLD);
      const empty = call(api, 'matthews', ['pass', 'pass'], ['pass', 'pass']);
      return expect(
        'matthews',
        [m, empty],
        near(m, 0.50709255283711) && near(empty, 0),
        [0.50709255283711, 0],
      );
    }),
    item(L, 'balanced-accuracy', 1, MET, (api) => {
      const b = call(api, 'balancedAccuracy', PRED, GOLD);
      return expect('balancedAccuracy', b, near(b, 0.75), 0.75);
    }),
    item(L, 'brier', 1, MET, (api) => {
      const b = call(api, 'brierScore', PROBS, LABELS);
      return expect('brierScore', b, near(b, 0.1405), 0.1405);
    }),
    item(L, 'ece', 3, MET, (api) => {
      const e = call(api, 'expectedCalibrationError', PROBS, LABELS, 5);
      return expect('expectedCalibrationError with 5 bins', e, near(e, 0.21), 0.21);
    }),
    item(L, 'log-loss', 2, MET, (api) => {
      const l = call(api, 'logLoss', PROBS, LABELS);
      const clipped = call(api, 'logLoss', [1, 0], [true, false]);
      const ok = near(l, 0.42939025329920566) && typeof clipped === 'number' && Number.isFinite(clipped);
      return expect('logLoss', [l, clipped], ok, [0.42939025329920566, 'a finite number']);
    }),
    item(L, 'wilson', 2, MET, (api) => {
      const w = call(api, 'wilsonInterval', 17, 20);
      const ok = near(w?.[0], 0.6395767041130426, 1e-9) && near(w?.[1], 0.9476322080405041, 1e-9);
      return expect('wilsonInterval(17, 20)', w, ok, [0.6395767041130426, 0.9476322080405041]);
    }),
    item(L, 'wilson-empty', 3, MET, (api) => {
      const w = call(api, 'wilsonInterval', 0, 0);
      return expect('wilsonInterval(0, 0)', w, same(w, [0, 1]), [0, 1]);
    }),
    item(L, 'spearman-ties', 3, MET, (api) => {
      const r = call(api, 'spearman', LENGTHS, SCORES);
      return expect('spearman', r, near(r, 0.9096385542168675), 0.9096385542168675);
    }),
    item(L, 'kendall-tau-b', 3, MET, (api) => {
      const t = call(api, 'kendallTau', LENGTHS, SCORES);
      return expect('kendallTau', t, near(t, 0.8148148148148148), 0.8148148148148148);
    }),
    item(L, 'roc-auc', 2, MET, (api) => {
      const a = call(api, 'rocAuc', PROBS, LABELS);
      const tie = call(api, 'rocAuc', [0.5, 0.5], [true, false]);
      return expect('rocAuc', [a, tie], near(a, 0.875) && near(tie, 0.5), [0.875, 0.5]);
    }),
    item(L, 'mcnemar', 3, MET, (api) => {
      const a = [1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0].map(Boolean);
      const b = [1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1].map(Boolean);
      const m = call(api, 'mcnemar', a, b);
      const none = call(api, 'mcnemar', [true], [true]);
      const ok = m?.b01 === 5 && m?.b10 === 1 && near(m?.chi2, 1.5) && near(none?.chi2, 0);
      return expect('mcnemar', [m, none], ok, [{ b01: 5, b10: 1, chi2: 1.5 }, { chi2: 0 }]);
    }),
    item(L, 'agreement-with-gold', 2, MET, (api) => {
      const r = call(api, 'agreementWithGold', A, B);
      const ok = near(r?.agreement, 7 / 9) && near(r?.coverage, 0.9);
      return expect('agreementWithGold', r, ok, { agreement: 7 / 9, coverage: 0.9 });
    }),
    item(L, 'threshold-sweep', 3, MET, (api) => {
      const r = call(api, 'thresholdSweep', PROBS, LABELS);
      return expect('thresholdSweep', r, near(r?.threshold, 0.4) && near(r?.accuracy, 0.9), {
        threshold: 0.4,
        accuracy: 0.9,
      });
    }),
    item(L, 'position-bias', 2, MET, (api) => {
      const pairs = [
        { first: 'a', swapped: 'a' },
        { first: 'a', swapped: 'b' },
        { first: 'b', swapped: 'a' },
        { first: 'tie', swapped: 'tie' },
        { first: 'b', swapped: 'b' },
      ];
      const r = call(api, 'positionBias', pairs);
      return expect('positionBias', r, near(r, 0.4), 0.4);
    }),
    item(L, 'majority-label', 1, MET, (api) => {
      const r = [
        call(api, 'majorityLabel', ['pass', 'fail', 'pass']),
        call(api, 'majorityLabel', ['pass', 'fail']),
        call(api, 'majorityLabel', []),
      ];
      return expect('majorityLabel', r, same(r, ['pass', 'inconclusive', 'inconclusive']), [
        'pass',
        'inconclusive',
        'inconclusive',
      ]);
    }),
    item(L, 'stability-rate', 1, MET, (api) => {
      const r = call(api, 'stabilityRate', ['pass', 'pass', 'fail', 'pass', 'inconclusive']);
      return expect('stabilityRate', r, near(r, 0.6), 0.6);
    }),
    item(L, 'flaky-criteria', 2, MET, (api) => {
      const r = call(api, 'flakyCriteria', {
        zeta: ['pass', 'fail'],
        alpha: ['pass', 'pass'],
        beta: ['fail', 'inconclusive', 'fail'],
      });
      return expect('flakyCriteria', r, same(r, ['beta', 'zeta']), ['beta', 'zeta']);
    }),
    item(L, 'pass-rate', 1, MET, (api) => {
      const r = [
        call(api, 'passRate', [
          { outcome: 'pass' },
          { outcome: 'fail' },
          { outcome: 'inconclusive' },
          { outcome: 'pass' },
        ]),
        call(api, 'passRate', [{ outcome: 'inconclusive' }]),
      ];
      return expect('passRate', r, near(r[0], 2 / 3) && r[1] === undefined, [2 / 3, undefined]);
    }),
    item(L, 'outcome-counts', 1, MET, (api) => {
      const r = call(api, 'outcomeCounts', [{ outcome: 'pass' }, { outcome: 'fail' }, { outcome: 'pass' }]);
      const want = { pass: 2, fail: 1, inconclusive: 0 };
      return expect(
        'outcomeCounts',
        r,
        same({ pass: r?.pass, fail: r?.fail, inconclusive: r?.inconclusive }, want),
        want,
      );
    }),
    item(L, 'percentile-nearest-rank', 2, MET, (api) => {
      const v = [15, 20, 35, 40, 50];
      const r = [
        call(api, 'percentile', v, 30),
        call(api, 'percentile', v, 100),
        call(api, 'percentile', v, 0),
      ];
      return expect('percentile', r, same(r, [20, 50, 15]), [20, 50, 15]);
    }),
    item(L, 'latency-summary', 2, MET, (api) => {
      const r = call(api, 'latencySummary', [120, 80, 300, 95, 1500, 210, 180, 90, 400, 110]);
      const want = { p50: 120, p95: 1500, max: 1500 };
      return expect('latencySummary', r, same({ p50: r?.p50, p95: r?.p95, max: r?.max }, want), want);
    }),
    item(L, 'histogram', 2, MET, (api) => {
      const r = call(api, 'scoreHistogram', [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1], 4);
      return expect('scoreHistogram', r, same(r, [2, 1, 1, 3]), [2, 1, 1, 3]);
    }),
    item(L, 'verbosity-bias', 2, MET, (api) => {
      const r = call(api, 'verbosityBias', LENGTHS, SCORES);
      return expect('verbosityBias', r, near(r, 0.9096385542168675), 0.9096385542168675);
    }),
  ];
}

function contract(): BankItem[] {
  const L = 'contract';
  return [
    item(L, 'xml-answer', 2, CON, (api) => {
      const r = call(
        api,
        'parseAnswerXml',
        'Here: <outcome>fail</outcome>\n<reasoning>no route given</reasoning>',
      );
      const bad = call(api, 'parseAnswerXml', '<outcome>maybe</outcome>');
      const ok =
        r?.outcome === 'fail' && r?.reasoning === 'no route given' && bad?.outcome === 'inconclusive';
      return expect('parseAnswerXml', [r, bad], ok, [
        { outcome: 'fail', reasoning: 'no route given' },
        { outcome: 'inconclusive' },
      ]);
    }),
    item(L, 'yaml-answer', 2, CON, (api) => {
      const r = call(api, 'parseAnswerYaml', 'outcome: pass\nreasoning: routed to Acme Care');
      const bad = call(api, 'parseAnswerYaml', 'reasoning: none');
      const ok =
        r?.outcome === 'pass' && r?.reasoning === 'routed to Acme Care' && bad?.outcome === 'inconclusive';
      return expect('parseAnswerYaml', [r, bad], ok, [
        { outcome: 'pass', reasoning: 'routed to Acme Care' },
        { outcome: 'inconclusive' },
      ]);
    }),
    item(L, 'clamp-reasoning', 1, CON, (api) => {
      const long = call(api, 'clampReasoning', { outcome: 'pass', reasoning: 'abcdefghij' }, 5);
      const short = call(api, 'clampReasoning', { outcome: 'fail', reasoning: 'abc' }, 5);
      const ok = long?.reasoning === 'abcd…' && long?.outcome === 'pass' && short?.reasoning === 'abc';
      return expect('clampReasoning', [long, short], ok, [
        { outcome: 'pass', reasoning: 'abcd…' },
        { outcome: 'fail', reasoning: 'abc' },
      ]);
    }),
    item(L, 'answer-json-schema', 1, CON, (api) => {
      const s = value<Any>(api, 'ANSWER_SCHEMA');
      const ok =
        s?.type === 'object' &&
        same([...(s?.required ?? [])].sort(), ['outcome', 'reasoning']) &&
        same([...(s?.properties?.outcome?.enum ?? [])].sort(), ['fail', 'inconclusive', 'pass']) &&
        s?.properties?.score?.minimum === 0 &&
        s?.properties?.score?.maximum === 1;
      return ok ? undefined : `ANSWER_SCHEMA: observed ${show(s)}`;
    }),
  ];
}

function render(): BankItem[] {
  const L = 'render';
  return [
    item(L, 'redact-secrets', 2, PRO, (api) => {
      const r = call(
        api,
        'redactSecrets',
        'key sk-abcdefghijklmnopqrstuvwx and AKIAABCDEFGHIJKLMNOP, sk-short stays',
      );
      const want = 'key [secret] and [secret], sk-short stays';
      return expect('redactSecrets', r, r === want, want);
    }),
    item(L, 'redact-pii', 2, PRO, (api) => {
      const r = call(api, 'redactPii', 'Mail ann.lee@example.com or call +1 202 555 0100.');
      const want = 'Mail [email] or call [phone].';
      return expect('redactPii', r, r === want, want);
    }),
    item(L, 'truncate-middle', 2, PRO, (api) => {
      const text = 'abcdefghijklmnopqrstuvwxyz';
      const r = call(api, 'truncateMiddle', text, 15);
      const kept = call(api, 'truncateMiddle', 'short', 15);
      const parts = typeof r === 'string' ? r.split(' […] ') : [];
      const ok =
        typeof r === 'string' &&
        r.length <= 15 &&
        parts.length === 2 &&
        text.startsWith(parts[0] as string) &&
        text.endsWith(parts[1] as string) &&
        Math.abs((parts[0] as string).length - (parts[1] as string).length) <= 1 &&
        r.length >= 14 &&
        kept === 'short';
      return ok ? undefined : `truncateMiddle: observed ${show([r, kept])}`;
    }),
    item(L, 'dedupe-transcript', 1, PRO, (api) => {
      const t = [
        { role: 'user', text: 'Hi' },
        { role: 'user', text: 'Hi' },
        { role: 'agent', text: 'Hi' },
        { role: 'user', text: 'Hi' },
      ];
      const r = call(api, 'dedupeTranscript', t);
      const want = [t[0], t[2], t[3]];
      return expect('dedupeTranscript', r, same(r, want), want);
    }),
    item(L, 'normalise-transcript', 1, PRO, (api) => {
      const r = call(api, 'normaliseTranscript', [{ role: 'user', text: '  My   bill\n\tis wrong. ' }]);
      const want = [{ role: 'user', text: 'My bill is wrong.' }];
      return expect('normaliseTranscript', r, same(r, want), want);
    }),
    item(L, 'format-tool-call', 2, PRO, (api) => {
      const r = call(api, 'formatToolCall', 'lookup', { plan: 'basic', id: 7, tags: ['a'] });
      const want = 'lookup(id=7, plan="basic", tags=["a"])';
      return expect('formatToolCall', r, r === want, want);
    }),
    item(L, 'transcript-stats', 1, PRO, (api) => {
      const r = call(api, 'transcriptStats', TRANSCRIPT);
      const characters = TRANSCRIPT.reduce((n, e) => n + e.text.length, 0);
      const want = { entries: 5, userTurns: 2, characters };
      return expect(
        'transcriptStats',
        r,
        same({ entries: r?.entries, userTurns: r?.userTurns, characters: r?.characters }, want),
        want,
      );
    }),
    item(L, 'sentences', 2, PRO, (api) => {
      const r = call(api, 'splitSentences', 'One. Two!  Three?\nFour; five 3.5 six');
      const want = ['One.', 'Two!', 'Three?', 'Four;', 'five 3.5 six'];
      return expect('splitSentences', r, same(r, want), want);
    }),
  ];
}

const CASSETTE = {
  version: 1,
  judges: ['j1', 'j2'],
  entries: [
    { judge: 'j1', key: 'k1', answer: { outcome: 'pass', reasoning: 'r' } },
    { judge: 'j1', key: 'k2', answer: { outcome: 'fail', reasoning: 'r' } },
    { judge: 'j2', key: 'k1', answer: { outcome: 'pass', reasoning: 'r' } },
  ],
};

function cassette(): BankItem[] {
  const L = 'cassette';
  return [
    item(L, 'stats', 1, CAS, (api) => {
      const r = call(api, 'cassetteStats', CASSETTE);
      const want = { entries: 3, judges: { j1: 2, j2: 1 } };
      return expect('cassetteStats', r, same({ entries: r?.entries, judges: r?.judges }, want), want);
    }),
    item(L, 'unused-entries', 1, CAS, (api) => {
      const r = call(api, 'unusedEntries', CASSETTE, ['k1']);
      const want = [CASSETTE.entries[1]];
      return expect('unusedEntries', r, same(r, want), want);
    }),
    item(L, 'diff', 2, CAS, (api) => {
      const b = {
        ...CASSETTE,
        entries: [
          { judge: 'j1', key: 'k1', answer: { outcome: 'fail', reasoning: 'r' } },
          { judge: 'j2', key: 'k1', answer: { outcome: 'pass', reasoning: 'r' } },
          { judge: 'j2', key: 'k3', answer: { outcome: 'pass', reasoning: 'r' } },
        ],
      };
      const r = call(api, 'diffCassettes', CASSETTE, b);
      const want = { added: ['k3'], removed: ['k2'], changed: ['k1'] };
      return expect(
        'diffCassettes',
        r,
        same({ added: r?.added, removed: r?.removed, changed: r?.changed }, want),
        want,
      );
    }),
    item(L, 'jsonl-round-trip', 2, CAS, (api) => {
      const text = call(api, 'cassetteToJsonl', CASSETTE);
      const lines = typeof text === 'string' ? text.trim().split('\n') : [];
      const back = call(api, 'cassetteFromJsonl', text);
      const ok =
        lines.length === 3 &&
        same(back?.entries, CASSETTE.entries) &&
        same([...(back?.judges ?? [])].sort(), ['j1', 'j2']);
      return ok ? undefined : `cassette JSONL: observed ${show({ lines: lines.length, back })}`;
    }),
  ];
}

function criteria(): BankItem[] {
  const L = 'criteria';
  return [
    item(L, 'name-problem', 1, CRI, (api) => {
      const r = ['care_redirect', 'CareRedirect', 'care__redirect', '1care', 'care-redirect'].map((n) =>
        call(api, 'criterionNameProblem', n) === undefined ? 'ok' : 'problem',
      );
      const want = ['ok', 'problem', 'problem', 'problem', 'problem'];
      return expect('criterionNameProblem', r, same(r, want), want);
    }),
    item(L, 'duplicate-names', 1, CRI, (api) => {
      const r = call(api, 'duplicateCriteria', [
        { name: 'b' },
        { name: 'a' },
        { name: 'b' },
        { name: 'a' },
        { name: 'c' },
        { name: 'b' },
      ]);
      return expect('duplicateCriteria', r, same(r, ['a', 'b']), ['a', 'b']);
    }),
    item(L, 'hash', 1, CRI, (api) => {
      const c = { name: 'care_redirect', rubric: 'A billing issue goes to Acme Care.' };
      const want = createHash('sha256').update(`${c.name}\n${c.rubric}`).digest('hex');
      const r = call(api, 'criterionHash', c);
      return expect('criterionHash', r, r === want, want);
    }),
    item(L, 'word-count', 1, CRI, (api) => {
      const r = [
        call(api, 'rubricWordCount', '  A billing\tissue\ngoes  to Acme Care. '),
        call(api, 'rubricWordCount', ''),
      ];
      return expect('rubricWordCount', r, same(r, [7, 0]), [7, 0]);
    }),
    item(L, 'coverage', 1, CRI, (api) => {
      const r = call(
        api,
        'uncoveredCriteria',
        [{ name: 'c' }, { name: 'a' }, { name: 'b' }],
        [{ criterion: 'a' }],
      );
      return expect('uncoveredCriteria', r, same(r, ['c', 'b']), ['c', 'b']);
    }),
  ];
}

function budget(): BankItem[] {
  const L = 'budget';
  return [
    item(L, 'cost-of-usage', 1, BUD, (api) => {
      const r = call(api, 'costOf', { input: 12000, output: 800 }, { input: 3, output: 15 });
      return expect('costOf', r, near(r, 0.048), 0.048);
    }),
    item(L, 'total-cost', 1, BUD, (api) => {
      const r = call(api, 'totalCost', [0.1, 0.2, 0.0000004]);
      return expect('totalCost', r, r === 0.3, 0.3);
    }),
    item(L, 'guard', 2, BUD, (api) => {
      const g = call(api, 'budgetGuard', 1);
      g?.spend?.(0.6);
      const over = throwsRange(() => g.spend(0.5));
      const after = g?.spent;
      g?.spend?.(0.4);
      return expect(
        'budgetGuard',
        { over, after, end: g?.spent },
        over && near(after, 0.6) && near(g?.spent, 1),
        {
          over: true,
          after: 0.6,
          end: 1,
        },
      );
    }),
    item(L, 'estimate-tokens', 1, BUD, (api) => {
      const r = [call(api, 'estimateTokens', 'abcdefghi'), call(api, 'estimateTokens', '')];
      return expect('estimateTokens', r, same(r, [3, 0]), [3, 0]);
    }),
    item(L, 'retry-delays', 1, BUD, (api) => {
      const r = call(api, 'retryDelays', 5, 100, 1000);
      return expect('retryDelays', r, same(r, [100, 200, 400, 800, 1000]), [100, 200, 400, 800, 1000]);
    }),
    item(L, 'retry-after', 3, BUD, (api) => {
      const now = Date.UTC(2026, 9, 12, 8, 0, 0);
      const r = [
        call(api, 'retryAfterMs', '7', now),
        call(api, 'retryAfterMs', 'Mon, 12 Oct 2026 08:00:30 GMT', now),
        call(api, 'retryAfterMs', 'Mon, 12 Oct 2026 07:00:00 GMT', now),
        call(api, 'retryAfterMs', 'soon', now),
      ];
      return expect('retryAfterMs', r, same(r, [7000, 30000, 0, undefined]), [7000, 30000, 0, undefined]);
    }),
  ];
}

function council(): BankItem[] {
  const L = 'council';
  return [
    item(L, 'unanimity', 1, COU, (api) => {
      const r = [
        call(api, 'unanimity', VOTES),
        call(
          api,
          'unanimity',
          VOTES.filter((v) => v.outcome === 'pass'),
        ),
        call(api, 'unanimity', [{ judge: 'j', outcome: 'inconclusive' }]),
      ];
      return expect('unanimity', r, same(r, ['inconclusive', 'pass', 'inconclusive']), [
        'inconclusive',
        'pass',
        'inconclusive',
      ]);
    }),
    item(L, 'supermajority', 2, COU, (api) => {
      const r = [call(api, 'supermajority', VOTES, 0.75), call(api, 'supermajority', VOTES, 0.8)];
      return expect('supermajority', r, same(r, ['pass', 'inconclusive']), ['pass', 'inconclusive']);
    }),
    item(L, 'dissent', 1, COU, (api) => {
      const r = call(api, 'dissent', [...VOTES].reverse(), 'pass');
      return expect('dissent', r, same(r, ['j3']), ['j3']);
    }),
    item(L, 'median-score', 2, COU, (api) => {
      const r = [
        call(api, 'medianScore', VOTES),
        call(api, 'medianScore', [{ judge: 'j', outcome: 'pass' }]),
      ];
      return expect('medianScore', r, near(r[0], 0.75) && r[1] === undefined, [0.75, undefined]);
    }),
    item(L, 'trimmed-mean', 2, COU, (api) => {
      const votes = [0.1, 0.5, 0.6, 0.7, 0.9].map((score, i) => ({ judge: `j${i}`, outcome: 'pass', score }));
      const r = call(api, 'trimmedMeanScore', votes, 0.2);
      return expect('trimmedMeanScore', r, near(r, 0.6), 0.6);
    }),
    item(L, 'cost', 1, COU, (api) => {
      const r = call(api, 'councilCost', VOTES, { j1: 0.01, j2: 0.02, j3: 0.5 });
      return expect('councilCost', r, near(r, 0.53), 0.53);
    }),
  ];
}

function pairwise(): BankItem[] {
  const L = 'pairwise';
  return [
    item(L, 'win-rate', 1, PAI, (api) => {
      const r = call(api, 'winRate', PAIRS, 'x');
      return expect('winRate of x', r, near(r, 0.625), 0.625);
    }),
    item(L, 'win-matrix', 2, PAI, (api) => {
      const m = call(api, 'winMatrix', PAIRS);
      const got = [m?.x?.y ?? 0, m?.y?.x ?? 0, m?.z?.x ?? 0, m?.z?.y ?? 0, m?.x?.z ?? 0];
      return expect('winMatrix [x>y, y>x, z>x, z>y, x>z]', got, same(got, [2, 0, 1, 1, 0]), [2, 0, 1, 1, 0]);
    }),
    item(L, 'copeland', 3, PAI, (api) => {
      const r = call(api, 'copelandRanking', PAIRS);
      return expect('copelandRanking', r, same(r, ['z', 'x', 'y']), ['z', 'x', 'y']);
    }),
    item(L, 'borda', 2, PAI, (api) => {
      const r = call(api, 'bordaRanking', [
        ['a', 'b', 'c'],
        ['b', 'a', 'c'],
        ['c', 'b', 'a'],
      ]);
      return expect('bordaRanking', r, same(r, ['b', 'a', 'c']), ['b', 'a', 'c']);
    }),
    item(L, 'swap-consistent', 1, PAI, (api) => {
      const r = [
        call(api, 'swapConsistent', 'a', 'b'),
        call(api, 'swapConsistent', 'a', 'a'),
        call(api, 'swapConsistent', 'tie', 'tie'),
      ];
      return expect('swapConsistent', r, same(r, [true, false, true]), [true, false, true]);
    }),
  ];
}

function turns(): BankItem[] {
  const L = 'turns';
  return [
    item(L, 'pairs', 2, TUR, (api) => {
      const r = call(api, 'turnPairs', TRANSCRIPT);
      const want = [
        { user: 'My bill is wrong.', agent: 'Sorry to hear that. Acme Care can help.' },
        { user: 'Thanks.', agent: 'You are welcome.' },
      ];
      return expect('turnPairs', r, same(r, want), want);
    }),
    item(L, 'last-agent', 1, TUR, (api) => {
      const r = [
        call(api, 'lastAgentTurn', TRANSCRIPT),
        call(api, 'lastAgentTurn', [{ role: 'user', text: 'x' }]),
      ];
      return expect('lastAgentTurn', r, same(r, [4, -1]), [4, -1]);
    }),
    item(L, 'first-match', 1, TUR, (api) => {
      const r = [
        call(api, 'firstTurnMatching', TRANSCRIPT, /acme/i),
        call(api, 'firstTurnMatching', TRANSCRIPT, /refund/),
      ];
      return expect('firstTurnMatching', r, same(r, [2, -1]), [2, -1]);
    }),
    item(L, 'recovery-rate', 2, TUR, (api) => {
      const r = [
        call(api, 'recoveryRate', ['pass', 'fail', 'pass', 'fail', 'pass', 'pass']),
        call(api, 'recoveryRate', ['pass', 'pass']),
        call(api, 'recoveryRate', ['pass', 'fail']),
      ];
      return expect('recoveryRate', r, near(r[0], 0.75) && r[1] === undefined && r[2] === undefined, [
        0.75,
        undefined,
        undefined,
      ]);
    }),
  ];
}

function evidence(): BankItem[] {
  const L = 'evidence';
  return [
    item(L, 'quote-span', 1, EVI, (api) => {
      const r = [call(api, 'quoteSpan', 'call Acme Care now', 'Acme Care'), call(api, 'quoteSpan', 'x', 'y')];
      return expect('quoteSpan', r, same(r, [{ start: 5, end: 14 }, undefined]), [
        { start: 5, end: 14 },
        undefined,
      ]);
    }),
    item(L, 'loose-quote', 2, EVI, (api) => {
      const r = [
        call(api, 'findQuoteLoosely', 'Please call   ACME care\nnow', 'acme Care now'),
        call(api, 'findQuoteLoosely', 'call Acme', 'Acme Care'),
      ];
      return expect('findQuoteLoosely', r, same(r, [true, false]), [true, false]);
    }),
    item(L, 'highlight', 1, EVI, (api) => {
      const r = call(api, 'highlightEvidence', 'Acme Care, then Acme Care.', 'Acme Care');
      const want = '«Acme Care», then «Acme Care».';
      return expect('highlightEvidence', r, r === want, want);
    }),
    item(L, 'levenshtein', 2, EVI, (api) => {
      const r = [
        call(api, 'levenshtein', 'kitten sitting', 'sitting kitten'),
        call(api, 'levenshtein', '', 'abc'),
      ];
      return expect('levenshtein', r, same(r, [6, 3]), [6, 3]);
    }),
    item(L, 'jaccard', 1, EVI, (api) => {
      const r = call(
        api,
        'jaccardWords',
        'the agent routed the bill to acme care',
        'acme care got the bill from the agent',
      );
      return expect('jaccardWords', r, near(r, 5 / 9), 5 / 9);
    }),
  ];
}

function clients(): BankItem[] {
  const L = 'clients';
  return [
    item(L, 'mask-headers', 2, CLI, (api) => {
      const h = {
        Authorization: 'Bearer abcdef123456',
        'x-api-key': 'key-9876',
        'content-type': 'application/json',
      };
      const r = call(api, 'maskHeaders', h);
      const want = { Authorization: '****3456', 'x-api-key': '****9876', 'content-type': 'application/json' };
      return expect('maskHeaders', r, same(r, want) && h.Authorization === 'Bearer abcdef123456', want);
    }),
    item(L, 'usage-from-openai', 1, CLI, (api) => {
      const r = call(api, 'usageFromResponse', 'openai', {
        usage: { prompt_tokens: 120, completion_tokens: 30 },
      });
      return expect(
        'usageFromResponse openai',
        r,
        same({ input: r?.input, output: r?.output }, { input: 120, output: 30 }),
        { input: 120, output: 30 },
      );
    }),
    item(L, 'usage-from-anthropic', 2, CLI, (api) => {
      const r = call(api, 'usageFromResponse', 'anthropic', {
        usage: { input_tokens: 90, output_tokens: 12 },
      });
      return expect(
        'usageFromResponse anthropic',
        r,
        same({ input: r?.input, output: r?.output }, { input: 90, output: 12 }),
        { input: 90, output: 12 },
      );
    }),
    item(L, 'usage-from-google', 2, CLI, (api) => {
      const r = call(api, 'usageFromResponse', 'google', {
        usageMetadata: { promptTokenCount: 70, candidatesTokenCount: 9 },
      });
      return expect(
        'usageFromResponse google',
        r,
        same({ input: r?.input, output: r?.output }, { input: 70, output: 9 }),
        { input: 70, output: 9 },
      );
    }),
  ];
}

function scale(): BankItem[] {
  return [
    item('scale', 'chunk-transcript', 2, PRO, (api) => {
      const t = [
        { role: 'user', text: 'aaaa' },
        { role: 'agent', text: 'bbbbbb' },
        { role: 'user', text: 'cc' },
        { role: 'agent', text: 'dddddddddddd' },
        { role: 'user', text: 'e' },
      ];
      const r = call(api, 'chunkTranscript', t, 10);
      const want = [[t[0], t[1]], [t[2]], [t[3]], [t[4]]];
      return expect('chunkTranscript', r, same(r, want), want);
    }),
  ];
}

/** The items of this file, placed in the levels of their components. */
export function moreItems(): BankItem[] {
  return [
    ...calibration(),
    ...contract(),
    ...render(),
    ...cassette(),
    ...criteria(),
    ...budget(),
    ...council(),
    ...pairwise(),
    ...turns(),
    ...evidence(),
    ...clients(),
    ...scale(),
  ];
}
