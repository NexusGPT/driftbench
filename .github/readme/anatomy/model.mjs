// The figure's own model. Every number the anatomy figure shows comes from here: the campaign it runs,
// the verdict of every check and judge, the drift trace, the recovery count, the interval on the dial and
// the gate. It is pure and seeded, so the build, the page and the captures all see the same campaign.
// The agent is fictional (an Acme Telecom assistant); its competences are chosen to tell the story, and
// the statistics are the real formulas from docs/concepts/statistics.md.

export const CHECKS = ['tools', 'text', 'language', 'stage', 'guards', 'skills', 'artifacts', 'workspace', 'safety'];

export const SPECS = {
  conversation: {
    id: 'acme-plan-upgrade',
    kind: 'conversation',
    blocks: [
      { id: 'b1', stage: 'identify', checks: ['tools', 'text', 'language', 'stage'], criterion: ['one_question', 'system1'], local: 0.995, hazard: 0 },
      { id: 'b2', stage: 'offer', checks: ['tools', 'text', 'language', 'stage'], criterion: ['no_invented_data', 'system2'], local: 0.99, hazard: 0.02 },
      { id: 'b3', stage: 'choose', checks: ['tools', 'text', 'language', 'stage'], criterion: ['one_question', 'system1'], local: 0.99, hazard: 0.03 },
      { id: 'b4', stage: 'recap', checks: ['tools', 'text', 'language', 'stage'], criterion: ['no_invented_data', 'system2'], local: 0.985, hazard: 0.16 },
      { id: 'b5', stage: 'order_placed', checks: ['tools', 'text', 'language', 'stage', 'guards', 'safety'], criterion: ['no_invented_data', 'system2'], local: 0.99, hazard: 0.07 },
    ],
    deviation: { at: 2, cls: 'D2_goal_shift', within: 2 },
  },
  task: {
    id: 'acme-price-sheet',
    kind: 'task',
    blocks: [
      { id: 's1', stage: 'load', checks: ['guards', 'skills', 'artifacts', 'workspace', 'safety'], criterion: ['reads_files_first', 'system1'], local: 0.99, hazard: 0.02 },
      { id: 's2', stage: 'build', checks: ['stage', 'skills', 'artifacts', 'workspace', 'safety'], criterion: ['totals_match_file', 'system2'], local: 0.985, hazard: 0.05 },
      { id: 's3', stage: 'summary', checks: ['text', 'stage', 'artifacts', 'workspace', 'safety'], criterion: ['totals_match_file', 'system2'], local: 0.99, hazard: 0.14 },
    ],
    deviation: { at: 1, cls: 'D6_instruction_in_data', within: 1 },
  },
};

