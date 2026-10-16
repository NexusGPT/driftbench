/**
 * The exit of a command that gates a pipeline (campaign run and resume, as ci, campaign rejudge and family
 * verify): 0 when everything passes, 1 when something fails, failed or was stopped, and 3 when nothing did but
 * something was not run or blocked. A block not run is no pass and no failure of the agent.
 */
export function gateExit(states: readonly string[]): number {
  if (states.every((state) => state === 'pass')) return 0;
  return states.every((state) => state === 'pass' || state === 'not_run' || state === 'blocked') ? 3 : 1;
}
