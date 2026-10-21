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
  type PointerInput,
  type PointerPlan,
  pointerScan,
  renderLedger,
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
  it('cut at a top-level heading and at the size, and leave an opaque unit out', () => {
    const text = '# One\n\nA first sentence. A second sentence.\n\n```sh\nrun\n```\n\n# Two\n\n- Item\n';
    const units = cut(text).units;
    const windows = windowsOf('a.md', units, 60);
    expect(windows.map((window) => window.units.length)).toEqual([3, 2]);
    expect(
      windows.flatMap((window) => window.units.map((unit) => units[unit.index]?.container)),
    ).not.toContain('opaque');
    expect(windowsOf('a.md', units, 2).map((window) => window.units.length)).toEqual([2, 1, 2]);
    expect(windows[1]?.id).toBe('a.md#2');
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
      { id: 'planted', cls: 'system2', model: 'planted-1', calls: 4, recorded: 4, input: 40, output: 16 },
    ]);

    const second = await pointerScan(
      input(replayOf(plantedDense(byLength)), Cassette.parse(cassette.render()), { mode: 'replay' }),
    );
    expect(second.calls).toBe(0);
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

  it('refuses a bad pointer, lists it, and labels nothing from it', async () => {
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
    expect(result.refusals).toEqual([
      'quay.md#1: "99" leaves the window',
      'quay.md#1: the label rotate is not in the set duty',
      'quay.md#1: "3" names a unit that is already labelled',
    ]);
    const duty = result.labelled.filter((item) => item.set.set === 'duty');
    // Only the accepted range 2-3 is labelled; the rest of the window got no accepted answer.
    expect(duty.map((item) => item.unit.text)).toEqual([
      'Coil the ropes on the red post',
      'Name the skipper of every boat',
    ]);
    expect(result.unlabeled).toBeGreaterThan(0);
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

  it('takes a label only when every run gives it', async () => {
    // The third run of the quay says remark for its first unit.
    const result = await duty(
      wavering((call, window) => call === 3 && window.path === 'quay.md'),
      new Cassette(),
    );
    expect(result.unlabeled).toBe(1);
    expect(result.split).toBe(1);
    const quay = result.ledger.entries.filter((entry) => entry.path === 'quay.md');
    expect(quay.filter((entry) => entry.labels.duty === undefined)).toHaveLength(1);
    expect(quay.filter((entry) => entry.labels.duty?.label === 'order').length).toBe(quay.length - 1);
  });

  it('leaves a unit unlabeled when a run does not name it, and does not call that a split', async () => {
    const calls = new Map<string, number>();
    const labeler = plantedDense(
      (window) => {
        const call = (calls.get(window.path) ?? 0) + 1;
        calls.set(window.path, call);
        // The second run of the office leaves its last unit out.
        const left =
          call === 2 && window.path === 'office.md' ? window.units.length - 1 : window.units.length;
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

  it('keeps the label and drops the spans when the runs gave different ones, and counts the units', async () => {
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
      expect(entry.labels.duty?.spans).toBeUndefined();
    }
  });

  it('refuses an entry whose span leaves its unit, counts it, and leaves that unit unlabeled', async () => {
    const result = await spanScan(
      plantedDense(
        (window) =>
          answer(window, 999).map((entry) => ({ ...entry, spans: [{ kind: 'act', from: 0, to: 999 }] })),
        [],
        { runs: 1 },
      ),
    );
    expect(result.refusals.length).toBeGreaterThan(0);
    expect(result.refusals[0]).toMatch(/offsets leave the unit/);
    expect(result.decided).toBe(0);
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
