import { ModelError } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  Cassette,
  CassetteMiss,
  createAnthropicLabeler,
  cut,
  type Labeler,
  LabelerError,
  type Labelled,
  type LabelSet,
  OUT_OF_STEP_MIN,
  OUT_OF_STEP_SHARE,
  outOfStep,
  type PointerInput,
  type PointerPlan,
  pointerScan,
  REASK_LIMIT,
  renderLedger,
  SPLIT_REASK_RUNS,
  singleLabelling,
  type Window,
  windowsOf,
} from '../../src/pointer';
import { BAKERY, type Call, load, plantedDense } from './support';

// Invented files: a harbour office with quays, ropes and skippers.
const QUAY = [
  '# Quay',
  '',
  '- Coil the ropes on the red post',
  '- Name the skipper of every boat',
  '- Hang the lamp before dusk',
  '',
  'Count the boats twice. Close the gate when the quay is empty.',
  '',
].join('\n');
const OFFICE = ['# Office', '', 'The office opens at nine.', '', '- Log each boat at the desk', ''].join(
  '\n',
);
const FILES = [
  { path: 'quay.md', text: QUAY },
  { path: 'office.md', text: OFFICE },
];

const SETS = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
  - set: tone
    description: How a note is worded.
    labels:
      - name: curt
        description: A unit of three words or fewer.
      - name: long
        description: A unit of more than three words.
