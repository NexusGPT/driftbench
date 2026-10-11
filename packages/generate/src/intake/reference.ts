import { readFile } from 'node:fs/promises';
import { isPair, isScalar, parseDocument, parse as parseYaml, stringify as stringifyYaml, visit } from 'yaml';
import { z } from 'zod';
import { ModelError, type ModelPort, type ModelRequest } from '../model/port';
import type { Interview } from './interview';
import { dimensionOfKind, forbiddenBy, type IntakeMap, intentDimension } from './map';
import { detectPass1, detectPass2 } from './privacy';
import { type GramVector, gramCosine, gramTfidf } from './text';

/**
 * From the interview to the reference set. Code enumerates the cells (one per example entry, language and
 * channel of its persona, minus the cells a map constraint forbids), weighs them by the declared shares,
 * allocates the turns to write, asks the model port for each cell's turns, and validates every turn in
 * code. The owner's own example messages enter the set as they are. Every turn carries its cell and the
 * answer it came from, and starts unapproved: a person approves each one before it counts.
 */

export type CellValues = Record<string, string>;

export type ReferenceCell = {
  key: string;
  values: CellValues;
  persona: string;
  intent: string;
  stage: string;
  lang: string;
  channel: string;
  /** The interview example entries the cell comes from. */
  examples: number[];
  /** The declared share of user turns that fall in this cell. The weights of all cells sum to 1. */
  weight: number;
  /** How many turns the model is asked to write for it. */
  requested: number;
};

export type DroppedCell = { key: string; reason: string };

export type CellPlan = {
  cells: ReferenceCell[];
  dropped: DroppedCell[];
  /** Example entries that produced no cell, with the reason. */
  skipped: Array<{ example: number; reason: string }>;
  dimensions: { stage: string; intent: string; channel: string };
};

/** The key of a cell: its values as `dimension=value`, space separated, in the order of the values. */
export function cellKey(values: CellValues): string {
  return Object.entries(values)
    .map(([dimension, value]) => `${dimension}=${value}`)
    .join(' ');
}

/**
 * The cells of an interview, their weights and the turns to request. Weight of a cell = share of its
 * persona x share of its intent among the persona's intents x share of its language among the persona's
 * languages x share of its channel among the persona's channels, split evenly over the stages the owner
 * gave examples for. `total` turns are allocated by largest remainder over the weights, with at least
 * `minPerCell` per cell.
 */
