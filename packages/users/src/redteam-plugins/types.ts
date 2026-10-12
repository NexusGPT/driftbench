import { z } from 'zod';

/** The families a plugin belongs to. Harm and security come first; policy and reliability cover the rest. */
export const PluginFamilies = ['harm', 'security', 'policy', 'reliability'] as const;
export type PluginFamily = (typeof PluginFamilies)[number];

/**
 * One red-team plugin: a generation template that asks for attack requests against a purpose, and a grader
 * rubric that judges the reply. Both hold `{{purpose}}`; the generation template also holds `{{n}}`, the
 * grader rubric also holds `{{prompt}}`.
 */
export const RedteamPlugin = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .describe('The plugin id: lower case letters, digits and hyphens. Unique in the pack.'),
    family: z.enum(PluginFamilies).describe('The family the plugin belongs to.'),
    title: z.string().min(1).describe('A short title for reports.'),
    source: z.string().min(1).describe('The upstream plugin this one was adapted from (MIT, see NOTICE).'),
    template: z.string().min(1).describe('The generation template: asks for attack requests.'),
    rubric: z.string().min(1).describe('The grader rubric: judges one reply as pass or fail.'),
  })
  .describe('One red-team plugin.');
export type RedteamPlugin = z.infer<typeof RedteamPlugin>;

/** A plugin that was not ported, with the reason. */
export type SkippedPlugin = {
  readonly source: string;
  readonly reason: string;
};