`;

/** Everything is an order in `duty`; the tone label follows the length of the unit's text. */
const byLength = (window: Window, set: LabelSet): Labelled[] =>
  window.units.map((unit) => ({
    units: String(unit.n),
    label: set.set === 'duty' ? 'order' : unit.text.split(/\s+/).length <= 3 ? 'curt' : 'long',
  }));

const input = (labeler: Labeler, cassette: Cassette, over: Partial<PointerInput> = {}): PointerInput => ({
  files: FILES,
  sets: load(SETS),
  labelling: singleLabelling(labeler),
  cassette,
  mode: 'record',
  ...over,
});

const replayOf = (labeler: Labeler): Labeler => ({ ...labeler, call: undefined });

describe('the windows', () => {
  it('make a file one window, cut only at the size of the labeler, and leave an opaque unit out', () => {
    const text = '# One\n\nA first sentence. A second sentence.\n\n```sh\nrun\n```\n\n# Two\n\n- Item\n';
    const units = cut(text).units;
    const windows = windowsOf('a.md', units, 60);
    expect(windows.map((window) => window.units.length)).toEqual([5]);
    expect(
      windows.flatMap((window) => window.units.map((unit) => units[unit.index]?.container)),
    ).not.toContain('opaque');
    expect(windowsOf('a.md', units, 2).map((window) => window.units.length)).toEqual([2, 2, 1]);
    expect(windowsOf('a.md', units, 2)[1]?.id).toBe('a.md#2');
  });

  it('do not cut a table row: the cells of a row stay in one window, so a label can point from one to the next', () => {
    const text = '| ask | load |\n|---|---|\n| one | a |\n| two | b |\n| three | c |\n';
    const units = cut(text).units;
    // Eight units; a cap of 3 would end a window after the first cell of a row.
    const sizes = windowsOf('a.md', units, 3, text).map((window) => window.units.length);
    expect(sizes.every((size) => size % 2 === 0)).toBe(true);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(units.length);
    // Without the text the cap is the cap.
    expect(windowsOf('a.md', units, 3).map((window) => window.units.length)).toEqual([3, 3, 2]);
  });
});

describe('the pointer scan', () => {
  it('records one answer per window and set, then replays the same ledger with no labeler', async () => {
    const log: string[] = [];
    const cassette = new Cassette();
    const first = await pointerScan(input(plantedDense(byLength, log), cassette));
    expect(first.failed).toEqual([]);
    expect(first.refusals).toEqual([]);
    expect(first.unlabeled).toBe(0);
    // Two files, one window each, two sets.
    expect(log).toHaveLength(4);
    expect(cassette.entries.size).toBe(4);
    expect(first.usage).toEqual([
      {
        id: 'planted',
        cls: 'system2',
        model: 'planted-1',
        calls: 4,
        recorded: 4,
        input: 40,
        output: 16,
        replayed: 0,
        replayedInput: 0,
        replayedOutput: 0,
      },
    ]);

    const second = await pointerScan(
      input(replayOf(plantedDense(byLength)), Cassette.parse(cassette.render()), { mode: 'replay' }),
    );
    expect(second.calls).toBe(0);
    // The tokens of the answers it replays come from the recording.
    expect(second.usage).toEqual([
      {
        id: 'planted',
        cls: 'system2',
        model: 'planted-1',
        calls: 0,
        recorded: 0,
        input: 0,
        output: 0,
        replayed: 4,
        replayedInput: 40,
        replayedOutput: 16,
      },
    ]);
    expect(renderLedger(second.ledger)).toBe(renderLedger(first.ledger));
    expect(second.labelled.map((item) => [item.id, item.label])).toEqual(
      first.labelled.map((item) => [item.id, item.label]),
    );
  });

  it('keeps a label of the ledger without asking again', async () => {
    const first = await pointerScan(input(plantedDense(byLength), new Cassette()));
    const log: string[] = [];
    const again = await pointerScan(
      input(plantedDense(byLength, log), new Cassette(), { previous: first.ledger, mode: 'replay' }),
    );
    expect(log).toEqual([]);
    expect(again.windows).toBe(0);
    expect(again.carried).toBe(again.plan.units);
    expect(again.decided).toBe(0);
  });

  it('re-labels only the windows of an edited unit', async () => {
    const files = [{ path: 'quay.md', text: QUAY }];
    const first = await pointerScan(input(plantedDense(byLength), new Cassette(), { files, windowUnits: 4 }));
    const log: string[] = [];
    const edited = [
      {
        path: 'quay.md',
        text: QUAY.replace('Name the skipper of every boat', 'Name the skipper of each boat'),
      },
    ];
    await pointerScan(
      input(plantedDense(byLength, log), new Cassette(), {
        files: edited,
        windowUnits: 4,
        previous: first.ledger,
      }),
    );
    // The edit and the units beside it sit in the first window of four units; the second window keeps its labels.
    expect(log.map((entry) => entry.split(':')[0])).toEqual(['quay.md#1', 'quay.md#1']);
  });

  it('re-labels only the set whose label was edited, and changes no unit id', async () => {
    const first = await pointerScan(input(plantedDense(byLength), new Cassette()));
    const edited = load(
      SETS.replace('A unit that only says how the quay is.', 'A unit that describes the quay.'),
    );
    const log: string[] = [];
    const second = await pointerScan(
      input(plantedDense(byLength, log), new Cassette(), { sets: edited, previous: first.ledger }),
    );
    expect(log.every((entry) => entry.endsWith(':duty'))).toBe(true);
    expect(log).toHaveLength(2);
    expect(second.ledger.entries.map((entry) => entry.id)).toEqual(
      first.ledger.entries.map((entry) => entry.id),
    );
    const tone = (result: typeof first) => result.ledger.entries.map((entry) => entry.labels.tone);
    expect(tone(second)).toEqual(tone(first));
  });

  it('re-labels every unit when the labelers or their settings change, and keeps the ids', async () => {
    const first = await pointerScan(input(plantedDense(byLength), new Cassette()));
    const other = { ...plantedDense(byLength), settings: { threshold: 0.9 } };
    const log: string[] = [];
    const second = await pointerScan(
      input({ ...other, call: plantedDense(byLength, log).call }, new Cassette(), { previous: first.ledger }),
    );
    expect(log).toHaveLength(4);
    expect(second.carried).toBe(0);
    expect(second.ledger.entries.map((entry) => entry.id)).toEqual(
      first.ledger.entries.map((entry) => entry.id),
    );
  });

  it('misses in replay on a changed set, and names the field that differs', async () => {
    // A labeler that renders the set into the request, as a real one does.
    const real = (labeler: Labeler): Labeler => ({
      ...labeler,
      render: (set, window) => ({
        labeler: 'planted',
        body: { set: set.description, window: window.id, units: window.units.map((unit) => unit.text) },
      }),
    });
    const recorded = new Cassette();
    await pointerScan(input(real(plantedDense(byLength)), recorded));
    const edited = load(SETS.replace('What the harbour notes ask of a skipper.', 'What the notes ask.'));
    await expect(
      pointerScan(input(replayOf(real(plantedDense(byLength))), recorded, { sets: edited, mode: 'replay' })),
    ).rejects.toThrow(/differs in: .*setHash/);
  });

  it('refuses a bad answer as a whole, asks again once, lists the window as failed, and labels nothing from it', async () => {
    const bad = (window: Window, set: LabelSet): Labelled[] =>
      set.set === 'duty'
        ? [
            { units: '99', label: 'order' },
            { units: '1', label: 'rotate' },
            { units: '2-3', label: 'order' },
            { units: '3', label: 'remark' },
          ]
        : byLength(window, set);
    const result = await pointerScan(
      input(plantedDense(bad), new Cassette(), { files: [FILES[0] as (typeof FILES)[number]] }),
    );
    // The same bad answer comes back at the second request: the window fails, and no entry of it is kept.
    expect(result.failedWindows).toMatchObject([
      {
        window: 'quay.md#1',
        set: 'duty',
        reason: [
          'quay.md#1: "99" leaves the window',
          'quay.md#1: the label rotate is not in the set duty',
          'quay.md#1: "3" names a unit that is already labelled',
        ].join('; '),
      },
    ]);
    expect(result.labelled.filter((item) => item.set.set === 'duty')).toEqual([]);
    expect(result.unlabeled).toBeGreaterThan(0);
  });

  it('keeps the entries of a refused answer in the failure it records, and replays it as the same failure', async () => {
    const bad = (window: Window, set: LabelSet): Labelled[] =>
      set.set === 'duty'
        ? [
            { units: '99', label: 'order', spans: [{ kind: 'x', quote: 'copied unit text' }] as never },
            { units: '1', label: 'rotate', target: 2 },
            { units: 'some private words', label: 'words of the unit' },
          ]
        : byLength(window, set);
    const cassette = new Cassette();
    const result = await pointerScan(
      input(plantedDense(bad), cassette, { files: [FILES[0] as (typeof FILES)[number]] }),
    );
    const failed = [...cassette.entries.values()].filter((entry) => entry.answer.refused === 'unreadable');
    expect(failed.length).toBeGreaterThan(0);
    // One list per try, with units, label and target only: no span, no copied text.
    // A label that is not in the set, and units that are no number or range, are stored as the marker "unknown".
    const tried = [
      { units: '99', label: 'order' },
      { units: '1', label: 'unknown', target: 2 },
      { units: 'unknown', label: 'unknown' },
    ];
    expect(failed[0]?.answer.refusedAnswers).toEqual([tried, tried]);
    // The stored entries hold none of the model's own words (its refusal message, `error`, is the reader's own text).
    expect(JSON.stringify(failed[0]?.answer.refusedAnswers)).not.toMatch(
      /private words|rotate|words of the unit/,
    );
    expect(cassette.render()).not.toContain('copied unit text');
    const replay = await pointerScan(
      input(replayOf(plantedDense(bad)), Cassette.parse(cassette.render()), {
        mode: 'replay',
        files: [FILES[0] as (typeof FILES)[number]],
      }),
    );
    expect(replay.calls).toBe(0);
    expect(replay.failedWindows).toEqual(result.failedWindows);
  });

  it('retries an unreadable answer once, then lists the window as failed and records the failure', async () => {
    const log: string[] = [];
    const cassette = new Cassette();
    const result = await pointerScan(
      input(
        plantedDense(byLength, log, {
          fail: (window) =>
            window.path === 'office.md' ? new LabelerError('the answer is not JSON') : undefined,
        }),
        cassette,
      ),
    );
    expect(log.filter((entry) => entry.startsWith('office.md'))).toHaveLength(4);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain('the answer is not JSON');
    // The failure is an entry of the cassette, so a replay lists the same window with no call and no miss.
    const office = [...cassette.entries.values()].filter((entry) => entry.readable.path === 'office.md');
    expect(office).toHaveLength(2);
    expect(office.every((entry) => entry.answer.refused === 'unreadable')).toBe(true);
    expect(result.labelled.every((item) => item.path === 'quay.md')).toBe(true);
    const replay = await pointerScan(
      input(replayOf(plantedDense(byLength)), Cassette.parse(cassette.render()), { mode: 'replay' }),
    );
    expect(replay.calls).toBe(0);
    expect(replay.failed).toEqual(result.failed);
    expect(renderLedger(replay.ledger)).toBe(renderLedger(result.ledger));
  });

  it('retries a refusal once, then lists the window as failed', async () => {
    const log: string[] = [];
    const result = await pointerScan(
      input(
        plantedDense(byLength, log, { fail: () => new ModelError('refusal', 'declined') }),
        new Cassette(),
      ),
    );
    // Two files and two sets: four windows, each asked twice.
    expect(log).toHaveLength(8);
    expect(result.failed).toHaveLength(4);
    expect(result.failed.every((line) => line.includes('declined'))).toBe(true);
  });

  it('stops on a miss when it may not record', async () => {
    await expect(
      pointerScan(input(replayOf(plantedDense(byLength)), new Cassette(), { mode: 'replay' })),
    ).rejects.toBeInstanceOf(CassetteMiss);
  });

  it('gives the labeler no text of a unit it cannot point at', async () => {
    const seen: string[] = [];
    const labeler = plantedDense((window) => {
      seen.push(...window.units.map((unit) => unit.text));
      return [];
    });
    await pointerScan(
      input(labeler, new Cassette(), {
        files: [{ path: 'a.md', text: '# T\n\n```sh\nsecret fence\n```\n\nA sentence.\n' }],
      }),
    );
    expect(seen.join('\n')).not.toContain('secret fence');
  });

  it('halves a window the endpoint refuses as too large, records the refusal, and replays the same halves', async () => {
    const tooLarge = () => new ModelError('http', '400 max_tokens_exceeded', { status: 400 });
    const log: string[] = [];
    const files = [{ path: 'quay.md', text: QUAY }];
    const refuseOver = (limit: number) => (window: Window) =>
      window.units.length > limit ? tooLarge() : undefined;
    const cassette = new Cassette();
    const first = await pointerScan(
      input(plantedDense(byLength, log, { fail: refuseOver(2) }), cassette, { files, windowUnits: 12 }),
    );
    // Six units: the window of six and the two halves of three are refused, the quarters of two and one answer.
    expect(first.failed).toEqual([]);
    expect(first.unlabeled).toBe(0);
    const perSet = [
      'quay.md#1',
      'quay.md#1a',
      'quay.md#1aa',
      'quay.md#1ab',
      'quay.md#1b',
      'quay.md#1ba',
      'quay.md#1bb',
    ];
    expect(log.map((entry) => entry.split(':')[0])).toEqual([...perSet, ...perSet]);
    expect(first.labelled.filter((item) => item.set.set === 'duty')).toHaveLength(6);
    expect([...cassette.entries.values()].some((entry) => entry.answer.refused === 'too_large')).toBe(true);

    const again = await pointerScan(
      input(replayOf(plantedDense(byLength)), Cassette.parse(cassette.render()), {
        files,
        windowUnits: 12,
        mode: 'replay',
      }),
    );
    expect(again.calls).toBe(0);
    expect(renderLedger(again.ledger)).toBe(renderLedger(first.ledger));
  });

  it('fails a window of one unit that is still refused as too large', async () => {
    const result = await pointerScan(
      input(
        plantedDense(byLength, [], {
          fail: () => new ModelError('http', '400 max_tokens_exceeded', { status: 400 }),
        }),
        new Cassette(),
        { files: [{ path: 'one.md', text: 'Lock the gate.\n' }] },
      ),
    );
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]).toContain('window of one unit');
  });
});

describe('requests in flight', () => {
  const many = Array.from({ length: 6 }, (_, at) => ({
    path: `note-${at}.md`,
    text: `# Note ${at}\n\n- Check the rope number ${at}\n- Close gate ${at}\n`,
  }));

  /** A labeler that counts the requests in flight at once. */
  function tracked(delay: number): { labeler: Labeler; peak: () => number } {
    const base = plantedDense(byLength, [], { delay });
    let now = 0;
    let peak = 0;
    const labeler: Labeler = {
      ...base,
      async call(wire, set, window) {
        now++;
        peak = Math.max(peak, now);
        try {
          return await (base.call as NonNullable<Labeler['call']>)(wire, set, window);
        } finally {
          now--;
        }
      },
    };
    return { labeler, peak: () => peak };
  }

  it('never exceeds the number of jobs, and uses them', async () => {
    const one = tracked(15);
    await pointerScan(input(one.labeler, new Cassette(), { files: many, jobs: 1 }));
    expect(one.peak()).toBe(1);
    const three = tracked(15);
    await pointerScan(input(three.labeler, new Cassette(), { files: many, jobs: 3 }));
    expect(three.peak()).toBeGreaterThan(1);
    expect(three.peak()).toBeLessThanOrEqual(3);
  });

  it('gives the same ledger and the same cassette bytes whatever the number of jobs', async () => {
    const serial = new Cassette();
    const first = await pointerScan(input(tracked(5).labeler, serial, { files: many, jobs: 1 }));
    const parallel = new Cassette();
    const second = await pointerScan(input(tracked(5).labeler, parallel, { files: many, jobs: 6 }));
    expect(renderLedger(second.ledger)).toBe(renderLedger(first.ledger));
    expect(parallel.render()).toBe(serial.render());
    expect(second.refusals).toEqual(first.refusals);
    expect(second.failed).toEqual(first.failed);
  });

  it('stops starting requests after a miss it cannot fix', async () => {
    const log: string[] = [];
    await expect(
      pointerScan(
        input(replayOf(plantedDense(byLength, log)), new Cassette(), {
          files: many,
          jobs: 2,
          mode: 'replay',
        }),
      ),
    ).rejects.toBeInstanceOf(CassetteMiss);
    expect(log).toEqual([]);
  });
});

