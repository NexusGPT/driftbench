import { canonicalJson } from '../spec/hash';
import { normalizePrompt } from './prompt-diff';
import { type SectionRegistry, sha256Hex } from './sections';

/**
 * Section mutation testing (M3.4): the mutants of a prompt, the runs of the suite against each, and the
 * record the analysis reads (mutation-analysis.ts). Mutation is the ground truth for a section link: a
 * declared link says a block is related to a section; only a mutant of the section that flips the block
 * says the block is sensitive to it.
 *
 * Operators, in the order the H7 runs found them useful: `drop` removes the section (deterministic, from
 * the registry span); `negate` rewrites it to instruct the opposite; `rephrase` (optional) rewrites it
 * with the same meaning. Two controls per section are meant to change nothing: `control_punctuation`
 * edits one punctuation mark (deterministic) and `control_reword` swaps a couple of ordinary words. A
 * flip under a control is noise, and a section whose controls flip a block verifies no link. Two-section
 * mutants (`pair`) negate two local sections at once; they test the selection rule, never a single link.
 *
 * The text-changing operators go through an injected mutator (a model or recorded answers). Nothing here
 * reads the prompt against a list of words: the only text checks are that a mutant changed and is not
 * empty, and that the registry's section hash matches the prompt it is applied to.
 */

export const MUTATION_OPERATORS = ['drop', 'negate', 'rephrase'] as const;
export type MutationOperator = (typeof MUTATION_OPERATORS)[number];
export const MUTATION_CONTROLS = ['control_punctuation', 'control_reword'] as const;
export type MutationControl = (typeof MUTATION_CONTROLS)[number];
export type MutantOp = MutationOperator | MutationControl | 'pair';

/** The operators whose text comes from the mutator. */
export type MutatorOp = 'negate' | 'rephrase' | 'control_reword';

/** One question to the mutator: rewrite the body of one section. */
export type MutatorRequest = {
  op: MutatorOp;
  prompt: string;
  section: string;
  title?: string;
  /** The section text, as it stands in the prompt. */
  body: string;
  /** 1 for the first try; a retry carries the reason the try before was refused. */
  attempt: number;
  feedback?: string;
};

/** Answers a mutator request with the new section text. A model, recorded answers or a test fake. */
export type Mutator = (request: MutatorRequest) => Promise<string>;

/** What the mutator is asked, per operator. Recorded answers are keyed by the request, these included. */
export const MUTATOR_INSTRUCTIONS: Record<MutatorOp, string> = {
  negate:
    "Rewrite this section of an agent's system prompt so that it instructs the opposite of its main rule: an obligation becomes a prohibition, a precondition is dropped, a stated fact becomes a different fact. Keep its length and style, plain text, no heading. Return only the new section text.",
  rephrase:
    "Rewrite this section of an agent's system prompt in other words with exactly the same meaning and instructions. Keep every quoted string, tool name, value and number as written. Plain text, no heading. Return only the new section text.",
  control_reword:
    "Replace two ordinary words of this section of an agent's system prompt with close synonyms and change nothing else. Do not touch quoted strings, tool names, values or numbers. Return only the full section text with the two words replaced.",
};

/** The key of a mutator request: what recorded answers are stored under. */
export function mutatorRequestKey(request: MutatorRequest): string {
  const { feedback: _feedback, ...asked } = request;
  return sha256Hex(canonicalJson({ ...asked, instruction: MUTATOR_INSTRUCTIONS[request.op] })).slice(0, 32);
}

/** A mutator that answers from recorded answers, keyed by `mutatorRequestKey`. A missing answer throws. */
export function recordedMutator(answers: Readonly<Record<string, string>>): Mutator {
  return async (request) => {
    const answer = answers[mutatorRequestKey(request)];
    if (answer === undefined)
      throw new MutatorMissError(
        `no recorded answer for ${request.op} of ${request.prompt}#${request.section} (try ${request.attempt}, key ${mutatorRequestKey(request)})`,
        request,
      );
    return answer;
  };
}

export class MutatorMissError extends Error {
  constructor(
    message: string,
    readonly request: MutatorRequest,
  ) {
    super(message);
    this.name = 'MutatorMissError';
  }
}

export type MutantPlan = {
  id: string;
  sections: string[];
  op: MutantOp;
  control: boolean;
  pair: boolean;
};

