import type { BlockLink } from '../schema/links';
import type { Spec } from '../schema/spec';
import { specLinks } from './links';
import { baselineVerdicts, flipCounts, type MutationRecord, type SuiteRun } from './mutants';
import type { SectionRegistry } from './sections';

/**
 * What a mutation run says about the suite and its links.
 *
 * Null model: a block's baseline verdict is the majority of its baseline runs (a tie gives none). Its
 * null flip rate p0 pools the baseline runs and the stage-1 runs of every control mutant: the share that
 * disagree with the baseline verdict. A block with no baseline verdict, or with p0 above `flakyAt`
 * (default 0.2), is flaky: no mutant can kill it and no link of it moves.
 *
 * A mutant kills a block when the block flips against its baseline verdict in at least `kill` of the
 * stage-1 runs (a candidate) and again in at least `confirm` of the confirmation runs.
 */

export type BlockNull = {
  key: string;
  /** The baseline verdict: true when the block fails in the baseline. Undefined on a tie. */
  baselineFails?: boolean;
  p0: number;
  runs: number;
  flaky: boolean;
};

export type MutantEffect = {
  id: string;
  sections: string[];
  op: string;
  control: boolean;
  pair: boolean;
  /** Blocks flipped in at least `kill` stage-1 runs, flaky ones left out. */
  candidates: string[];
  /** Candidates that held in the confirmation runs: the blocks the mutant kills (E). */
  killed: string[];
  /** Per killed or candidate block: stage-1 and confirmation flips, as `flips/runs`. */
  counts: Record<string, { stage1: string; confirm: string }>;
};

export type MutationAnalysis = {
  run: string;
  prompt: MutationRecord['prompt'];
  blocks: BlockNull[];
  flaky: string[];
  mutants: MutantEffect[];
};

export function analyseMutation(
  record: MutationRecord,
  options: { flakyAt?: number } = {},
): MutationAnalysis {
  const flakyAt = options.flakyAt ?? 0.2;
  const verdicts = baselineVerdicts(record.baseline);
  const controlRuns: SuiteRun[] = record.mutants.filter((m) => m.control).flatMap((m) => m.stage1);
  const pooled = flipCounts([...record.baseline, ...controlRuns], verdicts);
  const blocks: BlockNull[] = [...verdicts].map(([key, baselineFails]) => {
    const count = pooled.get(key) ?? { flips: 0, n: 0 };
    const p0 = count.n === 0 ? 0 : count.flips / count.n;
    return {
      key,
      ...(baselineFails === undefined ? {} : { baselineFails }),
      p0,
      runs: count.n,
      flaky: baselineFails === undefined || p0 > flakyAt,
    };
  });
  const flaky = new Set(blocks.filter((block) => block.flaky).map((block) => block.key));
  const stable = new Map(
    [...verdicts].filter(([key, verdict]) => verdict !== undefined && !flaky.has(key)),
  ) as Map<string, boolean>;
  const { kill, confirm } = record.rules;
  const mutants = record.mutants.map((mutant): MutantEffect => {
    const stage1 = flipCounts(mutant.stage1, stable);
    const confirmed = flipCounts(mutant.confirm, stable);
    const candidates: string[] = [];
    const killed: string[] = [];
    const counts: MutantEffect['counts'] = {};
    for (const [key, count] of stage1) {
      if (count.flips < kill) continue;
      candidates.push(key);
      const again = confirmed.get(key) ?? { flips: 0, n: 0 };
      counts[key] = { stage1: `${count.flips}/${count.n}`, confirm: `${again.flips}/${again.n}` };
      if (again.n > 0 && again.flips >= confirm) killed.push(key);
    }
    return {
      id: mutant.id,
      sections: [...mutant.sections],
      op: mutant.op,
      control: mutant.control,
      pair: mutant.pair,
      candidates: candidates.sort(),
      killed: killed.sort(),
      counts,
    };
  });
  return { run: record.id, prompt: record.prompt, blocks, flaky: [...flaky].sort(), mutants };
}

export type ControlState = { section: string; controls: number; flips: string[]; clean: boolean };

/** Per section: its control mutants, the blocks they killed, and whether they are clean (some ran, none killed). */
export function controlStates(analysis: MutationAnalysis): Map<string, ControlState> {
  const out = new Map<string, ControlState>();
  for (const mutant of analysis.mutants) {
    if (!mutant.control) continue;
    const section = mutant.sections[0] as string;
    const state = out.get(section) ?? { section, controls: 0, flips: [], clean: true };
    state.controls++;
    state.flips.push(...mutant.killed);
    state.clean = state.flips.length === 0;
    out.set(section, state);
  }
  return out;
}

/**
 * The local sections the run mutated whose single-section mutants (not controls) killed no block:
 * candidates for new blocks. A section the run did not mutate is not listed.
 */
export function untestedSections(analysis: MutationAnalysis, registry: SectionRegistry): string[] {
  const singles = analysis.mutants.filter((mutant) => !mutant.control && !mutant.pair);
  const mutated = new Set(singles.map((mutant) => mutant.sections[0]));
  const killing = new Set(
    singles.filter((mutant) => mutant.killed.length > 0).map((mutant) => mutant.sections[0]),
  );
  return registry.sections
    .filter(
      (section) =>
        section.scope === 'local' &&
        section.stale !== true &&
        mutated.has(section.id) &&
        !killing.has(section.id),
    )
    .map((section) => section.id);
}

