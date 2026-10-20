import { wilson } from '@agent-nexus/driftbench-stats';
import type { BlockLink } from '../schema/links';
import type { Spec } from '../schema/spec';
import { canonicalJson } from '../spec/hash';
import type { ChangeManifest } from './change';
import { specLinks } from './links';
import type { MutationAnalysis } from './mutation-analysis';
import type { RadiusSpec } from './radius';
import { type SectionRegistry, sha256Hex } from './sections';
import { type ParentRef, sectionSelection } from './select';

/**
 * The verified-link gate: the only way section selection may skip a block.
 *
 * Section selection runs on the VERIFIED links alone (a block with none to the prompt is always
 * selected), with forward closure. A mutant violates safety when it kills a block (mutation-analysis.ts)
 * that the selection of its sections leaves out. The gate passes when the 95% Wilson upper bound on the
 * share of violating mutants is at or below 5%, over every non-control mutant of a run, two-section
 * mutants included. It fails with no verified link at all (nothing could be skipped), on a run with no
 * two-section mutant, and on a run that verified one of the links it is scored on (the links must come
 * from another run, or the gate scores its own answers).
 *
 * A gate record is bound to the prompt (id, version and text hash) and to the suite: each spec's hash and
 * its verified links to the prompt. Any change to these makes the record stale, and a stale, failed or
 * missing record keeps selection advisory: the whole suite runs.
 */

export const GATE_LIMIT = 0.05;

export type GateViolation = { mutant: string; pair: boolean; missed: string[] };

export type SelectionGate = {
  kind: 'driftbench.selection-gate';
  version: 1;
  pass: boolean;
  /** Why the gate failed, or what it passed on. */
  reason: string;
  prompt: { id: string; version: string; text_sha256: string };
  /** The SHA-256 of the specs' hashes and verified links to the prompt. */
  suite: string;
  /** The mutation run the gate was scored on. */
  run: string;
  limit: number;
  mutants: number;
  violating: number;
  pairs: number;
  violatingPairs: number;
  share: number;
  upper: number;
  /** The mean share of stable blocks selected. */
  ratio: number;
  violations: GateViolation[];
};

/** The specs with only their verified links to the prompt kept (other prompts' links stay as they are). */
export function verifiedOnly(specs: readonly RadiusSpec[], prompt: string): RadiusSpec[] {
  return specs.map((entry) => ({
    ...entry,
    spec: {
      ...entry.spec,
      metadata: {
        ...(entry.spec.metadata ?? {}),
        links: specLinks(entry.spec).filter(
          (link) =>
            link.to.kind !== 'prompt_section' || link.to.prompt !== prompt || link.status === 'verified',
        ),
      },
    } as Spec,
  }));
}

const verifiedTo = (spec: Spec, prompt: string): BlockLink[] =>
  specLinks(spec).filter(
    (link) => link.to.kind === 'prompt_section' && link.to.prompt === prompt && link.status === 'verified',
  );

