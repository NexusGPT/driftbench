import type {
  Aspect,
  Link,
  LinkKind,
  ModelCoverage,
  Part,
  TypeSet,
} from '@agent-nexus/driftbench-core';
import { expect } from 'vitest';

/** Test input and oracle, authored before implementation. Neither expected names nor aspects come from output. */
export type PartPlant = {
  positive: Record<string, string>;
  negative: Record<string, string>;
  name?: string;
  aspects: readonly Aspect[];
};
export type LinkPlant = {
  positive: Record<string, string>;
  negative: Record<string, string>;
  from: string;
  to: string;
  fromType?: string;
  toType?: string;
};

/** The test callback unwraps the canonical result into its existing core values; no production seam is defined. */
export type Observe = (files: Record<string, string>, types: TypeSet) => Promise<{
  parts: readonly Part[];
  links: readonly Link[];
  coverage: ModelCoverage;
}>;

/** Generate assertions from the declared types, aspects and link kinds, refusing any declaration with no plant. */
export async function declaredConformance(
  types: TypeSet,
  linkKinds: readonly LinkKind[],
  parts: Readonly<Record<string, PartPlant>>,
  links: Readonly<Partial<Record<LinkKind, LinkPlant>>>,
  observe: Observe,
): Promise<void> {
  expect(Object.keys(parts).sort()).toEqual(types.types.map((type) => type.name).sort());
  expect(Object.keys(links).sort()).toEqual([...new Set(linkKinds)].sort());
  for (const type of types.types) {
    const plant = parts[type.name];
    expect(plant, `${type.name}: missing fixture`).toBeDefined();
    if (!plant) throw new Error(`${type.name}: missing fixture`);
    expect(type.aspects, `${type.name}: independently authored aspect oracle`).toEqual(plant.aspects);
    const positive = await observe(plant.positive, types);
    const negative = await observe(plant.negative, types);
    const target = positive.parts.filter((part) => part.type === type.name);
    expect(target, `${type.name}: positive part`).not.toHaveLength(0);
    for (const part of target) {
      expect(part.aspects).toEqual(type.aspects);
      expect(part.loaded).toEqual(type.loaded);
      expect(part.runtime).toBe(type.runtime);
    }
    if (plant.name) expect(target.map((part) => part.name)).toContain(plant.name);
    expect(negative.parts.filter((part) => part.type === type.name), `${type.name}: negative part`).toEqual([]);
    for (const aspect of type.aspects) {
      expect(target.some((part) => part.aspects.includes(aspect)), `${type.name}/${aspect}: positive`).toBe(true);
      expect(
        negative.parts.some((part) => part.type === type.name && part.aspects.includes(aspect)),
        `${type.name}/${aspect}: negative`,
      ).toBe(false);
    }
    const replacement: Aspect = type.aspects.includes('person-facing') ? 'informs' : 'person-facing';
    const changed: TypeSet = {
      ...types,
      types: types.types.map((partType) => partType.name === type.name
        ? { ...partType, aspects: [replacement] } : partType),
    };
    const mutated = await observe(plant.positive, changed);
    expect(mutated.parts.filter((part) => part.type === type.name).map((part) => part.aspects)).toEqual(
      target.map(() => [replacement]),
    );
    expect(target.every((part) => part.aspects.length === 1 && part.aspects[0] === replacement)).toBe(false);
  }
  for (const kind of new Set(linkKinds)) {
    const plant = links[kind];
    expect(plant, `${kind}: missing fixture`).toBeDefined();
    if (!plant) throw new Error(`${kind}: missing fixture`);
    const positive = await observe(plant.positive, types);
    const negative = await observe(plant.negative, types);
    const from = new Set(positive.parts.filter((part) => part.name === plant.from
      && (plant.fromType === undefined || part.type === plant.fromType)).map((part) => part.id));
    const to = new Set(positive.parts.filter((part) => part.name === plant.to
      && (plant.toType === undefined || part.type === plant.toType)).map((part) => part.id));
    const found = positive.links.filter((link) => link.kind === kind && from.has(link.from) && to.has(link.to));
    expect(found, `${kind}: positive link`).not.toHaveLength(0);
    expect(negative.links.filter((link) => link.kind === kind), `${kind}: negative link`).toEqual([]);
    for (const link of found) {
      expect(link.provenance.reader).not.toBe('');
      expect(link.provenance.file).not.toBe('');
      expect(link.provenance.line).toBeGreaterThan(0);
      expect(link.confidence).toBeGreaterThan(0);
      expect(link.confidence).toBeLessThanOrEqual(1);
    }
  }
}

/** Compare findings across file/root moves while allowing paths, ids and source lines to reflect the move. */
export function semanticStructure(parts: readonly Part[], links: readonly Link[]): string {
  const key = (part: Part) => `${part.type}:${part.name ?? ''}:${[...part.aspects].sort().join(',')}`;
  const byId = new Map(parts.map((part) => [part.id, key(part)]));
  return JSON.stringify({
    parts: parts.map(key).sort(),
    links: links.map((link) => `${byId.get(link.from)}:${link.kind}:${byId.get(link.to)}`).sort(),
  });
}
