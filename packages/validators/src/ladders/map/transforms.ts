import { baseOrder, type RenderOptions } from './render';
import { Draw, type HiddenConstraint, type HiddenSpec, mixSeed } from './spec';

/**
 * The metamorphic transforms and the two composition checks of docs/validators.md section 2. A transform
 * changes how the specification is written and never what it says, so the map must not change except in its
 * quotes. Additivity renders two halves of the specification; unit response adds one constraint.
 */

export const TRANSFORMS = ['permute', 'split', 'synonym', 'decoy'] as const;
export type Transform = (typeof TRANSFORMS)[number];

/** The render options of the base rendering of a seed. */
export function baseOptions(spec: HiddenSpec): RenderOptions {
  return { wording: spec.seed };
}

/** The render options of one transform of the base rendering. */
export function transformOptions(spec: HiddenSpec, transform: Transform): RenderOptions {
  const base = baseOptions(spec);
  switch (transform) {
    case 'permute':
      // The base order reversed: a different order for every specification with two sections or more.
      return { ...base, order: baseOrder(spec, base.wording).reverse() };
    case 'split':
      return { ...base, split: true };
    case 'synonym':
      return { ...base, synonyms: true };
    case 'decoy':
      return { ...base, extraDecoys: 3 };
  }
}

/**
 * Two halves of a specification. The inventory and the tools stay whole in both (they are structured files,
 * not prose); the prose atoms split: the stages and their constraints, every other rule, every other persona
 * dimension (the customer types with their constraints), every other data dimension, every other flow
 * example; the language examples go with the language dimension, the prose deviation with the second half.
 */
export function halves(spec: HiddenSpec): [HiddenSpec, HiddenSpec] {
  const even = <T>(items: readonly T[], keep: 0 | 1) => items.filter((_, index) => index % 2 === keep);
  const half = (keep: 0 | 1): HiddenSpec => {
    const personas = even(spec.personas, keep);
    const personaIds = new Set(personas.map((dimension) => dimension.id));
    const flowPhrases = even(
      spec.phrases.filter((phrase) => phrase.dimension === 'flow'),
      keep,
    );
    return {
      ...spec,
      stages: keep === 0 ? spec.stages : [],
      stageConstraints: keep === 0 ? spec.stageConstraints : [],
      rules: even(spec.rules, keep),
      proseDeviation: keep === 1 ? spec.proseDeviation : null,
      personas,
      personaConstraints: personaIds.has('customer_type') ? spec.personaConstraints : [],
      data: even(spec.data, keep),
      phrases: [
        ...flowPhrases,
        ...spec.phrases.filter((phrase) => phrase.dimension !== 'flow' && personaIds.has(phrase.dimension)),
      ],
    };
  };
  return [half(0), half(1)];
}

/**
 * The specification with one more constraint: a kind of customer that never uses a channel, a pair no
 * constraint forbids yet. Null when every pair is already forbidden.
 */
export function withOneMoreConstraint(
  spec: HiddenSpec,
): { spec: HiddenSpec; added: HiddenConstraint } | null {
  const types = spec.personas.find((dimension) => dimension.id === 'customer_type')?.values ?? [];
  const taken = new Set(spec.personaConstraints.map((constraint) => constraint.id));
  const free = types
    .flatMap((type) => spec.channels.map((channel) => ({ type: type.id, channel })))
    .filter(({ type, channel }) => !taken.has(`customer_type=${type},channel=${channel}`));
  if (free.length === 0) return null;
  const { type, channel } = new Draw(mixSeed(spec.seed, 0x756e)).pick(free);
  const added: HiddenConstraint = {
    id: `customer_type=${type},channel=${channel}`,
    forbid: { customer_type: type, channel },
    anchor: { kind: 'type-never', type, channel },
  };
  return { spec: { ...spec, personaConstraints: [...spec.personaConstraints, added] }, added };
}
