import { afterEach, describe, expect, it } from 'vitest';
import { pointerBank } from '../../src/ladders/pointer/bank';
import { clearSeedFreeCache, runItem } from '../../src/ladders/pointer/bank/run';
import { HARDENING_PRIVACY_SPECS } from '../../src/ladders/pointer/bank/specs/hardening-privacy';
import type { ListedCandidates, PointerSut } from '../../src/ladders/pointer/sut/port';
import {
  loadReaderWithRetry,
  type ReaderExports,
  readerAdapter,
  recordingMember,
} from '../../src/ladders/pointer/sut/reader';
import { SentRecorder } from '../../src/ladders/pointer/sut/sent';
import { REFERENCE_MODULE } from './helpers';
import { referenceSut } from './reference';
import { type BugPrivacy, referenceBugsPrivacy } from './reference/bugs-privacy';

/**
 * The four comment privacy items (`specs/hardening-privacy.ts`): no comment text reaches a labeler request,
 * whether the comment sits inside a sentence, at the end of a line after text, in a heading or in a table cell.
 * Each item passes on the reference reader, on two seeds, and fails on a reference that sends the comment text
 * (the reader before the rule) and on one that drops the whole unit that holds the comment (the rest of the
 * unit must be sent). The mutants are modelled in `reference/bugs-privacy.ts`.
 */

const ref = referenceSut();
const bank = pointerBank();
const item = (id: string) => {
  const found = bank.find((x) => x.id === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};

async function run(id: string, seed = 1, sut: PointerSut = ref) {
  const before = process.env.DRIFTBENCH_POINTER_SUT;
  process.env.DRIFTBENCH_POINTER_SUT = REFERENCE_MODULE;
  clearSeedFreeCache();
  try {
    return await runItem(item(id), seed, sut);
  } finally {
    if (before === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
    else process.env.DRIFTBENCH_POINTER_SUT = before;
  }
}

afterEach(() => {
  referenceBugsPrivacy.clear();
});

const CANDIDATE = 'privacy.comment-text-never-leaves-link-candidate';

const ITEMS = Object.entries(HARDENING_PRIVACY_SPECS).flatMap(([family, specs]) =>
  specs.map((spec) => `${family}.${spec.key}`),
);

/** The four placements of a comment in a unit; the fifth item is about a link candidate, tested below. */
const PLACED = ITEMS.filter((id) => id !== CANDIDATE);

const MUTANTS: Array<{ bug: BugPrivacy; detail: RegExp }> = [
  { bug: 'comment-text-sent', detail: /the text of a comment reached a request/ },
  { bug: 'comment-unit-dropped', detail: /the text around the comment is in no request/ },
];

describe('the comment privacy items pass on the reference reader', () => {
  for (const id of ITEMS) {
    it(id, async () => {
      for (const seed of [1, 2, 3])
        expect(await run(id, seed), `${id} seed ${seed}`).toMatchObject({ pass: true });
    }, 120_000);
  }
});

describe('each comment privacy item fails on a reference that breaks the rule', () => {
  for (const id of PLACED) {
    for (const { bug, detail } of MUTANTS) {
      it(`${id} fails when the reader has the defect ${bug}`, async () => {
        referenceBugsPrivacy.add(bug);
        const planted = await run(id);
        expect(planted.pass, id).toBe(false);
        expect(planted.detail, id).toMatch(detail);
      }, 120_000);
    }
  }

  it('holds the five items, each with its own cause tag, none a catch item', () => {
    expect(ITEMS).toHaveLength(5);
    const specs = HARDENING_PRIVACY_SPECS.privacy ?? [];
    expect(specs.map((spec) => spec.cause).sort()).toEqual([
      'privacy:comment-text-never-leaves-eol',
      'privacy:comment-text-never-leaves-heading',
      'privacy:comment-text-never-leaves-inline',
      'privacy:comment-text-never-leaves-link-candidate',
      'privacy:comment-text-never-leaves-table',
    ]);
    expect(specs.every((spec) => spec.role === undefined && (spec.capMs ?? 0) <= 90_000)).toBe(true);
  });
});

const LEAKED_CANDIDATE = /the text of a comment reached a request as a link candidate/;
const NO_CANDIDATE = /the request for the second file lists no candidate/;

describe('the link candidate item (a comment in the unit of an atom the scan lists as a candidate)', () => {
  it('is red on a reference that lists the atom as it is given', async () => {
    referenceBugsPrivacy.add('candidate-comment-sent');
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(LEAKED_CANDIDATE);
    }
  }, 120_000);

  it('is red on a reference that lists no candidate', async () => {
    referenceBugsPrivacy.add('candidates-all-withheld');
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(NO_CANDIDATE);
    }
  }, 120_000);

  it('is red on a reference that sends every comment as written', async () => {
    referenceBugsPrivacy.add('comment-text-sent');
    const planted = await run(CANDIDATE);
    expect(planted.pass).toBe(false);
    expect(planted.detail).toMatch(/reached a request/);
  }, 120_000);

  it('is red on a reader that withholds every candidate and plants an id-shaped text in a diagnostic', async () => {
    // The wrapper found by the codex audit (run 39738771348): the item once matched a hashed id anywhere in the
    // text of a request, so a `diagnostic` holding one passed it on three seeds out of three.
    const cheat: PointerSut = {
      ...ref,
      scan: async (request) => {
        const res = await ref.scan({ ...request, atoms: [] });
        return {
          ...res,
          diagnostics: [...res.diagnostics, { code: 'note', detail: 'atom-0000000000' }],
        };
      },
    };
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed, cheat);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(NO_CANDIDATE);
    }
  }, 120_000);

  it('is red on a reader that lists the candidates in no structured field', async () => {
    const mute: PointerSut = {
      ...ref,
      scan: async (request) => {
        const { listed: _listed, ...rest } = await ref.scan(request);
        return rest;
      },
    };
    const planted = await run(CANDIDATE, 1, mute);
    expect(planted.pass).toBe(false);
    expect(planted.detail).toMatch(/does not expose the candidates its requests list/);
  }, 120_000);

  it('is red on a reader that lists a candidate with a made up title', async () => {
    const forged: PointerSut = {
      ...ref,
      scan: async (request) => {
        const res = await ref.scan({ ...request, atoms: [] });
        return {
          ...res,
          listed: [
            {
              file: 'harbour/second.md',
              window: 'w',
              set: 'agent-rules',
              link: 'topic',
              candidates: [{ id: 'atom-0000000000', title: 'an unrelated title' }],
            },
          ],
        };
      },
    };
    const planted = await run(CANDIDATE, 1, forged);
    expect(planted.pass).toBe(false);
    expect(planted.detail).toMatch(/is the planted atom/);
  }, 120_000);

  it('is red on a reader whose renderer drops the candidates it is handed', async () => {
    // The wrapper found by the codex audit (run 39745489599): the reader hands the candidates to its renderer, the
    // renderer leaves them out, and a binding that copied them from the input context still listed them.
    referenceBugsPrivacy.add('render-drops-candidates');
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(NO_CANDIDATE);
    }
  }, 120_000);

  it('is red on a reader whose renderer lists the candidate but prints its title unmasked', async () => {
    referenceBugsPrivacy.add('render-prints-raw-title');
    for (const seed of [1, 2, 3]) {
      const planted = await run(CANDIDATE, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(LEAKED_CANDIDATE);
    }
  }, 120_000);
});

