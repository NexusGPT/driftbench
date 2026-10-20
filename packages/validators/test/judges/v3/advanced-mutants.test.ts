import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LabelSet } from '@agent-nexus/driftbench-judges';
import * as judges from '@agent-nexus/driftbench-judges';
import * as stats from '@agent-nexus/driftbench-stats';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as base from '../../../../judges/src/labeller';
import type * as analysis from '../../../../judges/src/labeller-analysis';
import * as basics from '../../../../stats/src/basics';
import { judgesV3Bank } from '../../../src/ladders/judges/v3';

/** One semantic defect at a time in an isolated copy; never write production. */
type Subject = typeof analysis;
type ExportName = keyof Subject;
type Edit = { from: string; to: string };
type Mutation = {
  name: string;
  capability: string;
  target: 'analysis' | 'agreement';
  exportName: ExportName;
  edits: Edit[];
  witness(subject: Subject): void;
};
const namedSet = (names: string[]): LabelSet => ({
  name: 'independent synthetic categories',
  labels: names.map((name) => ({ name, description: `Synthetic class ${name}.` })),
});
const binary = namedSet(['a', 'b']);
const ternary = namedSet(['a', 'b', 'c']);

// Contingency counts [[8,2],[1,5]]: k=19/31, V=586608/923521.
// These rational expectations are fixed at authoring; no scorer computes them.
const ciGold = [...Array<string>(10).fill('a'), ...Array<string>(6).fill('b')];
const ciAnswers = [...Array<string>(8).fill('a'), 'b', 'b', 'a', ...Array<string>(5).fill('b')];
function ciWitness(subject: Subject) {
  const got = subject.labellerKappaInterval(ciGold, ciAnswers, binary, 0.9);
  const variance = 586608 / 923521;
  const se = Math.sqrt(variance / 16);
  expect(got.estimate).toBeCloseTo(19 / 31, 10);
  expect(got.varianceFactor).toBeCloseTo(variance, 10);
  expect(got.standardError).toBeCloseTo(se, 10);
  expect(got.lower).toBeCloseTo(19 / 31 - 1.6448536269514722 * se, 7);
  expect(got.upper).toBeCloseTo(19 / 31 + 1.6448536269514722 * se, 7);
  expect(got.status).toBe('estimated');
}
function pabakWitness(subject: Subject) {
  expect(subject.binaryLabellerPabak(['a', 'a', 'a', 'b'], ['a', 'a', 'b', 'b'], ['a', 'b'])).toEqual({
    total: 4,
    agreement: 0.75,
    pabak: 0.5,
  });
}
function ordinalWitness(subject: Subject) {
  // Declared positions c=0,a=1,b=2; linear D_o=3/8,D_e=7/16.
  const gold = ['c', 'a', 'b', 'b'];
  const answers = ['a', 'a', 'c', 'b'];
  const linear = subject.weightedLabellerKappa(gold, answers, ['c', 'a', 'b'], 'linear');
  expect(linear.kappa).toBeCloseTo(1 / 7, 12);
  expect(linear.observed).toBeCloseTo(5 / 8, 12);
  expect(linear.expected).toBeCloseTo(9 / 16, 12);
  const quadratic = subject.weightedLabellerKappa(gold, answers, ['c', 'a', 'b'], 'quadratic');
  expect(quadratic.kappa).toBeCloseTo(0, 12);
  expect(quadratic.observed).toBeCloseTo(11 / 16, 12);
  expect(quadratic.expected).toBeCloseTo(11 / 16, 12);
  // One c-to-a error: D_o=1/3, D_e=7/9 in declared order c,a,b.
  // Lexical sorting makes D_o=2/3 and D_e=8/9, so this case detects order loss.
  const asymmetric = subject.weightedLabellerKappa(
    ['c', 'a', 'b'],
    ['a', 'a', 'b'],
    ['c', 'a', 'b'],
    'linear',
  );
  expect(asymmetric.kappa).toBeCloseTo(4 / 7, 12);
  expect(asymmetric.observed).toBeCloseTo(5 / 6, 12);
  expect(asymmetric.expected).toBeCloseTo(11 / 18, 12);
}
function alphaWitness(subject: Subject) {
  // Three pairable units contribute counts a=3,b=4 and 4 disagreements.
  // The final c is a singleton: seven pairable values, four missing cells.
  const got = subject.labellerNominalAlpha(
    [
      ['a', 'a', 'b', 'c'],
      ['b', null, 'b', null],
      ['a', 'b', null, null],
    ],
    ternary,
  );
  expect(got).toMatchObject({
    alpha: 0,
    pairable: 7,
    units: 4,
    raters: 3,
    missing: 4,
    unpairableUnits: 1,
    status: 'estimated',
  });
  expect(got.observed).toBeCloseTo(4 / 7, 12);
  expect(got.expected).toBeCloseTo(4 / 7, 12);
}
function confusionWitness(subject: Subject) {
  const got = subject
    .labellerConfusion(
      [...Array<string>(9).fill('a'), 'b'],
      [...Array<string>(8).fill('a'), 'b', 'b'],
      binary,
    )
    .byLabel.find((row) => row.label === 'b');
  expect(got).toMatchObject({ support: 1, predicted: 2, tp: 1, fp: 1, fn: 0, precision: 0.5, recall: 1 });
  expect(got?.f1).toBeCloseTo(2 / 3, 12);
}
const selective = [
  { gold: 'a', answer: 'a', confidence: 0.5 },
  { gold: 'b', answer: 'a', confidence: 0.9 },
  { gold: 'b', answer: 'b', confidence: 0.4 },
  { gold: 'none', answer: 'none', confidence: 0.7 },
  { gold: 'a', answer: null, confidence: 1 },
  { gold: 'a', answer: '', confidence: 1 },
];
function coverageWitness(subject: Subject) {
  const got = subject.labellerCoverageCurve(selective, binary, [0.5])[0];
  expect(got).toMatchObject({
    total: 6,
    accepted: 3,
    correct: 2,
    coverage: 0.5,
    abstentions: 1,
    invalid: 1,
    belowThreshold: 1,
  });
  expect(got?.acceptedAccuracy).toBeCloseTo(2 / 3, 12);
}
function selectionWitness(subject: Subject) {
  const observations = [
    { gold: 'a', answer: 'a', confidence: 0.9 },
    { gold: 'b', answer: 'b', confidence: 0.8 },
    { gold: 'a', answer: 'b', confidence: 0.6 },
    { gold: 'b', answer: 'a', confidence: 0.2 },
  ];
  const got = subject.selectLabellerThreshold(observations, binary, {
    thresholds: [0.9, 0.8, 0.7, 0.5, 0],
    minAccuracy: 0.75,
  });
  expect(got).toMatchObject({ threshold: 0.7, coverage: 0.5, accepted: 2, acceptedAccuracy: 1 });
}
function mappingOptions(): analysis.LabellerMappingOptions {
  return {
    goldSet: namedSet(['old-a', 'old-b']),
    answerSet: namedSet(['new-a', 'new-b']),
    targetSet: binary,
    goldMap: [
      { source: 'old-a', target: 'a' },
      { source: 'old-b', target: 'b' },
      { source: 'none', target: 'none' },
    ],
    answerMap: [
      { source: 'new-a', target: 'a' },
      { source: 'new-b', target: 'b' },
      { source: 'none', target: 'none' },
    ],
  };
}
function renameWitness(subject: Subject) {
  expect(
    subject.scoreMappedLabeller(['old-a', 'old-b', 'none'], ['new-a', 'new-b', 'none'], mappingOptions()),
  ).toMatchObject({ total: 3, correct: 3, agreement: 1, kappa: 1, invalid: 0 });
}
function splitWitness(subject: Subject) {
  const options = mappingOptions();
  options.answerSet = namedSet(['child-1', 'child-2', 'new-b']);
  options.answerMap = [
    { source: 'child-1', target: 'a' },
    { source: 'child-2', target: 'a' },
    { source: 'new-b', target: 'b' },
    { source: 'none', target: 'none' },
  ];
  expect(
    subject.scoreMappedLabeller(['old-a', 'old-a', 'old-b'], ['child-1', 'child-2', 'new-b'], options),
  ).toMatchObject({ total: 3, correct: 3, agreement: 1, kappa: 1 });
}
function mappingUnknownWitness(subject: Subject) {
  expect(
    subject.scoreMappedLabeller(['old-a', 'old-b', 'old-a'], ['a', null, 'new-a'], mappingOptions()),
  ).toMatchObject({ total: 3, correct: 1, invalid: 1, abstentions: 1, agreement: 1 / 3 });
}
function sampleWitness(subject: Subject) {
  // Fixed joint with k=4/7,V=2304/2401; ceil(z90²*V/.08²)=406.
  const joint = [
    [0.7, 0.1],
    [0.05, 0.15],
  ];
  const got = subject.planLabellerKappaSample(joint, { margin: 0.08, confidence: 0.9 });
  expect(got.sampleSize).toBe(406);
  expect(got.kappa).toBeCloseTo(4 / 7, 10);
  expect(got.varianceFactor).toBeCloseTo(2304 / 2401, 10);
  expect(got).toMatchObject({ margin: 0.08, confidence: 0.9, assumption: 'iid-fixed-joint' });
  expect(subject.planLabellerKappaSample(joint, { margin: 0.08, confidence: 0.95 }).sampleSize).toBe(576);
}
function exactTiesWitness(subject: Subject) {
  // Six unique arrangements of a,a,b,b; only the original is as positive.
  expect(
    subject.exactLabellerKappaTest(['a', 'a', 'b', 'b'], ['a', 'a', 'b', 'b'], binary, 'greater'),
  ).toMatchObject({ kappa: 1, pValue: 1 / 6, permutations: 6, extreme: 1 });
}
function exactTwoSidedWitness(subject: Subject) {
  // Both perfect alignment and complete reversal have |k|=1.
  expect(
    subject.exactLabellerKappaTest(['a', 'a', 'b', 'b'], ['a', 'a', 'b', 'b'], binary, 'two-sided'),
  ).toMatchObject({ kappa: 1, pValue: 1 / 3, permutations: 6, extreme: 2 });
}
function exactNullWitness(subject: Subject) {
  expect(subject.exactLabellerKappaTest(['a', 'b', 'a'], [null, 'b', 'a'], binary, 'greater')).toMatchObject({
    kappa: 0.5,
    pValue: 1 / 3,
    permutations: 6,
    extreme: 2,
  });
}

