import type {
  GoogleClientLike,
  GoogleContent,
  GoogleGenerateParams,
  GoogleGenerateResponse,
} from '../../../src/google/index';
import { type AcmeCall, type AcmeTurn, labelOf, nextAction, tokens, wireOf } from './acme-model';

/**
 * A fake Gemini client: `models.generateContent` answers as the Acme agent would through the Gemini API.
 *
 * It checks each request the way the API does (contents hold only `user` and `model` roles and start with
 * the user, function names use the allowed characters and start with a letter or an underscore, a part
 * holds one kind of data, a `functionResponse.response` is an object) and answers a 400 `INVALID_ARGUMENT`
 * otherwise. A function call carries an id and a thought signature, as Gemini 3 sends them, and the fake
 * refuses a request whose current turn sends a signed call back without its signature.
 */

export type FakeGoogle = GoogleClientLike & { readonly requests: GoogleGenerateParams[] };

/** An error shaped like the SDK's `ApiError`: a status and a message. */
export class FakeGoogleError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
    name = 'ApiError',
  ) {
    super(message);
    this.name = name;
  }
}

export function fakeGoogle(): FakeGoogle {
  const requests: GoogleGenerateParams[] = [];
  const signed = new Map<string, string>();
  let count = 0;
  return {
    requests,
    models: {
      async generateContent(params) {
        requests.push(structuredClone(params));
        validate(params, signed);
        count++;
        const offered = (params.config?.tools ?? []).flatMap((tool) =>
          tool.functionDeclarations.map((fn) => fn.name),
        );
        const action = nextAction(turnsOf(params.contents, offered));
        const parts =
          action.kind === 'tool'
            ? [
                {
                  functionCall: {
                    id: `fc_fake_${count}`,
                    name: wireOf(action.label, offered),
                    args: action.input,
                  },
                  thoughtSignature: `sig-fake-${count}`,
                },
              ]
            : [{ text: action.text }];
        if (action.kind === 'tool') signed.set(`fc_fake_${count}`, `sig-fake-${count}`);
        return {
          candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
          usageMetadata: {
            promptTokenCount: tokens(params.contents),
            candidatesTokenCount: tokens(parts),
            totalTokenCount: tokens(params.contents) + tokens(parts),
          },
          modelVersion: params.model,
          responseId: `resp-fake-${count}`,
        } as unknown as GoogleGenerateResponse;
      },
    },
  };
}

/** A client whose connection fails, the way fetch reports it: `TypeError: fetch failed`, no status. */
export function deadGoogle(): GoogleClientLike {
  return {
    models: {
      async generateContent() {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        });
      },
    },
  };
}

/** A client that answers the given responses in order and records each request, for recorded exchanges. */
export function recordedGoogle(answers: readonly unknown[]): FakeGoogle {
  const requests: GoogleGenerateParams[] = [];
  return {
    requests,
    models: {
      async generateContent(params) {
        requests.push(structuredClone(params));
        const next = answers[requests.length - 1];
        if (next === undefined) throw new Error(`no recorded answer for request ${requests.length}`);
        return structuredClone(next) as GoogleGenerateResponse;
      },
    },
  };
}

/** The contents as Acme turns. */
function turnsOf(contents: readonly GoogleContent[], offered: readonly string[]): AcmeTurn[] {
  const turns: AcmeTurn[] = [];
  const pending: AcmeCall[] = [];
  for (const content of contents) {
    for (const part of content.parts ?? []) {
      if (content.role === 'user' && typeof part.text === 'string') {
        const open = turns.at(-1);
        if (open && !open.answered) open.text = `${open.text}\n${part.text}`;
        else turns.push({ text: part.text, calls: [], answered: false });
      } else if (content.role === 'user' && part.functionResponse) {
        const index = pending.findIndex(
          (call) => call.label === labelOf(part.functionResponse?.name ?? '', offered),
        );
        const [call] = index >= 0 ? pending.splice(index, 1) : [];
        if (!call) continue;
        const response = part.functionResponse.response;
        call.outcome =
          typeof response.error === 'string'
            ? { ok: false, error: response.error }
            : { ok: true, output: response.output };
      } else if (content.role === 'model' && part.functionCall) {
        const call: AcmeCall = {
          label: labelOf(part.functionCall.name ?? '', offered),
          input: part.functionCall.args ?? {},
        };
        turns.at(-1)?.calls.push(call);
        pending.push(call);
      } else if (content.role === 'model' && typeof part.text === 'string' && part.thought !== true) {
        const open = turns.at(-1);
        if (open) open.answered = true;
      }
    }
  }
  return turns;
}

/** The checks the Gemini API makes that an adapter can get wrong. */
function validate(params: GoogleGenerateParams, signed: ReadonlyMap<string, string>): void {
  const fail = (why: string): never => {
    throw new FakeGoogleError(400, `INVALID_ARGUMENT: ${why}`);
  };
  if (params.contents.length === 0) fail('contents is not specified');
  if (params.contents[0]?.role !== 'user') fail('the first content must have the user role');
  for (const declaration of params.config?.tools?.flatMap((tool) => tool.functionDeclarations) ?? []) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/.test(declaration.name))
      fail(`function name ${declaration.name} is invalid`);
  }
  const lastUserText = params.contents.findLastIndex(
    (content) =>
      content.role === 'user' && (content.parts ?? []).some((part) => typeof part.text === 'string'),
  );
  params.contents.forEach((content, index) => {
    if (content.role !== 'user' && content.role !== 'model')
      fail(`contents.${index}.role must be user or model`);
    if ((content.parts ?? []).length === 0) fail(`contents.${index}.parts must not be empty`);
    for (const part of content.parts ?? []) {
      const kinds = ['text', 'functionCall', 'functionResponse'].filter((key) => key in part);
      if (kinds.length !== 1)
        fail(`contents.${index}: a part holds exactly one of text, functionCall, functionResponse`);
      if (
        part.functionResponse &&
        (typeof part.functionResponse.response !== 'object' || part.functionResponse.response === null)
      ) {
        fail(`contents.${index}: functionResponse.response must be an object`);
      }
      // Gemini 3 checks signatures within the current turn: the calls after the last user text.
      const id = part.functionCall?.id;
      if (
        index > lastUserText &&
        id !== undefined &&
        signed.has(id) &&
        part.thoughtSignature !== signed.get(id)
      ) {
        fail(`contents.${index}: function call ${id} is missing its thought_signature`);
      }
    }
  });
}