export type PlanOptions = {
  /** The operators per section. Default drop and negate; add rephrase to try it. */
  operators?: readonly MutationOperator[];
  /** The two controls per section. Default both. */
  controls?: readonly MutationControl[];
  /** How many two-section mutants to draw from the local sections. Default 20; 0 for none. */
  pairs?: number;
  /** The seed of the pair draw. Default 20261014. */
  seed?: number;
  /** Mutate only these sections (pairs are drawn among them). Default every section that is not stale. */
  sections?: readonly string[];
};

/** The same small generator as @agent-nexus/driftbench-stats: one seed, one sequence. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The mutants of a registry: each operator and each control on every section that is not stale, then
 * `pairs` two-section mutants drawn without repetition from the local sections, seeded.
 */
export function planMutants(registry: SectionRegistry, options: PlanOptions = {}): MutantPlan[] {
  const operators = options.operators ?? ['drop', 'negate'];
  const controls = options.controls ?? MUTATION_CONTROLS;
  const only = options.sections === undefined ? undefined : new Set(options.sections);
  for (const id of only ?? [])
    if (!registry.sections.some((section) => section.id === id))
      throw new RangeError(`the registry of ${registry.prompt_id} has no section ${id}`);
  const sections = registry.sections.filter(
    (section) => section.stale !== true && (only === undefined || only.has(section.id)),
  );
  const plans: MutantPlan[] = [];
  for (const section of sections) {
    for (const op of operators)
      plans.push({ id: `${section.id}__${op}`, sections: [section.id], op, control: false, pair: false });
    for (const op of controls)
      plans.push({ id: `${section.id}__${op}`, sections: [section.id], op, control: true, pair: false });
  }
  const local = sections.filter((section) => section.scope === 'local').map((section) => section.id);
  const wanted = Math.min(options.pairs ?? 20, (local.length * (local.length - 1)) / 2);
  const rng = mulberry32(options.seed ?? 20261014);
  const drawn = new Set<string>();
  while (drawn.size < wanted) {
    const a = Math.floor(rng() * local.length);
    let b = Math.floor(rng() * (local.length - 1));
    if (b >= a) b++;
    const pair = [local[a] as string, local[b] as string].sort();
    drawn.add(pair.join('\u0000'));
  }
  for (const key of [...drawn].sort()) {
    const sections = key.split('\u0000');
    plans.push({ id: `pair__${sections.join('__')}`, sections, op: 'pair', control: false, pair: true });
  }
  return plans;
}

export type Mutant = MutantPlan & {
  status: 'ok' | 'refused';
  /** The whole mutated prompt. Absent when refused. */
  text?: string;
  /** The SHA-256 of the mutated prompt: what runs are cached under. */
  sha256?: string;
  /** Why the mutant was refused, or the tries it took. */
  reason?: string;
  tries: number;
};

/** The text of a section in a normalised prompt, checked against the registry's hash. */
function sectionText(registry: SectionRegistry, prompt: string, id: string): string {
  const section = registry.sections.find((each) => each.id === id);
  if (!section) throw new RangeError(`the registry of ${registry.prompt_id} has no section ${id}`);
  const text = prompt.slice(section.span.start, section.span.end);
  if (sha256Hex(text) !== section.sha256)
    throw new RangeError(
      `the section ${registry.prompt_id}#${id} does not hash as the registry says: the prompt is not version ${registry.version}`,
    );
  return text;
}

/** The prompt with each named section replaced by its new text, applied from the end so spans hold. */
export function applySectionEdits(
  registry: SectionRegistry,
  prompt: string,
  edits: Readonly<Record<string, string>>,
): string {
  const spans = Object.keys(edits)
    .map((id) => {
      const section = registry.sections.find((each) => each.id === id);
      if (!section) throw new RangeError(`the registry of ${registry.prompt_id} has no section ${id}`);
      return { id, ...section.span };
    })
    .sort((a, b) => b.start - a.start);
  let out = prompt;
  for (const span of spans) out = out.slice(0, span.start) + (edits[span.id] ?? '') + out.slice(span.end);
  return out;
}

/** The deterministic punctuation control: drop the first comma outside a quote, else end the last sentence with a semicolon. */
export function punctuationControl(body: string): string | undefined {
  let quoted = false;
  for (let at = 0; at < body.length; at++) {
    const char = body[at];
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) return body.slice(0, at) + body.slice(at + 1);
  }
  const last = body.lastIndexOf('.');
  return last < 0 ? undefined : `${body.slice(0, last)};${body.slice(last + 1)}`;
}

