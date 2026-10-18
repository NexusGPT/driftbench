import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { criteriaFromConfig, mergeAggregates, readAggregateConfig } from '../src/aggregate-config';

const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function fileWith(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'driftbench-aggregate-config-'));
  made.push(dir);
  const path = join(dir, 'driftbench.yaml');
  await writeFile(path, text);
  return path;
}

describe('driftbench.yaml aggregates', () => {
  it('reads the aggregates list in file order', async () => {
    const path = await fileWith('aggregates:\n  - pass-rate:>=0.8\n  - broken-share:<=0.2\n');
    expect(await readAggregateConfig(path)).toEqual({
      ok: true,
      specs: ['pass-rate:>=0.8', 'broken-share:<=0.2'],
    });
  });

  it('refuses a bad aggregate entry and names its line', async () => {
    const path = await fileWith('aggregates:\n  - pass-rate:>=0.8\n  - nope:>=1\n');
    const loaded = await readAggregateConfig(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.message).toContain('driftbench.yaml:3');
    expect(loaded.message).toContain('unknown aggregate nope');
  });

  it('refuses a key the file does not define, and names its line', async () => {
    const path = await fileWith('aggregates: []\nsurprise: 1\n');
    const loaded = await readAggregateConfig(path);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.message).toContain('driftbench.yaml:2');
    expect(loaded.message).toContain('surprise');
  });

  it('keeps two flags of one name as two criteria: a flag replaces a file entry, never another flag', () => {
    expect(mergeAggregates([], ['pass-rate:>=0.3', 'pass-rate:>=0.32'])).toEqual([
      'pass-rate:>=0.3',
      'pass-rate:>=0.32',
    ]);
    expect(mergeAggregates(['pass-rate:>=0.8'], ['pass-rate:>=0.3', 'pass-rate:<=0.9'])).toEqual([
      'pass-rate:>=0.3',
      'pass-rate:<=0.9',
    ]);
  });

  it('lets a flag with the same name override the file, and keeps the rest in file order', () => {
    expect(
      mergeAggregates(['pass-rate:>=0.8', 'broken-share:<=0.2'], ['pass-rate:>=0.9', 'latency:<=5']),
    ).toEqual(['pass-rate:>=0.9', 'broken-share:<=0.2', 'latency:<=5']);
  });
});

describe('criteriaFromConfig', () => {
  it('reads driftbench.yaml from the working folder, and a flag overrides its entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-config-default-'));
    made.push(dir);
    await writeFile(join(dir, 'driftbench.yaml'), 'aggregates:\n  - pass-rate:>=0.8\n');
    const fromFile = await criteriaFromConfig({}, dir);
    expect(fromFile.ok && fromFile.criteria.map((entry) => [entry.name, entry.threshold])).toEqual([
      ['pass-rate', 0.8],
    ]);
    const overridden = await criteriaFromConfig({ aggregate: ['pass-rate:>=0.95'] }, dir);
    expect(overridden.ok && overridden.criteria.map((entry) => [entry.name, entry.threshold])).toEqual([
      ['pass-rate', 0.95],
    ]);
  });

  it('refuses a --config file that cannot be read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-config-missing-'));
    made.push(dir);
    const loaded = await criteriaFromConfig({ config: 'absent.yaml' }, dir);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.message).toContain('Cannot read the config');
  });
});

describe('driftbench.yaml scales: a score scale per criterion', () => {
  it('reads each criterion scale, and leaves the aggregates reader unchanged', async () => {
    const { readScaleConfig } = await import('../src/aggregate-config');
    const path = await fileWith(
      'aggregates:\n  - pass-rate:>=0.8\nscales:\n  tone:\n    min: 1\n    max: 5\n',
    );
    expect(await readScaleConfig(path)).toEqual({ ok: true, scales: { tone: { min: 1, max: 5 } } });
    expect(await readAggregateConfig(path)).toEqual({ ok: true, specs: ['pass-rate:>=0.8'] });
  });

  it('refuses a scale whose minimum is not below its maximum, and names the line', async () => {
    const { readScaleConfig } = await import('../src/aggregate-config');
    const path = await fileWith('scales:\n  tone:\n    min: 5\n    max: 1\n');
    const loaded = await readScaleConfig(path);
    expect(loaded.ok).toBe(false);
    expect(loaded.ok ? '' : loaded.message).toMatch(/:2: tone: min must be below max/);
  });
});