describe('the plan and the cassette file', () => {
  it('reports the requests, the ones the cassette answers and the characters left to send', async () => {
    const plans: PointerPlan[] = [];
    const cassette = new Cassette();
    const first = await pointerScan(
      input(plantedDense(byLength), cassette, { onPlan: (plan) => plans.push(plan) }),
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]?.files).toBe(2);
    expect(plans[0]?.members).toEqual([
      expect.objectContaining({ id: 'planted', cls: 'system2', windows: 4, cached: 0 }),
    ]);
    expect(plans[0]?.members[0]?.characters).toBeGreaterThan(0);
    expect(first.plan).toEqual(plans[0]);

    // The same files with the answers in the cassette: nothing is left to send.
    const again: PointerPlan[] = [];
    await pointerScan(
      input(replayOf(plantedDense(byLength)), cassette, {
        mode: 'replay',
        onPlan: (plan) => again.push(plan),
      }),
    );
    expect(again[0]?.members[0]).toMatchObject({ windows: 4, cached: 4, characters: 0 });
  });

  it('hands each recorded answer to the cassette hook as it arrives', async () => {
    const seen: string[] = [];
    const cassette = new Cassette();
    cassette.onPut = (entry) => seen.push(entry.readable.window ?? '');
    await pointerScan(input(plantedDense(byLength), cassette));
    expect(seen.sort()).toEqual(['office.md#1', 'office.md#1', 'quay.md#1', 'quay.md#1']);
  });
});

