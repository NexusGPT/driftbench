import { countVariableTuples, type TupleGroup, type VariableStore } from '@agent-nexus/driftbench-space';
import { describe, expect, it } from 'vitest';

/** A store of variables v0, v1, ... with the given arities (values x0, x1, ...) and constraints given as cell lists. */
function storeOf(
  arities: readonly number[],
  forbids: ReadonlyArray<Record<string, string>> = [],
  flags: { unapproved?: Record<string, string[]> } = {},
): VariableStore {
  return {
    format: 1,
    agent: 'count',
    version: '1',
    variables: arities.map((arity, i) => ({
      id: `v${i}`,
      title: `v${i}`,
      kind: 'data',
      role: 'axis',
      approved: true,
      values: Array.from({ length: arity }, (_, j) => ({
        id: `x${j}`,
        title: `x${j}`,
        ...((flags.unapproved?.[`v${i}`] ?? []).includes(`x${j}`) ? { approved: false } : {}),
      })),
    })),
    constraints: forbids.map((forbid) => ({ forbid, reason: 'test', approved: true })),
  } as unknown as VariableStore;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);

/** Seeded draws, so a failure replays. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The reference: every valid full row by enumeration, then the distinct tuples of each group's subsets. */
function brute(
  arities: readonly number[],
  forbids: ReadonlyArray<Record<string, string>>,
  rows: ReadonlyArray<Record<string, string>>,
  groups: readonly TupleGroup[],
) {
  const names = ids(arities.length);
  const valid: number[][] = [];
  const cur: number[] = [];
  const go = (i: number) => {
    if (i === arities.length) {
      const row = Object.fromEntries(cur.map((j, k) => [names[k], `x${j}`]));
      const bad = forbids.some((f) => Object.entries(f).every(([name, id]) => row[name] === id));
      if (!bad) valid.push([...cur]);
      return;
    }
    for (let j = 0; j < (arities[i] as number); j += 1) {
      cur[i] = j;
      go(i + 1);
    }
  };
  go(0);
  const subsetsOf = (group: TupleGroup): number[][] => {
    const members = group.variables.map((name) => names.indexOf(name)).sort((a, b) => a - b);
    const m = Math.min(group.strength, members.length);
    const out: number[][] = [];
    const pick = (from: number, chosen: number[]) => {
      if (chosen.length === m) {
        out.push(chosen);
        return;
      }
      for (let i = from; i < members.length; i += 1) pick(i + 1, [...chosen, members[i] as number]);
    };
    pick(0, []);
    return out;
  };
  const allowed = new Set<string>();
  for (const group of groups) {
    for (const subset of subsetsOf(group)) {
      for (const row of valid) allowed.add(`${subset.join(',')}|${subset.map((v) => row[v]).join(',')}`);
    }
  }
  const covered = new Set<string>();
  for (const group of groups) {
    for (const subset of subsetsOf(group)) {
      for (const row of rows) {
        const values = subset.map((v) => row[names[v] as string]);
        if (values.every((value) => value !== undefined)) {
          const key = `${subset.join(',')}|${values.map((value) => (value as string).slice(1)).join(',')}`;
          if (allowed.has(key)) covered.add(key);
        }
      }
    }
  }
  return { allowed: allowed.size, covered: covered.size };
}

