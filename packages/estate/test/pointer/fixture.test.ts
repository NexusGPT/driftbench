import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, pointer, scanEstate } from '../../src/index';
import { FIXTURE, NOW } from '../support';

/**
 * The Northwind fixture, read through its committed cassette. `cassette.jsonl` holds the answers of the
 * default stack, a system 1 labeler and a system 2 labeler (three runs), one request per window each. No network and no key: a miss
 * here means the fixture, the prompt, the set, the cutter or a labeler changed and the cassette must be
 * re-recorded in one reviewed commit.
 */
async function replay(
  specs: readonly string[] = pointer.DEFAULT_LABELER_SPECS,
  options: {
    cassette?: string;
    threshold?: number;
    passAt?: number;
    failAt?: number;
    marginCut?: number;
  } = {},
) {
  const sets = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!sets.ok) throw new Error(sets.message);
  const parsed = specs.map((text) => {
    const spec = pointer.parseLabelerSpec(text);
    if (!spec.ok) throw new Error(spec.message);
    return spec.spec;
  });
  const built = await pointer.buildLabelling(parsed, {
    env: {},
    record: false,
    cwd: FIXTURE,
    ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
    ...(options.passAt === undefined ? {} : { passAt: options.passAt }),
    ...(options.failAt === undefined ? {} : { failAt: options.failAt }),
    ...(options.marginCut === undefined ? {} : { marginCut: options.marginCut }),
  });
  if (!built.ok) throw new Error(built.message);
  const cassette = pointer.Cassette.parse(
    await readFile(join(FIXTURE, options.cassette ?? 'cassette.jsonl'), 'utf8'),
  );
  const result = await scanEstate({
    root: FIXTURE,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: { sets: sets.sets, labelling: built.labelling, cassette, mode: 'replay' },
  });
  return { result, cassette };
}