describe('a labeler that answers several times', () => {
  const order = (window: Window): Labelled[] => [{ units: `1-${window.units.length}`, label: 'order' }];
  /** Answers `order` on every unit, except that the given run calls say `remark` for the first unit. */
  const wavering = (differ: (call: number, window: Window) => boolean) => {
    const calls = new Map<string, number>();
    return plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        if (!differ(call, window) || window.units.length < 2) return order(window);
        return [
          { units: '1', label: 'remark' },
          { units: `2-${window.units.length}`, label: 'order' },
        ];
      },
      [],
      { runs: 3 },
    );
  };
  const duty = (labeler: Labeler, cassette: Cassette) =>
    pointerScan(input(labeler, cassette, { sets: load(SETS).slice(0, 1) }));

  it('asks every window once per run and records each run as its own answer', async () => {
    const cassette = new Cassette();
    const result = await duty(
      wavering(() => false),
      cassette,
    );
    // Two files, one window each, three runs.
    expect(result.windows).toBe(6);
    expect(cassette.entries.size).toBe(6);
    expect(result.plan.members[0]?.windows).toBe(6);
    expect(result.unlabeled).toBe(0);
  });

  it('takes the label two runs out of three give', async () => {
    // The third run of the quay says remark for its first unit; the two others say order.
    const result = await duty(
      wavering((call, window) => call === 3 && window.path === 'quay.md'),
      new Cassette(),
    );
    expect(result.unlabeled).toBe(0);
    expect(result.voted).toBe(1);
    const quay = result.ledger.entries.filter((entry) => entry.path === 'quay.md');
    expect(quay.filter((entry) => entry.labels.duty?.label === 'order')).toHaveLength(quay.length);
  });

  it('leaves a unit unlabeled when two runs do not name it, and does not call that a split', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        // The second and third runs of the office leave its last unit out.
        const left = call >= 2 && window.path === 'office.md' ? window.units.length - 1 : window.units.length;
        return [{ units: `1-${left}`, label: 'order' }];
      },
      [],
      { runs: 3 },
    );
    const result = await duty(labeler, new Cassette());
    expect(result.unlabeled).toBe(1);
    expect(result.split).toBe(0);
  });

  it('replays the runs from the cassette with no call', async () => {
    const cassette = new Cassette();
    const first = await duty(
      wavering(() => false),
      cassette,
    );
    const second = await pointerScan(
      input(replayOf(wavering(() => false)), Cassette.parse(cassette.render()), {
        sets: load(SETS).slice(0, 1),
        mode: 'replay',
      }),
    );
    expect(second.calls).toBe(0);
    expect(renderLedger(second.ledger)).toBe(renderLedger(first.ledger));
  });
});

