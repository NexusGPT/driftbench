import type { Atom } from '@agent-nexus/driftbench-estate';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FixtureSuite, fixtureSuite, type SuiteSpec } from '../../src/ladders/estate/bank/fixture-suite';
import { type AskEnv, checkAsk, envOf } from '../../src/ladders/estate/bank/task-check';
import { envOfSuite } from '../../src/ladders/estate/bank/taskv2';

/**
 * A piece the generator cut from a labelled clause records where: `from.offsets[i]` is `{ atom, from, to }`. The
 * check accepts it when the atom is a source of the ask, the slice of its quote has the tokens of the piece, and
 * the slice lies inside a span the pointer reader labelled as acting. A real spec of the suite whose piece a list
 * of words cut gets a label and offsets planted in a copy, so each test changes one thing.
 */
type Meta = { from: Record<string, unknown>; atoms: string[] };
const metaOf = (spec: SuiteSpec): Meta => (spec.spec.metadata as { estate: Meta }).estate;

let suite: FixtureSuite;
let env: AskEnv;
let spec: SuiteSpec;
let cited: Atom;
let at: { from: number; to: number };

beforeAll(async () => {
  suite = await fixtureSuite();
  env = await envOfSuite(suite);
  for (const candidate of suite.specs) {
    if (!candidate.complete) continue;
    const from = (candidate.spec.metadata as { estate?: Meta } | undefined)?.estate?.from;
    if (from?.form !== 'asks it names' || !Array.isArray(from.pieces) || from.pieces.length !== 1) continue;
    if (checkAsk(candidate, env).reasons.length === 0) continue;
    const atom = env.byId.get(String(from.field).split('#')[0] ?? '');
    if (!atom) continue;
    // The quote of the cited atom is set to a passage that holds the piece after a clause of its own, as an atom
    // built from a labelled unit would: the offsets are into that quote.
    const piece = String(from.pieces[0]);
    const lead = 'Skip the old way; ';
    spec = candidate;
    cited = { ...atom, provenance: { ...atom.provenance, quote: `${lead}${piece}; then stop.` } };
    at = { from: lead.length, to: lead.length + piece.length };
    return;
  }
  throw new Error('the suite holds no refused ask of the form asks it names');
}, 300_000);

/** The check on a copy of the spec with offsets recorded and the cited atom labelled with the given spans. */
function checked(
  labelSpans: Array<{ kind: string; from: number; to: number }> | undefined,
  offsets: unknown,
): string[] {
  const copy = structuredClone(spec);
  metaOf(copy).from.offsets = [offsets];
  const labelled: Atom = {
    ...cited,
    fields: { ...(cited.fields ?? {}), ...(labelSpans ? { labelSpans } : {}) },
  };
  const where = envOf(
    env.atoms.map((atom) => (atom.id === cited.id ? labelled : atom)),
    env.bank,
    env.sessions,
  );
  return checkAsk(copy, where).reasons;
}

describe('a piece cut from a labelled clause', () => {
  it('is refused with no offsets, as the suite shows', () => {
    expect(checkAsk(spec, env).reasons.join(' ')).toContain('is no whole clause');
  });

  it('is accepted when its slice lies inside an acting span of the cited atom', () => {
    const quote = cited.provenance.quote;
    for (const kind of ['act', 'governed-action', 'prerequisite', 'ask'])
      expect(checked([{ kind, from: 0, to: quote.length }], { atom: cited.id, ...at }), kind).toEqual([]);
  });

  it('is refused in a span that acts on nothing, with no span, or outside the span', () => {
    const quote = cited.provenance.quote;
    const slice = { atom: cited.id, ...at };
    expect(checked([{ kind: 'mechanics', from: 0, to: quote.length }], slice).join(' ')).toContain(
      'no slice of a labelled clause',
    );
    expect(checked(undefined, slice).join(' ')).toContain('no slice of a labelled clause');
    expect(checked([{ kind: 'act', from: at.to, to: quote.length + 1 }], slice).join(' ')).toContain(
      'no slice of a labelled clause',
    );
  });

  it('is refused when the offsets name other words, another atom or something that is no offset', () => {
    const quote = cited.provenance.quote;
    const span = [{ kind: 'act', from: 0, to: quote.length }];
    expect(checked(span, { atom: cited.id, from: at.from, to: at.to - 1 }).join(' ')).toContain('no slice');
    expect(checked(span, { atom: 'instruction.nowhere', ...at }).join(' ')).toContain('no slice');
    expect(checked(span, { atom: cited.id, from: '0', to: at.to }).join(' ')).toContain('no slice');
    expect(
      checked(span, { atom: metaOf(spec).atoms.find((id) => id !== cited.id) ?? 'x', ...at }).join(' '),
    ).toContain('no slice');
  });
});
