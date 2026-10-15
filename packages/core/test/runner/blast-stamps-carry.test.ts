// Blast radius of unit F2 on block reuse: a block carried into a run keeps the verdicts and the `resolved`
// record of the run it came from. When a project object the spec uses changes between the two runs, the spec
// hash and the cache keys stay (scoring-only), so the carry is allowed; the rerun blocks are scored under the
// new objects and the carried ones under the old, inside one run.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { clearObjectContexts, objectContextFor } from '../../src/objects/layers';
import { adapterProvenance, provenanceHash } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { loadSpecFile } from '../../src/spec/load';
import { echoAdapter, minimalChecks } from './support';

// Registers check-set:default, which the project object extends.
void defaultChecks;

const SPEC = [
  'id: blast-carry',
  'metadata: { depends: {} }',
  'uses: { check_set: house }',
  'blocks:',
  "  - { when: { user: one }, expect: { stage: one, must: ['ok'] } }",
  "  - { when: { user: two }, expect: { stage: two, must: ['ok'] } }",
  "  - { when: { user: three }, expect: { stage: three, must: ['ok'] } }",
  '',
].join('\n');
const HOUSE = (disabled: string) =>
  `kind: check-set\nid: house\nextends: default\nitems:\n  - { id: ${disabled}, enabled: false }\n`;

function project(): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), 'driftbench-blast-carry-'));
  const files: Record<string, string> = {
    'driftbench.yaml': 'plugins: []\n',
    'driftbench/check-set/house.yaml': HOUSE('bleu'),
    'specs/carry.yaml': SPEC,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, path: join(root, 'specs/carry.yaml') };
}

const target = { adapter: 'echo', variant: 'v1' };
const common = {
  driver: createScriptedDriver(),
  checks: minimalChecks.filter((check) => check.name !== 'stage'),
  repeat: 0,
  recordProvenance: true,
  now: () => new Date('2026-10-13T00:00:00Z'),
  mode: 'T' as const,
};

// BUG: a carried block keeps the verdicts and resolved of objects the run no longer resolves, reported to lead
it.fails('scores every block of one run under the objects that run resolved, carried blocks included', async () => {
  const { root, path } = project();
  clearObjectContexts();
  const before = await loadSpecFile(path);
  if (!before.ok) throw new Error(JSON.stringify(before.errors));
  const source = await runSpec(before.spec, {
    ...common,
    target,
    adapter: echoAdapter(),
    objects: objectContextFor(path),
  });
  expect(source.blocks.every((block) => block.verdicts.some((verdict) => verdict.name === 'must'))).toBe(
    true,
  );

  // The project object now disables must: a scoring-only change, so the spec hash stays and the carry holds.
  writeFileSync(join(root, 'driftbench/check-set/house.yaml'), HOUSE('must'));
  clearObjectContexts();
  const after = await loadSpecFile(path);
  if (!after.ok) throw new Error(JSON.stringify(after.errors));
  const run = await runSpec(after.spec, {
    ...common,
    target: { ...target, variant: 'v2' },
    adapter: echoAdapter(),
    objects: objectContextFor(path),
    blocks: new Set([1]),
    blockReuse: {
      source,
      fromCampaign: 'base',
      baselineProvenance: {
        version: 2,
        adapters: [
          {
            ...adapterProvenance(echoAdapter()),
            targetHash: provenanceHash(target),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
      manifest: { from: 'v1', to: 'v2', changes: [{ kind: 'stage', id: 'two' }] },
    },
  });
  expect(run.specHash).toBe(source.specHash);
  expect(run.blocks[2]?.carried).toBeDefined();
  // What one run reports was scored by one set of objects: a carried block scored under other objects is
  // re-scored, or the carry is refused.
  const hashes = new Set(run.blocks.map((block) => block.resolved?.hash));
  expect(hashes.size).toBe(1);
  expect(run.blocks.some((block) => block.verdicts.some((verdict) => verdict.name === 'must'))).toBe(false);
});
