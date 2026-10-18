import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
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
  await writeFile(next, text.replace('plan.monthly_usd}', 'plan.monthly_usd + 1}'));
  const manifest = join(dir, 'change.yaml');
  const fullMap = 'examples/acme/map/approved.yaml';
  const approved = parse(await readFile(join(root, fullMap), 'utf8'));
  const quoteMap = join(dir, 'quotes.json');
  await writeFile(
    quoteMap,
    JSON.stringify({
      ...approved,
      dimensions: [],
      constraints: [],
      phrases: [],
      relations: [
        approved.relations.find(
          (relation: { kind: string; to?: string }) => relation.kind === 'states' && relation.to === 'offer',
        ),
      ],
    }),
  );
  const made = await cli([
    'radius',
    'auto',
    '--prompt',
    old,
    next,
    '--map',
    quoteMap,
    '--source',
    '../src/policy.ts',
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
        quoteMap,
        '--source',
        '../src/policy.ts',
        '--out',
        manifest,
      ])
    ).code,
  ).toBe(0);
  expect(parse(await readFile(manifest, 'utf8')).changes).toEqual([
    expect.objectContaining({ kind: 'prompt', global: true }),
  ]);
  const all = await cli(['radius', 'examples/acme/gated/specs', '--change', manifest, '--explain']);
  expect(all.code).toBe(1);
  expect(all.out).toContain('region');
  expect(all.out).toContain('whole suite');
  // The full Acme map contains overlapping and repeated evidence: it must conservatively select all.
  await cli(['radius', 'auto', '--prompt', old, next, '--map', fullMap, '--out', manifest]);
  const ambiguous = await cli(['radius', 'examples/acme/gated/specs', '--change', manifest, '--explain']);
  expect(ambiguous.code).toBe(1);
  expect(ambiguous.out).toMatch(/ambiguous|overlapping/);
}, 50_000);

it.each([
  ['schema', 'id: invalid\ndimensions: wrong\n', 'dimensions'],
  ['syntax', 'dimensions: [', 'sequence'],
])('refuses an invalid %s map with exit 2 and leaves the output untouched', async (_kind, text, detail) => {
  dir = await mkdtemp(join(tmpdir(), 'radius-invalid-map-'));
  const map = join(dir, 'invalid.yaml');
  const output = join(dir, 'change.yaml');
  await writeFile(map, text);
  await writeFile(output, 'existing manifest\n');
  const result = await cli([
    'radius',
    'auto',
    '--prompt',
    'old.txt',
    'new.txt',
    '--map',
    map,
    '--out',
    output,
  ]);
  expect(result.code).toBe(2);
  expect(result.out).toBe('');
  expect(result.err).toContain(map);
  expect(result.err).toContain(detail);
  expect(result.err).not.toMatch(/ZodError|\n\s+at /);
  expect(await readFile(output, 'utf8')).toBe('existing manifest\n');
});