export type LinkChange = {
  spec: string;
  block: string | number;
  section: string;
  from: BlockLink['status'] | null;
  to: BlockLink['status'];
  why: string;
};

export type LinkPromotion = {
  /** Each spec's links after the promotion, in the order they were, new links last. */
  links: { spec: string; links: BlockLink[] }[];
  changes: LinkChange[];
  /** Links left as they were, with why: a flaky block, a link for every block, a section with no clean controls. */
  kept: { spec: string; block?: string | number; section: string; why: string }[];
};

/**
 * Promotes the prompt-section links of the specs from a mutation analysis.
 *
 * - verified: a single-section mutant of the section (not a control, not a pair) kills the block, and the
 *   section's controls are clean (at least one ran, none killed a block). A killed block with no link to
 *   the section gets a new verified link (`created_by: mutation`): a selection miss becomes a link.
 * - refuted: a declared or attributed link whose section has clean controls and at least one
 *   single-section mutant that ran, none of which killed the block.
 * - unchanged: a verified, refuted or stale link not contradicted, a link of a flaky block, a link for
 *   every block (no block named), and every link of a section whose controls are not clean.
 * Two-section mutants never move a link: a flip under two edits names no single section.
 */
export function promoteLinks(
  specs: readonly Spec[],
  analysis: MutationAnalysis,
  registry: SectionRegistry,
): LinkPromotion {
  const prompt = registry.prompt_id;
  const controls = controlStates(analysis);
  const flaky = new Set(analysis.flaky);
  const singles = analysis.mutants.filter((mutant) => !mutant.control && !mutant.pair);
  const killers = new Map<string, MutantEffect>();
  for (const mutant of singles)
    for (const key of mutant.killed) {
      const at = `${key}\u0000${mutant.sections[0]}`;
      if (!killers.has(at)) killers.set(at, mutant);
    }
  const ranFor = new Set(singles.map((mutant) => mutant.sections[0]));
  const changes: LinkChange[] = [];
  const kept: LinkPromotion['kept'] = [];
  const evidence = (mutant: MutantEffect, key: string) => ({
    run: analysis.run,
    mutant: mutant.id,
    ...(mutant.counts[key] ?? {}),
  });
  const links = specs.map((spec) => {
    const blockName = (index: number) => spec.blocks[index]?.id ?? index;
    const keyOf = (index: number) => `${spec.id}#${spec.blocks[index]?.id ?? String(index)}`;
    const indexOf = (block: string | number) =>
      typeof block === 'number' ? block : spec.blocks.findIndex((each) => each.id === block);
    const out: BlockLink[] = specLinks(spec).map((link) => {
      if (link.to.kind !== 'prompt_section' || link.to.prompt !== prompt) return link;
      const section = link.to.section;
      if (link.block === undefined) {
        kept.push({ spec: spec.id, section, why: 'the link is for every block of the spec' });
        return link;
      }
      const index = indexOf(link.block);
      const key = keyOf(index);
      if (index < 0 || flaky.has(key) || !analysis.blocks.some((block) => block.key === key)) {
        kept.push({ spec: spec.id, block: link.block, section, why: 'the block is flaky or did not run' });
        return link;
      }
      const control = controls.get(section);
      if (!control?.clean) {
        kept.push({
          spec: spec.id,
          block: link.block,
          section,
          why: control ? `its controls killed ${control.flips.join(', ')}` : 'no control of the section ran',
        });
        return link;
      }
      const killer = killers.get(`${key}\u0000${section}`);
      if (killer && link.status !== 'verified' && link.status !== 'stale') {
        changes.push({
          spec: spec.id,
          block: link.block,
          section,
          from: link.status,
          to: 'verified',
          why: `${killer.id} flips it`,
        });
        return {
          ...link,
          status: 'verified',
          evidence: { ...(link.evidence ?? {}), verified: evidence(killer, key) },
        };
      }
      if (!killer && ranFor.has(section) && (link.status === 'declared' || link.status === 'attributed')) {
        const tried = singles.filter((mutant) => mutant.sections[0] === section).map((mutant) => mutant.id);
        changes.push({
          spec: spec.id,
          block: link.block,
          section,
          from: link.status,
          to: 'refuted',
          why: `no mutant of the section flips it (${tried.join(', ')})`,
        });
        return {
          ...link,
          status: 'refuted',
          evidence: { ...(link.evidence ?? {}), refuted: { run: analysis.run, mutants: tried } },
        };
      }
      return link;
    });
    // A kill with no link to the section: a new verified link.
    spec.blocks.forEach((_, index) => {
      const key = keyOf(index);
      for (const mutant of singles) {
        if (!mutant.killed.includes(key)) continue;
        const section = mutant.sections[0] as string;
        if (!controls.get(section)?.clean) continue;
        const has = out.some(
          (link) =>
            link.to.kind === 'prompt_section' &&
            link.to.prompt === prompt &&
            link.to.section === section &&
            (link.block === undefined || indexOf(link.block) === index),
        );
        if (has) continue;
        const block = blockName(index);
        changes.push({
          spec: spec.id,
          block,
          section,
          from: null,
          to: 'verified',
          why: `${mutant.id} flips it`,
        });
        out.push({
          block,
          to: { kind: 'prompt_section', prompt, section },
          status: 'verified',
          created_by: 'mutation',
          at_version: registry.version,
          evidence: { verified: evidence(mutant, key) },
        });
      }
    });
    return { spec: spec.id, links: out };
  });
  return { links, changes, kept };
}
