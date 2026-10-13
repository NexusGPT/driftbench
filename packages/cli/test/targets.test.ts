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
