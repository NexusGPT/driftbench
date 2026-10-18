import { performance } from 'node:perf_hooks';
import {
  checkQuotes,
  type ExtractResult,
  extractMap,
  validateProposal,
} from '@agent-nexus/driftbench-generate';
import { fold } from '../truth';
import {
  type CodeEntry,
  compareFacts,
  expectedFacts,
  listFacts,
  type Parts,
  proposalFacts,
  quotesOffAnchor,
} from './facts';
import { perfectPort } from './perfect';
import type { BankDeps, BankItem, Case, CaseRun, Outcome, Tier } from './types';

const NOW = () => new Date('2026-10-11T00:00:00.000Z');

/**
 * Runs the extractor on one case with the perfect model, timing it. The time the perfect model spends is the
 * validator's, so it is left out of the run's time. A throw is a run with an error.
 */
export async function runCase(item: Case, deps: BankDeps = {}): Promise<CaseRun> {
  const perfect = perfectPort(item.planted);
  let modelMs = 0;
  const port = {
    family: perfect.family,
    model: perfect.model,
    async complete(request: Parameters<typeof perfect.complete>[0]) {
      const started = performance.now();
      try {
        return await perfect.complete(request);
      } finally {
        modelMs += performance.now() - started;
      }
    },
  };
  const start = performance.now();
  let result: ExtractResult;
  let error: string | undefined;
  try {
    result = await (deps.extract ?? extractMap)({
      agent: 'bank-agent',
      sources: item.sources,
      port,
      now: NOW,
    });
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    result = { ok: false, errors: [{ source: '', code: 'THROWN', path: '', message: error }] };
  }
  return {
    case: item,
    result,
    ms: Math.round(performance.now() - start - modelMs),
    ...(error ? { error } : {}),
  };
}

