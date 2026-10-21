import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classes } from '../../src/index';

const EXAMPLE = resolve(import.meta.dirname, '../../../../examples/acme/classes/order-fiber-address.yaml');

const base = {
  id: 'refund.one',
  intent: 'The customer asks for a refund of one order.',
  seed: 'I want a refund for order 1042.',
  slots: [
    {
      name: 'order',
      format: 'number',
      surface_forms: [
        { form: '1042', approved: true },
        { form: '#1042', approved: true },
        { form: 'order no. 1042', approved: false },
      ],
      minimal: ['1043'],
    },
  ],
  axes: {
    register: { formal: 'polite', casual: 'informal' },
    length: { short: 'few words', long: 'two sentences' },
  },
};

function errorsOf(raw: unknown): string[] {
  const result = classes.validateClass(raw);
  return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
}

describe('class files', () => {
  it('loads the Acme example class, with a warning for the surface form that waits for sign-off', async () => {
    const loaded = await classes.loadClassFile(EXAMPLE);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.class.id).toBe('acme.order.fiber-address');
    expect(loaded.warnings.map((w) => w.message)).toEqual([
      'slot "plan": 1 surface form(s) wait for sign-off and are not planned',
    ]);
    expect(classes.approvedForms(loaded.class.slots[0] as classes.ClassSlot)).not.toContain(
      'the gigabit one',
    );
  });

  it('refuses a class whose parts do not hold together, naming each problem', () => {
    expect(errorsOf(base)).toEqual([]);
    const slot = base.slots[0] as (typeof base.slots)[number];
    expect(errorsOf({ ...base, slots: [slot, slot] })).toContain(
      'slots.1.name: slot "order" is declared twice',
    );
    expect(
      errorsOf({ ...base, slots: [{ ...slot, surface_forms: [{ form: '1042', approved: false }] }] }),
    ).toEqual(['slots.0.surface_forms: slot "order" has no approved surface form']);
    expect(errorsOf({ ...base, slots: [{ ...slot, minimal: ['1042'] }] })).toEqual([
      'slots.0.minimal.0: the minimal value "1042" is not distinct from the surface form "1042"',
    ]);
    expect(errorsOf({ ...base, seed: 'I want a refund.' })).toEqual([
      'seed: the seed holds no approved form of slot "order"',
    ]);
    expect(errorsOf({ ...base, axes: { slot_surface: { a: 'x' } } })).toEqual([
      'axes.slot_surface: slot_surface is implicit: it comes from the slots',
    ]);
    expect(errorsOf({ ...base, exclude: [{ register: 'loud', length: 'short' }] })).toEqual([
      'exclude.0.register: unknown axis value register=loud',
    ]);
    expect(errorsOf({ ...base, invariants: { keep: ['blue kettle'] } })).toEqual([
      'invariants.keep.0: the seed does not hold "blue kettle"',
    ]);
    expect(errorsOf({ ...base, extra: 1 }).length).toBe(1);
    expect(errorsOf({ ...base, slots: [{ ...slot, surface_forms: [{ form: '1042' }] }] }).length).toBe(1);
  });

  it('changes the class hash when a surface form is approved', () => {
    const a = classes.validateClass(base);
    const slot = base.slots[0] as (typeof base.slots)[number];
    const b = classes.validateClass({
      ...base,
      slots: [{ ...slot, surface_forms: slot.surface_forms.map((f) => ({ ...f, approved: true })) }],
    });
    expect(a.ok && b.ok && a.hash !== b.hash).toBe(true);
  });
});

describe('the class planner', () => {
  const cls = (() => {
    const loaded = classes.validateClass({ ...base, exclude: [{ register: 'casual', length: 'long' }] });
    if (!loaded.ok) throw new Error('fixture');
    return loaded.class;
  })();

  it('always varies slot_surface over the approved forms, then the declared style axes', () => {
    expect(classes.classAxes(cls)).toEqual([
      { name: 'slot_surface', values: ['s0', 's1'] },
      { name: 'register', values: ['formal', 'casual'] },
      { name: 'length', values: ['short', 'long'] },
    ]);
    expect(classes.formAt(cls.slots[0] as classes.ClassSlot, 's1')).toBe('#1042');
  });

  it('covers every allowed pair at strength 2 and never writes an excluded combination', async () => {
    const loaded = await classes.loadClassFile(EXAMPLE);
    if (!loaded.ok) throw new Error('example');
    for (const c of [cls, loaded.class]) {
      const rows = classes.planClass(c);
      expect(classes.coverageOf(c, rows, 2).share).toBe(1);
      for (const ex of c.exclude) {
        expect(rows.some((row) => Object.entries(ex).every(([a, v]) => row[a] === v))).toBe(false);
      }
      // Smaller than the full grid.
      expect(rows.length).toBeLessThan(classes.allRows(c).length);
    }
    // The excluded pair is not required.
    expect(classes.requiredTuples(cls, 2).has('register=casual|length=long')).toBe(false);
  });

  it('gives the same rows for the same seed, and extends to the rows asked for', () => {
    expect(classes.planClass(cls, { seed: 4 })).toEqual(classes.planClass(cls, { seed: 4 }));
    const rows = classes.planClass(cls, { rows: 20 });
    expect(rows).toHaveLength(20);
    // Every allowed cell is used before any repeats.
    expect(new Set(rows.slice(0, classes.allRows(cls).length).map((r) => classes.cellKey(cls, r))).size).toBe(
      classes.allRows(cls).length,
    );
  });

  it('ranks a planted one-factor failure first: every realisation with slot_surface=s1 fails', () => {
    const rows = classes.allRows(cls);
    const observations = rows.map((row) => ({ row, runs: 3, passes: row.slot_surface === 's1' ? 0 : 3 }));
    const suspects = classes.localise(cls, observations);
    expect(suspects[0]).toMatchObject({ tuple: 'slot_surface=s1', t: 1, failRate: 1, inPassing: false });
    // A value a passing realisation holds is never a suspect ahead of it.
    expect(suspects.findIndex((s) => s.tuple === 'register=formal')).toBeGreaterThan(0);
  });
});
