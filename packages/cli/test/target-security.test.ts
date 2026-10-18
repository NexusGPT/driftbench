import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/main';

let dir: string;
let secret: string;
const encodings = {
  literal: (value: string) => value,
  percent: encodeURIComponent,
  'percent-lower': (value: string) =>
    encodeURIComponent(value).replace(/%[A-F\d]{2}/g, (part) => part.toLowerCase()),
  base64: (value: string) => Buffer.from(value).toString('base64'),
  'base64-unpadded': (value: string) => Buffer.from(value).toString('base64').replace(/=+$/, ''),
  base64url: (value: string) => Buffer.from(value).toString('base64url'),
  'base64url-padded': (value: string) =>
    Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  hex: (value: string) => Buffer.from(value).toString('hex'),
  'hex-upper': (value: string) => Buffer.from(value).toString('hex').toUpperCase(),
};
const adapters = ['http', 'litellm', 'nexus'] as const;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'target-security-'));
  secret = `test/${randomUUID()}?+=`;
  vi.stubEnv('TARGET_TEST_KEY', secret);
  vi.stubEnv('NEXUS_API_KEY', secret);
  vi.stubEnv('NEXUS_BASE_URL', 'https://target.example');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function run(adapter: string, extra: Record<string, unknown> = {}) {
  const path = join(dir, 'spec.yaml');
  const options =
    adapter === 'http'
      ? {
          url: 'https://target.example/turn',
          headers_env: { 'x-api-key': 'TARGET_TEST_KEY' },
          deterministic: true,
        }
      : adapter === 'litellm'
        ? { base_url: 'https://target.example', api_key_env: 'TARGET_TEST_KEY', deterministic: true }
        : {};
  await writeFile(
    path,
    JSON.stringify({
      id: 'secret-echo',
      version: '1',
      title: 'Secret echo',
      channel: 'chat',
      lang: 'EN',
      target: {
        adapter,
        agent: 'demo',
        ...(adapter === 'nexus' ? { deployment: 'demo' } : {}),
        options: { ...options, ...extra },
      },
      blocks: [{ user: 'Hello' }],
    }),
  );
  let out = '';
  let err = '';
  const store = join(dir, 'runs.db');
  const code = await main(['campaign', 'run', path, '--store', store, '--json', '--retry-attempts', '1'], {
    cwd: dir,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  // The SQLite store also holds the cache; inspect all sidecars before removing the fixture.
  const files = readdirSync(dir)
    .filter((name) => name !== 'spec.yaml')
    .map((name) => readFileSync(join(dir, name)));
  return { code, out, err, store, files };
}

function absent(result: Awaited<ReturnType<typeof run>>, values: string[]) {
  for (const value of values) {
    // Only booleans reach test diagnostics, including on the deliberately failing first run.
    expect(result.out.includes(value)).toBe(false);
    expect(result.err.includes(value)).toBe(false);
    expect(result.files.some((bytes) => bytes.includes(value))).toBe(false);
  }
}

function successFetch(content: string, raw?: unknown) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname;
    let data: unknown = {};
    if (path.endsWith('/golden-conversations')) data = { id: 'conversation' };
    else if (path.endsWith('/generate'))
      data = { sessionId: 'session', candidate: { content, toolCalls: [] } };
    else if (path.includes('/emulator/')) data = { chatId: 'chat' };
    else if (path === '/api/public/v1/tracing/traces') data = [{ id: 'trace', status: 'COMPLETED' }];
    else if (path.endsWith('/traces/trace')) data = { generations: [{ id: 'generation' }] };
    else if (path.endsWith('/generations/generation'))
      data = { id: 'generation', status: 'COMPLETED', response: content };
    if (path.startsWith('/api/public/v1/')) return Response.json({ success: true, data });
    if (path === '/turn' && raw !== undefined)
      return Response.json({
        segments: [
          { type: 'text', text: content },
          { type: 'tool_call', label: 'echo', input: { echoed: content } },
        ],
        text: content,
        toolCalls: [{ label: 'echo', input: { echoed: content } }],
        cost: {},
        latencyMs: 0,
        raw,
      });
    expect(
      new Headers(init?.headers).has('authorization') || new Headers(init?.headers).has('x-api-key'),
    ).toBe(true);
    return Response.json({ choices: [{ message: { role: 'assistant', content } }] });
  });
}

