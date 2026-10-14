import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { METHODS, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyQueue, enqueue, readQueue, writeQueue } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { startViewer, type Viewer } from '../src/view/server';

let dir = '';
let viewer: Viewer;
let labels = '';
let run = '';
let runId = '';
let sequence = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-view-security-'));
  const store = openStore(join(dir, 'store.db'));
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-test', modes: ['F'], repeats: 1 });
  } finally {
    await store.close();
  }
});
beforeEach(async () => {
  labels = join(dir, `labels-${sequence++}`);
  viewer = await startViewer({ store: join(dir, 'store.db'), labels, port: 0 });
  const campaign = await (await fetch(`${viewer.url}/campaign/c-test`)).text();
  for (const match of campaign.matchAll(/href="(\/campaign\/[^/]+\/run\/[^"#]+)"/g)) {
    const path = match[1] as string;
    const page = await (await fetch(`${viewer.url}${path}`)).text();
    if (page.includes('<option value="no_invented_data">')) {
      run = path;
      runId = page.match(/name="run" value="([^"]+)"/)?.[1] ?? '';
      break;
    }
  }
  expect(runId).not.toBe('');
  await writeQueue(
    labels,
    enqueue(emptyQueue(), [
      {
        id: `${runId}.b1`,
        criterion: 'no_invented_data',
        campaign: 'c-test',
        runId,
        index: 1,
      },
    ]),
  );
});
afterEach(async () => {
  await viewer.close();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function token(): Promise<string> {
  const html = await (await fetch(`${viewer.url}${run}`)).text();
  // A sentinel lets the pre-fix tests reach the unprotected POST routes.
  return html.match(/name="csrf" value="([^"]+)"/)?.[1] ?? 'missing-form-token';
}
function fields(csrf: string): URLSearchParams {
  return new URLSearchParams({
    csrf,
    campaign: 'c-test',
    run: runId,
    block: '1',
    criterion: 'no_invented_data',
    label: 'pass',
    id: `${runId}.b1`,
  });
}
async function post(path: string, body: URLSearchParams, headers: Record<string, string>) {
  return fetch(`${viewer.url}${path}`, { method: 'POST', redirect: 'manual', body, headers });
}

for (const path of ['/labels', '/queue/assign']) {
  describe(`request protection on ${path}`, () => {
    for (const header of ['origin', 'host']) {
      it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
        `rejects %s with foreign ${header} before writing, then accepts the same-origin POST`,
        async (method) => {
          const queueBefore = await readFile(join(labels, 'queue.json'), 'utf8');
          const body = fields(await token()).toString();
          const headers: Record<string, string> = {
            host: new URL(viewer.url).host,
            origin: viewer.url,
            'content-type': 'application/x-www-form-urlencoded',
            'content-length': String(Buffer.byteLength(body)),
          };
          headers[header] = header === 'origin' ? 'https://foreign.example' : 'foreign.example';
          // node:http preserves the explicit Host header for the DNS rebinding case.
          const status = await new Promise<number | undefined>((resolve, reject) => {
            const req = request(`${viewer.url}${path}`, { method, headers }, (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode));
            });
            req.on('error', reject);
            req.setTimeout(2000, () => req.destroy(new Error(`Timed out sending ${method}`)));
            req.end(body);
          });
          expect(status).toBe(403);
          expect(await readFile(join(labels, 'queue.json'), 'utf8')).toBe(queueBefore);
          expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(false);

          const accepted = await post(path, new URLSearchParams(body), { origin: viewer.url });
          expect(accepted.status).toBe(303);
          if (path === '/labels') expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(true);
          else expect((await readQueue(labels)).entries[0]?.state).toBe('assigned');
        },
      );
    }
    it.each(METHODS.filter((method) => method !== 'POST'))(
      'refuses runtime method %s with valid credentials and no write',
      async (method) => {
        const queueBefore = await readFile(join(labels, 'queue.json'), 'utf8');
        const body = fields(await token()).toString();
        const result = await new Promise<number | string>((resolve, reject) => {
          const req = request(
            `${viewer.url}${path}`,
            {
              method,
              headers: {
                host: new URL(viewer.url).host,
                origin: viewer.url,
                'content-type': 'application/x-www-form-urlencoded',
                'content-length': Buffer.byteLength(body),
              },
            },
            (res) => {
              res.resume();
              res.on('end', () => resolve(res.statusCode ?? 0));
            },
          );
          req.on('connect', (res, socket) => {
            socket.destroy();
            resolve(res.statusCode ?? 0);
          });
          req.on('error', (error: NodeJS.ErrnoException) => {
            if (method === 'CONNECT' && error.code === 'ECONNRESET') resolve(error.code);
            else reject(error);
          });
          req.setTimeout(2000, () => req.destroy(new Error(`Timed out sending ${method}`)));
          req.end(body);
        });
        if (method === 'CONNECT') expect(result).toBe('ECONNRESET');
        else {
          expect(result).toBeGreaterThanOrEqual(400);
          expect(result).toBeLessThan(600);
          expect(result).toBe(method === 'GET' ? 404 : 405);
        }
        expect(await readFile(join(labels, 'queue.json'), 'utf8')).toBe(queueBefore);
        expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(false);
      },
    );
    it.each(['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'])(
      'refuses %s with 405 and no write',
      async (method) => {
        const queueBefore = await readFile(join(labels, 'queue.json'), 'utf8');
        const response = await fetch(`${viewer.url}${path}`, {
          method,
          redirect: 'manual',
          headers: { origin: viewer.url },
          body: method === 'HEAD' ? undefined : fields(await token()),
        });
        expect(response.status).toBe(405);
        expect(await readFile(join(labels, 'queue.json'), 'utf8')).toBe(queueBefore);
        expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(false);
      },
    );
    for (const attack of [
      'foreign origin',
      'null origin',
      'foreign referer',
      'malformed referer',
      'no origin or referer',
      'missing token',
      'wrong token',
      'origin overrides referer',
    ]) {
      it(`rejects ${attack} with plain 403 and no write`, async () => {
        const before = await readQueue(labels);
        const body = fields(await token());
        const headers: Record<string, string> = { origin: viewer.url };
        if (attack === 'foreign origin') headers.origin = 'https://foreign.example';
        if (attack === 'null origin') headers.origin = 'null';
        if (attack.includes('referer') || attack === 'no origin or referer') {
          delete headers.origin;
          if (attack === 'foreign referer') headers.referer = 'https://foreign.example/page';
          if (attack === 'malformed referer') headers.referer = 'not a URL';
          if (attack === 'origin overrides referer') {
            headers.origin = 'https://foreign.example';
            headers.referer = `${viewer.url}${run}`;
          }
        }
        if (attack === 'missing token') body.delete('csrf');
        if (attack === 'wrong token') body.set('csrf', 'not-the-token');
        const response = await post(path, body, headers);
        expect(response.status).toBe(403);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toMatch(/^Forbidden:/);
        expect(await readQueue(labels)).toEqual(before);
        expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(false);
      });
    }
    it('accepts an ordinary form post with the viewer origin and its hidden token', async () => {
      expect((await post(path, fields(await token()), { origin: viewer.url })).status).toBe(303);
      if (path === '/labels') expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(true);
      else expect((await readQueue(labels)).entries[0]?.state).toBe('assigned');
    });
    it('accepts the viewer Referer when Origin is absent', async () => {
      expect((await post(path, fields(await token()), { referer: `${viewer.url}${run}` })).status).toBe(303);
    });
  });
}

