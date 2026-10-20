import { describe, expect, it } from 'vitest';
import {
  buildLabelling,
  Cassette,
  LabelerConfigError,
  type LabelSet,
  parseLabelerSpec,
  pointerScan,
} from '../../src/pointer';

// The key of the anthropic labeler is read when a request leaves, never when the labelling is built.
const SET: LabelSet = {
  set: 'rules',
  description: 'Rules',
  labels: [{ name: 'rule', description: 'A rule' }],
};
const SPEC = (() => {
  const parsed = parseLabelerSpec('system2:anthropic');
  if (!parsed.ok) throw new Error(parsed.message);
  return [parsed.spec];
})();

function envWith(reads: { count: number }, value: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  Object.defineProperty(env, 'ANTHROPIC_API_KEY', {
    enumerable: true,
    get() {
      reads.count += 1;
      return value;
    },
  });
  return env;
}

const answer = () =>
  new Response(
    JSON.stringify({
      content: [{ type: 'text', text: '{"labels":[{"units":"1","label":"none"}]}' }],
      model: 'm',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

describe('the key of a recording run is read when a request leaves', () => {
  it('is not read when the labelling is built', async () => {
    const reads = { count: 0 };
    const built = await buildLabelling(SPEC, { env: envWith(reads, 'secret'), record: true, cwd: '.' });
    expect(built.ok).toBe(true);
    expect(reads.count).toBe(0);
  });

  it('is not read by a scan that sends nothing: a file whose only units are opaque', async () => {
    const reads = { count: 0 };
    const sent: string[] = [];
    const built = await buildLabelling(SPEC, {
      env: envWith(reads, 'secret'),
      record: true,
      cwd: '.',
      fetch: async (_url, init) => {
        sent.push(String(init.body));
        return answer();
      },
    });
    if (!built.ok) throw new Error(built.message);
    await pointerScan({
      files: [{ path: 'only.md', text: '```js\nx\n```\n' }],
      sets: [SET],
      labelling: built.labelling,
      cassette: new Cassette(),
      mode: 'record',
    });
    expect(sent).toEqual([]);
    expect(reads.count).toBe(0);
  });

  it('is read by a scan that sends, and goes out in the request header', async () => {
    const reads = { count: 0 };
    const headers: Array<Record<string, string>> = [];
    const built = await buildLabelling(SPEC, {
      env: envWith(reads, 'secret'),
      record: true,
      cwd: '.',
      fetch: async (_url, init) => {
        headers.push(init.headers as Record<string, string>);
        return answer();
      },
    });
    if (!built.ok) throw new Error(built.message);
    await pointerScan({
      files: [{ path: 'one.md', text: 'Hang the lamp before dusk.\n' }],
      sets: [SET],
      labelling: built.labelling,
      cassette: new Cassette(),
      mode: 'record',
    });
    // Three runs of one window leave three requests; the key is read once, before the first of them.
    expect(headers.length).toBeGreaterThan(1);
    expect(reads.count).toBe(1);
    expect(headers[0]?.['x-api-key']).toBe('secret');
  });

  it('still fails at build, with the same message, when a record run has no key as a plain value', async () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: undefined }, { ANTHROPIC_API_KEY: '  ' }]) {
      const built = await buildLabelling(SPEC, { env, record: true, cwd: '.' });
      expect(built).toEqual({
        ok: false,
        message: '--record needs ANTHROPIC_API_KEY in the environment for the system2 labeler anthropic',
      });
    }
  });

  it('fails before a request leaves, with the same message, when a key behind a getter is empty', async () => {
    const reads = { count: 0 };
    const sent: string[] = [];
    const built = await buildLabelling(SPEC, {
      env: envWith(reads, ''),
      record: true,
      cwd: '.',
      fetch: async (_url, init) => {
        sent.push(String(init.body));
        return answer();
      },
    });
    if (!built.ok) throw new Error(built.message);
    await expect(
      pointerScan({
        files: [{ path: 'one.md', text: 'Hang the lamp before dusk.\n' }],
        sets: [SET],
        labelling: built.labelling,
        cassette: new Cassette(),
        mode: 'record',
      }),
    ).rejects.toThrow(
      new LabelerConfigError(
        '--record needs ANTHROPIC_API_KEY in the environment for the system2 labeler anthropic',
      ),
    );
    expect(sent).toEqual([]);
  });
});
