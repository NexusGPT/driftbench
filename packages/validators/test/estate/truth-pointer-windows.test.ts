import { pointer } from '@agent-nexus/driftbench-estate';
import { describe, expect, it } from 'vitest';
import type { ScanOutcome } from '../../src/ladders/estate/bank/planted';
import { chunkCapCheck, MAX_CHUNK } from '../../src/ladders/estate/bank/scan-refs';
import { truthPointer } from '../../src/ladders/estate/truth-pointer';

const PATH = 'references/notes.md';
/** A reference of 250,000 characters: five paragraphs of 50,000 characters under one heading. */
const HUGE = ['# Notes', ...Array.from({ length: 5 }, (_, i) => `${String(i)} ${'x'.repeat(50_000)}`)].join(
  '\n\n',
);

/** The requests of a scan as the planted bank reads them from the truth labeller's window log. */
const requestsOf = (truth: ReturnType<typeof truthPointer>) =>
  ({
    requests: truth.windows.map((window) => ({
      file: window.file,
      from: 1,
      to: window.units,
      characters: window.characters,
    })),
  }) as unknown as ScanOutcome;

/** The shipped set under another name: a set the planted truth holds no answer for. */
function foreignSets(name: string): pointer.LabelSet[] {
  const parsed = pointer.parseLabelSets(pointer.AGENT_RULES_SET);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.sets.map((set) => ({ ...set, set: name }));
}

describe('the planted-truth labeller logs every window it is sent', () => {
  it('logs a window of another set, with that set, before it answers none', async () => {
    const truth = truthPointer({ files: { [PATH]: HUGE }, atoms: [], answers: new Map() });
    const done = await pointer.pointerScan({
      ...truth,
      sets: foreignSets('document-roles'),
      atoms: [],
      files: [{ path: PATH, text: '# Notes\n\nRead the log first.' }],
    });
    expect(done.labelled.every((unit) => unit.label === 'none')).toBe(true);
    expect(truth.windows).toEqual([expect.objectContaining({ file: PATH, set: 'document-roles' })]);
  });

  // The degraded scanner: it sends the whole reference, uncut, as one request of another set. Before the window of
  // a foreign set was logged, the chunk check never saw it and passed.
  it('turns the 40,000-character check red on a scanner that sends the whole reference in a foreign set', async () => {
    const truth = truthPointer({ files: { [PATH]: HUGE }, atoms: [], answers: new Map() });
    await pointer.pointerScan({
      ...truth,
      sets: foreignSets('document-roles'),
      atoms: [],
      files: [{ path: PATH, text: HUGE }],
    });
    const largest = Math.max(...truth.windows.map((window) => window.characters));
    expect(largest).toBeGreaterThan(MAX_CHUNK);
    expect(chunkCapCheck(PATH)(requestsOf(truth))).toMatch(/chunks over 40000 characters/);
  });
});
