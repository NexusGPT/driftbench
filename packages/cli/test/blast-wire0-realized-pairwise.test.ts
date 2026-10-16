import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provenanceHash, type RunResult } from '@agent-nexus/driftbench-core';
import { FakeJudge } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storeAcmeCampaign } from '../../report/test/support';
import { type ReportDeps, registerCompareCommand } from '../src/commands/compare';

/**
 * Blast radius of PR 430 (merged) on `compare --pairwise`: the pairwise judge reads two replies against the
 * user message of their block. A block whose driver sent other text than the spec wrote records it in
 * `realized`; the judge must not read the replies against a message the agents never received.
 */
let dir = '';
let authored = '';
let otherAuthored = '';
const SENT_BASELINE = 'blast-wire0 baseline driver text';
const SENT_CANDIDATE = 'blast-wire0 candidate driver text';

function firstUser(run: RunResult, specs: Map<string, unknown>): string {
  const spec = specs.get(run.specId) as { blocks: { when: { user?: string } }[] };
  return spec.blocks[0]?.when.user ?? '';
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'blast-wire0-pairwise-'));
  const store = openStore(join(dir, 'store.db'));
  try {
    await storeAcmeCampaign(store, { campaignId: 'c-base', modes: ['F'], repeats: 1 });
    await storeAcmeCampaign(store, { campaignId: 'c-cand', modes: ['F'], repeats: 1 });
    const base = await store.listRuns({ campaignId: 'c-base' });
    const cand = await store.listRuns({ campaignId: 'c-cand' });
    const specs = new Map<string, unknown>();
    for (const run of base) specs.set(run.specId, (await store.getSpec(run.specId, run.specHash))?.spec);
    // One unit: each side's driver sent its own text in block 0, not the authored one.
    const [first, other] = base;
    if (!first || !other) throw new Error('the Acme campaign holds fewer than two runs');
    const twin = cand.find((run) => run.specId === first.specId);
    if (!twin) throw new Error('no candidate run of the same unit');
    authored = firstUser(first, specs);
    otherAuthored = firstUser(other, specs);
    expect(authored).not.toBe('');
    expect(authored).not.toBe(otherAuthored);
    const sent = (run: RunResult, text: string): RunResult => {
      const changed = structuredClone(run);
      const block = changed.blocks[0];
      if (!block) throw new Error('no block 0');
      block.realized = { hash: provenanceHash(text), text };
      return changed;
    };
    await store.putRun('c-base', sent(first, SENT_BASELINE));
    await store.putRun('c-cand', sent(twin, SENT_CANDIDATE));
  } finally {
    await store.close();
  }
  await writeFile(
    join(dir, 'helpful.yaml'),
    'name: helpful\nrubric: The reply answers the customer question.\n',
  );
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function pairwiseRequests(): Promise<string[]> {
  const judge = new FakeJudge('pairwise', [{ outcome: 'pass', reasoning: 'A reads better' }]);
  const deps: ReportDeps = { openStore: async (path) => openStore(path), pairwiseClient: () => judge };
  let err = '';
  const program = new Command('driftbench').exitOverride();
  registerCompareCommand(
    program,
    {
      out: () => {},
      err: (text) => {
        err += text;
      },
      cwd: dir,
    },
    () => {},
    deps,
  );
  await program.parseAsync(
    [
      'compare',
      '--baseline',
      'c-base',
      '--candidate',
      'c-cand',
      '--store',
      'store.db',
      '--margin',
      '2',
      '--pairwise',
      join(dir, 'helpful.yaml'),
    ],
    { from: 'user' },
  );
  expect(err).toBe('');
  // The user messages each judge request reads the two replies against.
  return judge.requests.flatMap((request) =>
    request.transcript.flatMap((entry) => (entry.role === 'user' ? [entry.text] : [])),
  );
}

describe('PR 430 blast radius: compare --pairwise and the text a driver sent', { timeout: 120_000 }, () => {
  it('reads an unchanged block against its authored user message', async () => {
    const requests = await pairwiseRequests();
    expect(requests).toContain(otherAuthored);
  });
});
