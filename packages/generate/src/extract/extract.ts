import { ModelError, type ModelPort } from '../model/port';
import { acceptAnswer, type Draft, type Refusal } from './accept';
import { chunkSources } from './chunks';
import { rawizeAnswer, viewSources } from './containers';
import { parseAnswer, retryNote, SECTIONS, type Section, type SourceText, sectionRequest } from './contract';
import { inventoryPrepass } from './prepass';
import { checkQuotes, PROPOSAL_VERSION, type Proposal, validateProposal } from './proposal';
import { QuoteIndex, shortQuote } from './quote';
import { requoted, tableInventory } from './tables';
import { toolsPrepass } from './tools';

export type ExtractInput = {
  /** The agent the map describes. */
  agent: string;
  /**
   * The files to read, each with the path the proposal records (relative to the proposal's folder). One
   * inventory, at most one tools file, any number of prompts.
   */
  sources: readonly SourceText[];
  /** The model for the five sections. Without it, only the code pre-pass runs. */
  port?: ModelPort;
  now?: () => Date;
  maxTokens?: number;
};

export type SectionRun = {
  section: Section;
  /** Model calls made for the section: 1, or 2 after an unreadable answer. */
  calls: number;
  status: 'done' | 'failed';
  /** Values, constraints and phrases the section added. */
  accepted: number;
  /** Why the section failed, when it did. */
  error?: string;
  /** The start of the last unreadable answer, for the report. */
  excerpt?: string;
};

export type InputError = { source: string; code: string; path: string; message: string };

export type ExtractResult =
  | {
      ok: true;
      proposal: Proposal;
      /** What the code pre-pass alone proposed. */
      prepass: { dimensions: number; values: number; constraints: number; relations: number };
      sections: SectionRun[];
      refusals: Refusal[];
      duplicates: string[];
      notes: string[];
      calls: number;
    }
  | { ok: false; errors: InputError[] };

/**
 * Proposes the map. First the code pre-pass, without a model: the inventory's behaviours, flows, deviation
 * classes and channels, the recovery the inventory already fixes (a detour returns to the pending stage),
 * and the tool schemas' boundary values. Then, with a model, one call per section (stages, rules, personas,
 * data, phrases, relations): an unreadable answer is retried once and then reported, and
 * every entry is checked on its own (see `acceptAnswer`). Every entry comes out with `approved: false`.
 */
export async function extractMap(input: ExtractInput): Promise<ExtractResult> {
  const inventories = input.sources.filter((source) => source.kind === 'inventory');
  const toolFiles = input.sources.filter((source) => source.kind === 'tools');
  const inventory = inventories[0];
  if (!inventory || inventories.length > 1) {
    return inputError('', 'EXTRACT_INPUT', 'give exactly one inventory');
  }
  if (toolFiles.length > 1) return inputError('', 'EXTRACT_INPUT', 'give at most one tools file');
  const paths = new Set(input.sources.map((source) => source.path));
  if (paths.size !== input.sources.length) return inputError('', 'EXTRACT_INPUT', 'a source is given twice');

  const lower = inventory.path.toLowerCase();
  const format = lower.endsWith('.json') ? 'json' : 'yaml';
  // An inventory kept as markdown tables or CSV is read into the mapping an inventory holds.
  const table = lower.endsWith('.csv')
    ? tableInventory(inventory.text, 'csv')
    : lower.endsWith('.md') || lower.endsWith('.markdown')
      ? tableInventory(inventory.text, 'markdown')
      : undefined;
  const fromInventory = table
    ? requoted(inventoryPrepass(table.yaml, inventory.path, 'yaml'), table.requote)
    : inventoryPrepass(inventory.text, inventory.path, format);
  if (!fromInventory.ok) {
    return {
      ok: false,
      errors: fromInventory.errors.map((issue) => ({ source: inventory.path, ...issue })),
    };
  }
  const draft: Draft = {
    dimensions: [...fromInventory.dimensions],
    constraints: [...fromInventory.constraints],
    phrases: [],
    relations: [...fromInventory.relations],
  };
  const notes = [...fromInventory.notes];
  const toolFile = toolFiles[0];
  if (toolFile) {
    const fromTools = toolsPrepass(toolFile.text, toolFile.path);
    if (!fromTools.ok) {
      return { ok: false, errors: fromTools.errors.map((issue) => ({ source: toolFile.path, ...issue })) };
    }
    draft.dimensions.push(...fromTools.dimensions);
    notes.push(...fromTools.notes);
  }
  const prepass = {
    dimensions: draft.dimensions.length,
    values: draft.dimensions.reduce((sum, dimension) => sum + dimension.values.length, 0),
    constraints: draft.constraints.length,
    relations: draft.relations.length,
  };

  const texts = new Map(input.sources.map((source) => [source.path, source.text]));
  const seen = viewSources(input.sources);
  const quotes = new QuoteIndex(texts);
  const sections: SectionRun[] = [];
  const refusals: Refusal[] = [];
  const duplicates: string[] = [];
  const deferred: Array<{ section: Section; raw: unknown; entry: string }> = [];
  if (input.port) {
    for (const section of SECTIONS) {
      const run = await runSection(section, input.port, seen, draft, quotes, input.maxTokens, input.sources);
      sections.push(run.run);
      refusals.push(...run.refusals);
      duplicates.push(...run.duplicates);
      deferred.push(...run.deferred.map((entry) => ({ section, ...entry })));
    }
    // A constraint can be stated in a chunk before the chunk that names its values: it waits for the whole map.
    for (const entry of deferred) {
      const again = acceptAnswer(
        entry.section,
        { section: entry.section, dimensions: [], constraints: [entry.raw], phrases: [], relations: [] },
        draft,
        quotes,
      );
      if (again.accepted === 0) continue;
      const index = refusals.findIndex(
        (refusal) => refusal.section === entry.section && refusal.entry === entry.entry,
      );
      if (index >= 0) refusals.splice(index, 1);
      const run = sections.find((one) => one.section === entry.section);
      if (run) run.accepted += again.accepted;
    }
  }

  const proposal: Proposal = {
    version: PROPOSAL_VERSION,
    agent: input.agent,
    produced_by: {
      family: input.port ? input.port.family : 'code',
      model: input.port ? (input.port.model ?? 'unknown') : 'pre-pass',
      at: (input.now ?? (() => new Date()))().toISOString(),
    },
    sources: input.sources.map(({ kind, path }) => ({ kind, path })),
    dimensions: draft.dimensions,
    constraints: draft.constraints,
    phrases: draft.phrases,
    ...(draft.relations.length > 0 ? { relations: draft.relations } : {}),
  };
  // Every entry was checked on the way in; these two checks keep that promise if the code ever drifts.
  const checked = validateProposal(proposal);
  const problems = checked.ok ? checkQuotes(proposal, texts) : checked.errors;
  if (problems.length > 0) {
    const first = problems[0];
    throw new Error(
      `the extractor built an invalid proposal: ${first?.path} ${first?.code} ${first?.message}`,
    );
  }
  return {
    ok: true,
    proposal,
    prepass,
    sections,
    refusals,
    duplicates,
    notes,
    calls: sections.reduce((sum, run) => sum + run.calls, 0),
  };
}

