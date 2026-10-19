import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Cassette,
  type ClientOptions,
  FakeJudge,
  type JudgeAnswer,
  type JudgeClient,
  type JudgeRequest,
  type JudgeResult,
} from '@agent-nexus/driftbench-judges';
import { loadPool } from '../../pool';
import { type BankItem, fn, type JudgesApi, pick, scratchFolder, type Tier, value } from '../bank';

/**
 * Consistency and cassettes. The same request must give the same prompt and key every time; a cassette must
 * replay what it recorded, in order, and refuse a file that cannot be replayed honestly. Repeated judging is a
 * package capability: `judgeRepeated(client, request, k)` asks k times and returns `{ outcomes, consistent }`,
 * consistent when all k outcomes are equal and decisive (pass to the k); k must be a whole number from 1. Chat
 * clients pin temperature 0, the setting that makes repeats agree.
 */

const PROMPT = 'packages/judges/src/prompt.ts';
const CASSETTE = 'packages/judges/src/cassette.ts';
const CLIENTS = 'packages/judges/src/clients/chat.ts';

type Check = (
  api: JudgesApi,
  random: () => number,
  root: string,
) => Promise<string | undefined> | string | undefined;

function check(family: string, id: string, tier: Tier, component: string, run: Check): BankItem {
  return {
    id: `${family}/${id}`,
    family,
    tier,
    level: family,
    component,
    async run({ api, random, root }) {
      const problem = await run(api, random, root);
      return problem === undefined ? { pass: true, detail: '' } : { pass: false, detail: problem };
    },
  };
}

async function someRequest(root: string, random: () => number): Promise<JudgeRequest> {
  return pick(random, (await loadPool(root)).items).request;
}

const answer = (outcome: 'pass' | 'fail' | 'inconclusive'): JudgeAnswer => ({
  outcome,
  reasoning: 'scripted',
});

type Repeated = (
  client: JudgeClient,
  request: JudgeRequest,
  k: number,
) => Promise<{ outcomes: string[]; consistent: boolean }>;

async function repeated(api: JudgesApi, answers: JudgeAnswer[], k: number, request: JudgeRequest) {
  try {
    return await fn<Repeated>(api, 'judgeRepeated')(new FakeJudge('r', answers), request, k);
  } catch (cause) {
    if (cause instanceof RangeError) return 'refused';
    throw cause;
  }
}