const mutations: Mutation[] = [
  {
    name: 'CI gradient omits row-marginal coupling',
    capability: 'CI',
    target: 'analysis',
    exportName: 'labellerKappaInterval',
    edits: [{ from: '((columns[i] as number) + (rows[j] as number))', to: '(columns[i] as number)' }],
    witness: ciWitness,
  },
  {
    name: 'CI standard-error variance divided by n squared',
    capability: 'CI',
    target: 'analysis',
    exportName: 'labellerKappaInterval',
    edits: [
      {
        from: 'Math.sqrt(varianceFactor / score.total)',
        to: 'Math.sqrt(varianceFactor / (score.total * score.total))',
      },
    ],
    witness: ciWitness,
  },
  {
    name: 'CI joint counts normalized by n squared',
    capability: 'CI',
    target: 'analysis',
    exportName: 'labellerKappaInterval',
    edits: [
      {
        from: 'row[j] = (row[j] as number) / score.total',
        to: 'row[j] = (row[j] as number) / (score.total * score.total)',
      },
    ],
    witness: ciWitness,
  },
  {
    name: 'PABAK returns raw agreement without binary adjustment',
    capability: 'PABAK',
    target: 'analysis',
    exportName: 'binaryLabellerPabak',
    edits: [{ from: 'pabak: 2 * agreement - 1', to: 'pabak: agreement' }],
    witness: pabakWitness,
  },
  {
    name: 'PABAK accepts missing observations in binary domain',
    capability: 'PABAK',
    target: 'analysis',
    exportName: 'binaryLabellerPabak',
    edits: [
      {
        from: 'const valid = strictPairs(gold, answers, explicitCategories(categories, 2));',
        to: 'explicitCategories(categories, 2); const valid = answers;',
      },
    ],
    witness(subject) {
      expect(() => subject.binaryLabellerPabak(['a', 'b'], ['a', null], ['a', 'b'])).toThrow();
      pabakWitness(subject);
    },
  },
  {
    name: 'weighted kappa swaps linear and quadratic distances',
    capability: 'weighted',
    target: 'analysis',
    exportName: 'weightedLabellerKappa',
    edits: [
      {
        from: 'cohenKappa(gold, valid, { weights, categories: orderedLabels })',
        to: "cohenKappa(gold, valid, { weights: weights === 'linear' ? 'quadratic' : 'linear', categories: orderedLabels })",
      },
    ],
    witness: ordinalWitness,
  },
  {
    name: 'weighted kappa sorts the explicit ordinal positions',
    capability: 'weighted',
    target: 'analysis',
    exportName: 'weightedLabellerKappa',
    edits: [
      {
        from: 'cohenKappa(gold, valid, { weights, categories: orderedLabels })',
        to: 'cohenKappa(gold, valid, { weights, categories: [...orderedLabels].sort() })',
      },
    ],
    witness: ordinalWitness,
  },
  {
    name: 'weighted agreement omits maximum-distance normalization',
    capability: 'weighted',
    target: 'analysis',
    exportName: 'weightedLabellerKappa',
    edits: [
      {
        from: "const maximumDistance = (orderedLabels.length - 1) ** (weights === 'linear' ? 1 : 2);",
        to: 'const maximumDistance = 1;',
      },
    ],
    witness: ordinalWitness,
  },
  {
    name: 'alpha discards every partly missing unit',
    capability: 'alpha',
    target: 'agreement',
    exportName: 'labellerNominalAlpha',
    edits: [{ from: 'if (vals.length >= 2) {', to: 'if (vals.length === matrix.length) {' }],
    witness: alphaWitness,
  },
  {
    name: 'alpha treats singleton self-pairs as coincidences',
    capability: 'alpha',
    target: 'agreement',
    exportName: 'labellerNominalAlpha',
    // One algorithm defect spans collection and coincidence construction.
    edits: [
      { from: 'if (vals.length >= 2) {', to: 'if (vals.length >= 1) {' },
      {
        from: 'for (const vals of unitValues) {\n    const m = vals.length;',
        to: 'for (const vals of unitValues) {\n    const m = vals.length; if (m === 1) { const c = index.get(vals[0] as Label) as number; (o[c] as number[])[c] += 1; continue; }',
      },
    ],
    witness: alphaWitness,
  },
  {
    name: 'alpha loses finite-population expected-disagreement correction',
    capability: 'alpha',
    target: 'agreement',
    exportName: 'labellerNominalAlpha',
    edits: [
      {
        from: 'const expected = expectedSum / (n * (n - 1));',
        to: 'const expected = expectedSum / (n * n);',
      },
    ],
    witness: alphaWitness,
  },
  {
    name: 'rare-class precision uses gold support denominator',
    capability: 'confusion',
    target: 'analysis',
    exportName: 'labellerConfusion',
    edits: [
      {
        from: 'precision: predicted === 0 ? null : tp / predicted',
        to: 'precision: predicted === 0 ? null : tp / support',
      },
    ],
    witness: confusionWitness,
  },
  {
    name: 'rare-class recall uses predicted-count denominator',
    capability: 'confusion',
    target: 'analysis',
    exportName: 'labellerConfusion',
    edits: [
      {
        from: 'recall: support === 0 ? null : tp / support',
        to: 'recall: support === 0 ? null : tp / predicted',
      },
    ],
    witness: confusionWitness,
  },
  {
    name: 'coverage threshold excludes equality',
    capability: 'coverage',
    target: 'analysis',
    exportName: 'labellerCoverageCurve',
    edits: [
      {
        from: '(observations[i] as ScoredLabellerObservation).confidence >= threshold',
        to: '(observations[i] as ScoredLabellerObservation).confidence > threshold',
      },
    ],
    witness: coverageWitness,
  },
  {
    name: 'accepted accuracy divides by all observations',
    capability: 'coverage',
    target: 'analysis',
    exportName: 'labellerCoverageCurve',
    edits: [
      {
        from: 'acceptedAccuracy: accepted === 0 ? null : correct / accepted',
        to: 'acceptedAccuracy: accepted === 0 ? null : correct / score.total',
      },
    ],
    witness: coverageWitness,
  },
  {
    name: 'coverage denominator drops missing and invalid predictions',
    capability: 'coverage',
    target: 'analysis',
    exportName: 'labellerCoverageCurve',
    edits: [
      {
        from: 'coverage: accepted / score.total',
        to: 'coverage: accepted / (score.total - score.abstentions - score.invalid)',
      },
    ],
    witness: coverageWitness,
  },
  {
    name: 'selector maximizes threshold instead of eligible coverage',
    capability: 'coverage',
    target: 'analysis',
    exportName: 'selectLabellerThreshold',
    edits: [
      {
        from: '(!selected || point.coverage > selected.coverage)',
        to: '(!selected || point.threshold > selected.threshold)',
      },
    ],
    witness: selectionWitness,
  },
  {
    name: 'mapping ignores explicit answer rename',
    capability: 'mapping',
    target: 'analysis',
    exportName: 'scoreMappedLabeller',
    edits: [{ from: "answerMap.get(answer) ?? ''", to: 'answer' }],
    witness: renameWitness,
  },
  {
    name: 'mapping rejects split children sharing a target parent',
    capability: 'mapping',
    target: 'analysis',
    exportName: 'scoreMappedLabeller',
    edits: [
      {
        from: 'map.has(entry.source)',
        to: 'map.has(entry.source) || [...map.values()].includes(entry.target)',
      },
    ],
    witness: splitWitness,
  },
  {
    name: 'mapping accepts unknown source answer as target label',
    capability: 'mapping',
    target: 'analysis',
    exportName: 'scoreMappedLabeller',
    edits: [{ from: "answerMap.get(answer) ?? ''", to: 'answerMap.get(answer) ?? answer' }],
    witness: mappingUnknownWitness,
  },
  {
    name: 'sample precision rounds required size down',
    capability: 'sample',
    target: 'analysis',
    exportName: 'planLabellerKappaSample',
    edits: [
      {
        from: 'Math.ceil((z * z * varianceFactor) / (margin * margin))',
        to: 'Math.floor((z * z * varianceFactor) / (margin * margin))',
      },
    ],
    witness: sampleWitness,
  },
  {
    name: 'sample precision ignores requested confidence',
    capability: 'sample',
    target: 'analysis',
    exportName: 'planLabellerKappaSample',
    edits: [
      {
        from: 'const { margin, confidence = 0.95 } = options;',
        to: 'const { margin } = options; const confidence = 0.95;',
      },
    ],
    witness: sampleWitness,
  },
  {
    name: 'sample precision assumes uniform chance prevalence',
    capability: 'sample',
    target: 'analysis',
    exportName: 'planLabellerKappaSample',
    edits: [
      {
        from: 'const expected = rows.reduce((sum, row, i) => sum + row * (columns[i] as number), 0);',
        to: 'const expected = 1 / size;',
      },
    ],
    witness: sampleWitness,
  },
  {
    name: 'exact greater-tail test excludes tied permutations',
    capability: 'exact',
    target: 'analysis',
    exportName: 'exactLabellerKappaTest',
    edits: [{ from: 'numerator >= observedNumerator', to: 'numerator > observedNumerator' }],
    witness: exactTiesWitness,
  },
  {
    name: 'exact two-sided tail becomes one-sided',
    capability: 'exact',
    target: 'analysis',
    exportName: 'exactLabellerKappaTest',
    edits: [
      { from: 'Math.abs(numerator) >= Math.abs(observedNumerator)', to: 'numerator >= observedNumerator' },
    ],
    witness: exactTwoSidedWitness,
  },
  {
    name: 'exact permutation discards null predictions',
    capability: 'exact',
    target: 'analysis',
    exportName: 'exactLabellerKappaTest',
    edits: [
      {
        from: 'const { score, actual, predicted } = encoded(gold, answers, labelSet);',
        to: 'const kept = answers.map((answer, i) => ({ answer, gold: gold[i] as string })).filter(row => row.answer !== null); gold = kept.map(row => row.gold); answers = kept.map(row => row.answer); const { score, actual, predicted } = encoded(gold, answers, labelSet);',
      },
    ],
    witness: exactNullWitness,
  },
];

