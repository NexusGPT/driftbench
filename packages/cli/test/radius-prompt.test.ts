import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { main } from '../src/index';

const root = fileURLToPath(new URL('../../..', import.meta.url));
let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function cli(args: string[]) {
  let out = '',
    err = '';
  const code = await main(args, {
    cwd: root,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
  });
  return { code, out, err };
}
it('maps the Acme offer quote, persists the anchor, and explains the selected blocks', async () => {
  dir = await mkdtemp(join(tmpdir(), 'acme-quotes-'));
  const old = join(root, 'examples/acme/src/policy.ts');
  const text = await readFile(old, 'utf8');
  const next = join(dir, 'new.ts');
  await writeFile(
    next,
    text.replace('for $${plan.monthly_usd} a month', 'for $${plan.monthly_usd + 1} a month'),
  );
  const manifest = join(dir, 'change.yaml');
  const made = await cli([
    'radius',
    'auto',
    '--prompt',
    old,
    next,
    '--map',
    'examples/acme/map/approved.yaml',
    '--from-version',
    'acme-v1',
    '--to-version',
    'acme-v2',
    '--out',
    manifest,
  ]);
  expect(made).toMatchObject({ code: 0, err: '' });
  const report = await cli([
    'radius',
    'examples/acme/gated/specs',
    '--change',
    manifest,
    '--mode',
    'T',
    '--explain',
  ]);
  expect(report.code, report.out.slice(0, 1500)).toBe(0);
  expect(report.out).toContain('141 of 861 blocks');
  expect(report.out).toContain('anchor relations[');
  expect(report.out).toContain('states@offer');
  await writeFile(next, `${text}\nAlways answer in French.\n`);
  expect(
    (
      await cli([
        'radius',
        'auto',
        '--prompt',
        old,
        next,
        '--map',
        'examples/acme/map/approved.yaml',
        '--out',
        manifest,
      ])
    ).code,
  ).toBe(0);
  const all = await cli(['radius', 'examples/acme/gated/specs', '--change', manifest, '--explain']);
  expect(all.code).toBe(1);
  expect(all.out).toContain('no quote matched');
});
