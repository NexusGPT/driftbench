import type { UnitDecision } from '@agent-nexus/driftbench-generate';

/**
 * A generated unit spec (`specs/unit/**.yaml`), judged offline on what its guard, script or helper does on
 * the estate root as it is now. No outcome is recorded first: the spec's own Then says what must be seen.
 *
 * - A guard spec runs the guard on the payloads the generator wrote for it and reads its `expect.guards`
 *   entry: `count: 0` asks that the guard stay silent on every payload, `count: { min }` that one payload
 *   set it off (with `verdict: deny`, that one payload be denied). `rules.custom.guard_finished` asks that
 *   every run end within the guard's timeout; `rules.custom.guard_message` that a guard that blocks say why,
 *   in words that keep the output rules.
 * - A helper spec (`contract_alone`) needs the helper's agent file to give a system prompt: a body.
 * - A script spec runs the script with no argument and with its documented calls: a script that answers a
 *   documented call as it answers no argument does not read its arguments.
 *
 * Each judge returns the failing checks; an empty list is a pass.
 */

/** One run of a guard on one payload, as the runtime reads it. */
export type GuardObservation = {
  decision: UnitDecision;
  message?: string;
  output?: string;
  ms: number;
  timedOut: boolean;
};

export type GuardSpecThen = {
  /** The `expect.guards` entries of the spec. */
  guards: Array<{ name: string; verdict?: string; count?: number | { min?: number; max?: number } }>;
  /** The guard `rules.custom.guard_finished` names. */
  finished?: string;
  /** `rules.custom.guard_message`: the guard and the patterns its message must not match. */
  message?: { name: string; mustNot: string[] };
};

/** A guard is set off when it denies or asks, or says something: a message, or context on stdout. */
export function fired(run: GuardObservation): boolean {
  if (run.timedOut) return false;
  return (
    run.decision === 'deny' ||
    run.decision === 'ask' ||
    (run.message ?? '') !== '' ||
    (run.output ?? '') !== ''
  );
}

export function judgeGuardSpec(
  then: GuardSpecThen,
  guard: { name: string; timeoutMs: number },
  runs: readonly GuardObservation[],
): string[] {
  const failing: string[] = [];
  const own = then.guards.filter((entry) => entry.name === guard.name);
  if (runs.length === 0 && own.length > 0) return [`guards.${guard.name}: no payload to run the guard on`];
  const set = runs.filter(fired);
  for (const entry of own) {
    const count = entry.count ?? { min: 1 };
    if (count === 0 || (typeof count === 'object' && count.max === 0)) {
      if (set.length > 0) {
        const first = set[0] as GuardObservation;
        const said = first.message ?? first.output ?? '';
        failing.push(
          `guards.${guard.name}: fired on ${set.length} of ${runs.length} payloads, expected none (${first.decision}${said === '' ? '' : `: ${said.slice(0, 120)}`})`,
        );
      }
      continue;
    }
    if (set.length === 0) {
      failing.push(`guards.${guard.name}: fired on none of ${runs.length} payloads, expected at least one`);
      continue;
    }
    if (entry.verdict === 'deny' && !set.some((run) => run.decision === 'deny')) {
      failing.push(`guards.${guard.name}: no payload was denied, expected a deny`);
    }
  }
  if (then.finished === guard.name) {
    for (const run of runs) {
      if (run.timedOut) {
        failing.push(`custom.guard_finished: a run was cut at the timeout of ${guard.timeoutMs} ms`);
        break;
      }
      if (run.ms > guard.timeoutMs) {
        failing.push(
          `custom.guard_finished: a run took ${run.ms} ms, over the timeout of ${guard.timeoutMs} ms`,
        );
        break;
      }
    }
  }
  if (then.message?.name === guard.name) {
    for (const run of set) {
      if (run.decision === 'deny' && (run.message ?? '') === '') {
        failing.push('custom.guard_message: the guard blocked without saying why');
        break;
      }
      const broken = then.message.mustNot.find((pattern) => {
        try {
          return new RegExp(pattern).test(run.message ?? '');
        } catch {
          return false;
        }
      });
      if (broken !== undefined) {
        failing.push(`custom.guard_message: the message "${run.message}" matches ${broken}`);
        break;
      }
    }
  }
  return failing;
}

/** A helper alone: its agent file must hold a body, the system prompt a headless run starts from. */
export function judgeHelperSpec(
  name: string,
  helper: { name: string; description?: string; body: string } | undefined,
): string[] {
  if (!helper) return [`contract_alone: the estate holds no helper ${name}`];
  if (helper.body.trim() === '') {
    return [`contract_alone: the agent file of ${name} holds no body to run as its system prompt`];
  }
  return [];
}

export type ScriptObservation = { args: string[]; exitCode: number; message?: string; output?: string };

/**
 * A script on its minimal fixtures. It fails when it does not run at all, or when a documented call ends
 * exactly as the call with no argument does while that call fails: the script then reads no argument.
 */
export function judgeScriptSpec(runs: readonly ScriptObservation[]): string[] {
  const missing = runs.find((run) => run.exitCode === 126 || run.exitCode === 127);
  if (missing) return [`script_fixture: the script did not run (exit ${missing.exitCode})`];
  const bare = runs.find((run) => run.args.length === 0);
  if (!bare || bare.exitCode === 0) return [];
  for (const run of runs) {
    if (run.args.length === 0) continue;
    if (
      run.exitCode === bare.exitCode &&
      (run.message ?? '') === (bare.message ?? '') &&
      (run.output ?? '') === (bare.output ?? '')
    ) {
      return [
        `script_fixture: the call with ${run.args.join(' ')} ends as the call with no argument does (exit ${run.exitCode}): the script does not read its arguments`,
      ];
    }
  }
  return [];
}
