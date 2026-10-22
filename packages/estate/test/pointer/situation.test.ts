import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { plantedDense } from './support';

const RULE = 'When a shipment is late by more than two days, tell the user and propose a supplier email.';
const FILES = { 'CLAUDE.md': `# Rules\n\n${RULE}\n\nAlways answer in French.\n` };

/** A planted system 2 labeler: the rule unit carries a situation span, or none. */
async function scanWith(situation: boolean) {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const labeler = plantedDense((window) =>
    window.units.map((unit) => {
      if (unit.text === RULE) {
        const to = RULE.indexOf(',');
        return {
          units: String(unit.n),
          label: 'rule',
          ...(situation ? { spans: [{ kind: 'situation', from: 0, to }] } : {}),
        };
      }
      if (unit.text.startsWith('Always answer')) return { units: String(unit.n), label: 'reply-rule' };
      return { units: String(unit.n), label: 'none' };
    }),
  );
  const root = await estate(FILES);
  return scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: sets.sets,
      labelling: pointer.singleLabelling(labeler),
      cassette: new pointer.Cassette(),
      mode: 'record',
    },
  });
}

describe('the situation span of the shipped label set', () => {
  it('declares a situation span, carried by the rule labels', () => {
    const parsed = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
    if (!parsed.ok) throw new Error(parsed.message);
    const set = parsed.sets[0];
    expect(set?.spans?.map((span) => span.name)).toContain('situation');
    for (const name of ['rule', 'dispatch', 'prohibition', 'reply-rule']) {
      expect(set?.labels.find((label) => label.name === name)?.spans, name).toContain('situation');
    }
  });

  it('gives the atom of a rule the circumstance the labeler pointed at, as an exact slice of the file', async () => {
    const { map, pointer: scanned } = await scanWith(true);
    expect(scanned?.refusals).toEqual([]);
    const rule = map.atoms.find((atom) => atom.kind === 'instruction');
    expect(rule?.situation).toBe('When a shipment is late by more than two days');
    // Another rule, with no span, keeps no situation and is not refused.
    const reply = map.atoms.find((atom) => atom.kind === 'register');
    expect(reply?.situation).toBeUndefined();
  });

  it('keeps the atom of a rule without a situation span, with no situation', async () => {
    const { map, pointer: scanned } = await scanWith(false);
    expect(scanned?.atomRefusals).toEqual([]);
    const rule = map.atoms.find((atom) => atom.kind === 'instruction');
    expect(rule).toBeDefined();
    expect(rule?.situation).toBeUndefined();
  });
});