type Labeler = Parameters<typeof recordingMember>[0];
type RenderArgs = Parameters<Labeler['render']>;
type CallArgs = NonNullable<Labeler['call']> extends (...args: infer A) => unknown ? A : never;

describe('the binding lists the candidates the transport received, paired with the context of the request', () => {
  const set = { set: 'agent-rules', description: 'd', labels: [] } as unknown as RenderArgs[0];
  const window = {
    id: 'w1',
    path: 'harbour/second.md',
    headingPath: [],
    units: [],
  } as unknown as RenderArgs[1];
  const context = {
    candidates: {
      topic: [
        { id: 'instruction.a-slug', shown: 'atom-1234567890', label: 'a masked title' },
        { id: 'instruction.plain', label: 'a plain title' },
      ],
    },
  } as unknown as RenderArgs[2];
  const wireOf = (lines: string[]) => ({
    labeler: 'x',
    body: { messages: [{ role: 'user', content: lines.join('\n') }] },
  });
  /**
   * A member whose call stands for the product: it hands one body string to the reporting fetch, and that string
   * is `sends(wire)`. The binding reads the candidates from that string and from nothing else.
   */
  const rowsOf = async (
    render: (...args: RenderArgs) => unknown,
    sends: (wire: Record<string, unknown>) => string = (wire) => JSON.stringify(wire.body),
    ctx: RenderArgs[2] = context,
  ) => {
    const into = { rows: [] as ListedCandidates[], seen: new Set<string>() };
    const recorder = new SentRecorder(into);
    const member = recordingMember(
      {
        render,
        call: async (wire: Record<string, unknown>) => {
          recorder.received(sends(wire));
          return {};
        },
      } as never,
      recorder,
    );
    const wire = member.render(set, window, ctx);
    await member.call?.(...([wire, set, window] as unknown as CallArgs));
    return into.rows;
  };
  const prints = (lines: string[]) => () => wireOf(lines);
  const MASKED = '    atom-1234567890  a masked title';
  const PLAIN = '    instruction.plain  a plain title';
  const candidatesOf = (rows: ListedCandidates[]) => rows.flatMap((row) => row.candidates);

  it('lists every candidate the request carries', async () => {
    const rows = await rowsOf(prints([MASKED, PLAIN]));
    expect(rows).toHaveLength(1);
    expect(candidatesOf(rows)).toEqual([
      { id: 'atom-1234567890', title: 'a masked title' },
      { id: 'instruction.plain', title: 'a plain title' },
    ]);
  });

  it('lists none when the renderer drops the candidates of its context', async () => {
    expect(candidatesOf(await rowsOf(prints(['no candidate here'])))).toEqual([]);
  });

  it('lists only the candidate whose id and title are both in the request', async () => {
    const rows = await rowsOf(prints(['    atom-1234567890  a title the renderer wrote', PLAIN]));
    expect(candidatesOf(rows)).toEqual([{ id: 'instruction.plain', title: 'a plain title' }]);
  });

  it('lists none when the candidates sit in a field of the render result beside the body', async () => {
    const rows = await rowsOf(() => ({
      labeler: 'x',
      body: { messages: [{ role: 'user', content: 'no candidate here' }] },
      candidateDebug: JSON.stringify([{ id: 'atom-1234567890', title: 'a masked title' }]),
      headers: { 'x-candidates': `${MASKED}\n${PLAIN}` },
      url: `https://labeler.example/${MASKED}`,
    }));
    expect(candidatesOf(rows)).toEqual([]);
  });

  it('reads the body string as it was sent, quotes and line breaks included', async () => {
    const quoted = {
      candidates: {
        topic: [{ id: 'instruction.q', label: 'a "quoted"\ntitle' }],
      },
    } as unknown as RenderArgs[2];
    const rows = await rowsOf(
      prints(['    instruction.q  a "quoted"\ntitle']),
      (wire) => JSON.stringify(wire.body),
      quoted,
    );
    expect(candidatesOf(rows)).toEqual([{ id: 'instruction.q', title: 'a "quoted"\ntitle' }]);
  });

  it('adds no row for an id the renderer made up', async () => {
    const rows = await rowsOf(prints(['    atom-0000000000  an unrelated title', MASKED]));
    expect(candidatesOf(rows).map((c) => c.id)).toEqual(['atom-1234567890']);
  });

  it('lists what the sent string holds, whatever the rendered body held', async () => {
    const sent = JSON.stringify(wireOf([MASKED, PLAIN]).body);
    const none = await rowsOf(prints([MASKED, PLAIN]), () => '{"messages":[]}');
    expect(candidatesOf(none)).toEqual([]);
    const all = await rowsOf(prints(['no candidate here']), () => sent);
    expect(candidatesOf(all)).toHaveLength(2);
  });

  it('keeps the exact string the transport received in the row', async () => {
    const sent = `${JSON.stringify(wireOf([MASKED, PLAIN]).body)} `;
    const rows = await rowsOf(prints([MASKED, PLAIN]), () => sent);
    expect(rows.map((row) => row.body === sent)).toEqual([true]);
  });

  it('lists nothing for a body reported with no request in scope, or for a wire the renderer never returned', async () => {
    const into = { rows: [] as ListedCandidates[], seen: new Set<string>() };
    const recorder = new SentRecorder(into);
    recorder.received(JSON.stringify(wireOf([MASKED, PLAIN]).body));
    const member = recordingMember(
      {
        render: prints([MASKED, PLAIN]),
        call: async () => {
          recorder.received(JSON.stringify(wireOf([MASKED, PLAIN]).body));
          return {};
        },
      } as never,
      recorder,
    );
    await member.call?.(...([wireOf([MASKED, PLAIN]), set, window] as unknown as CallArgs));
    expect(into.rows).toEqual([]);
  });

  it('pairs each body with the context of its own request when requests overlap', async () => {
    const into = { rows: [] as ListedCandidates[], seen: new Set<string>() };
    const recorder = new SentRecorder(into);
    const member = recordingMember(
      {
        render: (_set: unknown, win: { id: string }) => wireOf([`window ${win.id}`, MASKED, PLAIN]),
        call: async (wire: Record<string, unknown>) => {
          await new Promise((done) => setTimeout(done, 1));
          recorder.received(JSON.stringify(wire.body));
          return {};
        },
      } as never,
      recorder,
    );
    const windows = ['a', 'b', 'c'].map((id) => ({ ...window, id }) as unknown as RenderArgs[1]);
    const wires = windows.map((win) => member.render(set, win, context));
    await Promise.all(
      wires.map((wire, at) => member.call?.(...([wire, set, windows[at]] as unknown as CallArgs))),
    );
    expect(into.rows.map((row) => row.window).sort()).toEqual(['a', 'b', 'c']);
    for (const row of into.rows) expect(row.body).toContain(`window ${row.window}`);
  });
});

