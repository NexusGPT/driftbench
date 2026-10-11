import { z } from 'zod';

/**
 * The map of situations an agent can face, written by hand in `space.yaml` beside the agent's behaviour
 * inventory. Each dimension lists the values one axis of an interaction can take; a cell is one value per
 * dimension; the constraints name the impossible cells; the prior is the user mix over the values. Code
 * enumerates every cell from this declaration, never a model.
 */

/**
 * The reserved value id that collects whatever declares no value of a dimension: a block that carries no
 * deviation, a spec with no `persona:` tag, a block with no `expect.stage`. A map lists it only where that
 * situation is a cell of its own.
 */
export const NONE = 'none';

/** A dimension or value id: a letter or digit, then letters, digits, dots, underscores and hyphens. */
export const SpaceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
  error: 'expected an id: a letter or digit, then letters, digits, dots, underscores or hyphens',
});

/** What a dimension varies on. The kind decides how a spec is placed on it; see `placeSpec`. */
export const DimensionKind = z
  .enum(['stage', 'behaviour', 'deviation', 'persona', 'channel', 'data', 'task'])
  .describe(
    'stage, behaviour, deviation, persona, channel, data or task. The kind decides how a spec is placed on the dimension.',
  );
export type DimensionKind = z.infer<typeof DimensionKind>;

export const SpaceValue = z
  .strictObject({
    id: SpaceId.describe(
      'The value id. Specs name it: a stage, a behaviour id, a deviation class, a tag value.',
    ),
    title: z.string().min(1).describe('What the value means, in plain words.'),
    weight: z
      .number()
      .min(0)
      .optional()
      .describe(
        'The share of users with this value, relative to the other values of the dimension. Give it to every value of the dimension or to none.',
      ),
    required: z
      .boolean()
      .optional()
      .describe(
        'True when the value must be covered. The required values of all dimensions combine into required cells.',
      ),
  })
  .describe('One value of a dimension.');
export type SpaceValue = z.infer<typeof SpaceValue>;

export const SpaceDimension = z
  .strictObject({
    id: SpaceId.describe('The dimension id. Constraints and prior weights name it.'),
    title: z.string().min(1).describe('What the dimension varies on.'),
    kind: DimensionKind,
    values: z.array(SpaceValue).min(1).describe('The values, in the order reports list them. At least one.'),
  })
  .describe('One axis an interaction varies on.');
export type SpaceDimension = z.infer<typeof SpaceDimension>;

export const SpaceConstraint = z
  .strictObject({
    forbid: z
      .record(z.string(), z.string())
      .describe(
        'A partial cell, as dimension id to value id. Every cell holding all of these values is impossible.',
      ),
    reason: z
      .string()
      .min(1)
      .describe('Why these values never occur together. The list is a claim the report shows.'),
  })
  .describe('An impossible combination of values.');
export type SpaceConstraint = z.infer<typeof SpaceConstraint>;

export const SpacePrior = z
  .strictObject({
    kind: z
      .enum(['declared', 'fitted'])
      .describe(
        'declared: the owner wrote the weights. fitted: they were fitted from consented conversations.',
      ),
    source: z
      .string()
      .min(1)
      .optional()
      .describe('Where the weights come from. Required for a fitted prior.'),
    weights: z
      .record(z.string(), z.record(z.string(), z.number().min(0)))
      .optional()
      .describe(
        'Weights by dimension id, then value id. They replace the weights written on the values of a dimension listed here; list every value of it.',
      ),
  })
  .describe('The user mix over the values. Without any weight, every value of a dimension weighs the same.');
export type SpacePrior = z.infer<typeof SpacePrior>;

export const SpaceMap = z
  .strictObject({
    version: z.string().min(1).describe('A label for this version of the map.'),
    agent: z.string().min(1).describe('The agent the map describes.'),
    inventory: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The behaviour inventory, as a path relative to this file. Its required flow deviations become required cells.',
      ),
    dimensions: z
      .array(SpaceDimension)
      .min(1)
      .describe('The axes, in the order reports list them. At least one.'),
    constraints: z
      .array(SpaceConstraint)
      .describe('The impossible combinations. An empty list states that every combination can occur.'),
    prior: SpacePrior,
  })
  .describe('The declared map of situations an agent can face: dimensions, constraints and a prior.');
export type SpaceMap = z.infer<typeof SpaceMap>;
