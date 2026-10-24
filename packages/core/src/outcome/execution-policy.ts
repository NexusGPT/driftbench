/**
 * What a run lets execute. `estate`: the runtime runs the estate's own commands (its guards, its scripts), as a
 * real runtime does. `none`: the run tells the stand-in to start no command of the estate. Only a stand-in that
 * declares it keeps the policy (`@driftbench-execution-policy` in its first lines) is given it; the run does not
 * change what a check makes of a guard that gave no answer.
 */
export const EXECUTION_POLICIES = ['estate', 'none'] as const;
export type ExecutionPolicy = (typeof EXECUTION_POLICIES)[number];

/** The variable a run sets for a runtime stand-in; its value is a policy. */
export const EXECUTION_POLICY_VARIABLE = 'DRIFTBENCH_EXECUTION';

/** The environment a run passes a stand-in so that it keeps the policy. The default policy passes nothing. */
export function executionEnvironment(policy: ExecutionPolicy): Record<string, string> {
  return policy === 'estate' ? {} : { [EXECUTION_POLICY_VARIABLE]: policy };
}
