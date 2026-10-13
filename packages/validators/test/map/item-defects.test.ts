import { DimensionId, ValueId } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import type { CodeEntry } from '../../src/ladders/map/bank/facts';
import { mapBank, mapQuarantine } from '../../src/ladders/map/bank/index';
import { renderTools } from '../../src/ladders/map/render';
import { hiddenSpec } from '../../src/ladders/map/spec';
import { truthOf } from '../../src/ladders/map/truth';

const written = [...mapBank(), ...mapQuarantine()];
const item = (id: string) => {
  const found = written.find((candidate) => candidate.id === id);
  if (!found?.code) throw new Error(`no single-case item ${id}`);
  return found as typeof found & { code: (seed: number) => CodeEntry[] };
};
const values = (code: CodeEntry[]) => code.flatMap((entry) => (entry.type === 'value' ? [entry] : []));
const SEEDS = [1, 2, 3, 12];

describe('the truth of every map item is one an honest extractor can propose', () => {
  it('names every dimension and value in the id grammar of the proposal, and no value twice in one dimension', () => {
    const bad: string[] = [];
    for (const one of written) {
      if (!one.code) continue;
      for (const seed of SEEDS) {
        const seen = new Set<string>();
        for (const entry of values(one.code(seed))) {
          if (!DimensionId.safeParse(entry.dimension).success)
            bad.push(`${one.id}@${seed}: dimension ${entry.dimension}`);
          if (!ValueId.safeParse(entry.value).success) bad.push(`${one.id}@${seed}: value ${entry.value}`);
          const key = `${entry.dimension}/${entry.value}`;
          if (seen.has(key)) bad.push(`${one.id}@${seed}: value ${key} twice`);
          seen.add(key);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('writes field names as docs/generating.md says: $ref gives _ref, user.email gives user_email', () => {
    const dims = (id: string) =>
      new Set(
        values(item(id).code(1))
          .filter((entry) => entry.dimension.includes('.in.'))
          .map((entry) => entry.dimension.split('.in.')[1]),
      );
    expect(dims('adversarial.property-named-ref')).toEqual(new Set(['_ref']));
    expect(dims('adversarial.property-name-with-dot')).toEqual(new Set(['user_email']));
  });

  it('gives every tuple one dimension per position, closed or not', () => {
    for (const id of [
      'schema-keywords.prefix-items',
      'schema-keywords.tuple-items-draft-04',
      'schema-keywords.unevaluated-items',
      'schema-keywords.additional-items',
    ]) {
      for (const seed of SEEDS) {
        const ids = values(item(id).code(seed)).map((entry) => entry.dimension);
        expect(
          ids.some((dimension) => dimension.endsWith('.0')),
          `${id}@${seed}`,
        ).toBe(true);
      }
    }
    for (const id of ['schema-keywords.unevaluated-items', 'schema-keywords.additional-items']) {
      expect(values(item(id).code(1)).some((entry) => entry.value.endsWith('.extra-item'))).toBe(true);
    }
  });

  it("leaves the first ladder's tool inputs open, so closed-object alone states unknown-key and the two agree", () => {
    for (const seed of SEEDS) {
      const spec = hiddenSpec(seed);
      expect(renderTools(spec), `seed ${seed}`).not.toContain('additionalProperties: false');
      expect(truthOf(spec).structural.some((entry) => entry.dimension.endsWith('.unknown-key'))).toBe(false);
    }
    // The item draws the side: on an input, unknown-key with sent.
    const sent = SEEDS.flatMap((seed) => values(item('schema-keywords.closed-object').code(seed))).filter(
      (entry) => entry.value.endsWith('.in.unknown-key.sent'),
    );
    expect(sent.length).toBeGreaterThan(0);
  });

  it('draws the dependencies property apart from reason on every seed', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const ids = new Set(
        values(item('schema-keywords.dependencies').code(seed))
          .map((entry) => entry.dimension)
          .filter((dimension) => /\.(in|out)\./.test(dimension)),
      );
      expect(ids.size, `seed ${seed}`).toBe(2);
    }
  });
});