/** Why a mutated section text is refused, or undefined when it is a mutant. */
function refusal(before: string, after: string): string | undefined {
  if (after.trim().length === 0) return 'the mutator returned an empty text';
  if (after.trim() === before.trim()) return 'the mutator returned the section unchanged';
  return undefined;
}

export type RealiseOptions = {
  mutator?: Mutator;
  /** Tries per mutator operator before the mutant is refused. Default 3. */
  tries?: number;
};

/**
 * The mutants of a plan, with their whole prompt text and its hash. A section text from the mutator that
 * is empty or unchanged is retried with the reason, up to `tries`, then refused. A pair negates both of
 * its sections with their single `negate` texts, so it is refused when either single negate is.
 * Without a mutator, the mutator operators are refused with that reason.
 */
export async function realiseMutants(
  registry: SectionRegistry,
  promptText: string,
  plans: readonly MutantPlan[],
  options: RealiseOptions = {},
): Promise<Mutant[]> {
  const prompt = normalizePrompt(promptText);
  if (sha256Hex(prompt) !== registry.text_sha256)
    throw new RangeError(
      `the prompt does not hash as the registry of ${registry.prompt_id} ${registry.version} says`,
    );
  const tries = options.tries ?? 3;
  const bodies = new Map<string, string>();
  const done = (plan: MutantPlan, edits: Record<string, string>, count: number): Mutant => {
    const text = applySectionEdits(registry, prompt, edits);
    return { ...plan, status: 'ok', text, sha256: sha256Hex(text), tries: count };
  };
  const refused = (plan: MutantPlan, reason: string, count: number): Mutant => ({
    ...plan,
    status: 'refused',
    reason,
    tries: count,
  });
  const out: Mutant[] = [];
  for (const plan of plans.filter((each) => !each.pair)) {
    const id = plan.sections[0] as string;
    const body = sectionText(registry, prompt, id);
    if (plan.op === 'drop') {
      out.push(done(plan, { [id]: '' }, 0));
      continue;
    }
    if (plan.op === 'control_punctuation') {
      const edited = punctuationControl(body);
      out.push(
        edited === undefined
          ? refused(plan, 'the section has no comma or full stop to edit', 0)
          : done(plan, { [id]: edited }, 0),
      );
      continue;
    }
    const op = plan.op as MutatorOp;
    if (!options.mutator) {
      out.push(refused(plan, `${op} needs a mutator model, and none was given`, 0));
      continue;
    }
    const title = registry.sections.find((each) => each.id === id)?.title;
    let feedback: string | undefined;
    let accepted: string | undefined;
    let attempt = 0;
    while (accepted === undefined && attempt < tries) {
      attempt++;
      const request: MutatorRequest = {
        op,
        prompt: registry.prompt_id,
        section: id,
        ...(title === undefined ? {} : { title }),
        body,
        attempt,
        ...(feedback === undefined ? {} : { feedback }),
      };
      const answer = await options.mutator(request);
      feedback = refusal(body, answer);
      if (feedback === undefined) accepted = answer;
    }
    if (accepted === undefined) {
      out.push(refused(plan, `refused after ${attempt} tries: ${feedback}`, attempt));
      continue;
    }
    if (op === 'negate') bodies.set(id, accepted);
    out.push(done(plan, { [id]: accepted }, attempt));
  }
  for (const plan of plans.filter((each) => each.pair)) {
    const edits: Record<string, string> = {};
    const missing = plan.sections.filter((id) => !bodies.has(id));
    if (missing.length > 0) {
      out.push(refused(plan, `no accepted negate of ${missing.join(' and ')}`, 0));
      continue;
    }
    for (const id of plan.sections) edits[id] = bodies.get(id) as string;
    out.push(done(plan, edits, 0));
  }
  return out;
}

/** One run of the suite, or of some of its conversations: for each block key (`spec#block`) that ran, whether it failed. */
export type SuiteRun = Record<string, boolean>;

export type MutationRecordMutant = MutantPlan & {
  sha256: string;
  /** The stage-1 runs: every conversation, `runs` times. */
  stage1: SuiteRun[];
  /** The confirmation runs: only the conversations holding a stage-1 candidate. */
  confirm: SuiteRun[];
};

