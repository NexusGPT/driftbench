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
