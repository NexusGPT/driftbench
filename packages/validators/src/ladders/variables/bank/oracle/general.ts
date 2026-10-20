import type { Plan } from '../../interface';
import { combinations } from '../util';
import type { Space, SpaceGroup } from './space';

/**
 * A brute-force reference for spaces whose impossible combinations are not only pairs: any list of (variable,
 * value) cells is a combination that never occurs (docs/variables.md "Impossible combinations"). Small spaces
 * only: it walks every full row. It shares nothing with the pair model of SpaceOracle.
 */
export class GeneralOracle {
  private rows: number[][] | undefined;

  constructor(
    readonly space: Space,
    /** Each entry: the cells of one combination. A row holding all of them is impossible. */
    readonly forbids: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
  ) {}

  private holds(row: readonly number[]): boolean {
    for (const cells of this.forbids) if (cells.every(([v, x]) => row[v] === x)) return true;
    return this.space.forbidden.some(([a, va, b, vb]) => row[a] === va && row[b] === vb);
  }

  validRows(): number[][] {
    if (this.rows) return this.rows;
    const out: number[][] = [];
    const n = this.space.vars.length;
    const cur = new Array<number>(n).fill(0);
    const go = (i: number): void => {
      if (i === n) {
        if (!this.holds(cur)) out.push([...cur]);
        return;
      }
      for (let x = 0; x < (this.space.vars[i]?.values.length ?? 0); x += 1) {
        cur[i] = x;
        go(i + 1);
      }
    };
    go(0);
    this.rows = out;
    return out;
  }

  /** The value indexes that no valid row holds: a value the combinations make unreachable. */
  unreachable(): Array<[number, number]> {
    const seen = new Set<string>();
    for (const row of this.validRows()) for (const [v, x] of row.entries()) seen.add(`${v}:${x}`);
    const out: Array<[number, number]> = [];
    this.space.vars.forEach((variable, v) => {
      variable.values.forEach((_, x) => {
        if (!seen.has(`${v}:${x}`)) out.push([v, x]);
      });
    });
    return out;
  }

  /** The problems of a plan without seeds: shape, impossible rows, and every allowed required tuple covered. */
  check(plan: Plan, groups: readonly SpaceGroup[]): string[] {
    const problems: string[] = [];
    const names = this.space.vars.map((v) => v.id);
    const rows: number[][] = [];
    plan.rows.forEach((row, i) => {
      const keys = Object.keys(row.values);
      if (keys.length !== names.length || !names.every((k) => k in row.values)) {
        problems.push(`row ${i} should assign exactly the ${names.length} variables`);
        return;
      }
      const idx = this.space.vars.map((v, k) => v.values.indexOf(row.values[names[k] as string] as string));
      if (idx.some((x) => x < 0)) {
        problems.push(`row ${i} holds a value the store does not list`);
        return;
      }
      if (this.holds(idx))
        problems.push(`row ${i} holds an impossible combination: ${JSON.stringify(row.values)}`);
      rows.push(idx);
    });
    if (problems.length > 0) return problems.slice(0, 5);
    const valid = this.validRows();
    let missing = 0;
    let example = '';
    for (const g of groups) {
      const t = Math.min(g.strength, g.vars.length);
      for (const pick of combinations(g.vars.length, t)) {
        const subset = pick.map((k) => g.vars[k] as number);
        const allowed = new Set(valid.map((r) => subset.map((v) => r[v]).join(',')));
        const held = new Set(rows.map((r) => subset.map((v) => r[v]).join(',')));
        for (const key of allowed) {
          if (!held.has(key)) {
            missing += 1;
            if (!example)
              example = subset
                .map((v, k) => `${names[v]}=${this.space.vars[v]?.values[Number(key.split(',')[k])]}`)
                .join(' ');
          }
        }
      }
    }
    if (missing > 0)
      problems.push(`${missing} allowed required tuples are not covered, for example ${example}`);
    return problems;
  }
}