/** What a gate is bound to on the suite side: each spec's hash and its verified links to the prompt. */
export function gateSuiteDigest(specs: readonly RadiusSpec[], prompt: string): string {
  const rows = [...specs]
    .map(({ spec, hash }) => [
      spec.id,
      hash,
      verifiedTo(spec, prompt).map(({ evidence: _e, ...link }) => link),
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return sha256Hex(canonicalJson(rows));
}

const manifestOf = (prompt: string, sections: readonly string[]): ChangeManifest => ({
  from: 'baseline',
  to: 'mutant',
  changes: sections.map((section) => ({ kind: 'prompt_section', id: `${prompt}#${section}` })),
});

/** Scores the verified-link gate on a mutation analysis. See the module comment for the rule. */
export function selectionGate(
  specs: readonly RadiusSpec[],
  registry: SectionRegistry,
  analysis: MutationAnalysis,
  options: { parentOf?: (spec: Spec) => ParentRef | undefined } = {},
): SelectionGate {
  const prompt = registry.prompt_id;
  const flaky = new Set(analysis.flaky);
  const verified = verifiedOnly(specs, prompt);
  const stable = specs.flatMap(({ spec }) =>
    spec.blocks
      .map((block, index) => `${spec.id}#${block.id ?? String(index)}`)
      .filter((key) => !flaky.has(key)),
  );
  const rows = analysis.mutants.filter((mutant) => !mutant.control);
  const violations: GateViolation[] = [];
  let ratio = 0;
  for (const mutant of rows) {
    const selection = sectionSelection(verified, manifestOf(prompt, mutant.sections), [registry], options);
    const selected = new Set(
      selection.specs.flatMap((spec) =>
        spec.blocks.filter((block) => block.state !== 'out').map((block) => `${spec.specId}#${block.id}`),
      ),
    );
    const missed = mutant.killed.filter((key) => !flaky.has(key) && !selected.has(key));
    if (missed.length > 0) violations.push({ mutant: mutant.id, pair: mutant.pair, missed });
    ratio += stable.length === 0 ? 0 : stable.filter((key) => selected.has(key)).length / stable.length;
  }
  const n = rows.length;
  const k = violations.length;
  const pairs = rows.filter((mutant) => mutant.pair).length;
  const violatingPairs = violations.filter((each) => each.pair).length;
  const upper = n === 0 ? 1 : wilson(k, n).upper;
  const verifiedLinks = specs.reduce((sum, { spec }) => sum + verifiedTo(spec, prompt).length, 0);
  const own = specs.flatMap(({ spec }) =>
    verifiedTo(spec, prompt).filter((link) => {
      const by = (link.evidence?.verified as { run?: unknown } | undefined)?.run;
      return by === analysis.run;
    }),
  );
  const reason =
    n === 0
      ? 'the run has no mutant to score'
      : verifiedLinks === 0
        ? 'no block has a verified link to the prompt: selection could skip nothing'
        : pairs === 0
          ? 'the run has no two-section mutant: two-section faults are where declared links fail'
          : own.length > 0
            ? `${own.length} verified link${own.length === 1 ? ' was' : 's were'} verified by this same run (${analysis.run}): score the gate on another run`
            : upper > GATE_LIMIT
              ? `${k} of ${n} mutants violate safety; the 95% Wilson upper bound ${(upper * 100).toFixed(1)}% is above ${GATE_LIMIT * 100}%`
              : `${k} of ${n} mutants violate safety (${pairs} two-section); the 95% Wilson upper bound ${(upper * 100).toFixed(1)}% is at or below ${GATE_LIMIT * 100}%`;
  const pass = n > 0 && verifiedLinks > 0 && pairs > 0 && own.length === 0 && upper <= GATE_LIMIT;
  return {
    kind: 'driftbench.selection-gate',
    version: 1,
    pass,
    reason,
    prompt: { id: prompt, version: registry.version, text_sha256: registry.text_sha256 },
    suite: gateSuiteDigest(specs, prompt),
    run: analysis.run,
    limit: GATE_LIMIT,
    mutants: n,
    violating: k,
    pairs,
    violatingPairs,
    share: n === 0 ? 0 : k / n,
    upper,
    ratio: n === 0 ? 0 : ratio / n,
    violations,
  };
}

export type GateCheck = { ok: true; gate: SelectionGate } | { ok: false; reason: string };

/**
 * Whether a gate record lets section selection skip blocks of these specs: it must be a passing record
 * for the same prompt version and text, and for the same specs and verified links.
 */
export function checkSelectionGate(
  gate: unknown,
  specs: readonly RadiusSpec[],
  registries: readonly SectionRegistry[],
): GateCheck {
  const record = gate as Partial<SelectionGate> | undefined;
  if (record?.kind !== 'driftbench.selection-gate' || record.version !== 1 || !record.prompt)
    return { ok: false, reason: 'the file is not a selection gate record' };
  if (record.pass !== true) return { ok: false, reason: `the gate failed: ${record.reason ?? 'no reason'}` };
  const registry = registries.find((each) => each.prompt_id === record.prompt?.id);
  if (!registry)
    return { ok: false, reason: `no section registry was given for the prompt ${record.prompt.id}` };
  if (registry.version !== record.prompt.version || registry.text_sha256 !== record.prompt.text_sha256)
    return {
      ok: false,
      reason: `the gate is for ${record.prompt.id} ${record.prompt.version}, and the registry describes ${registry.version}${registry.text_sha256 === record.prompt.text_sha256 ? '' : ' with another text'}: the gate is stale`,
    };
  if (gateSuiteDigest(specs, registry.prompt_id) !== record.suite)
    return {
      ok: false,
      reason: 'the specs or their verified links changed since the gate was scored: the gate is stale',
    };
  return { ok: true, gate: record as SelectionGate };
}
