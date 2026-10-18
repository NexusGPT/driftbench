import { z } from 'zod';

/**
 * Links from a block to what it tests: a prompt section, a clause of a written spec, a rule of a map, the
 * plan row the block was written for, or a past conversation turn. Links live in the spec's `metadata.links` and are kept out of the spec hash
 * (spec/identity.ts), so adding, promoting or refuting a link never invalidates a recorded run, a
 * carry or a rejudge.
 *
 * A link's status says how much it is trusted. `declared` is what an author or a generator wrote;
 * `attributed` came from an attribution method; `verified` means a mutant of the target flipped the
 * block; `refuted` means it did not; `stale` means the target changed or could not be found again.
 * Selection uses every link but a refuted one; a claim that a target is tested needs `verified`.
 */

export const LINK_STATUSES = ['declared', 'attributed', 'verified', 'refuted', 'stale'] as const;
export const LinkStatus = z.enum(LINK_STATUSES);
export type LinkStatus = z.infer<typeof LinkStatus>;

export const LINK_RELATIONS = ['verifies', 'exercises', 'derived_from', 'observed_in'] as const;
export const LinkRelation = z.enum(LINK_RELATIONS);
export type LinkRelation = z.infer<typeof LinkRelation>;

export const LINK_CREATORS = ['generator', 'author', 'attribution', 'citation', 'ir', 'mutation'] as const;

export const PromptSectionTarget = z
  .strictObject({
    kind: z.literal('prompt_section'),
    prompt: z.string().min(1).describe('The prompt id, as its section registry names it.'),
    section: z.string().min(1).describe('The section id in that registry.'),
  })
  .describe('A section of a prompt, by its stable id in `prompts/<id>.sections.yaml`.');

export const SpecClauseTarget = z
  .strictObject({
    kind: z.literal('spec_clause'),
    spec: z.string().min(1).describe('The written specification the clause belongs to.'),
    clause: z.string().min(1).describe('The clause id, such as R-4.2.'),
    sha256: z.string().min(1).optional().describe('The hash of the clause text when the link was made.'),
  })
  .describe('A clause of a written specification or policy.');

export const SourceTurnTarget = z
  .strictObject({
    kind: z.literal('source_turn'),
    conversation: z.string().min(1).describe('The id of the past conversation.'),
    turn: z.number().int().min(0).describe('The turn of that conversation, from 0.'),
    cluster: z.string().min(1).optional().describe('The intent cluster the turn was found in.'),
    redacted: z.boolean().optional().describe('True when the turn text was redacted on import.'),
  })
  .describe('A turn of a past conversation the block was derived from or observed in.');

export const RuleTarget = z
  .strictObject({
    kind: z.literal('rule'),
    rule: z
      .string()
      .min(1)
      .describe(
        'The readable id of the rule: an atom id of an estate map, or dimension=value of a prompt map.',
      ),
    ledger: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The ledger id of the unit the rule was read from, when its reader gave one; it survives an edit.',
      ),
  })
  .describe('A rule of a map: an estate atom or a prompt map value, by its readable id and its ledger id.');

export const PlanRowTarget = z
  .strictObject({
    kind: z.literal('plan_row'),
    row: z
      .string()
      .min(1)
      .describe('The id of the plan row, or of the generated row, the block was written for.'),
    values: z
      .record(z.string(), z.string())
      .describe("The values of the row's cell, by variable, with the values the block adds."),
  })
  .describe('The row of a plan a generator wrote the block for, with its values.');

export const LinkTarget = z.discriminatedUnion('kind', [
  PromptSectionTarget,
  SpecClauseTarget,
  SourceTurnTarget,
  RuleTarget,
  PlanRowTarget,
]);
export type LinkTarget = z.infer<typeof LinkTarget>;

export const BlockLink = z
  .strictObject({
    block: z
      .union([z.string().min(1), z.number().int().min(0)])
      .optional()
      .describe(
        'The block the link is for: its id, or its index when blocks have no id. Absent: every block.',
      ),
    to: LinkTarget.describe('What the block is linked to.'),
    relation: LinkRelation.optional().describe('How the block relates to the target. Default verifies.'),
    status: LinkStatus.describe(
      'How much the link is trusted: declared, attributed, verified, refuted or stale.',
    ),
    created_by: z
      .enum(LINK_CREATORS)
      .optional()
      .describe('Who made the link: generator, author, attribution, citation, ir or mutation.'),
    at_version: z
      .string()
      .min(1)
      .optional()
      .describe('The version of the target (the prompt version for a section) the link was made at.'),
    evidence: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('What supports the status, keyed by status, such as verified: {mutant, runs, flips}.'),
  })
  .describe(
    'One link from a block of the spec to a prompt section, a spec clause, a rule, a plan row or a past turn.',
  );
export type BlockLink = z.infer<typeof BlockLink>;

export const BlockLinks = z.array(BlockLink).describe('The links of the blocks of a spec.');
