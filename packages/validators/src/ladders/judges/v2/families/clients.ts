import type {
  ClientOptions,
  JudgeClient,
  JudgeRequest,
  System1Options,
} from '@agent-nexus/driftbench-judges';
import { type BankItem, fn, type JudgesApi, type Tier } from '../bank';

/**
 * Judge clients reading what providers send back (packages/judges/src/clients and http.ts). Every item answers
 * the client's one request with a recorded provider body through a stub fetch: no network, no key, no cost. The
 * bank states what each shape means:
 * - an answer the provider hands back in another form is read: OpenAI content as a list of text parts or as tool
 *   call arguments, the legacy completions text, Anthropic tool_use input, Google text with its thought parts left
 *   out, a system 1 probability written in quotes, Decisions answers keyed by name;
 * - a provider that declines is inconclusive and not unparsed, so the council does not ask again: OpenAI
 *   content_filter, Google prompt blocked, Google RECITATION;
 * - a 429 or 503 with Retry-After waits what it says (seconds or an HTTP date) before the next attempt.
 */

const COMPONENT = 'packages/judges/src/clients';
const REQUEST: JudgeRequest = {
  criterion: { name: 'care_redirect', rubric: 'A billing issue goes to Acme Care.' },
  transcript: [
    { role: 'user', text: 'My bill is wrong.' },
    { role: 'agent', text: 'Acme Care can help: call +1 202 555 0100.' },
  ],
};
const ANSWER = { outcome: 'pass', reasoning: 'routed to Acme Care' };
// The unsplit rubric supplies care_redirect as its sole requirement id. The quote is in REQUEST.
const LEDGER = {
  checks: [
    {
      id: 'care_redirect',
      reasoning: 'routed to Acme Care',
      evidence: 'Acme Care can help: call +1 202 555 0100.',
      met: true,
    },
  ],
};
const TEXT = JSON.stringify(LEDGER);

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Read = { outcome: string; unparsed: boolean; sleeps?: number[]; calls?: number; leaked?: boolean };

const ENV: Record<string, Record<string, string>> = {
  createOpenAiJudge: { OPENAI_API_KEY: 'sk-bank-key-0001', OPENAI_JUDGE_MODEL: 'gpt-test' },
  createAnthropicJudge: { ANTHROPIC_API_KEY: 'sk-bank-key-0002', ANTHROPIC_JUDGE_MODEL: 'claude-test' },
  createGoogleJudge: { GEMINI_API_KEY: 'sk-bank-key-0003', GOOGLE_JUDGE_MODEL: 'gemini-test' },
  createJevJudge: { JEV_URL: 'https://jev.example.com/v1/answer', JEV_API_KEY: 'sk-bank-key-0004' },
  createOpenAiDecisionsJudge: { OPENAI_API_KEY: 'sk-bank-key-0005', OPENAI_DECISIONS_MODEL: 'decide-test' },
};

async function call(api: JudgesApi, create: string, replies: Reply[]): Promise<Read> {
  let n = 0;
  const sleeps: number[] = [];
  const fetch: ClientOptions['fetch'] = async () => {
    const reply = replies[Math.min(n, replies.length - 1)] as Reply;
    n += 1;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
    });
  };
  const client = fn<(o: System1Options) => JudgeClient>(
    api,
    create,
  )({
    env: ENV[create] ?? {},
    fetch,
    maxRetries: 2,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  try {
    const result = await client.judge(REQUEST);
    return { outcome: result.answer.outcome, unparsed: result.unparsed === true, sleeps, calls: n };
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause);
    return { outcome: 'error', unparsed: true, sleeps, calls: n, leaked: /sk-bank-key/.test(text) };
  }
}

function item(
  id: string,
  tier: Tier,
  create: string,
  replies: Reply[] | (() => Reply[]),
  expect: (got: Read) => string | undefined,
): BankItem {
  return {
    id: `clients/${id}`,
    family: 'clients',
    tier,
    level: 'clients',
    component: `${COMPONENT} (${create})`,
    async run({ api }) {
      const got = await call(api, create, typeof replies === 'function' ? replies() : replies);
      const problem = expect(got);
      return problem === undefined
        ? { pass: true, detail: '' }
        : { pass: false, detail: `${problem}; observed ${JSON.stringify(got)}` };
    },
  };
}

const reads = (outcome: string) => (got: Read) =>
  got.outcome === outcome && !got.unparsed ? undefined : `expected the answer ${outcome}, read`;
const declined = (got: Read) =>
  got.outcome === 'inconclusive' && !got.unparsed
    ? undefined
    : 'expected a declined answer: inconclusive and not unparsed';
const unparsed = (got: Read) => (got.unparsed ? undefined : 'expected an unparsed answer');

const openai = (message: unknown, finish = 'stop') => ({
  body: { choices: [{ message, finish_reason: finish }] },
});

