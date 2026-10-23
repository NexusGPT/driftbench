import { ModelError } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import {
  Cassette,
  CLOSE_REASK_ATTEMPTS,
  type Labelled,
  type LedgerEntry,
  type PointerInput,
  pointerScan,
  singleLabelling,
  stackedLabelling,
} from '../../src/pointer';
import { load, plantedDense, plantedYesNo } from './support';

// Invented files: a harbour office with quays, ropes and skippers.
const NOTES = [
  '# Quay',
  '',
  '- Coil the ropes on the red post',
  '- Name the skipper of every boat',
  '- Hang the lamp before dusk',
  '- Count the boats twice',
  '- Close the gate when the quay is empty',
  '- Log each boat at the desk',
  '',
].join('\n');

const SET = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
      - name: remark
        description: A unit that only says how the quay is.
      - name: aside
        description: A unit that only tells a story about the quay.
`;

/** The unit the labeler cannot make up its mind about. */
const NOISY = 'Count the boats twice';

/**
 * Every unit is an order, except the noisy one: its seven draws (three runs, then the most voices a tie is asked for,
 * SPLIT_REASK_MAX) split three, three and one between three labels, so no label holds more than half; every later
 * draw says order, as a fresh draw of the same window might.
 */
const DRAWS = ['order', 'remark', 'aside', 'order', 'remark', 'order', 'remark'];

/** A set whose order carries a span, so a run can quote clauses that are in no unit and slip out of step. */
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
      - name: aside
        description: A unit that only tells a story about the quay.
        atom: { kind: register }
`;
/** The same set, with an order whose atom needs its act span: an order with no act is asked again with span-missing. */
const NEEDS = `labels:
  - set: duty
    description: What the harbour notes ask of a skipper.
    spans:
      - { name: act, description: the clause that says what the skipper does }
    labels:
      - name: order
        description: A unit that tells the skipper what to do.
        spans: [act]
        atom: { kind: instruction, polarity: obligation, situation: "\${span.act}" }
      - name: remark
        description: A unit that only says how the quay is.
      - name: aside
        description: A unit that only tells a story about the quay.
        atom: { kind: register }
`;
const unlocated = { kind: 'act', from: -1, to: -1, unlocated: 'the text is not in the unit' };

/**
 * Call n of the labeler answers `plan[n - 1]` on every unit: `slip` quotes four clauses that are in no unit; `bare`
 * is an order that gives no span; `refuse` is an order whose spans are an empty list, an entry the check refuses
 * inside an answer it accepts.
 */
const scripted = (plan: string[], options: Parameters<typeof plantedDense>[2] = {}) => {
  let call = 0;
  return plantedDense(
    (window) => {
      const said = plan[call++] ?? 'order';
      return window.units.map(
        (unit) =>
          ({
            units: String(unit.n),
            label: said === 'slip' ? 'remark' : said === 'bare' || said === 'refuse' ? 'order' : said,
            // A label that lists no span kind carries no spans: an empty list is refused as an entry.
            ...(said === 'slip'
              ? { spans: Array(4).fill(unlocated) }
              : said === 'order'
                ? { spans: [{ kind: 'act', from: 0, to: 3 }] }
                : said === 'refuse'
                  ? { spans: [] }
                  : {}),
          }) as Labelled,
      );
    },
    [],
    { runs: 5, ...options },
  );
};

function harbour() {
  const windows: string[][] = [];
  let asked = 0;
  const labeler = plantedDense(
    (window) => {
      windows.push(window.units.map((unit) => unit.text));
      return window.units.map(
        (unit): Labelled => ({
          units: String(unit.n),
          label: unit.text.includes(NOISY) ? (DRAWS[asked++] ?? 'order') : 'order',
        }),
      );
    },
    [],
    { runs: 3 },
  );
  return { labeler, windows, asked: () => asked };
}

const input = (
  over: Partial<PointerInput> & Pick<PointerInput, 'files'>,
  labeler: PointerInput['labelling'],
) =>
  ({
    sets: load(SET),
    labelling: labeler,
    cassette: new Cassette(),
    mode: 'record',
    // Three units to a window: the noisy unit sits with the lamp and the gate, away from the top of the file.
    windowUnits: 3,
    keepSections: false,
    ...over,
  }) satisfies PointerInput;

const noisyOf = (entries: readonly LedgerEntry[]): LedgerEntry => {
  const found = entries.find((entry) => entry.quote.includes(NOISY));
  if (!found) throw new Error('the noisy unit is not in the ledger');
  return found;
};

