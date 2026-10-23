/**
 * What a run lets execute. `estate`: the runtime runs the estate's own commands (its guards, its scripts), as a
 * real runtime does. `none`: no command of the estate runs; only the runtime stand-in itself does. A run under
 * `none` lacks the `execution` capability, so a check that needs an executed guard or script does not run.
 */
export const EXECUTION_POLICIES = ['estate', 'none'] as const;
export type ExecutionPolicy = (typeof EXECUTION_POLICIES)[number];

/** The variable a run sets for a runtime stand-in; its value is a policy. A stand-in that reads no policy runs. */
export const EXECUTION_POLICY_VARIABLE = 'DRIFTBENCH_EXECUTION';

/** The environment a run passes a stand-in so that it keeps the policy. The default policy passes nothing. */
export function executionEnvironment(policy: ExecutionPolicy): Record<string, string> {
  return policy === 'estate' ? {} : { [EXECUTION_POLICY_VARIABLE]: policy };
}
