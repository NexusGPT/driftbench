import type { ClientOptions, JudgeClient } from '../client';
import { inconclusive, type JudgeRequest, type JudgeResult, MAX_TOKENS, parseAnswerText } from '../contract';
import { isRecord, JudgeError, postJson, requireEnv } from '../http';
import { buildPrompt } from '../prompt';

/**
 * The system 2 judges: chat models that read the rubric and the data and answer the contract as JSON.
 * Each reads its key, model and base URL from the environment. The key lives in the client's closure: it
 * is not a field of the client, so printing or serialising a client never shows it.
 */

const CHAT_COST = 10;

function modelOf(options: ClientOptions, env: Record<string, string | undefined>, variable: string): string {
  const model = env[variable]?.trim() || options.model;
  if (!model) throw new JudgeError('config', `${variable} is not set and no model was given`);
  return model;
}

function baseOf(env: Record<string, string | undefined>, variable: string, fallback: string): string {
  return (env[variable]?.trim() || fallback).replace(/\/+$/, '');
}

function budgetOf(request: JudgeRequest): number {
  return MAX_TOKENS[request.budget ?? 'normal'];
}

/** The answer contract as a JSON schema, for providers that take one. The keys and the outcome words are the contract's. */
const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    outcome: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
    score: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['outcome', 'reasoning'],
  additionalProperties: false,
} as const;

/** A truncated answer: unparsed, so the council re-judges it once with the large budget. */
function truncated(raw: string, model: string): JudgeResult {
  return {
    answer: inconclusive(`${model} stopped at its token limit: the answer is cut`),
    raw,
    unparsed: true,
  };
}

/**
 * OpenAI chat completions: POST {OPENAI_BASE_URL}/v1/chat/completions with a JSON object response format.
 * Reads OPENAI_API_KEY, OPENAI_JUDGE_MODEL and OPENAI_BASE_URL (default https://api.openai.com).
 */
export function createOpenAiJudge(options: ClientOptions = {}): JudgeClient {
  const env = options.env ?? process.env;
  const key = requireEnv(env, 'OPENAI_API_KEY');
  const model = modelOf(options, env, 'OPENAI_JUDGE_MODEL');
  const url = `${baseOf(env, 'OPENAI_BASE_URL', 'https://api.openai.com')}/v1/chat/completions`;
  return {
    id: options.id ?? 'openai',
    family: 'openai',
    cls: 'system2',
    model,
    cost: options.cost ?? CHAT_COST,
    async judge(request) {
      const prompt = buildPrompt(request);
      const payload = await postJson(
        url,
        { authorization: `Bearer ${key}` },
        {
          model,
          max_completion_tokens: budgetOf(request),
          temperature: 0,
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'judge_answer', strict: false, schema: ANSWER_SCHEMA },
          },
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
        },
        options,
      );
      const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
      const message = isRecord(choice) ? choice.message : undefined;
      const raw = JSON.stringify(payload);
      if (!isRecord(choice) || !isRecord(message)) {
        return { answer: inconclusive(`${model} answered without a choice`), raw, unparsed: true };
      }
      if (typeof message.refusal === 'string' && message.refusal !== '') {
        return { answer: inconclusive(`${model} declined: ${message.refusal}`), raw };
      }
      if (choice.finish_reason === 'content_filter') {
        return { answer: inconclusive(`${model} declined: its content filter stopped the answer`), raw };
      }
      const content = contentText(message.content);
      if (choice.finish_reason === 'length') return truncated(content, model);
      return parseAnswerText(content);
    },
  };
}

/**
 * Anthropic Messages: POST {ANTHROPIC_BASE_URL}/v1/messages. Reads ANTHROPIC_API_KEY,
 * ANTHROPIC_JUDGE_MODEL and ANTHROPIC_BASE_URL (default https://api.anthropic.com).
 */
export function createAnthropicJudge(options: ClientOptions = {}): JudgeClient {
  const env = options.env ?? process.env;
  const key = requireEnv(env, 'ANTHROPIC_API_KEY');
  const model = modelOf(options, env, 'ANTHROPIC_JUDGE_MODEL');
  const url = `${baseOf(env, 'ANTHROPIC_BASE_URL', 'https://api.anthropic.com')}/v1/messages`;
  return {
    id: options.id ?? 'anthropic',
    family: 'anthropic',
    cls: 'system2',
    model,
    cost: options.cost ?? CHAT_COST,
    async judge(request) {
      const prompt = buildPrompt(request);
      const payload = await postJson(
        url,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: budgetOf(request),
          temperature: 0,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        },
        options,
      );
      const raw = JSON.stringify(payload);
      if (!isRecord(payload) || !Array.isArray(payload.content)) {
        return { answer: inconclusive(`${model} answered without a content list`), raw, unparsed: true };
      }
      if (payload.stop_reason === 'refusal') {
        return { answer: inconclusive(`${model} declined the request`), raw };
      }
      const text = payload.content
        .filter((block): block is { type: 'text'; text: string } => {
          return isRecord(block) && block.type === 'text' && typeof block.text === 'string';
        })
        .map((block) => block.text)
        .join('');
      if (payload.stop_reason === 'max_tokens') return truncated(text, model);
      return parseAnswerText(text);
    },
  };
}

/**
 * Google Gemini: POST {GOOGLE_BASE_URL}/v1beta/models/{model}:generateContent with a JSON response type.
 * Reads GEMINI_API_KEY (or GOOGLE_API_KEY), GOOGLE_JUDGE_MODEL and GOOGLE_BASE_URL (default
 * https://generativelanguage.googleapis.com). The key goes in the x-goog-api-key header, never the URL.
 */
export function createGoogleJudge(options: ClientOptions = {}): JudgeClient {
  const env = options.env ?? process.env;
  const key = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (!key) throw new JudgeError('config', 'GEMINI_API_KEY is not set (nor GOOGLE_API_KEY)');
  const model = modelOf(options, env, 'GOOGLE_JUDGE_MODEL');
  const base = baseOf(env, 'GOOGLE_BASE_URL', 'https://generativelanguage.googleapis.com');
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    id: options.id ?? 'google',
    family: 'google',
    cls: 'system2',
    model,
    cost: options.cost ?? CHAT_COST,
    async judge(request) {
      const prompt = buildPrompt(request);
      const payload = await postJson(
        url,
        { 'x-goog-api-key': key },
        {
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: budgetOf(request),
            temperature: 0,
          },
        },
        options,
      );
      const raw = JSON.stringify(payload);
      const candidate =
        isRecord(payload) && Array.isArray(payload.candidates) ? payload.candidates[0] : undefined;
      const feedback = isRecord(payload) ? payload.promptFeedback : undefined;
      if (!isRecord(candidate) && isRecord(feedback) && typeof feedback.blockReason === 'string') {
        return { answer: inconclusive(`${model} declined: the prompt was blocked (${feedback.blockReason})`), raw };
      }
      if (!isRecord(candidate)) {
        return { answer: inconclusive(`${model} answered without a candidate`), raw, unparsed: true };
      }
      const content = candidate.content;
      const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
      const text = parts
        .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
        .join('');
      if (candidate.finishReason === 'MAX_TOKENS') return truncated(text, model);
      if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION')
        return { answer: inconclusive(`${model} declined the request`), raw };
      return parseAnswerText(text);
    },
  };
}

/** The text of an OpenAI message content: a string, or the text parts of a list joined in order. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('');
}
