import { describe, expect, it } from 'vitest';
import { Cassette, CassetteMiss } from './cassette';
import type { Labeler, LabelerClass } from './labeler';
import { canonical, type LabelSet, parseLabelSets } from './labels';
import { renderLedger } from './ledger';
import { pointerScan } from './scan';
import { singleLabelling } from './stack';

/**
 * The contract suite a labeler passes, shipped as `@agent-nexus/driftbench-estate/labeler-contract`, in the
 * style of the adapter contract suite. It registers vitest tests, so it runs inside a vitest test file;
 * `vitest` is an optional peer of the package.
 *
 *     labelerContract('my endpoint', (mode) => createHttpLabeler({ url, cls: 'system2', ...mode }), {
 *       cls: 'system2',
 *       broken: () => createHttpLabeler({ url: dead, cls: 'system2' }),
 *     });
 *
 * `make` builds the labeler, fresh for each test: with `{ replayOnly: false }` it can call its service, with
 * `{ replayOnly: true }` it must not (it is the twin a replay uses, with no key and no network). The suite
 * plays the pointer scan on a small invented estate and holds the labeler to this:
 * - It names itself: an id of letters, digits and `. _ : -`, its declared class, a model, plain settings.
 * - It renders a request as the same bytes every time, under its own id.
 * - Its answer, in the shape of its class, gives opinions only for units of the window and only labels of the
 *   set or `none`.
 * - A scan that records it writes the cassette; a scan of the replay twin reads every answer back with no
 *   call, and gives the same ledger, byte for byte.
 * - Its id is in every cassette key and in the readable fields beside it: the same requests under another id
 *   miss.
 * - A replay twin has no call, so a cassette miss can never reach the network.
 * - With `broken`: a transport that fails is a failed window, and the cassette gains nothing.
 * - With `malformed`: an answer in the wrong shape is a failed window. It is recorded as unreadable, so a
 *   replay fails the same way with no call, and no unit takes a label from it.
 */

export type LabelerFactory = (mode: { replayOnly: boolean }) => Labeler | Promise<Labeler>;

export type LabelerContractOptions = {
  /** The class the labeler declares. */
  cls: LabelerClass;
  /** A labeler of the same kind whose transport fails: an endpoint that refuses connections, a module that throws. */
  broken?: () => Labeler | Promise<Labeler>;
  /** A labeler of the same kind that answers in a shape its class cannot read. */
  malformed?: () => Labeler | Promise<Labeler>;
  /** The label sets of the scan, YAML. Default `CONTRACT_SETS`. */
  sets?: string;
  /** The prose files of the scan. Default `CONTRACT_FILES`. */
  files?: ReadonlyArray<{ path: string; text: string }>;
  /** Milliseconds a test may take. Default 20000. */
  timeoutMs?: number;
};

/** An invented harbour office: two files of prose. */
export const CONTRACT_FILES: ReadonlyArray<{ path: string; text: string }> = [
  {
    path: 'CLAUDE.md',
    text: '# Harbour office\n\n- Hang the lamp before dusk\n- Never leave the gate open\n- Close the gate at night\n',
  },
  {
    path: '.claude/skills/moorings/SKILL.md',
    text: '# Moorings\n\nCheck the tide table. Tie the bow line first. The quay is old.\n',
  },
];

/** One small label set, in the format of the shipped sets. */
export const CONTRACT_SETS = `labels:
  - set: harbour-rules
    description: What the harbour office asks of the agent.
    labels:
      - name: rule
        description: A unit that tells the reader what to do.
      - name: prohibition
        description: A unit that tells the reader what never to do.
`;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function setsOf(text: string): LabelSet[] {
  const parsed = parseLabelSets(text);
  if (!parsed.ok) throw new Error(`the contract sets do not parse: ${parsed.message}`);
  return parsed.sets;
}

/** Renames a labeler, keeping everything else: the twin whose cassette keys must all differ. */
function renamed(labeler: Labeler, id: string): Labeler {
  return {
    ...labeler,
    id,
    maxUnits: labeler.maxUnits.bind(labeler),
    opinions: labeler.opinions.bind(labeler),
    render: (set, window) => ({ ...labeler.render(set, window), labeler: id }),
  };
}

/** One check of the contract: its name and a run that throws when the labeler breaks it. */
export type ContractCase = { name: string; run: () => Promise<void> };