/** Runs every case of an item on a seed and applies its oracle. A throw anywhere is a failure. */
export async function runItem(item: BankItem, seed: number, deps: BankDeps = {}): Promise<Outcome> {
  try {
    if (item.run) return await item.run(seed, deps);
    const runs: CaseRun[] = [];
    for (const one of item.generate(seed)) runs.push(await runCase(one, deps));
    return item.check(runs, seed);
  } catch (cause) {
    return {
      pass: false,
      detail: `the item threw: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

/** Why a run has no usable proposal, or undefined. */
export function runProblem(run: CaseRun): string | undefined {
  if (run.result.ok) return undefined;
  const first = run.result.errors[0];
  return `${run.case.label}: the extractor gave no proposal (${first?.code} ${first?.path} ${first?.message})`;
}

/**
 * Why a returned proposal is not a valid one: the schema, the references, the space map rules, or a quote not
 * in its source. An extractor that returns such a proposal fails the item, whatever its facts say.
 */
export function proposalProblem(run: CaseRun): string | undefined {
  if (!run.result.ok) return undefined;
  const checked = validateProposal(run.result.proposal);
  const problems = checked.ok
    ? checkQuotes(run.result.proposal, new Map(run.case.sources.map((source) => [source.path, source.text])))
    : checked.errors;
  const first = problems[0];
  return first
    ? `${run.case.label}: the extractor returned an invalid proposal (${first.code} ${first.path} ${first.message})`
    : undefined;
}

/** Code values whose quote or title is not the one the item planted. */
function codeQuoteProblems(run: CaseRun, code: readonly CodeEntry[]): string[] {
  if (!run.result.ok) return [];
  const out: string[] = [];
  for (const entry of code) {
    if (entry.type !== 'value' || (entry.quote === undefined && entry.titleIncludes === undefined)) continue;
    const value = run.result.proposal.dimensions
      .find((dimension) => dimension.id === entry.dimension)
      ?.values.find((candidate) => candidate.id === entry.value);
    if (!value) {
      out.push(`${entry.dimension}/${entry.value} is missing, so its quote and title cannot be checked`);
      continue;
    }
    const quote = value.evidence.quote;
    if (
      entry.quote !== undefined &&
      (entry.exact ? quote !== entry.quote : fold(quote) !== fold(entry.quote))
    ) {
      out.push(
        `${entry.dimension}/${entry.value} quotes ${JSON.stringify(quote.slice(0, 60))}${quote.length > 60 ? '...' : ''} (${quote.length} characters), not the ${entry.quote.length} the item holds`,
      );
    }
    if (entry.titleIncludes !== undefined && !value.title.includes(entry.titleIncludes)) {
      out.push(
        `${entry.dimension}/${entry.value} is titled "${value.title}", which lacks "${entry.titleIncludes}"`,
      );
    }
  }
  return out;
}

/** The sections that failed in a run, for an item detail. */
export function failedSections(run: CaseRun): string {
  if (!run.result.ok) return '';
  const failed = run.result.sections.filter((section) => section.status === 'failed');
  return failed.length === 0
    ? ''
    : `; sections failed: ${failed.map((section) => `${section.section} (${section.error ?? ''})`).join(', ')}`;
}

/**
 * The common oracle: the run's map, over the parts asked for, equals the facts the generator planted; every
 * prose value quotes its own passage; the run fits its time budget.
 */
export function checkMap(run: CaseRun, code: readonly CodeEntry[], parts: Parts): Outcome {
  const problem = runProblem(run);
  if (problem) return { pass: false, detail: problem };
  if (!run.result.ok) return { pass: false, detail: 'no proposal' };
  const invalid = proposalProblem(run);
  if (invalid) return { pass: false, detail: invalid };
  const expected = expectedFacts(run.case.planted, code, parts);
  const actual = proposalFacts(run.result.proposal, parts);
  const { lost, gained } = compareFacts(expected, actual);
  const off = [
    ...(parts.values ? quotesOffAnchor(run.result.proposal, run.case.planted) : []),
    ...codeQuoteProblems(run, code),
  ];
  const late = run.case.budgetMs !== undefined && run.ms > run.case.budgetMs;
  if (lost.length === 0 && gained.length === 0 && off.length === 0 && !late) {
    return { pass: true, detail: `${run.case.label}: ${expected.size} facts held in ${run.ms} ms` };
  }
  const parts_ = [
    `${run.case.label}: lost ${listFacts(lost)}; gained ${listFacts(gained)}`,
    ...(off.length > 0 ? [`quotes off their passage: ${listFacts(off)}`] : []),
    ...(late ? [`took ${run.ms} ms, over the budget of ${run.case.budgetMs} ms`] : []),
  ];
  return { pass: false, detail: `${parts_.join('; ')}${failedSections(run)}` };
}

/** Every outcome must pass; the first failure explains the item. */
export function allOf(outcomes: Outcome[]): Outcome {
  const failed = outcomes.find((outcome) => !outcome.pass);
  return failed ?? { pass: true, detail: outcomes.map((outcome) => outcome.detail).join(' | ') };
}

/** What a single-case item builds on a seed: its case, the code entries expected, and the parts it checks. */
export type Built = { case: Case; code: CodeEntry[]; parts: Parts };

/** An item of one case checked by `checkMap`. */
export function mapItem(meta: {
  id: string;
  family: string;
  tier: Tier;
  level: number;
  component: string;
  title: string;
  cause: string;
  build: (seed: number) => Built;
}): BankItem {
  return {
    id: meta.id,
    cause: meta.cause,
    family: meta.family,
    tier: meta.tier,
    level: meta.level,
    component: meta.component,
    title: meta.title,
    generate: (seed) => [meta.build(seed).case],
    code: (seed) => meta.build(seed).code,
    check: (runs, seed) => {
      const built = meta.build(seed);
      const run = runs[0];
      if (!run) return { pass: false, detail: 'no run' };
      return checkMap(run, built.code, built.parts);
    },
  };
}
