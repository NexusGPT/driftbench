import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCampaignBundle, writeCampaignBundle } from '../../store/src/bundle';
import { campaign, observed, perturbedRun, run } from '../../store/test/fixtures';
import {
  canonicalJson,
  contentHash,
  HistoryNormalization,
  Observed,
  provenanceDigest,
  RunResult,
} from '../src/index';

const note = { wire: 'anthropic', historyIndex: 2, role: 'user', kind: 'omitted-empty-turn' } as const;
// The exact observation schema before this optional addition; no defaults or transforms are introduced.
const LegacyObserved = Observed.omit({ historyNormalizations: true });
const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) await rm(folder, { recursive: true, force: true });
});

function legacy(run: RunResult): RunResult {
  return {
    ...run,
    blocks: run.blocks.map((block) => ({ ...block, observed: LegacyObserved.parse(block.observed) })),
  };
}

async function filesAt(folder: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await filesAt(path)));
    else files.push(path);
  }
  return files;
}

describe('the optional history normalization schema', () => {
  it('accepts a typed wire difference and rejects invalid indices, roles and kinds', () => {
    expect(HistoryNormalization.parse(note)).toEqual(note);
    for (const change of [
      { historyIndex: -1 },
      { historyIndex: 1.5 },
      { wire: '' },
      { role: 'model' },
      { kind: 'omitted-nonempty-turn' },
      { extra: true },
    ]) {
      expect(HistoryNormalization.safeParse({ ...note, ...change }).success).toBe(false);
    }
    const observed = run().blocks[0]?.observed;
    expect(Observed.parse({ ...observed, historyNormalizations: [note] }).historyNormalizations).toEqual([
      note,
    ]);
  });

  it('preserves legacy observation bytes and run hashes when the field is absent', () => {
    const full = observed();
    const required = {
      segments: full.segments,
      text: full.text,
      toolCalls: full.toolCalls,
      cost: full.cost,
      latencyMs: full.latencyMs,
    };
    const cases = [
      full,
      required,
      ...Object.entries(full).map(([key, value]) => ({ ...required, [key]: value })),
    ];
    for (const value of cases) {
      const before = LegacyObserved.parse(value);
      const current = Observed.parse(value);
      expect(current).not.toHaveProperty('historyNormalizations');
      expect(JSON.stringify(current)).toBe(JSON.stringify(before));
      expect(contentHash(current)).toBe(contentHash(before));
    }
    for (const fixture of [run(), perturbedRun(), run({ status: 'failed', error: 'offline' })]) {
      const current = RunResult.parse(fixture);
      const before = legacy(current);
      expect(JSON.stringify(current)).toBe(JSON.stringify(before));
      expect(canonicalJson(current)).toBe(canonicalJson(before));
      expect(contentHash(current)).toBe(contentHash(before));
      expect(provenanceDigest(current)).toBe(provenanceDigest(before));
    }
  });

  it('writes and reads identical bundle bytes when the field is absent', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'driftbench-history-compat-'));
    temporary.push(folder);
    const current = RunResult.parse(run());
    const before = legacy(current);
    const oldBundle = await writeCampaignBundle(join(folder, 'legacy'), campaign(), [before]);
    const newBundle = await writeCampaignBundle(join(folder, 'current'), campaign(), [current]);
    const oldFiles = await filesAt(oldBundle);
    for (const file of oldFiles) {
      expect(await readFile(join(newBundle, file.slice(oldBundle.length + 1)), 'utf8')).toBe(
        await readFile(file, 'utf8'),
      );
    }
    expect(await readCampaignBundle(newBundle)).toEqual(await readCampaignBundle(oldBundle));
  });
});