describe('countVariableTuples: the allowed count', () => {
  it('is the elementary symmetric polynomial of the arities when nothing is forbidden', () => {
    expect(countVariableTuples(storeOf([3, 3, 3, 3, 3]), [], [{ variables: ids(5), strength: 2 }]).allowed).toBe(
      10 * 9,
    );
    expect(countVariableTuples(storeOf([2, 3, 4]), [], [{ variables: ids(3), strength: 1 }]).allowed).toBe(9);
    // The strength is capped at the group size: six binary variables at strength 9 give one tuple per value row.
    expect(countVariableTuples(storeOf(Array(6).fill(2)), [], [{ variables: ids(6), strength: 9 }]).allowed).toBe(64);
    // An arity of one adds its subsets with a product of one.
    expect(countVariableTuples(storeOf([1, 2, 3]), [], [{ variables: ids(3), strength: 2 }]).allowed).toBe(
      1 * 2 + 1 * 3 + 2 * 3,
    );
  });

  it('is exact beyond 2^53 and answers a bigint there', () => {
    const arities = Array(40).fill(1000) as number[];
    const got = countVariableTuples(storeOf(arities), [], [{ variables: ids(40), strength: 6 }]);
    const choose = (n: bigint, k: bigint) => {
      let r = 1n;
      for (let i = 1n; i <= k; i += 1n) r = (r * (n - k + i)) / i;
      return r;
    };
    expect(typeof got.allowed).toBe('bigint');
    expect(got.allowed).toBe(choose(40n, 6n) * 1000n ** 6n);
    expect(got.covered).toBe(0);
  });

  it('counts hundreds of variables without listing a tuple', () => {
    const started = process.cpuUsage();
    const got = countVariableTuples(storeOf(Array(500).fill(2)), [], [{ variables: ids(500), strength: 3 }]);
    const used = process.cpuUsage(started);
    expect(got.allowed).toBe((500 * 499 * 498) / 6 * 8);
    expect((used.user + used.system) / 1000).toBeLessThan(50);
  });

  it('removes the tuples that hold a forbidden pair, by a formula on disjoint pairs', () => {
    // 100 forbidden pairs among 200 ternary variables: a matching, so the product of small polynomials applies.
    const forbids = Array.from({ length: 100 }, (_, i) => ({ [`v${2 * i}`]: 'x1', [`v${2 * i + 1}`]: 'x1' }));
    const got = countVariableTuples(storeOf(Array(200).fill(3), forbids), [], [{ variables: ids(200), strength: 3 }]);
    // Choose 3 variables of 200: all in different pairs, or two from one pair plus one other. A pair loses 1 of 9.
    const different = (200n * 198n * 196n) / 6n; // three variables in three different pairs
    const apart = different * 27n;
    const together = 100n * 198n * (9n - 1n) * 3n; // a whole pair, plus one of the other 198 variables
    expect(got.allowed).toBe(apart + together);
  });

  it('agrees with enumeration on random small spaces, strict and weak', () => {
    const draw = lcg(20261021);
    for (let round = 0; round < 60; round += 1) {
      const k = 4 + Math.floor(draw() * 3);
      const arities = Array.from({ length: k }, () => 2 + Math.floor(draw() * 3));
      const forbids: Array<Record<string, string>> = [];
      const pairs = Math.floor(draw() * 8);
      for (let n = 0; n < pairs; n += 1) {
        const a = Math.floor(draw() * k);
        let b = Math.floor(draw() * k);
        if (b === a) b = (a + 1) % k;
        const size = draw() < 0.25 ? 3 : 2;
        const cells: Record<string, string> = {
          [`v${a}`]: `x${Math.floor(draw() * (arities[a] as number))}`,
          [`v${b}`]: `x${Math.floor(draw() * (arities[b] as number))}`,
        };
        if (size === 3) {
          const c = Math.floor(draw() * k);
          if (c !== a && c !== b) cells[`v${c}`] = `x${Math.floor(draw() * (arities[c] as number))}`;
        }
        forbids.push(cells);
      }
      if (draw() < 0.2) forbids.push({ [`v${Math.floor(draw() * k)}`]: 'x0' });
      const groups: TupleGroup[] = [
        { variables: ids(k), strength: 1 + Math.floor(draw() * 3) },
        { variables: ids(k).filter((_, i) => i % 2 === 0), strength: 2 },
      ];
      const rows = Array.from({ length: Math.floor(draw() * 8) }, () => {
        const row: Record<string, string> = {};
        for (let v = 0; v < k; v += 1) {
          if (draw() < 0.8) row[`v${v}`] = `x${Math.floor(draw() * (arities[v] as number))}`;
        }
        return row;
      });
      const want = brute(arities, forbids, rows, groups);
      const got = countVariableTuples(storeOf(arities, forbids), rows, groups);
      expect({ round, allowed: Number(got.allowed), covered: Number(got.covered) }).toEqual({
        round,
        allowed: want.allowed,
        covered: want.covered,
      });
    }
  });

  it('counts a tuple as allowed only when some valid full row holds it', () => {
    // v0=x0 forces v1=x1 (the pair v0=x0,v1=x0 is forbidden) and v1=x1 forces v2=x1; so (v0=x0, v2=x0) never extends.
    const forbids = [
      { v0: 'x0', v1: 'x0' },
      { v1: 'x1', v2: 'x0' },
    ];
    const arities = [2, 2, 2];
    const groups: TupleGroup[] = [{ variables: ['v0', 'v2'], strength: 2 }];
    const want = brute(arities, forbids, [], groups);
    expect(countVariableTuples(storeOf(arities, forbids), [], groups).allowed).toBe(want.allowed);
    expect(want.allowed).toBe(3);
  });

  it('is zero when no valid full row exists', () => {
    const forbids = [{ v0: 'x0' }, { v0: 'x1' }];
    expect(countVariableTuples(storeOf([2, 2], forbids), [], [{ variables: ['v0', 'v1'], strength: 1 }]).allowed).toBe(
      0,
    );
  });

  it('counts a value that counts: its own flag, else its variable', () => {
    const store = storeOf([3, 2], [], { unapproved: { v0: ['x2'] } });
    expect(countVariableTuples(store, [], [{ variables: ['v0', 'v1'], strength: 2 }]).allowed).toBe(4);
  });
});