describe('runs that split between labels of one atom kind', () => {
  const KINDS = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        atom: { kind: instruction, polarity: obligation }
      - name: ban
        description: A unit that tells the skipper what never to do.
        atom: { kind: instruction, polarity: prohibition }
      - name: voice
        description: A unit about how the skipper words a reply.
        atom: { kind: register }
      - name: remark
        description: A unit that only says how the quay is.
      - name: aside
        description: A unit that only tells a story about the quay.
`;
  /** Five runs; run n labels every unit of every window `labels[n - 1]`. */
  const byRun = (labels: string[]) => {
    const calls = new Map<string, number>();
    return plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        return [{ units: `1-${window.units.length}`, label: labels[call - 1] as string }];
      },
      [],
      { runs: 5 },
    );
  };
  const scan = (labels: string[]) => pointerScan(input(byRun(labels), new Cassette(), { sets: load(KINDS) }));
  const labelsOf = (result: Awaited<ReturnType<typeof scan>>) =>
    new Set(result.ledger.entries.map((entry) => entry.labels.duty?.label ?? '(unlabeled)'));

  it('takes the label of the kind most runs give when no single label has a majority', async () => {
    // order 2, ban 1, remark 1, aside 1: no label has three of five, but three runs build an instruction, and order is
    // the label most of them give.
    const result = await scan(['order', 'remark', 'ban', 'aside', 'order']);
    expect(result.unlabeled).toBe(0);
    expect(labelsOf(result)).toEqual(new Set(['order']));
  });

  it('leaves a tie inside a kind unlabeled: an obligation against a prohibition is two different atoms', async () => {
    // order 2, ban 2, remark 1: four runs build an instruction, but the two labels tie; the two runs asked for the
    // split say order and ban, so it still ties, 3 against 3.
    const result = await scan(['order', 'ban', 'order', 'ban', 'remark', 'order', 'ban']);
    expect(result.unlabeled).toBe(result.ledger.entries.length);
  });

  it('decides between labels that build no atom, as one group', async () => {
    // remark 1, aside 2, order 1, ban 1: three runs say the unit gives nothing; aside is the label most of them give.
    const result = await scan(['remark', 'aside', 'order', 'aside', 'ban']);
    expect(result.unlabeled).toBe(0);
    expect(labelsOf(result)).toEqual(new Set(['aside']));
  });

  it('never lets runs that point a condition at different units vote together', async () => {
    // when 2 at unit 2, when 1 at unit 3, ban 2: three runs say the first unit is a condition, but they split on
    // which unit it scopes, so no group holds three of five and the unit stays unlabeled.
    const SCOPED = `${KINDS}      - name: when
        description: A unit that only says when another unit applies.
        target: required
        condition: true
`;
    const calls = new Map<string, number>();
    const plan: Array<[string, number?]> = [['when', 2], ['ban'], ['when', 2], ['ban'], ['when', 3]];
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        if (window.units.length < 3) return [{ units: `1-${window.units.length}`, label: 'remark' }];
        const [label, target] = plan[call - 1] ?? ['remark'];
        return [
          { units: '1', label, ...(target ? { target } : {}) } as Labelled,
          { units: `2-${window.units.length}`, label: 'remark' },
        ];
      },
      [],
      { runs: 5 },
    );
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SCOPED) }));
    const firsts = result.ledger.entries.filter((entry) => entry.index === 0 && entry.path === 'office.md');
    expect(firsts.length).toBeGreaterThan(0);
    expect(firsts.map((entry) => entry.labels.duty?.label)).toEqual(firsts.map(() => undefined));
  });

  it('keeps a condition out of the group of labels that build no atom', async () => {
    // when 1, remark 1, aside 1, order 1, ban 1, then two runs asked for the split say when at unit 3 and at unit 2:
    // remark and aside build no atom, two of seven. A condition acts through its target, so it is no voice for that
    // group, and the unit stays unlabeled.
    const SCOPED = `${KINDS}      - name: when
        description: A unit that only says when another unit applies.
        target: required
        condition: true
`;
    const calls = new Map<string, number>();
    const plan: Array<[string, number?]> = [
      ['when', 2],
      ['remark'],
      ['aside'],
      ['order'],
      ['ban'],
      ['when', 3],
      ['when', 2],
    ];
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        if (window.units.length < 3) return [{ units: `1-${window.units.length}`, label: 'remark' }];
        const [label, target] = plan[call - 1] ?? ['remark'];
        return [
          { units: '1', label, ...(target ? { target } : {}) } as Labelled,
          { units: `2-${window.units.length}`, label: 'remark' },
        ];
      },
      [],
      { runs: 5 },
    );
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SCOPED) }));
    const firsts = result.ledger.entries.filter((entry) => entry.index === 0 && entry.path === 'office.md');
    expect(firsts.length).toBeGreaterThan(0);
    expect(firsts.map((entry) => entry.labels.duty?.label)).toEqual(firsts.map(() => undefined));
  });

  it('leaves the splits of a set whose labels build no atom as they are', async () => {
    // The same labels with no atom, as the document roles: remark 1, aside 2, order 1, ban 1. No label has three of
    // five and the labels do not group, so every unit stays unlabeled.
    const ROLES = KINDS.replace(/\n {8}atom: \{[^}]*\}/g, '');
    const result = await pointerScan(
      input(byRun(['remark', 'aside', 'order', 'aside', 'ban']), new Cassette(), { sets: load(ROLES) }),
    );
    expect(result.unlabeled).toBe(result.ledger.entries.length);
  });

  it('asks a window with a tie inside a kind two more times, and the extra voices decide', async () => {
    // order 2, ban 2, remark 1 tie inside the instruction kind; runs 6 and 7 say order, so order holds 4 of 7.
    const cassette = new Cassette();
    const labeler = byRun(['order', 'ban', 'order', 'ban', 'remark', 'order', 'order']);
    const result = await pointerScan(input(labeler, cassette, { sets: load(KINDS) }));
    const files = new Set(result.ledger.entries.map((entry) => entry.path)).size;
    expect(SPLIT_REASK_RUNS).toBe(2);
    expect(result.reasked).toHaveLength(files * SPLIT_REASK_RUNS);
    expect(result.reasked[0]).toMatch(/asked again as run 6 for \d+ split units/);
    expect(result.unlabeled).toBe(0);
    expect(labelsOf(result)).toEqual(new Set(['order']));
    // The extra runs are recorded answers: a replay reads them with no call and gives the same ledger.
    const replayed = await pointerScan(
      input(replayOf(labeler), Cassette.parse(cassette.render()), { sets: load(KINDS), mode: 'replay' }),
    );
    expect(replayed.calls).toBe(0);
    expect(renderLedger(replayed.ledger)).toBe(renderLedger(result.ledger));
  });

  it('asks two more runs for a split between atom kinds, and only a majority decides', async () => {
    // order 2, voice 2, remark 1: an instruction against a register, as R9 of the Northwind fixture. The window is
    // asked twice more; both say voice, so voice holds 4 of 7.
    const settled = await scan(['order', 'voice', 'order', 'voice', 'remark', 'voice', 'voice']);
    expect(settled.reasked).toHaveLength(new Set(settled.ledger.entries.map((entry) => entry.path)).size * 2);
    expect(labelsOf(settled)).toEqual(new Set(['voice']));
  });

  it('leaves a split between atom kinds unlabeled: a reply rule against a rule is not resolved', async () => {
    // order 2, voice 2, remark 1: an instruction against a register, as R9 of the Northwind fixture splits. The two
    // runs asked for the split say order and voice, so no label or kind holds four of seven: the unit stays unlabeled
    // and counts as a split.
    const result = await scan(['order', 'voice', 'order', 'voice', 'remark', 'order', 'voice']);
    expect(result.unlabeled).toBe(result.ledger.entries.length);
    expect(result.split).toBe(result.ledger.entries.length);
  });
});

describe('what the cassette key holds', () => {
  it('misses in replay when only the model of the labeler changed, which the body does not hold', async () => {
    const recorded = new Cassette();
    await pointerScan(input(plantedDense(byLength, [], { model: 'model-a' }), recorded));
    await expect(
      pointerScan(
        input(replayOf(plantedDense(byLength, [], { model: 'model-b' })), recorded, { mode: 'replay' }),
      ),
    ).rejects.toThrow(/differs in: .*model/);
  });

  it('misses in replay when only the polarity of a label atom changed', async () => {
    const recorded = new Cassette();
    await pointerScan(input(plantedDense(byLength), recorded));
    const edited = load(SETS.replace('polarity: obligation', 'polarity: prohibition'));
    await expect(
      pointerScan(input(replayOf(plantedDense(byLength)), recorded, { sets: edited, mode: 'replay' })),
    ).rejects.toThrow(/differs in: .*setHash/);
  });
});

describe('an even split of the runs between the generic rule and a specific label', () => {
  // The shipped set's name carries its tie break; the labels are the shipped names, the text invented.
  const TIED = `labels:
  - set: agent-rules
    description: What the harbour notes ask of a skipper.
    labels:
      - name: rule
        description: A unit that tells the skipper to do something.
        atom: { kind: instruction, polarity: obligation }
      - name: gate
        description: A unit that sets one act before another.
        atom: { kind: gate }
      - name: hazard-compaction
        description: A unit about what the skipper does after the log was cut short.
        atom: { kind: hazard }
      - name: prohibition
        description: A unit that forbids.
        atom: { kind: instruction, polarity: prohibition }
      - name: condition
        description: A unit that only says when another unit applies.
        target: required
`;
  /** Four runs; run k answers labels[k - 1] on the first unit of every window and rule on the others. */
  const runs = (labels: string[], target?: number) => {
    const calls = new Map<string, number>();
    return plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        const first = labels[call - 1] as string;
        return window.units.map((unit) =>
          unit.n === 1
            ? ({
                units: '1',
                label: first,
                ...(first === 'condition' ? { target: target ?? 2 } : {}),
              } as Labelled)
            : ({ units: String(unit.n), label: 'rule' } as Labelled),
        );
      },
      [],
      { runs: 4 },
    );
  };
  const firstLabel = async (labels: string[]) => {
    const result = await pointerScan(input(runs(labels), new Cassette(), { sets: load(TIED) }));
    return result.ledger.entries
      .filter((entry) => entry.index === 0)
      .map((entry) => entry.labels['agent-rules']?.label);
  };

  it('gives the unit the specific label when the runs split two and two between rule and a gate or a hazard', async () => {
    expect(await firstLabel(['rule', 'hazard-compaction', 'hazard-compaction', 'rule'])).toEqual([
      'hazard-compaction',
      'hazard-compaction',
    ]);
    expect(await firstLabel(['gate', 'rule', 'rule', 'gate'])).toEqual(['gate', 'gate']);
  });

  it('leaves a three-way tie unlabeled', async () => {
    expect(await firstLabel(['rule', 'hazard-compaction', 'gate', 'prohibition'])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('leaves a tie between two specific labels unlabeled', async () => {
    expect(await firstLabel(['gate', 'hazard-compaction', 'gate', 'hazard-compaction'])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('leaves a tie between rule and condition unlabeled: a condition gives no instruction of its own', async () => {
    expect(await firstLabel(['rule', 'condition', 'condition', 'rule'])).toEqual([undefined, undefined]);
  });

  it('leaves a split of one run on each side unlabeled', async () => {
    // Two runs give the unit nothing: one rule and one hazard are a single run per side.
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        const rest = window.units
          .filter((unit) => unit.n > 1)
          .map((unit) => ({ units: String(unit.n), label: 'rule' }) as Labelled);
        if (call === 1) return [{ units: '1', label: 'rule' } as Labelled, ...rest];
        if (call === 2) return [{ units: '1', label: 'hazard-compaction' } as Labelled, ...rest];
        return rest;
      },
      [],
      { runs: 4 },
    );
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(TIED) }));
    expect(
      result.ledger.entries
        .filter((entry) => entry.index === 0)
        .map((entry) => entry.labels['agent-rules']?.label),
    ).toEqual([undefined, undefined]);
  });

  it('breaks no tie in a set of another name', async () => {
    const other = TIED.replace('set: agent-rules', 'set: harbour');
    const result = await pointerScan(
      input(runs(['rule', 'hazard-compaction', 'hazard-compaction', 'rule']), new Cassette(), {
        sets: load(other),
      }),
    );
    expect(
      result.ledger.entries.filter((entry) => entry.index === 0).map((entry) => entry.labels.harbour?.label),
    ).toEqual([undefined, undefined]);
  });
});

describe('a run out of step with the units of its window', () => {
  const SPANNED = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    spans:
      - { name: act, description: the clause that says what the skipper does }
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        spans: [act]
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
`;
  const unlocated = { kind: 'act', from: -1, to: -1, unlocated: 'the text is not in the unit' };
  const located = { kind: 'act', from: 0, to: 3 };
  /** Every unit gets `label`, quoting `spans`. */
  const every = (window: Window, label: string, spans: unknown[]): Labelled[] =>
    window.units.map((unit) => ({ units: String(unit.n), label, spans }) as Labelled);

  it('counts the quoted clauses and those not in their unit, and names a run out of step only past both bounds', () => {
    const answer = (spans: unknown[]) => ({ labels: [{ units: '1', label: 'order', spans }] });
    // 7 of 22, as the slipped run of the Northwind fixture: out of step.
    expect(outOfStep(answer([...Array(7).fill(unlocated), ...Array(15).fill(located)]))).toEqual({
      quoted: 22,
      unlocated: 7,
    });
    // 2 of 11 and 2 of 20, as the runs in step: in step.
    expect(outOfStep(answer([...Array(2).fill(unlocated), ...Array(9).fill(located)]))).toBeUndefined();
    // Exactly a quarter is not more than a quarter.
    expect(outOfStep(answer([...Array(4).fill(unlocated), ...Array(12).fill(located)]))).toBeUndefined();
    // Under four clauses missed is never enough, whatever the share.
    expect(outOfStep(answer(Array(OUT_OF_STEP_MIN - 1).fill(unlocated)))).toBeUndefined();
    expect(outOfStep(answer(Array(OUT_OF_STEP_MIN).fill(unlocated)))).toEqual({ quoted: 4, unlocated: 4 });
    expect(OUT_OF_STEP_SHARE).toBe(0.25);
    expect(outOfStep({ labels: [{ units: '1', label: 'remark' }] })).toBeUndefined();
  });

  it('leaves the slipped run out of the vote, and lists it, so the runs in step decide', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        // The second run says remark everywhere and quotes four clauses per unit that are in none of them.
        return call === 2
          ? every(window, 'remark', Array(4).fill(unlocated))
          : every(window, 'order', [located]);
      },
      [],
      { runs: 3 },
    );
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SPANNED) }));
    // One window per file; its slipped run 2 is asked again as run 4, in step.
    const files = new Set(result.ledger.entries.map((entry) => entry.path)).size;
    expect(result.outOfStep).toHaveLength(files);
    expect(result.reasked).toHaveLength(files);
    expect(result.outOfStep[0]).toMatch(
      /run 2 of planted: \d+ of \d+ quoted clauses are not in their unit; the run is left out of the vote/,
    );
    expect(result.unlabeled).toBe(0);
    expect(result.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('counts only the runs heard: three slipped runs of five leave the two in step to decide', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        // Runs 2, 3 and 4 slip; runs 1 and 5 say order on every unit, as the Northwind window CLAUDE.md#1 of a
        // fresh draw did (three of five out of step, which left the whole window with no label).
        return call >= 2 && call <= 4
          ? every(window, 'remark', Array(4).fill(unlocated))
          : every(window, 'order', [located]);
      },
      [],
      { runs: 5 },
    );
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SPANNED) }));
    // Runs 2, 3 and 4 slip in each file's one window; their re-asks (runs 6, 7 and 8) answer order in step.
    const files = new Set(result.ledger.entries.map((entry) => entry.path)).size;
    expect(result.outOfStep).toHaveLength(files * 3);
    expect(result.unlabeled).toBe(0);
    expect(result.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('gives no opinion when fewer than two runs are heard', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        // Only the first of three runs is in step: one run heard is no vote.
        return call >= 2
          ? every(window, 'remark', Array(4).fill(unlocated))
          : every(window, 'order', [located]);
      },
      [],
      { runs: 3 },
    );
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SPANNED) }));
    expect(result.unlabeled).toBe(result.ledger.entries.length);
  });

  /** Five runs, then re-asks; call n of a window answers `plan[n - 1]` on every unit (`slip` quotes four lost clauses). */
  const scripted = (plan: string[]) => {
    const calls = new Map<string, number>();
    const log: number[] = [];
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        log.push(call);
        const said = plan[call - 1] ?? 'order';
        return said === 'slip'
          ? every(window, 'remark', Array(4).fill(unlocated))
          : every(window, said, said === 'order' ? [located] : []);
      },
      [],
      { runs: 5 },
    );
    return { labeler, log };
  };

  it('asks a window again after a slipped run, and the re-ask in step takes its place', async () => {
    // Heard without the re-ask: order 2, remark 2, a tie with no label. Run 6 says order: three of five.
    const { labeler } = scripted(['order', 'slip', 'remark', 'remark', 'order', 'order']);
    const cassette = new Cassette();
    const result = await pointerScan(input(labeler, cassette, { sets: load(SPANNED) }));
    const files = result.windows / 6;
    expect(result.reasked).toHaveLength(files);
    expect(result.reasked[0]).toMatch(/run 2 of planted: asked again as run 6, in step/);
    expect(result.unlabeled).toBe(0);
    expect(result.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
    // The re-ask is its own recorded answer, so a replay reads it with no call.
    expect(cassette.entries.size).toBe(result.windows);
    const replayed = await pointerScan(
      input(replayOf(labeler), Cassette.parse(cassette.render()), { sets: load(SPANNED), mode: 'replay' }),
    );
    expect(replayed.calls).toBe(0);
    expect(renderLedger(replayed.ledger)).toBe(renderLedger(result.ledger));
  });

  it('stops after three re-asks that slip, and leaves the slipped run unheard', async () => {
    const { labeler, log } = scripted([
      'order',
      'slip',
      'order',
      'remark',
      'remark',
      'slip',
      'slip',
      'slip',
      'order',
    ]);
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SPANNED) }));
    expect(Math.max(...log)).toBe(5 + REASK_LIMIT);
    expect(result.reasked).toEqual([]);
    // Four runs heard: order 2, remark 2, a split.
    expect(result.unlabeled).toBe(result.ledger.entries.length);
  });

  it('keeps a run of a single-run labeler: it has no vote to leave', async () => {
    const labeler = plantedDense((window) => every(window, 'order', Array(4).fill(unlocated)), [], {
      runs: 1,
    });
    const result = await pointerScan(input(labeler, new Cassette(), { sets: load(SPANNED) }));
    expect(result.outOfStep).toEqual([]);
    expect(result.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });
});