/** A fetch that records the body and answers as the provider would, so no network is touched. */
function capture(reply: unknown): { fetch: ClientOptions['fetch']; bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  return {
    bodies,
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(reply), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}

const ANSWER_TEXT = JSON.stringify({ outcome: 'pass', reasoning: 'ok' });
const CHAT: readonly {
  id: string;
  create: string;
  env: Record<string, string>;
  reply: unknown;
  temperature(body: Record<string, unknown>): unknown;
}[] = [
  {
    id: 'openai',
    create: 'createOpenAiJudge',
    env: { OPENAI_API_KEY: 'test-key-not-real', OPENAI_JUDGE_MODEL: 'gpt-test' },
    reply: { choices: [{ message: { content: ANSWER_TEXT }, finish_reason: 'stop' }] },
    temperature: (b) => b.temperature,
  },
  {
    id: 'anthropic',
    create: 'createAnthropicJudge',
    env: { ANTHROPIC_API_KEY: 'test-key-not-real', ANTHROPIC_JUDGE_MODEL: 'claude-test' },
    reply: { content: [{ type: 'text', text: ANSWER_TEXT }], stop_reason: 'end_turn' },
    temperature: (b) => b.temperature,
  },
  {
    id: 'google',
    create: 'createGoogleJudge',
    env: { GEMINI_API_KEY: 'test-key-not-real', GOOGLE_JUDGE_MODEL: 'gemini-test' },
    reply: { candidates: [{ content: { parts: [{ text: ANSWER_TEXT }] }, finishReason: 'STOP' }] },
    temperature: (b) => (b.generationConfig as Record<string, unknown> | undefined)?.temperature,
  },
];

export function consistencyItems(): BankItem[] {
  const c = (id: string, tier: Tier, component: string, run: Check) =>
    check('consistency', id, tier, component, run);
  const out: BankItem[] = [
    c('prompt-identical-five-times', 1, PROMPT, async (api, r, root) => {
      const request = await someRequest(root, r);
      const build = fn<(q: JudgeRequest) => { user: string; system: string }>(api, 'buildPrompt');
      const first = JSON.stringify(build(request));
      for (let i = 0; i < 4; i += 1)
        if (JSON.stringify(build(request)) !== first) return `repeat ${i + 2} differs`;
      return undefined;
    }),
    c('key-identical-five-times', 1, CASSETTE, async (api, r, root) => {
      const request = await someRequest(root, r);
      const key = fn<(q: JudgeRequest) => string>(api, 'requestKey');
      const first = key(request);
      for (let i = 0; i < 4; i += 1) if (key(structuredClone(request)) !== first) return 'the key moved';
      return undefined;
    }),
    c('key-ignores-ledger-key-order', 1, CASSETTE, (api) => {
      const key = fn<(q: JudgeRequest) => string>(api, 'requestKey');
      const base = {
        criterion: { name: 'x', rubric: 'y' },
        transcript: [{ role: 'agent' as const, text: 'z' }],
      };
      return key({ ...base, given: { ledger: { a: 1, b: 2 } } }) ===
        key({ ...base, given: { ledger: { b: 2, a: 1 } } })
        ? undefined
        : 'two orders of the same ledger give two keys';
    }),
    c('key-separates-large-budget', 1, CASSETTE, async (api, r, root) => {
      const request = await someRequest(root, r);
      const key = fn<(q: JudgeRequest) => string>(api, 'requestKey');
      if (key({ ...request, budget: 'large' }) === key(request)) return 'the large budget shares the key';
      return key({ ...request, budget: 'normal' }) === key(request)
        ? undefined
        : 'the normal budget has its own key';
    }),
    c('key-separates-transcript-order', 1, CASSETTE, async (api, r, root) => {
      const request = await someRequest(root, r);
      const key = fn<(q: JudgeRequest) => string>(api, 'requestKey');
      const reversed = { ...request, transcript: [...request.transcript].reverse() };
      return request.transcript.length < 2 || key(reversed) !== key(request)
        ? undefined
        : 'entry order is ignored';
    }),
    c('parse-is-idempotent', 1, 'packages/judges/src/contract.ts', (api, r) => {
      const parse = fn<(raw: string) => JudgeResult>(api, 'parseAnswerText');
      const once = parse(
        JSON.stringify({ outcome: r() < 0.5 ? 'pass' : 'fail', score: 0.5, reasoning: 'x' }),
      );
      const twice = parse(once.raw);
      return JSON.stringify(once.answer) === JSON.stringify(twice.answer)
        ? undefined
        : 'a second parse changes the answer';
    }),
    c('council-identical-five-runs', 2, 'packages/judges/src/council.ts', async (api, r, root) => {
      const request = await someRequest(root, r);
      const create = fn<(c: Record<string, unknown>) => { judge(q: JudgeRequest): Promise<unknown> }>(
        api,
        'createCouncil',
      );
      const runs: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const judges = [1, 2, 3].map(
          (j) => new FakeJudge(`j${j}`, [answer(j === 2 ? 'fail' : 'pass')], { cost: j, family: `f${j}` }),
        );
        runs.push(
          JSON.stringify(await create({ mode: 'system1', agentFamily: 'none', judges }).judge(request)),
        );
      }
      return new Set(runs).size === 1 ? undefined : 'five runs of one council differ';
    }),
    c('repeated-consistent-pass', 3, 'packages/judges/src/council.ts', async (api, r, root) => {
      const got = await repeated(api, [answer('pass')], 5, await someRequest(root, r));
      return got !== 'refused' && got.consistent && got.outcomes.length === 5
        ? undefined
        : `got ${JSON.stringify(got)}`;
    }),
    c('repeated-flip-on-fourth', 3, 'packages/judges/src/council.ts', async (api, r, root) => {
      const got = await repeated(
        api,
        [answer('pass'), answer('pass'), answer('pass'), answer('fail'), answer('pass')],
        5,
        await someRequest(root, r),
      );
      return got !== 'refused' && !got.consistent && got.outcomes[3] === 'fail'
        ? undefined
        : `got ${JSON.stringify(got)}`;
    }),
    c(
      'repeated-inconclusive-is-not-consistent',
      3,
      'packages/judges/src/council.ts',
      async (api, r, root) => {
        const got = await repeated(api, [answer('inconclusive')], 5, await someRequest(root, r));
        return got !== 'refused' && !got.consistent ? undefined : `got ${JSON.stringify(got)}`;
      },
    ),
    c('repeated-consistent-fail', 3, 'packages/judges/src/council.ts', async (api, r, root) => {
      const got = await repeated(api, [answer('fail')], 5, await someRequest(root, r));
      return got !== 'refused' && got.consistent && got.outcomes.every((o) => o === 'fail')
        ? undefined
        : `got ${JSON.stringify(got)}`;
    }),
    c('repeated-zero-refused', 2, 'packages/judges/src/council.ts', async (api, r, root) => {
      const got = await repeated(api, [answer('pass')], 0, await someRequest(root, r));
      return got === 'refused' ? undefined : `k 0 gave ${JSON.stringify(got)}`;
    }),
    c('repeated-fraction-refused', 2, 'packages/judges/src/council.ts', async (api, r, root) => {
      const got = await repeated(api, [answer('pass')], 2.5, await someRequest(root, r));
      return got === 'refused' ? undefined : `k 2.5 gave ${JSON.stringify(got)}`;
    }),
    c('calibration-catches-fourth-repeat', 2, 'packages/judges/src/calibration.ts', async (api) => {
      const calibrate = fn<
        (c: Record<string, unknown>) => Promise<{
          criteria: { judges: { judge: string; meetsBar: boolean; separation: { separated: number } }[] }[];
        }>
      >(api, 'calibrate');
      const fixture = (text: string) => ({ transcript: [{ role: 'agent' as const, text }] });
      const crit = {
        path: 'x.yaml',
        def: { name: 'c', rubric: 'r', pass: 'p', fail: 'f' },
        fixtures: { pass: fixture('yes'), fail: fixture('no') },
      };
      let calls = 0;
      const flaky = new FakeJudge('flaky', [
        (q: JudgeRequest) => {
          const text = q.transcript[0]?.text;
          if (text === 'no') calls += 1;
          return answer(text === 'yes' ? 'pass' : calls === 4 ? 'pass' : 'fail');
        },
      ]);
      const report = await calibrate({
        judges: [flaky],
        criteria: [crit],
        labels: new Map([
          [
            'c',
            [
              { id: 'b1', label: 'pass', transcript: [{ role: 'agent', text: 'yes' }] },
              { id: 'b2', label: 'fail', transcript: [{ role: 'agent', text: 'no' }] },
            ],
          ],
        ]),
        repeats: 5,
        mode: 'system1',
      });
      const row = report.criteria[0]?.judges[0];
      return row && !row.meetsBar && row.separation.separated === 4
        ? undefined
        : `row ${JSON.stringify(row)}`;
    }),
  ];
  for (const chat of CHAT) {
    out.push(
      c(`temperature-zero-${chat.id}`, 2, CLIENTS, async (api, r, root) => {
        const request = await someRequest(root, r);
        const { fetch, bodies } = capture(chat.reply);
        const client = fn<(o: ClientOptions) => JudgeClient>(
          api,
          chat.create,
        )({ env: chat.env, fetch, maxRetries: 0 });
        await client.judge(request);
        const t = bodies[0] ? chat.temperature(bodies[0]) : undefined;
        return t === 0 ? undefined : `${chat.id} sends temperature ${JSON.stringify(t)}`;
      }),
      c(`five-calls-same-body-${chat.id}`, 1, CLIENTS, async (api, r, root) => {
        const request = await someRequest(root, r);
        const { fetch, bodies } = capture(chat.reply);
        const client = fn<(o: ClientOptions) => JudgeClient>(
          api,
          chat.create,
        )({ env: chat.env, fetch, maxRetries: 0 });
        for (let i = 0; i < 5; i += 1) await client.judge(request);
        return new Set(bodies.map((b) => JSON.stringify(b))).size === 1
          ? undefined
          : `${chat.id} sends different bodies for one request`;
      }),
    );
  }
  return out;
}

