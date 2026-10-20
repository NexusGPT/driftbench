import type { View } from './view';

/**
 * Which partial rows can be completed into a row no constraint forbids. A partial row is one value index per
 * variable, -1 where the variable is not set. Constraints are the impossible combinations of the view: a row is
 * forbidden when it holds every entry of one of them. Only variables that some constraint names can make a
 * completion fail, so the search runs over those and leaves the others free.
 *
 * The search keeps, as the row changes, how many entries of each constraint the row holds and, for each value of
 * each variable, how many constraints the row already turns against it (all their other entries held). Setting or
 * clearing one variable then touches only the constraints that name it, and a variable's free values are counted
 * rather than found by a scan of its constraints.
 */

/** The most search steps one question may take before the planner gives up and says so. */
export const MAX_SOLVER_STEPS = 500_000;

/** Counts the steps the solver takes (constraints and variables looked at), so a test can check how the work grows. */
export const counters = { work: 0 };

/** A row with the counts of its constraints kept up to date as variables are set and cleared. */
export class Frontier {
  /** Entries held per constraint. */
  private readonly held: Int32Array;
  /** Per variable, per value: constraints whose other entries are all held. Offsets in `at`. */
  private readonly blocked: Int32Array;
  /** Per variable: values no constraint blocks. */
  private readonly free: Int32Array;
  private violated = 0;
  private steps = 0;
  /**
   * A full row no constraint forbids that agrees with every variable set so far, or null when none is known.
   * Setting a variable to the value the witness holds keeps it; to another value, the witness is kept when only
   * the constraints that name that variable could fire and none does. A candidate value is then answered from
   * the witness without a search.
   */
  private witness: Int16Array | null = null;

  constructor(
    private readonly solver: Solver,
    readonly row: Int16Array,
  ) {
    const { view } = solver;
    this.held = new Int32Array(view.constraints.length);
    this.blocked = new Int32Array(solver.offsets[view.variables.length] as number);
    this.free = Int32Array.from(view.variables, (variable) => variable.values.length);
    view.constraints.forEach((constraint, at) => {
      counters.work += 1;
      let count = 0;
      constraint.variables.forEach((variable, position) => {
        if (row[variable] === constraint.values[position]) count += 1;
      });
      this.held[at] = count;
      if (count === constraint.variables.length) this.violated += 1;
      else if (count === constraint.variables.length - 1) this.block(at, 1);
    });
  }

  /** Whether the row, as far as it is set, already holds every entry of a constraint. */
  get violates(): boolean {
    return this.violated > 0;
  }

  /** Blocks (or frees) the value of the one entry of the constraint that the row does not hold. */
  private block(at: number, step: 1 | -1): void {
    const constraint = this.solver.view.constraints[at];
    if (!constraint) return;
    const { offsets } = this.solver;
    for (let position = 0; position < constraint.variables.length; position += 1) {
      const variable = constraint.variables[position] as number;
      const value = constraint.values[position] as number;
      if (this.row[variable] === value) continue;
      const cell = (offsets[variable] as number) + value;
      const before = this.blocked[cell] as number;
      this.blocked[cell] = before + step;
      if (step === 1 && before === 0) this.free[variable] = (this.free[variable] as number) - 1;
      if (step === -1 && before === 1) this.free[variable] = (this.free[variable] as number) + 1;
      return;
    }
  }

  /**
   * Sets a variable that is not set yet. A constraint with one entry short blocks that entry's value; when the
   * entry set here was the one short, the constraint holds all its entries, blocks nothing and forbids the row.
   */
  set(variable: number, value: number): void {
    if (this.witness && this.witness[variable] !== value) {
      if (this.keepsWitness(variable, value)) this.witness[variable] = value;
      else this.witness = null;
    }
    const entries = this.solver.entriesOf[variable] ?? [];
    for (const entry of entries) {
      counters.work += 1;
      if (entry.value !== value) continue;
      if (this.held[entry.constraint] === this.solver.sizeOf(entry.constraint) - 1) {
        this.block(entry.constraint, -1);
        this.violated += 1;
      }
    }
    this.row[variable] = value;
    for (const entry of entries) {
      if (entry.value !== value) continue;
      const count = (this.held[entry.constraint] as number) + 1;
      this.held[entry.constraint] = count;
      if (count === this.solver.sizeOf(entry.constraint) - 1) this.block(entry.constraint, 1);
    }
  }

  /** Clears a variable that `set` set: the exact reverse. */
  clear(variable: number): void {
    const value = this.row[variable] as number;
    const entries = this.solver.entriesOf[variable] ?? [];
    for (const entry of entries) {
      counters.work += 1;
      if (entry.value !== value) continue;
      if (this.held[entry.constraint] === this.solver.sizeOf(entry.constraint) - 1)
        this.block(entry.constraint, -1);
    }
    this.row[variable] = -1;
    for (const entry of entries) {
      if (entry.value !== value) continue;
      const count = this.held[entry.constraint] as number;
      if (count === this.solver.sizeOf(entry.constraint)) {
        this.violated -= 1;
        this.block(entry.constraint, 1);
      }
      this.held[entry.constraint] = count - 1;
    }
  }

