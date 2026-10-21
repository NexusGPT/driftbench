import type { CheckSet } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { completionComponents } from '../../src/ladders/estate/completion';
import { completionContract } from '../../src/ladders/estate/completion-contract';
import * as pipeline from '../../src/ladders/estate/pipeline';
import {
  CLASS_PROOFS,
  DEFAULT_COUNT_KINDS,
  deleteAt,
  emissionSites,
  measure,
  PINNED_SEEDS,
  proveEquivalent,
  REASON_CLASSES,
  reloaded,
} from './emission-support';
import { referenceChecks, referenceRun, required, SUFFIXES, suffix } from './ruling-reference';

describe('estate completion emitted assertion structure', { timeout: 1_200_000 }, () => {
  it.each(REASON_CLASSES)(
    'proves %s deletions on every generated input across the four seeds',
    async (reasonClass) => {
      for (const seed of PINNED_SEEDS) {
        const run = referenceRun(await pipeline.generationRun(seed));
        for (const source of run.specs) {
          if (!SUFFIXES.includes(suffix(run, source)) || !source.loaded) continue;
          for (const site of emissionSites(source.loaded.spec).filter(
            (entry) => entry.reasonClass === reasonClass,
          )) {
            const proof = await proveEquivalent(run, source, site);
            expect(proof.differences, `${seed}:${source.record.id}:${site.path.join('.')}`).toEqual([]);
            expect(proof.pass).toBe(true);
            expect(proof.comparisons).toBe(proof.inputs * 2);
            expect(proof.inputs).toBe(
              1 + 2 * completionComponents(completionContract(run, source)).components.length,
            );
          }
        }
      }
    },
  );

  it.each(REASON_CLASSES)(
    'proves %s for every input from its pinned reader census and case analysis',
    async (reasonClass) => {
      const proof = CLASS_PROOFS[reasonClass];
      expect(proof.census(), `${reasonClass} reader census`).toEqual(proof.readers);
      proof.cases();
      // Every site of this class meets the class premise on every pinned seed.
      for (const seed of PINNED_SEEDS) {
        const run = referenceRun(await pipeline.generationRun(seed));
        for (const source of run.specs) {
          if (!SUFFIXES.includes(suffix(run, source)) || !source.loaded) continue;
          const spec = source.loaded.spec;
          for (const site of emissionSites(spec).filter((entry) => entry.reasonClass === reasonClass)) {
            const where = `${seed}:${source.record.id}:${site.path.join('.')}`;
            expect(proof.premise(spec, site), where).toBe(true);
            // The loader's errors and lint warnings are unchanged by the deletion.
            const before = reloaded(source, spec);
            const after = reloaded(source, deleteAt(spec, site.path));
            expect([after.errors, after.warnings], where).toEqual([before.errors, before.warnings]);
          }
        }
      }
    },
  );

  it('accepts an omitted default count but rejects a weaker bound or a missing entry', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const variants: Array<[string, (entries: Array<Record<string, unknown>>) => void, boolean]> = [
      ['omitted count', (entries) => delete required(entries[0]).count, true],
      ['upper bound only', (entries) => (required(entries[0]).count = { max: 3 }), false],
      ['zero', (entries) => (required(entries[0]).count = 0), false],
      ['missing entry', (entries) => entries.splice(0, 1), false],
    ];
    const seen = new Set<string>();
    for (const source of run.specs) {
      const key = suffix(run, source);
      if (!SUFFIXES.includes(key) || !source.loaded) continue;
      for (const kind of DEFAULT_COUNT_KINDS.filter((name) => name !== 'guards')) {
        const entries = (source.loaded.spec.blocks[0]?.expect as Record<string, unknown> | undefined)?.[kind];
        if (seen.has(kind) || !Array.isArray(entries) || JSON.stringify(entries[0]?.count) !== '{"min":1}')
          continue;
        seen.add(kind);
        for (const [name, change, pass] of variants) {
          const spec = structuredClone(source.loaded.spec);
          change(
            (required(spec.blocks[0]).expect as Record<string, Array<Record<string, unknown>>>)[kind] ?? [],
          );
          const changed = { ...run, specs: [reloaded(source, spec)] };
          expect((await measure(changed)).get(`gen.complete.${key}`)?.pass, `${key}:${kind}:${name}`).toBe(
            pass,
          );
        }
      }
    }
    expect([...seen].sort()).toEqual(['references', 'skills', 'subagents']);
  });

  it('rejects a suppressed others_untouched verdict even when created remains red', async () => {
    const original = referenceRun(await pipeline.generationRun(1));
    const source = required(
      original.specs.find(
        (candidate) =>
          SUFFIXES.includes(suffix(original, candidate)) &&
          candidate.loaded?.spec.blocks[0]?.expect?.workspace?.others_untouched === true &&
          !candidate.loaded.spec.blocks[0].expect.workspace.created?.length,
      ),
    );
    const spec = structuredClone(required(source.loaded).spec);
    required(required(spec.blocks[0]).expect).workspace = {
      ...required(spec.blocks[0]?.expect?.workspace),
      created: [],
      others_untouched: true,
    };
    const product = reloaded(source, spec);
    const run = { ...original, specs: [product] };
    const item = `gen.complete.${suffix(original, source)}`;
    const checks = referenceChecks();
    const inventory = completionComponents(completionContract(run, product));
    expect(inventory.components.some((entry) => entry.id.endsWith('expect.workspace.created.empty'))).toBe(
      true,
    );
    expect(
      inventory.components.some((entry) => entry.id.endsWith('expect.workspace.others_untouched.created')),
    ).toBe(true);
    const component = required(
      inventory.components.find((entry) => entry.id.endsWith('expect.workspace.others_untouched.created')),
    );
    let collateralSeen = false;
    const mutant: CheckSet = checks.map((check) =>
      check.name !== 'workspace'
        ? check
        : {
            ...check,
            async evaluate(ctx) {
              const verdicts = await check.evaluate(ctx);
              if (
                verdicts.some((verdict) => verdict.id === 'workspace.created' && verdict.outcome === 'fail')
              )
                collateralSeen = true;
              return verdicts.filter(
                (verdict) => verdict.id !== 'workspace.others_untouched' || verdict.outcome !== 'fail',
              );
            },
          },
    );
    const direct = await pipeline.replayOnFollower(
      run,
      required(product.loaded),
      mutant,
      undefined,
      component.change,
    );
    expect(direct.pass).toBe(false);
    expect(collateralSeen).toBe(true);
    expect(
      direct.run?.blocks[0]?.verdicts.some(
        (verdict) => verdict.id === 'workspace.created' && verdict.outcome === 'fail',
      ),
    ).toBe(true);
    expect(
      direct.run?.blocks[0]?.verdicts.some((verdict) => verdict.id === 'workspace.others_untouched'),
    ).toBe(false);
    expect((await measure(run)).get(item)).toMatchObject({ pass: true });
    expect((await measure({ ...run }, mutant)).get(item)).toMatchObject({
      pass: false,
      detail: expect.stringContaining('others_untouched.created'),
    });
    expect((await measure({ ...run })).get(item)).toMatchObject({ pass: true });
  });
});
