import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { expect, it } from 'vitest';
import { cellId, planRadiusCampaign, type RunResult, radiusOf } from '../../src/index';
import { provenanceHash, runProvenance } from '../../src/runner/provenance';
import { runSpec } from '../../src/runner/run';
import { echoAdapter, specOf } from './support';

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

const spec = specOf({
  id: 'acme-integrity',
  metadata: { depends: {} },
  blocks: [
    { id: 'hello', user: 'hello', expect: { ledger_add: { plan: 'Acme' } } },
    { id: 'close', user: 'goodbye' },
  ],
});
const options = {
  adapter: echoAdapter(),
  driver: createScriptedDriver(),
  checks: [],
  mode: 'F' as const,
  repeat: 0,
  target: { adapter: 'echo', variant: 'v1' },
  recordProvenance: true,
};
const manifest = { from: 'v1', to: 'v2', changes: [{ kind: 'criterion' as const, id: 'unused' }] };
const target = { ...options.target, variant: 'v2' };

// Independent implementation of the documented integrity envelope, including the existing Given hash.
function seal(run: RunResult) {
  return {
    ...run,
    provenanceDigest: provenanceHash({
      run: run.provenance,
      blocks: run.blocks.map(({ index, blockId, injected, givenHash, provenance }) => ({
        index,
        blockId,
        injected,
        givenHash,
        provenance,
      })),
    }),
  };
}
function plan(run: RunResult, currentSpec = spec) {
  const cell = { ...run, target, cellId: cellId({ ...run, target }), blocks: run.blocks.length };
  return planRadiusCampaign(
    [cell],
    radiusOf([{ spec, hash: run.specHash }], manifest),
    manifest,
    {
      campaignId: 'base',
      runs: [run],
      provenance: {
        version: 2,
        adapters: [
          {
            ...present(run.provenance).adapter,
            targetHash: provenanceHash(run.target),
            agentVersionHash: provenanceHash('v1'),
          },
        ],
      },
    },
    {
      now: new Date(),
      currentProvenance: () => runProvenance({ ...options, target, mode: run.mode }),
      currentSpec: () => currentSpec,
    },
  );
}
const mutations: Record<string, (run: RunResult) => void> = {
  specIndex: (r) => {
    present(present(r.blocks[0]).provenance).specIndex = 1;
  },
  stimulusHash: (r) => {
    present(present(r.blocks[0]).provenance).stimulusHash = provenanceHash('different');
  },
  ledgerHash: (r) => {
    present(present(r.blocks[0]).provenance).ledgerHash = provenanceHash('different');
  },
  pathHash: (r) => {
    present(present(present(r.blocks[0]).provenance).artifacts[0]).pathHash = provenanceHash('different');
  },
  sha256: (r) => {
    present(present(present(r.blocks[0]).provenance).artifacts[0]).sha256 = provenanceHash('different');
  },
  givenHash: (r) => {
    present(r.blocks[0]).givenHash = 'abcdef123456';
  },
};
async function recorded(mode: 'F' | 'T' = 'F') {
  return runSpec(spec, {
    ...options,
    mode,
    adapter: {
      ...options.adapter,
      async send(...args) {
        return {
          ...(await options.adapter.send(...args)),
          artifacts: [{ path: 'fixture.txt', sha256: provenanceHash('Acme') }],
        };
      },
    },
  });
}
it('rejects the complete reviewer block-field matrix without sending a request', async () => {
  const run = await recorded();
  expect(plan(run).carried).toHaveLength(1);
  for (const [field, mutate] of Object.entries(mutations)) {
    const changed = structuredClone(run);
    mutate(changed);
    expect(plan(changed).fresh, field).toHaveLength(1);
    expect(plan(changed).carried, field).toHaveLength(0);
  }
});
it('recomputes spec indices, Given, stimuli and ledgers even when a false stamp is resealed', async () => {
  for (const mode of ['F', 'T'] as const) {
    const run = await recorded(mode);
    expect(plan(run).carried).toHaveLength(1);
    for (const field of ['specIndex', 'stimulusHash', 'ledgerHash', 'givenHash']) {
      const changed = structuredClone(run);
      present(mutations[field])(changed);
      expect(plan(seal(changed)).fresh, `${mode}.${field}`).toHaveLength(1);
    }
    const changed = structuredClone(spec);
    present(changed.blocks[0]).given = { vars: { planted: 'regression' } };
    expect(plan(run, changed).fresh).toHaveLength(1);
  }
});
it('rejects a missing digest, unknown fields and one-byte changes at every stamp leaf', async () => {
  const run = await recorded();
  const missing = { ...run, provenanceDigest: undefined };
  expect(plan(missing).carried).toHaveLength(0);
  const leaves = (value: unknown, path: (string | number)[] = []): (string | number)[][] =>
    value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]))
      : [path];
  const paths = [
    ...leaves(run.provenance, ['provenance']),
    ...run.blocks.flatMap((block, index) => [
      ...leaves(block.provenance, ['blocks', index, 'provenance']),
      ['blocks', index, 'givenHash'],
    ]),
  ];
  for (const path of paths) {
    const changed = structuredClone(run);
    let node = changed as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
    const key = present(path.at(-1));
    const old = node[key];
    node[key] =
      typeof old === 'string'
        ? `${old[0] === 'a' ? 'b' : 'a'}${old.slice(1)}`
        : typeof old === 'number'
          ? old + 1
          : !old;
    expect(plan(changed).carried, path.join('.')).toHaveLength(0);
  }
  for (const location of ['run', 'block', 'artifact']) {
    const changed = structuredClone(run);
    const stamp =
      location === 'run'
        ? changed.provenance
        : location === 'block'
          ? present(changed.blocks[0]).provenance
          : present(present(changed.blocks[0]).provenance).artifacts[0];
    Object.assign(present(stamp), { unknownStampField: provenanceHash('future') });
    expect(plan(seal(changed)).carried, location).toHaveLength(0);
  }
});
