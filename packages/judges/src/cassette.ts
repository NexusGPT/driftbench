import { randomUUID } from 'node:crypto';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { contentHash } from '@agent-nexus/driftbench-core';
import { z } from 'zod';
import { ANSWER_AUDIT_PROMPT_FINGERPRINT } from './answer-audit';
import { parseJudgeText, parseJudgeValue } from './assessment';
import type { JudgeClient } from './client';
import { JUDGE_DIALECTS } from './clients/dialects';
import { CONFORMANCE_PROMPT_FINGERPRINT } from './conformance';
import {
  inconclusive,
  JudgeAnswer,
  JudgeClass,
  JudgeOutcome,
  type JudgeRequest,
  type JudgeResult,
  parseAnswerValue,
} from './contract';
import { CRITERION_DECODER_VERSION, type CriterionDecoderVersion } from './criterion-ledger';
import type { CriterionPromptVersion } from './criterion-prompt-version';
import { JudgeError } from './http';
import { PROMPT_FINGERPRINT as LEGACY_PROMPT_FINGERPRINT } from './legacy-prompt';
import { isPairLedgerRequest } from './pair-ledger-contract';
import { criterionPromptFingerprint, PAIR_LEDGER_PROMPT_FINGERPRINT, PROMPT_FINGERPRINT } from './prompt';
import {
  RESPONSE_RELEVANCE_PROMPT_FINGERPRINT,
  validateResponseRelevanceRequest,
} from './response-relevance';

/**
 * Cassettes: recorded judge answers. A recorder wraps a live client and keeps every answer; a player
 * replays them as a client, with no network. An entry is matched by the judge id and the request key, a
 * hash of what the judge reads. A request with no entry is a cassette miss, never a made-up answer.
 *
 * An entry holds `answer` (the contract, as a system 1 client builds it) or `raw` (the model's text,
 * parsed by the contract at replay), or `error` (a call that gave no answer). Keys and headers are never
 * recorded.
 */

export const CassetteJudge = z.strictObject({
  id: z.string().min(1),
  family: z.string().min(1),
  families: z.array(z.string().min(1)).optional(),
  comparison: z.literal(true).optional(),
  /** This client owns a complete comparison from an unwrapped caller request. */
  pairPolicy: z.literal(true).optional(),
  cls: JudgeClass,
  model: z.string().optional(),
  cost: z.number().nonnegative(),
  /** The client settings it was recorded with (see `JudgeClient.settings`). Part of every key. */
  settings: z.string().optional(),
  dialect: z.string().optional(),
  reasoning: z.enum(['low', 'medium', 'high']).optional(),
});
export type CassetteJudge = z.infer<typeof CassetteJudge>;

