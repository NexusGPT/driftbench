import { blockStatus } from '../runner/verdicts';
import type { BlockLink } from '../schema/links';
import type { RunResult } from '../schema/run';
import type { Spec } from '../schema/spec';
import { specHash } from '../spec/identity';
import { linkHolds, specLinks } from './links';

/**
 * Proof of rule links by a mutant. A mutant deletes (or inverts) one rule of the agent; the suite runs on
 * the original and on the mutant. A block flips when it passes on the original and fails on the mutant. A
 * link from a block to the rule (`to.kind: rule`, by the rule id or its ledger id) with the relation
 * `verifies` claims the block fails when the rule is gone:
 *
 * - the block flips: the link is `verified`;
 * - the block passes on both: the link is `refuted`;
 * - the block does not pass on the original, did not run on one side, or its runs disagree: no proof, the
 *   link keeps its status and the reason is reported.
 *
 * A block that flips with no `verifies` link to the rule is an unlinked flip: the rule matters to it, and
 * its links do not say so. A link with the relation `exercises` (a negative control: the rule must not act
 * outside its trigger) is not proved by a deletion and is left as it is. On an agent that follows its rules,
 * the blocks that flip are exactly the blocks linked to the rule: every link is verified and no flip is
 * unlinked.
 */

/** What a block did on one side: across the runs of the spec, all pass, all fail, or neither. */
export type ProofOutcome = 'pass' | 'fail' | 'mixed' | 'not_run' | 'missing';

export type BlockProofVerdict = 'verified' | 'refuted' | 'unproved' | 'unlinked-flip' | 'out';

export type BlockProof = {
  spec: string;
  path?: string;
  block: string;
  index: number;
  original: ProofOutcome;
  mutant: ProofOutcome;
  flipped: boolean;
  /** The indexes, in `metadata.links`, of the block's `verifies` links to the rule. */
  links: number[];
  verdict: BlockProofVerdict;
  /** Why a linked block has no proof. */
  reason?: string;
};

export type ProofRule = { rule: string; ledger?: string };

export type ProofMutant = { id: string; op: 'delete' | 'invert' };

export type LinkProof = {
  rule: ProofRule;
  mutant: ProofMutant;
  blocks: BlockProof[];
  counts: {
    blocks: number;
    linked: number;
    flipped: number;
    verified: number;
    refuted: number;
    unproved: number;
    unlinkedFlips: number;
    /** Links to the rule with the relation `exercises`: no deletion proves them. */
    exercised: number;
  };
  /** The specs whose links changed, with every link of the spec, the changed ones updated. */
  updates: Array<{ spec: string; path?: string; links: BlockLink[] }>;
  /** True when the blocks that flip are exactly the linked blocks, and every link is verified. */
  agrees: boolean;
};

/** Whether a link points at the rule: by its id, or by the ledger id of its unit. */
export function linksRule(link: BlockLink, rule: ProofRule): boolean {
  if (link.to.kind !== 'rule') return false;
  if (link.to.rule === rule.rule) return true;
  return rule.ledger !== undefined && link.to.ledger === rule.ledger;
}

/**
 * The outcome of each block of `spec` over the runs of that exact spec (same id and spec hash) in `runs`. A
 * block passes when it passed in every run, fails when it failed in every run; a not-run or blocked block,
 * or runs that disagree, give no outcome to prove with.
 */
export function blockOutcomes(spec: Spec, runs: readonly RunResult[]): ProofOutcome[] {
  const hash = specHash(spec);
  const own = runs.filter((run) => run.specId === spec.id && run.specHash === hash);
  return spec.blocks.map((block, index) => {
    const seen = own.flatMap((run) =>
      run.blocks.filter((result) =>
        result.blockId !== undefined && block.id !== undefined
          ? result.blockId === block.id
          : (result.specIndex ?? result.index) === index,
      ),
    );
    if (seen.length === 0) return 'missing';
    const statuses = seen.map(blockStatus);
    if (statuses.some((status) => status === 'not_run' || status === 'blocked')) return 'not_run';
    if (statuses.every((status) => status === 'pass')) return 'pass';
    if (statuses.every((status) => status === 'fail')) return 'fail';
    return 'mixed';
  });
}