describe('countVariableTuples: the covered count and the list', () => {
  const store = storeOf([2, 2, 2]);
  const groups: TupleGroup[] = [{ variables: ids(3), strength: 2 }];

  it('counts each tuple once, however many rows and groups hold it', () => {
    const rows = [
      { v0: 'x0', v1: 'x0', v2: 'x0' },
      { v0: 'x0', v1: 'x0', v2: 'x0' },
    ];
    expect(countVariableTuples(store, rows, groups).covered).toBe(3);
    expect(countVariableTuples(store, rows, [...groups, ...groups]).covered).toBe(3);
    expect(countVariableTuples(store, rows, [...groups, ...groups]).allowed).toBe(12);
  });

  it('credits a partial row only for the tuples inside the variables it assigns', () => {
    expect(countVariableTuples(store, [{ v0: 'x1', v1: 'x0' }], groups).covered).toBe(1);
    expect(countVariableTuples(store, [{ v0: 'x1' }], groups).covered).toBe(0);
    expect(countVariableTuples(store, [{ v0: 'x9', v1: 'x0' }], groups).covered).toBe(0);
  });

  it('lists distinct allowed uncovered tuples, up to the limit', () => {
    const rows = [{ v0: 'x0', v1: 'x0', v2: 'x0' }];
    const five = countVariableTuples(store, rows, groups, { uncovered: 5 });
    expect(five.uncovered).toHaveLength(5);
    expect(new Set(five.uncovered?.map((t) => JSON.stringify(t))).size).toBe(5);
    const all = countVariableTuples(store, rows, groups, { uncovered: 100 });
    expect(all.uncovered).toHaveLength(Number(all.allowed) - Number(all.covered));
    expect(countVariableTuples(store, rows, groups, { uncovered: 0 }).uncovered).toEqual([]);
    expect(countVariableTuples(store, rows, groups).uncovered).toBeUndefined();
  });

  it('lists nothing when the rows hold every tuple', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
      v0: `x${n & 1}`,
      v1: `x${(n >> 1) & 1}`,
      v2: `x${(n >> 2) & 1}`,
    }));
    const got = countVariableTuples(store, rows, groups, { uncovered: 5 });
    expect(got.covered).toBe(got.allowed);
    expect(got.uncovered).toEqual([]);
  });
});