export function planCells(
  interview: Interview,
  map: IntakeMap,
  options: { total: number; minPerCell?: number },
): CellPlan {
  const stageId = dimensionOfKind(map, 'stage')?.id ?? 'stage';
  const intentId = intentDimension(map)?.id ?? 'intent';
  const channelId = dimensionOfKind(map, 'channel')?.id ?? 'channel';
  const share = (value: number | null) => value ?? 0;
  const personaTotal = interview.personas.reduce((sum, persona) => sum + share(persona.share), 0);
  const languageShare = new Map(interview.languages.map((entry) => [entry.lang, share(entry.share)]));
  const channelShare = new Map(interview.channels.map((entry) => [entry.value, share(entry.share)]));
  const intentFor = (persona: string) =>
    interview.intents.filter((entry) => entry.personas === undefined || entry.personas.includes(persona));

  const cells = new Map<string, ReferenceCell>();
  const dropped = new Map<string, string>();
  const skipped: CellPlan['skipped'] = [];
  interview.examples.forEach((example, index) => {
    const persona = interview.personas.find((entry) => entry.id === example.persona);
    if (!persona) return;
    if (example.turns.length === 0) {
      skipped.push({ example: index, reason: 'no message given' });
      return;
    }
    if (!intentFor(persona.id).some((entry) => entry.value === example.intent)) {
      skipped.push({ example: index, reason: `${example.intent} is not an intent of ${persona.id}` });
      return;
    }
    for (const lang of persona.languages) {
      for (const channel of persona.channels) {
        const language = interview.languages.find((entry) => entry.lang === lang);
        const values: CellValues = {
          [stageId]: example.stage,
          [intentId]: example.intent,
          persona: persona.id,
          ...sortedEntries(persona.map),
          ...sortedEntries(language?.map ?? {}),
          [channelId]: channel,
          lang,
        };
        const key = cellKey(values);
        const reason = forbiddenBy(map, values);
        if (reason !== undefined) {
          dropped.set(key, reason);
          continue;
        }
        const existing = cells.get(key);
        if (existing) {
          if (!existing.examples.includes(index)) existing.examples.push(index);
          continue;
        }
        cells.set(key, {
          key,
          values,
          persona: persona.id,
          intent: example.intent,
          stage: example.stage,
          lang,
          channel,
          examples: [index],
          weight: 0,
          requested: 0,
        });
      }
    }
  });

  const list = [...cells.values()];
  const stagesOf = new Map<string, Set<string>>();
  for (const cell of list) {
    const group = `${cell.persona}|${cell.intent}|${cell.lang}|${cell.channel}`;
    const stages = stagesOf.get(group) ?? new Set<string>();
    stages.add(cell.stage);
    stagesOf.set(group, stages);
  }
  for (const cell of list) {
    const persona = interview.personas.find((entry) => entry.id === cell.persona);
    if (!persona || personaTotal === 0) continue;
    const intents = intentFor(persona.id);
    const intentTotal = intents.reduce((sum, entry) => sum + share(entry.share), 0);
    const langTotal = persona.languages.reduce((sum, lang) => sum + (languageShare.get(lang) ?? 0), 0);
    const channelTotal = persona.channels.reduce((sum, value) => sum + (channelShare.get(value) ?? 0), 0);
    const intentShare = share(intents.find((entry) => entry.value === cell.intent)?.share ?? null);
    const stages = stagesOf.get(`${cell.persona}|${cell.intent}|${cell.lang}|${cell.channel}`)?.size ?? 1;
    cell.weight =
      (share(persona.share) / personaTotal) *
      ratio(intentShare, intentTotal) *
      ratio(languageShare.get(cell.lang) ?? 0, langTotal) *
      ratio(channelShare.get(cell.channel) ?? 0, channelTotal) *
      (1 / stages);
  }
  const weightTotal = list.reduce((sum, cell) => sum + cell.weight, 0);
  for (const cell of list) cell.weight = weightTotal > 0 ? cell.weight / weightTotal : 0;
  const kept = list.filter((cell) => {
    if (cell.weight > 0) return true;
    dropped.set(cell.key, 'a share of 0: no user is declared in this cell');
    return false;
  });
  allocate(kept, options.total, options.minPerCell ?? 1);
  return {
    cells: kept,
    dropped: [...dropped].map(([key, reason]) => ({ key, reason })),
    skipped,
    dimensions: { stage: stageId, intent: intentId, channel: channelId },
  };
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function sortedEntries(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/** Largest remainder: floor of each quota, then one more to the largest fractions, then the minimum. */
export function allocate(cells: ReferenceCell[], total: number, minPerCell: number): void {
  const quotas = cells.map((cell) => cell.weight * total);
  const floors = quotas.map((quota) => Math.floor(quota + 1e-9));
  let left = total - floors.reduce((sum, value) => sum + value, 0);
  const order = quotas
    .map((quota, index) => ({ index, fraction: quota - (floors[index] ?? 0) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    left -= 1;
  }
  cells.forEach((cell, index) => {
    cell.requested = Math.max(minPerCell, floors[index] ?? 0);
  });
}

/** The system prompt of the reference writer. */
export const REFERENCE_PROMPT = `You write the user side of a reference set used to test a conversational agent. Each request names one cell: where the agent is in the conversation (stage), what the user wants (intent), who the user is (persona), the language and the channel. Write exactly COUNT different messages that this user could send next, each a single chat message.

Rules:
- Write as the user, never as the agent. One message per item, with no speaker label and no quotes around it.
- Follow the persona's tone and the examples the owner gave, but never copy an example: vary wording, length and detail the way real users do.
- Respect everything listed under USERS NEVER.
- Write in the cell's language.
- Fictional data only: emails at example.com, phone numbers from +1 202 555 0100 to +1 202 555 0199.
- For each message, name its source: the reference of the owner's answer it is grounded on, taken from SOURCES.

Answer with one JSON object and nothing else:
{"cell": "<the cell key>", "turns": [{"text": "the message", "source": "examples.0.turns.1"}]}`;

/** The request for one cell, and the answer references the model may cite as a source. */
export function cellRequest(
  cell: ReferenceCell,
  interview: Interview,
  map: IntakeMap,
): { request: ModelRequest; sources: string[] } {
  const persona = interview.personas.find((entry) => entry.id === cell.persona);
  const title = (dimension: string, value: string) =>
    map.dimensions.find((d) => d.id === dimension)?.values.find((v) => v.id === value)?.title ?? value;
  const stageId = dimensionOfKind(map, 'stage')?.id ?? 'stage';
  const intentId = intentDimension(map)?.id ?? 'intent';
  const exampleRefs = cell.examples.flatMap((index) =>
    (interview.examples[index]?.turns ?? []).map((text, t) => ({
      ref: `examples.${index}.turns.${t}`,
      text,
    })),
  );
  const neverRefs = interview.never.map((entry, index) => ({ ref: `never.${index}`, text: entry.text }));
  const sources = [
    ...exampleRefs.map((entry) => entry.ref),
    `personas.${cell.persona}`,
    ...(interview.tone.trim() !== '' ? ['tone'] : []),
    ...neverRefs.map((entry) => entry.ref),
  ];
  const mapValues = Object.entries(persona?.map ?? {})
    .map(([dimension, value]) => `${dimension}=${value} (${title(dimension, value)})`)
    .join('; ');
  const lines = [
    `CELL: ${cell.key}`,
    `COUNT: ${cell.requested}`,
    `STAGE: ${cell.stage}: ${title(stageId, cell.stage)}`,
    `INTENT: ${cell.intent}: ${title(intentId, cell.intent)}`,
    `PERSONA: ${cell.persona}: ${persona?.description ?? ''}${persona?.tone ? ` Tone: ${persona.tone}` : ''}${mapValues ? ` Map: ${mapValues}` : ''}`,
    `LANGUAGE: ${cell.lang}`,
    `CHANNEL: ${cell.channel}`,
    `TONE OF ALL USERS: ${interview.tone.trim() || '(not given)'}`,
    'USERS NEVER:',
    ...(neverRefs.length > 0
      ? neverRefs.map((entry) => `- ${entry.ref}: ${entry.text}`)
      : ['- (nothing listed)']),
    'EXAMPLES FROM THE OWNER:',
    ...exampleRefs.map((entry) => `- ${entry.ref}: ${JSON.stringify(entry.text)}`),
    `SOURCES: ${sources.join(', ')}`,
  ];
  return { request: { system: REFERENCE_PROMPT, user: lines.join('\n'), maxTokens: 4000 }, sources };
}

/** The cell key a request names on its first line, or undefined. */
export function cellOfRequest(user: string): string | undefined {
  const first = user.split('\n', 1)[0] ?? '';
  return first.startsWith('CELL: ') ? first.slice('CELL: '.length) : undefined;
}

const AnswerTurn = z.strictObject({ text: z.string(), source: z.string() });
const Answer = z.strictObject({ cell: z.string(), turns: z.array(AnswerTurn) });

export type ReferenceAnswer =
  | { ok: true; turns: Array<{ text: string; source: string }> }
  | { ok: false; reason: string };

/** Reads one answer: JSON (a code fence is tolerated), the strict shape, and the cell it was asked for. */
export function parseReferenceAnswer(answer: string, key: string): ReferenceAnswer {
  const body = answer
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'the answer is not JSON' };
  }
  const parsed = Answer.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `${issue?.path.map(String).join('.') || '(answer)'}: ${issue?.message}` };
  }
  if (parsed.data.cell !== key)
    return { ok: false, reason: `the answer is for another cell: ${parsed.data.cell}` };
  return { ok: true, turns: parsed.data.turns };
}