/** Proves the links of `specs` to the rule the mutant removed, from the runs on the original and the mutant. */
export function proveRuleLinks(input: {
  specs: ReadonlyArray<{ spec: Spec; path?: string }>;
  rule: ProofRule;
  mutant: ProofMutant;
  original: readonly RunResult[];
  mutated: readonly RunResult[];
}): LinkProof {
  const { rule, mutant } = input;
  const blocks: BlockProof[] = [];
  const updates: LinkProof['updates'] = [];
  let exercised = 0;
  for (const { spec, path } of input.specs) {
    const links = specLinks(spec);
    // Per link, what each block it holds for proved; a link for several blocks is refuted by any of them.
    const proved = new Map<
      number,
      Array<{
        verdict: 'verified' | 'refuted';
        block: string | number;
        original: ProofOutcome;
        mutated: ProofOutcome;
      }>
    >();
    const before = blockOutcomes(spec, input.original);
    const after = blockOutcomes(spec, input.mutated);
    spec.blocks.forEach((block, index) => {
      const mine = links.flatMap((link, at) =>
        linksRule(link, rule) && linkHolds(spec, link, index) ? [at] : [],
      );
      const verifying = mine.filter((at) => (links[at]?.relation ?? 'verifies') === 'verifies');
      exercised += mine.length - verifying.length;
      const original = before[index] ?? 'missing';
      const mutated = after[index] ?? 'missing';
      const flipped = original === 'pass' && mutated === 'fail';
      let verdict: BlockProofVerdict;
      let reason: string | undefined;
      if (verifying.length === 0) verdict = flipped ? 'unlinked-flip' : 'out';
      else if (flipped) verdict = 'verified';
      else if (original === 'pass' && mutated === 'pass') verdict = 'refuted';
      else {
        verdict = 'unproved';
        reason =
          original !== 'pass'
            ? `the block does not pass on the original (${original})`
            : `the block has no outcome on the mutant (${mutated})`;
      }
      if (verdict === 'verified' || verdict === 'refuted') {
        for (const at of verifying) {
          const found = proved.get(at) ?? [];
          found.push({ verdict, block: block.id ?? index, original, mutated });
          proved.set(at, found);
        }
      }
      blocks.push({
        spec: spec.id,
        ...(path !== undefined ? { path } : {}),
        block: block.id ?? `block ${index}`,
        index,
        original,
        mutant: mutated,
        flipped,
        links: verifying,
        verdict,
        ...(reason !== undefined ? { reason } : {}),
      });
    });
    if (proved.size > 0) {
      const next = links.map((link, at): BlockLink => {
        const found = proved.get(at);
        if (!found) return link;
        const status: 'verified' | 'refuted' = found.some((entry) => entry.verdict === 'refuted')
          ? 'refuted'
          : 'verified';
        const own = found.filter((entry) => entry.verdict === status);
        const evidence =
          link.block === undefined
            ? { mutant: mutant.id, op: mutant.op, blocks: own.map(({ verdict: _v, ...entry }) => entry) }
            : { mutant: mutant.id, op: mutant.op, original: own[0]?.original, mutated: own[0]?.mutated };
        return { ...link, status, evidence: { ...(link.evidence ?? {}), [status]: evidence } };
      });
      updates.push({ spec: spec.id, ...(path !== undefined ? { path } : {}), links: next });
    }
  }
  const count = (verdict: BlockProofVerdict) => blocks.filter((block) => block.verdict === verdict).length;
  const counts = {
    blocks: blocks.length,
    linked: blocks.filter((block) => block.links.length > 0).length,
    flipped: blocks.filter((block) => block.flipped).length,
    verified: count('verified'),
    refuted: count('refuted'),
    unproved: count('unproved'),
    unlinkedFlips: count('unlinked-flip'),
    exercised,
  };
  const agrees =
    counts.linked > 0 &&
    counts.verified === counts.linked &&
    counts.unlinkedFlips === 0 &&
    counts.flipped === counts.verified;
  return { rule, mutant, blocks, counts, updates, agrees };
}