describe('spans across the runs of a labeler', () => {
  const SPANNED = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    spans:
      - { name: act, description: the clause that says what the skipper does }
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        spans: [act]
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
`;
  const answer = (window: Window, end: number): Labelled[] =>
    window.units.map((unit) => ({
      units: String(unit.n),
      label: 'order',
      spans: [{ kind: 'act', from: 0, to: Math.min(end, unit.text.length) }],
    }));
  const spanScan = (labeler: Labeler) => pointerScan(input(labeler, new Cassette(), { sets: load(SPANNED) }));

  it('keeps the spans every run gave the same, with the label', async () => {
    const result = await spanScan(plantedDense((window) => answer(window, 3), [], { runs: 3 }));
    expect(result.spanSplit).toBe(0);
    const entry = result.ledger.entries.find(
      (candidate) => candidate.quote === 'Coil the ropes on the red post',
    );
    expect(entry?.labels.duty?.spans).toEqual([{ kind: 'act', from: 0, to: 3 }]);
  });

  it('keeps the label and the spans of the first run when the runs drew them differently, and counts the units', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        return answer(window, call === 2 ? 4 : 3);
      },
      [],
      { runs: 3 },
    );
    const result = await spanScan(labeler);
    expect(result.unlabeled).toBe(0);
    expect(result.spanSplit).toBeGreaterThan(0);
    for (const entry of result.ledger.entries.filter((candidate) => candidate.labels.duty)) {
      expect(entry.labels.duty?.label).toBe('order');
      expect(entry.labels.duty?.spans?.[0]?.to).toBe(3);
    }
  });

  it('drops a span that leaves its unit, counts it, and keeps the label of that unit', async () => {
    const result = await spanScan(
      plantedDense(
        (window) =>
          answer(window, 999).map((entry) => ({ ...entry, spans: [{ kind: 'act', from: 0, to: 999 }] })),
        [],
        { runs: 1 },
      ),
    );
    expect(result.refusals).toEqual([]);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.dropped[0]).toMatch(/offsets leave the unit/);
    expect(result.decided).toBeGreaterThan(0);
  });
});

describe('a vote of two runs out of three for the labels that carry spans', () => {
  const VOTE = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    spans:
      - { name: act, description: the clause that says what the skipper does }
    labels:
      - name: order
        description: A unit that tells the skipper what to do before something else.
        spans: [act]
        atom: { kind: instruction, polarity: obligation }
      - name: remark
        description: A unit that only says how the quay is.
        atom: { kind: instruction, polarity: obligation }
`;
  /** Each run answers every unit of every window from its own table, by run number (the nth ask of a window). */
  const runs = (
    table: (run: number, unit: { text: string }) => Labelled['label'] | undefined,
    text = 'Coil',
  ) => {
    const calls = new Map<string, number>();
    return plantedDense(
      (window) => {
        const run = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, run);
        return window.units.flatMap((unit): Labelled[] => {
          const label = table(run, unit);
          if (label === undefined) return [];
          const at = unit.text.indexOf(text);
          return [
            {
              units: String(unit.n),
              label,
              ...(label === 'order' && unit.text.startsWith(text)
                ? { spans: [{ kind: 'act', from: at, to: at + text.length }] }
                : {}),
            },
          ];
        });
      },
      [],
      { runs: 3 },
    );
  };
  const go = (labeler: Labeler) => pointerScan(input(labeler, new Cassette(), { sets: load(VOTE) }));
  const coil = (unit: { text: string }) => unit.text.startsWith('Coil the ropes');

  it('takes a label that carries spans when two runs out of three give it, with the spans of those two', async () => {
    const result = await go(runs((run, unit) => (coil(unit) ? (run === 3 ? 'remark' : 'order') : 'remark')));
    const entry = result.ledger.entries.find((candidate) => candidate.quote.startsWith('Coil the ropes'));
    expect(entry?.labels.duty?.label).toBe('order');
    expect(entry?.labels.duty?.spans).toEqual([{ kind: 'act', from: 0, to: 4 }]);
    expect(result.voted).toBeGreaterThan(0);
  });

  it('takes the label two runs out of three give, with or without spans', async () => {
    const result = await go(runs((run, unit) => (coil(unit) ? (run === 3 ? 'order' : 'remark') : 'remark')));
    const entry = result.ledger.entries.find((candidate) => candidate.quote.startsWith('Coil the ropes'));
    expect(entry?.labels.duty?.label).toBe('remark');
    expect(result.voted).toBeGreaterThan(0);
  });

  it('counts a run that left the unit out as no vote, so two runs of the label still win', async () => {
    const result = await go(runs((run, unit) => (coil(unit) ? (run === 3 ? undefined : 'order') : 'remark')));
    const entry = result.ledger.entries.find((candidate) => candidate.quote.startsWith('Coil the ropes'));
    expect(entry?.labels.duty?.label).toBe('order');
  });

  it('leaves a unit unlabeled when two runs out of three disagree with each other, whatever the third says', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const run = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, run);
        return window.units.map((unit) => ({
          units: String(unit.n),
          label: coil(unit) ? (['order', 'remark', 'none'][run - 1] as string) : 'remark',
        }));
      },
      [],
      { runs: 3 },
    );
    const result = await go(labeler);
    const entry = result.ledger.entries.find((candidate) => candidate.quote.startsWith('Coil the ropes'));
    expect(entry?.labels.duty).toBeUndefined();
  });

  it('keeps the label and the spans of the first run when the runs of the label point at different clauses', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const run = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, run);
        return window.units.map((unit) => ({
          units: String(unit.n),
          label: 'order',
          spans: [{ kind: 'act', from: 0, to: run === 1 ? 4 : run === 2 ? 3 : 2 }],
        }));
      },
      [],
      { runs: 3 },
    );
    const result = await go(labeler);
    const entry = result.ledger.entries.find((candidate) => candidate.quote.startsWith('Coil the ropes'));
    expect(entry?.labels.duty?.label).toBe('order');
    expect(entry?.labels.duty?.spans).toEqual([{ kind: 'act', from: 0, to: 4 }]);
    expect(result.spanSplit).toBeGreaterThan(0);
  });
});

