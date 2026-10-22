import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader } from '../../src';
import {
  Cassette,
  cut,
  type Labeler,
  type Labelled,
  type LabelSet,
  pointerScan,
  readSpansOf,
  singleLabelling,
  type Window,
} from '../../src/pointer';
import { FIXTURE } from '../support';
import { load, plantedDense } from './support';

// Invented files: a shelf audit skill with a front matter and a body.
const SKILL = [
  '---',
  'name: shelf-audit',
  'description: Checks the stock on each shelf before closing.',
  'allowed-tools: Read, Edit',
  'owner: the stock room',
  '---',
  '# Shelf audit',
  '',
  'Count the till twice.',
  '',
].join('\n');
const PATH = '.claude/skills/shelf-audit/SKILL.md';

describe('the spans the reader already reads', () => {
  it('are the front matter values of a skill or a subagent under the keys the reader declares', () => {
    const spans = readSpansOf([{ path: PATH, text: SKILL }]).get(PATH) ?? [];
    expect(spans.map((span) => SKILL.slice(span.start, span.end))).toEqual([
      'shelf-audit',
      'Checks the stock on each shelf before closing.',
      'Read, Edit',
    ]);
    const agent = '---\nname: night-owl\nmodel: haiku\nnote: free text\n---\nWatch the door.\n';
    const found = readSpansOf([{ path: '.claude/agents/night-owl.md', text: agent }]).get(
      '.claude/agents/night-owl.md',
    );
    expect(found?.map((span) => agent.slice(span.start, span.end))).toEqual(['night-owl', 'haiku']);
  });

  it('cover the matcher, type and command of a skill hook, and no other text under hooks', () => {
    const text = [
      '---',
      'name: closer',
      'description: Closes the till.',
      'hooks:',
      '  PreToolUse:',
      '    - matcher: Bash',
      '      hooks:',
      '        - type: command',
      '          command: python3 guards/till.py',
      '          timeout: 5',
      '          statusMessage: Counting the till for you',
      '---',
      'Close the till.',
      '',
    ].join('\n');
    const path = '.claude/skills/closer/SKILL.md';
    const read = (readSpansOf([{ path, text }]).get(path) ?? []).map((span) =>
      text.slice(span.start, span.end),
    );
    expect(read).toEqual(['closer', 'Closes the till.', 'Bash', 'command', 'python3 guards/till.py']);
    expect(read).not.toContain('Counting the till for you');
  });

  it('are none for a file of another kind', () => {
    expect(readSpansOf([{ path: 'CLAUDE.md', text: SKILL }]).size).toBe(0);
  });

  it('lie where a real scan of an estate puts its declarations', async () => {
    const raw = await new ClaudeCodeReader().read(FIXTURE);
    const spans = readSpansOf(raw.files.map((file) => ({ path: file.path, text: file.text })));
    const lineStarts = (text: string): number[] => {
      const out = [0];
      for (let at = 0; at < text.length; at++) if (text[at] === '\n') out.push(at + 1);
      return out;
    };
    let checked = 0;
    for (const decl of [...raw.skills, ...raw.subagents]) {
      const file = raw.files.find((candidate) => candidate.path === decl.file);
      if (!file || !decl.description) continue;
      const starts = lineStarts(file.text);
      const lineStart = starts[decl.description.at.startLine - 1] as number;
      const inside = (spans.get(decl.file) ?? []).some(
        (span) =>
          span.start <= lineStart + file.text.slice(lineStart).indexOf(decl.description?.value ?? '') &&
          lineStart + file.text.slice(lineStart).indexOf(decl.description?.value ?? '') < span.end,
      );
      expect(inside, decl.file).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('a unit the code already read in a scan', () => {
  const SETS = `labels:
  - set: duty
    description: What the notes ask.
    labels:
      - name: order
        description: A unit that tells what to do.
      - name: remark
        description: A unit that only describes.
`;
  const sets = load(SETS);

  it('is shown to the labeler as read, a label on it is refused and asked again, and it gets no label', async () => {
    const description = 'Checks the stock on each shelf before closing.';
    const seen: Array<{ read: number[]; asked: number[] }> = [];
    let calls = 0;
    const labeler: Labeler = {
      ...plantedDense(() => []),
      async call(_wire, _set, window: Window) {
        calls++;
        seen.push({
          read: (window.display ?? []).filter((line) => line.mode === 'read').map((line) => line.n),
          asked: window.units.map((unit) => unit.n),
        });
        const readAt = (window.display ?? []).find((line) => line.mode === 'read')?.n;
        const labels: Labelled[] =
          calls === 1 && readAt !== undefined
            ? [{ units: String(readAt), label: 'order' }]
            : window.units.map((unit) => ({ units: String(unit.n), label: 'order' }));
        return { labels, returnedModel: 'planted-1', stopReason: 'end_turn', usage: { input: 1, output: 1 } };
      },
    };
    const result = await pointerScan({
      files: [{ path: PATH, text: SKILL }],
      sets: sets as LabelSet[],
      labelling: singleLabelling(labeler),
      cassette: new Cassette(),
      mode: 'record',
      read: readSpansOf([{ path: PATH, text: SKILL }]),
    });
    expect(calls).toBe(2);
    expect(seen[0]?.read.length).toBeGreaterThan(0);
    expect(seen[0]?.asked.some((n) => seen[0]?.read.includes(n))).toBe(false);
    const entry = result.ledger.entries.find((each) => each.quote === description);
    expect(entry?.labels.duty).toBeUndefined();
    const body = result.ledger.entries.find((each) => each.quote === 'Count the till twice.');
    expect(body?.labels.duty?.label).toBe('order');
    expect(cut(SKILL).units.length).toBeGreaterThan(3);
  });
  it('drops the label a labeler keeps putting on a shown line after the retry, and lists the drop; a replay lists it too', async () => {
    const description = 'Checks the stock on each shelf before closing.';
    let calls = 0;
    const labeler: Labeler = {
      ...plantedDense(() => []),
      async call(_wire, _set, window: Window) {
        calls++;
        const readAt = (window.display ?? []).find((line) => line.mode === 'read')?.n as number;
        const labels: Labelled[] = [
          { units: String(readAt), label: 'remark' },
          ...window.units.map((unit) => ({ units: String(unit.n), label: 'order' })),
          // The same unit and label twice is one entry, not a refusal.
          ...window.units.slice(0, 1).map((unit) => ({ units: String(unit.n), label: 'order' })),
        ];
        return { labels, returnedModel: 'planted-1', stopReason: 'end_turn', usage: { input: 1, output: 1 } };
      },
    };
    const files = [{ path: PATH, text: SKILL }];
    const cassette = new Cassette();
    const first = await pointerScan({
      files,
      sets: sets as LabelSet[],
      labelling: singleLabelling(labeler),
      cassette,
      mode: 'record',
      read: readSpansOf(files),
    });
    // Two tries: the first is refused, the second loses the shown-line label only.
    expect(calls).toBe(2);
    expect(first.failedWindows).toEqual([]);
    expect(first.droppedLabels).toHaveLength(1);
    expect(first.droppedLabels[0]).toMatchObject({ window: `${PATH}#1`, label: 'remark' });
    expect(typeof first.droppedLabels[0]?.line).toBe('number');
    const body = first.ledger.entries.find((each) => each.quote === 'Count the till twice.');
    expect(body?.labels.duty?.label).toBe('order');
    expect(first.ledger.entries.find((each) => each.quote === description)?.labels.duty).toBeUndefined();
    const replay = await pointerScan({
      files,
      sets: sets as LabelSet[],
      labelling: singleLabelling({ ...labeler, call: undefined }),
      cassette: Cassette.parse(cassette.render()),
      mode: 'replay',
      read: readSpansOf(files),
    });
    expect(replay.calls).toBe(0);
    expect(replay.droppedLabels).toEqual(first.droppedLabels);
  });
});
