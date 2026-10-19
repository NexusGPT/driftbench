import { cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../../../tools/test-setup/temp-folders';
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

/**
 * A copy of the Acme family in a temporary folder, which a test may change. The copy's review is pending:
 * the committed one is signed for the committed family and oracle, and nobody reviewed what a test changes.
 */
async function acmeCopy(): Promise<string> {
  const dir = await tempFolder('driftbench-family-cli-');
  await cp(ACME_FAMILY, join(dir, 'price-sheet'), {
    recursive: true,
    filter: (source) => !source.includes('/instances'),
  });
  const review = join(dir, 'price-sheet', 'review.yaml');
  const signed = await readFile(review, 'utf8');
  const pending = signed.replace(/signed_by: .*\nsigned_on: .*\n$/, 'signed_by: null\nsigned_on: null\n');
  if (pending === signed) throw new Error('the committed Acme review has no signature lines to clear');
  await writeFile(review, pending);
  return join(dir, 'price-sheet');
}

describe('driftbench family instances', () => {
  it('writes N instances with their variants and the report, the same bytes for the same seed', async () => {
    const cwd = await tempFolder('driftbench-family-cli-');
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
    expect(first.out).toContain('Review: signed by owner on 2026-10-13.');
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
    expect(report).toMatchObject({ review: 'signed', n: 3 });
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
    const cwd = await tempFolder('driftbench-family-cli-');
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
    const cwd = await tempFolder('driftbench-family-cli-');
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
      /A style knob changes the expected outcome[^\n]*nothing is written:\n {2}i01 base: wording = [abc]: the block build expects another must/,
    );
    expect(await readdir(cwd)).toEqual([]);
  });
});

describe('the committed Acme instances', () => {
  it('are the ones driftbench family instances writes today, with seed 1 and n 20', async () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const out = await tempFolder('driftbench-family-cli-');
    const result = await run(
      ['family', 'instances', 'examples/acme/families/price-sheet', '--n', '20', '--seed', '1', '--out', out],
      repo,
    );
    expect(result.code).toBe(0);
    const committed = await tree(join(ACME_FAMILY, 'instances'));
    delete committed['verify-report.json'];
    // A spec whose workspace holds a workbook names its seed folder relative to itself, so the output folder
    // never shows in the files.
    expect(await tree(out)).toEqual(committed);
  }, 60_000);
});

describe('driftbench family review', () => {
  it('says signed for the Acme family, pending for an unsigned one, and writes a pending review for a family with none', async () => {
    const cwd = await tempFolder('driftbench-family-cli-');
    const acme = await run(['family', 'review', ACME_FAMILY], cwd);
    expect(acme.code).toBe(0);
    expect(acme.out).toBe('Review: signed by owner on 2026-10-13.\n');

    // The same family with the signature taken out is pending, and exits 1.
    const pending = await run(['family', 'review', await acmeCopy()], cwd);
    expect(pending.code).toBe(1);
    expect(pending.out).toMatch(/^Review: pending\. .*review\.yaml is not signed yet/);

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

describe('driftbench family verify', () => {
  it('ships every instance of both seed formats the reference passes, and rejects one whose expectation is wrong', async () => {
    const cwd = await tempFolder('driftbench-family-cli-');
    // Built from the copy, whose review is pending: verify then says release waits for the signature.
    const built = await run(
      ['family', 'instances', await acmeCopy(), '--n', '3', '--seed', '8', '--out', 'out'],
      cwd,
    );
    expect(built.code).toBe(0);
    const report = JSON.parse(await readFile(join(cwd, 'out', 'family-report.json'), 'utf8')) as {
      instances: Array<{ name: string; knobs: { seed_format: string } }>;
    };
    const formats = new Set(report.instances.map((entry) => entry.knobs.seed_format));
    expect(formats).toEqual(new Set(['csv', 'json']));
    const names = report.instances.map((entry) => entry.name);

    const passed = await run(['family', 'verify', 'out', '--reference', 'process:acme-ops'], cwd);
    expect(passed.err).toBe('');
    expect(passed.code).toBe(0);
    expect(passed.out).toMatch(/^Verify out on the reference process:acme-ops: \d+ specs\.\n/);
    expect(passed.out).toMatch(/✓ The reference passes all \d+ specs: 3 instances may ship\./);
    expect(passed.out).toContain('Release also waits for a person to sign the review of acme-price-sheet');
    expect(JSON.parse(await readFile(join(cwd, 'out', 'verify-report.json'), 'utf8'))).toMatchObject({
      shipped: names,
      rejected: [],
    });

    // An oracle defect, planted by hand: one expected monthly price of the first instance is wrong.
    const file = join(cwd, 'out', 'i01', 'base.yaml');
    const text = await readFile(file, 'utf8');
    const planted = text.replace(/(column: C\n\s+from_row: 2\n\s+values:\n\s+- )(\d+)\n/, '$1999\n');
    expect(planted).not.toBe(text);
    await writeFile(file, planted);
    const failed = await run(['family', 'verify', 'out', '--reference', 'process:acme-ops'], cwd);
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(
      / {2}✗ i01\/base\.yaml {2}fail\n {6}block 0 \(build\) artifacts\.[^\n]*C2 is \d+, expected 999/,
    );
    expect(failed.out).toContain(
      'Each is an oracle or a reference defect: one of the two is wrong about the task. These instances are not shipped: i01.',
    );
    expect(failed.out).toContain('2 instances pass every variant: i02, i03.');
    expect(JSON.parse(await readFile(join(cwd, 'out', 'verify-report.json'), 'utf8'))).toMatchObject({
      shipped: ['i02', 'i03'],
      rejected: ['i01'],
    });
  }, 120_000);

  it('exits 0 when the reference passes every spec of a CSV-only family', async () => {
    const cwd = await tempFolder('driftbench-family-cli-');
    const family = await acmeCopy();
    const text = await readFile(join(family, 'family.yaml'), 'utf8');
    await writeFile(
      join(family, 'family.yaml'),
      text
        .replace('values: [csv, json]', 'values: [csv]')
        .replace(/ {2}- id: json-has-no-line-endings-knob\n.*\n/, '')
        .replace(/ {2}- path: catalog\.json\n[\s\S]*?(?= {2}- path: '\{readme_name\}')/, ''),
    );
    const built = await run(['family', 'instances', family, '--n', '2', '--seed', '3', '--out', 'out'], cwd);
    expect(built.err).toBe('');
    expect(built.code).toBe(0);
    const result = await run(['family', 'verify', 'out', '--reference', 'process:acme-ops', '--json'], cwd);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out) as {
      specs: number;
      passed: number;
      shipped: string[];
      rejected: string[];
    };
    expect(report.passed).toBe(report.specs);
    expect(report).toMatchObject({ shipped: ['i01', 'i02'], rejected: [] });
  }, 120_000);

  it('exits 2 with no adapter for the reference, a bad number, or no spec under the folder', async () => {
    const cwd = await tempFolder('driftbench-family-cli-');
    const none = await run(['family', 'verify', '.', '--reference', 'process:nobody'], cwd);
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/^No adapter is set up for process:nobody\./);
    const bad = await run(
      ['family', 'verify', '.', '--reference', 'process:acme-ops', '--concurrency', '0'],
      cwd,
    );
    expect(bad).toMatchObject({
      code: 2,
      err: '--concurrency must be a whole number of at least 1, got "0".\n',
    });
    const empty = await run(['family', 'verify', '.', '--reference', 'process:acme-ops'], cwd);
    expect(empty.code).toBe(2);
    expect(empty.err).toMatch(/^No spec found under \./);
  });
});