describe('an answer that stopped at a refusal or at max_tokens, on the Anthropic labeler', () => {
  // Invented notes of a bakery counter: one window of two units in the set counter-voice.
  const NOTES = [{ path: 'notes.md', text: 'Greet every customer by name.\n\nRye costs four coins.\n' }];
  const ANSWER = '{"labels":[{"units":"1","label":"greeting"},{"units":"2","label":"price-claim"}]}';
  const reply = (stop: string) => ({
    model: 'claude-haiku-5-5',
    stop_reason: stop,
    content: [{ type: 'text', text: stop === 'end_turn' ? ANSWER : '' }],
    usage: { input_tokens: 10, output_tokens: 4 },
  });

  /** A fetch that answers the n-th request with the n-th stop reason, and keeps what it was sent. */
  const answering = (stops: string[], calls: Call[]) => async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const stop = stops[Math.min(calls.length, stops.length) - 1] as string;
    return new Response(JSON.stringify(reply(stop)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  // One run per window, so every request counted here is the first ask of the window or its retry.
  const scan = (stops: string[], calls: Call[]) =>
    pointerScan({
      files: NOTES,
      sets: load(BAKERY),
      labelling: singleLabelling(
        createAnthropicLabeler({ key: 'k', runs: 1, fetch: answering(stops, calls) }),
      ),
      cassette: new Cassette(),
      mode: 'record',
    });

  for (const refused of ['refusal', 'max_tokens']) {
    it(`retries once after ${refused} and applies the second answer`, async () => {
      const calls: Call[] = [];
      const result = await scan([refused, 'end_turn'], calls);
      expect(calls).toHaveLength(2);
      expect(result.failed).toEqual([]);
      expect(result.labelled.map((item) => item.label).sort()).toEqual(['greeting', 'price-claim']);
    });

    it(`lists the window as failed after ${refused} twice, and labels nothing from it`, async () => {
      const calls: Call[] = [];
      const result = await scan([refused, refused], calls);
      expect(calls).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toContain('notes.md#1');
      expect(result.labelled).toEqual([]);
    });
  }
});

describe('an answer the scan refuses as a whole', () => {
  it('is asked again once, and the second answer applies', async () => {
    const asked = new Map<string, number>();
    const labeler = plantedDense((window, set) => {
      const key = `${window.id}:${set.set}`;
      const times = (asked.get(key) ?? 0) + 1;
      asked.set(key, times);
      return times === 1 ? [{ units: '1', label: 'nonexistent' }] : byLength(window, set);
    });
    const result = await pointerScan(input(labeler, new Cassette()));
    expect(result.failedWindows).toEqual([]);
    expect([...asked.values()].every((times) => times === 2)).toBe(true);
    expect(result.unlabeled).toBe(0);
    expect(result.labelled.length).toBeGreaterThan(0);
  });

  it('lists the units no answer named', async () => {
    const partial = (window: Window, set: LabelSet): Labelled[] =>
      byLength(window, set).filter((entry) => !(set.set === 'duty' && entry.units === '2'));
    const result = await pointerScan(input(plantedDense(partial), new Cassette()));
    expect(result.unlabeledUnits.length).toBe(FILES.length);
    expect(result.unlabeledUnits.every((gap) => gap.set === 'duty')).toBe(true);
    expect(result.unlabeled).toBe(result.unlabeledUnits.length);
  });

  it('lists the units a label stopped selecting', async () => {
    const first = await pointerScan(input(plantedDense(byLength), new Cassette()));
    const none = (window: Window): Labelled[] => [{ units: `1-${window.units.length}`, label: 'none' }];
    const second = await pointerScan(
      input(
        plantedDense((window, set) => (set.set === 'duty' ? none(window) : byLength(window, set))),
        new Cassette(),
        {
          previous: first.ledger,
          sets: load(SETS.replace('tells the skipper what to do', 'asks the skipper')),
        },
      ),
    );
    expect(second.flips.length).toBeGreaterThan(0);
    expect(
      second.flips.every((flip) => flip.set === 'duty' && flip.from === 'order' && flip.to === 'none'),
    ).toBe(true);
  });
});

describe('the warnings of a recording run', () => {
  const first = (model: string): Labeler => {
    const planted = plantedDense(byLength);
    return {
      ...planted,
      async call(wire, set, window, attempt) {
        const answer = await (planted.call as NonNullable<Labeler['call']>)(wire, set, window, attempt);
        return { ...answer, returnedModel: model };
      },
    };
  };

  it('names both models when a re-record returns another model than the cassette holds', async () => {
    const cassette = new Cassette();
    await pointerScan(input(first('m-1'), cassette));
    expect(cassette.entries.size).toBeGreaterThan(1);
    const [oldest] = [...cassette.entries.keys()];
    cassette.entries.delete(oldest as string);
    const result = await pointerScan(input(first('m-2'), cassette));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('m-1');
    expect(result.warnings[0]).toContain('m-2');
  });

  it('has none when every answer names the same model', async () => {
    const result = await pointerScan(input(first('m-1'), new Cassette()));
    expect(result.warnings).toEqual([]);
  });
});

describe('the windows of a file over the character budget', () => {
  const section = (title: string, rules: number) =>
    [`# ${title}`, '', ...Array.from({ length: rules }, (_, at) => `Rule ${title} number ${at}.`)].join(
      '\n\n',
    );

  it('are cut only at a heading, every window starts at one, and no unit is in two', () => {
    const text = `${section('Alpha', 6)}\n\n${section('Beta', 6)}\n\n${section('Gamma', 6)}\n`;
    const units = cut(text).units;
    const whole = windowsOf('big.md', units, 1000);
    expect(whole).toHaveLength(1);
    const windows = windowsOf('big.md', units, 1000, text, 170);
    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(units[window.units[0]?.index as number]?.container).toBe('heading');
      expect(window.units.reduce((sum, unit) => sum + unit.text.length, 0)).toBeLessThanOrEqual(170);
    }
    const seen = windows.flatMap((window) => window.units.map((unit) => unit.index));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(units.length);
  });

  it('are cut at the unit when no heading falls inside the run', () => {
    const text = Array.from({ length: 30 }, (_, at) => `A plain rule number ${at}.`).join('\n\n');
    const windows = windowsOf('flat.md', cut(text).units, 1000, text, 100);
    expect(windows.length).toBeGreaterThan(3);
    expect(windows.reduce((sum, window) => sum + window.units.length, 0)).toBe(30);
  });
});

describe('a rescan sends the units it needs and shows the others as context', () => {
  it('marks the units that keep their label as context lines with their own numbers', async () => {
    const calls: string[] = [];
    const labeler: Labeler = {
      ...plantedDense(byLength),
      async call(wire, set, window, attempt) {
        calls.push(
          `${window.id}:${window.units.map((unit) => unit.n).join(',')}|${(window.display ?? []).map((line) => `${line.n}${line.mode}`).join(',')}`,
        );
        return (plantedDense(byLength).call as NonNullable<Labeler['call']>)(wire, set, window, attempt);
      },
    };
    const first = await pointerScan(
      input(labeler, new Cassette(), { files: [FILES[0] as (typeof FILES)[number]] }),
    );
    calls.length = 0;
    const edited = QUAY.replace('Name the skipper of every boat', 'Name the skipper of each boat');
    await pointerScan(
      input(labeler, new Cassette(), {
        files: [{ path: 'quay.md', text: edited }],
        previous: first.ledger,
      }),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const [units, display] = call.split('|');
      expect(units).not.toBe('');
      expect(display).toMatch(/context/);
    }
  });
});

describe('the path of a window and the layout of its request', () => {
  it('names the heading a window starts at, after the headings above it', () => {
    const text = '# Emails\n\nGreet the client.\n\n## Tone\n\nStay calm.\n';
    const [window] = windowsOf('emails.md', cut(text).units, 1000, text);
    expect(window?.headingPath).toEqual(['Emails']);
    const body = createAnthropicLabeler({}).render(load(SETS)[0] as LabelSet, window as Window).body as {
      messages: Array<{ content: string }>;
    };
    const lines = (body.messages[0]?.content ?? '').split('\n');
    expect(lines[0]).toBe('SET duty');
    expect(lines[1]).toMatch(/^DESCRIPTION /);
    expect(lines[2]).toBe('LABELS order | remark | none');
    expect(lines.find((line) => line.startsWith('WINDOW '))).toBe('WINDOW emails.md#1  path: Emails');
  });
});
