import { check, none } from '../../../../failure';
import type { OwnerInput, Sources, StoreDoc, StoreValue, StoreVariable } from '../../interface';
import { BANK_SET_HASH, OWNER_DATE } from '../constants';
import { build, type ItemContext, planOf, type StemRun } from '../item';
import { fileOf, QUANTITIES, type Quantity, ruleSentence } from '../oracle/conditions';
import {
  canonicalStore,
  estateOf,
  locateTool,
  type ToolSpec,
  type ToolValue,
  toolsFile,
  valueById,
  variableOf,
  variablesCiting,
} from '../oracle/estate';
import { makeSpace, SpaceOracle, toStore } from '../oracle/space';
import { checkPlan, planIsSound } from '../oracle/spaces';
import { cpuMs, deepEqual, deepFreeze, must, reachableObjects, show, stableStringify } from '../util';
import { type Base, baseStore, basicSpan, checkCounts, convOf, draw, evenMix, exactlyOne } from './sources';

const VARIABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

function oneNumeric(ctx: ItemContext, noun: string, unit = ' euros') {
  const quantity: Quantity = { noun, unit, kind: 'count' };
  const span = basicSpan(ctx.rng, quantity, ctx.rng.int(5, 900));
  const store = build(ctx, {
    estate: estateOf({ 'CLAUDE.md': fileOf(ctx.rng, [ruleSentence(span.text, ctx.rng)], 5) }, [
      { id: 'R1', source: 'CLAUDE.md', conditions: [span.text], tools: [] },
    ]),
  });
  return { span, store };
}

/** A tool field whose value ids are given as is, each with its own unique quote, in a tools file. */
function toolWithIds(
  ctx: ItemContext,
  field: string,
  ids: readonly string[],
): { spec: ToolSpec; file: string } {
  const { rng } = ctx;
  const values: ToolValue[] = ids.map((id, i) => ({
    id,
    quote: `${field} case number ${i + 1} is called ${i * 11 + 7} here`,
  }));
  const spec: ToolSpec = { tool: 'ledger.post', field, source: 'TOOLS.md', values };
  return {
    spec,
    file: toolsFile(
      rng,
      values.map((v) => `- ${v.quote}.`),
    ),
  };
}

/** Sources of all three kinds over a base store with two tool fields and two numeric conditions. */
export function fullSources(ctx: ItemContext): { sources: Sources; base: Base } {
  const { rng } = ctx;
  const base = baseStore(ctx, [3, 2]);
  const q1 = rng.pick(QUANTITIES);
  const q2 = rng.pick(QUANTITIES.filter((q) => q.noun !== q1.noun));
  const spans = [basicSpan(rng, q1, rng.int(5, 900)), basicSpan(rng, q2, rng.int(5, 900))];
  const estate = {
    files: {
      ...base.estate.files,
      'CLAUDE.md': fileOf(
        rng,
        spans.map((s) => ruleSentence(s.text, rng)),
        5,
      ),
    },
    rules: [
      ...base.estate.rules,
      { id: 'R2', source: 'CLAUDE.md', conditions: spans.map((s) => ({ text: s.text })), tools: [] },
    ],
  };
  const [A, B] = base.vars as [Base['vars'][number], Base['vars'][number]];
  const { sessions } = draw(
    rng,
    base,
    30,
    base.vars.map((v) => evenMix(v.ids.length)),
  );
  const owner: OwnerInput = {
    values: [
      { variable: B.variable.id, value: 'ownerextra', date: OWNER_DATE, words: 'The owner adds a case.' },
    ],
    impossible: [
      {
        a: { variable: A.variable.id, value: A.ids[0] as string },
        b: { variable: B.variable.id, value: B.ids[0] as string },
        date: OWNER_DATE,
        words: 'never together',
      },
    ],
    weights: A.ids.map((id, k) => ({
      variable: A.variable.id,
      value: id,
      weight: [0.4, 0.3, 0.3][k] as number,
      date: OWNER_DATE,
      words: 'about a third',
    })),
  };
  return { sources: { estate, conversations: sessions, owner }, base };
}