type Wire = { labeler: string; body: Record<string, unknown> };
type Context = { candidates?: Record<string, unknown[]> };
type Member = { render(set: unknown, window: unknown, context: Context): Wire };

/** The real reader with the renderer of every labeler replaced; the rest of the reader is untouched. */
async function realWith(wrap: (member: Member, render: Member['render']) => Member['render']) {
  const reader = await loadReaderWithRetry(
    async () =>
      (await import(/* @vite-ignore */ '@agent-nexus/driftbench-estate')) as Record<string, unknown>,
  );
  type Build = ReaderExports['buildLabelling'];
  // The binding builds through `buildLabellingDetailed` when the reader has it: both builds are wrapped.
  const wrapped =
    (build: Build): Build =>
    async (...args) => {
      const built = await build(...args);
      if (!built.ok) return built;
      return {
        ...built,
        labelling: {
          ...built.labelling,
          members: built.labelling.members.map((member) =>
            Object.create(member, {
              render: {
                value: wrap(member as unknown as Member, member.render.bind(member) as Member['render']),
              },
            }),
          ),
        },
      };
    };
  const detailed = reader.buildLabellingDetailed;
  const product = {
    ...reader,
    buildLabelling: wrapped(reader.buildLabelling),
    ...(detailed ? { buildLabellingDetailed: wrapped(detailed) } : {}),
  } as unknown as ReaderExports;
  return { ...readerAdapter(product), isolate: false } as PointerSut;
}

