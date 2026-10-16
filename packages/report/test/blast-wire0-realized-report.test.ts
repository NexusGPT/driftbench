import { describe, expect, it } from 'vitest';
import { renderHtml, renderRun } from '../src/html';
import { renderJunit } from '../src/junit';
import { buildScorecard, notStored, runDetailOf } from '../src/scorecard';
import { dataOf, run } from './support';

/**
 * Blast radius of PR 430 (merged) on the report: a red-team attacker's sent text is adversarial, so both
 * pages escape it; a campaign mixing a run stored before `realized` existed with runs that carry it renders
 * each block as its record says; the JUnit report reads such a campaign as before.
 */
const HASH = 'b'.repeat(64);
const ATTACK = '</pre><script>alert("x")</script><img src=x onerror=alert(1)>';
const spec = { blocks: [{ when: { user: 'Hi, I want fiber.' } }, { when: { user: 'Thanks.' } }] };

function campaign() {
  const old = run({ repeat: 0, blocks: [{ text: 'Sure.' }, { text: 'Bye.' }] });
  const attacked = run({ repeat: 1, blocks: [{ text: 'No.' }, { text: 'Bye.' }] });
  attacked.blocks[0] = { ...attacked.blocks[0], realized: { hash: HASH, text: ATTACK } } as never;
  const hashed = run({ repeat: 2, blocks: [{ text: 'Ok.' }, { text: 'Bye.' }] });
  hashed.blocks[1] = { ...hashed.blocks[1], realized: { hash: HASH } } as never;
  const runs = [old, attacked, hashed];
  return { runs, data: dataOf(runs, { [old.specId]: spec as never }) };
}

describe('PR 430 blast radius: the report and a block realized text', () => {
  it('escapes an attacker text on the run page and the scorecard page', () => {
    const { runs, data } = campaign();
    const attacked = runs[1];
    if (!attacked) throw new Error('no attacked run');
    for (const html of [renderRun(runDetailOf(data, attacked)), renderHtml(buildScorecard(data))]) {
      expect(html).toContain('User, as sent');
      expect(html).not.toContain('<script>alert("x")</script>');
      expect(html).not.toContain('<img src=x onerror');
      expect(html).toContain('&lt;script&gt;');
    }
  });

  it('renders each run of a mixed campaign as its record says', () => {
    const { runs, data } = campaign();
    const [old, attacked, hashed] = runs.map((each) => renderRun(runDetailOf(data, each)));
    // The run stored before the field: one "User" per block, nothing as sent.
    expect(old).not.toContain('User, as sent');
    expect(old).not.toContain('User, as written');
    expect(attacked?.split('User, as sent').length).toBe(2);
    expect(hashed?.split('User, as sent').length).toBe(2);
    expect(hashed).toContain(notStored(HASH).replace(/"/g, '&quot;').slice(0, 40));
    expect(hashed).toContain(`only its hash ${HASH.slice(0, 12)}`);
    expect(hashed).not.toContain(HASH.slice(0, 13));
  });

  it('leaves the JUnit report of a mixed campaign as it reads without the field', () => {
    const { runs, data } = campaign();
    const plain = runs.map((each) => {
      const copy = structuredClone(each);
      for (const block of copy.blocks) delete (block as { realized?: unknown }).realized;
      return copy;
    });
    const without = dataOf(plain, { [plain[0]?.specId ?? '']: spec as never });
    expect(renderJunit(data)).toBe(renderJunit(without));
  });
});
