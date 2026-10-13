import { parseJudgeValue } from '../assessment';
import type { ClientOptions, JudgeClient } from '../client';
import { JudgeError, postJson, requireEnv } from '../http';
import { buildPrompt } from '../prompt';

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
  const env = options.env ?? process.env;
  const key = options.keyVariable ? requireEnv(env, options.keyVariable) : undefined;
  const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
  if (!options.family.trim()) throw new JudgeError('config', 'an http judge needs its model family');
  const cls = options.cls ?? 'system2';
  return {
    id: options.id ?? 'http',
    family: options.family,
    cls,
    ...(options.model ? { model: options.model } : {}),
    cost: options.cost ?? (cls === 'system1' ? 1 : 10),
    async judge(original) {
      const request = cls === 'system1' ? { ...original, answerContract: 'legacy' as const } : original;
      const payload = await postJson(
        options.url,
        headers,
        { request, prompt: buildPrompt(request) },
        options,
      );
      return parseJudgeValue(payload, request);
    },
  };
}
