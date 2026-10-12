import { z } from 'zod';

/**
 * What the estate generator reads. The estate map and the plan follow the estate contract
 * (`@driftbench/estate`, schema.ts); that package depends on this one, so the generator reads the parts it
 * needs structurally and the command validates both files with the estate's own schemas first. The phrase
 * bank and the session index are this module's own formats, validated here.
 */

/** One evidence predicate of an atom, as the estate contract types it. */
export type EstateEvidence =
  | { type: 'skill_loaded'; name: string; min?: number }
  | { type: 'skill_not_loaded'; name: string }
  | { type: 'guard'; name: string; verdict?: string; min?: number }
  | { type: 'tool_called'; label: string; input?: Record<string, unknown>; min?: number }
  | { type: 'tool_not_called'; label: string }
  | { type: 'ordered'; before: string; after: string }
  | { type: 'stage_reached'; name: string }
  | {
      type: 'workspace';
      created?: string[];
      changed?: string[];
      deleted?: string[];
      othersUntouched?: boolean;
    }
  | { type: 'artifact'; path: string; kind?: string }
  | { type: 'text'; must?: string[]; mustNot?: string[]; lang?: string }
  | { type: 'static'; check: string }
  | { type: 'custom'; name: string; options?: Record<string, unknown> };

export type EstateAtom = {
  id: string;
  kind: string;
  title: string;
  approved: boolean;
  situation?: string;
  evidence: EstateEvidence[];
  fields?: Record<string, unknown>;
};

export type EstateMapInput = { runtime: string; hash: string; atoms: EstateAtom[] };

export type EstatePlanRow = {
  id: string;
  atomIds: string[];
  cell: Record<string, string>;
  testType: string;
  mode: string;
  status: 'proposed' | 'approved' | 'struck';
  weight?: number;
  note?: string;
};

export type EstatePlanInput = { mapHash: string; rows: EstatePlanRow[] };

const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lower-case letters, digits, dots, underscores and hyphens');

export const BankPhrase = z.strictObject({
  text: z.string().min(1),
  lang: z.string().min(2).max(8),
  approved: z.boolean().describe('Only approved phrases reach a spec'),
});
export type BankPhrase = z.infer<typeof BankPhrase>;

/**
 * What a situation is for. `trigger` sets the atom off; `outside` is a situation just outside its trigger
 * (the act must not happen); `near_miss` reads like a route's asks and is not one; `misroute` names the
 * wrong primitive; `pressure` tempts the agent to skip a gate or a stage; `resume` picks a stopped helper up;
 * `forced` instructs the guarded act itself, so a live guard test never waits for the agent to choose it.
 */
export const SituationUse = z.enum([
  'trigger',
  'outside',
  'near_miss',
  'misroute',
  'pressure',
  'resume',
  'forced',
]);
export type SituationUse = z.infer<typeof SituationUse>;

export const Touches = z
  .strictObject({
    created: z.array(z.string().min(1)).default([]),
    changed: z.array(z.string().min(1)).default([]),
    deleted: z.array(z.string().min(1)).default([]),
  })
  .describe('The workspace paths the ask may touch; every other path stays untouched');
export type Touches = z.infer<typeof Touches>;

export const Situation = z.strictObject({
  id: Slug,
  title: z.string().min(1),
  use: SituationUse,
  atoms: z.array(z.string().min(1)).min(1).describe('The atoms this situation exercises'),
  cell: z
    .record(z.string(), z.string())
    .optional()
    .describe('Situation axis values the phrases express; a plan row must agree with each of them'),
  workspace: Slug.optional().describe('The workspace seed the ask starts from'),
  touches: Touches.optional(),
  phrases: z.array(BankPhrase).min(1),
});
export type Situation = z.infer<typeof Situation>;

export const WorkspaceSeed = z.strictObject({
  id: Slug,
  title: z.string().min(1),
  files: z.record(z.string(), z.string()),
});
export type WorkspaceSeed = z.infer<typeof WorkspaceSeed>;