/** Structured procedure results are application output, not model text to re-parse as a ledger. */
const ProcedureResult: z.ZodType<JudgeResult> = z.lazy(() =>
  z
    .object({
      answer: JudgeAnswer,
      raw: z.string(),
      winner: z.enum(['A', 'B', 'tie', 'inconclusive']).optional(),
      unparsed: z.boolean().optional(),
      costUsd: z.number().nonnegative().optional(),
      comparison: z
        .strictObject({
          ordered: JudgeOutcome,
          swapped: JudgeOutcome,
          consistent: z.boolean(),
          positionBias: z.boolean(),
        })
        .optional(),
      escalation: z
        .strictObject({
          triggers: z.array(
            z.enum(['order-split', 'inconclusive', 'reference-disagreement', 'low-confidence']),
          ),
          escalated: z.boolean(),
          first: z.array(ProcedureResult),
          // biome-ignore lint/suspicious/noThenProperty: then describes an audit array, never a callable.
          then: z.array(
            z.strictObject({ judge: z.string(), result: ProcedureResult, error: z.string().optional() }),
          ),
          decision: z.enum(['first', 'majority', 'first-stands', 'inconclusive']),
          calls: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .passthrough(),
);

export const CassetteEntry = z.strictObject({
  judge: z.string().min(1),
  key: z.string().min(1),
  /** The criterion name, for a reader of the file. The key decides the match. */
  criterion: z.string().optional(),
  /** Model-facing contract recorded with this entry. Missing on pre-ledger cassettes means legacy. */
  answerContract: z.enum(['ledger', 'legacy']).optional(),
  /** Missing means strict v1 for a historical default-ledger entry. */
  criterionDecoderVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  /** Missing means prompt version 1 for a historical default-ledger entry. */
  criterionPromptVersion: z.literal(2).optional(),
  /** Separates the new pair contract from older explicit-winner recordings. */
  pairContract: z.literal('ledger').optional(),
  note: z.string().optional(),
  /** Full deterministic procedure result, including its routing audit and both presentation orders. */
  result: ProcedureResult.optional(),
  answer: z.unknown().optional(),
  raw: z.string().optional(),
  error: z.string().optional(),
  /** A provider rejection retained even when the raw text happens to be complete JSON. */
  unparsedReason: z.string().optional(),
  /** What the recorded call cost in US dollars, when the client reported it. Replayed with the answer. */
  cost_usd: z.number().nonnegative().optional(),
  /** The tokens the recorded call used, when the provider reported them. Replayed with the answer. */
  usage: z
    .strictObject({
      input: z.number().nonnegative().optional(),
      output: z.number().nonnegative().optional(),
    })
    .optional(),
  /** The answer parsed only after the strict repair of unescaped quotes. Replayed with the answer. */
  repaired: z.literal(true).optional(),
});
export type CassetteEntry = z.infer<typeof CassetteEntry>;

export const Cassette = z.strictObject({
  version: z.literal(1),
  judges: z.array(CassetteJudge),
  entries: z.array(CassetteEntry),
});
export type Cassette = z.infer<typeof Cassette>;

/** What of a client a key covers: its class, its model and its settings. */
export type KeyClient = {
  readonly cls: JudgeClass;
  readonly model?: string;
  readonly settings?: string;
  readonly dialect?: string;
  readonly reasoning?: JudgeClient['reasoning'];
  readonly families?: readonly string[];
  readonly comparison?: boolean;
  readonly judgeComparison?: JudgeClient['judgeComparison'];
  readonly criterionDecoderVersion?: CriterionDecoderVersion;
};

/**
 * The data part of a key: a hash of the criterion, the data and, for a re-judge, the large budget. Stable
 * across prompt and client changes; scripted cassettes use it to pick which answers to vary.
 */
export function dataKey(request: JudgeRequest): string {
  return contentHash({
    ...(isPairLedgerRequest(request) ||
    (request.assessment?.kind === 'pairwise' && request.assessment.tieFollowup)
      ? { dialect: request.dialect ?? 'scratchpad-json', reasoning: request.reasoning }
      : {}),
    ...(request.referenceDisagreement === undefined
      ? {}
      : { referenceDisagreement: request.referenceDisagreement }),
    // Keep existing/default keys stable, including legacy and system 1 recordings.
    ...(request.presentation === 'canonical' ? { presentation: request.presentation } : {}),
    ...(request.answerContract !== 'legacy' && request.requirements
      ? { requirements: request.requirements }
      : {}),
    ...(request.answerContract !== 'legacy' && request.assessment ? { assessment: request.assessment } : {}),
    ...(request.answerContract !== 'legacy' && request.candidates ? { candidates: request.candidates } : {}),
    ...(request.answerContract !== 'legacy' && request.factAudit ? { factAudit: request.factAudit } : {}),
    ...(request.answerContract !== 'legacy' && request.system ? { system: request.system } : {}),
    criterion: request.criterion,
    transcript: request.transcript,
    artifact: request.artifact,
    inputs: request.inputs,
    given: request.given,
    reference: request.reference,
    budget: request.budget === 'large' ? 'large' : undefined,
  });
}

/**
 * The key of a request on a cassette: the data part, the fingerprint of the prompt texts, and the client's
 * class, model and settings. A changed prompt, model or setting gives another key: a cassette miss, never a
 * silent replay of an answer to another question.
 */
export function requestKey(
  request: JudgeRequest,
  client?: KeyClient,
  prompt?: string,
  swapped?: JudgeRequest,
  pairPolicy = false,
): string {
  if (request.assessment?.kind === 'response-relevance') {
    validateResponseRelevanceRequest(request);
    if (client?.cls === 'system1') throw new RangeError('response-relevance requires a system2 judge');
  }
  const procedure =
    client?.families !== undefined ||
    client?.comparison === true ||
    client?.judgeComparison !== undefined ||
    swapped !== undefined ||
    pairPolicy;
  const effective =
    client?.cls === 'system1' && !procedure
      ? { ...request, answerContract: 'legacy' as const }
      : isPairLedgerRequest(request)
        ? {
            ...request,
            dialect: client?.dialect ?? request.dialect ?? 'scratchpad-json',
            reasoning: request.reasoning ?? client?.reasoning,
          }
        : request;
  const decoder =
    request.criterionDecoderVersion ?? client?.criterionDecoderVersion ?? CRITERION_DECODER_VERSION;
  const fullKey = (r: JudgeRequest) =>
    contentHash({
      data: dataKey({ ...r, answerContract: 'ledger' }),
      answerContract: r.answerContract ?? 'ledger',
    });
  return contentHash({
    ...(pairPolicy ? { pairPolicy: true } : {}),
    // Version 1 omits the field to preserve historical request keys.
    ...(effective.answerContract !== 'legacy' && !effective.assessment && decoder !== 1
      ? { criterionDecoderVersion: decoder }
      : {}),
    ...(effective.answerContract === 'legacy' || request.reasoning === undefined
      ? {}
      : { reasoning: request.reasoning }),
    data: procedure ? fullKey(effective) : dataKey(effective),
    ...(swapped ? { comparison: fullKey(swapped) } : {}),
    prompt:
      prompt ??
      (effective.assessment?.kind === 'response-relevance'
        ? RESPONSE_RELEVANCE_PROMPT_FINGERPRINT
        : effective.answerContract === 'legacy'
          ? LEGACY_PROMPT_FINGERPRINT
          : isPairLedgerRequest(effective)
            ? contentHash({
                prompt: PAIR_LEDGER_PROMPT_FINGERPRINT,
                dialect: effective.dialect,
                table: JUDGE_DIALECTS,
              })
            : effective.assessment?.kind === 'conformance'
              ? CONFORMANCE_PROMPT_FINGERPRINT
              : effective.assessment?.kind === 'answer-audit'
                ? ANSWER_AUDIT_PROMPT_FINGERPRINT
                : criterionPromptFingerprint(effective)),
    client: client ? { cls: client.cls, model: client.model, settings: client.settings } : undefined,
  });
}

// Occurrences belong to the cassette, so separate wrappers share invocation order.
// Only completed entries enter its public array; pending calls never serialize as holes.
const recordingOrder = new WeakMap<
  Cassette,
  { next: number; pending: number; entries: WeakMap<CassetteEntry, number> }
>();

function reserveOccurrence(cassette: Cassette): (entry: CassetteEntry) => void {
  let order = recordingOrder.get(cassette);
  if (!order) {
    order = { next: 0, pending: 0, entries: new WeakMap() };
    recordingOrder.set(cassette, order);
  }
  const occurrence = order.next++;
  order.pending++;
  return (entry) => {
    // Existing entries precede this recording session. Binary insertion preserves invocation
    // order without delaying other calls or discarding a later call that finishes first.
    let low = 0;
    let high = cassette.entries.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const prior = cassette.entries[middle] as CassetteEntry;
      if ((order.entries.get(prior) ?? -1) < occurrence) low = middle + 1;
      else high = middle;
    }
    order.entries.set(entry, occurrence);
    cassette.entries.splice(low, 0, entry);
    order.pending--;
  };
}

function requireSettledRecording(cassette: Cassette): void {
  if (recordingOrder.get(cassette)?.pending)
    throw new JudgeError(
      'config',
      'Cannot play or save a cassette with recordings in flight; await every recording first',
    );
}

/** Wraps a client; every answer and failure is retained in invocation order in `cassette`. */
export function recordingClient(client: JudgeClient, cassette: Cassette): JudgeClient {
  if (!cassette.judges.some((judge) => judge.id === client.id)) {
    cassette.judges.push({
      id: client.id,
      family: client.family,
      ...(client.families ? { families: [...client.families] } : {}),
      ...(client.judgeComparison ? { comparison: true as const } : {}),
      ...(client.judgePair ? { pairPolicy: true as const } : {}),
      cls: client.cls,
      ...(client.model ? { model: client.model } : {}),
      cost: client.cost,
      ...(client.settings === undefined ? {} : { settings: client.settings }),
      ...(client.dialect === undefined ? {} : { dialect: client.dialect }),
      ...(client.reasoning === undefined ? {} : { reasoning: client.reasoning }),
    });
  }
  const record = async (
    request: JudgeRequest,
    swapped?: JudgeRequest,
    pairPolicy = false,
  ): Promise<JudgeResult> => {
    const base = {
      judge: client.id,
      key: requestKey(request, client, undefined, swapped, pairPolicy),
      criterion: request.criterion.name,
      ...(isPairLedgerRequest(request) ? { pairContract: 'ledger' as const } : {}),
      answerContract:
        request.answerContract ??
        (client.cls === 'system1' && !client.families && !client.judgeComparison
          ? ('legacy' as const)
          : ('ledger' as const)),
      // Version 1 entries omit the field, so default recordings stay byte-identical.
      ...(request.answerContract !== 'legacy' &&
      !request.assessment &&
      (client.cls !== 'system1' || client.families || client.judgeComparison) &&
      (request.criterionDecoderVersion ?? client.criterionDecoderVersion ?? CRITERION_DECODER_VERSION) !== 1
        ? {
            criterionDecoderVersion:
              request.criterionDecoderVersion ?? client.criterionDecoderVersion ?? CRITERION_DECODER_VERSION,
          }
        : {}),
      // An ordinary criterion check names the prompt version it was asked under; version 1 omits the field.
      ...(!isPairLedgerRequest(request) &&
      (client.cls !== 'system1' || client.families || client.judgeComparison) &&
      criterionPromptFingerprint(request) === PROMPT_FINGERPRINT
        ? { criterionPromptVersion: 2 as const }
        : {}),
    };
    const commit = reserveOccurrence(cassette);
    const cost = (result: JudgeResult) => ({
      ...(result.costUsd === undefined ? {} : { cost_usd: result.costUsd }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
    });
    try {
      const result =
        pairPolicy && client.judgePair
          ? await client.judgePair(request)
          : swapped && client.judgeComparison
            ? await client.judgeComparison(request, swapped)
            : await client.judge(request);
      commit(
        result.defaultJudge ||
          result.thinkingRecovery ||
          result.retryReceipts ||
          result.escalation ||
          result.comparison ||
          result.referenceAgreement ||
          result.referenceDisagreement !== undefined
          ? { ...base, result, raw: result.raw, ...cost(result) }
          : request.assessment?.kind === 'response-relevance' && result.unparsed
            ? { ...base, raw: result.raw, unparsedReason: result.answer.reasoning, ...cost(result) }
            : result.unparsed || request.assessment || result.checks
              ? { ...base, raw: result.raw, ...cost(result) }
              : {
                  ...base,
                  answer: result.answer,
                  raw: result.raw,
                  ...cost(result),
                  ...(result.repaired ? { repaired: true as const } : {}),
                },
      );
      return result;
    } catch (cause) {
      commit({ ...base, error: cause instanceof Error ? cause.message : String(cause) });
      throw cause;
    }
  };
  return {
    id: client.id,
    family: client.family,
    cls: client.cls,
    cost: client.cost,
    ...(client.families ? { families: client.families } : {}),
    ...(client.model ? { model: client.model } : {}),
    ...(client.settings === undefined ? {} : { settings: client.settings }),
    ...(client.criterionDecoderVersion === undefined
      ? {}
      : { criterionDecoderVersion: client.criterionDecoderVersion }),
    ...(client.dialect === undefined ? {} : { dialect: client.dialect }),
    ...(client.reasoning === undefined ? {} : { reasoning: client.reasoning }),
    judge: (request) => record(request),
    ...(client.judgePair ? { judgePair: (request: JudgeRequest) => record(request, undefined, true) } : {}),
    ...(client.judgeComparison
      ? { judgeComparison: (ordered: JudgeRequest, swapped: JudgeRequest) => record(ordered, swapped) }
      : {}),
  };
}

/** Replays settled entries in invocation order, then repeats the last. Await all recordings first. */
export function playerClient(
  cassette: Cassette,
  judgeId: string,
  options: {
    readonly prompt?: string;
    readonly answerContract?: 'ledger' | 'legacy';
    readonly criterionDecoderVersion?: CriterionDecoderVersion;
    readonly criterionPromptVersion?: CriterionPromptVersion;
  } = {},
): JudgeClient {
  requireSettledRecording(cassette);
  const judge = cassette.judges.find((candidate) => candidate.id === judgeId);
  if (!judge) throw new JudgeError('config', `the cassette lists no judge "${judgeId}"`);
  const used = new Map<string, number>();
  // The entries of this judge by key, built once, so a call does not scan every entry.
  const byKey = new Map<string, CassetteEntry[]>();
  for (const entry of cassette.entries) {
    if (entry.judge !== judgeId) continue;
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  }
  const recordedContract =
    options.answerContract ??
    (byKey.size > 0 &&
    [...byKey.values()].some((list) => list.some((entry) => entry.answerContract === 'ledger'))
      ? 'ledger'
      : 'legacy');
  const recordedDecoder =
    options.criterionDecoderVersion ??
    ([...byKey.values()].some((list) => list.some((entry) => entry.criterionDecoderVersion === 3))
      ? 3
      : [...byKey.values()].some((list) => list.some((entry) => entry.criterionDecoderVersion === 2))
        ? 2
        : 1);
  const recordedPrompt =
    options.criterionPromptVersion ??
    ([...byKey.values()].some((list) => list.some((entry) => entry.criterionPromptVersion === 2)) ? 2 : 1);
  const play = async (
    request: JudgeRequest,
    swapped?: JudgeRequest,
    pairPolicy = false,
  ): Promise<JudgeResult> => {
    const oldWinnerContract =
      request.assessment?.kind === 'pairwise' &&
      recordedContract === 'ledger' &&
      (byKey.has(requestKey(request, judge, options.prompt, swapped)) ||
        !cassette.entries.some((entry) => entry.judge === judgeId && entry.pairContract === 'ledger'));
    const contracted =
      !request.answerContract && !oldWinnerContract
        ? { ...request, answerContract: recordedContract }
        : request;
    // A request without its own decoder or prompt version follows the versions the cassette records.
    const effective = {
      ...contracted,
      criterionDecoderVersion: request.criterionDecoderVersion ?? recordedDecoder,
      criterionPromptVersion: request.criterionPromptVersion ?? recordedPrompt,
    };
    const key = requestKey(effective, judge, options.prompt, swapped, pairPolicy);
    const matches = byKey.get(key) ?? [];
    if (matches.length === 0)
      throw new JudgeError(
        'cassette_miss',
        `no recording for judge ${judgeId}, criterion ${request.criterion.name}, key ${key}`,
      );
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    return replay(matches[Math.min(index, matches.length - 1)] as CassetteEntry, effective);
  };
  return {
    id: judge.id,
    family: judge.family,
    cls: judge.cls,
    cost: judge.cost,
    ...(judge.families ? { families: judge.families } : {}),
    ...(judge.model ? { model: judge.model } : {}),
    ...(judge.settings === undefined ? {} : { settings: judge.settings }),
    criterionDecoderVersion: recordedDecoder,
    ...(judge.dialect === undefined ? {} : { dialect: judge.dialect }),
    ...(judge.reasoning === undefined ? {} : { reasoning: judge.reasoning }),
    judge: (request) => play(request),
    ...(judge.pairPolicy ? { judgePair: (request: JudgeRequest) => play(request, undefined, true) } : {}),
    ...(judge.comparison
      ? { judgeComparison: (ordered: JudgeRequest, swapped: JudgeRequest) => play(ordered, swapped) }
      : {}),
  };
}

/** Every judge of a cassette, as players. */
export function cassettePlayers(
  cassette: Cassette,
  options: { readonly answerContract?: 'ledger' | 'legacy' } = {},
): JudgeClient[] {
  return cassette.judges.map((judge) => playerClient(cassette, judge.id, options));
}

function replay(entry: CassetteEntry, request: JudgeRequest): JudgeResult {
  if (entry.error !== undefined) throw new JudgeError('http', `recorded failure: ${entry.error}`);
  if (entry.result) return structuredClone(entry.result);
  const cost = {
    ...(entry.cost_usd === undefined ? {} : { costUsd: entry.cost_usd }),
    ...(entry.usage === undefined ? {} : { usage: entry.usage }),
    ...(entry.repaired ? { repaired: true } : {}),
  };
  if (entry.unparsedReason !== undefined)
    return {
      raw: entry.raw ?? '',
      answer: inconclusive(entry.unparsedReason),
      unparsed: true,
      ...cost,
    };
  if (request.assessment && entry.raw !== undefined)
    return { ...parseJudgeText(entry.raw, request), ...cost };
  if (entry.answer !== undefined)
    return {
      ...(request.answerContract === 'legacy'
        ? parseJudgeValue(entry.answer, request, entry.raw)
        : parseAnswerValue(entry.answer, entry.raw)),
      ...cost,
    };
  if (entry.raw !== undefined)
    return {
      ...parseJudgeText(entry.raw, request),
      ...cost,
    };
  throw new JudgeError(
    'bad_response',
    `the recording for key ${entry.key} holds no answer, raw text or error`,
  );
}

export function emptyCassette(): Cassette {
  return { version: 1, judges: [], entries: [] };
}

/** Reads and validates a cassette file. Throws with the first problem. */
export async function loadCassette(path: string): Promise<Cassette> {
  const text = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new JudgeError(
      'config',
      `${path} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const parsed = Cassette.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new JudgeError(
      'config',
      `${path}: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim(),
    );
  }
  const seen = new Set<string>();
  for (const judge of parsed.data.judges) {
    if (seen.has(judge.id)) throw new JudgeError('config', `${path}: judge ${judge.id} is listed twice`);
    seen.add(judge.id);
  }
  for (const entry of parsed.data.entries) {
    if (!seen.has(entry.judge))
      throw new JudgeError(
        'config',
        `${path}: an entry names judge ${entry.judge}, which the cassette does not list`,
      );
    if (!/^[0-9a-f]{12}$/.test(entry.key))
      throw new JudgeError('config', `${path}: key ${entry.key} is not a 12-character hex request hash`);
    if (entry.error !== undefined && entry.answer !== undefined)
      throw new JudgeError('config', `${path}: an entry holds both an answer and an error`);
    if (entry.answer === undefined && entry.raw === undefined && entry.error === undefined)
      throw new JudgeError('config', `${path}: an entry is empty: it has no answer, raw text or error`);
  }
  return parsed.data;
}

/** Atomically exports a settled cassette. Await every recording before saving. */
export async function saveCassette(path: string, cassette: Cassette): Promise<void> {
  requireSettledRecording(cassette);
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(cassette, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (cause) {
    // An exclusive-create collision is not our file to remove.
    if (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EEXIST')
      throw cause;
    await cleanTemporary(temporary, cause);
  }
  try {
    await rename(temporary, path);
  } catch (cause) {
    await cleanTemporary(temporary, cause);
  }
}

async function cleanTemporary(path: string, cause: unknown): Promise<never> {
  try {
    await unlink(path);
  } catch (cleanup) {
    if (!(typeof cleanup === 'object' && cleanup !== null && 'code' in cleanup && cleanup.code === 'ENOENT'))
      throw new AggregateError([cause, cleanup], 'Cassette export and temporary-file cleanup failed', {
        cause,
      });
  }
  throw cause;
}