type CassetteApi = {
  emptyCassette(): Cassette;
  recordingClient(client: JudgeClient, cassette: Cassette): JudgeClient;
  playerClient(cassette: Cassette, id: string): JudgeClient;
  saveCassette(path: string, cassette: Cassette): Promise<void>;
  loadCassette(path: string): Promise<Cassette>;
  requestKey(request: JudgeRequest): string;
};

function cassetteApi(api: JudgesApi): CassetteApi {
  return {
    emptyCassette: fn(api, 'emptyCassette'),
    recordingClient: fn(api, 'recordingClient'),
    playerClient: fn(api, 'playerClient'),
    saveCassette: fn(api, 'saveCassette'),
    loadCassette: fn(api, 'loadCassette'),
    requestKey: fn(api, 'requestKey'),
  };
}

/** Writes a cassette file as text and asks the package to load it: refused or loaded. */
async function loads(api: JudgesApi, text: string): Promise<'refused' | 'loaded'> {
  const dir = scratchFolder('judges-bank-');
  const path = join(dir, 'c.cassette.json');
  writeFileSync(path, text, 'utf8');
  const load = cassetteApi(api).loadCassette;
  try {
    await load(path);
    return 'loaded';
  } catch {
    return 'refused';
  }
}

const JUDGE = { id: 'j', family: 'f', cls: 'system1', cost: 1 };

