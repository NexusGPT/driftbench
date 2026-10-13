import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error the example server is plain JavaScript
import { createEchoServer } from '../../../examples/http-target/server.mjs';
import { noAdapter } from '../src/commands/campaign';
import { type Io, main } from '../src/index';
import { resetPlugins } from '../src/plugins';
import { BUILTIN_TARGETS_NOTE, builtinTarget, builtinTargetHint } from '../src/targets';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const KNOWN =
  'The CLI reaches function:acme-sales (or function:acme), the Acme sales assistant, and process:acme-ops, the Acme ops agent.';

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), out, err };
}

function listen(server: Server): Promise<string> {
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

let echo: Server;
let echoUrl = '';
/** A stand-in for an OpenAI-compatible endpoint: it records each request and repeats the last user message. */
let proxy: Server;
let proxyUrl = '';
const proxied: Array<{ path: string; authorization: string | undefined; model: unknown; system: unknown }> =
  [];
let dir = '';
const saved = { ...process.env };

beforeAll(async () => {
  echo = createEchoServer();
  echoUrl = `${await listen(echo)}/turn`;
  proxy = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body) as {
        model: unknown;
        messages: Array<{ role: string; content: string }>;
      };
      proxied.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        model: parsed.model,
        system: parsed.messages.find((message) => message.role === 'system')?.content,
      });
      const last = parsed.messages.filter((message) => message.role === 'user').at(-1);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: `You said: ${last?.content ?? ''}` } }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
      );
    });
  });
  proxyUrl = await listen(proxy);
  dir = await mkdtemp(join(tmpdir(), 'driftbench-targets-'));
});

afterAll(async () => {
  await new Promise((done) => echo.close(done));
  await new Promise((done) => proxy.close(done));
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  resetPlugins();
  proxied.length = 0;
  for (const name of [
    'DRIFTBENCH_HTTP_URL',
    'LITELLM_BASE_URL',
    'LITELLM_API_KEY',
    'MY_PROXY_KEY',
    'MY_TOKEN',
  ]) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

async function spec(name: string, target: string): Promise<string> {
  const path = join(dir, `${name}.yaml`);
  await writeFile(
    path,
    [
      `id: targets-${name}`,
      "version: '1'",
      'title: One block on a built-in target',
      'channel: chat',
      'lang: EN',
      `target: ${target}`,
      'blocks:',
      '  - user: Hello there',
      "    expect: { must: ['You said: Hello there'] }",
      '',
    ].join('\n'),
  );
  return path;
}

describe('built-in targets', () => {
  it('http: the URL of target.options reaches the agent, from the spec alone', async () => {
    const path = await spec('http', `{ adapter: http, agent: echo, options: { url: '${echoUrl}' } }`);
    const run = await cli(['campaign', 'run', path]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(run.out).toContain('✓ targets-http · http:echo · F · repeat 0  pass  1 block');
  });

  it('http: --target takes the URL from DRIFTBENCH_HTTP_URL', async () => {
    const path = await spec('http-env', '{ adapter: function, agent: acme-sales }');
    process.env.DRIFTBENCH_HTTP_URL = echoUrl;
    const run = await cli(['campaign', 'run', path, '--target', 'http:echo']);
    expect(run.code).toBe(0);
    expect(run.out).toContain('· http:echo ·');
  });

  it('http: without a URL the target is refused, and the message says what to set', async () => {
    delete process.env.DRIFTBENCH_HTTP_URL;
    const run = await cli([
      'smoke',
      'examples/acme/specs/conversations/plan-upgrade.yaml',
      '--target',
      'http:bot',
    ]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(
      `No adapter is set up for http:bot. An http target needs its URL: set target.options.url in the spec, or DRIFTBENCH_HTTP_URL. ${KNOWN} ${BUILTIN_TARGETS_NOTE}\n`,
    );
  });

  it('http: a header comes from the environment variable headers_env names, never from the spec', async () => {
    const target = { adapter: 'http', options: { url: echoUrl, headers_env: { authorization: 'MY_TOKEN' } } };
    delete process.env.MY_TOKEN;
    expect(builtinTargetHint(target)).toBe(
      'An http target reads the header authorization from MY_TOKEN, which is not set.',
    );
    expect(builtinTargetHint(target, { MY_TOKEN: 'Bearer t' })).toBeUndefined();
    expect(builtinTargetHint({ adapter: 'http', options: { url: echoUrl, headers: { 'x-a': 1 } } })).toBe(
      "An http target's header x-a must be a string.",
    );
  });

  it('litellm: base_url, the model of the target and the key of api_key_env reach the endpoint', async () => {
    process.env.MY_PROXY_KEY = 'k-123';
    const path = await spec(
      'litellm',
      `{ adapter: litellm, agent: demo-model, options: { base_url: '${proxyUrl}/v1/', api_key_env: MY_PROXY_KEY, system: Be brief. } }`,
    );
    const run = await cli(['campaign', 'run', path]);
    expect(run.err).toBe('');
    expect(run.code).toBe(0);
    expect(proxied).toEqual([
      {
        path: '/v1/chat/completions',
        authorization: 'Bearer k-123',
        model: 'demo-model',
        system: 'Be brief.',
      },
    ]);
  });

  it('litellm: the missing setting is named', () => {
    expect(builtinTargetHint({ adapter: 'litellm', agent: 'm' }, {})).toBe(
      'A litellm target needs the endpoint: set target.options.base_url in the spec, or LITELLM_BASE_URL.',
    );
    expect(builtinTargetHint({ adapter: 'litellm' }, { LITELLM_BASE_URL: proxyUrl })).toBe(
      'A litellm target needs a model: write it as litellm:<model>, or set target.options.model.',
    );
    expect(
      builtinTargetHint(
        { adapter: 'litellm', agent: 'm', options: { base_url: proxyUrl, api_key_env: 'NOPE' } },
        {},
      ),
    ).toBe('A litellm target reads its key from NOPE, which is not set.');
    expect(
      builtinTargetHint({ adapter: 'litellm', agent: 'm' }, { LITELLM_BASE_URL: proxyUrl }),
    ).toBeUndefined();
  });

  it('nexus: needs the agent, the deployment and the key, in that order', () => {
    expect(builtinTargetHint({ adapter: 'nexus', agent: 'max' }, { NEXUS_API_KEY: 'k' })).toBe(
      'A nexus target needs the agent id and target.deployment, a deployment id of that agent, in the spec.',
    );
    expect(builtinTargetHint({ adapter: 'nexus', agent: 'a', deployment: 'd' }, {})).toBe(
      'A nexus target reads its key from NEXUS_API_KEY, which is not set.',
    );
    const ready = builtinTarget({ adapter: 'nexus', agent: 'a', deployment: 'd' }, { NEXUS_API_KEY: 'k' });
    expect(ready !== undefined && 'adapter' in ready && ready.adapter.id).toBe('nexus');
  });

  it('other adapters are not built in, and their refusal only gains the note', () => {
    expect(builtinTarget({ adapter: 'langgraph', agent: 'x' })).toBeUndefined();
    expect(noAdapter({ adapter: 'function', agent: 'nobody' })).toBe(
      `No adapter is set up for function:nobody. ${KNOWN} ${BUILTIN_TARGETS_NOTE}`,
    );
  });

  it('a plugin that registers http replaces the built-in one', async () => {
    const path = await spec('http-plugin', '{ adapter: http, agent: echo }');
    let asked = 0;
    const io: Io = { out: () => {}, err: () => {}, cwd: ROOT };
    const code = await main(['campaign', 'run', path], io, {
      plugins: [
        (api) =>
          api.adapter('http', (target) => {
            asked++;
            const built = builtinTarget({ ...target, options: { url: echoUrl } });
            return built !== undefined && 'adapter' in built ? built.adapter : undefined;
          }),
      ],
    });
    expect(code).toBe(0);
    expect(asked).toBe(1);
  });
});

/** A server that answers every request with `status` and a body that repeats the secrets it received. */
function leaky(status: number, extra: Record<string, string> = {}): Server {
  return createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(status, { 'content-type': 'application/json', ...extra });
      response.end(
        JSON.stringify({
          error: {
            message: `rejected ${request.headers.authorization ?? ''} ${request.headers['x-api-key'] ?? ''}`,
          },
        }),
      );
    });
  });
}