/** What a mutation run leaves: the baseline, each mutant's runs, and what was spent. */
export type MutationRecord = {
  kind: 'driftbench.mutation-run';
  version: 1;
  /**
   * A content id: the SHA-256 of the prompt, the rules, the mutants and the runs, not of what was spent.
   * A rerun read whole from the cache is the same run, with the same id.
   */
  id: string;
  prompt: { id: string; version: string; text_sha256: string };
  /** The conversations (spec ids) each stage-1 run covered. */
  conversations: string[];
  rules: { runs: number; confirm_runs: number; kill: number; confirm: number };
  baseline: SuiteRun[];
  mutants: MutationRecordMutant[];
  /** Mutants refused before any run, with why. */
  refused: { id: string; reason: string }[];
  spend: { conversation_runs: number; cached: number; usd: number };
  stopped?: string;
};

/** The content id of a record: everything but the id, the spend and why it stopped. */
export function mutationRecordId(record: Omit<MutationRecord, 'id'>): string {
  const { spend: _spend, stopped: _stopped, ...content } = record;
  return sha256Hex(canonicalJson(content)).slice(0, 16);
}

/** One conversation run of the suite against a prompt text. The usd is what it cost, when known. */
export type ConversationRunner = (
  text: string,
  conversation: string,
  rep: number,
) => Promise<{ blocks: SuiteRun; usd?: number }>;

/** Stored conversation runs, keyed by the mutant prompt hash, the conversation and the repeat. */
export type MutationCache = {
  get(key: string): SuiteRun | undefined | Promise<SuiteRun | undefined>;
  set(key: string, blocks: SuiteRun): void | Promise<void>;
};

export type MutationCost = {
  baselineRuns: number;
  stage1Runs: number;
  /** At most: every conversation of every mutant confirmed. */
  confirmRunsMax: number;
  mutatorCalls: number;
  usd: { runs: number; mutator: number; max: number };
};

/**
 * The projected cost of a mutation run, printed before the first submission. The confirmation count is
 * not known before stage 1, so the projection takes the worst case: every conversation of every mutant.
 */
export function mutationCost(input: {
  mutants: number;
  conversations: number;
  runs?: number;
  confirmRuns?: number;
  baselineRuns?: number;
  usdPerRun: number;
  mutatorCalls?: number;
  usdPerMutatorCall?: number;
}): MutationCost {
  const runs = input.runs ?? 3;
  const confirmRuns = input.confirmRuns ?? 3;
  const baselineRuns = (input.baselineRuns ?? runs) * input.conversations;
  const stage1Runs = input.mutants * input.conversations * runs;
  const confirmRunsMax = input.mutants * input.conversations * confirmRuns;
  const mutatorCalls = input.mutatorCalls ?? 0;
  const runUsd = (baselineRuns + stage1Runs + confirmRunsMax) * input.usdPerRun;
  const mutatorUsd = mutatorCalls * (input.usdPerMutatorCall ?? 0);
  return {
    baselineRuns,
    stage1Runs,
    confirmRunsMax,
    mutatorCalls,
    usd: { runs: runUsd, mutator: mutatorUsd, max: runUsd + mutatorUsd },
  };
}

export class MutationBudgetError extends Error {
  constructor(
    message: string,
    readonly cost: MutationCost,
  ) {
    super(message);
    this.name = 'MutationBudgetError';
  }
}

/** The block of a key, as `spec#block`: the spec id is the conversation. */
const conversationOf = (key: string) => key.slice(0, key.lastIndexOf('#'));

/** The baseline verdict of each block: fail when it failed in more than half of its runs, undefined on a tie. */
export function baselineVerdicts(baseline: readonly SuiteRun[]): Map<string, boolean | undefined> {
  const counts = new Map<string, { failed: number; n: number }>();
  for (const run of baseline)
    for (const [key, failed] of Object.entries(run)) {
      const count = counts.get(key) ?? { failed: 0, n: 0 };
      count.n++;
      if (failed) count.failed++;
      counts.set(key, count);
    }
  return new Map(
    [...counts].map(([key, { failed, n }]) => [key, failed * 2 === n ? undefined : failed * 2 > n]),
  );
}