export function cassetteItems(): BankItem[] {
  const c = (id: string, tier: Tier, run: Check) => check('cassette', id, tier, CASSETTE, run);
  const record = async (
    api: JudgesApi,
    request: JudgeRequest,
    answers: (JudgeAnswer | string | Error)[],
    calls: number,
  ) => {
    const k = cassetteApi(api);
    const cassette = k.emptyCassette();
    const client = k.recordingClient(new FakeJudge('j', answers), cassette);
    for (let i = 0; i < calls; i += 1) {
      try {
        await client.judge(request);
      } catch {
        // a recorded failure
      }
    }
    return cassette;
  };
  return [
    c('replays-in-order-then-last', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const cassette = await record(api, request, [answer('pass'), answer('fail'), answer('pass')], 3);
      const player = cassetteApi(api).playerClient(cassette, 'j');
      const got: string[] = [];
      for (let i = 0; i < 5; i += 1) got.push((await player.judge(request)).answer.outcome);
      return got.join(',') === 'pass,fail,pass,pass,pass' ? undefined : `replayed ${got.join(',')}`;
    }),
    c('miss-never-invents', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const cassette = await record(api, request, [answer('pass')], 1);
      try {
        await cassetteApi(api)
          .playerClient(cassette, 'j')
          .judge({ ...request, criterion: { ...request.criterion, name: 'other' } });
        return 'a request with no recording got an answer';
      } catch (cause) {
        return (cause as { code?: string }).code === 'cassette_miss' ? undefined : `threw ${String(cause)}`;
      }
    }),
    c('error-replays-as-error', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const cassette = await record(api, request, [new Error('down')], 1);
      try {
        await cassetteApi(api).playerClient(cassette, 'j').judge(request);
        return 'a recorded failure replayed as an answer';
      } catch {
        return undefined;
      }
    }),
    c('unparsed-replays-unparsed', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const cassette = await record(api, request, ['no json here'], 1);
      const result = await cassetteApi(api).playerClient(cassette, 'j').judge(request);
      return result.unparsed && result.answer.outcome === 'inconclusive'
        ? undefined
        : `replayed ${JSON.stringify(result)}`;
    }),
    c('save-load-round-trip', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const cassette = await record(api, request, [answer('pass'), 'garbage', answer('fail')], 3);
      const dir = scratchFolder('judges-bank-');
      const path = join(dir, 'rt.cassette.json');
      await cassetteApi(api).saveCassette(path, cassette);
      const first = readFileSync(path, 'utf8');
      await cassetteApi(api).saveCassette(path, await cassetteApi(api).loadCassette(path));
      return readFileSync(path, 'utf8') === first ? undefined : 'a load and save changes the file';
    }),
    c('unicode-round-trip', 1, async (api) => {
      const request: JudgeRequest = {
        criterion: { name: 'u', rubric: 'é中' },
        transcript: [{ role: 'user', text: '\u{1F642} شكرا 谢' }],
      };
      const cassette = await record(api, request, [{ outcome: 'pass', reasoning: 'éè 中文 \u{1F642}' }], 1);
      const dir = scratchFolder('judges-bank-');
      const path = join(dir, 'u.cassette.json');
      await cassetteApi(api).saveCassette(path, cassette);
      const back = await cassetteApi(api)
        .playerClient(await cassetteApi(api).loadCassette(path), 'j')
        .judge(request);
      return back.answer.reasoning === 'éè 中文 \u{1F642}' ? undefined : 'unicode changed in the round trip';
    }),
    c('unknown-judge-player-refused', 1, async (api, r, root) => {
      const cassette = await record(api, await someRequest(root, r), [answer('pass')], 1);
      try {
        cassetteApi(api).playerClient(cassette, 'nobody');
        return 'a player was made for a judge the cassette does not list';
      } catch {
        return undefined;
      }
    }),
    c('two-players-independent', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const cassette = await record(api, request, [answer('pass'), answer('fail')], 2);
      const a = cassetteApi(api).playerClient(cassette, 'j');
      const b = cassetteApi(api).playerClient(cassette, 'j');
      await a.judge(request);
      return (await b.judge(request)).answer.outcome === 'pass'
        ? undefined
        : 'a second player starts where the first stopped';
    }),
    c('judge-listed-once', 1, async (api, r, root) => {
      const cassette = await record(api, await someRequest(root, r), [answer('pass')], 4);
      return cassette.judges.length === 1 ? undefined : `${cassette.judges.length} judge rows for one judge`;
    }),
    c('large-budget-own-entry', 1, async (api, r, root) => {
      const request = await someRequest(root, r);
      const k = cassetteApi(api);
      const cassette = k.emptyCassette();
      const client = k.recordingClient(new FakeJudge('j', [answer('pass'), answer('fail')]), cassette);
      await client.judge(request);
      await client.judge({ ...request, budget: 'large' });
      const player = k.playerClient(cassette, 'j');
      const large = await player.judge({ ...request, budget: 'large' });
      return large.answer.outcome === 'fail' ? undefined : 'the large budget replays the normal answer';
    }),
    c('version-two-refused', 1, async (api) =>
      (await loads(api, JSON.stringify({ version: 2, judges: [JUDGE], entries: [] }))) === 'refused'
        ? undefined
        : 'version 2 loaded',
    ),
    c('not-json-refused', 1, async (api) =>
      (await loads(api, '{ version: 1')) === 'refused' ? undefined : 'broken JSON loaded',
    ),
    c('duplicate-judge-refused', 3, async (api) =>
      (await loads(api, JSON.stringify({ version: 1, judges: [JUDGE, JUDGE], entries: [] }))) === 'refused'
        ? undefined
        : 'a judge listed twice loaded',
    ),
    c('entry-of-unknown-judge-refused', 3, async (api) =>
      (await loads(
        api,
        JSON.stringify({
          version: 1,
          judges: [JUDGE],
          entries: [{ judge: 'ghost', key: 'k', answer: answer('pass') }],
        }),
      )) === 'refused'
        ? undefined
        : 'an entry of an unlisted judge loaded',
    ),
    c('entry-with-answer-and-error-refused', 3, async (api) =>
      (await loads(
        api,
        JSON.stringify({
          version: 1,
          judges: [JUDGE],
          entries: [{ judge: 'j', key: 'k', answer: answer('pass'), error: 'down' }],
        }),
      )) === 'refused'
        ? undefined
        : 'an entry holding both an answer and an error loaded',
    ),
    c('empty-entry-refused', 3, async (api) =>
      (await loads(
        api,
        JSON.stringify({ version: 1, judges: [JUDGE], entries: [{ judge: 'j', key: 'k' }] }),
      )) === 'refused'
        ? undefined
        : 'an entry with no answer, raw text or error loaded',
    ),
    c('answer-breaking-contract-refused', 4, async (api) =>
      (await loads(
        api,
        JSON.stringify({
          version: 1,
          judges: [JUDGE],
          entries: [{ judge: 'j', key: 'k', answer: { outcome: 'maybe' } }],
        }),
      )) === 'refused'
        ? undefined
        : 'an answer that breaks the contract loaded',
    ),
    c('negative-cost-refused', 1, async (api) =>
      (await loads(api, JSON.stringify({ version: 1, judges: [{ ...JUDGE, cost: -1 }], entries: [] }))) ===
      'refused'
        ? undefined
        : 'a negative cost loaded',
    ),
    c('key-not-hex-refused', 4, async (api) =>
      (await loads(
        api,
        JSON.stringify({
          version: 1,
          judges: [JUDGE],
          entries: [{ judge: 'j', key: 'not a key', answer: answer('pass') }],
        }),
      )) === 'refused'
        ? undefined
        : 'an entry whose key is not a request hash loaded',
    ),
    c('no-secret-in-recording', 2, async (api, r, root) => {
      const request = await someRequest(root, r);
      const { fetch } = capture({ choices: [{ message: { content: ANSWER_TEXT }, finish_reason: 'stop' }] });
      const k = cassetteApi(api);
      const cassette = k.emptyCassette();
      const live = fn<(o: ClientOptions) => JudgeClient>(
        api,
        'createOpenAiJudge',
      )({
        env: { OPENAI_API_KEY: 'sk-bank-secret-0000', OPENAI_JUDGE_MODEL: 'gpt-test' },
        fetch,
        maxRetries: 0,
      });
      await k.recordingClient(live, cassette).judge(request);
      return JSON.stringify(cassette).includes('sk-bank-secret-0000')
        ? 'the key reached the cassette'
        : undefined;
    }),
    c('cost-kept-in-recording', 1, async (api, r, root) => {
      const k = cassetteApi(api);
      const cassette = k.emptyCassette();
      await k
        .recordingClient(new FakeJudge('j', [answer('pass')], { cost: 7 }), cassette)
        .judge(await someRequest(root, r));
      return cassette.judges[0]?.cost === 7 && value(api, 'Cassette') ? undefined : 'the cost was not kept';
    }),
  ];
}
