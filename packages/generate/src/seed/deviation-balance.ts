import { canonicalGiven, contentHash, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import { NONE, placeSpec } from '@agent-nexus/driftbench-space';
import { renderDraft, type SpecDraft } from './assemble';
import type { PreparedMap } from './map';
import { hasPaths, type SeedContext, scenarioDraft } from './seed-drafts';

/** How many times a top-up looks for a probe that is a new test before it settles for a repeat of one. */
const NEW_PROBE_TRIES = 40;

/**
 * The tests the injected blocks of a spec are, as a validator tells them apart: the class said, the path walked,
 * the stage the block starts from, the tool answers it runs under and the Then it expects. A second probe of the
 * same class with the same five is a repeat, however it is worded.
 */
export function probeKeys(spec: Spec): string[] {
  const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
  return spec.blocks.flatMap((block, index) => {
    if (!('injection' in block.when)) return [];
    const { criteria: _criteria, ...machine } = block.expect ?? {};
    const from =
      block.given?.stage ?? (index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage);
    const world = canonicalGiven(spec, index).state.world as { tools?: unknown } | undefined;
    return [contentHash([block.when.injection.class, path, from, world?.tools ?? null, machine])];
  });
}

/** Actual probe counts, independent of seeder labels and output suite size. */
export class DeviationBalance {
  private serial = 0;
  private readonly counts: Map<string, number>;
  private readonly probes = new Set<string>();

  constructor(private readonly prepared: PreparedMap) {
    this.counts = new Map(
      (prepared.space.dimensions[prepared.deviation ?? -1]?.values ?? [])
        .filter((value) => value.id !== NONE)
        .map((value) => [value.id, 0]),
    );
  }

  observe(spec: Spec): void {
    for (const key of probeKeys(spec)) this.probes.add(key);
    const dimension = this.prepared.deviation;
    if (dimension === undefined) return;
    for (const event of placeSpec(this.prepared.space, spec).events)
      for (const value of event.values[dimension] ?? []) {
        const cls = this.prepared.space.dimensions[dimension]?.values[value]?.id;
        if (cls && this.counts.has(cls)) this.counts.set(cls, (this.counts.get(cls) ?? 0) + 1);
      }
  }

  /**
   * Add approved scenarios for classes below one third of the most exercised class. Existing specs and
   * random draws stand. The caller renders each draft and observes it only when complete, before resuming
   * this iterator. An unsupported or incomplete class stops without repeated placeholder attempts.
   */
  *topUps(context: SeedContext, existing: number): Generator<SpecDraft> {
    const dimension = this.prepared.deviation;
    if (dimension === undefined || !hasPaths(this.prepared)) return;
    const target = Math.ceil(Math.max(0, ...this.counts.values()) / 3);
    let added = 0;
    for (const cls of this.counts.keys()) {
      let repeats = 0;
      while ((this.counts.get(cls) ?? 0) < target && existing + added < context.max) {
        const before = this.counts.get(cls) ?? 0;
        const id = `gen-deviation-balance-${String(this.serial + 1).padStart(3, '0')}`;
        const required = new Set(
          (this.prepared.inventory?.flows ?? [])
            .filter((flow) => (flow.deviations ?? []).includes(cls as never))
            .map((flow) => flow.id),
        );
        const built = scenarioDraft(
          this.prepared,
          context,
          id,
          'deviation',
          `Balanced deviation probe ${cls}`,
          [],
          {
            preferred: this.prepared.relations.paths.filter((path) => required.has(path.flow)),
            others: this.prepared.relations.paths.filter((path) => !required.has(path.flow)),
          },
          { probe: { classId: cls, cut: true } },
        );
        if (!('draft' in built)) break;
        // A probe that repeats a test the suite already has adds a placement and no test: the next draw is tried,
        // and a repeat is written only when no new test is found, so the class still reaches its third.
        if (context.run && repeats < NEW_PROBE_TRIES) {
          const rendered = renderDraft(this.prepared, built.draft, context.run);
          const parsed =
            rendered.placeholders.length || rendered.noThen.length ? undefined : validateSpec(rendered.spec);
          if (parsed?.ok && probeKeys(parsed.spec).some((key) => this.probes.has(key))) {
            repeats += 1;
            this.serial += 1;
            continue;
          }
        }
        const value = this.prepared.space.dimensions[dimension]?.index.get(cls);
        if (value === undefined) break;
        built.draft.cell.push([dimension, value]);
        added += 1;
        this.serial += 1;
        yield built.draft;
        if ((this.counts.get(cls) ?? 0) <= before) break;
      }
    }
  }
}
