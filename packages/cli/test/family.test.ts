import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ACME_FAMILY = fileURLToPath(new URL('../../../examples/acme/families/price-sheet/', import.meta.url));

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (at: string, prefix: string) => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) await walk(full, `${prefix}${entry.name}/`);
      else out[`${prefix}${entry.name}`] = await readFile(full, 'utf8');
    }
  };
  await walk(dir, '');
  return out;
}

/** A copy of the Acme family in a temporary folder, which a test may change. */
async function acmeCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-family-cli-'));
  await cp(ACME_FAMILY, join(dir, 'price-sheet'), {
    recursive: true,
    filter: (source) => !source.includes('/instances'),
  });
  return join(dir, 'price-sheet');
}

describe('driftbench family instances', () => {
  it('writes N instances with their variants and the report, the same bytes for the same seed', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'driftbench-family-cli-'));
    const first = await run(
      ['family', 'instances', ACME_FAMILY, '--n', '3', '--seed', '5', '--out', 'out'],
      cwd,
    );
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(first.out).toMatch(/^Family acme-price-sheet: 3 instances, seed 5, \d+ specs\.\n/);
    expect(first.out).toMatch(
      /Style invariant: \d+ style alternatives rebuilt; none changed the expected outcome\./,
    );
    expect(first.out).toContain('Review: pending.');
    const written = await tree(join(cwd, 'out'));
    expect(Object.keys(written).filter((path) => path.endsWith('base.yaml'))).toEqual([
      'i01/base.yaml',
      'i02/base.yaml',
      'i03/base.yaml',
    ]);
    const report = JSON.parse(written['family-report.json'] ?? '{}') as {
      review: string;
      n: number;
      specs: number;
    };
    expect(report).toMatchObject({ review: 'pending', n: 3 });
    expect(Object.keys(written).filter((path) => path.endsWith('.yaml'))).toHaveLength(report.specs);

    const again = await run(
      ['family', 'instances', ACME_FAMILY, '--n', '3', '--seed', '5', '--out', 'out'],
      cwd,
    );
    expect(again.code).toBe(2);
    expect(again.err).toMatch(
      /holds the output of an earlier run \(family-report\.json, i01, i02, i03\)\. Pass --force/,
    );

    const forced = await run(
      ['family', 'instances', ACME_FAMILY, '--n', '3', '--seed', '5', '--out', 'out', '--force'],
      cwd,
    );
    expect(forced.code).toBe(0);
    expect(await tree(join(cwd, 'out'))).toEqual(written);
  });

  it('refuses bad numbers, an invalid family, an unapproved phrase, and a review that is missing or stale', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'driftbench-family-cli-'));
    const bad = await run(
      ['family', 'instances', ACME_FAMILY, '--n', '0', '--seed', '1', '--out', 'out'],
      cwd,
    );
    expect(bad).toMatchObject({ code: 2, err: '--n must be a whole number of at least 1, got "0".\n' });

    const family = await acmeCopy();
    const text = await readFile(join(family, 'family.yaml'), 'utf8');

    await writeFile(
      join(family, 'family.yaml'),
      text.replace('xlsx: [sheets, header,', 'xlsx: [slides, header,'),
    );
    const invalid = await run(
      ['family', 'instances', family, '--n', '1', '--seed', '1', '--out', 'out'],
      cwd,
    );
    expect(invalid.code).toBe(2);
    expect(invalid.err).toMatch(
      /is not a valid family:\n {2}checks\.xlsx {2}slides is not a check of the xlsx reader/,
    );

    await writeFile(
      join(family, 'family.yaml'),
      text.replace('- id: build.save.b\n    approved: true', '- id: build.save.b\n    approved: false'),
    );
    const unapproved = await run(
      ['family', 'instances', family, '--n', '1', '--seed', '1', '--out', 'out'],
      cwd,
    );
    expect(unapproved).toMatchObject({ code: 2 });
    expect(unapproved.err).toContain('uses phrases no person approved: build.save.b');

    await writeFile(join(family, 'family.yaml'), text);
    const review = await readFile(join(family, 'review.yaml'), 'utf8');
    await writeFile(
      join(family, 'review.yaml'),
      review
        .replace('signed_by: null', 'signed_by: A. Reviewer')
        .replace('signed_on: null', "signed_on: '2026-10-11'"),
    );
    const signed = await run(['family', 'review', family], cwd);
    expect(signed).toMatchObject({ code: 0, out: 'Review: signed by A. Reviewer on 2026-10-11.\n' });

    await writeFile(
      join(family, 'oracle.mjs'),
      `${await readFile(join(family, 'oracle.mjs'), 'utf8')}\n// changed\n`,
    );
    const stale = await run(['family', 'instances', family, '--n', '1', '--seed', '1', '--out', 'out'], cwd);
    expect(stale.code).toBe(2);
    expect(stale.err).toMatch(/was signed for another version: the oracle changed since/);

    await writeFile(join(family, 'review.yaml'), '');
    const missing = await run(
      ['family', 'instances', family, '--n', '1', '--seed', '1', '--out', 'out'],
      cwd,
    );
    expect(missing.code).toBe(2);
    expect(missing.err).toMatch(/is invalid/);
    expect(await readdir(cwd)).toEqual([]);
  });

  it('writes nothing and exits 1 when a style knob changes what the oracle expects', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'driftbench-family-cli-'));
    const family = await acmeCopy();
    const oracle = await readFile(join(family, 'oracle.mjs'), 'utf8');
    // A defect: the oracle reads the wording, a style knob, into the expected outcome.
    await writeFile(
      join(family, 'oracle.mjs'),
      oracle.replace(
        'must: [named],\n    };\n  }\n  if',
        "must: [knobs.wording === 'a' ? named : 'price'],\n    };\n  }\n  if",
      ),
    );
    const result = await run(['family', 'instances', family, '--n', '2', '--seed', '1', '--out', 'out'], cwd);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(
      /A style knob changes the expected outcome[^\n]*nothing is written:\n {2}i01 base: wording = [bc]: the block build expects another must/,
    );
    expect(await readdir(cwd)).toEqual([]);
  });
});

describe('driftbench family review', () => {
  it('says pending for the Acme family, and writes a pending review for a family with none', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'driftbench-family-cli-'));
    const acme = await run(['family', 'review', ACME_FAMILY], cwd);
    expect(acme.code).toBe(1);
    expect(acme.out).toMatch(/^Review: pending\. .*review\.yaml is not signed yet/);

    const family = await acmeCopy();
    await writeFile(join(family, 'review.yaml'), 'family: acme-price-sheet\n');
    expect((await run(['family', 'review', family], cwd)).code).toBe(2);
    const written = await run(['family', 'review', family, '--write'], cwd);
    expect(written.code).toBe(1);
    const review = await readFile(join(family, 'review.yaml'), 'utf8');
    expect(review).toMatch(/^# The review of a code-agent task family\./);
    expect(review).toMatch(/\nsigned_by: null\nsigned_on: null\n$/);
  });
});
