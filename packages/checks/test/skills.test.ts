import { describe, expect, it } from 'vitest';
import { skills } from '../src/checks/skills';
import { acme } from './support/acme';
import { context, observed, run } from './support/context';

const task = acme('acme-price-sheet');
const built = 'I wrote out/acme-price-sheet.xlsx with the sheets Mobile and Home.';
const loaded = (...names: string[]) => ({ runtime: { skills: names.map((name) => ({ name })) } });

describe('skills', () => {
  it('passes block 0 of acme-price-sheet: the xlsx skill loads at least once', async () => {
    const verdicts = await run(skills, context(task, 0, observed(built, [], loaded('xlsx'))));
    expect(verdicts.map((item) => [item.id, item.outcome, item.evidence])).toEqual([
      ['skills.xlsx', 'pass', 'xlsx loaded 1 time, expected at least 1; skills loaded in this block: xlsx'],
    ]);
  });

  it('mutation: only the pdf skill loads; skills.xlsx fails and names what loaded', async () => {
    const [only] = await run(skills, context(task, 0, observed(built, [], loaded('pdf'))));
    expect(only).toMatchObject({
      outcome: 'fail',
      evidence: 'xlsx loaded 0 times, expected at least 1; skills loaded in this block: pdf',
    });
  });

  it('applies Count semantics: an exact count of 1 fails on a second load', async () => {
    const ctx = context(task, 0, observed(built, [], loaded('xlsx', 'xlsx')), {
      expect: { skills: [{ name: 'xlsx', count: 1 }] },
    });
    expect((await run(skills, ctx))[0]?.outcome).toBe('fail');
  });

  it('is inconclusive when the adapter reports no runtime trace at all', async () => {
    const [only] = await run(skills, context(task, 0, observed(built)));
    expect(only).toMatchObject({ id: 'skills.xlsx', outcome: 'inconclusive' });
  });
});
