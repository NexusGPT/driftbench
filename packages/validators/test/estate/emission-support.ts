import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countAllows, describeCount } from '@agent-nexus/driftbench-checks';
import {
  type CheckContext,
  type CheckSet,
  type Observed,
  parseSpecText,
  type Spec,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { expect, vi } from 'vitest';
import { genCompleteFamily } from '../../src/ladders/estate/bank/loop';
import { type Component, completionComponents } from '../../src/ladders/estate/completion';
import { completionContract } from '../../src/ladders/estate/completion-contract';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { type FieldReads, fieldReadCensus } from './field-reads';
import { blockOptionCensus, readerCensus as codeCensus, textCensus } from './reader-census';
import { referenceChecks, referenceRun, required, SUFFIXES, suffix } from './ruling-reference';

export type Path = Array<string | number>;
export const REASON_CLASSES = ['default-equivalent', 'empty-demand', 'single-block-scope'] as const;
/** Entry kinds whose omitted count the evaluators read as at least one (census below). */
export const DEFAULT_COUNT_KINDS = ['guards', 'references', 'skills', 'subagents', 'calls'];
/** The reads of the default-equivalent class: an entry list off `expect`, and the count of an entry (a `some_call`
 * entry is read as `entry`). */
export const DEFAULT_COUNT_READS: FieldReads[] = [
  { receivers: ['expect'], fields: DEFAULT_COUNT_KINDS },
  { receivers: ['guard', 'reference', 'skill', 'helper', 'subagent', 'entry'], fields: ['count'] },
];
export type ReasonClass = (typeof REASON_CLASSES)[number];
export type EmissionSite = {
  path: Path;
  kind: 'check' | 'entry' | 'field';
  check: string;
  compiler: string[];
  equivalent?: string;
  reasonClass?: ReasonClass;
};
export const PINNED_SEEDS = [1, 2, 3, 1_000_000 + (0x88920017 % 1_000_000_000)];

/** `product` when the deleted value is the product's own output, `reference` when the bounded
 * test reference authored it. A reference-authored deletion is not a product mutant. */
export type Provenance = 'product' | 'reference';

export type Row = {
  seed: number;
  item: string;
  spec: string;
  path: string;
  kind: EmissionSite['kind'];
  provenance: Provenance;
  compiler: string[];
  verdict: 'killed' | 'equivalent' | 'survived';
  control: boolean;
  mutant: boolean;
  restored: boolean;
  schema: 'valid' | 'rejected';
  reason: string;
  reasonClass?: ReasonClass;
  equivalenceProof?: EquivalenceProof;
};

export type EquivalenceProof = {
  pass: boolean;
  inputs: number;
  comparisons: number;
  evaluators: string[];
  inputDigest: string;
  differences: string[];
};

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** Source anchors describe where these structures are emitted. These are output-deletion
 * probes, not literal edits to compiler source and not a claim of AST mutation coverage. */
export function compilerSites(channel: 'expect' | 'custom', check: string): string[] {
  const then = 'packages/generate/src/estate/then.ts';
  const build = 'packages/generate/src/estate/build-row.ts';
  const base = [`${build}#${channel === 'expect' ? 'expectOf' : 'customOf'}`];
  if (channel === 'custom' && check === 'guard_message') return [...base, `${build}#build`];
  if (channel === 'custom' && check === 'ordered') return [...base, `${then}#anchorPair`];
  if (channel === 'expect' && check === 'workspace') return [...base, `${then}#addWorkspace`];
  return [...base, `${then}#positive`, `${then}#negative`];
}

/** Enumerate every check, array member and object field actually emitted. The traversal
 * does not inspect item ids, atom ids or reviewer mutant names. Array siblings remain. */
export function emissionSites(spec: Spec): EmissionSite[] {
  const sites: EmissionSite[] = [];
  const walk = (value: unknown, path: Path, check: string, compiler: string[], top: boolean) => {
    const key = path.at(-1);
    const parentKey = path.at(-2);
    let equivalent: string | undefined;
    let reasonClass: ReasonClass | undefined;
    if (parentKey === 'expect' && key === 'criteria' && Array.isArray(value) && value.length === 0) {
      equivalent = 'An empty criteria array demands no criteria; omission demands the same empty set.';
      reasonClass = 'empty-demand';
    }
    if (key === 'block' && value === 0 && spec.blocks.length === 1) {
      equivalent = 'The only block is zero; omitted block applies to that same block.';
      reasonClass = 'single-block-scope';
    }
    if (
      key === 'count' &&
      DEFAULT_COUNT_KINDS.includes(String(path.at(-3))) &&
      JSON.stringify(value) === JSON.stringify({ min: 1 })
    ) {
      equivalent = 'Omitted Count means min:1, exactly the deleted constraint.';
      reasonClass = 'default-equivalent';
    }
    sites.push({
      path,
      kind: top ? 'check' : typeof key === 'number' ? 'entry' : 'field',
      check,
      compiler,
      ...(equivalent ? { equivalent, reasonClass } : {}),
    });
    if (Array.isArray(value))
      value.forEach((entry, index) => {
        walk(entry, [...path, index], check, compiler, false);
      });
    else if (value !== null && typeof value === 'object')
      for (const [field, child] of Object.entries(value))
        walk(child, [...path, field], check, compiler, false);
  };
  spec.blocks.forEach((block, index) => {
    for (const [check, value] of Object.entries(block.expect ?? {}))
      walk(value, ['blocks', index, 'expect', check], check, compilerSites('expect', check), true);
  });
  for (const [check, value] of Object.entries(spec.rules?.custom ?? {}))
    walk(value, ['rules', 'custom', check], check, compilerSites('custom', check), true);
  return sites;
}

export function valueAt(spec: Spec | undefined, path: Path): unknown {
  let value: unknown = spec;
  for (const key of path) value = record(value)[key];
  return value;
}

export function provenanceOf(product: Spec | undefined, reference: Spec, path: Path): Provenance {
  const own = valueAt(product, path);
  return own !== undefined && JSON.stringify(own) === JSON.stringify(valueAt(reference, path))
    ? 'product'
    : 'reference';
}

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const READER_ROOTS = [
  'packages/checks/src',
  'packages/judges/src',
  'packages/adapters/src',
  'packages/core/src',
  'packages/validators/test/estate/ruling-reference.ts',
];

/** Every line of code under the evaluator roots that matches `pattern`, as `file: line`: comments and the text of
 * literals never count (reader-census.ts). A new reader changes this census and reopens the equivalence class. Reads
 * of a field of `expect` are found in the syntax tree instead (field-reads.ts), where `?.` and literal text cannot
 * hide one. */
export function readerCensus(pattern: RegExp): string[] {
  return codeCensus(ROOT, READER_ROOTS, pattern);
}

export const SEEN = Array.from({ length: 257 }, (_, index) => index);
export const GUARDED_BLOCK =
  "if (typeof options.block === 'number' && options.block !== ctx.blockIndex) return [];";

/** One complete argument per class: the pinned list of every source line that reads the
 * deleted field, an exhaustive case analysis of those reads, and the class premise each
 * enumerated site must meet. Evidence prose may differ; verdict semantics may not. */
export const CLASS_PROOFS: Record<
  ReasonClass,
  {
    census: () => string[];
    readers: string[];
    cases: () => void;
    premise: (spec: Spec, site: EmissionSite) => boolean;
  }
> = {
  'default-equivalent': {
    // The deleted value is `count: { min: 1 }` on a guards, references, skills or subagents entry, or on a `some_call` entry
    // (`calls`): some_call and hazard_recovery read it through `entry.count ?? { min: 1 }` and parseSomeCall's default.
    census: () => fieldReadCensus(ROOT, READER_ROOTS, DEFAULT_COUNT_READS),
    // In the order of the census: files sorted by path (reader-census.ts, sourceFiles), so blame/ comes before checks/.
    readers: [
      // The blame inputs list the names of an `expect.skills` list as the routed skills. They read `name`s and never a
      // `count`, so an absent count and `{ min: 1 }` give the same names.
      'packages/checks/src/blame/inputs.ts: const skills = (expect?.skills ?? []).map((skill) => skill.name);',
      "packages/checks/src/checks/estate.ts: countAllows(entry.count, matching.length) ? 'pass' : 'fail',",
      'packages/checks/src/checks/estate.ts: `${plural(matching.length, what)} of ${plural(own.length, `${entry.label} call`)} in this block, expected ${describeCount(entry.count)}`,',
      'packages/checks/src/checks/estate.ts: const count = (entry.count ?? { min: 1 }) as Count;',
      "packages/checks/src/checks/estate.ts: countAllows(entry.count, matching.length) ? 'pass' : 'fail',",
      'packages/checks/src/checks/estate.ts: `${plural(matching.length, `${entry.label} call`)} after the ${hazard}, expected ${describeCount(entry.count)}`,',
      'packages/checks/src/checks/guards.ts: applies: (ctx) => (ctx.expect.guards?.length ?? 0) > 0,',
      'packages/checks/src/checks/guards.ts: const expected = ctx.expect.guards ?? [];',
      "packages/checks/src/checks/guards.ts: countAllows(guard.count, count) ? 'pass' : 'fail',",
      'packages/checks/src/checks/guards.ts: `${which} fired ${times(count)}, expected ${describeCount(guard.count)}; guards fired in this block: ${listed(shown)}`,',
      'packages/checks/src/checks/references.ts: (ctx.expect.references?.length ?? 0) > 0 && ctx.observed.runtime?.references !== undefined,',
      'packages/checks/src/checks/references.ts: const expected = ctx.expect.references ?? [];',
      "packages/checks/src/checks/references.ts: countAllows(reference.count, count) ? 'pass' : 'fail',",
      'packages/checks/src/checks/references.ts: `${reference.path} read ${times(count)}, expected ${describeCount(reference.count)}; files read in this block: ${listed([...new Set(read)])}`,',
      'packages/checks/src/checks/skills.ts: applies: (ctx) => (ctx.expect.skills?.length ?? 0) > 0,',
      'packages/checks/src/checks/skills.ts: const expected = ctx.expect.skills ?? [];',
      "packages/checks/src/checks/skills.ts: countAllows(skill.count, count) ? 'pass' : 'fail',",
      'packages/checks/src/checks/skills.ts: `${skill.name} loaded ${times(count)}, expected ${describeCount(skill.count)}; skills loaded in this block: ${listed(loaded)}`,',
      'packages/checks/src/checks/subagents.ts: applies: (ctx) => (ctx.expect.subagents?.length ?? 0) > 0 && ctx.observed.runtime?.subagents !== undefined,',
      'packages/checks/src/checks/subagents.ts: const expected = ctx.expect.subagents ?? [];',
      "packages/checks/src/checks/subagents.ts: countAllows(helper.count, count) ? 'pass' : 'fail',",
      'packages/checks/src/checks/subagents.ts: `${which} dispatched ${times(count)}, expected ${describeCount(helper.count)}; helpers dispatched in this block: ${listed(shown)}`,',
      // The evidence provider collects the skill names an `expect.skills` list holds. It reads `name`s and never a
      // `count`, so an absent count and `{ min: 1 }` give the same names.
      'packages/core/src/evidence/rule.ts: const out = new Set(input.expect?.skills ?? []);',
      "packages/core/src/radius/depends.ts: if ((expect.skills?.length ?? 0) > 0) fields.add('skills');",
      "packages/core/src/radius/depends.ts: if ((expect.guards?.length ?? 0) > 0) fields.add('guards');",
      'packages/core/src/spec/semantics.ts: for (const [index, skill] of (expect.skills ?? []).entries()) {',
      'packages/core/src/spec/semantics.ts: checkCount(skill.count, `${path}.skills.${index}.count`, issues);',
      'packages/core/src/spec/semantics.ts: for (const [index, guard] of (expect.guards ?? []).entries()) {',
      'packages/core/src/spec/semantics.ts: checkCount(guard.count, `${path}.guards.${index}.count`, issues);',
      'packages/core/src/spec/semantics.ts: for (const [index, reference] of (expect.references ?? []).entries()) {',
      'packages/core/src/spec/semantics.ts: checkCount(reference.count, `${path}.references.${index}.count`, issues);',
      'packages/core/src/spec/semantics.ts: for (const [index, subagent] of (expect.subagents ?? []).entries()) {',
      'packages/core/src/spec/semantics.ts: checkCount(subagent.count, `${path}.subagents.${index}.count`, issues);',
    ],
    cases() {
      // Entry ids come from name, path or verdict, never count; array lengths are unchanged.
      // Only countAllows and describeCount read the count; checkCount lints only a min above max.
      for (const seen of SEEN) expect(countAllows(undefined, seen)).toBe(countAllows({ min: 1 }, seen));
      expect(describeCount(undefined)).toBe(describeCount({ min: 1 }));
    },
    premise: (spec, site) =>
      DEFAULT_COUNT_KINDS.includes(String(site.path.at(-3))) &&
      site.path.at(-1) === 'count' &&
      JSON.stringify(valueAt(spec, site.path)) === JSON.stringify({ min: 1 }),
  },
  'empty-demand': {
    // The deleted value is `expect.criteria: []`.
    census: () => fieldReadCensus(ROOT, READER_ROOTS, [{ receivers: ['expect'], fields: ['criteria'] }]),
    readers: [
      'packages/checks/src/checks/knowledge_retention.ts: const judged = (ctx.expect.criteria ?? []).some(',
      'packages/checks/src/checks/relevancy.ts: if (judged(ctx.expect.criteria)) {',
      'packages/judges/src/check.ts: applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,',
      'packages/judges/src/check.ts: for (const ref of ctx.expect.criteria ?? []) {',
      'packages/judges/src/single.ts: applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,',
      'packages/judges/src/single.ts: for (const ref of ctx.expect.criteria ?? []) {',
      'packages/judges/src/single.ts: applies: (ctx) => (ctx.expect.criteria?.length ?? 0) > 0,',
      'packages/judges/src/single.ts: return (ctx.expect.criteria ?? []).map((ref): Verdict => {',
      'packages/core/src/radius/depends.ts: criteria: unique((expect.criteria ?? []).map((ref) => parseCriterionRef(ref)?.name ?? ref)),',
      'packages/core/src/radius/rejudge.ts: const refs = (block.expect?.criteria ?? []).filter((ref) =>',
      'packages/core/src/radius/rejudge.ts: const selected = (ctx.expect.criteria ?? []).map((ref) => parseCriterionRef(ref)?.name ?? ref);',
      'packages/core/src/spec/lint.ts: for (const ref of expect?.criteria ?? []) {',
      'packages/core/src/spec/semantics.ts: expect.criteria?.forEach((ref, index) => {',
      "packages/core/src/spec/spec-parents.ts: chain.flatMap((block) => (block.expect?.criteria ?? []).map((ref) => ref.replace(/@gating$/, ''))),",
      'packages/validators/test/estate/ruling-reference.ts: if (block.expect?.criteria)',
      "packages/validators/test/estate/ruling-reference.ts: block.expect.criteria = block.expect.criteria.filter((c) => c !== 'needs-registered-check');",
    ],
    cases() {
      // Every reader takes `?? []` (also behind `?.`, as rejudge and lint do), `?.length ?? 0`, `?.forEach` or
      // relevancy's own `?? []`. The reference spec's own reader tests the value for truth and filters it, then
      // hands it on to those readers: an empty list stays an empty list, an absent one stays absent.
      const forms = [
        (criteria?: string[]) => (criteria?.length ?? 0) > 0,
        (criteria?: string[]) => JSON.stringify(criteria ?? []),
        (criteria?: string[]) =>
          JSON.stringify(
            ((criteria ? criteria.filter((ref) => ref !== 'x') : criteria) ?? []).map((ref) => ref),
          ),
        (criteria?: string[]) => {
          const seen: string[] = [];
          criteria?.forEach((ref) => {
            seen.push(ref);
          });
          return JSON.stringify(seen);
        },
      ];
      for (const form of forms) expect(form(undefined)).toEqual(form([]));
      // Lint's hasExpectation counts an empty array as no expectation, like an absent one.
      expect(readerCensus(/!\(Array\.isArray\(value\) && value\.length === 0\)/)).toEqual([
        'packages/core/src/spec/lint.ts: (value) => value !== undefined && !(Array.isArray(value) && value.length === 0),',
      ]);
      expect(readerCensus(/function judged\(criteria/)).toEqual([
        'packages/checks/src/checks/relevancy.ts: function judged(criteria: readonly string[] | undefined): boolean {',
      ]);
      expect(readerCensus(/return \(criteria \?\? \[\]\)\.some/)).toEqual([
        "packages/checks/src/checks/relevancy.ts: return (criteria ?? []).some((ref) => parseCriterionRef(ref)?.name === 'relevancy');",
      ]);
    },
    premise: (spec, site) =>
      site.path.at(-2) === 'expect' &&
      site.path.at(-1) === 'criteria' &&
      JSON.stringify(valueAt(spec, site.path)) === '[]',
  },
  'single-block-scope': {
    // The deleted value is a custom check's `block: 0` on a one-block spec.
    // Reads of a custom check's `block` option, found by what the receiver is bound to, never by its name.
    census: () => blockOptionCensus(ROOT, READER_ROOTS),
    readers: [
      `packages/checks/src/checks/absence.ts: ${GUARDED_BLOCK}`,
      'packages/checks/src/checks/estate.ts: if (entry.block !== undefined && entry.block !== ctx.blockIndex) return;',
      "packages/checks/src/checks/estate.ts: ...(typeof entry.block === 'number' ? { block: entry.block } : {}),",
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK.replaceAll('options.', 'opts.')}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      `packages/checks/src/checks/estate.ts: ${GUARDED_BLOCK}`,
      'packages/validators/test/estate/ruling-reference.ts: if (opts.block !== undefined && opts.block !== ctx.blockIndex) return [];',
    ],
    cases() {
      // The runner refuses a blockIndex outside 0..blocks.length-1 (core runner/run.ts nextStep),
      // and the custom check passes options through unread (checks/custom.ts createCustomCheck).
      expect(
        textCensus(ROOT, READER_ROOTS, /the driver asked for block \$\{step\.blockIndex\}/),
      ).toHaveLength(1);
      expect(
        readFileSync(`${ROOT}packages/checks/src/checks/custom.ts`, 'utf8').match(/\.block\b/g),
      ).toBeNull();
      const guarded = (block: unknown, blockIndex: number) =>
        typeof block === 'number' && block !== blockIndex;
      const defined = (block: number | undefined, blockIndex: number) =>
        block !== undefined && block !== blockIndex;
      expect(guarded(0, 0)).toBe(guarded(undefined, 0));
      expect(defined(0, 0)).toBe(defined(undefined, 0));
    },
    premise: (spec, site) =>
      spec.blocks.length === 1 &&
      site.path[0] === 'rules' &&
      site.path.at(-1) === 'block' &&
      valueAt(spec, site.path) === 0,
  },
};

export function deleteAt(spec: Spec, path: Path): Spec {
  const copy = structuredClone(spec);
  let parent: unknown = copy;
  for (const key of path.slice(0, -1)) parent = record(parent)[key];
  const key = required(path.at(-1));
  if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
  else delete record(parent)[key];
  return copy;
}

export function reloaded(source: pipeline.GeneratedSpec, spec: Spec): pipeline.GeneratedSpec {
  const text = JSON.stringify(spec);
  const parsed = parseSpecText(text, 'json');
  return {
    ...source,
    text,
    // Keep metadata available for class attribution even for loader-rejected output.
    loaded: parsed.ok ? parsed : { ...required(source.loaded), spec },
    errors: parsed.ok ? [] : parsed.errors.map((error) => JSON.stringify(error)),
    warnings: parsed.ok ? parsed.warnings.map((warning) => warning.message) : [],
  };
}

export async function measure(run: pipeline.EstateRun, checks: CheckSet = referenceChecks()) {
  const source = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
  const registry = vi.spyOn(pipeline, 'replayChecks').mockReturnValue(checks);
  try {
    return await genCompleteFamily().evaluate(run.estate.seed);
  } finally {
    source.mockRestore();
    registry.mockRestore();
  }
}

export type GeneratedInput = { id: string; observed: Observed };
export type EquivalenceInputs = { context: CheckContext; inputs: GeneratedInput[]; gaps: string[] };
export const inputsBySource = new Map<string, Promise<EquivalenceInputs>>();
export const proofsBySite = new Map<string, Promise<EquivalenceProof>>();

export function sourceKey(run: pipeline.EstateRun, source: pipeline.GeneratedSpec): string {
  return `${run.estate.seed}:${source.record.id}:${source.text}`;
}

/** Capture every input after the runner's actual JSON and Observed-schema boundary.
 * Apply the bank's prepare/change functions through replayOnFollower, never directly
 * to the already-normalized CheckContext. Keep identical observations reached through
 * different component clauses, because every generated input is owed a comparison. */
export function equivalenceInputs(
  run: pipeline.EstateRun,
  source: pipeline.GeneratedSpec,
): Promise<EquivalenceInputs> {
  const key = sourceKey(run, source);
  let pending = inputsBySource.get(key);
  if (!pending) {
    // Only one source's traces are needed at a time. Proof summaries, not full traces,
    // remain cached for the subsequent parameterized class assertions.
    inputsBySource.clear();
    pending = (async () => {
      const capture = async (change?: (observed: Observed) => void, operations?: Component['operations']) => {
        const contexts: CheckContext[] = [];
        const loaded = required(source.loaded);
        const replay = await pipeline.replayOnFollower(
          run,
          operations
            ? {
                ...loaded,
                spec: { ...loaded.spec, operations: { ...loaded.spec.operations, ...operations } },
              }
            : loaded,
          [
            {
              name: 'capture-equivalence-context',
              applies: () => true,
              evaluate(context) {
                contexts.push(context);
                return [];
              },
            },
          ],
          undefined,
          change,
        );
        if (replay.run.status !== 'completed' || contexts.length !== 1)
          throw new Error(
            `Equivalence input failed the runner boundary: ${replay.error ?? replay.run.status}`,
          );
        return required(contexts[0]);
      };
      const context = await capture();
      const inventory = completionComponents(completionContract(run, source));
      const inputs: GeneratedInput[] = [
        { id: 'follower.control', observed: structuredClone(context.observed) },
      ];
      for (const component of inventory.components) {
        const control = await capture(component.prepare, component.operations);
        inputs.push({ id: `${component.id}.control`, observed: structuredClone(control.observed) });
        const violation = await capture((observed) => {
          component.prepare?.(observed);
          component.change(observed);
        }, component.operations);
        inputs.push({ id: `${component.id}.violation`, observed: structuredClone(violation.observed) });
      }
      return { context, inputs, gaps: inventory.gaps };
    })();
    inputsBySource.set(key, pending);
  }
  return pending;
}

/** A verdict's wording can differ when an explicit default is omitted. Compare its
 * actual clause identity, kind, outcome, gating and score, never evidence prose or only
 * the aggregate green result. An absent channel and an empty channel both denote an
 * empty conjunction only when they produce no verdicts. No pass verdict is discarded. */
export function verdictSemantics(verdicts: Verdict[]): string {
  return JSON.stringify(
    verdicts
      .map(({ id, kind, outcome, gating, score }) => ({
        id,
        kind,
        outcome,
        gating,
        ...(score === undefined ? {} : { score }),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

export async function evaluatedSemantics(
  checks: CheckSet,
  context: CheckContext,
  spec: Spec,
  observed: Observed,
): Promise<string> {
  const block = required(spec.blocks[context.blockIndex]);
  const ctx = { ...context, spec, block, expect: block.expect ?? {}, observed: structuredClone(observed) };
  const verdicts: Verdict[] = [];
  for (const check of checks) if (check.applies(ctx)) verdicts.push(...(await check.evaluate(ctx)));
  return verdictSemantics(verdicts);
}

export function proveEquivalent(
  run: pipeline.EstateRun,
  source: pipeline.GeneratedSpec,
  site: EmissionSite,
): Promise<EquivalenceProof> {
  const key = `${sourceKey(run, source)}:${site.path.join('.')}`;
  let pending = proofsBySite.get(key);
  if (!pending) {
    pending = (async () => {
      const { context, inputs, gaps } = await equivalenceInputs(run, source);
      const deleted = reloaded(source, deleteAt(required(source.loaded).spec, site.path));
      const differences = gaps.map((gap) => `unproven input shape: ${gap}`);
      if (deleted.errors.length || deleted.warnings.length)
        differences.push('Deleted output fails schema validation');
      if (!site.reasonClass) differences.push('No proved equivalence class');
      const evaluators = [
        { name: 'production', checks: pipeline.replayChecks() },
        { name: 'bounded-reference', checks: referenceChecks() },
      ];
      let comparisons = 0;
      for (const input of inputs) {
        for (const evaluator of evaluators) {
          try {
            const before = await evaluatedSemantics(
              evaluator.checks,
              context,
              required(source.loaded).spec,
              input.observed,
            );
            const after = await evaluatedSemantics(
              evaluator.checks,
              context,
              required(deleted.loaded).spec,
              input.observed,
            );
            comparisons += 1;
            if (before !== after) differences.push(`${input.id}:${evaluator.name}: ${before} != ${after}`);
          } catch (cause) {
            differences.push(`${input.id}:${evaluator.name}: evaluation failed: ${String(cause)}`);
          }
        }
      }
      return {
        pass: differences.length === 0 && comparisons === inputs.length * evaluators.length,
        inputs: inputs.length,
        comparisons,
        evaluators: evaluators.map((evaluator) => evaluator.name),
        inputDigest: createHash('sha256').update(JSON.stringify(inputs)).digest('hex'),
        differences,
      };
    })().catch(
      (cause): EquivalenceProof => ({
        pass: false,
        inputs: 0,
        comparisons: 0,
        evaluators: ['production', 'bounded-reference'],
        inputDigest: createHash('sha256').update('').digest('hex'),
        differences: [`Unproved transport or evaluation input: ${String(cause)}`],
      }),
    );
    proofsBySite.set(key, pending);
  }
  return pending;
}

/**
 * The rows and the gaps of one pinned seed: every emitted check, entry and field of its generated specs, deleted from
 * the product output and measured against the control and the restoration. The expectations inside are the ones the
 * single enumeration test held for each seed.
 */
export async function enumerateSeed(seed: number): Promise<{ rows: Row[]; gaps: string[] }> {
  const rows: Row[] = [];
  const gaps: string[] = [];
  const generated = await pipeline.generationRun(seed);
  const original = referenceRun(generated);
  for (const source of original.specs) {
    const key = suffix(original, source);
    if (!SUFFIXES.includes(key) || !source.loaded) continue;
    const item = `gen.complete.${key}`;
    const productSpec = generated.specs.find((spec) => spec.record.id === source.record.id)?.loaded?.spec;
    const run = { ...original, specs: [source] };
    const inventory = completionComponents(completionContract(run, source));
    gaps.push(...inventory.gaps.map((gap) => `${seed}:${source.record.id}:${gap}`));
    const control = required((await measure(run)).get(item));
    expect(control, `${seed}:${source.record.id} control`).toEqual({ pass: true, detail: 'holds' });
    for (const site of emissionSites(source.loaded.spec)) {
      const product = reloaded(source, deleteAt(source.loaded.spec, site.path));
      const changed = { ...run, specs: [product] };
      const mutant = required((await measure(changed)).get(item));
      // Re-evaluate a fresh run object so spec-verdict caching cannot supply restoration.
      const restored = required((await measure({ ...run })).get(item));
      const proof = site.equivalent === undefined ? undefined : await proveEquivalent(run, source, site);
      const equivalent = proof?.pass === true;
      const verdict = equivalent && mutant.pass ? 'equivalent' : !mutant.pass ? 'killed' : 'survived';
      rows.push({
        seed,
        item,
        spec: source.record.id,
        path: site.path.join('.'),
        kind: site.kind,
        provenance: provenanceOf(productSpec, source.loaded.spec, site.path),
        compiler: site.compiler,
        verdict,
        control: control.pass,
        mutant: mutant.pass,
        restored: restored.pass,
        schema: product.errors.length > 0 ? 'rejected' : 'valid',
        reason: equivalent
          ? required(site.equivalent)
          : proof
            ? proof.differences.join('; ')
            : (mutant.detail ?? ''),
        ...(site.reasonClass ? { reasonClass: site.reasonClass } : {}),
        ...(proof ? { equivalenceProof: proof } : {}),
      });
      expect(restored.pass, `${seed}:${source.record.id}:${site.path.join('.')} restoration`).toBe(true);
    }
  }

  return { rows, gaps };
}

/** The part file of one seed: what that seed's enumeration found, to be read back by the manifest test. */
export const partPath = (seed: number) =>
  fileURLToPath(
    new URL(`../../../../validators/estate/emission-mutation-parts/seed-${seed}.json`, import.meta.url),
  );

export const MANIFEST_PATH = fileURLToPath(
  new URL('../../../../validators/estate/EMISSION-MUTATION-MANIFEST.json', import.meta.url),
);

/** The manifest of all pinned seeds, from their rows and gaps. */
export function buildManifest(rows: Row[], gaps: string[]) {
  return {
    method:
      'Recursive product-output deletion with compiler source anchors; no literal compiler source edits.',
    reference: 'ruling-reference.ts referenceRun plus referenceChecks',
    seeds: PINNED_SEEDS,
    summary: {
      enumerated: rows.length,
      killed: rows.filter((row) => row.verdict === 'killed').length,
      equivalent: rows.filter((row) => row.verdict === 'equivalent').length,
      survived: rows.filter((row) => row.verdict === 'survived').length,
      equivalenceByReasonClass: Object.fromEntries(
        REASON_CLASSES.map((reasonClass) => [
          reasonClass,
          rows.filter((row) => row.verdict === 'equivalent' && row.reasonClass === reasonClass).length,
        ]),
      ),
      byProvenance: Object.fromEntries(
        (['product', 'reference'] as const).map((provenance) => {
          const own = rows.filter((row) => row.provenance === provenance);
          return [
            provenance,
            {
              enumerated: own.length,
              killed: own.filter((row) => row.verdict === 'killed').length,
              equivalent: own.filter((row) => row.verdict === 'equivalent').length,
              survived: own.filter((row) => row.verdict === 'survived').length,
              equivalenceByReasonClass: Object.fromEntries(
                REASON_CLASSES.map((reasonClass) => [
                  reasonClass,
                  own.filter((row) => row.verdict === 'equivalent' && row.reasonClass === reasonClass).length,
                ]),
              ),
            },
          ];
        }),
      ),
      reasonClassProofs: Object.fromEntries(
        REASON_CLASSES.map((reasonClass) => [
          reasonClass,
          `pnpm exec vitest run packages/validators/test/estate/emission-mutations.test.ts -t "${reasonClass}" --maxWorkers=1 --testTimeout=1200000`,
        ]),
      ),
    },
    perItem: SUFFIXES.map((key) => {
      const own = rows.filter((row) => row.item === `gen.complete.${key}`);
      return {
        item: `gen.complete.${key}`,
        sites: own.length,
        killed: own.filter((row) => row.verdict === 'killed').length,
        equivalent: own.filter((row) => row.verdict === 'equivalent').length,
        survived: own.filter((row) => row.verdict === 'survived').length,
      };
    }),
    gaps,
    rows,
  };
}
