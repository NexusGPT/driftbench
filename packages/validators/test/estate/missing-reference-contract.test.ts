import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import * as fixture from '../../src/ladders/estate/bank/fixture-suite';
import { coverageFamily } from '../../src/ladders/estate/bank/genquality';
import { agentMutants, estateRun } from '../../src/ladders/estate/index';
import { estateMeta } from '../../src/ladders/estate/levels';

/** The calls of a `rules.custom.some_call` entry of a generated spec. */
type SomeCalls = {
  calls?: Array<{ label?: string; input?: { file_path?: { contains?: string } }; count?: unknown }>;
};

describe('a Read of a file the estate does not hold (docs/estate.md section 5, needs-existing-file)', {
  timeout: 600_000,
}, () => {
  it('lists the estate beside its map, so a reference to a missing file is checked as an attempted Read, never as a read', async () => {
    const suite = await fixture.fixtureSuite();
    const map = await loadEstateMap(suite.map);
    if (!map.ok) throw new Error('the fixture map does not load');
    // docs/estate.md section 5: the runner registers some_call, so a declared Read of a file the estate copy does not
    // hold is checked as the attempted call; needs-existing-file is only for a run without that checker.
    const waiting = (suite.report.gaps ?? []).find((gap) => gap.marker === 'needs-existing-file');
    expect(waiting?.atoms ?? []).toEqual([]);
    const absent = map.map.atoms.filter((a) => a.kind === 'reference' && a.fields?.exists === false);
    expect(absent.length).toBeGreaterThan(0);
    for (const atom of absent) {
      const path = String(atom.fields?.path);
      expect(existsSync(join(fixture.FIXTURE, path)), atom.id).toBe(false);
      const specs = suite.specs.filter((spec) => spec.complete && spec.atoms.includes(atom.id));
      expect(specs.length, atom.id).toBeGreaterThan(0);
      for (const spec of specs) {
        const calls = (spec.spec.rules?.custom?.some_call as SomeCalls | undefined)?.calls ?? [];
        // The attempt of the Read, one call at least, of the exact file the reference names.
        expect(
          calls.some(
            (call) =>
              call.label === 'Read' &&
              call.input?.file_path?.contains === path &&
              JSON.stringify(call.count) === JSON.stringify({ min: 1 }),
          ),
          `${spec.id}: a some_call Read of ${path}`,
        ).toBe(true);
        // Never a successful read of the missing file: no references entry names it.
        const name = path.slice(path.lastIndexOf('/') + 1);
        expect(
          spec.spec.blocks.flatMap((block) => block.expect?.references ?? []).map((ref) => String(ref.path)),
          `${spec.id}: a successful read of ${path}`,
        ).not.toContainEqual(expect.stringContaining(name));
      }
    }
    // Every reference whose file the fixture holds is judged by a complete spec, never held back by the marker.
    const present = map.map.atoms.filter((a) => a.kind === 'reference' && a.fields?.exists === true);
    expect(present.length).toBeGreaterThan(0);
    for (const atom of present) expect(waiting?.atoms.includes(atom.id) ?? false, atom.id).toBe(false);
  });

  it('judges a missing reference by the attempted Read with some_call, or by its marker when no some_call is registered', async () => {
    const suite = await fixture.fixtureSuite();
    const map = await loadEstateMap(suite.map);
    if (!map.ok) throw new Error('the fixture map does not load');
    const absent = map.map.atoms.filter((a) => a.kind === 'reference' && a.fields?.exists === false);
    expect(absent.length).toBeGreaterThan(0);
    const absentIds = new Set(absent.map((a) => a.id));
    const one = async (planted: typeof suite) => {
      const mock = vi.spyOn(fixture, 'fixtureSuite').mockResolvedValue(planted);
      try {
        return (await coverageFamily().evaluate(1)).get('gen.coverage.one-per-reference');
      } finally {
        mock.mockRestore();
      }
    };
    const real = await one(suite);
    expect(suite.checks).toContain('some_call');
    expect(real?.detail).not.toContain('missing file');

    // Branch 1, some_call registered. Planted: the some_call Read of the missing file leaves every spec of it.
    const noAttempt = {
      ...suite,
      specs: suite.specs.map((spec) => {
        if (!spec.atoms.some((id) => absentIds.has(id))) return spec;
        const custom = (spec.spec.rules?.custom ?? {}) as Record<string, unknown>;
        const someCall = custom.some_call as SomeCalls | undefined;
        if (!someCall) return spec;
        return {
          ...spec,
          spec: {
            ...spec.spec,
            rules: {
              ...spec.spec.rules,
              custom: {
                ...custom,
                some_call: { ...someCall, calls: (someCall.calls ?? []).filter((call) => call.label !== 'Read') },
              },
            },
          },
        } as typeof spec;
      }),
    };
    expect(await one(noAttempt)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('checks the attempted Read with some_call'),
    });
    // Planted: the missing reference waits on the marker although some_call is registered.
    const markedAnyway = {
      ...suite,
      report: {
        ...suite.report,
        gaps: [
          ...(suite.report.gaps ?? []).filter((gap) => gap.marker !== 'needs-existing-file'),
          { marker: 'needs-existing-file', specs: absent.length, atoms: [...absentIds] },
        ],
      },
    };
    expect(await one(markedAnyway)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('checks the attempted Read with some_call'),
    });

    // Branch 2, no some_call registered. Planted: the report holds no marker, so the missing reference is unmarked.
    const noSomeCall = suite.checks.filter((check) => check !== 'some_call');
    const unmarked = {
      ...suite,
      checks: noSomeCall,
      report: {
        ...suite.report,
        gaps: (suite.report.gaps ?? []).filter((gap) => gap.marker !== 'needs-existing-file'),
      },
    };
    expect(await one(unmarked)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('not marked needs-existing-file'),
    });
    // With the marker on every missing reference, the marker demand holds.
    expect((await one({ ...markedAnyway, checks: noSomeCall }))?.detail).not.toContain('missing file');

    // Planted: every complete spec of the references that exist is dropped; the item is red for them.
    const dropped = {
      ...suite,
      specs: suite.specs.filter((spec) => !spec.id.includes('reference') || !spec.complete),
    };
    const none = suite.specs.filter(
      (spec) => spec.complete && spec.atoms.some((id) => id.startsWith('reference.')),
    );
    if (none.length > 0) expect((await one(dropped))?.pass).toBe(false);
  });

  it('kills the mutant of a reference to a missing file by its attempted Read, and still counts a present one that has no complete test', async () => {
    const run = await estateRun(1);
    const mutants = await agentMutants(run);
    const absent = run.scanned.map.atoms.filter((a) => a.kind === 'reference' && a.fields?.exists === false);
    expect(absent.length).toBeGreaterThan(0);
    // docs/estate.md section 5: with some_call registered the attempt of the Read is checked, so a complete test names
    // the atom and a follower that drops the reference fails it. The mutant is killed, never named untestable.
    for (const atom of absent) {
      const mutant = mutants.find((m) => m.atom === atom.id);
      expect(mutant, atom.id).toMatchObject({ killed: true });
      expect(mutant?.untestable, atom.id).toBeUndefined();
      expect(mutant?.tests.length, atom.id).toBeGreaterThan(0);
    }
    // Planted: the complete tests of a reference the estate holds are made incomplete. Its mutant is alive.
    const present = run.scanned.map.atoms.find(
      (a) =>
        a.kind === 'reference' && a.fields?.exists === true && mutants.find((m) => m.atom === a.id)?.killed,
    );
    if (!present) throw new Error('no killed present reference on seed 1');
    const planted = {
      ...run,
      specs: run.specs.map((spec) =>
        (estateMeta(spec).atoms ?? []).includes(present.id)
          ? { ...spec, record: { ...spec.record, complete: false } }
          : spec,
      ),
    };
    const after = (await agentMutants(planted)).find((m) => m.atom === present.id);
    expect(after).toMatchObject({ killed: false });
    expect(after?.untestable).toBeUndefined();
  });

  it('takes "absent" from the hidden estate, not from the product: a product that lies about which files exist gains nothing', async () => {
    for (const seed of [1, 2]) {
      const run = await estateRun(seed);
      const honest = await agentMutants(run);
      const held = (atomId: string) => {
        const hid = run.scanned.match.hidOf.get(atomId);
        const truth = run.rendered.atoms.find((candidate) => candidate.hid === hid);
        return truth?.kind === 'reference' && truth.key in run.rendered.files;
      };
      const present = run.scanned.map.atoms.filter((a) => a.kind === 'reference' && held(a.id));
      expect(present.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(
        present.some((a) => honest.find((m) => m.atom === a.id)?.killed),
        `seed ${seed}: a present reference is judged`,
      ).toBe(true);
      // Planted product: the scan marks every reference absent, and every spec naming a reference waits on the marker.
      const references = new Set(
        run.scanned.map.atoms.filter((a) => a.kind === 'reference').map((a) => a.id),
      );
      const lying = {
        ...run,
        scanned: {
          ...run.scanned,
          map: {
            ...run.scanned.map,
            atoms: run.scanned.map.atoms.map((a) =>
              a.kind === 'reference' ? { ...a, fields: { ...a.fields, exists: false } } : a,
            ),
          },
        },
        specs: run.specs.map((spec) => {
          const named = (estateMeta(spec).atoms ?? []).filter((id) => references.has(id));
          if (named.length === 0 || spec.loaded === undefined) return spec;
          const metadata = spec.loaded.spec.metadata as { estate?: Record<string, unknown> };
          return {
            ...spec,
            record: { ...spec.record, complete: false },
            loaded: {
              ...spec.loaded,
              spec: {
                ...spec.loaded.spec,
                metadata: {
                  ...metadata,
                  estate: {
                    ...metadata.estate,
                    needs: named.map((atom) => ({ marker: 'needs-existing-file', atom, detail: 'planted' })),
                  },
                },
              },
            },
          };
        }),
      };
      const after = await agentMutants(lying);
      for (const atom of present)
        expect(after.find((m) => m.atom === atom.id)?.untestable, `seed ${seed} ${atom.id}`).toBeUndefined();
      // The reference the estate truly lacks is still named, not counted alive.
      const absent = run.scanned.map.atoms.filter((a) => a.kind === 'reference' && !held(a.id));
      expect(absent.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const atom of absent)
        expect(
          after.find((m) => m.atom === atom.id),
          `seed ${seed} ${atom.id}`,
        ).toMatchObject({ untestable: true });
    }
  });
});