const exportsUnderAudit: ExportName[] = [
  'labellerKappaInterval',
  'binaryLabellerPabak',
  'weightedLabellerKappa',
  'labellerNominalAlpha',
  'labellerConfusion',
  'labellerCoverageCurve',
  'selectLabellerThreshold',
  'scoreMappedLabeller',
  'planLabellerKappaSample',
  'exactLabellerKappaTest',
];
const paths = {
  analysis: new URL('../../../../judges/src/labeller-analysis.ts', import.meta.url),
  agreement: new URL('../../../../stats/src/agreement.ts', import.meta.url),
  bank: new URL('../../../src/ladders/judges/v3/advanced-bank.ts', import.meta.url),
  baseBank: new URL('../../../src/ladders/judges/v3/bank.ts', import.meta.url),
  fixtures: new URL('../../../src/ladders/judges/v3/fixtures.ts', import.meta.url),
  baseScorer: new URL('../../../../judges/src/labeller.ts', import.meta.url),
  audit: new URL('./advanced-mutants.test.ts', import.meta.url),
};
const sources = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
) as Record<keyof typeof paths, string>;
function compile(text: string, dependencies: Record<string, unknown>): Record<string, unknown> {
  const compiled = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics?.filter((row) => row.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const module = { exports: {} };
  const require = (name: string) => {
    if (!(name in dependencies)) throw new Error(`unbound isolated dependency: ${name}`);
    return dependencies[name];
  };
  new Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}
/** Match code tokens, preserving literals; formatter whitespace cannot disable a mutant. */
function replaceCodeOnce(source: string, edit: Edit, name: string): string {
  const tokenize = (text: string) => {
    // Parsing handles template literal rescanning; a context-free scanner does not.
    const file = ts.createSourceFile('mutation.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const tokens: { kind: ts.SyntaxKind; text: string; start: number; end: number }[] = [];
    const visit = (node: ts.Node) => {
      const children = node.getChildren(file);
      if (children.length > 0) for (const child of children) visit(child);
      else if (node.kind !== ts.SyntaxKind.EndOfFileToken && node.end > node.getStart(file)) {
        tokens.push({ kind: node.kind, text: node.getText(file), start: node.getStart(file), end: node.end });
      }
    };
    visit(file);
    return tokens;
  };
  const tokens = tokenize(source);
  const pattern = tokenize(edit.from);
  const starts = tokens.flatMap((_, i) =>
    pattern.every((token, j) => token.kind === tokens[i + j]?.kind && token.text === tokens[i + j]?.text)
      ? [i]
      : [],
  );
  expect(starts, `${name}: exactly one matching source-token site`).toHaveLength(1);
  const first = starts[0] as number;
  return (
    source.slice(0, tokens[first]?.start) + edit.to + source.slice(tokens[first + pattern.length - 1]?.end)
  );
}
function isolatedCopy(mutation?: Mutation): Subject {
  const copy = { ...sources };
  if (mutation) {
    expect(mutation.edits.length, 'real source edits required').toBeGreaterThan(0);
    for (const edit of mutation.edits) {
      copy[mutation.target] = replaceCodeOnce(copy[mutation.target], edit, mutation.name);
    }
    expect(copy[mutation.target]).not.toBe(sources[mutation.target]);
  }
  const agreement = compile(copy.agreement, { './basics': basics });
  return compile(copy.analysis, {
    './labeller': base,
    '@agent-nexus/driftbench-stats': { ...stats, ...agreement },
  }) as unknown as Subject;
}

const bank = judgesV3Bank();
const seed = 71;
const baseline = new Map<string, boolean>();
let copiedBaselinePassed = 0;
const rows: {
  name: string;
  capability: string;
  exportName: ExportName;
  edgeKilled: boolean;
  calls: Partial<Record<ExportName, number>>;
  lost: string[];
  firstDetail?: string;
}[] = [];
afterEach(() => vi.restoreAllMocks());
beforeAll(async () => {
  expect(mutations).toHaveLength(26);
  expect(new Set(mutations.map((mutation) => mutation.name)).size).toBe(26);
  expect(new Set(mutations.map((mutation) => mutation.capability)).size).toBe(9);
  const pristine = isolatedCopy();
  for (const mutation of mutations) mutation.witness(pristine);
  for (const item of bank) {
    const result = await item.run(seed);
    expect(result.pass, `${item.id}: ${result.detail}`).toBe(true);
    baseline.set(item.id, result.pass);
  }
  // Prove the isolation and binding machinery itself preserves the bank score.
  try {
    for (const key of exportsUnderAudit) {
      vi.spyOn(judges, key).mockImplementation(pristine[key] as never);
    }
    for (const item of bank) {
      const result = await item.run(seed);
      expect(result.pass, `unchanged bound copy ${item.id}: ${result.detail}`).toBe(true);
      copiedBaselinePassed += 1;
    }
  } finally {
    vi.restoreAllMocks();
  }
}, 60_000);
afterAll(() => {
  const killed = rows.filter(
    (row) => row.edgeKilled && row.lost.length > 0 && (row.calls[row.exportName] ?? 0) > 0,
  ).length;
  writeFileSync(
    '/tmp/astra-judges-advanced-mutants.md',
    [
      '# Independent advanced labeller mutation audit',
      '',
      '| Check | Verdict | Note |',
      '|---|---|---|',
      `| planted bugs | ${killed === 26 && baseline.size === bank.length && copiedBaselinePassed === bank.length ? 'pass' : 'fail'} | ${killed}/26 satisfy edge and bank kill requirements; ${rows.filter((row) => row.lost.length > 0).length}/26 lose bank items; original baseline ${baseline.size}/${bank.length}, unchanged bound-copy baseline ${copiedBaselinePassed}/${bank.length} items pass at seed ${seed}. |`,
      '',
      `Measured: ${new Date().toISOString()}.`,
      '',
      'One semantic source defect per isolated module. Delegated alpha defects mutate a copied real stats helper bound into the copied advanced module. Production and bank files remain untouched. Each unchanged-copy edge witness passes before mutation. Edge kills alone do not count as bank kills.',
      '',
      '| Source | SHA-256 |',
      '|---|---|',
      ...Object.entries(sources).map(
        ([key, text]) =>
          `| ${paths[key as keyof typeof paths].pathname} | ${createHash('sha256').update(text).digest('hex')} |`,
      ),
      '',
      '| Mutation | Capability | Edge killed | Calls through affected bound export | Bank items lost | First lost item |',
      '|---|---|---|---:|---:|---|',
      ...rows.map(
        (row) =>
          `| ${row.name} | ${row.capability} | ${row.edgeKilled} | ${row.calls[row.exportName] ?? 0} | ${row.lost.length} | ${row.lost[0] ?? 'SURVIVED'} |`,
      ),
      '',
      ...rows.map((row) => `- ${row.name}: ${row.firstDetail ?? 'No bank-item loss.'}`),
      '',
      'Command: `pnpm exec vitest run packages/validators/test/judges/v3/scoring-mutants.test.ts packages/validators/test/judges/v3/advanced-mutants.test.ts --maxWorkers=2 --reporter=verbose`.',
      '',
      'Scope: the actual combined bank at seed 71 and the explicit independent edge witnesses. This does not establish other seeds, live-model quality, or the remaining hardness-audit sections.',
    ].join('\n'),
  );
});
describe('independent advanced source-copy mutants', () => {
  it.each(mutations)(
    '$name activates and loses expanded-bank items',
    async (mutation) => {
      const mutant = isolatedCopy(mutation);
      let edgeKilled = false;
      try {
        mutation.witness(mutant);
      } catch {
        edgeKilled = true;
      }
      const row: (typeof rows)[number] = {
        name: mutation.name,
        capability: mutation.capability,
        exportName: mutation.exportName,
        edgeKilled,
        calls: {},
        lost: [],
      };
      rows.push(row);
      for (const key of exportsUnderAudit) {
        const implementation = mutant[key] as (...args: unknown[]) => unknown;
        vi.spyOn(judges, key).mockImplementation(((...args: unknown[]) => {
          row.calls[key] = (row.calls[key] ?? 0) + 1;
          return implementation(...args);
        }) as never);
      }
      for (const item of bank) {
        const result = await item.run(seed);
        if (baseline.get(item.id) && !result.pass) {
          row.lost.push(item.id);
          row.firstDetail ??= result.detail;
        }
      }
      expect(row.edgeKilled, 'independent edge must detect the activated defect').toBe(true);
      expect(
        row.calls[mutation.exportName] ?? 0,
        'actual bank must invoke the affected export',
      ).toBeGreaterThan(0);
      expect(row.lost, `SURVIVOR: ${mutation.name}; edge kills are not bank kills`).not.toEqual([]);
    },
    60_000,
  );
});
