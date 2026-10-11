import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isPlainObject } from '@driftbench/core';
import { Document, isMap, isSeq, parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { QuoteIndex } from './quote';
import { checkSpaceMap } from './space';

/**
 * The map proposal: the places where an agent's behaviour is specified, as dimensions, values, constraints
 * and a phrase bank. Code and a model propose every entry with the quote that justifies it; each entry says
 * which of the two proposed it. A person approves a dimension with one flag, which its values inherit
 * (a value may override it), and approves each constraint and phrase. A dimension is an axis of the space
 * map or a detail the generator varies inside a cell. Code enumerates blocks later from approved entries.
 */

export const PROPOSAL_VERSION = 1;

export const DIMENSION_KINDS = [
  'stage',
  'behaviour',
  'deviation',
  'persona',
  'channel',
  'data',
  'task',
] as const;
export const DimensionKind = z
  .enum(DIMENSION_KINDS)
  .describe(
    'What the dimension varies: a flow stage, a behaviour or rule, a deviation class, a kind of user, a channel, a data case, or a task setting for code agents.',
  );
export type DimensionKind = z.infer<typeof DimensionKind>;

export const SOURCE_KINDS = ['prompt', 'inventory', 'tools'] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

export const DimensionId = z.string().regex(/^[a-z][a-z0-9_.-]*$/, {
  error:
    'expected a dimension id such as stage or coverage.check.in.address: lowercase letters, digits, dots, hyphens and underscores',
});

export const ValueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, {
  error:
    'expected a value id such as offer, B-001 or D4_loose_confirmation: letters, digits, dots, hyphens and underscores',
});

export const Lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, {
  error: 'expected a language tag such as en, nl or pt-BR',
});

/** The longest quote a proposal accepts. A quote names the passage that justifies one entry, not a file. */
export const MAX_QUOTE_LENGTH = 1000;

const EVIDENCE_MISSING =
  'evidence is missing: every value and constraint quotes the source that justifies it';
const QUOTE_MISSING = 'the quote is missing: copy the source text that justifies the entry';

export const Evidence = z
  .strictObject(
    {
      source: z
        .string({ error: 'the source is missing: name the path of the source, as listed in sources' })
        .min(1)
        .describe('The path of the source, exactly as listed in sources.'),
      quote: z
        .string({ error: QUOTE_MISSING })
        .max(MAX_QUOTE_LENGTH, { error: `a quote is at most ${MAX_QUOTE_LENGTH} characters` })
        .refine((quote) => quote.trim() !== '', { error: QUOTE_MISSING })
        .describe('Text copied word for word from the source: it justifies the entry.'),
    },
    { error: (issue) => (issue.input === undefined ? EVIDENCE_MISSING : undefined) },
  )
  .describe('Where the entry comes from: a source path and a quote from it.');
export type Evidence = z.infer<typeof Evidence>;

const Approved = z
  .boolean({ error: 'approved must be true or false' })
  .describe('False until a person approves the entry.');

export const ORIGINS = ['code', 'model'] as const;
export const Origin = z
  .enum(ORIGINS, { error: 'produced_by is code or model' })
  .describe('Who proposed the entry: code (the pre-pass) or a model (a section answer).');
export type Origin = z.infer<typeof Origin>;

export const ROLES = ['axis', 'detail'] as const;
export const Role = z
  .enum(ROLES, { error: 'role is axis or detail' })
  .describe(
    'axis: a dimension of the space map, crossed with the other axes. detail: varied by the generator inside a cell, as boundary values.',
  );
export type Role = z.infer<typeof Role>;

export const ProposalValue = z
  .strictObject({
    id: ValueId,
    title: z.string().min(1).describe('What the value means, in a few words.'),
    evidence: Evidence,
    produced_by: Origin,
    approved: Approved.optional().describe(
      "Overrides the dimension's flag for this value. Absent: the value inherits it.",
    ),
  })
  .describe('One value of a dimension.');
export type ProposalValue = z.infer<typeof ProposalValue>;

export const ProposalDimension = z
  .strictObject({
    id: DimensionId,
    title: z.string().min(1).describe('What the dimension varies.'),
    kind: DimensionKind,
    role: Role,
    produced_by: Origin,
    approved: Approved.describe('The approval of the dimension and every value without its own flag.'),
    values: z.array(ProposalValue).min(1, { error: 'a dimension needs at least one value' }),
  })
  .describe('One axis a situation varies on, with its values.');
export type ProposalDimension = z.infer<typeof ProposalDimension>;

export const ProposalConstraint = z
  .strictObject({
    forbid: z
      .record(DimensionId, ValueId)
      .refine((forbid) => Object.keys(forbid).length >= 2, {
        error: 'a constraint forbids a combination: name at least two dimensions',
      })
      .describe('A combination of values, one per dimension, that can never occur together.'),
    reason: z.string().min(1).describe('Why the combination cannot occur.'),
    evidence: Evidence,
    produced_by: Origin,
    approved: Approved,
  })
  .describe('A combination of values that cannot occur.');
