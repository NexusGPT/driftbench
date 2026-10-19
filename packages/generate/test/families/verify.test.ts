import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { loadSpecFile } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { beforeAll, describe, expect, it } from 'vitest';
import { tempFolder } from '../../../../tools/test-setup/temp-folders';
import { acmeAdapter } from '../../../core/test/runner/support';
import {
  type BuildOptions,
  buildInstances,
  familyReport,
  type Instance,
  writeInstances,
} from '../../src/families/instances';
import { type VerifyDeps, verifyInstances, verifySpec, withoutSandbox } from '../../src/families/verify';
import { ACME_FAMILY, load } from './support';

const AGENT = fileURLToPath(new URL('../../../../examples/acme/ops/agent.mjs', import.meta.url));

/** The reference build of the Acme family: the deterministic ops agent behind the process adapter. */
function reference(cwd: string): VerifyDeps {
  return {
    adapter: processAdapter({
      command: process.execPath,
      args: [AGENT],
      provider: localProvider({}),
      deterministic: true,
    }),
    target: { adapter: 'process', agent: 'acme-ops' },
    checks: defaultChecks(),
    artifacts: defaultReaders(),
    cwd,
    concurrency: 4,
  };
}

/** Writes the given instances of the Acme family to a fresh folder. */
async function written(instances: Instance[], build: BuildOptions): Promise<string> {
  const loaded = await load(ACME_FAMILY);
  const dir = await tempFolder('driftbench-verify-');
  await writeInstances(dir, loaded, instances, familyReport(loaded, instances, build), {
    force: false,
    header: 'Test.',
  });
  return dir;
}

describe('verify on the reference build (process:acme-ops)', () => {
  let csv: Instance[] = [];
  let json: Instance | undefined;
  const build: BuildOptions = { n: 12, seed: 11, review: 'pending', seedFrom: (i, v) => `${i}/.seed-${v}` };

  beforeAll(async () => {
    const all = await buildInstances(await load(ACME_FAMILY), build);
    csv = all.filter((instance) => instance.knobs.seed_format === 'csv').slice(0, 2);
    json = all.find((instance) => instance.knobs.seed_format === 'json');
    if (csv.length < 2 || !json) throw new Error('seed 11 draws fewer than two CSV instances or no JSON one');
  });

  it('passes every variant of the CSV instances through the real runner and the machine checks', async () => {
    const dir = await written(csv, build);
    const report = await verifyInstances(dir, reference(dir));
    const failing = report.results.filter((result) => result.state !== 'pass');
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
    expect(report.specs).toBe(csv.reduce((sum, instance) => sum + instance.variants.length, 0));
    expect(report.shipped).toEqual(csv.map((instance) => instance.name));
    expect(report.rejected).toEqual([]);
  }, 120_000);

  it('rejects an instance whose expectation is wrong, names the check, and ships the others', async () => {
    const dir = await written(csv, build);
    const [first] = csv;
    if (!first) throw new Error('no instance');
    const file = join(dir, first.name, 'base.yaml');
    const text = await readFile(file, 'utf8');
    // An oracle defect, planted by hand: one expected allowance is wrong.
    const planted = text.replace(
      /(column: B\n\s+from_row: 2\n\s+values:\n\s+- )(.*)\n/,
      '$1Wrong allowance\n',
    );
    expect(planted).not.toBe(text);
    await writeFile(file, planted);
    const report = await verifyInstances(dir, reference(dir));
    expect(report.rejected).toEqual([first.name]);
    expect(report.shipped).toEqual(csv.slice(1).map((instance) => instance.name));
    const failed = report.results.find((result) => result.file === `${first.name}/base.yaml`);
    expect(failed?.state).toBe('fail');
    expect(failed?.failing.map((entry) => entry.check)).toContain('artifacts');
    expect(failed?.failing.find((entry) => entry.check === 'artifacts')?.evidence).toMatch(
      /B2 is .*, expected "Wrong allowance"/,
    );
  }, 120_000);

  it('passes every variant of a JSON instance: the reference reads catalog.json when there is no catalog.csv', async () => {
    if (!json) throw new Error('no JSON instance');
    const dir = await written([json], build);
    const report = await verifyInstances(dir, reference(dir));
    const failing = report.results.filter((result) => result.state !== 'pass');
    expect(failing, JSON.stringify(failing, null, 2)).toEqual([]);
    expect(report.specs).toBe(json.variants.length);
    expect(report).toMatchObject({ shipped: [json.name], rejected: [] });
  }, 120_000);

  it('reports a spec that does not load as invalid, never as a pass', async () => {
    const dir = await written(csv.slice(0, 1), build);
    await writeFile(join(dir, csv[0]?.name ?? '', 'broken.yaml'), 'id: broken\nkind: task\n');
    const report = await verifyInstances(dir, reference(dir));
    const broken = report.results.find((result) => result.file.endsWith('broken.yaml'));
    expect(broken?.state).toBe('invalid');
    expect(report.rejected).toContain(`${csv[0]?.name}/broken.yaml`);
  }, 120_000);
});

describe('the verify report', () => {
  it('writes the sandbox folder of a run as <sandbox>, so the report holds no machine path and no run id', () => {
    const real = realpathSync(tmpdir());
    expect(withoutSandbox(`ENOENT: realpath '${real}/driftbench-aocR4M/out/a.xlsx'`)).toBe(
      "ENOENT: realpath '<sandbox>/out/a.xlsx'",
    );
    expect(withoutSandbox(`${tmpdir()}/driftbench-sandboxes-1/driftbench-x1Y2/out/a.xlsx`)).toBe(
      '<sandbox>/out/a.xlsx',
    );
    expect(withoutSandbox('out/acme-price-sheet.xlsx was not created')).toBe(
      'out/acme-price-sheet.xlsx was not created',
    );
  });
});

describe('verify on a reference that cannot run the spec', () => {
  it('gives the spec the state not_run and lists each block not run with its reason', async () => {
    const file = fileURLToPath(
      new URL('../../../../examples/acme/specs/conversations/tool-failure.yaml', import.meta.url),
    );
    const loaded = await loadSpecFile(file);
    if (!loaded.ok) throw new Error('the spec does not load');
    const verdict = await verifySpec(file, loaded.spec, {
      adapter: acmeAdapter({ capabilities: { toolStubs: false } }),
      target: { adapter: 'function', agent: 'acme-sales' },
      checks: defaultChecks(),
      artifacts: defaultReaders(),
      cwd: tmpdir(),
    });
    expect(verdict.state).toBe('not_run');
    expect(verdict.failing[0]).toMatchObject({ block: 0, check: 'not_run' });
    expect(verdict.failing[0]?.evidence).toContain('toolStubs false');
  });

  it('the report leaves an instance the reference cannot run unverified: neither shipped nor rejected', async () => {
    const dir = await tempFolder('driftbench-verify-not-run-');
    const source = fileURLToPath(
      new URL('../../../../examples/acme/specs/conversations/tool-failure.yaml', import.meta.url),
    );
    await writeFile(join(dir, 'tool-failure.yaml'), await readFile(source, 'utf8'));
    const report = await verifyInstances(dir, {
      adapter: acmeAdapter({ capabilities: { toolStubs: false } }),
      target: { adapter: 'function', agent: 'acme-sales' },
      checks: defaultChecks(),
      artifacts: defaultReaders(),
      cwd: dir,
    });
    expect({ shipped: report.shipped, rejected: report.rejected, unverified: report.unverified }).toEqual({
      shipped: [],
      rejected: [],
      unverified: ['tool-failure.yaml'],
    });
  });
});