/** A server that counts its requests and remembers the key header of the last one. */
function recorder(): { server: Server; hits: () => number; key: () => string | undefined } {
  let hits = 0;
  let key: string | undefined;
  const server = createServer((request, response) => {
    hits++;
    key = request.headers['x-api-key'] as string | undefined;
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'You said: Hello there' } }] }),
      );
    });
  });
  return { server, hits: () => hits, key: () => key };
}

const close = (server: Server) => new Promise((done) => server.close(done));
const SENTINEL = 'sk-sentinel-4f9a7c21d8';

describe('built-in targets keep secrets out of results', () => {
  it('litellm: a 401 that repeats the key reaches neither the output nor the store', async () => {
    const server = leaky(401);
    const url = await listen(server);
    process.env.MY_PROXY_KEY = SENTINEL;
    try {
      const path = await spec(
        'leak-litellm',
        `{ adapter: litellm, agent: m, options: { base_url: '${url}', api_key_env: MY_PROXY_KEY } }`,
      );
      const store = join(dir, 'leak-litellm.db');
      const run = await cli(['campaign', 'run', path, '--json', '--store', store, '--retry-attempts', '1']);
      expect(run.code).toBe(1);
      expect(run.out).toContain('answered 401');
      expect(run.out + run.err).not.toContain(SENTINEL);
      expect(readFileSync(store).includes(SENTINEL)).toBe(false);
    } finally {
      await close(server);
    }
  });

  it('http: a failing status that repeats a headers_env value reaches neither the output nor the store', async () => {
    const server = leaky(500);
    const url = await listen(server);
    process.env.MY_TOKEN = SENTINEL;
    try {
      const path = await spec(
        'leak-http',
        `{ adapter: http, agent: bot, options: { url: '${url}/turn', headers_env: { x-api-key: MY_TOKEN } } }`,
      );
      const store = join(dir, 'leak-http.db');
      const run = await cli(['campaign', 'run', path, '--json', '--store', store, '--retry-attempts', '1']);
      expect(run.code).toBe(1);
      expect(run.out).toContain('answered 500');
      expect(run.out).toContain('upstream body and headers are not shown');
      expect(run.out + run.err).not.toContain(SENTINEL);
      expect(readFileSync(store).includes(SENTINEL)).toBe(false);
    } finally {
      await close(server);
    }
  });

  it('http: the body of a 401 or a 403 is never shown', async () => {
    const server = leaky(403);
    const url = await listen(server);
    process.env.MY_TOKEN = SENTINEL;
    try {
      const path = await spec(
        'auth-http',
        `{ adapter: http, agent: auth, options: { url: '${url}/turn', headers_env: { x-api-key: MY_TOKEN } } }`,
      );
      const run = await cli(['campaign', 'run', path, '--json', '--retry-attempts', '1']);
      expect(run.code).toBe(1);
      expect(run.out).toContain('answered 403');
      expect(run.out).toContain('upstream body and headers are not shown');
      expect(run.out).not.toContain('rejected');
      expect(run.out + run.err).not.toContain(SENTINEL);
    } finally {
      await close(server);
    }
  });

  it('nexus: the key never appears in an error the adapter throws', async () => {
    const built = builtinTarget(
      { adapter: 'nexus', agent: 'a', deployment: 'd' },
      { NEXUS_API_KEY: SENTINEL, NEXUS_BASE_URL: 'http://127.0.0.1:1' },
    );
    expect(built !== undefined && 'adapter' in built).toBe(true);
    if (built === undefined || !('adapter' in built)) return;
    const given = { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'nexus' }, hash: 'h' };
    const failure = await built.adapter.open(given).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure as object))).not.toContain(SENTINEL);
  });
});