/** Every string in a value replaced and every array extended: a deep write. */
function scribble(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) scribble(item);
    value.push('SCRIBBLE');
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'string') (value as Record<string, unknown>)[key] = 'SCRIBBLE';
      else scribble(v);
    }
  }
}

const idsOf = (store: StoreDoc) =>
  [...store.variables]
    .map((v) => [v.id, v.values.map((x) => x.id).sort()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

export const VALUES_RUNS: Record<string, StemRun> = {
  'values.ids.variable-grammar': (variant, ctx) => {
    const noun =
      variant === 'spaces-and-caps'
        ? 'the Invoice Total'
        : variant === 'punctuation'
          ? "the customer's age (days)"
          : variant === 'leading-digit'
            ? 'the 24h response window'
            : 'the température moyenne';
    const { span, store } = oneNumeric(ctx, noun, '');
    const v = exactlyOne(variablesCiting(store, span.text), `variables whose values cite "${span.text}"`);
    check(VARIABLE_ID.test(v.id), () => ({
      rule: 'the variable for "{}" has the id {}, which does not match {}',
      got: { details: [noun, show(v.id), VARIABLE_ID] }, expected: none('observation')
    }));
  },

  'values.ids.value-grammar': (variant, ctx) => {
    const { rng } = ctx;
    if (variant === 'owner-values') {
      const base = baseStore(ctx, [2]);
      const bv = base.vars[0] as Base['vars'][number];
      const ids = ['very high!', '/etc/x', "it's", 'a b c'];
      const owner = {
        values: ids.map((id, i) => ({
          variable: bv.variable.id,
          value: id,
          date: OWNER_DATE,
          words: `Owner case ${i + 1}: ${id} (${rng.int(10, 99)})`,
        })),
      };
      const store = build(ctx, { estate: base.estate, owner });
      const variable = variableOf(store, bv.variable.id) as StoreVariable;
      for (const o of owner.values) {
        const value = variable.values.find((x) =>
          (x.provenance ?? []).some((p) => p.kind === 'owner' && p.words === o.words),
        );
        check(!!value, () => ({
          rule: 'the owner value {} is not on {}: {}',
          got: { details: [show(o.value), variable.id, show(variable.values.map((x) => x.id))] }, expected: none('observation')
        }));
        check(VALUE_ID.test((value as StoreValue).id), () => ({
          rule: 'the owner value {} got the id {}, which does not match {}',
          got: { details: [show(o.value), show((value as StoreValue).id), VALUE_ID] }, expected: none('observation')
        }));
      }
    } else {
      const ids =
        variant === 'tool-values'
          ? ['very high', 'low/medium', "o'clock", '(none)']
          : ['<b>bold</b>', '../../etc', 'x'.repeat(200), '\u{1F642}', 'a;b|c&d', '-dash'];
      const t = toolWithIds(ctx, 'level', ids);
      const store = build(ctx, {
        estate: estateOf({ 'TOOLS.md': t.file }, [
          { id: 'R1', source: 'TOOLS.md', conditions: [], tools: [t.spec] },
        ]),
      });
      const found = locateTool(store, t.spec);
      check(!!found, () => ({
        rule: 'the {} values with odd ids are not all in one variable: {}',
        got: { details: [ids.length, show(store.refused)] }, expected: none('observation')
      }));
      for (const [given, stored] of (found as NonNullable<typeof found>).ids) {
        check(VALUE_ID.test(stored), () => ({
          rule: 'the value {} got the id {}, which does not match {}',
          got: { details: [show(given, 40), show(stored, 40), VALUE_ID] }, expected: none('observation')
        }));
      }
    }
  },

  'values.ids.stable': (variant, ctx) => {
    const { sources } = fullSources(ctx);
    const first = build(ctx, sources);
    if (variant === 'after-other-build') {
      const { sources: other } = fullSources({ ...ctx, rng: ctx.rng });
      build(ctx, other);
    }
    const second = build(ctx, sources);
    const a = stableStringify(idsOf(first));
    const b = stableStringify(idsOf(second));
    check(a === b, () => ({
      rule: 'the ids changed between two builds of the same sources: {} then {}',
      got: { details: [show(JSON.parse(a), 140), show(JSON.parse(b), 140)] }, expected: none('observation')
    }));
  },

  'values.ids.collisions': (variant, ctx) => {
    if (variant === 'variable-collision') {
      const nouns = ['the 請求 score', 'the 注文 score', 'the 返金 score'].slice(0, 2);
      const spans = nouns.map((noun) =>
        basicSpan(ctx.rng, { noun, unit: '', kind: 'count' }, ctx.rng.int(5, 900)),
      );
      const store = build(ctx, {
        estate: estateOf(
          {
            'CLAUDE.md': fileOf(
              ctx.rng,
              spans.map((s) => ruleSentence(s.text, ctx.rng)),
              4,
            ),
          },
          spans.map((s, i) => ({ id: `R${i + 1}`, source: 'CLAUDE.md', conditions: [s.text], tools: [] })),
        ),
      });
      const vars = spans.map((s) =>
        exactlyOne(variablesCiting(store, s.text), `variables whose values cite "${s.text}"`),
      );
      check(new Set(vars.map((v) => v.id)).size === vars.length, () => ({
        rule: 'different quantities got the same variable id: {}',
        got: { details: [show(vars.map((v) => v.id))] }, expected: none('observation')
      }));
      for (const v of vars)
        check(VARIABLE_ID.test(v.id), () => ({
          rule: 'the variable id {} does not match {}',
          got: { details: [show(v.id), VARIABLE_ID] }, expected: none('observation')
        }));
    } else {
      const ids =
        variant === 'three-way' ? ['very high', 'very-high', 'very_high'] : ['very high', 'very-high'];
      const t = toolWithIds(ctx, 'level', ids);
      const store = build(ctx, {
        estate: estateOf({ 'TOOLS.md': t.file }, [
          { id: 'R1', source: 'TOOLS.md', conditions: [], tools: [t.spec] },
        ]),
      });
      const found = locateTool(store, t.spec);
      check(!!found && found.ids.size === ids.length, () => ({
        rule: 'the {} values {} are not all in one variable of the store',
        got: { details: [ids.length, show(ids)] }, expected: none('observation')
      }));
      const stored = [...(found as NonNullable<typeof found>).ids.values()];
      check(new Set(stored).size === ids.length, () => ({
        rule: 'values {} got ids {}: two of them share an id',
        got: { details: [show(ids), show(stored)] }, expected: none('observation')
      }));
      check((found as NonNullable<typeof found>).variable.values.length === ids.length, () => ({
        rule: 'a variable holds the values its sources list',
        got: { values: (found as NonNullable<typeof found>).variable.values.length },
        expected: { values: ids.length },
      }));
    }
  },

  'values.owner-adds-to-existing': (variant, ctx) => {
    const base = baseStore(ctx, [3, 2]);
    const [A, B] = base.vars as [Base['vars'][number], Base['vars'][number]];
    const adds = Array.from({ length: variant === 'order-kept' ? 2 : 1 }, (_, i) => ({
      variable: A.variable.id,
      value: `addedvalue${i + 1}`,
      date: OWNER_DATE,
      words: `Owner adds case ${i + 1}`,
    }));
    const store = build(ctx, { estate: base.estate, owner: { values: adds } });
    const variable = variableOf(store, A.variable.id) as StoreVariable;
    for (const a of adds)
      check(!!valueById(variable, a.value), () => ({
        rule: 'the owner value {} is not on {}: {}',
        got: { details: [a.value, variable.id, show(variable.values.map((x) => x.id))] }, expected: none('observation')
      }));
    check(variable.values.length === A.ids.length + adds.length, () => ({
      rule: 'values added by the owner join the values of the variable',
      input: { variable: variable.id },
      got: { values: variable.values.length },
      expected: { values: A.ids.length + adds.length },
    }));
    if (variant === 'others-unchanged') {
      for (const id of A.ids) {
        const before = valueById(A.variable, id);
        const after = valueById(variable, id);
        check(deepEqual(before, after), () => ({
          rule: 'the old value {} changed: {} became {}',
          got: { details: [id, show(before), show(after)] }, expected: none('observation')
        }));
      }
      const otherBefore = variableOf(base.store, B.variable.id);
      const otherAfter = variableOf(store, B.variable.id);
      check(deepEqual(otherBefore, otherAfter), () => ({
        rule: 'another variable changed when the owner added to {}',
        got: { details: [A.variable.id] }, expected: none('observation')
      }));
    }
    if (variant === 'order-kept') {
      const oldOrder = A.variable.values.map((x) => x.id);
      const order = variable.values.map((x) => x.id).filter((id) => oldOrder.includes(id));
      check(deepEqual(order, oldOrder), () => ({
        rule: 'the old values changed order: {} became {}',
        got: { details: [show(oldOrder), show(order)] }, expected: none('observation')
      }));
    }
  },

  'values.owner-value-already-present': (variant, ctx) => {
    const base = baseStore(ctx, [3]);
    const A = base.vars[0] as Base['vars'][number];
    const id = A.ids[1] as string;
    const times = variant === 'same-id-twice' ? 2 : 1;
    const words = Array.from({ length: times }, (_, i) => `Owner repeats ${id} (${i + 1})`);
    const store = build(ctx, {
      estate: base.estate,
      owner: {
        values: words.map((w) => ({ variable: A.variable.id, value: id, date: OWNER_DATE, words: w })),
      },
    });
    const variable = variableOf(store, A.variable.id) as StoreVariable;
    check(variable.values.length === A.ids.length, () => ({
      rule: 'an owner value that repeats an existing one adds no value',
      input: { variable: variable.id },
      got: { values: variable.values.length },
      expected: { values: A.ids.length },
    }));
    const value = valueById(variable, id) as StoreValue;
    const before = valueById(A.variable, id) as StoreValue;
    for (const p of before.provenance ?? []) {
      check(
        (value.provenance ?? []).some((q) => deepEqual(q, p)),
        () => ({ rule: 'the value {} lost its earlier provenance {}', got: { details: [id, show(p)] }, expected: none('observation') }),
      );
    }
    for (const w of words) {
      const hit = (value.provenance ?? []).filter((p) => p.kind === 'owner' && p.words === w);
      check(hit.length === 1, () => ({
        rule: "a value carries one owner provenance with the owner's words",
        input: { value: id, words: show(w) },
        got: { found: hit.length }, expected: none('observation')
      }));
    }
  },

  'values.hostile-names': (variant, ctx) => {
    const { rng } = ctx;
    const before = Object.getOwnPropertyNames(Object.prototype).sort();
    if (variant === 'proto-like-noun') {
      const { span, store } = oneNumeric(ctx, 'the __proto__ depth', '');
      const v = exactlyOne(variablesCiting(store, span.text), `variables whose values cite "${span.text}"`);
      check(VARIABLE_ID.test(v.id), () => ({
        rule: 'the variable for the noun "__proto__" has the id {}, which does not match {}',
        got: { details: [show(v.id), VARIABLE_ID] }, expected: none('observation')
      }));
    } else {
      const field =
        variant === 'constructor-variable'
          ? 'constructor'
          : variant === 'to-string-variable'
            ? 'toString'
            : variant === 'has-own-property-variable'
              ? 'hasOwnProperty'
              : 'level';
      const ids =
        variant === 'constructor-value' ? ['constructor', 'toString', 'hasOwnProperty'] : ['first', 'second'];
      const t = toolWithIds(ctx, field, ids);
      const estate = estateOf({ 'TOOLS.md': t.file }, [
        { id: 'R1', source: 'TOOLS.md', conditions: [], tools: [t.spec] },
      ]);
      const store0 = build(ctx, { estate });
      const found = locateTool(store0, t.spec);
      check(!!found, () => ({
        rule: 'the tool field {} with values {} is not in the store: {}',
        got: { details: [field, show(ids), show(store0.refused)] }, expected: none('observation')
      }));
      const { variable, ids: map } = found as NonNullable<typeof found>;
      const base: Base = {
        estate,
        rules: [],
        store: store0,
        vars: [{ variable, ids: ids.map((i) => map.get(i) as string) }],
      };
      const { sessions, counts, observed } = draw(rng, base, 40, [evenMix(ids.length)]);
      const store = build(ctx, { estate, conversations: sessions });
      checkCounts(store, base, counts, observed);
      for (const v of store.variables)
        for (const x of v.values)
          for (const p of convOf(x))
            check(Number.isInteger(p.count) && Number.isInteger(p.total), () => ({
              rule: 'value {} has non-integer counts {}',
              got: { details: [x.id, show(p)] }, expected: none('observation')
            }));
    }
    const after = Object.getOwnPropertyNames(Object.prototype).sort();
    check(deepEqual(before, after), () => ({
      rule: 'Object.prototype gained properties: {}',
      got: { details: [show(after.filter((k) => !before.includes(k)))] }, expected: none('observation')
    }));
    check(
      ({} as Record<string, unknown>).count === undefined &&
        ({} as Record<string, unknown>).total === undefined,
      () => ({ rule: 'a plain object now has seen or of', expected: none('observation') }),
    );
  },

  'values.large-variable': (variant, ctx) => {
    const base = baseStore(ctx, [2]);
    const A = base.vars[0] as Base['vars'][number];
    const n = variant === 'two-thousand-values' ? 2000 : 10000;
    const owner = {
      values: Array.from({ length: n }, (_, i) => ({
        variable: A.variable.id,
        value: `ov${String(i).padStart(5, '0')}`,
        date: OWNER_DATE,
        words: `case ${i}`,
      })),
    };
    const { value: store, ms } = cpuMs(() => build(ctx, { estate: base.estate, owner }));
    const variable = variableOf(store, A.variable.id) as StoreVariable;
    check(variable.values.length === A.ids.length + n, () => ({
      rule: 'values added by the owner join the values of the variable',
      input: { variable: variable.id },
      got: { values: variable.values.length },
      expected: { values: A.ids.length + n },
    }));
    check(new Set(variable.values.map((x) => x.id)).size === variable.values.length, () => ({
      rule: 'two values share an id', expected: none('observation')
    }));
    check(ms <= 3000, () => ({
      rule: 'adding {} values took {} ms of processor time, over 3000 ms',
      got: { details: [n, Math.round(ms)] }, expected: none('observation')
    }));
  },

  'values.unapproved-not-planned': (variant, ctx) => {
    const { rng } = ctx;
    const arities = [2, 3, 3, 2, 3];
    const flagged: Record<string, unknown> = {
      kind: 'conversations',
      count: 4,
      total: 20,
      set_hash: BANK_SET_HASH,
    };
    if (variant === 'approved-later') {
      const space = makeSpace([2, 3, 3, 2, 4], { shared: [0, 1, 2], rules: [[2, 3, 4]] });
      const store = toStore(space);
      const last = store.variables[4] as StoreVariable;
      (last.values[3] as StoreValue).approved = true;
      (last.values[3] as StoreValue).provenance = [flagged as never];
      const plan = planOf(ctx, store, { seed: ctx.seed });
      const facts = checkPlan(space, new SpaceOracle(space), plan);
      planIsSound(facts);
      return;
    }
    if (variant === 'approved-value-in-unapproved-variable') {
      // A value counts when its own flag, else its variable's, is true (docs/variables.md "Approval"): the one
      // approved value of an unapproved variable is planned, its unflagged sibling is not.
      const space = makeSpace([2, 3, 3, 2, 1], { shared: [0, 1, 2], rules: [[2, 3, 4]] });
      const store = toStore(space);
      const last = store.variables[4] as StoreVariable;
      last.approved = false;
      (last.values[0] as StoreValue).approved = true;
      last.values.push({ id: 'sibling', provenance: [flagged as never] });
      const plan = planOf(ctx, store, { seed: ctx.seed });
      const facts = checkPlan(space, new SpaceOracle(space), plan);
      planIsSound(facts);
      return;
    }
    const space = makeSpace(arities, { shared: [0, 1, 2], rules: [[2, 3, 4]] });
    const store = toStore(space);
    if (variant === 'proposed-variable') {
      store.variables.push({
        id: 'proposedvar',
        approved: false,
        values: [
          { id: 'p0', provenance: [flagged as never], approved: false },
          { id: 'p1', provenance: [flagged as never], approved: false },
        ],
      });
      store.rules[0]?.variables.push('proposedvar');
    } else {
      const target = store.variables[rng.int(0, 4)] as StoreVariable;
      target.values.push({ id: 'proposed', provenance: [flagged as never], approved: false });
      if (variant === 'proposed-value-in-a-pair') {
        const other = store.variables.find((v) => v !== target) as StoreVariable;
        store.impossible.push({
          a: { variable: target.id, value: 'proposed' },
          b: { variable: other.id, value: (other.values[1] as StoreValue).id },
          provenance: [{ kind: 'owner', words: 'a pair with a proposal', date: OWNER_DATE }],
        });
      }
    }
    const plan = planOf(ctx, store, { seed: ctx.seed });
    const facts = checkPlan(space, new SpaceOracle(space), plan);
    check(facts.problems.length === 0, () => ({
      rule: 'a proposed (unapproved) {} reached the plan: {}',
      got: { details: [variant === 'proposed-variable' ? 'variable' : 'value', facts.problems.join('; ')] }, expected: none('observation')
    }));
  },

  'values.fresh-objects': (variant, ctx) => {
    const { sources } = fullSources(ctx);
    const snapshot = stableStringify(sources);
    const a = build(ctx, sources);
    const aCanon = stableStringify(canonicalStore(a));
    const input = reachableObjects(sources);
    const shared = [...reachableObjects(a)].filter((o) => input.has(o));
    check(shared.length === 0, () => ({
      rule: 'the store shares {} object(s) with its input: {}',
      got: { details: [shared.length, show(shared[0], 100)] }, expected: none('observation')
    }));
    if (variant === 'two-builds-independent') {
      const b = build(ctx, sources);
      const bObjects = reachableObjects(b);
      const both = [...reachableObjects(a)].filter((o) => bObjects.has(o));
      check(both.length === 0, () => ({
        rule: 'two builds of the same sources share {} object(s)',
        got: { details: [both.length] }, expected: none('observation')
      }));
    }
    scribble(a);
    check(stableStringify(sources) === snapshot, () => ({
      rule: 'writing to the store changed the sources it was built from', expected: none('observation')
    }));
    const again = build(ctx, sources);
    check(stableStringify(canonicalStore(again)) === aCanon, () => ({
      rule: 'writing to an earlier store changed a later build of the same sources', expected: none('observation')
    }));
  },

  'values.input-not-mutated': (variant, ctx) => {
    const { sources } = fullSources(ctx);
    const part: Sources =
      variant === 'estate'
        ? { estate: sources.estate as NonNullable<Sources['estate']> }
        : variant === 'conversations'
          ? { estate: sources.estate as NonNullable<Sources['estate']>, conversations: sources.conversations }
          : { estate: sources.estate as NonNullable<Sources['estate']>, owner: sources.owner };
    const frozen = deepFreeze(JSON.parse(JSON.stringify(part)) as Sources);
    const snapshot = stableStringify(part);
    build(ctx, frozen);
    check(stableStringify(frozen) === snapshot, () => ({ rule: 'the input changed', expected: none('observation') }));
  },
};