type SectionOutcome = {
  run: SectionRun;
  refusals: Refusal[];
  duplicates: string[];
  deferred: Array<{ raw: unknown; entry: string }>;
};

async function runSection(
  section: Section,
  port: ModelPort,
  sources: readonly SourceText[],
  draft: Draft,
  quotes: QuoteIndex,
  maxTokens: number | undefined,
  files: readonly SourceText[],
): Promise<SectionOutcome> {
  // A long prompt is read in chunks, one request each; the short sources go in every request.
  const rounds = chunkSources(sources);
  const total: SectionOutcome = {
    run: { section, calls: 0, status: 'done', accepted: 0 },
    refusals: [],
    duplicates: [],
    deferred: [],
  };
  for (const chunk of rounds) {
    const one = await runRequest(section, port, chunk, draft, quotes, maxTokens, files);
    total.run.calls += one.run.calls;
    total.run.accepted += one.run.accepted;
    if (one.run.status === 'failed') {
      total.run.status = 'failed';
      total.run.error = one.run.error;
      if (one.run.excerpt) total.run.excerpt = one.run.excerpt;
    }
    total.refusals.push(...one.refusals);
    total.duplicates.push(...one.duplicates);
    total.deferred.push(...one.deferred);
  }
  return total;
}

async function runRequest(
  section: Section,
  port: ModelPort,
  sources: readonly SourceText[],
  draft: Draft,
  quotes: QuoteIndex,
  maxTokens: number | undefined,
  files: readonly SourceText[],
): Promise<SectionOutcome> {
  const request = sectionRequest(section, sources, draft, maxTokens);
  let reason = '';
  let excerpt = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = attempt === 1 ? request.user : `${request.user}\n\n${retryNote(reason)}`;
    let text: string;
    try {
      text = await port.complete({ ...request, user });
    } catch (cause) {
      const message = cause instanceof ModelError ? `${cause.code}: ${cause.message}` : String(cause);
      return {
        run: {
          section,
          calls: attempt,
          status: 'failed',
          accepted: 0,
          error: `the model call failed (${message})`,
        },
        refusals: [],
        duplicates: [],
        deferred: [],
      };
    }
    const parsed = parseAnswer(section, text);
    if (parsed.ok) {
      const accepted = acceptAnswer(section, rawizeAnswer(parsed.answer, files), draft, quotes);
      return {
        run: { section, calls: attempt, status: 'done', accepted: accepted.accepted },
        refusals: accepted.refusals,
        duplicates: accepted.duplicates,
        deferred: accepted.deferred,
      };
    }
    reason = parsed.reason;
    excerpt = shortQuote(text, 120);
  }
  return {
    run: {
      section,
      calls: 2,
      status: 'failed',
      accepted: 0,
      error: `the answer could not be read, twice: ${reason}`,
      excerpt,
    },
    refusals: [],
    duplicates: [],
    deferred: [],
  };
}

function inputError(source: string, code: string, message: string): ExtractResult {
  return { ok: false, errors: [{ source, code, path: '', message }] };
}