describe('built-in targets refuse redirects', () => {
  it('http: a 307 to another origin is refused, and neither the POST nor the key header goes there', async () => {
    const other = recorder();
    const otherUrl = await listen(other.server);
    const first = leaky(307, { location: `${otherUrl}/turn` });
    const url = await listen(first);
    process.env.MY_TOKEN = SENTINEL;
    try {
      const path = await spec(
        'redirect-cross',
        `{ adapter: http, agent: bot, options: { url: '${url}/turn', redirects: same-origin, headers_env: { x-api-key: MY_TOKEN } } }`,
      );
      const run = await cli(['campaign', 'run', path, '--json', '--retry-attempts', '1']);
      expect(run.code).toBe(1);
      expect(other.hits()).toBe(0);
      expect(other.key()).toBeUndefined();
      expect(run.out).toContain('redirects to another origin or credentials are refused');
    } finally {
      await close(first);
      await close(other.server);
    }
  });

  it('http: a redirect on the same origin is refused unless redirects: same-origin allows it', async () => {
    let hits = 0;
    const server = createServer((request, response) => {
      hits++;
      request.resume();
      request.on('end', () => {
        if (request.url === '/old') {
          response.writeHead(307, { location: '/turn' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'You said: Hello there' } }] }),
        );
      });
    });
    const url = await listen(server);
    try {
      const refused = await cli([
        'campaign',
        'run',
        await spec('redirect-same-off', `{ adapter: http, agent: a, options: { url: '${url}/old' } }`),
        '--json',
        '--retry-attempts',
        '1',
      ]);
      expect(refused.code).toBe(1);
      expect(hits).toBe(1);
      expect(refused.out).toContain('redirects are refused');
      hits = 0;
      const followed = await cli([
        'campaign',
        'run',
        await spec(
          'redirect-same-on',
          `{ adapter: http, agent: b, options: { url: '${url}/old', redirects: same-origin } }`,
        ),
      ]);
      expect(followed.err).toBe('');
      expect(followed.code).toBe(0);
      expect(hits).toBe(2);
    } finally {
      await close(server);
    }
  });

  it('litellm: a redirect is refused and the key goes nowhere else', async () => {
    const other = recorder();
    const otherUrl = await listen(other.server);
    const first = leaky(307, { location: `${otherUrl}/chat/completions` });
    const url = await listen(first);
    process.env.MY_PROXY_KEY = SENTINEL;
    try {
      const path = await spec(
        'redirect-litellm',
        `{ adapter: litellm, agent: m, options: { base_url: '${url}', api_key_env: MY_PROXY_KEY } }`,
      );
      const run = await cli(['campaign', 'run', path, '--json', '--retry-attempts', '1']);
      expect(run.code).toBe(1);
      expect(other.hits()).toBe(0);
      expect(run.out).toContain('redirect');
      expect(run.out + run.err).not.toContain(SENTINEL);
    } finally {
      await close(first);
      await close(other.server);
    }
  });
});
