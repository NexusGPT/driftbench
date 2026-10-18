import { z } from 'zod';

/**
 * The `campaign:` key of the project config (`driftbench.yaml`): the settings of `driftbench campaign run`,
 * each a plain mapping onto the flag it names. A flag given on the command line wins over the file.
 */

const Whole = (min: number) => z.number().int().min(min);

export const CampaignRetryConfig = z
  .strictObject({
    max_attempts: Whole(1)
      .optional()
      .describe('Attempts per model call, the first included: --retry-attempts.'),
    base_delay_ms: Whole(0)
      .optional()
      .describe('The wait before the first retry, doubled for each later one: --retry-base-ms.'),
    max_delay_ms: Whole(0).optional().describe('The longest wait between two attempts: --retry-max-ms.'),
  })
  .describe('How model calls are retried, over the retry settings of the spec target.');

export const CampaignConfig = z
  .strictObject({
    specs: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        'Spec files or folders, read from the working folder. Used by campaign run when the command line names none.',
      ),
    dataset: z
      .string()
      .min(1)
      .optional()
      .describe('A dataset version of the store to run, name or name@version: --dataset.'),
    prompts: z
      .array(z.string().min(1))
      .optional()
      .describe(
        'Prompt versions of the store to record, each name or name@version: --prompt, once per item.',
      ),
    targets: z
      .array(z.string().min(1))
      .optional()
      .describe('The targets every spec runs on, each adapter or adapter:agent: --target, once per item.'),
    routes: z
      .array(z.string().min(1))
      .optional()
      .describe('Targets by spec tag, each tag=target: --route, once per item.'),
    modes: z
      .array(z.enum(['T', 'F', 'P']))
      .min(1)
      .optional()
      .describe('The run modes, such as [T, F]: --mode.'),
    repeats: Whole(1).optional().describe('Runs per spec, target and mode: --repeats.'),
    agent_version: z
      .string()
      .min(1)
      .optional()
      .describe('The version of the agent under test: --agent-version.'),
    store: z
      .string()
      .min(1)
      .optional()
      .describe('The store file the campaign is kept in, read from the working folder: --store.'),
    cache: z
      .boolean()
      .optional()
      .describe('False neither replays runs from the cache nor writes to it: --no-cache. campaign run only.'),
    cache_suite: z.string().min(1).optional().describe('The cache suite of the campaign: --cache-suite.'),
    concurrency: Whole(1).optional().describe('Cells that run at the same time: --concurrency.'),
    budget_usd: z.number().min(0).optional().describe("A hard stop on the campaign's spend: --budget-usd."),
    process_command: z
      .string()
      .min(1)
      .optional()
      .describe('The command that runs the agent of a process target: --process-command.'),
    driver: z
      .enum(['scripted', 'simulated'])
      .optional()
      .describe("Who writes the user turns, the spec's own script or a persona: --driver."),
    personas: z
      .array(z.string().min(1))
      .optional()
      .describe('With the simulated driver, persona files: --persona, once per item.'),
    recordings: z
      .array(z.string().min(1))
      .optional()
      .describe('With the simulated driver, recordings to replay: --recording, once per item.'),
    model: z
      .boolean()
      .optional()
      .describe('With the simulated driver, true speaks through the model port, a paid call: --model.'),
    agent_family: z
      .string()
      .min(1)
      .optional()
      .describe('The model family of the agent under test: --agent-family.'),
    judge_families: z
      .array(z.string().min(1))
      .optional()
      .describe('The model families of the judges: --judge-family, once per item.'),
    retry: CampaignRetryConfig.optional(),
  })
  .describe(
    'The settings of a campaign, each the flag of campaign run it names. A flag on the command line wins over the file.',
  );
export type CampaignConfig = z.infer<typeof CampaignConfig>;