export type ReferenceTurn = {
  id: string;
  cell: CellValues;
  text: string;
  origin: 'interview' | 'model';
  source: string;
};

export type RejectedTurn = { cell: string; text: string; source: string; reason: string };

export const MAX_TURN_LENGTH = 500;
const SPEAKER_LABEL = /^\s*(?:user|customer|client|agent|assistant|bot|human)\s*:/i;

/**
 * The checks every model-written turn passes in code before it enters the set, in order: no speaker label,
 * a length from 1 to MAX_TURN_LENGTH, a known source, no real-looking personal data (reserved fictional
 * data passes; an address is allowed, as stages ask for one), none of the never-match phrases, no copy of an
 * owner example, no near-duplicate of a turn already in the cell. The first failed check is the reason.
 */
export function checkTurn(
  turn: { text: string; source: string },
  context: {
    sources: readonly string[];
    never: Interview['never'];
    examples: ReadonlyArray<{ ref: string; vector: GramVector }>;
    cellTurns: ReadonlyArray<{ id: string; vector: GramVector }>;
    vector: GramVector;
    copyThreshold: number;
  },
): string | undefined {
  const text = turn.text.trim();
  if (SPEAKER_LABEL.test(text)) return 'starts with a speaker label';
  if (text === '') return 'empty';
  if (text.length > MAX_TURN_LENGTH) return `over ${MAX_TURN_LENGTH} characters`;
  if (!context.sources.includes(turn.source)) return `cites an unknown source "${turn.source}"`;
  const personal = [
    ...detectPass1(text).filter((finding) => finding.type !== 'address'),
    ...detectPass2(text).filter((finding) => ['contact', 'long_number', 'ip_address'].includes(finding.type)),
  ].find((finding) => !finding.fictional);
  if (personal) return `real-looking personal data (${personal.type})`;
  const lower = text.toLowerCase();
  for (const [index, entry] of context.never.entries()) {
    const phrase = entry.match.find((candidate) => lower.includes(candidate.toLowerCase()));
    if (phrase !== undefined) return `contains "${phrase}", which never.${index} rules out`;
  }
  for (const example of context.examples) {
    if (gramCosine(context.vector, example.vector) >= context.copyThreshold) {
      return `copies the owner example ${example.ref}`;
    }
  }
  for (const other of context.cellTurns) {
    if (gramCosine(context.vector, other.vector) >= context.copyThreshold)
      return `near-duplicate of ${other.id}`;
  }
  return undefined;
}

