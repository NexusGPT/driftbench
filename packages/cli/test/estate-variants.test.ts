import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  atomsOf,
  cli,
  copyTo,
  countByKind,
  findingCounts,
  listedLines,
  type Rendered,
  render,
  type Variant,
} from './support/estate-variants';

/**
 * The map-location and output-size fixes as general rules, tested on invented estates by metamorphic changes
 * and over a range of sizes. Every expectation is stated over roles (capabilities, policies, strays) and over
 * what a report states, never over a file name:
 *
 *   R4 a map and its estate keep their relation when moved together; a map moved alone is refused with a fix
 *   R5 a long report states the true total of every code and lists a bounded part, unless asked for all
 */

const ROLES = { capabilities: 2, policies: 2, strays: 3 };
const SEED = 7;

type Run = {
  scan: { code: number; out: string; err: string };
  lint?: { code: number; out: string; err: string };
  rendered: Rendered;
};

/** Renders a variant, scans it, and lints the map. */
async function scanVariant(variant: Variant, options: { verbose?: boolean } = {}): Promise<Run> {
  const rendered = await render(variant);
  const scan = await cli(
    ['estate', 'scan', rendered.root, '--no-model', '--out', join(rendered.top, 'map.yaml')],
    rendered.top,
  );
  const lintArgs = ['estate', 'lint', 'map.yaml'];
  if (options.verbose !== false) lintArgs.push('--verbose');
  const lint = await cli(lintArgs, rendered.top);
  return { scan, lint, rendered };
}

describe('metamorphic: moving the root does not alter the findings', () => {
  const variant: Variant = { layout: 'project', settings: 'stored', roles: ROLES, seed: SEED };

  async function profile(rendered: Rendered, root = rendered.root, cwd = rendered.top, name = 'map.yaml') {
    const scan = await cli(['estate', 'scan', root, '--no-model', '--out', join(cwd, name)], cwd);
    const lint = await cli(['estate', 'lint', name, '--verbose'], cwd);
    const atoms = await atomsOf(join(cwd, name));
    return { scan, lint, kinds: countByKind(atoms), counts: findingCounts(lint.out) };
  }

  it('moving the root: a relative path, an absolute path from another folder, and a copy deeper down agree', async () => {
    const rendered = await render(variant);
    const elsewhere = join(rendered.top, 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
    const absolute = await profile(rendered, rendered.root, elsewhere, 'abs.yaml');
    const deeper = join(rendered.top, 'a', 'b', 'copy');
    await copyTo(rendered.root, deeper);
    const copied = await profile(rendered, deeper, join(rendered.top, 'a', 'b'), 'copy.yaml');
    const here = await cli(
      ['estate', 'scan', '.', '--no-model', '--out', join(rendered.top, 'rel.yaml')],
      rendered.root,
    );
    expect(here.code).toBe(0);
    const relative = countByKind(await atomsOf(join(rendered.top, 'rel.yaml')));
    expect(absolute.kinds).toEqual(copied.kinds);
    expect(absolute.kinds).toEqual(relative);
    expect(absolute.counts).toEqual(copied.counts);
  });
});

describe('R4: a map and its estate', () => {
  const variant: Variant = { layout: 'project', settings: 'stored', roles: ROLES, seed: SEED };

  it('moved together they agree; the map alone is refused with a fix naming the folder and the recorded root', async () => {
    const rendered = await render(variant);
    await cli(
      ['estate', 'scan', rendered.root, '--no-model', '--out', join(rendered.top, 'out', 'map.yaml')],
      rendered.top,
    );
    const home = await cli(['estate', 'lint', 'out/map.yaml', '--verbose'], rendered.top);
    // Together: the map and the estate move under another folder, keeping their relation.
    const moved = join(rendered.top, 'moved');
    await mkdir(moved, { recursive: true });
    await copyTo(join(rendered.top, 'out'), join(moved, 'out'));
    await copyTo(rendered.root, join(moved, rendered.root.slice(rendered.top.length + 1)));
    const together = await cli(['estate', 'lint', 'out/map.yaml', '--verbose'], moved);
    expect(findingCounts(together.out)).toEqual(findingCounts(home.out));
    // The map alone: somewhere its recorded root names nothing.
    const alone = join(rendered.top, 'lonely');
    await copyTo(join(rendered.top, 'out'), join(alone, 'out'));
    const refused = await cli(['estate', 'lint', 'out/map.yaml'], alone);
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/Cannot find the estate folder/);
    expect(refused.err).toMatch(/Fix: /);
    expect(refused.err).toContain('../');
  });

  it('a recorded root that is absolute or relative resolves to the same estate', async () => {
    const rendered = await render(variant);
    const out = join(rendered.top, 'maps', 'map.yaml');
    await cli(['estate', 'scan', rendered.root, '--no-model', '--out', out], rendered.top);
    const relative = findingCounts(
      (await cli(['estate', 'lint', 'maps/map.yaml', '--verbose'], rendered.top)).out,
    );
    const text = await readFile(out, 'utf8');
    await writeFile(out, text.replace(/^root: .*$/m, `root: ${rendered.root}`));
    const absolute = findingCounts(
      (await cli(['estate', 'lint', 'maps/map.yaml', '--verbose'], rendered.top)).out,
    );
    expect(absolute).toEqual(relative);
  });
});

describe('R5: a long report states the true total and lists a bounded part', () => {
  for (const strays of [0, 1, 12, 60, 300]) {
    it(`${strays} unnamed parts`, async () => {
      const variant: Variant = {
        layout: 'project',
        settings: 'stored',
        roles: { capabilities: 1, policies: 1, strays },
        seed: SEED + strays,
      };
      const run = await scanVariant(variant, { verbose: false });
      const everything = await cli(['estate', 'lint', 'map.yaml', '--verbose'], run.rendered.top);
      // The true total is stated, whatever is listed.
      expect(findingCounts(run.lint?.out ?? '').ORPHAN ?? 0).toBe(strays);
      expect(listedLines(everything.out, 'ORPHAN')).toBe(strays);
      if (strays >= 60) {
        expect(listedLines(run.lint?.out ?? '', 'ORPHAN')).toBeLessThan(strays / 2);
        expect((run.lint?.out ?? '').split('\n').length).toBeLessThan(60);
        // What is listed is the start of the full list, in the same order.
        const listed = (run.lint?.out ?? '')
          .split('\n')
          .filter((line) => /^ {2}ORPHAN {2}\S/.test(line) && !line.includes('...'));
        const full = everything.out.split('\n').filter((line) => /^ {2}ORPHAN {2}\S/.test(line));
        expect(full.slice(0, listed.length)).toEqual(listed);
        // The scan report is bounded too.
        expect(run.scan.out.split('\n').length).toBeLessThan(80);
      }
    });
  }
});