export type ProposalConstraint = z.infer<typeof ProposalConstraint>;

export const ProposalPhrase = z
  .strictObject({
    dimension: DimensionId,
    value: ValueId,
    text: z.string().min(1).max(500).describe('One user message that expresses the value.'),
    lang: Lang,
    evidence: Evidence.optional().describe('The source example the phrase copies, when there is one.'),
    produced_by: Origin,
    approved: Approved,
  })
  .describe('One phrasing of a value, for the phrase bank.');
export type ProposalPhrase = z.infer<typeof ProposalPhrase>;

export const ProposalSource = z
  .strictObject({
    kind: SourceKind,
    path: z.string().min(1).describe('The path of the file, relative to the folder of the proposal.'),
  })
  .describe('A file the entries quote.');
export type ProposalSource = z.infer<typeof ProposalSource>;

export const ProducedBy = z
  .strictObject({
    family: z.string().min(1).describe('The model family, `code` for the code pre-pass alone.'),
    model: z.string().min(1).describe('The model as its provider names it.'),
    at: z.iso.datetime().describe('When the proposal was produced, in UTC.'),
  })
  .describe('Who proposed the entries.');
export type ProducedBy = z.infer<typeof ProducedBy>;

export const Proposal = z
  .strictObject({
    version: z.literal(PROPOSAL_VERSION),
    agent: z.string().min(1).describe('The agent the map describes.'),
    produced_by: ProducedBy,
    sources: z.array(ProposalSource).min(1, { error: 'a proposal quotes at least one source' }),
    dimensions: z.array(ProposalDimension),
    constraints: z.array(ProposalConstraint),
    phrases: z.array(ProposalPhrase),
  })
  .describe('A map proposal: dimensions, values, constraints and phrases, each waiting for approval.');
export type Proposal = z.infer<typeof Proposal>;

export const ProposalIssueCodes = [
  'PROPOSAL_PARSE',
  'PROPOSAL_NOT_OBJECT',
  'PROPOSAL_EVIDENCE_MISSING',
  'PROPOSAL_DUPLICATE',
  'PROPOSAL_UNKNOWN_SOURCE',
  'PROPOSAL_UNKNOWN_DIMENSION',
  'PROPOSAL_UNKNOWN_VALUE',
  'PROPOSAL_SOURCE_UNREADABLE',
  'PROPOSAL_QUOTE_NOT_FOUND',
] as const;
/** `SPACE_*` codes come from `validateSpaceMap`: every proposal must also be a valid space map. */
export type ProposalIssueCode = (typeof ProposalIssueCodes)[number] | `SCHEMA_${string}` | `SPACE_${string}`;

export type ProposalIssue = {
  code: ProposalIssueCode;
  /** Dotted path inside the proposal, such as `dimensions.2.values.0.evidence`. Empty for the whole file. */
  path: string;
  message: string;
};

export type ProposalResult = { ok: true; proposal: Proposal } | { ok: false; errors: ProposalIssue[] };

/** Parses and validates proposal text (YAML or JSON): the strict schema, then the references. */
export function parseProposalText(text: string): ProposalResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { prettyErrors: true, uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [issue('PROPOSAL_PARSE', '', describe(cause))] };
  }
  return validateProposal(raw);
}

/** Validates an already parsed value: the schema, the references, then the space map rules. Never throws. */
export function validateProposal(raw: unknown): ProposalResult {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [issue('PROPOSAL_NOT_OBJECT', '', 'a proposal file holds one mapping (an object)')],
    };
  }
  const parsed = Proposal.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(fromZod) };
  const errors = checkReferences(parsed.data);
  if (errors.length > 0) return { ok: false, errors };
  const space = checkSpaceMap(parsed.data);
  return space.length > 0 ? { ok: false, errors: space } : { ok: true, proposal: parsed.data };
}

export type LoadedProposal =
  | { ok: true; path: string; text: string; proposal: Proposal }
  | { ok: false; path: string; errors: ProposalIssue[] };

/**
 * Reads a proposal file and checks everything: the schema, the references, and every quote against its
 * source, read relative to the proposal's folder. An entry whose evidence is gone is refused here.
 */
export async function loadProposal(path: string): Promise<LoadedProposal> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      path,
      errors: [issue('PROPOSAL_PARSE', '', `cannot read the file: ${describe(cause)}`)],
    };
  }
  const parsed = parseProposalText(text);
  if (!parsed.ok) return { ok: false, path, errors: parsed.errors };
  const errors = await verifyQuotes(parsed.proposal, dirname(path));
  return errors.length > 0
    ? { ok: false, path, errors }
    : { ok: true, path, text, proposal: parsed.proposal };
}