describe('the fixture through its committed cassettes', () => {
  it('replays the default stack with no call and no miss, and accounts for every unit', async () => {
    const { result, cassette } = await replay();
    expect(result.pointer?.calls).toBe(0);
    expect(result.pointer?.failed).toEqual([]);
    // The recorded labeller gave 24 answers the checks refuse: each is counted.
    expect(result.pointer?.refusals.length).toBe(24);
    // A unit is decided, or left unlabeled because system 2 did not give it one label on every run.
    expect(result.pointer?.unlabeled).toBeGreaterThan(0);
    expect(result.pointer?.split).toBeGreaterThan(0);
    expect((result.pointer?.decided ?? 0) + (result.pointer?.unlabeled ?? 0)).toBe(
      result.pointer?.plan.units,
    );
    // Every answer of the cassette is read: one request per window, labeler and run.
    expect(cassette.entries.size).toBe(result.pointer?.windows);
    expect(result.pointer?.decidedBy.system1).toBeGreaterThan(0);
    expect(result.pointer?.decidedBy.system2).toBeGreaterThan(0);
  });

  it('builds the git status before commit gate from the recorded nested command spans', async () => {
    const { result } = await replay();
    const gate = result.map.atoms.find(
      (atom) => atom.kind === 'gate' && atom.provenance.quote.includes('**R14.**'),
    );
    expect(gate?.fields).toMatchObject({ first: 'git status', second: 'commit' });
    expect(gate?.evidence).toContainEqual({
      type: 'ordered',
      before: 'Bash~git status',
      after: 'Bash~commit',
    });
  });

  it('builds only atoms whose quote is a slice of the file at its lines', async () => {
    const { result } = await replay();
    const pointed = result.map.atoms.filter((atom) => atom.fields?.extraction === 'pointer');
    expect(pointed.length).toBeGreaterThan(30);
    for (const atom of pointed) {
      const text = await readFile(join(FIXTURE, atom.provenance.file), 'utf8');
      expect(text, atom.id).toContain(atom.provenance.quote);
      const lines = text.split('\n').slice(atom.provenance.startLine - 1, atom.provenance.endLine);
      expect(lines.join('\n'), atom.id).toContain(atom.provenance.quote);
      expect(atom.approved).toBe(false);
    }
  });

  it('is the same ledger bytes on a second replay', async () => {
    const first = await replay();
    const second = await replay();
    expect(pointer.renderLedger(second.result.pointer?.ledger as pointer.Ledger)).toBe(
      pointer.renderLedger(first.result.pointer?.ledger as pointer.Ledger),
    );
  });

  it('holds no unit text in the cassettes: only file names, hashes and the answers', async () => {
    const { result } = await replay();
    const entries = result.pointer?.ledger.entries ?? [];
    expect(entries.length).toBeGreaterThan(100);
    for (const name of ['cassette.jsonl']) {
      const raw = await readFile(join(FIXTURE, name), 'utf8');
      for (const entry of entries.filter((candidate) => candidate.quote.length >= 20)) {
        expect(raw, `${name} ${entry.id}`).not.toContain(entry.quote.slice(0, 20));
      }
    }
  });

  it('records the tokens the services reported, for both classes', async () => {
    const raw = await readFile(join(FIXTURE, 'cassette.jsonl'), 'utf8');
    const entries = pointer.Cassette.parse(raw).entries;
    const byLabeler = new Map<string, number>();
    for (const entry of entries.values()) {
      byLabeler.set(
        entry.readable.labeler as string,
        (byLabeler.get(entry.readable.labeler as string) ?? 0) + entry.answer.usage.input,
      );
    }
    expect([...byLabeler.keys()].sort()).toEqual(['anthropic', 'jev']);
    for (const total of byLabeler.values()) expect(total).toBeGreaterThan(0);
  });

  it('replays system 2 alone, and refuses system 1 alone: the shipped set has labels only system 2 can answer', async () => {
    const two = await replay(['system2:anthropic']);
    expect(two.result.pointer?.calls).toBe(0);
    // System 2 alone leaves unlabeled the units its runs split on, and the entries the check refused.
    expect(two.result.pointer?.unlabeled).toBeGreaterThanOrEqual(two.result.pointer?.split ?? 0);
    expect(two.result.pointer?.decidedBy).toEqual({ system1: 0, system2: two.result.pointer?.decided });
    await expect(replay(['system1:jev'])).rejects.toThrow(/a yes or no model cannot name any of them/);
  });

  it('moves units between the classes with the margin cut, from the same cassette, with no call', async () => {
    const stack = await replay();
    const keepAll = await replay(pointer.DEFAULT_LABELER_SPECS, { marginCut: 0 });
    const sendAll = await replay(pointer.DEFAULT_LABELER_SPECS, { marginCut: 1.1 });
    // A cut of 0 leaves every unit system 1 can answer to system 1; a cut above 1 leaves every unit to system 2.
    // The labels that carry spans or links are answered by system 2 whatever the cut.
    expect(sendAll.result.pointer?.decidedBy.system1).toBe(0);
    expect(keepAll.result.pointer?.decidedBy.system2).toBeLessThan(
      stack.result.pointer?.decidedBy.system2 ?? 0,
    );
    expect(stack.result.pointer?.decidedBy.system1).toBeGreaterThan(0);
    expect(stack.result.pointer?.decidedBy.system1).toBeLessThan(
      keepAll.result.pointer?.decidedBy.system1 ?? 0,
    );
    const alone = await replay(['system2:anthropic']);
    expect(sendAll.result.pointer?.labelled.map((item) => [item.id, item.label])).toEqual(
      alone.result.pointer?.labelled.map((item) => [item.id, item.label]),
    );
  });

  it('decides by the probability bounds when they are given, from the same cassette', async () => {
    const wide = await replay(pointer.DEFAULT_LABELER_SPECS, { passAt: 0.5, failAt: 0.1 });
    const narrow = await replay(pointer.DEFAULT_LABELER_SPECS, { passAt: 1, failAt: 0 });
    expect(narrow.result.pointer?.decidedBy.system1).toBeLessThan(
      wide.result.pointer?.decidedBy.system1 ?? 0,
    );
  });
});
