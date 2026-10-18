import { realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { chaoCoverage, goodTuringDiscovery, seededRandom } from '@agent-nexus/driftbench-space';
import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { ModelPort } from '../model/port';
import { type IntakeMap, intentDimension } from './map';
import {
  type AnonymisedTurns,
  anonymiseTurns,
  detectPass1,
  detectPass2,
  type Finding,
  type SecondPass,
} from './privacy';
import { gramCosine, gramTfidf, leaderClusters } from './text';

/**
 * Path (i) of the reference set: past conversations become a private, anonymised set. The input is JSON
 * Lines, one conversation per line:
 *
 *   {"id": "c-001", "turns": [{"role": "user", "text": "..."}, {"role": "agent", "text": "..."}],
 *    "flags": ["negative_feedback"], "channel": "chat"}
 *
 * `role` is user or agent (assistant is read as agent). `id`, `flags`, `channel` and `lang` are optional;
 * the flags named in FAILURE_FLAGS mark a failure, which goes first (failure-first intake). Nothing is
 * written next to the input: the set goes only under a private folder outside any git work tree.
 */

export const FAILURE_FLAGS = ['negative_feedback', 'incident', 'error', 'escalation', 'complaint'] as const;

const Turn = z.strictObject({
  role: z.enum(['user', 'agent', 'assistant']),
  text: z.string(),
});

export const LogConversation = z
  .strictObject({
    id: z.string().min(1).optional(),
    turns: z.array(Turn).min(1),
    flags: z.array(z.string().min(1)).optional(),
    channel: z.string().min(1).optional(),
    lang: z.string().min(1).optional(),
  })
  .describe('One past conversation, one per line of the JSONL file.');
export type LogConversation = z.infer<typeof LogConversation>;

export type ParsedConversation = {
  id: string;
  line: number;
  turns: Array<{ role: 'user' | 'agent'; text: string }>;
  flags: string[];
  channel?: string;
  lang?: string;
};

export type ParseLogs =
  | {
      ok: true;
      conversations: ParsedConversation[];
      /** Ids, flags, channels and languages that held personal data, replaced or dropped. */
      replaced: number;
    }
  | { ok: false; errors: Array<{ line: number; message: string }> };

/**
 * True when a short field (an id, a flag) holds what the privacy passes would redact. A long digit run
 * alone does not count: ticket and trace numbers are provenance, not personal data.
 */
function carriesPersonalData(text: string): boolean {
  return detectPass1(text).length > 0 || detectPass2(text).some((finding) => finding.type !== 'long_number');
}

/**
 * Parses the JSONL text. An error names the line and the field, never the text of the line: the input is
 * private and an error message is printed. An id that holds personal data (an email used as an id) becomes
 * `line-<n>`; a flag, channel or language that does is dropped. Both are counted in `replaced`.
 */
export function parseLogs(text: string): ParseLogs {
  const conversations: ParsedConversation[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const ids = new Map<string, number>();
  let replaced = 0;
  text.split('\n').forEach((content, index) => {
    const line = index + 1;
    if (content.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      errors.push({ line, message: 'not a JSON object' });
      return;
    }
    const parsed = LogConversation.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({ line, message: `${issue?.path.map(String).join('.') || '(line)'}: ${issue?.message}` });
      return;
    }
    const given = parsed.data.id ?? `line-${line}`;
    const first = ids.get(given);
    if (first !== undefined) {
      errors.push({ line, message: `id: the id of line ${first} again` });
      return;
    }
    ids.set(given, line);
    const keep = (value: string | undefined) => {
      if (value === undefined || !carriesPersonalData(value)) return value;
      replaced += 1;
      return undefined;
    };
    const id = keep(given) ?? `line-${line}`;
    const flags = (parsed.data.flags ?? []).filter((flag) => keep(flag) !== undefined);
    const channel = keep(parsed.data.channel);
    const lang = keep(parsed.data.lang);
    conversations.push({
      id,
      line,
      turns: parsed.data.turns.map((turn) => ({
        role: turn.role === 'user' ? 'user' : 'agent',
        text: turn.text,
      })),
      flags,
      ...(channel ? { channel } : {}),
      ...(lang ? { lang } : {}),
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  if (conversations.length === 0)
    return { ok: false, errors: [{ line: 0, message: 'the file holds no conversation' }] };
  const taken = new Set<string>();
  for (const conversation of conversations) {
    if (taken.has(conversation.id)) conversation.id = `line-${conversation.line}`;
    taken.add(conversation.id);
  }
  return { ok: true, conversations, replaced };
}

/**
 * The git work tree a path sits in, or undefined: the nearest folder at or above it that holds `.git`
 * (a folder, or the file a linked worktree uses). The path need not exist yet. Both the path as written and
 * its real path (symbolic links followed from the nearest existing ancestor) are checked, so a link cannot
 * route the private set into a repository.
 */
export async function gitWorkTreeOf(path: string): Promise<string | undefined> {
  const written = resolve(path);
  let existing = written;
  while (!(await exists(existing))) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = await realpath(existing).catch(() => existing);
  for (const start of [written, real]) {
    let dir = start;
    for (;;) {
      if (await exists(join(dir, '.git'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

export type LogIntakeOptions = {
  map?: IntakeMap;
  /** The map dimension that names intents. Default: flow, intent, then the first behaviour dimension. */
  intentDimension?: string;
  second: SecondPass;
  port?: ModelPort;
  /** Conversations in the spot-check sample. Default 20. */
  spotCheck?: number;
  seed?: number;
  /** Cosine at or above which two conversations are near-duplicates. Default 0.95. */
  dedup?: number;
  /** Cosine at or above which an opening takes the closest intent of the map. Default 0.1. */
  intentThreshold?: number;
  /** Cosine at or above which two openings no map intent took share a new intent. Default 0.3. */
  clusterThreshold?: number;
};

export type IntakeConversation = ParsedConversation & {
  anonymised: AnonymisedTurns;
  failure: boolean;
  intent: string;
  /** The map value the intent came from, or false for a new intent found in the logs. */
  fromMap: boolean;
};

export type LogIntake = {
  kept: IntakeConversation[];
  /** Near-duplicates dropped, each with the conversation kept in its place. */
  duplicates: Array<{ id: string; keptAs: string; score: number }>;
  intentDimension: string;
  intents: Array<{ id: string; title: string; fromMap: boolean; conversations: number; example: string }>;
  detections: {
    pass1: Record<string, number>;
    pass2: Record<string, number>;
    model: Record<string, number>;
    /** Of the pass 1 findings, how many were reserved fictional data (example.com, 555-01xx). */
    fictional: number;
  };
  /** Conversations where pass 2 or the model found something pass 1 missed. */
  residual: Array<{ id: string; types: string[] }>;
  model: { checked: number; failed: Array<{ id: string; reason: string }>; unmatched: number };
  discovery: { n: number; f1: number; f2: number; probability: number; coverage: number };
  spotCheck: string[];
  seed: number;
};

/**
 * Runs path (i) on parsed conversations: anonymise (pass 1, then the second pass), drop near-duplicates
 * (failures are kept first), place each conversation on an intent, estimate how likely the next one shows
 * an unseen intent, and draw the spot-check sample.
 */
export async function intakeLogs(
  conversations: readonly ParsedConversation[],
  options: LogIntakeOptions,
): Promise<LogIntake> {
  const seed = options.seed ?? 1;
  const anonymised: IntakeConversation[] = [];
  for (const conversation of conversations) {
    const result = await anonymiseTurns(conversation.id, conversation.turns, {
      second: options.second,
      ...(options.port ? { port: options.port } : {}),
    });
    anonymised.push({
      ...conversation,
      anonymised: result,
      failure: conversation.flags.some((flag) => (FAILURE_FLAGS as readonly string[]).includes(flag)),
      intent: '',
      fromMap: false,
    });
  }

  // Near-duplicates, compared on what the user wrote after redaction. Failures go first, so a failure is
  // the one kept (keep the hardest variant of a duplicate group).
  const ordered = [...anonymised].sort((a, b) => Number(b.failure) - Number(a.failure) || a.line - b.line);
  const vectors = gramTfidf(ordered.map(userText));
  const threshold = options.dedup ?? 0.95;
  const keptIndex: number[] = [];
  const duplicates: LogIntake['duplicates'] = [];
  ordered.forEach((conversation, index) => {
    let best = -1;
    let bestScore = 0;
    for (const kept of keptIndex) {
      const score = gramCosine(vectors[index] as Map<string, number>, vectors[kept] as Map<string, number>);
      if (score > bestScore) {
        best = kept;
        bestScore = score;
      }
    }
    if (best !== -1 && bestScore >= threshold) {
      duplicates.push({
        id: conversation.id,
        keptAs: (ordered[best] as IntakeConversation).id,
        score: bestScore,
      });
    } else {
      keptIndex.push(index);
    }
  });
  const kept = keptIndex.map((index) => ordered[index] as IntakeConversation).sort((a, b) => a.line - b.line);

  const intents = placeIntents(kept, options);
  const counts = new Map<string, number>();
  for (const conversation of kept)
    counts.set(conversation.intent, (counts.get(conversation.intent) ?? 0) + 1);
  const f1 = [...counts.values()].filter((count) => count === 1).length;
  const f2 = [...counts.values()].filter((count) => count === 2).length;
  const n = kept.length;

  const detections: LogIntake['detections'] = { pass1: {}, pass2: {}, model: {}, fictional: 0 };
  const residual: LogIntake['residual'] = [];
  const failed: LogIntake['model']['failed'] = [];
  let checked = 0;
  let unmatched = 0;
  for (const conversation of anonymised) {
    const { findings, model } = conversation.anonymised;
    for (const finding of findings) {
      const bucket =
        finding.pass === 1 ? detections.pass1 : finding.pass === 2 ? detections.pass2 : detections.model;
      bucket[finding.type] = (bucket[finding.type] ?? 0) + 1;
      if (finding.pass === 1 && finding.fictional) detections.fictional += 1;
    }
    const missed = [
      ...new Set(findings.filter((finding) => finding.pass !== 1).map((finding) => finding.type)),
    ];
    if (missed.length > 0) residual.push({ id: conversation.id, types: missed.sort() });
    if (model.status === 'done') {
      checked += 1;
      unmatched += model.unmatched;
    }
    if (model.status === 'failed') failed.push({ id: conversation.id, reason: model.reason });
  }

  return {
    kept,
    duplicates,
    intentDimension: intents.dimension,
    intents: intents.list.map((intent) => ({ ...intent, conversations: counts.get(intent.id) ?? 0 })),
    detections,
    residual,
    model: { checked, failed, unmatched },
    discovery: {
      n,
      f1,
      f2,
      probability: goodTuringDiscovery(f1, n),
      coverage: chaoCoverage(f1, f2, n),
    },
    spotCheck: sampleIds(
      kept.map((conversation) => conversation.id),
      options.spotCheck ?? 20,
      seed,
    ),
    seed,
  };
}

/** What the user side of a conversation says, after redaction. */
function userText(conversation: IntakeConversation): string {
  return conversation.anonymised.turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.text)
    .join('\n');
}

/** The opening of a conversation, where the user says what they want: the first two user turns. */
function opening(conversation: IntakeConversation): string {
  return conversation.anonymised.turns
    .filter((turn) => turn.role === 'user')
    .slice(0, 2)
    .map((turn) => turn.text)
    .join('\n');
}

/**
 * Places each conversation on an intent. With a map, each intent value is a prototype (its title and its
 * approved phrases); a conversation takes the closest prototype when the cosine of its opening is at least
 * the intent threshold. A short message shares few character n-grams with a title, so that threshold is
 * low. The rest are clustered among themselves by leader clustering at the cluster threshold, as new
 * intents `new-1`, `new-2`: the intents the map did not name.
 */
function placeIntents(
  kept: IntakeConversation[],
  options: LogIntakeOptions,
): { dimension: string; list: Array<{ id: string; title: string; fromMap: boolean; example: string }> } {
  const threshold = options.intentThreshold ?? 0.1;
  const dimension = options.map ? intentDimension(options.map, options.intentDimension) : undefined;
  const prototypes = (dimension?.values ?? []).map((value) => ({
    id: value.id,
    title: value.title,
    text: [
      value.title,
      ...(options.map?.phrases ?? [])
        .filter((phrase) => phrase.dimension === dimension?.id && phrase.value === value.id)
        .map((phrase) => phrase.text),
    ].join('\n'),
  }));
  const openings = kept.map(opening);
  const vectors = gramTfidf([...prototypes.map((prototype) => prototype.text), ...openings]);
  const unplaced: number[] = [];
  kept.forEach((conversation, index) => {
    const own = vectors[prototypes.length + index] as Map<string, number>;
    let best = -1;
    let bestScore = 0;
    prototypes.forEach((_, p) => {
      const score = gramCosine(own, vectors[p] as Map<string, number>);
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    });
    if (best !== -1 && bestScore >= threshold) {
      conversation.intent = (prototypes[best] as { id: string }).id;
      conversation.fromMap = true;
    } else {
      unplaced.push(index);
    }
  });
  const clusters = leaderClusters(
    unplaced.map((index) => vectors[prototypes.length + index] as Map<string, number>),
    options.clusterThreshold ?? 0.3,
  );
  const fresh: Array<{ id: string; title: string; fromMap: boolean; example: string }> = [];
  unplaced.forEach((index, u) => {
    const id = `new-${(clusters[u] ?? 0) + 1}`;
    const conversation = kept[index] as IntakeConversation;
    conversation.intent = id;
    conversation.fromMap = false;
    if (!fresh.some((intent) => intent.id === id)) {
      fresh.push({ id, title: 'An intent the map does not name', fromMap: false, example: conversation.id });
    }
  });
  const used = prototypes
    .map((prototype) => ({
      id: prototype.id,
      title: prototype.title,
      fromMap: true,
      example: kept.find((conversation) => conversation.intent === prototype.id)?.id ?? '',
    }))
    .filter((intent) => intent.example !== '');
  return { dimension: dimension?.id ?? 'intent', list: [...used, ...fresh] };
}

/** A seeded sample of `size` ids without replacement, in their original order. */
export function sampleIds(ids: readonly string[], size: number, seed: number): string[] {
  const pool = ids.map((id, index) => ({ id, index }));
  const random = seededRandom(seed);
  const take = Math.min(size, pool.length);
  for (let index = 0; index < take; index += 1) {
    const pick = index + Math.floor(random() * (pool.length - index));
    [pool[index], pool[pick]] = [pool[pick] as (typeof pool)[number], pool[index] as (typeof pool)[number]];
  }
  return pool
    .slice(0, take)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.id);
}

export type IntakeFiles = Record<string, string>;

/**
 * The files of the private set, by name: the anonymised conversations, the user turns tagged with their
 * intent (the reference turns `intake fidelity` reads), the spot-check list for a person, and the report.
 * No raw text and no detected value is in any of them.
 */
export function intakeFiles(
  intake: LogIntake,
  source: { name: string; total: number; replaced?: number },
): IntakeFiles {
  const conversations = intake.kept.map((conversation) =>
    JSON.stringify({
      id: conversation.id,
      turns: conversation.anonymised.turns,
      flags: conversation.flags,
      ...(conversation.channel ? { channel: conversation.channel } : {}),
      ...(conversation.lang ? { lang: conversation.lang } : {}),
      [intake.intentDimension]: conversation.intent,
      anonymised: {
        pass1: countTypes(conversation.anonymised.findings, 1),
        second: countTypes(conversation.anonymised.findings, 2, 'model'),
        model: conversation.anonymised.model.status,
      },
    }),
  );
  const turns = intake.kept.flatMap((conversation) =>
    conversation.anonymised.turns.flatMap((turn, index) =>
      turn.role === 'user'
        ? [
            JSON.stringify({
              id: `${conversation.id}#${index}`,
              text: turn.text,
              cell: {
                [intake.intentDimension]: conversation.intent,
                ...(conversation.channel ? { channel: conversation.channel } : {}),
              },
              origin: 'logs',
            }),
          ]
        : [],
    ),
  );
  const residualIds = new Set(intake.residual.map((entry) => entry.id));
  const byId = new Map(intake.kept.map((conversation) => [conversation.id, conversation]));
  const entry = (id: string) => {
    const conversation = byId.get(id) as IntakeConversation;
    return {
      id,
      flags: conversation.flags,
      residual: intake.residual.find((item) => item.id === id)?.types ?? [],
      turns: conversation.anonymised.turns,
      clean: null,
      note: '',
    };
  };
  const mustRead = intake.kept
    .map((conversation) => conversation.id)
    .filter((id) => residualIds.has(id) && !intake.spotCheck.includes(id));
  const spotCheck = [
    '# Spot check of the anonymised conversations. Read each one in full.',
    '# Set clean: true when no personal data remains, false when some does, and say what in note.',
    `# sample: a seeded random draw (seed ${intake.seed}) of ${intake.spotCheck.length} of ${intake.kept.length} conversations;`,
    '# its share of clean conversations estimates the share for the whole set.',
    '# must_read: conversations where the second pass found what pass 1 missed, outside the sample.',
    stringifyYaml(
      { seed: intake.seed, sample: intake.spotCheck.map(entry), must_read: mustRead.map(entry) },
      { lineWidth: 0, aliasDuplicateObjects: false },
    ),
  ].join('\n');
  const report = {
    source: source.name,
    conversations: {
      read: source.total,
      fields_replaced: source.replaced ?? 0,
      kept: intake.kept.length,
      near_duplicates: intake.duplicates.length,
      failures: intake.kept.filter((conversation) => conversation.failure).length,
    },
    detections: intake.detections,
    residual: { conversations: intake.residual.length, by_conversation: intake.residual },
    model_check: {
      checked: intake.model.checked,
      failed: intake.model.failed,
      spans_not_found: intake.model.unmatched,
    },
    duplicates: intake.duplicates,
    intents: { dimension: intake.intentDimension, list: intake.intents },
    discovery: intake.discovery,
    spot_check: { seed: intake.seed, sample: intake.spotCheck, must_read: mustRead },
  };
  return {
    'conversations.jsonl': `${conversations.join('\n')}\n`,
    'reference-turns.jsonl': `${turns.join('\n')}\n`,
    'spot-check.yaml': spotCheck,
    'intake-report.json': `${JSON.stringify(report, null, 2)}\n`,
  };
}

function countTypes(findings: readonly Finding[], ...passes: Array<Finding['pass']>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    if (passes.includes(finding.pass)) counts[finding.type] = (counts[finding.type] ?? 0) + 1;
  }
  return counts;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