it('serves GET pages with a foreign Origin without writing', async () => {
  const queueBefore = await readFile(join(labels, 'queue.json'), 'utf8');
  const response = await fetch(`${viewer.url}/queue`, { headers: { origin: 'https://foreign.example' } });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Review queue');
  expect(await readFile(join(labels, 'queue.json'), 'utf8')).toBe(queueBefore);
  expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(false);
});

it.each(['foreign.example', '127.0.0.1:1', 'localhost:1'])('rejects Host %s even on GET', async (host) => {
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${viewer.url}/`, { headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(403);
});

it('embeds the same token in every write form without requiring script', async () => {
  const csrf = await token();
  expect(csrf).toHaveLength(64);
  expect(csrf).toMatch(/^[a-f0-9]{64}$/);
  for (const path of [run, '/queue']) {
    const html = await (await fetch(`${viewer.url}${path}`)).text();
    const forms = [...html.matchAll(/<form method="post"[\s\S]*?<\/form>/g)];
    expect(forms.length).toBeGreaterThan(0);
    for (const [form] of forms) expect(form).toContain(`<input type="hidden" name="csrf" value="${csrf}">`);
  }
});

it.each(['/labels', '/queue/assign'])(
  'rejects a previous-start token on %s without writing',
  async (path) => {
    const old = await token();
    const queueBefore = await readFile(join(labels, 'queue.json'), 'utf8');
    await viewer.close();
    viewer = await startViewer({ store: join(dir, 'store.db'), labels, port: 0 });
    const fresh = await token();
    expect(fresh).toMatch(/^[a-f0-9]{64}$/);
    expect(fresh).not.toBe(old);
    expect((await post(path, fields(old), { origin: viewer.url })).status).toBe(403);
    expect(await readFile(join(labels, 'queue.json'), 'utf8')).toBe(queueBefore);
    expect(existsSync(join(labels, 'no_invented_data.yaml'))).toBe(false);
  },
);
