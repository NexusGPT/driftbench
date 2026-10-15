import type { Spec } from '@agent-nexus/driftbench-core';
import { observeUnitTests, type UnitRunOptions } from '@agent-nexus/driftbench-estate';
import { type UnitOutcome, UnitTest } from '@agent-nexus/driftbench-generate';
import type { UnitContract } from './estate-unit';

/** Executes only explicit operations. The user ask is never parsed into shell commands or hook payloads. */
export async function runUnitSpecs(
  specs: readonly Spec[],
  options: UnitRunOptions,
): Promise<UnitContract & { inputErrors: string[] }> {
  const contract: UnitContract = { runs: [], guards: [], scripts: [] };
  const inputErrors: string[] = [];
  for (const spec of specs) {
    const estate = spec.metadata?.estate as Record<string, unknown> | undefined;
    const operation = estate?.unit as
      | { target?: Record<string, unknown>; cases?: unknown[]; budgetMs?: number }
      | undefined;
    const failing: string[] = [];
    const invalid = (reason: string) => {
      failing.push(reason);
      inputErrors.push(`${spec.id}: ${reason}`);
    };
    const finish = () => contract.runs.push({ spec: spec.id, pass: failing.length === 0, failing });
    if (estate?.mode !== 'unit') {
      invalid('the spec is not declared for unit execution');
      finish();
      continue;
    }
    if (spec.blocks.length !== 1) {
      invalid('a unit operation needs one block; use separate specs for separate operations');
      finish();
      continue;
    }
    if (operation?.target?.kind === 'subagent') {
      invalid('a helper needs a configured executor; its prompt alone is not an executed test');
      finish();
      continue;
    }
    if (!operation?.target) {
      invalid('metadata.estate.unit declares no executable operation');
      finish();
      continue;
    }
    const { verdict: _declared, ...target } = operation.target;
    const parsed = UnitTest.safeParse({
      id: spec.id,
      planRow: typeof estate?.planRow === 'string' ? estate.planRow : spec.id,
      atom: Array.isArray(estate?.atoms) ? estate.atoms[0] : spec.id,
      title: spec.title,
      mapHash: typeof estate?.mapHash === 'string' ? estate.mapHash : (spec.version ?? spec.id),
      testType:
        target.kind === 'script'
          ? 'script_fixture'
          : estate?.testType === 'guard_register'
            ? 'guard_positive'
            : estate?.testType,
      target,
      cases: operation.cases ?? [],
      ...(operation.budgetMs !== undefined ? { budgetMs: operation.budgetMs } : {}),
    });
    if (!parsed.success) {
      invalid(`invalid unit operation: ${parsed.error.issues[0]?.message}`);
      finish();
      continue;
    }
    const test = parsed.data;
    const run = await observeUnitTests([test], options);
    const observed = run.observations[0];
    if (observed?.error) failing.push(observed.error);
    if (!observed || (observed.cases.length === 0 && !observed.error))
      invalid('the unit operation executed no case');
    for (const entry of observed?.cases ?? []) {
      if (entry.timedOut) failing.push(`${entry.id}: timed out`);
      if (operation.budgetMs !== undefined && entry.ms > operation.budgetMs)
        failing.push(`${entry.id}: exceeded ${operation.budgetMs} ms`);
      const expected = test.cases.find((c) => c.id === entry.id)?.expected;
      if (expected) {
        for (const key of ['decision', 'exitCode', 'message', 'output'] as const) {
          if (expected[key] !== undefined && expected[key] !== entry.outcome[key])
            failing.push(`${entry.id}: ${key} differs from the declared outcome`);
        }
      }
      if (test.target.kind === 'guard') {
        contract.guards.push({
          guard: test.target.name,
          event: test.target.event,
          decision: entry.outcome.decision === 'error' ? 'allow' : entry.outcome.decision,
          ...(entry.outcome.message !== undefined ? { message: entry.outcome.message } : {}),
          ms: Math.round(entry.ms),
        });
      } else {
        contract.scripts.push({
          script: test.target.path,
          exit: entry.outcome.exitCode,
          stdout: entry.outcome.output ?? '',
        });
      }
    }
    if (test.target.kind === 'guard') {
      const name = test.target.name;
      const outcomes = (observed?.cases ?? []).map((c) => c.outcome);
      const active = outcomes.filter(
        (outcome) =>
          outcome.decision !== 'allow' || outcome.message !== undefined || outcome.output !== undefined,
      );
      const verdictOf = (outcome: UnitOutcome) => {
        if (outcome.decision === 'deny' || outcome.decision === 'ask') return outcome.decision;
        if (outcome.decision === 'error') return 'warn';
        return outcome.output !== undefined ? 'nudge' : undefined;
      };
      let assertions = 0;
      for (const block of spec.blocks) {
        for (const expect of block.expect?.guards ?? []) {
          if (expect.name !== name) continue;
          assertions++;
          const count = active.filter(
            (o) => expect.verdict === undefined || verdictOf(o) === expect.verdict,
          ).length;
          const wanted = expect.count;
          const holds =
            typeof wanted === 'number'
              ? count === wanted
              : count >= (wanted === undefined ? 1 : (wanted.min ?? 0)) &&
                (wanted?.max === undefined || count <= wanted.max);
          if (!holds)
            failing.push(
              `${name}: ${count} matching guard decisions; expected ${JSON.stringify(wanted ?? { min: 1 })}${expect.verdict ? ` with verdict ${expect.verdict}` : ''}`,
            );
        }
      }
      const custom = spec.rules?.custom ?? {};
      for (const [key, value] of Object.entries(custom)) {
        if (key !== 'guard_message' && key !== 'guard_finished') {
          invalid(`unit runner does not evaluate custom check ${key}`);
          continue;
        }
        const check = value as { name?: string; mustNot?: string[]; must?: string[] };
        if (check.name !== name) continue;
        assertions++;
        if (key === 'guard_message') {
          const messages = active.map((o) => o.message ?? o.output ?? '');
          if (!messages.length || messages.some((m) => !m))
            failing.push(`${name}: no message from an active guard`);
          for (const pattern of check.mustNot ?? [])
            if (messages.some((m) => new RegExp(pattern, 'm').test(m)))
              failing.push(`${name}: message matches forbidden pattern ${pattern}`);
          for (const pattern of check.must ?? [])
            if (messages.some((m) => !new RegExp(pattern, 'm').test(m)))
              failing.push(`${name}: message lacks required pattern ${pattern}`);
        }
      }
      if (!assertions && !test.cases.some((c) => c.expected))
        invalid('the guard spec declares no outcome assertion');
    } else {
      // A process merely starting is not an oracle: require a declared fixture or an explicit exit/output.
      const expects = spec.blocks.flatMap((b) => (b.expect?.execution ? [b.expect.execution] : []));
      for (const expect of expects) {
        if (
          expect.exit_code !== undefined &&
          observed?.cases.some((c) => c.outcome.exitCode !== expect.exit_code)
        )
          failing.push(`script exit differs from ${expect.exit_code}`);
      }
      if (
        !observed?.declared &&
        !test.cases.some((c) => c.expected) &&
        !expects.some((e) => e.exit_code !== undefined)
      )
        invalid('the script spec declares no expected exit or output; record its fixtures first');
    }
    finish();
  }
  return { ...contract, inputErrors };
}
