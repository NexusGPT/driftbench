import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
async function run(args: string[]) {
  let out = '';
  let err = '';
  const code = await main(args, {
    cwd,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}
describe('bench CLI', () => {
  it('lists replay and record commands', async () => {
    const r = await run(['bench', '--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('replay');
    expect(r.out).toContain('record');
    expect(r.out).toContain('floors');
  });
  it('refuses an unknown slice before recording', async () => {
    const r = await run([
      'bench',
      'record',
      '--slice',
      'absent',
      '--model',
      'haiku',
      '--spend-cap-usd',
      '0.1',
    ]);
    expect(r.code).toBe(2);
    expect(r.err).toContain('Unknown slice');
  });
  it('requires explicit spend authorization for Gemini too', async () => {
    const r = await run(['bench', 'record', '--model', 'gemini-3.8-flash']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--spend-cap-usd');
  });
  it('requires explicit spend authorization before a record', async () => {
    const r = await run(['bench', 'record', '--slice', 'all', '--model', 'haiku']);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--spend-cap-usd');
  });
});