  /** The values of an unset variable that no constraint turns impossible, given the values already set. */
  allowed(variable: number): number[] {
    const out: number[] = [];
    const base = this.solver.offsets[variable] as number;
    const count = this.solver.view.variables[variable]?.values.length ?? 0;
    for (let value = 0; value < count; value += 1) if (this.blocked[base + value] === 0) out.push(value);
    return out;
  }

  /** Whether the row, with the variable set to the value, can be completed into a row that breaks no constraint. */
  completes(variable: number, value: number): boolean {
    if (
      !this.violates &&
      this.witness &&
      (this.witness[variable] === value || this.keepsWitness(variable, value))
    )
      return true;
    this.set(variable, value);
    const ok = !this.violates && this.finish();
    this.clear(variable);
    return ok;
  }

  /** Whether the witness, with the variable at the value, still breaks no constraint (only its constraints can fire). */
  private keepsWitness(variable: number, value: number): boolean {
    const witness = this.witness as Int16Array;
    const { view } = this.solver;
    for (const entry of this.solver.entriesOf[variable] ?? []) {
      counters.work += 1;
      if (entry.value !== value) continue;
      const constraint = view.constraints[entry.constraint];
      if (!constraint) continue;
      let fires = true;
      for (let at = 0; at < constraint.variables.length; at += 1) {
        const other = constraint.variables[at] as number;
        if (other !== variable && witness[other] !== constraint.values[at]) {
          fires = false;
          break;
        }
      }
      if (fires) return false;
    }
    return true;
  }

  /** Whether the row as it is can be completed. */
  finish(): boolean {
    if (this.violates) return false;
    if (this.witness) return true;
    this.steps = 0;
    return this.search(this.solver.constrained.filter((variable) => this.row[variable] === -1));
  }

  private search(unset: number[]): boolean {
    if (unset.length === 0) {
      // Every constrained variable is set and no constraint fires: the others are free. Keep the row as the witness.
      this.witness = Int16Array.from(this.row, (value) => Math.max(value, 0));
      return true;
    }
    this.steps += 1;
    counters.work += unset.length;
    if (this.steps > MAX_SOLVER_STEPS)
      throw new RangeError(
        `the constraints are too tangled to complete a row within ${MAX_SOLVER_STEPS} steps: forbid fewer combinations`,
      );
    // The variable with the fewest values left decides first, so a dead end shows early.
    let pick = -1;
    let fewest = Number.POSITIVE_INFINITY;
    for (const variable of unset) {
      const left = this.free[variable] as number;
      if (left === 0) return false;
      if (left < fewest) {
        pick = variable;
        fewest = left;
      }
    }
    const options = this.allowed(pick);
    const rest = unset.filter((variable) => variable !== pick);
    for (const value of options) {
      this.set(pick, value);
      const found = !this.violates && this.search(rest);
      this.clear(pick);
      if (found) return true;
    }
    return false;
  }
}

type Entry = { constraint: number; value: number };

export class Solver {
  readonly constrained: number[];
  readonly view: View;
  /** Where the values of each variable start in a flat array of values. */
  readonly offsets: number[];
  /** Per variable: the constraints that name it, with the value each asks of it. */
  readonly entriesOf: Entry[][];

  constructor(view: View) {
    this.view = view;
    this.entriesOf = view.variables.map(() => []);
    view.constraints.forEach((constraint, at) => {
      constraint.variables.forEach((variable, position) => {
        this.entriesOf[variable]?.push({ constraint: at, value: constraint.values[position] as number });
      });
    });
    this.constrained = this.entriesOf.flatMap((list, at) => (list.length > 0 ? [at] : []));
    this.offsets = [0];
    for (const variable of view.variables)
      this.offsets.push((this.offsets.at(-1) as number) + variable.values.length);
  }

  sizeOf(constraint: number): number {
    return this.view.constraints[constraint]?.variables.length ?? 0;
  }

  /** A row (a copy of it) with its counts kept as variables are set and cleared. */
  frontier(row: Int16Array): Frontier {
    return new Frontier(this, Int16Array.from(row));
  }

  /** Whether the row, as far as it is set, already holds every entry of a constraint. */
  violates(row: Int16Array): boolean {
    return this.frontier(row).violates;
  }

  /** The values of an unset variable that no constraint turns impossible, given the values already set. */
  allowed(row: Int16Array, variable: number): number[] {
    return this.frontier(row).allowed(variable);
  }

  /** Whether the partial row can be completed into a row that breaks no constraint. */
  canComplete(partial: Int16Array): boolean {
    return this.frontier(partial).finish();
  }
}
