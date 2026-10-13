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
describe('published CLI', () => {
  it('keeps repository benchmark commands out of the published CLI', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).not.toMatch(/^\s+bench\b/m);
  });
});
