import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSpecFile, type Spec } from '@driftbench/core';
import { cli, REPO } from './bench';

/**
 * The generated suite of the Northwind fixture (examples/estates/fixture, fictional, written by hand), made
 * by the component as it is checked out: the committed plan approved whole, then `estate generate`. Built
 * once per process. The kill, generation-quality and maintenance families read it.
 */

export const FIXTURE = join(REPO, 'examples/estates/fixture');
export const FAKE = join(FIXTURE, 'live/fake/claude.mjs');

export type SuiteSpec = {
  path: string;
  id: string;
  atoms: string[];
  testType: string;
  mode: string;
  complete: boolean;
  spec: Spec;
};

export type FixtureSuite = {
  work: string;
  map: string;
  specs: SuiteSpec[];
  report: { gaps?: Array<{ marker: string; specs: number; atoms: string[] }> };
};

let built: Promise<FixtureSuite> | undefined;

export function fixtureSuite(): Promise<FixtureSuite> {
  built ??= build();
  return built;
}

async function build(): Promise<FixtureSuite> {
  const work = await mkdtemp(join(tmpdir(), 'estate-fixture-suite-'));
  for (const name of ['approved.yaml', 'plan.yaml', 'phrases.yaml'])
    await cp(join(FIXTURE, name), join(work, name));
  const approve = cli(['estate', 'plan', 'approve', join(work, 'plan.yaml'), '--all']);
  if (approve.code !== 0)
    throw new Error(`plan approve exited ${approve.code}: ${approve.out.slice(0, 200)}`);
  const out = join(work, 'suite');
  // Exit 1 means some specs are incomplete: the suite is written all the same.
  const generated = cli([
    'estate',
    'generate',
    '--map',
    join(work, 'approved.yaml'),
    '--plan',
    join(work, 'plan.yaml'),
    '--out',
    out,
  ]);
  if (generated.code > 1)
    throw new Error(`generate exited ${generated.code}: ${generated.out.slice(0, 200)}`);
  const specs: SuiteSpec[] = [];
  for (const [folder, complete] of [
    ['specs', true],
    ['incomplete', false],
  ] as const) {
    for (const path of await yamlFiles(join(out, folder))) {
      const loaded = await loadSpecFile(path);
      if (!loaded.ok) continue;
      const estate = (loaded.spec.metadata?.estate ?? {}) as {
        atoms?: string[];
        testType?: string;
        mode?: string;
      };
      specs.push({
        path,
        id: loaded.spec.id,
        atoms: estate.atoms ?? [],
        testType: estate.testType ?? '',
        mode: estate.mode ?? '',
        complete,
        spec: loaded.spec,
      });
    }
  }
  // Static checks (invariants, settings) are JSON records of one atom, run by the static runner: complete.
  const statics = (
    await readdir(join(out, 'static'), { withFileTypes: true, recursive: true }).catch(() => [])
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name));
  for (const path of statics) {
    const record = JSON.parse(await readFile(path, 'utf8')) as {
      id: string;
      atom?: string;
      testType?: string;
    };
    specs.push({
      path,
      id: record.id,
      atoms: record.atom ? [record.atom] : [],
      testType: record.testType ?? '',
      mode: 'static',
      complete: true,
      spec: { blocks: [] } as unknown as Spec,
    });
  }
  const report = JSON.parse(
    await readFile(join(out, 'estate-generate-report.json'), 'utf8'),
  ) as FixtureSuite['report'];
  return { work, map: join(work, 'approved.yaml'), specs, report };
}

async function yamlFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** Runs specs with the fake runtime on an estate root; the verdict per spec id. */
export function runOnFake(
  estate: string,
  specs: readonly string[],
  store: string,
  map?: string,
): Map<string, boolean> {
  const result = cli([
    'estate',
    'run',
    ...specs,
    '--estate',
    estate,
    '--runtime',
    'claude-code',
    '--command',
    FAKE,
    '--store',
    store,
    ...(map ? ['--map', map] : []),
    '--json',
  ]);
  const verdicts = new Map<string, boolean>();
  const at = result.out.indexOf('{');
  if (at < 0) return verdicts;
  try {
    const json = JSON.parse(result.out.slice(at)) as { runs?: Array<{ spec: string; pass: boolean }> };
    for (const run of json.runs ?? []) verdicts.set(run.spec, run.pass === true);
  } catch {
    // No JSON: every spec counts as not passing.
  }
  return verdicts;
}