describe('target error disclosure', () => {
  it.each(adapters.flatMap((adapter) => ['percent', 'base64'].map((encoding) => [adapter, encoding])))(
    '%s suppresses the whole encoded %s error body',
    async (adapter, encoding) => {
      const encoded = encodings[encoding as keyof typeof encodings](secret);
      const body = JSON.stringify({ error: { message: `upstream-body-marker ${encoded}` } });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body, { status: 400, headers: { 'x-secret': encoded } })),
      );
      const result = await run(adapter);
      expect(result.code).toBe(1);
      absent(result, [secret, encoded, 'upstream-body-marker', 'x-secret']);
      expect(result.out).toContain('answered 400');
      expect(result.out).toContain(`body length ${Buffer.byteLength(body)}`);
    },
  );

  it.each(adapters)('%s discards arbitrary thrown transport details and causes', async (adapter) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new Error('upstream-transport-marker'), {
          cause: { headers: { key: encodings.hex(secret) } },
        });
      }),
    );
    const result = await run(adapter);
    expect(result.code).toBe(1);
    absent(result, [secret, encodings.hex(secret), 'upstream-transport-marker']);
    expect(result.out).toContain('transport failed');
  });

  it.each(['url', 'headers'])(
    'refuses inline credential %s before recording target inputs',
    async (field) => {
      vi.stubGlobal('fetch', successFetch('hello'));
      const result = await run(
        'http',
        field === 'url'
          ? {
              url: `https://user:${encodeURIComponent(secret)}@target.example/private?key=${encodeURIComponent(secret)}`,
            }
          : { headers: { authorization: `Bearer ${secret}` } },
      );
      expect(result.code).toBe(2);
      absent(result, [secret, encodeURIComponent(secret)]);
      expect(result.files).toHaveLength(0);
    },
  );

  it('keeps only the request host when an environment URL contains credentials', async () => {
    vi.stubEnv(
      'DRIFTBENCH_HTTP_URL',
      `https://user:${encodeURIComponent(secret)}@target.example/private-path?key=${encodeURIComponent(secret)}`,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'body-marker' }, { status: 400 })),
    );
    const result = await run('http', { url: undefined });
    expect(result.code).toBe(1);
    absent(result, [secret, encodeURIComponent(secret), 'private-path', 'body-marker']);
    expect(result.out).toContain('target.example answered 400');
  });

  it('suppresses a failed response stream instead of exposing its error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error('stream-detail-marker'));
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const result = await run('http');
    expect(result.code).toBe(1);
    absent(result, ['stream-detail-marker']);
  });

  it.each(adapters)('%s exposes an error body only through the unsafe opt-in', async (adapter) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'debug-body-marker' }, { status: 400 })),
    );
    const result = await run(adapter, { debug_error_body: true });
    expect(result.code).toBe(1);
    expect(result.out).toContain('debug-body-marker');
  });
});

describe('target reply redaction', () => {
  it.each(adapters.flatMap((adapter) => Object.keys(encodings).map((encoding) => [adapter, encoding])))(
    '%s redacts %s and its Bearer form before storage and caching',
    async (adapter, encoding) => {
      const encode = encodings[encoding as keyof typeof encodings];
      const content = `${encode(secret)} ${encode(`Bearer ${secret}`)}`;
      vi.stubGlobal('fetch', successFetch(content));
      const result = await run(adapter);
      expect(result.code).toBe(0);
      absent(result, [secret, encode(secret), encode(`Bearer ${secret}`)]);
      const store = openStore(result.store);
      try {
        const [record] = await store.listRuns({});
        expect(record?.blocks[0]?.observed.text).toBe('[redacted] [redacted]');
        expect((record?.blocks[0]?.observed.raw as { redactions?: number })?.redactions).toBeGreaterThan(0);
      } finally {
        await store.close();
      }
    },
  );

  it.each(
    adapters.flatMap((adapter) =>
      ['percent', 'base64', 'base64url', 'hex'].flatMap((outer) =>
        ['percent', 'base64', 'base64url', 'hex'].map((inner) => [adapter, outer, inner]),
      ),
    ),
  )('%s redacts %s(%s(key)) and the composed Bearer form', async (adapter, outer, inner) => {
    const encode = (value: string) =>
      encodings[outer as keyof typeof encodings](encodings[inner as keyof typeof encodings](value));
    vi.stubGlobal('fetch', successFetch(`${encode(secret)} ${encode(`Bearer ${secret}`)}`));
    const result = await run(adapter);
    expect(result.code).toBe(0);
    absent(result, [secret, encode(secret), encode(`Bearer ${secret}`)]);
    const store = openStore(result.store);
    try {
      const [record] = await store.listRuns({});
      expect(record?.blocks[0]?.observed.text).toBe('[redacted] [redacted]');
    } finally {
      await store.close();
    }
  });

  it('redacts tool payloads and strips credentials from echoed request metadata', async () => {
    const encoded = encodings.base64(secret);
    vi.stubGlobal(
      'fetch',
      successFetch(encoded, {
        request: {
          headers: { authorization: `Bearer ${secret}`, 'x-trace': 'header-marker' },
          url: `https://user:${encodeURIComponent(secret)}@target.example/path?token=${encoded}`,
        },
      }),
    );
    const result = await run('http');
    expect(result.code).toBe(0);
    absent(result, [secret, encoded, encodeURIComponent(secret), 'header-marker']);
  });
});
