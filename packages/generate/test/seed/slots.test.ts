import { expect, it } from 'vitest';
import { fillText, phraseFits, slotsOf } from '../../src/seed/relations';

it('collects slots in depth-first order, retaining duplicates and fresh results', () => {
  const sparse = new Array<unknown>(2);
  sparse[1] = '{c}';
  const input = ['{a}', { second: '{b}{a}' }, null, [], sparse];
  expect(slotsOf(input)).toEqual(['a', 'b', 'a', 'c']);
  slotsOf(input).push('changed');
  expect(slotsOf(input)).toEqual(['a', 'b', 'a', 'c']);
  const growing = ['{a}'];
  Object.defineProperty(growing, 0, {
    get: () => {
      growing.push('{later}');
      return '{a}';
    },
  });
  expect(slotsOf(growing)).toEqual(['a']);
});

it('fills current bindings independently of cache history and literal mode', () => {
  const slots = { a: 'x.y', b: 'a"b' };
  for (const a of ['x.y', 'replacement', '', '[]', '\\', '🙂']) {
    slots.a = a;
    expect(fillText('{a}/{b}/{a}', slots)).toEqual({ ok: true, value: `${a}/a"b/${a}` });
    const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(fillText('{a}/{b}/{a}', slots, true)).toEqual({ ok: true, value: `${escaped}/a"b/${escaped}` });
  }
  expect(fillText('{missing} {missing}', slots)).toEqual({ ok: false, missing: ['missing'] });
  for (let index = 0; index < 5000; index += 1)
    expect(fillText(`case-${index} {a}`, { a: 'value' })).toEqual({
      ok: true,
      value: `case-${index} value`,
    });
  expect(fillText('{a}', { a: 'changed' })).toEqual({ ok: true, value: 'changed' });
});

it('checks phrase eligibility without formatting text that will not be used', () => {
  const phrase = {
    dimension: 'flow',
    value: 'example',
    text: '{a}/{b}',
    lang: 'en',
    approved: true,
    produced_by: 'code' as const,
    binds: { b: 'own' },
  };
  expect(phraseFits(phrase, {}, { a: 'value' })).toBe(true);
  expect(phraseFits(phrase, {}, {})).toBe(false);
  expect(phraseFits({ ...phrase, when: { stage: ['ready'] } }, { stage: 'waiting' }, { a: 'value' })).toBe(
    false,
  );
});
