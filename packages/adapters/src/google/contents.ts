import type { HistoryNormalization, Message } from '@agent-nexus/driftbench-core';
import type { WireNames } from '../anthropic/common';
import { emptyTurnNormalizations, HistoryCompiler } from '../shared/history';

/**
 * The slice of the Gemini API the adapter speaks, mirrored from `@google/genai` 2.28.0
 * (`ai.models.generateContent(params)`, a `GenerateContentResponse` answer). Only the fields the adapter
 * writes or reads are named; the real client and its types fit these shapes.
 */

export type GoogleFunctionCall = { id?: string; name?: string; args?: Record<string, unknown> };
export type GoogleFunctionResponse = { id?: string; name: string; response: Record<string, unknown> };

export type GooglePart = {
  text?: string;
  /** A thought summary: model reasoning, not customer-visible text. */
  thought?: boolean;
  functionCall?: GoogleFunctionCall;
  functionResponse?: GoogleFunctionResponse;
  /** Gemini 3 signs its function calls; the signed part goes back unchanged within the turn. */
  thoughtSignature?: string;
};

export type GoogleContent = { role?: string; parts?: GooglePart[] };

export type GoogleFunctionDeclaration = {
  name: string;
  description?: string;
  parametersJsonSchema?: unknown;
};

/** The parameters of one `models.generateContent` call. */
export type GoogleGenerateParams = {
  model: string;
  contents: GoogleContent[];
  config?: {
    systemInstruction?: string;
    tools?: { functionDeclarations: GoogleFunctionDeclaration[] }[];
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
  };
};

/** The answer of one call: candidates, prompt feedback when the prompt was blocked, usage. */
export type GoogleGenerateResponse = {
  candidates?: { content?: GoogleContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

/** The client the adapter calls: `new GoogleGenAI({ apiKey })` from `@google/genai`, or a fake with the same shape. */
export type GoogleClientLike = {
  models: { generateContent(params: GoogleGenerateParams): PromiseLike<GoogleGenerateResponse> };
};

/** Function names the Gemini API accepts: letters, digits, underscore, dot, colon and dash. */
export const GOOGLE_NAME = /[a-zA-Z0-9_.:-]/;

/**
 * The session history as Gemini contents, in the order things happened.
 *
 * - A system message joins the system instruction; contents take only `user` and `model` roles.
 * - A user message, and a `tool` message (a free tool note with no call id), become user text.
 * - An assistant message with recorded tool calls becomes a model content of `functionCall` parts, then a
 *   user content of `functionResponse` parts (`{ output }`, or `{ error }`, the keys the API documents),
 *   then the reply text, when there is one.
 * - Contents of the same role in a row merge into one.
 * - Empty text-only turns are omitted and recorded in `normalizations`; no placeholder reaches the model.
 *
 * Calls from earlier turns carry no thought signature: the API checks signatures only within the
 * current turn, which the adapter sends back exactly as the model wrote it.
 */
export function toGoogleContents(
  history: readonly Message[],
  names: WireNames,
): { contents: GoogleContent[]; system: string[]; normalizations: HistoryNormalization[] } {
  const system: string[] = [];
  const contents: { role: 'user' | 'model'; parts: GooglePart[] }[] = [];
  const push = (role: 'user' | 'model', parts: GooglePart[]) => {
    if (parts.length === 0) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  };
  const text = (value: string): GooglePart[] => (value === '' ? [] : [{ text: value }]);
  // Gemini pairs a response with its call by name and order; an id travels only when one was recorded, and a
  // recorded id that repeats one of the same turn is replaced, as on every wire.
  const compiler = new HistoryCompiler({ fallback: (n) => `call_h${n}`, fillMissing: false });

  for (const message of history) {
    if (message.role === 'system') {
      if (message.content !== '') system.push(message.content);
      continue;
    }
    if (message.role === 'user' || message.role === 'tool') {
      push('user', text(message.content));
      continue;
    }
    const recorded = compiler.calls(message);
    if (recorded.length > 0) {
      push(
        'model',
        recorded.map((call) => ({
          functionCall: {
            ...(call.id === undefined ? {} : { id: call.id }),
            name: names.wire(call.label),
            args: argsOf(call.input),
          },
        })),
      );
      push(
        'user',
        recorded.map((call) => ({
          functionResponse: {
            ...(call.id === undefined ? {} : { id: call.id }),
            name: names.wire(call.label),
            response:
              call.result.kind === 'error' ? { error: call.result.message } : { output: call.result.value },
          },
        })),
      );
    }
    push('model', text(message.content));
  }
  return { contents, system, normalizations: emptyTurnNormalizations(history, 'google') };
}

/** Function call arguments are an object on the wire; anything else is wrapped as `{ value }`. */
export function argsOf(input: unknown): Record<string, unknown> {
  if (input !== null && typeof input === 'object' && !Array.isArray(input))
    return input as Record<string, unknown>;
  return input === undefined ? {} : { value: input };
}