async function runReal(sut: PointerSut, seed: number) {
  clearSeedFreeCache();
  return runItem(item(CANDIDATE), seed, sut);
}

describe('the link candidate item on the real reader, whatever its renderer returns besides the body', () => {
  it('passes when the renderer is the reader own', async () => {
    const sut = await realWith((_member, render) => render);
    for (const seed of [1, 2, 3]) expect((await runReal(sut, seed)).pass, `seed ${seed}`).toBe(true);
  }, 300_000);

  it('is red when the renderer drops the candidates it is handed', async () => {
    const sut = await realWith(
      (_member, render) => (set, window, context) => render(set, window, { ...context, candidates: {} }),
    );
    for (const seed of [1, 2, 3]) {
      const planted = await runReal(sut, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(NO_CANDIDATE);
    }
  }, 300_000);

  it('is red when the renderer keeps the candidates in a top level field that is never sent', async () => {
    // The wrapper found by the codex audit (run 39750911993): the body holds no candidate, a `candidateDebug` field
    // beside it holds all of them, and a binding that searched every string of the render result listed them.
    const sut = await realWith((_member, render) => (set, window, context) => {
      const wire = render(set, window, { ...context, candidates: {} });
      const meant = Object.values(context?.candidates ?? {}).flatMap((list) =>
        (list as Array<{ id: string; shown?: string; label: string }>).map((c) => ({
          id: c.shown ?? c.id,
          title: c.label,
        })),
      );
      return { ...wire, candidateDebug: JSON.stringify(meant) } as Wire;
    });
    for (const seed of [1, 2, 3]) {
      const planted = await runReal(sut, seed);
      expect(planted.pass, `seed ${seed}`).toBe(false);
      expect(planted.detail, `seed ${seed}`).toMatch(NO_CANDIDATE);
    }
  }, 300_000);
});