describe('a unit the labelers left unlabeled', () => {
  it('is kept in the ledger with the votes of every run, and holds no label', async () => {
    const { labeler } = harbour();
    const first = await pointerScan(
      input({ files: [{ path: 'quay.md', text: NOTES }] }, singleLabelling(labeler)),
    );
    expect(first.unlabeled).toBe(1);
    const noisy = noisyOf(first.ledger.entries);
    expect(noisy.labels.duty).toBeUndefined();
    expect(noisy.unlabeled?.duty?.votes).toEqual([
      {
        labeler: 'planted',
        runs: DRAWS.map((label) => ({ label, source: expect.any(String) })),
      },
    ]);
    // A complete vote is a decision: its rows in the unstable report carry no reason to ask again.
    const rows = first.unstable.filter((row) => row.unit === noisy.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.undecided === undefined)).toBe(true);
    // The other units kept an order and hold no such record.
    const others = first.ledger.entries.filter((entry) => entry !== noisy);
    expect(others.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
    expect(others.every((entry) => entry.unlabeled === undefined)).toBe(true);
  });

  it('is not asked again when the file changes elsewhere, and keeps its votes', async () => {
    const { labeler, windows, asked } = harbour();
    const cassette = new Cassette();
    const first = await pointerScan(
      input({ files: [{ path: 'quay.md', text: NOTES }], cassette }, singleLabelling(labeler)),
    );
    const before = noisyOf(first.ledger.entries);
    expect(asked()).toBe(DRAWS.length);
    windows.length = 0;

    // A new line above the first rope moves every window after it: the window of the noisy unit is another request.
    const edited = NOTES.replace('- Coil the ropes', '- Tie the bow line first\n- Coil the ropes');
    const second = await pointerScan(
      input(
        { files: [{ path: 'quay.md', text: edited }], cassette, previous: first.ledger },
        singleLabelling(labeler),
      ),
    );
    const after = noisyOf(second.ledger.entries);
    expect(after.id).toBe(before.id);
    expect(after.labels.duty).toBeUndefined();
    expect(after.unlabeled).toEqual(before.unlabeled);
    // No request holds the unit, and the labeler drew nothing more for it.
    expect(windows.flat().some((text) => text.includes(NOISY))).toBe(false);
    expect(asked()).toBe(DRAWS.length);
    // The new line was asked, in the one window that holds a unit that needs a label.
    expect(windows.length).toBe(3);
  });
});

