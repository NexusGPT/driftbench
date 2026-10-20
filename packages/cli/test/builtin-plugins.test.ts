import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRegistry } from '@agent-nexus/driftbench-checks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS, type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ECHO = 'examples/plugins/plugin.mjs';

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

let dir: string;
let spec: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'builtin-plugins-'));
  spec = join(dir, 'essay.yaml');
  // The echo adapter repeats the request: a dozen words where the request asks for 800.
  await writeFile(
    spec,
    [
      'id: stated-length-essay',
      "version: '1'",
      'title: A reply far under the stated length',
      'channel: chat',
      'lang: EN',
      'target: { adapter: echo, agent: demo }',
      'rules: { custom: { stated_length: {} } }',
      'blocks:',
      '  - user: Write no less than 800 words on rivers.',
      '',
    ].join('\n'),
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('built-in plugins', () => {
  it('stated_length is not registered by default: a spec that names it gets the unregistered verdict', async () => {
    expect(defaultRegistry.get('stated_length')).toBeUndefined();
    const run = await cli(['campaign', 'run', spec, '--plugin', ECHO, '--json']);
    expect(run.out).toContain('rules.custom names stated_length, but no check of that name is registered');
  }, 120_000);

  it('--plugin driftbench:stated_length registers the check for the run only', async () => {
    const run = await cli([
      'campaign',
      'run',
      spec,
      '--plugin',
      ECHO,
      '--plugin',
      'driftbench:stated_length',
      '--json',
    ]);
    expect(run.err).toBe('');
    expect(run.code).toBe(1);
    expect(run.out).toContain('"id": "custom.stated_length.reply"');
    expect(run.out).not.toContain('no check of that name is registered');
    expect(defaultRegistry.get('stated_length')).toBeUndefined();
  }, 120_000);

  it('refuses an unknown built-in with exit 2 and the list of built-ins', async () => {
    const run = await cli(['--plugin', 'driftbench:nope', 'spec', 'validate', spec]);
    expect(run.code).toBe(2);
    expect(run.err).toBe(
      `driftbench: No built-in plugin driftbench:nope: the built-in plugins are ${Object.keys(BUILTIN_PLUGINS).join(', ')}\n`,
    );
  });
});
