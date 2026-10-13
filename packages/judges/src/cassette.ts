import { readFile, writeFile } from 'node:fs/promises';
import { contentHash } from '@agent-nexus/driftbench-core';
import { z } from 'zod';
import { parseJudgeText, parseJudgeValue } from './assessment';
import type { JudgeClient } from './client';
import { CONFORMANCE_PROMPT_FINGERPRINT } from './conformance';
import { JudgeClass, type JudgeRequest, type JudgeResult, parseAnswerValue } from './contract';
import { JudgeError } from './http';
import { PROMPT_FINGERPRINT as LEGACY_PROMPT_FINGERPRINT } from './legacy-prompt';
import { PROMPT_FINGERPRINT } from './prompt';

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
  cls: JudgeClass,
  model: z.string().optional(),
  cost: z.number().nonnegative(),
  /** The client settings it was recorded with (see `JudgeClient.settings`). Part of every key. */
  settings: z.string().optional(),
});
export type CassetteJudge = z.infer<typeof CassetteJudge>;

export const CassetteEntry = z.strictObject({
  judge: z.string().min(1),
  key: z.string().min(1),
  /** The criterion name, for a reader of the file. The key decides the match. */
  criterion: z.string().optional(),
  /** Model-facing contract recorded with this entry. Missing on pre-ledger cassettes means legacy. */
  answerContract: z.enum(['ledger', 'legacy']).optional(),
  note: z.string().optional(),
  answer: z.unknown().optional(),
  raw: z.string().optional(),
  error: z.string().optional(),
  /** What the recorded call cost in US dollars, when the client reported it. Replayed with the answer. */
  cost_usd: z.number().nonnegative().optional(),
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
export type KeyClient = { readonly cls: JudgeClass; readonly model?: string; readonly settings?: string };

/**
 * The data part of a key: a hash of the criterion, the data and, for a re-judge, the large budget. Stable
 * across prompt and client changes; scripted cassettes use it to pick which answers to vary.
 */
export function dataKey(request: JudgeRequest): string {
  return contentHash({
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
export function requestKey(request: JudgeRequest, client?: KeyClient, prompt?: string): string {
  const effective = client?.cls === 'system1' ? { ...request, answerContract: 'legacy' as const } : request;
  return contentHash({
    data: dataKey(effective),
    prompt:
      prompt ??
      (effective.answerContract === 'legacy'
        ? LEGACY_PROMPT_FINGERPRINT
        : effective.assessment?.kind === 'conformance'
          ? CONFORMANCE_PROMPT_FINGERPRINT
          : PROMPT_FINGERPRINT),
    client: client ? { cls: client.cls, model: client.model, settings: client.settings } : undefined,
  });
}

/** Wraps a client; every answer and every failure it gives is appended to `cassette`. */
export function recordingClient(client: JudgeClient, cassette: Cassette): JudgeClient {
  if (!cassette.judges.some((judge) => judge.id === client.id)) {
    cassette.judges.push({
      id: client.id,
      family: client.family,
      cls: client.cls,
      ...(client.model ? { model: client.model } : {}),
      cost: client.cost,
      ...(client.settings === undefined ? {} : { settings: client.settings }),
    });
  }
  return {
    id: client.id,
    family: client.family,
    cls: client.cls,
    ...(client.model ? { model: client.model } : {}),
    cost: client.cost,
    ...(client.settings === undefined ? {} : { settings: client.settings }),
    async judge(request) {
      const base = {
        judge: client.id,
        key: requestKey(request, client),
        criterion: request.criterion.name,
        answerContract:
          request.answerContract ?? (client.cls === 'system1' ? ('legacy' as const) : ('ledger' as const)),
      };
      const cost = (result: JudgeResult) =>
        result.costUsd === undefined ? {} : { cost_usd: result.costUsd };
      try {
        const result = await client.judge(request);
        // An unparsed answer is kept as raw text only, so its replay is unparsed too and is re-judged.
        cassette.entries.push(
          result.unparsed || request.assessment || result.checks
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
        cassette.entries.push({ ...base, error: cause instanceof Error ? cause.message : String(cause) });
        throw cause;
      }
    },
  };
}

/** A client that replays the entries of one judge. Each entry is used in order, then the last repeats. */
export function playerClient(
  cassette: Cassette,
  judgeId: string,
  options: { readonly prompt?: string; readonly answerContract?: 'ledger' | 'legacy' } = {},
): JudgeClient {
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
  return {
    id: judge.id,
    family: judge.family,
    cls: judge.cls,
    ...(judge.model ? { model: judge.model } : {}),
    cost: judge.cost,
    ...(judge.settings === undefined ? {} : { settings: judge.settings }),
    async judge(request) {
      const effective = !request.answerContract ? { ...request, answerContract: recordedContract } : request;
      const key = requestKey(effective, judge, options.prompt);
      const matches = byKey.get(key) ?? [];
      if (matches.length === 0) {
        throw new JudgeError(
          'cassette_miss',
          `no recording for judge ${judgeId}, criterion ${request.criterion.name}, key ${key}`,
        );
      }
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);
      return replay(matches[Math.min(index, matches.length - 1)] as CassetteEntry, effective);
    },
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
  const cost = {
    ...(entry.cost_usd === undefined ? {} : { costUsd: entry.cost_usd }),
    ...(entry.repaired ? { repaired: true } : {}),
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

export async function saveCassette(path: string, cassette: Cassette): Promise<void> {
  await writeFile(path, `${JSON.stringify(cassette, null, 2)}\n`, 'utf8');
}