/** For each block, how many of the runs flip it against its baseline verdict, of how many runs. */
export function flipCounts(
  runs: readonly SuiteRun[],
  verdicts: ReadonlyMap<string, boolean | undefined>,
): Map<string, { flips: number; n: number }> {
  const out = new Map<string, { flips: number; n: number }>();
  for (const run of runs)
    for (const [key, failed] of Object.entries(run)) {
      const base = verdicts.get(key);
      if (base === undefined) continue;
      const count = out.get(key) ?? { flips: 0, n: 0 };
      count.n++;
      if (failed !== base) count.flips++;
      out.set(key, count);
    }
  return out;
}

/**
 * Runs the suite against the baseline prompt and each mutant: stage 1 runs every conversation `runs`
 * times; a block flipped against its baseline verdict in at least `kill` of them is a candidate, and its
 * conversation is run `confirmRuns` more times. The projected cost is computed before the first
 * submission and the run is refused when it is above `budgetUsd`. Runs are cached per mutant prompt hash,
 * conversation and repeat, so a rerun after a stop sends only what is missing.
 */
export async function runMutation(input: {
  registry: SectionRegistry;
  promptText: string;
  mutants: readonly Mutant[];
  conversations: readonly string[];
  run: ConversationRunner;
  usdPerRun: number;
  budgetUsd: number;
  runs?: number;
  confirmRuns?: number;
  kill?: number;
  cache?: MutationCache;
  /** Called once with the projection, before anything is sent. */
  onProjection?: (cost: MutationCost) => void;
}): Promise<MutationRecord> {
  const runs = input.runs ?? 3;
  const confirmRuns = input.confirmRuns ?? 3;
  const kill = input.kill ?? 2;
  const ok = input.mutants.filter((mutant) => mutant.status === 'ok');
  const cost = mutationCost({
    mutants: ok.length,
    conversations: input.conversations.length,
    runs,
    confirmRuns,
    usdPerRun: input.usdPerRun,
  });
  input.onProjection?.(cost);
  if (cost.usd.max > input.budgetUsd)
    throw new MutationBudgetError(
      `the projected cost is at most ${cost.usd.max.toFixed(4)} USD, above the budget of ${input.budgetUsd} USD: nothing was sent`,
      cost,
    );
  const spend = { conversation_runs: 0, cached: 0, usd: 0 };
  const once = async (text: string, conversation: string, rep: number): Promise<SuiteRun> => {
    const key = `${sha256Hex(text)}:${conversation}:${rep}`;
    const hit = await input.cache?.get(key);
    if (hit) {
      spend.cached++;
      return hit;
    }
    const result = await input.run(text, conversation, rep);
    spend.conversation_runs++;
    spend.usd += result.usd ?? input.usdPerRun;
    await input.cache?.set(key, result.blocks);
    return result.blocks;
  };
  const suite = async (text: string, conversations: readonly string[], reps: number, offset: number) => {
    const out: SuiteRun[] = [];
    for (let rep = 0; rep < reps; rep++) {
      const run: SuiteRun = {};
      for (const conversation of conversations)
        Object.assign(run, await once(text, conversation, offset + rep));
      out.push(run);
    }
    return out;
  };
  const prompt = normalizePrompt(input.promptText);
  const baseline = await suite(prompt, input.conversations, runs, 0);
  const verdicts = baselineVerdicts(baseline);
  const mutants: MutationRecordMutant[] = [];
  for (const mutant of ok) {
    const text = mutant.text as string;
    const stage1 = await suite(text, input.conversations, runs, 0);
    const candidates = [...flipCounts(stage1, verdicts)]
      .filter(([, count]) => count.flips >= kill)
      .map(([key]) => conversationOf(key));
    const confirm =
      candidates.length === 0 ? [] : await suite(text, [...new Set(candidates)].sort(), confirmRuns, 100);
    const { text: _text, status: _status, reason: _reason, tries: _tries, ...plan } = mutant;
    mutants.push({ ...plan, sha256: mutant.sha256 as string, stage1, confirm });
  }
  const body: Omit<MutationRecord, 'id'> = {
    kind: 'driftbench.mutation-run',
    version: 1,
    prompt: { id: input.registry.prompt_id, version: input.registry.version, text_sha256: sha256Hex(prompt) },
    conversations: [...input.conversations],
    rules: { runs, confirm_runs: confirmRuns, kill, confirm: kill },
    baseline,
    mutants,
    refused: input.mutants
      .filter((mutant) => mutant.status !== 'ok')
      .map((mutant) => ({ id: mutant.id, reason: mutant.reason ?? 'refused' })),
    spend,
  };
  return { ...body, id: mutationRecordId(body) };
}