export function clientItems(): BankItem[] {
  return [
    item('openai-plain-content', 1, 'createOpenAiJudge', [openai({ content: TEXT })], reads('pass')),
    item(
      'openai-content-parts',
      3,
      'createOpenAiJudge',
      [openai({ content: [{ type: 'text', text: TEXT }] })],
      reads('pass'),
    ),
    item(
      'openai-tool-call-arguments',
      4,
      'createOpenAiJudge',
      [
        openai({
          content: null,
          tool_calls: [{ type: 'function', function: { name: 'answer', arguments: JSON.stringify(ANSWER) } }],
        }),
      ],
      reads('pass'),
    ),
    item(
      'openai-legacy-text',
      4,
      'createOpenAiJudge',
      [{ body: { choices: [{ text: JSON.stringify(ANSWER), finish_reason: 'stop' }] } }],
      reads('pass'),
    ),
    item(
      'openai-content-filter',
      3,
      'createOpenAiJudge',
      [openai({ content: '' }, 'content_filter')],
      declined,
    ),
    item(
      'openai-refusal',
      1,
      'createOpenAiJudge',
      [openai({ content: null, refusal: 'I cannot help with that.' })],
      declined,
    ),
    item(
      'openai-length',
      1,
      'createOpenAiJudge',
      [openai({ content: '{"outcome":"pa' }, 'length')],
      unparsed,
    ),
    item('openai-no-choice', 1, 'createOpenAiJudge', [{ body: { choices: [] } }], unparsed),
    item(
      'anthropic-thinking-then-text',
      1,
      'createAnthropicJudge',
      [
        {
          body: {
            content: [
              { type: 'thinking', thinking: 'let me see' },
              { type: 'text', text: TEXT },
            ],
            stop_reason: 'end_turn',
          },
        },
      ],
      reads('pass'),
    ),
    item(
      'anthropic-tool-use-input',
      4,
      'createAnthropicJudge',
      [{ body: { content: [{ type: 'tool_use', name: 'answer', input: ANSWER }], stop_reason: 'tool_use' } }],
      reads('pass'),
    ),
    item(
      'anthropic-refusal',
      1,
      'createAnthropicJudge',
      [{ body: { content: [], stop_reason: 'refusal' } }],
      declined,
    ),
    item(
      'anthropic-split-text-blocks',
      2,
      'createAnthropicJudge',
      [
        {
          body: {
            content: [
              { type: 'text', text: TEXT.slice(0, 12) },
              { type: 'text', text: TEXT.slice(12) },
            ],
            stop_reason: 'end_turn',
          },
        },
      ],
      reads('pass'),
    ),
    item(
      'google-thought-parts-left-out',
      4,
      'createGoogleJudge',
      [
        {
          body: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'Draft: {"checks":[{"id":"care_redirect","met":false,"reasoning":"draft","evidence":null}]}',
                      thought: true,
                    },
                    { text: TEXT },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
          },
        },
      ],
      reads('pass'),
    ),
    item(
      'google-prompt-blocked',
      3,
      'createGoogleJudge',
      [{ body: { promptFeedback: { blockReason: 'SAFETY' } } }],
      declined,
    ),
    item(
      'google-recitation',
      3,
      'createGoogleJudge',
      [{ body: { candidates: [{ content: { parts: [] }, finishReason: 'RECITATION' }] } }],
      declined,
    ),
    item(
      'google-safety',
      1,
      'createGoogleJudge',
      [{ body: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] } }],
      declined,
    ),
    item(
      'jev-probability',
      1,
      'createJevJudge',
      [{ body: { answers: { verdict: { noul: 0.83 } } } }],
      reads('pass'),
    ),
    item(
      'jev-probability-in-quotes',
      3,
      'createJevJudge',
      [{ body: { answers: { verdict: { noul: '0.83' } } } }],
      reads('pass'),
    ),
    item(
      'jev-probability-out-of-range',
      1,
      'createJevJudge',
      [{ body: { answers: { verdict: { noul: 1.7 } } } }],
      unparsed,
    ),
    item(
      'decisions-refusal',
      1,
      'createOpenAiDecisionsJudge',
      [{ body: { answers: [{ name: 'verdict', type: 'refusal' }] } }],
      declined,
    ),
    item(
      'decisions-answers-by-name',
      4,
      'createOpenAiDecisionsJudge',
      [{ body: { answers: { verdict: { probability: 0.12 } } } }],
      reads('fail'),
    ),
    item(
      'retry-after-seconds',
      3,
      'createOpenAiJudge',
      [
        { status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '7' } },
        openai({ content: TEXT }),
      ],
      (got) =>
        got.outcome === 'pass' && got.sleeps?.[0] === 7000
          ? undefined
          : 'expected one wait of 7000 ms, then the answer',
    ),
    item(
      'retry-after-date',
      4,
      'createAnthropicJudge',
      () => [
        {
          status: 503,
          body: { error: { message: 'busy' } },
          headers: { 'retry-after': new Date(Date.now() + 9000).toUTCString() },
        },
        { body: { content: [{ type: 'text', text: TEXT }], stop_reason: 'end_turn' } },
      ],
      (got) =>
        got.outcome === 'pass' && (got.sleeps?.[0] ?? 0) >= 7000 && (got.sleeps?.[0] ?? 0) <= 10000
          ? undefined
          : 'expected one wait of about 9000 ms (the HTTP date), then the answer',
    ),
    item(
      'error-never-shows-the-key',
      1,
      'createOpenAiJudge',
      [{ status: 401, body: { error: { message: 'bad key sk-bank-key-0001' } } }],
      (got) => (got.outcome === 'error' && !got.leaked ? undefined : 'the error message holds the key'),
    ),
    item(
      'no-retry-on-400',
      1,
      'createOpenAiJudge',
      [{ status: 400, body: { error: { message: 'bad request' } } }, openai({ content: TEXT })],
      (got) => (got.calls === 1 ? undefined : 'a 400 was retried'),
    ),
  ];
}