describe('countVariableTuples: covered, by formula when nothing is forbidden', () => {
  it('counts the distinct tuples of two rows over 40 variables of arity 1000 at strength 6', () => {
    const arities = Array(40).fill(1000) as number[];
    const first = Object.fromEntries(ids(40).map((name) => [name, 'x0']));
    // The second row agrees with the first on its first 10 variables only.
    const second = Object.fromEntries(ids(40).map((name, i) => [name, i < 10 ? 'x0' : 'x1']));
    const got = countVariableTuples(storeOf(arities), [first, second], [{ variables: ids(40), strength: 6 }]);
    const choose = (n: bigint, k: bigint) => {
      let r = 1n;
      for (let i = 1n; i <= k; i += 1n) r = (r * (n - k + i)) / i;
      return r;
    };
    // Each row holds one tuple per subset; the rows hold the same tuple on the subsets inside their 10 shared variables.
    expect(BigInt(got.covered)).toBe(2n * choose(40n, 6n) - choose(10n, 6n));
  });

  it('agrees with enumeration on random small spaces with nothing forbidden, partial rows and overlapping groups', () => {
    const draw = lcg(77);
    for (let round = 0; round < 80; round += 1) {
      const k = 4 + Math.floor(draw() * 3);
      const arities = Array.from({ length: k }, () => 2 + Math.floor(draw() * 2));
      const groups: TupleGroup[] = [
        { variables: ids(k), strength: 1 + Math.floor(draw() * 3) },
        { variables: ids(k).filter((_, i) => i % 2 === 1), strength: 2 },
      ];
      const rows = Array.from({ length: 1 + Math.floor(draw() * 9) }, () => {
        const row: Record<string, string> = {};
        for (let v = 0; v < k; v += 1) {
          if (draw() < 0.75) row[`v${v}`] = `x${Math.floor(draw() * (arities[v] as number))}`;
        }
        return row;
      });
      const want = brute(arities, [], rows, groups);
      const got = countVariableTuples(storeOf(arities), rows, groups);
      expect({ round, allowed: Number(got.allowed), covered: Number(got.covered) }).toEqual({
        round,
        allowed: want.allowed,
        covered: want.covered,
      });
    }
  });

  it('agrees with enumeration with apart groups of the same size and rows that repeat', () => {
    const arities = [2, 3, 2, 3, 2, 3];
    const groups: TupleGroup[] = [
      { variables: ['v0', 'v1', 'v2'], strength: 2 },
      { variables: ['v3', 'v4', 'v5'], strength: 2 },
    ];
    const rows = [
      { v0: 'x0', v1: 'x1', v2: 'x0', v3: 'x2', v4: 'x1', v5: 'x0' },
      { v0: 'x0', v1: 'x1', v2: 'x0', v3: 'x2', v4: 'x1', v5: 'x0' },
      { v0: 'x1', v1: 'x1', v3: 'x0', v4: 'x1' },
    ];
    const want = brute(arities, [], rows, groups);
    const got = countVariableTuples(storeOf(arities), rows, groups);
    expect({ allowed: Number(got.allowed), covered: Number(got.covered) }).toEqual({
      allowed: want.allowed,
      covered: want.covered,
    });
  });
});

describe('countVariableTuples: arguments', () => {
  const store = storeOf([2, 2, 2]);
  const refuse = (group: TupleGroup, pattern: RegExp) => {
    expect(() => countVariableTuples(store, [], [group])).toThrow(RangeError);
    expect(() => countVariableTuples(store, [], [group])).toThrow(pattern);
  };

  it('names the argument at fault in a RangeError', () => {
    refuse({ variables: ['v0', 'nope'], strength: 2 }, /nope/);
    refuse({ variables: ['v0', 'v1'], strength: 0 }, /strength/);
    refuse({ variables: ['v0', 'v1'], strength: 1.5 }, /strength/);
    refuse({ variables: ['v0', 'v0'], strength: 2 }, /v0/);
    refuse({ variables: [], strength: 2 }, /variables/);
    expect(() => countVariableTuples(store, [], [{ variables: ['v0'], strength: 1 }], { uncovered: -1 })).toThrow(
      /uncovered/,
    );
  });
});