/** Reads every source relative to `baseDir`, then checks every quote. Returns the problems found. */
export async function verifyQuotes(proposal: Proposal, baseDir: string): Promise<ProposalIssue[]> {
  const texts = new Map<string, string>();
  const errors: ProposalIssue[] = [];
  for (const [index, source] of proposal.sources.entries()) {
    try {
      texts.set(source.path, await readFile(resolve(baseDir, source.path), 'utf8'));
    } catch (cause) {
      errors.push(
        issue(
          'PROPOSAL_SOURCE_UNREADABLE',
          `sources.${index}.path`,
          `cannot read ${source.path}, so its quotes cannot be checked: ${describe(cause)}`,
        ),
      );
    }
  }
  return [...errors, ...checkQuotes(proposal, texts)];
}

/** Every evidence whose quote is not in its source's text. Sources missing from `texts` are skipped. */
export function checkQuotes(proposal: Proposal, texts: ReadonlyMap<string, string>): ProposalIssue[] {
  const index = new QuoteIndex(texts);
  const errors: ProposalIssue[] = [];
  for (const { path, evidence } of evidences(proposal)) {
    if (!index.has(evidence.source) || index.contains(evidence.source, evidence.quote)) continue;
    errors.push(
      issue(
        'PROPOSAL_QUOTE_NOT_FOUND',
        `${path}.evidence.quote`,
        `the quote is not in ${evidence.source}: an entry stands only on text its source holds`,
      ),
    );
  }
  return errors;
}

/** Every evidence of the proposal with its path: values, constraints, then phrases that carry one. */
export function evidences(proposal: Proposal): Array<{ path: string; evidence: Evidence }> {
  const found: Array<{ path: string; evidence: Evidence }> = [];
  proposal.dimensions.forEach((dimension, d) => {
    dimension.values.forEach((value, v) => {
      found.push({ path: `dimensions.${d}.values.${v}`, evidence: value.evidence });
    });
  });
  proposal.constraints.forEach((constraint, c) => {
    found.push({ path: `constraints.${c}`, evidence: constraint.evidence });
  });
  proposal.phrases.forEach((phrase, p) => {
    if (phrase.evidence) found.push({ path: `phrases.${p}`, evidence: phrase.evidence });
  });
  return found;
}

/** Whether a value counts as approved: its own flag, else its dimension's. */
export function valueApproved(dimension: ProposalDimension, value: ProposalValue): boolean {
  return value.approved ?? dimension.approved;
}

/**
 * Counts what a person decides: one flag per dimension, constraint and phrase (`total`, `approved`), and
 * the values those flags reach (`valuesApproved`, overrides included).
 */
export function countEntries(proposal: Proposal): {
  dimensions: number;
  values: number;
  constraints: number;
  phrases: number;
  total: number;
  approved: number;
  valuesApproved: number;
} {
  const flags = [
    ...proposal.dimensions.map((dimension) => dimension.approved),
    ...proposal.constraints.map((constraint) => constraint.approved),
    ...proposal.phrases.map((phrase) => phrase.approved),
  ];
  return {
    dimensions: proposal.dimensions.length,
    values: proposal.dimensions.reduce((sum, dimension) => sum + dimension.values.length, 0),
    constraints: proposal.constraints.length,
    phrases: proposal.phrases.length,
    total: flags.length,
    approved: flags.filter(Boolean).length,
    valuesApproved: proposal.dimensions.reduce(
      (sum, dimension) => sum + dimension.values.filter((value) => valueApproved(dimension, value)).length,
      0,
    ),
  };
}

/** The proposal as YAML, with a header that tells the reader how to approve it. */
export function renderProposal(proposal: Proposal): string {
  // No anchors or aliases: a person reads and edits each entry where it stands.
  const doc = new Document(proposal, { aliasDuplicateObjects: false });
  doc.commentBefore = [
    ` driftbench map proposal for ${proposal.agent}: where the agent's behaviour is specified.`,
    ' Code and a model proposed each entry with the quote that justifies it. Nothing counts until a person',
    ' approves it. A dimension has one approved flag, which its values inherit (a value may set its own);',
    ' each constraint and phrase has its own. role axis puts a dimension in the space map; detail keeps it',
    ' for the generator, inside a cell. Approve with',
    '   driftbench extract approve <this file> --dimension <id>   or   --all',
    ' An entry whose quote is missing, or no longer found in its source, is refused.',
  ].join('\n');
  const sources = doc.get('sources', true);
  if (isSeq(sources)) {
    for (const item of sources.items) if (isMap(item)) item.flow = true;
  }
  const constraints = doc.get('constraints', true);
  if (isSeq(constraints)) {
    for (const item of constraints.items) {
      const forbid = isMap(item) ? item.get('forbid', true) : undefined;
      if (isMap(forbid)) forbid.flow = true;
    }
  }
  return doc.toString({ lineWidth: 0 });
}