/** The checks of the contract, as plain functions: `labelerContract` registers each as a vitest test. */
export function labelerContractCases(make: LabelerFactory, options: LabelerContractOptions): ContractCase[] {
  const cases: ContractCase[] = [];
  const sets = setsOf(options.sets ?? CONTRACT_SETS);
  const files = options.files ?? CONTRACT_FILES;
  const scan = (labeler: Labeler, cassette: Cassette, mode: 'record' | 'replay') =>
    pointerScan({ files, sets, labelling: singleLabelling(labeler), cassette, mode, estateKey: 'contract' });

  cases.push({
    name: 'names itself: an id, its declared class, a model and plain settings',
    run: async () => {
      const labeler = await make({ replayOnly: true });
      expect(labeler.id).toMatch(ID);
      expect(labeler.cls).toBe(options.cls);
      expect(typeof labeler.model).toBe('string');
      expect(labeler.model).not.toBe('');
      expect(typeof labeler.family).toBe('string');
      expect(JSON.parse(canonical(labeler.settings))).toEqual(labeler.settings);
    },
  });

  cases.push({
    name: 'renders a request as the same bytes every time, under its own id',
    run: async () => {
      const labeler = await make({ replayOnly: true });
      const first = await scan(labeler, new Cassette(), 'replay').catch((cause: unknown) => cause);
      // A replay of an empty cassette misses: the miss is the proof that nothing was sent.
      expect(first).toBeInstanceOf(CassetteMiss);
      const [set] = sets;
      if (!set) throw new Error('the contract needs a label set');
      const window = {
        id: 'CLAUDE.md#1',
        path: 'CLAUDE.md',
        headingPath: ['Harbour office'],
        units: [
          { n: 1, index: 1, text: '- Hang the lamp before dusk' },
          { n: 2, index: 2, text: '- Never leave the gate open' },
        ],
      };
      const one = labeler.render(set, window);
      const two = labeler.render(set, window);
      expect(canonical(one)).toBe(canonical(two));
      expect(one.labeler).toBe(labeler.id);
    },
  });

  cases.push({
    name: 'records every answer, then replays them with no call and the same ledger',
    run: async () => {
      const cassette = new Cassette();
      const recorded = await scan(await make({ replayOnly: false }), cassette, 'record');
      expect(recorded.failed).toEqual([]);
      expect(recorded.recorded).toBeGreaterThan(0);
      expect(recorded.calls).toBe(recorded.recorded);
      for (const item of recorded.labelled) {
        expect(['none', ...sets.flatMap((set) => set.labels.map((label) => label.name))]).toContain(
          item.label,
        );
      }
      const twin = await make({ replayOnly: true });
      expect(twin.call).toBeUndefined();
      const replayed = await scan(twin, Cassette.parse(cassette.render()), 'replay');
      expect(replayed.calls).toBe(0);
      expect(replayed.recorded).toBe(0);
      expect(renderLedger(replayed.ledger)).toBe(renderLedger(recorded.ledger));
      expect(replayed.labelled.map((item) => `${item.id}:${item.label}`)).toEqual(
        recorded.labelled.map((item) => `${item.id}:${item.label}`),
      );
    },
  });

  cases.push({
    name: 'puts its id in every cassette key: under another id the requests miss',
    run: async () => {
      const cassette = new Cassette();
      await scan(await make({ replayOnly: false }), cassette, 'record');
      const twin = await make({ replayOnly: true });
      const other = renamed(twin, `${twin.id}-other`);
      const missed = await scan(other, Cassette.parse(cassette.render()), 'replay').catch(
        (cause: unknown) => cause,
      );
      expect(missed).toBeInstanceOf(CassetteMiss);
      const text = cassette.render();
      for (const line of text.trim().split('\n')) {
        const entry = JSON.parse(line) as { readable: Record<string, string> };
        expect(entry.readable.labeler).toBe(twin.id);
      }
    },
  });

  if (options.broken) {
    const broken = options.broken;
    cases.push({
      name: 'reports a failed transport as a failed window and records nothing',
      run: async () => {
        const cassette = new Cassette();
        const result = await scan(await broken(), cassette, 'record');
        expect(result.failed.length).toBeGreaterThan(0);
        expect(result.recorded).toBe(0);
        expect(cassette.render()).toBe('');
      },
    });
  }

  if (options.malformed) {
    const malformed = options.malformed;
    cases.push({
      name: 'refuses an answer in the wrong shape, records it as unreadable and labels nothing from it',
      run: async () => {
        const cassette = new Cassette();
        const result = await scan(await malformed(), cassette, 'record');
        expect(result.failed.length).toBeGreaterThan(0);
        expect(result.labelled).toEqual([]);
        const entries = cassette
          .render()
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { answer: { refused?: string } });
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) expect(entry.answer.refused).toBe('unreadable');
      },
    });
  }
  return cases;
}

/** Registers the contract as vitest tests, one per check, under `labeler contract: <name>`. */
export function labelerContract(name: string, make: LabelerFactory, options: LabelerContractOptions): void {
  const timeout = options.timeoutMs ?? 20_000;
  describe(`labeler contract: ${name}`, () => {
    for (const each of labelerContractCases(make, options)) it(each.name, each.run, timeout);
  });
}
