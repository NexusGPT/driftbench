import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';
import { plantedDense } from './support';

// An invented harbour office: nothing here names a real estate.
const ASK = 'Summarize the tide report for the harbour master when the harbour master asks.';
const GATE = 'Run `git status` before you run `git commit`.';
const HAZARD =
  'After a compaction, read this file again, read `notes/tide.md`, run `make state`, and try the failed request again.';
const FILES = {
  'CLAUDE.md': ['# Harbour office', '', ASK, '', GATE, '', HAZARD, '', 'Nothing here.', ''].join('\n'),
  'notes/tide.md': 'Tide table.\n',
};

type Answer = Omit<pointer.Labelled, 'units'>;
const at = (text: string, from: string, to?: string) => {
  const start = text.indexOf(from);
  return { from: start, to: to === undefined ? start + from.length : text.indexOf(to) + to.length };
};

/** The shipped set, answered by a table: the unit that holds a sentence takes the answer written for it. */
async function scan(answers: Record<string, Answer>) {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const labeler = plantedDense((window) =>
    window.units.map((unit) => {
      const found = Object.entries(answers).find(([sentence]) => unit.text === sentence);
      return found ? { units: String(unit.n), ...found[1] } : { units: String(unit.n), label: 'none' };
    }),
  );
  const result = await scanEstate({
    root: await estate(FILES),
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: {
      sets: sets.sets,
      labelling: pointer.singleLabelling(labeler),
      cassette: new pointer.Cassette(),
      mode: 'record',
    },
  });
  return (sentence: string) =>
    result.map.atoms.find(
      (atom) => atom.provenance.quote === sentence && atom.fields?.extraction === 'pointer',
    );
}

const recoveryOptions = (atom: { evidence: Array<{ type: string }> } | undefined) =>
  (
    atom?.evidence.find(
      (evidence) => evidence.type === 'custom' && (evidence as { name?: string }).name === 'hazard_recovery',
    ) as { options?: unknown } | undefined
  )?.options;

describe('the declarations the shipped set reads from the labels', () => {
  it('writes the reply act and the ask of a rule from its links and spans, and leaves them out without them', async () => {
    const find = await scan({
      [ASK]: {
        label: 'rule',
        spans: [
          { kind: 'ask-text', ...at(ASK, 'Summarize the tide report for the harbour master') },
          { kind: 'situation', ...at(ASK, 'when the harbour master asks') },
        ],
        links: [
          { kind: 'reply-act', to: 'report' },
          { kind: 'reply-part', to: 'reply' },
        ],
      },
    });
    const atom = find(ASK);
    expect(atom?.replyAct).toEqual({ id: 'report', evidence: { type: 'text_segment', part: 'reply' } });
    // The ask names the reply act of its atom: the generator takes an ask only for that exact act.
    expect(atom?.fields?.ask).toEqual({
      text: 'Summarize the tide report for the harbour master',
      context: 'when the harbour master asks',
      act: { kind: 'reply', name: 'report' },
    });
    const bare = (await scan({ [ASK]: { label: 'rule' } }))(ASK);
    expect(bare).toBeDefined();
    expect(bare?.replyAct).toBeUndefined();
    expect(bare?.fields).not.toHaveProperty('ask');
  });

  it('writes the order of a gate from the input both acts share, and leaves it out without the link', async () => {
    const answer = (links: Array<{ kind: string; to: string }>) => ({
      [GATE]: {
        label: 'gate-command',
        spans: [{ kind: 'governed-action', ...at(GATE, 'run `git commit`') }],
        links: [{ kind: 'act-tool', to: 'Bash' }, ...links],
      },
    });
    const keyed = (await scan(answer([{ kind: 'order-key', to: 'command' }])))(GATE);
    expect(keyed?.fields?.order).toEqual({ key: 'command' });
    const bare = (await scan(answer([])))(GATE);
    expect(bare).toBeDefined();
    expect(bare?.fields).not.toHaveProperty('order');
  });

  it('writes the recovery of a hazard: the files, the commands, the retry and its own file', async () => {
    const full = (
      await scan({
        [HAZARD]: {
          label: 'hazard-compaction',
          spans: [
            { kind: 'reread-self', ...at(HAZARD, 'read this file again') },
            { kind: 'retry', ...at(HAZARD, 'try the failed request again') },
          ],
        },
      })
    )(HAZARD);
    const options = recoveryOptions(full);
    expect(options).toEqual({
      hazard: 'compaction',
      reread: ['notes/tide.md'],
      rereadSelf: true,
      calls: [{ label: 'Bash', input: { command: { contains: 'make state' } } }],
      retry: true,
    });
    const bare = (await scan({ [HAZARD]: { label: 'hazard-compaction' } }))(HAZARD);
    expect(recoveryOptions(bare)).toEqual({
      hazard: 'compaction',
      reread: ['notes/tide.md'],
      calls: [{ label: 'Bash', input: { command: { contains: 'make state' } } }],
    });
  });
});