export const MODES = ['T', 'F', 'P'];
export const MODE_NAMES = { T: 'teacher forced', F: 'free running', P: 'perturbed' };
export const RUNS = 10;
export const K = 3;
export const Z = 1.96;
export const BASELINE = 0.85;
export const MARGIN = 0.15;
export const THRESHOLD = Math.round((BASELINE - MARGIN) * 100) / 100;
export const SEED = 20261029;
export const CYCLE = ['conversation', 'task'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function wilson(k, n, z = Z) {
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let out = 1;
  for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i;
  return out;
}

export const passK = (c, n, k = K) => (n < k ? null : choose(c, k) / choose(n, k));

// One run of one spec in one mode. Returns every block's verdicts, its drift class and its offset from the
// expected path (the chart pen), and, in P mode, the recovery record.
export function runOf(mode, run, seed = SEED) {
  const specName = CYCLE[run % CYCLE.length];
  const spec = SPECS[specName];
  const random = mulberry32(seed + MODES.indexOf(mode) * 7919 + run * 104729);
  const blocks = [];
  let failedBefore = false;
  let recovery = null;
  const injectAt = mode === 'P' ? spec.deviation.at : -1;
  if (mode === 'P') {
    const u = random();
    const immediate = spec.kind === 'conversation' ? 0.45 : 0.75;
    const lateShare = spec.kind === 'conversation' ? 0.4 : 0.15;
    if (u < immediate) recovery = { label: 'immediate', turnsToRecover: 0 };
    else if (u < immediate + lateShare) recovery = { label: 'late', turnsToRecover: spec.deviation.within };
    else recovery = { label: 'never', turnsToRecover: null };
    recovery.injectedAt = injectAt;
    recovery.cls = spec.deviation.cls;
  }
  spec.blocks.forEach((block, index) => {
    const checks = Object.fromEntries(block.checks.map((name) => [name, true]));
    let drift = null;
    let offset = 0;
    let judged = null;
    let competence = block.local;
    if (mode !== 'T') competence *= 0.985 ** index * (1 - block.hazard);
    if (failedBefore && mode !== 'T') competence *= 0.6;
    const injected = index === injectAt;
    if (mode === 'P' && index >= injectAt) {
      if (recovery.label === 'late' && index < injectAt + recovery.turnsToRecover) {
        drift = index === injectAt ? (spec.kind === 'conversation' ? 'X3_flow' : 'X5_tool') : 'X2_contradiction';
      } else if (recovery.label === 'never') {
        drift = index === injectAt ? (spec.kind === 'conversation' ? 'X3_flow' : 'X5_tool') : 'X2_contradiction';
      }
    }
    if (!drift && random() > competence) {
      const kinds = spec.kind === 'conversation' ? ['X3_flow', 'X2_contradiction', 'X5_tool', 'X1_local'] : ['X5_tool', 'X1_local', 'X3_flow'];
      drift = kinds[Math.floor(random() * kinds.length)];
    } else random();
    const [criterion, cls] = block.criterion;
    // Machine checks first: a drift class that a machine check sees fails its pin, and the judges never vote.
    if (drift === 'X5_tool') checks[spec.kind === 'conversation' ? 'tools' : block.checks.includes('safety') && injected ? 'safety' : 'skills'] = false;
    if (drift === 'X3_flow' && checks.stage !== undefined) checks.stage = false;
    if (drift === 'X3_flow' && checks.stage === undefined) checks.workspace = false;
    const machinePass = Object.values(checks).every(Boolean);
    if (machinePass) {
      const fails = drift === 'X2_contradiction' || drift === 'X1_local';
      const split = !fails && random() < 0.08;
      const votes = split ? ['pass', 'fail', 'inconclusive'] : fails ? ['fail', 'fail', random() < 0.3 ? 'pass' : 'fail'] : ['pass', 'pass', random() < 0.12 ? 'inconclusive' : 'pass'];
      const other = cls === 'system1' ? 'system2' : 'system1';
      judged = split
        ? { criterion, cls, votes, split: true, by: other, final: ['pass', 'pass', 'pass'], verdict: 'pass' }
        : { criterion, cls, votes, split: false, by: cls, final: votes, verdict: fails ? 'fail' : 'pass' };
    } else random();
    const pass = machinePass && judged.verdict === 'pass';
    if (!pass) {
      offset = drift === 'X3_flow' ? 1 : drift === 'X2_contradiction' ? 0.55 : drift === 'X5_tool' ? 0.8 : 0.35;
      failedBefore = true;
    }
    if (mode === 'P' && recovery.label === 'never' && index > injectAt) offset = Math.max(offset, 0.7);
    blocks.push({ id: block.id, stage: block.stage, kind: spec.kind, checks, machinePass, judged, drift, offset, injected, pass });
  });
  if (recovery) {
    const after = blocks.slice(injectAt);
    const back = after.findIndex((b) => b.pass);
    if (recovery.label !== 'never' && back >= 0) {
      recovery.turnsToRecover = back;
      recovery.label = back === 0 ? 'immediate' : 'late';
      recovery.collateral = after.slice(back + 1).filter((b) => !b.pass).length;
    } else {
      recovery.label = 'never';
      recovery.turnsToRecover = null;
      recovery.collateral = 0;
    }
    recovery.recovered = recovery.label !== 'never' && recovery.turnsToRecover <= SPECS[specName].deviation.within;
  }
  const firstDrift = blocks.findIndex((b) => !b.pass);
  return {
    mode,
    run,
    spec: spec.id,
    kind: spec.kind,
    blocks,
    pass: blocks.every((b) => b.pass),
    succession: {
      firstDriftBlock: firstDrift < 0 ? null : firstDrift,
      driftCount: blocks.filter((b) => !b.pass).length,
      driftRate: blocks.filter((b) => !b.pass).length / blocks.length,
    },
    recovery,
  };
}

export const campaignOf = (mode, seed = SEED) => Array.from({ length: RUNS }, (_, run) => runOf(mode, run, seed));

// The coverage space of the generated suite: five flows by the ten deviation classes. A cell is covered
// when a generated block exercises that flow under that deviation. The generator leaves some cells empty,
// and the gauge shows where.
export const FLOWS = 5;
export const CLASSES = 10;
export const COVERAGE = (() => {
  const random = mulberry32(SEED + 31);
  const cells = Array.from({ length: FLOWS * CLASSES }, () => random() < 0.78);
  return { flows: FLOWS, classes: CLASSES, cells, covered: cells.filter(Boolean).length };
})();
export const CANDIDATES = { generated: 14, rejected: 3, reasons: ['leaked an expected value', 'a constant reply passed it', 'a one slot edit left the Then unchanged'] };

// The campaign statistics after `done` runs: the pass rate with its Wilson interval, pass^k, the
// recovery count, and the gate once the planned runs are in. The gate is the noninferiority verdict
// against a fixed baseline: the upper bound of the regression (baseline minus the candidate's lower
// bound) must stay under the margin.
export function statsOf(runs, done = runs.length) {
  const seen = runs.slice(0, done);
  const n = seen.length;
  const c = seen.filter((r) => r.pass).length;
  const [lo, hi] = wilson(c, n);
  const injected = seen.filter((r) => r.recovery);
  const recovered = injected.filter((r) => r.recovery.recovered).length;
  const regressionUpper = BASELINE - lo;
  const decided = n >= RUNS;
  return {
    n,
    c,
    rate: n ? c / n : null,
    lo,
    hi,
    passK: passK(c, n, K),
    injected: injected.length,
    recovered,
    regressionUpper,
    gate: decided ? (regressionUpper < MARGIN ? 'pass' : 'hold') : 'pending',
  };
}

export const fixed = (value, digits = 2) => (value === null || value === undefined ? 'n/a' : value.toFixed(digits));
