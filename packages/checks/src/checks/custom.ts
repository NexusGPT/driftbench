import { type Check, type CheckContext, machineVerdict, Verdict } from '@agent-nexus/driftbench-core';
import { message } from '../support/assert';
import { show } from '../support/values';

const NAME = 'custom';

/**
 * A check written in TypeScript and registered by name. It receives the block's context and the value the
 * spec gives its name under `rules.custom`, and returns one verdict, a list, or a promise of either. An
 * empty list means the check has nothing to say about this block.
 */
export type CustomCheckFunction = (
  ctx: CheckContext,
  options: unknown,
) => Verdict | Verdict[] | Promise<Verdict | Verdict[]>;

/** The checks a spec can name under `rules.custom`. */
export class CheckRegistry {
  readonly #checks = new Map<string, CustomCheckFunction>();

  /** Registers a check. A name registered twice is an error: unregister it first to replace it. */
  register(name: string, check: CustomCheckFunction): this {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error(
        `a custom check name takes letters, digits, dots, underscores and hyphens: ${show(name)}`,
      );
    }
    if (this.#checks.has(name)) throw new Error(`a custom check named ${name} is already registered`);
    this.#checks.set(name, check);
    return this;
  }

  unregister(name: string): boolean {
    return this.#checks.delete(name);
  }

  get(name: string): CustomCheckFunction | undefined {
    return this.#checks.get(name);
  }

  names(): string[] {
    return [...this.#checks.keys()].sort();
  }
}

/** The registry `defaultChecks()` resolves `rules.custom` from, unless it is given another one. */
export const defaultRegistry = new CheckRegistry();

/** Registers a check in the default registry. */
export function registerCheck(name: string, check: CustomCheckFunction): void {
  defaultRegistry.register(name, check);
}

/**
 * The custom check: runs every check `rules.custom` names, on every block. Its verdicts are machine
 * verdicts with ids under `custom.<name>`. A name nobody registered, a check that throws, or a return
 * value that is not a verdict is a failed verdict that says so.
 */
export function createCustomCheck(registry: CheckRegistry = defaultRegistry): Check {
  return {
    name: NAME,
    applies: (ctx) => Object.keys(ctx.spec.rules?.custom ?? {}).length > 0,
    async evaluate(ctx) {
      const out: Verdict[] = [];
      for (const [name, options] of Object.entries(ctx.spec.rules?.custom ?? {})) {
        const check = registry.get(name);
        if (!check) {
          const known = registry.names();
          out.push(
            machineVerdict(
              NAME,
              name,
              'fail',
              `rules.custom names ${name}, but no check of that name is registered (registered: ${known.length === 0 ? 'none' : known.join(', ')})`,
            ),
          );
          continue;
        }
        let result: Verdict | Verdict[];
        try {
          result = await check(ctx, options);
        } catch (cause) {
          out.push(machineVerdict(NAME, name, 'fail', `the custom check ${name} threw: ${message(cause)}`));
          continue;
        }
        out.push(...adopt(name, Array.isArray(result) ? result : [result]));
      }
      return out;
    },
  };
}

export const custom: Check = createCustomCheck();

/** Validates what a custom check returned and files it under `custom.<name>`, as a machine verdict. */
function adopt(name: string, results: unknown[]): Verdict[] {
  return results.map((value, index) => {
    const parsed = Verdict.safeParse(value);
    if (!parsed.success) {
      const problem = parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'value'} ${issue.message}`,
      );
      return machineVerdict(
        NAME,
        results.length === 1 ? name : `${name}.${index}`,
        'fail',
        `the custom check ${name} returned something that is not a verdict: ${problem.join('; ')}`,
      );
    }
    const verdict = parsed.data;
    const id =
      verdict.id === name || verdict.id.startsWith(`${name}.`)
        ? `${NAME}.${verdict.id}`
        : `${NAME}.${name}.${verdict.id}`;
    return {
      id,
      kind: 'machine',
      name: verdict.name,
      gating: verdict.gating,
      outcome: verdict.outcome,
      evidence: verdict.evidence,
      ...(verdict.score === undefined ? {} : { score: verdict.score }),
      ...(verdict.reasoning === undefined ? {} : { reasoning: verdict.reasoning }),
    };
  });
}