export const DeviationPhrases = z.strictObject({
  class: z.string().min(1),
  phrases: z.array(BankPhrase).min(1),
});

export const PhraseBank = z.strictObject({
  version: z.literal(1),
  estate: z.string().min(1),
  mapHash: z.string().min(1).describe('The hash of the approved map the bank was written against'),
  workspaces: z.array(WorkspaceSeed).default([]),
  situations: z
    .array(Situation)
    .default([])
    .describe(
      'May be empty: a model-free run still gets the gap report, each row naming the phrase it needs',
    ),
  deviations: z.array(DeviationPhrases).default([]),
});
export type PhraseBank = z.infer<typeof PhraseBank>;

export const SessionEntry = z.strictObject({
  name: z.string().min(1).describe("The transcript's file name without .jsonl"),
  situation: Slug,
  ask: z.string().min(1).describe('The recorded ask: one approved phrase of the situation'),
  from_block: z.number().int().min(0).default(0),
  violates: z
    .array(z.string().min(1))
    .default([])
    .describe('The atoms the session breaks: a spec on any of them is planned to fail'),
  note: z.string().optional(),
});
export type SessionEntry = z.infer<typeof SessionEntry>;

export const SessionIndex = z.strictObject({
  version: z.literal(1),
  sessions: z.array(SessionEntry).min(1),
});
export type SessionIndex = z.infer<typeof SessionIndex>;

export type InputIssue = { path: string; message: string };

/** Checks the bank against the map: known atoms, known seeds, unique ids, the same map hash. */
export function checkBank(bank: PhraseBank, map: EstateMapInput): InputIssue[] {
  const issues: InputIssue[] = [];
  const atoms = new Set(map.atoms.map((atom) => atom.id));
  if (bank.mapHash !== map.hash) {
    issues.push({
      path: 'mapHash',
      message: `the bank was written against map ${short(bank.mapHash)}, the map is ${short(map.hash)}`,
    });
  }
  const seeds = new Set<string>();
  bank.workspaces.forEach((seed, index) => {
    if (seeds.has(seed.id)) issues.push({ path: `workspaces.${index}.id`, message: `${seed.id} twice` });
    seeds.add(seed.id);
  });
  const ids = new Set<string>();
  bank.situations.forEach((situation, index) => {
    const at = `situations.${index}`;
    if (ids.has(situation.id)) issues.push({ path: `${at}.id`, message: `${situation.id} twice` });
    ids.add(situation.id);
    situation.atoms.forEach((atom, position) => {
      if (!atoms.has(atom)) {
        issues.push({ path: `${at}.atoms.${position}`, message: `${atom} is no atom of the map` });
      }
    });
    if (situation.workspace !== undefined && !seeds.has(situation.workspace)) {
      issues.push({ path: `${at}.workspace`, message: `${situation.workspace} is no workspace seed` });
    }
  });
  return issues;
}

/** Checks the session index against the bank: known situations, an ask that is an approved phrase. */
export function checkSessions(index: SessionIndex, bank: PhraseBank, map: EstateMapInput): InputIssue[] {
  const issues: InputIssue[] = [];
  const atoms = new Set(map.atoms.map((atom) => atom.id));
  const names = new Set<string>();
  index.sessions.forEach((session, position) => {
    const at = `sessions.${position}`;
    if (names.has(session.name)) issues.push({ path: `${at}.name`, message: `${session.name} twice` });
    names.add(session.name);
    const situation = bank.situations.find((candidate) => candidate.id === session.situation);
    if (!situation) {
      issues.push({ path: `${at}.situation`, message: `${session.situation} is no situation of the bank` });
    } else if (!situation.phrases.some((phrase) => phrase.approved && phrase.text === session.ask)) {
      issues.push({ path: `${at}.ask`, message: `the ask is no approved phrase of ${situation.id}` });
    }
    session.violates.forEach((atom, item) => {
      if (!atoms.has(atom)) issues.push({ path: `${at}.violates.${item}`, message: `${atom} is no atom` });
    });
  });
  return issues;
}

function short(hash: string): string {
  return hash.slice(0, 12);
}
