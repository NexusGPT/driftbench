import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASK_FRAMES, SLOT, STRUCTURED_ACT_SHAPES, TOOL_ACTS } from '../../src/estate/frames';

/**
 * The grammar file the fictional agent reads (examples/estates/fixture/live/fake/grammar.json): the frames and the
 * act shapes of the generator, cut at their slots, so the fake can tell an ask the generator wrote from any other
 * text without a word of its own. It is data made from frames.ts, the one file that holds the fixed words of an
 * ask; this test makes it and checks it. Write it again with
 *   UPDATE_FAKE_GRAMMAR=1 pnpm exec vitest run packages/generate/test/estate/fake-grammar.test.ts
 */

const GRAMMAR = fileURLToPath(
  new URL('../../../../examples/estates/fixture/live/fake/grammar.json', import.meta.url),
);

/** Frames that only ask what an act would mean or apply to: the ask does not request the act. */
const NOT_A_REQUEST = new Set(['near_miss', 'guard_near_act', 'guard_near_situation']);

const ACT = '\u0001';
const BACKGROUND = '\u0002';

function grammar() {
  const frames = Object.fromEntries(
    Object.entries(ASK_FRAMES).map(([name, frame]) => {
      const rendered = frame(ACT, BACKGROUND);
      const [before = '', afterAct = ''] = rendered.split(ACT);
      const hasBackground = afterAct.includes(BACKGROUND);
      const [mid = '', after = ''] = hasBackground ? afterAct.split(BACKGROUND) : [afterAct, ''];
      return [name, { before, mid, background: hasBackground, after, request: !NOT_A_REQUEST.has(name) }];
    }),
  );
  return {
    note: 'Made from packages/generate/src/estate/frames.ts by packages/generate/test/estate/fake-grammar.test.ts. Do not edit.',
    slot: SLOT,
    frames,
    shapes: STRUCTURED_ACT_SHAPES,
    toolActs: TOOL_ACTS,
  };
}

describe('the grammar of the fictional agent', () => {
  it('is the frames and shapes of the generator, cut at their slots', async () => {
    const made = `${JSON.stringify(grammar(), null, 2)}\n`;
    if (process.env.UPDATE_FAKE_GRAMMAR === '1') await writeFile(GRAMMAR, made);
    expect(await readFile(GRAMMAR, 'utf8')).toBe(made);
  });

  it('cuts every frame so that a rendering is its parts joined', () => {
    for (const [name, frame] of Object.entries(grammar().frames)) {
      const rendered = ASK_FRAMES[name]?.('an act', frame.background ? ' A context.' : '');
      expect(`${frame.before}an act${frame.mid}${frame.background ? ' A context.' : ''}${frame.after}`).toBe(
        rendered,
      );
    }
  });

  it('marks the frames that do not request their act', () => {
    const marked = Object.entries(grammar().frames)
      .filter(([, frame]) => !frame.request)
      .map(([name]) => name);
    expect(marked.sort()).toEqual(['guard_near_act', 'guard_near_situation', 'near_miss']);
  });
});