/** Rules the schema cannot express: unique entries, and references that resolve. */
function checkReferences(proposal: Proposal): ProposalIssue[] {
  const issues: ProposalIssue[] = [];
  const sourcePaths = new Set<string>();
  proposal.sources.forEach((source, index) => {
    if (sourcePaths.has(source.path)) {
      issues.push(
        issue('PROPOSAL_DUPLICATE', `sources.${index}.path`, `source "${source.path}" is listed twice`),
      );
    }
    sourcePaths.add(source.path);
  });
  const checkSource = (evidence: Evidence | undefined, path: string) => {
    if (evidence && !sourcePaths.has(evidence.source)) {
      issues.push(
        issue('PROPOSAL_UNKNOWN_SOURCE', `${path}.evidence.source`, `"${evidence.source}" is not in sources`),
      );
    }
  };

  const dimensions = new Map<string, Set<string>>();
  proposal.dimensions.forEach((dimension, d) => {
    const path = `dimensions.${d}`;
    if (dimensions.has(dimension.id)) {
      issues.push(issue('PROPOSAL_DUPLICATE', `${path}.id`, `dimension "${dimension.id}" is listed twice`));
    }
    const values = new Set<string>();
    dimension.values.forEach((value, v) => {
      if (values.has(value.id)) {
        issues.push(
          issue(
            'PROPOSAL_DUPLICATE',
            `${path}.values.${v}.id`,
            `value "${value.id}" is listed twice in ${dimension.id}`,
          ),
        );
      }
      values.add(value.id);
      checkSource(value.evidence, `${path}.values.${v}`);
    });
    if (!dimensions.has(dimension.id)) dimensions.set(dimension.id, values);
  });

  const reference = (dimension: string, value: string, path: string) => {
    const values = dimensions.get(dimension);
    if (!values) {
      issues.push(issue('PROPOSAL_UNKNOWN_DIMENSION', path, `dimension "${dimension}" is not in dimensions`));
    } else if (!values.has(value)) {
      issues.push(issue('PROPOSAL_UNKNOWN_VALUE', path, `value "${value}" is not a value of ${dimension}`));
    }
  };

  const forbidden = new Set<string>();
  proposal.constraints.forEach((constraint, c) => {
    const path = `constraints.${c}`;
    for (const [dimension, value] of Object.entries(constraint.forbid)) {
      reference(dimension, value, `${path}.forbid.${dimension}`);
    }
    const key = combinationKey(constraint.forbid);
    if (forbidden.has(key)) {
      issues.push(issue('PROPOSAL_DUPLICATE', `${path}.forbid`, 'the same combination is forbidden twice'));
    }
    forbidden.add(key);
    checkSource(constraint.evidence, path);
  });

  const phrases = new Set<string>();
  proposal.phrases.forEach((phrase, p) => {
    const path = `phrases.${p}`;
    reference(phrase.dimension, phrase.value, `${path}.value`);
    const key = JSON.stringify([phrase.dimension, phrase.value, phrase.lang, phrase.text.trim()]);
    if (phrases.has(key)) {
      issues.push(issue('PROPOSAL_DUPLICATE', `${path}.text`, 'the same phrase is listed twice'));
    }
    phrases.add(key);
    checkSource(phrase.evidence, path);
  });
  return issues;
}

/** A key equal for equal combinations, whatever the order of the dimensions. */
export function combinationKey(forbid: Record<string, string>): string {
  return JSON.stringify(Object.entries(forbid).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function issue(code: ProposalIssueCode, path: string, message: string): ProposalIssue {
  return { code, path, message };
}

function fromZod(zodIssue: z.core.$ZodIssue): ProposalIssue {
  const path = zodIssue.path.map(String).join('.');
  const last = zodIssue.path.at(-1);
  if (zodIssue.message === EVIDENCE_MISSING || zodIssue.message === QUOTE_MISSING) {
    return issue('PROPOSAL_EVIDENCE_MISSING', path, zodIssue.message);
  }
  let message = zodIssue.message;
  if (zodIssue.code === 'unrecognized_keys') {
    message = `unknown key${zodIssue.keys.length > 1 ? 's' : ''}: ${zodIssue.keys.join(', ')}`;
  } else if (zodIssue.code === 'invalid_type') {
    message = message.replace(/received undefined$/, 'missing');
  } else if (last === 'version' && zodIssue.code === 'invalid_value') {
    message = `this reader knows proposal version ${PROPOSAL_VERSION}`;
  }
  return issue(`SCHEMA_${zodIssue.code.toUpperCase()}`, path, message);
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message.split('\n').slice(0, 3).join(' ').trim();
  return String(cause);
}