describe('a unit the ledger must not keep unlabeled', () => {
  const files = [{ path: 'quay.md', text: NOTES }];
  const isNoisy = (unit: { text: string }) => unit.text.includes(NOISY);
  const replayOf = <T extends object>(labeler: T): T => ({ ...labeler, call: undefined });
  /** Every unit is an order; the noisy unit takes the label `said(n)` on the n-th draw made for it. */
  const drawing = (
    said: (draw: number) => string | undefined,
    options: Parameters<typeof plantedDense>[2] = {},
  ) => {
    let draws = 0;
    return plantedDense(
      (window) =>
        window.units.flatMap((unit): Labelled[] => {
          if (!isNoisy(unit)) return [{ units: String(unit.n), label: 'order' }];
          const label = said(draws++);
          return label === undefined ? [] : [{ units: String(unit.n), label }];
        }),
      [],
      { runs: 3, ...options },
    );
  };

  it('when the cassette lacks the answers its tie would be asked again for, so a later cassette decides it', async () => {
    // Runs 1 to 3 split three ways. The two answers asked for the tie say order: three of five.
    const draws = ['order', 'remark', 'aside', 'order', 'order'];
    const labeler = drawing((draw) => draws[draw] ?? 'order');
    const full = new Cassette();
    const recorded = await pointerScan(input({ files, cassette: full }, singleLabelling(labeler)));
    expect(noisyOf(recorded.ledger.entries).labels.duty?.label).toBe('order');

    // A cassette that holds the three runs and neither of the two later answers: the replay leaves the tie as it is.
    const cut = new Cassette();
    for (const entry of full.entries.values())
      if (Number(entry.readable.run) <= 3) cut.entries.set(entry.key, entry);
    expect(cut.entries.size).toBeLessThan(full.entries.size);
    const partial = await pointerScan(
      input({ files, cassette: cut, mode: 'replay' }, singleLabelling(replayOf(labeler))),
    );
    const tied = noisyOf(partial.ledger.entries);
    expect(tied.labels.duty).toBeUndefined();
    expect(tied.unlabeled).toBeUndefined();
    expect(reasonOf(partial, tied)).toBe('answers_missing');

    // A later scan from that ledger decides the unit. It records: a rescan asks only the units it needs, with the
    // others shown as context, so its requests are not those of the first scan.
    const later = await pointerScan(
      input({ files, cassette: full, previous: partial.ledger }, singleLabelling(labeler)),
    );
    expect(noisyOf(later.ledger.entries).labels.duty?.label).toBe('order');
    expect(later.keptUnlabeled).toBe(0);
  });

  it('when a request of its window failed, so the next scan asks it again', async () => {
    // Four of five runs answer (order, order, remark, aside: no label holds three of five) and the fifth fails.
    let requests = 0;
    const draws = ['order', 'order', 'remark', 'aside'];
    const flaky = drawing((draw) => draws[draw] ?? 'order', {
      runs: 5,
      fail: (window) =>
        window.units.some(isNoisy) && ++requests > 4
          ? new ModelError('http', '503 unavailable', { status: 503 })
          : undefined,
    });
    const cassette = new Cassette();
    const first = await pointerScan(input({ files, cassette }, singleLabelling(flaky)));
    expect(first.failed.length).toBeGreaterThan(0);
    const tied = noisyOf(first.ledger.entries);
    expect(tied.labels.duty).toBeUndefined();
    expect(tied.unlabeled).toBeUndefined();
    expect(reasonOf(first, tied)).toBe('window_failed');

    // The service is back: the unit is asked again, and the four recorded runs and the new one decide it.
    const second = await pointerScan(
      input(
        { files, cassette, previous: first.ledger },
        singleLabelling(drawing(() => 'order', { runs: 5 })),
      ),
    );
    expect(second.failed).toEqual([]);
    expect(noisyOf(second.ledger.entries).labels.duty?.label).toBe('order');
  });

  it('when the requests asked for its tie failed', async () => {
    // Two runs answer (order, remark) and every later request for the window fails: the two voices tie.
    let requests = 0;
    const flaky = drawing((draw) => ['order', 'remark'][draw] ?? 'order', {
      fail: (window) =>
        window.units.some(isNoisy) && ++requests > 2
          ? new ModelError('http', '503 unavailable', { status: 503 })
          : undefined,
    });
    const cassette = new Cassette();
    const first = await pointerScan(input({ files, cassette }, singleLabelling(flaky)));
    expect(first.failed.length).toBeGreaterThan(0);
    expect(noisyOf(first.ledger.entries).unlabeled).toBeUndefined();
    expect(reasonOf(first, noisyOf(first.ledger.entries))).toBe('window_failed');
    const second = await pointerScan(
      input({ files, cassette, previous: first.ledger }, singleLabelling(drawing(() => 'order'))),
    );
    expect(noisyOf(second.ledger.entries).labels.duty?.label).toBe('order');
  });

  it('when the request asked for its tie was too large and its window was halved', async () => {
    // Runs 1 to 3 split three ways. The first request for the tie is refused as too large for the window of three
    // units; its halves answer, but the voices do not reach the vote of the window: the tie stands.
    let big = 0;
    const draws = ['order', 'remark', 'aside'];
    const labeler = drawing((draw) => draws[draw] ?? 'order', {
      fail: (window) =>
        window.units.length === 3 && window.units.some(isNoisy) && ++big > 3
          ? new ModelError('http', '400 max_tokens_exceeded', {
              status: 400,
              providerType: 'max_tokens_exceeded',
            })
          : undefined,
    });
    const first = await pointerScan(input({ files }, singleLabelling(labeler)));
    expect(first.failed).toEqual([]);
    const tied = noisyOf(first.ledger.entries);
    expect(tied.labels.duty).toBeUndefined();
    expect(tied.unlabeled).toBeUndefined();
    expect(reasonOf(first, tied)).toBe('answers_missing');
  });

  const quay = [{ path: 'quay.md', text: '# Quay\n\n- Coil the ropes on the red post\n' }];
  const spanned = { files: quay, sets: load(SPANNED), windowUnits: 60 };
  const reasonOf = (
    result: { unlabeledUnits: Array<{ unit: string; undecided?: string }> },
    entry: LedgerEntry,
  ) => result.unlabeledUnits.find((unit) => unit.unit === entry.id)?.undecided;

  it('when the cassette lacks the re-ask of a run that slipped out of step', async () => {
    // Five runs: the second slips, the third and fourth say remark. Without its re-ask, order 2 and remark 2 tie.
    // The re-ask (run 6) says order in step: three of five.
    const labeler = scripted(['order', 'slip', 'remark', 'remark', 'order', 'order']);
    const full = new Cassette();
    const recorded = await pointerScan(input({ ...spanned, cassette: full }, singleLabelling(labeler)));
    expect(recorded.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);

    const cut = new Cassette();
    for (const entry of full.entries.values())
      if (Number(entry.readable.run) <= 5) cut.entries.set(entry.key, entry);
    const partial = await pointerScan(
      input({ ...spanned, cassette: cut, mode: 'replay' }, singleLabelling(replayOf(labeler))),
    );
    expect(partial.unlabeled).toBe(partial.ledger.entries.length);
    expect(partial.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(partial.unlabeledUnits.every((unit) => unit.undecided === 'answers_missing')).toBe(true);

    const later = await pointerScan(
      input(
        { ...spanned, cassette: full, mode: 'replay', previous: partial.ledger },
        singleLabelling(replayOf(labeler)),
      ),
    );
    expect(later.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('when the re-ask of a slipped run was too large and its window was halved', async () => {
    // Run 2 slips; the four others split two, one and one: no label holds three of five, and no tie asks for more.
    // The re-ask of run 2 is refused as too large for the window of two units; its halves answer, but their
    // voices do not reach the vote, so the slipped run stays unheard.
    let big = 0;
    const labeler = scripted(['order', 'slip', 'order', 'remark', 'aside'], {
      fail: (window) =>
        window.units.length === 2 && ++big > 5
          ? new ModelError('http', '400 max_tokens_exceeded', {
              status: 400,
              providerType: 'max_tokens_exceeded',
            })
          : undefined,
    });
    const first = await pointerScan(input(spanned, singleLabelling(labeler)));
    expect(first.failed).toEqual([]);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'answers_missing')).toBe(true);
  });

  it('when the re-asks of a slipped run came back out of step too', async () => {
    // Run 2 slips and so do its three re-asks (REASK_LIMIT): it stays unheard, four runs are heard and split two,
    // one and one. A vote that lacks a planned voice is no decision.
    const first = await pointerScan(
      input(
        spanned,
        singleLabelling(scripted(['order', 'slip', 'order', 'remark', 'aside', 'slip', 'slip', 'slip'])),
      ),
    );
    expect(first.outOfStep).toHaveLength(1 + 3);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'out_of_step')).toBe(true);

    // Asked again by runs in step, with a fresh cassette, the units are decided.
    const second = await pointerScan(
      input({ ...spanned, previous: first.ledger }, singleLabelling(scripted([]))),
    );
    expect(second.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('when the extra runs asked for its tie came back out of step', async () => {
    // Five runs split two, two and one, an instruction against no atom: a close unit, asked again up to
    // CLOSE_REASK_ATTEMPTS times. Every extra run slips and is left out of the vote: the tie stands on fewer voices
    // than it was promised.
    const slips = Array<string>(CLOSE_REASK_ATTEMPTS).fill('slip');
    const first = await pointerScan(
      input(spanned, singleLabelling(scripted(['order', 'remark', 'order', 'remark', 'aside', ...slips]))),
    );
    expect(first.outOfStep).toHaveLength(CLOSE_REASK_ATTEMPTS);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'out_of_step')).toBe(true);

    const second = await pointerScan(
      input({ ...spanned, previous: first.ledger }, singleLabelling(scripted([]))),
    );
    expect(second.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('when two of its three runs were refused as a whole', async () => {
    // Runs 2 and 3 name a label the set does not hold for the noisy unit: each is asked twice, then fails.
    const refusing = drawing((draw) => (draw === 0 ? 'order' : 'bogus'));
    const first = await pointerScan(input({ files }, singleLabelling(refusing)));
    expect(first.failed.length).toBeGreaterThan(0);
    const tied = noisyOf(first.ledger.entries);
    expect(tied.labels.duty).toBeUndefined();
    expect(tied.unlabeled).toBeUndefined();
    expect(reasonOf(first, tied)).toBe('window_failed');
    // The cassette keeps the refusal by its code, never the word the model chose.
    expect(first.failedWindows.every((failure) => failure.reason.includes('label-not-in-set'))).toBe(true);
  });

  it('when a labeler that was asked has too few runs in step on it, so the next scan asks again', async () => {
    const located = { kind: 'act', from: 0, to: 3 };
    // System 1 is unsure of every unit. System 2 answers in step once; its other two runs, and every re-ask, quote
    // clauses that are in no unit: one run heard is no vote, so system 2 has no opinion.
    const stack = (slips: boolean) => {
      let calls = 0;
      const chat = plantedDense(
        (window) => {
          const slipped = slips && ++calls > 1;
          return window.units.map(
            (unit) =>
              ({
                units: String(unit.n),
                label: slipped ? 'remark' : 'order',
                spans: slipped ? Array(4).fill(unlocated) : [located],
              }) as Labelled,
          );
        },
        [],
        { runs: 3, id: 'chat' },
      );
      return stackedLabelling(
        plantedYesNo(() => ({ order: 0.4, remark: 0.4 })),
        chat,
        {
          passAt: 0.6,
          failAt: 0.2,
        },
      );
    };
    const first = await pointerScan(input({ files, sets: load(SPANNED), windowUnits: 60 }, stack(true)));
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'out_of_step')).toBe(true);

    const second = await pointerScan(
      input({ files, sets: load(SPANNED), windowUnits: 60, previous: first.ledger }, stack(false)),
    );
    expect(second.unlabeled).toBe(0);
    expect(second.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('when no run named it, so the next scan asks again', async () => {
    // One run: a labeler that does not vote cannot slip out of step, so a unit it leaves out is one no run named.
    const silent = drawing(() => undefined, { runs: 1 });
    const first = await pointerScan(input({ files }, singleLabelling(silent)));
    expect(first.unlabeled).toBe(1);
    const tied = noisyOf(first.ledger.entries);
    expect(tied.labels.duty).toBeUndefined();
    expect(tied.unlabeled).toBeUndefined();
    expect(reasonOf(first, tied)).toBe('no_run_named');

    const naming = drawing(() => 'order');
    const second = await pointerScan(input({ files, previous: first.ledger }, singleLabelling(naming)));
    expect(noisyOf(second.ledger.entries).labels.duty?.label).toBe('order');
  });

  it('with its reason on each of its rows in the unstable report, so a spend that recurs says why', async () => {
    // Run 2 slips and so do its three re-asks: a planned voice is out of step, and the next scan asks the units again.
    const first = await pointerScan(
      input(
        spanned,
        singleLabelling(scripted(['order', 'slip', 'order', 'remark', 'aside', 'slip', 'slip', 'slip'])),
      ),
    );
    expect(first.unlabeledUnits.length).toBe(first.ledger.entries.length);
    for (const unit of first.unlabeledUnits) {
      const rows = first.unstable.filter((row) => row.unit === unit.unit);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.undecided === 'out_of_step')).toBe(true);
    }
  });

  it('with a row of its own when no run named it', async () => {
    const silent = drawing(() => undefined, { runs: 1 });
    const first = await pointerScan(input({ files }, singleLabelling(silent)));
    const tied = noisyOf(first.ledger.entries);
    expect(first.unstable.filter((row) => row.unit === tied.id)).toEqual([
      expect.objectContaining({ labeler: 'planted', undecided: 'no_run_named' }),
    ]);
  });

  it('when an entry of a run was refused and the voices heard name no label, so the next scan asks it again', async () => {
    // Runs 1 to 4 say order, order, remark and aside; run 5 gives order with an empty spans list, an entry the check
    // refuses. That run is no vote: four voices are heard and no label holds more than half of them. A planned
    // voice is missing, so the unit is not decided.
    const first = await pointerScan(
      input(spanned, singleLabelling(scripted(['order', 'order', 'remark', 'aside', 'refuse']))),
    );
    expect(first.refusals.length).toBeGreaterThan(0);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'entry_refused')).toBe(true);
    for (const unit of first.unlabeledUnits)
      expect(
        first.unstable
          .filter((row) => row.unit === unit.unit)
          .every((row) => row.undecided === 'entry_refused'),
      ).toBe(true);

    const second = await pointerScan(
      input({ ...spanned, previous: first.ledger }, singleLabelling(scripted([]))),
    );
    expect(second.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('when its decided label needs a span and the cassette lacks the span-missing re-ask', async () => {
    // Five runs say order and give no span; the span-missing re-ask (run 6) gives it. A cassette without run 6
    // leaves the span missing for want of an answer: the unit is not decided, and a later cassette decides it.
    const needing = { ...spanned, sets: load(NEEDS) };
    const labeler = scripted(['bare', 'bare', 'bare', 'bare', 'bare', 'order']);
    const full = new Cassette();
    const recorded = await pointerScan(input({ ...needing, cassette: full }, singleLabelling(labeler)));
    expect(recorded.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);

    const cut = new Cassette();
    for (const entry of full.entries.values())
      if (Number(entry.readable.run) <= 5) cut.entries.set(entry.key, entry);
    const partial = await pointerScan(
      input({ ...needing, cassette: cut, mode: 'replay' }, singleLabelling(replayOf(labeler))),
    );
    expect(partial.unlabeled).toBe(partial.ledger.entries.length);
    expect(partial.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(partial.unlabeledUnits.every((unit) => unit.undecided === 'answers_missing')).toBe(true);

    const later = await pointerScan(
      input(
        { ...needing, cassette: full, mode: 'replay', previous: partial.ledger },
        singleLabelling(replayOf(labeler)),
      ),
    );
    expect(later.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });

  it('when its decided label needs a span and the span-missing re-ask gives none', async () => {
    const needing = { ...spanned, sets: load(NEEDS) };
    const first = await pointerScan(
      input(needing, singleLabelling(scripted(['bare', 'bare', 'bare', 'bare', 'bare', 'bare']))),
    );
    expect(first.spanless.length).toBeGreaterThan(0);
    expect(first.spanless.every((entry) => !entry.filled)).toBe(true);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'span_missing')).toBe(true);

    const second = await pointerScan(
      input({ ...needing, previous: first.ledger }, singleLabelling(scripted([]))),
    );
    expect(second.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
  });
});

describe('an entry the check refuses inside an accepted answer', () => {
  const quay = [{ path: 'quay.md', text: '# Quay\n\n- Coil the ropes on the red post\n' }];
  const spanned = { files: quay, sets: load(SPANNED), windowUnits: 60 };
  const needing = { ...spanned, sets: load(NEEDS) };

  it('is no vote: it does not count among the voices of its unit', async () => {
    // Four runs: order, order, remark, and an order whose spans are an empty list. Counted as a voice with no
    // opinion, the refused run would leave order at two of four, no majority; it is no vote, so order holds two of
    // the three voices heard and labels the unit.
    const first = await pointerScan(
      input(spanned, singleLabelling(scripted(['order', 'order', 'remark', 'refuse'], { runs: 4 }))),
    );
    expect(first.refusals.length).toBeGreaterThan(0);
    expect(first.ledger.entries.every((entry) => entry.labels.duty?.label === 'order')).toBe(true);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
  });

  it('is a voice the span-missing re-ask fills', async () => {
    // Four runs: order with no span, twice, remark, and a refused entry. Order holds two of the three voices heard,
    // but no run gave its span: the window is asked again with span-missing, and that answer (an order with no span)
    // takes the refused run's place, so four voices are heard. The span stays missing: the unit is not decided for
    // that reason, not for the refused entry.
    const first = await pointerScan(
      input(needing, singleLabelling(scripted(['bare', 'bare', 'remark', 'refuse', 'bare'], { runs: 4 }))),
    );
    expect(first.spanless.length).toBeGreaterThan(0);
    expect(first.spanless.every((entry) => !entry.filled)).toBe(true);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'span_missing')).toBe(true);
    for (const unit of first.unlabeledUnits)
      expect(first.unstable.filter((row) => row.unit === unit.unit)).toEqual([
        expect.objectContaining({ kinds: { 'runs heard': 4 }, undecided: 'span_missing' }),
      ]);
  });

  it('is a voice still missing when the span-missing re-ask refuses it too', async () => {
    const first = await pointerScan(
      input(needing, singleLabelling(scripted(['bare', 'bare', 'remark', 'refuse', 'refuse'], { runs: 4 }))),
    );
    expect(first.spanless.length).toBeGreaterThan(0);
    expect(first.unlabeled).toBe(first.ledger.entries.length);
    expect(first.ledger.entries.every((entry) => entry.unlabeled === undefined)).toBe(true);
    expect(first.unlabeledUnits.every((unit) => unit.undecided === 'entry_refused')).toBe(true);
  });
});