export type CellRun = {
  key: string;
  requested: number;
  accepted: number;
  status: 'done' | 'short' | 'failed';
  error?: string;
};

export type ReferenceSet = {
  version: 1;
  agent: string;
  produced_by: { family: string; model: string; at: string };
  interview: string;
  map: string;
  dimensions: CellPlan['dimensions'];
  cells: Array<{ key: string; values: CellValues; weight: number; requested: number; accepted: number }>;
  dropped_cells: DroppedCell[];
  turns: ReferenceTurn[];
  rejected: RejectedTurn[];
};

export type FromInterviewResult = {
  set: ReferenceSet;
  runs: CellRun[];
  calls: number;
  skipped: CellPlan['skipped'];
};

/**
 * Builds the reference set: the owner's examples first, each in its own cell (the persona's first language
 * and channel unless the entry names others), then the model's turns per cell, each checked by `checkTurn`.
 * An unreadable answer is retried once with the reason; a second failure, or a model error, fails the cell
 * and the next cells still run.
 */
export async function fromInterview(
  interview: Interview,
  map: IntakeMap,
  plan: CellPlan,
  options: {
    port: ModelPort;
    paths: { interview: string; map: string };
    now?: () => Date;
    copyThreshold?: number;
  },
): Promise<FromInterviewResult> {
  const copyThreshold = options.copyThreshold ?? 0.9;
  const exampleRefs = interview.examples.flatMap((example, index) =>
    example.turns.map((text, t) => ({ ref: `examples.${index}.turns.${t}`, text, index })),
  );
  const turns: ReferenceTurn[] = [];
  const rejected: RejectedTurn[] = [];
  const runs: CellRun[] = [];
  let calls = 0;
  const nextId = () => `t-${String(turns.length + 1).padStart(4, '0')}`;

  const cellsByExample = new Map<number, ReferenceCell>();
  for (const cell of plan.cells) {
    for (const index of cell.examples) {
      const example = interview.examples[index];
      const persona = interview.personas.find((entry) => entry.id === example?.persona);
      if (!example || !persona) continue;
      const lang = example.lang ?? persona.languages[0];
      const channel = example.channel ?? persona.channels[0];
      if (cell.lang === lang && cell.channel === channel) cellsByExample.set(index, cell);
    }
  }

  const pending: Array<{ cell: ReferenceCell; text: string; source: string; origin: 'interview' | 'model' }> =
    [];
  for (const cell of plan.cells) {
    for (const entry of exampleRefs) {
      if (cellsByExample.get(entry.index) === cell) {
        pending.push({ cell, text: entry.text.trim(), source: entry.ref, origin: 'interview' });
      }
    }
  }

  for (const cell of plan.cells) {
    const own = pending.filter((entry) => entry.cell === cell);
    for (const entry of own) {
      turns.push({
        id: nextId(),
        cell: cell.values,
        text: entry.text,
        origin: 'interview',
        source: entry.source,
      });
    }
    const { request, sources } = cellRequest(cell, interview, map);
    let answer: ReferenceAnswer = { ok: false, reason: 'no answer' };
    let error: string | undefined;
    let note = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      calls += 1;
      try {
        const text = await options.port.complete({ ...request, user: request.user + note });
        answer = parseReferenceAnswer(text, cell.key);
      } catch (cause) {
        if (!(cause instanceof ModelError)) throw cause;
        error = `${cause.code}: ${cause.message}`;
        break;
      }
      if (answer.ok) break;
      note = `\n\nYour previous answer could not be read: ${answer.reason}. Answer with the JSON object only.`;
    }
    if (error !== undefined || !answer.ok) {
      runs.push({
        key: cell.key,
        requested: cell.requested,
        accepted: 0,
        status: 'failed',
        error: error ?? (answer.ok ? '' : answer.reason),
      });
      continue;
    }
    const exampleVectors = exampleRefs.map((entry) => entry.text);
    const texts = answer.turns.map((turn) => turn.text);
    const ownTexts = own.map((entry) => entry.text);
    const vectors = gramTfidf([...exampleVectors, ...ownTexts, ...texts]);
    const examples = exampleRefs.map((entry, index) => ({
      ref: entry.ref,
      vector: vectors[index] as GramVector,
    }));
    const cellTurns = own.map((_, index) => ({
      id: turns[turns.length - own.length + index]?.id ?? '',
      vector: vectors[exampleRefs.length + index] as GramVector,
    }));
    let accepted = 0;
    answer.turns.forEach((turn, index) => {
      const vector = vectors[exampleRefs.length + own.length + index] as GramVector;
      const reason =
        accepted >= cell.requested
          ? 'more turns than asked'
          : checkTurn(turn, { sources, never: interview.never, examples, cellTurns, vector, copyThreshold });
      if (reason !== undefined) {
        rejected.push({ cell: cell.key, text: turn.text, source: turn.source, reason });
        return;
      }
      const id = nextId();
      turns.push({ id, cell: cell.values, text: turn.text.trim(), origin: 'model', source: turn.source });
      cellTurns.push({ id, vector });
      accepted += 1;
    });
    runs.push({
      key: cell.key,
      requested: cell.requested,
      accepted,
      status: accepted >= cell.requested ? 'done' : 'short',
    });
  }

  const at = (options.now ?? (() => new Date()))().toISOString();
  return {
    set: {
      version: 1,
      agent: interview.agent,
      produced_by: { family: options.port.family, model: options.port.model ?? 'unknown', at },
      interview: options.paths.interview,
      map: options.paths.map,
      dimensions: plan.dimensions,
      cells: plan.cells.map((cell) => ({
        key: cell.key,
        values: cell.values,
        weight: round(cell.weight),
        requested: cell.requested,
        accepted: runs.find((run) => run.key === cell.key)?.accepted ?? 0,
      })),
      dropped_cells: plan.dropped,
      turns,
      rejected,
    },
    runs,
    calls,
    skipped: plan.skipped,
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The reference set as YAML, with a header that says what it is and how a turn gets approved. */
export function renderReferenceSet(set: ReferenceSet): string {
  return [
    `# driftbench reference set for ${set.agent}: user turns per cell, from the owner's interview.`,
    '# origin interview: the owner wrote the message; origin model: the model wrote it and code checked it.',
    '# No turn counts until a person approves it in approval.yaml.',
    stringifyYaml(set, { lineWidth: 0, aliasDuplicateObjects: false }),
  ].join('\n');
}

const ApprovalTurn = z.strictObject({
  id: z.string().min(1),
  cell: z.string(),
  origin: z.enum(['interview', 'model']),
  text: z.string(),
  approved: z.boolean(),
});
export const Approval = z.strictObject({ reference: z.string().min(1), turns: z.array(ApprovalTurn) });
export type Approval = z.infer<typeof Approval>;

/** The approval file: one entry per turn, `approved: false`, the text repeated so a reader reads it in place. */
export function renderApproval(set: ReferenceSet, reference: string): string {
  const approval: Approval = {
    reference,
    turns: set.turns.map((turn) => ({
      id: turn.id,
      cell: cellKey(turn.cell),
      origin: turn.origin,
      text: turn.text,
      approved: false,
    })),
  };
  return [
    `# Approval of the reference set ${reference}. Read each turn: is it something a real user would write in`,
    '# this cell? Set approved: true on the turns you accept. Only approved turns count. Approve every turn with',
    '#   driftbench intake approve <this file> --all',
    stringifyYaml(approval, { lineWidth: 0, aliasDuplicateObjects: false }),
  ].join('\n');
}

export type ApprovalResult = { ok: true; approval: Approval } | { ok: false; message: string };

export function parseApproval(text: string): ApprovalResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = Approval.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue?.path.map(String).join('.') || '(file)'}: ${issue?.message}` };
  }
  const ids = parsed.data.turns.map((turn) => turn.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) return { ok: false, message: `turn ${twice} appears twice` };
  return { ok: true, approval: parsed.data };
}

/** Sets `approved: true` on every turn; comments and layout stay. Counts the flags flipped and the ones already set. */
export function approveAllTurns(
  text: string,
): { ok: true; text: string; approved: number; already: number } | { ok: false; message: string } {
  const before = parseApproval(text);
  if (!before.ok) return before;
  const doc = parseDocument(text, { uniqueKeys: true });
  let approved = 0;
  let already = 0;
  visit(doc, {
    Pair(_, pair) {
      if (!isPair(pair) || !isScalar(pair.key) || pair.key.value !== 'approved' || !isScalar(pair.value))
        return;
      if (pair.value.value === true) already += 1;
      if (pair.value.value === false) {
        pair.value.value = true;
        approved += 1;
      }
    },
  });
  const next = doc.toString({ lineWidth: 0 });
  const after = parseApproval(next);
  if (!after.ok) return after;
  return { ok: true, text: next, approved, already };
}

const RecordedAnswer = z.union([z.string().min(1), z.record(z.string(), z.unknown())]);
export const TurnRecording = z
  .strictObject({
    family: z.string().min(1),
    model: z.string().min(1),
    answers: z.record(z.string(), z.union([RecordedAnswer, z.array(RecordedAnswer).min(1)])),
  })
  .describe('Recorded answers for driftbench intake from-interview --replay, keyed by cell.');
export type TurnRecording = z.infer<typeof TurnRecording>;

export async function loadTurnRecording(
  path: string,
): Promise<{ ok: true; recording: TurnRecording } | { ok: false; message: string }> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = TurnRecording.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue?.path.map(String).join('.') || '(file)'}: ${issue?.message}` };
  }
  return { ok: true, recording: parsed.data };
}

/**
 * A port that answers each request with the next recorded answer for the cell its first line names: a
 * reference set built offline, reproducible, from answers a model gave or a person wrote by the contract.
 */
export function turnRecordingPort(recording: TurnRecording): ModelPort {
  const queues = new Map<string, string[]>();
  for (const [key, recorded] of Object.entries(recording.answers)) {
    queues.set(
      key,
      (Array.isArray(recorded) ? recorded : [recorded]).map((answer) =>
        typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2),
      ),
    );
  }
  return {
    family: recording.family,
    model: recording.model,
    async complete(request: ModelRequest): Promise<string> {
      const key = cellOfRequest(request.user);
      if (key === undefined) throw new ModelError('bad_response', 'the request does not name a cell');
      const next = queues.get(key)?.shift();
      if (next === undefined)
        throw new ModelError('exhausted', `the recording holds no answer left for ${key}`);
      return next;
    },
  };
}
