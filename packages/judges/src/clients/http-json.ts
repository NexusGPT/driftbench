import { parseJudgeText, parseJudgeValue } from '../assessment';
import type { ClientOptions, JudgeClient } from '../client';
import { JudgeError, postJson, requireEnv } from '../http';
import { buildPrompt } from '../prompt';
import { isPairLedgerRequest, JUDGE_DIALECTS, withJudgeDialect } from './dialects';

export type HttpJudgeOptions = ClientOptions & {
  /** The endpoint. */
  url: string;
  /** The model family behind the endpoint. Required: the diversity rule reads it. */
  family: string;
  cls?: 'system1' | 'system2';
  /** The variable holding a bearer token, when the endpoint needs one. */
  keyVariable?: string;
};

/**
 * Any endpoint that returns the answer contract: POST {url} with `{ request, prompt: { system, user } }`;
 * the response body is the contract itself.
 */
export function createHttpJudge(options: HttpJudgeOptions): JudgeClient {
  if (options.cls === 'system1' && options.reasoning !== undefined)
    throw new JudgeError('config', 'reasoning is not supported by the HTTP system1 client');
  const env = options.env ?? process.env;
  const key = options.keyVariable ? requireEnv(env, options.keyVariable) : undefined;
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  if (!options.family.trim()) throw new JudgeError('config', 'an http judge needs its model family');
  const cls = options.cls ?? 'system2';
  return {
    id: options.id ?? 'http',
    family: options.family,
    cls,
    dialect: cls === 'system1' ? JUDGE_DIALECTS.jev.id : JUDGE_DIALECTS.http.id,
    ...(options.reasoning === undefined
      ? {}
      : { reasoning: options.reasoning, settings: JSON.stringify({ reasoning: options.reasoning }) }),
    ...(options.model ? { model: options.model } : {}),
    cost: options.cost ?? (cls === 'system1' ? 1 : 10),
    async judge(original) {
      if (
        (original.reasoning ?? options.reasoning) !== undefined &&
        (cls === 'system1' || !isPairLedgerRequest(original))
      )
        throw new JudgeError('config', 'reasoning is supported only by HTTP pair-ledger requests');
      const request =
        cls === 'system1'
          ? { ...original, answerContract: 'legacy' as const }
          : withJudgeDialect(original, JUDGE_DIALECTS.http.id, options.reasoning);
      const payload = await postJson(
        options.url,
        headers,
        { request, prompt: buildPrompt(request) },
        options,
      );
      return isPairLedgerRequest(request) && typeof payload === 'string'
        ? parseJudgeText(payload, request)
        : parseJudgeValue(payload, request);
    },
  };
}
