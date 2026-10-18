import { provenanceHash } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { comparePairwise, replyPairs, replyText } from '../src/pairwise';
import { observed, run } from './support';

const stimulus = (_run: unknown, index: number) => `question ${index}`;

/** The shape the pairwise judge returns; the report does not depend on the judges package. */
type PairwiseVerdict = {
  choice: 'first' | 'second' | 'tie';
  ordered: 'pass' | 'fail' | 'inconclusive';
  swapped: 'pass' | 'fail' | 'inconclusive';
  consistent: boolean;
  positionBias: boolean;
};

describe('replyPairs', () => {
  it('pairs the reply of each block that both campaigns ran, in order', () => {
    const baseline = [run({ blocks: [{ text: 'old one' }, { text: 'old two' }] })];
    const candidate = [run({ blocks: [{ text: 'new one' }, { text: 'new two' }] })];
    const pairs = replyPairs(baseline, candidate, stimulus);
    expect(pairs.map((pair) => [pair.block, pair.first, pair.second, pair.stimulus])).toEqual([
      [0, 'old one', 'new one', 'question 0'],
      [1, 'old two', 'new two', 'question 1'],
    ]);
  });

  it('skips a block with an empty reply on either side', () => {
    const baseline = [run({ blocks: [{ text: '' }, { text: 'kept' }] })];
    const candidate = [run({ blocks: [{ text: 'answer' }, { text: 'kept' }] })];
    expect(replyPairs(baseline, candidate, stimulus).map((pair) => pair.block)).toEqual([1]);
  });

  it('never pairs a run of another mode, nor a run that did not complete', () => {
    const baseline = [run({ mode: 'T', blocks: [{ text: 'a' }] })];
    const candidate = [run({ mode: 'F', blocks: [{ text: 'b' }] })];
    expect(replyPairs(baseline, candidate, stimulus)).toEqual([]);
    const failed = [run({ status: 'failed', blocks: [{ text: 'b' }] })];
    expect(
      replyPairs(
        baseline.map((r) => ({ ...r, mode: 'F' as const })),
        failed,
        stimulus,
      ),
    ).toEqual([]);
  });
});

describe('replyText', () => {
  it('reads the adapter text, or the text segments when the adapter leaves it empty', () => {
    const shaped = run({ blocks: [{ text: 'from text' }] });
    expect(replyText(shaped.blocks[0]?.observed ?? observed({ text: '' }))).toBe('from text');
    const segmented = {
      ...observed({ text: '' }),
      segments: [
        { type: 'text' as const, text: 'Hello.' },
        { type: 'text' as const, text: 'Anything else?' },
      ],
    };
    expect(replyText(segmented)).toBe('Hello.\nAnything else?');
  });
});

describe('comparePairwise', () => {
  it('judges every pair and tallies the candidate and baseline wins', async () => {
    const pairs = replyPairs(
      [run({ blocks: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] })],
      [run({ blocks: [{ text: 'x' }, { text: 'y' }, { text: 'z' }] })],
      stimulus,
    );
    const script: PairwiseVerdict[] = [
      { choice: 'first', ordered: 'pass', swapped: 'pass', consistent: false, positionBias: false },
      { choice: 'second', ordered: 'fail', swapped: 'fail', consistent: true, positionBias: false },
      { choice: 'tie', ordered: 'pass', swapped: 'pass', consistent: false, positionBias: true },
    ];
    let calls = 0;
    const result = await comparePairwise(pairs, async () => script[calls++] as PairwiseVerdict);
    expect(result.tally).toEqual({ baseline: 1, candidate: 1, tie: 1, inconsistent: 2, positionBias: 1 });
    expect(result.rows.map((row) => row.pair.block)).toEqual([0, 1, 2]);
  });
});

describe('realized stimuli', () => {
  const stored = (text: string) => ({ hash: provenanceHash(text), text });
  const hashed = (text: string) => ({ hash: provenanceHash(text) });
  it.each([
    ['identical stored text', stored('sent'), stored('sent'), 'sent'],
    ['different stored text', stored('one'), stored('two'), undefined],
    ['different hashes', hashed('one'), hashed('two'), undefined],
    ['matching authored hashes', hashed('authored'), hashed('authored'), 'authored'],
    ['matching unavailable text', hashed('sent'), hashed('sent'), undefined],
    ['only one side has changed text', stored('sent'), hashed('sent'), undefined],
    ['one stored authored text', stored('authored'), hashed('authored'), 'authored'],
    ['legacy authored and matching hash', undefined, hashed('authored'), 'authored'],
    ['empty stored text', stored(''), stored(''), ''],
    ['invalid stored text hash', { hash: provenanceHash('sent'), text: 'forged' }, stored('sent'), undefined],
  ] as const)('%s', (_name, left, right, expected) => {
    const baseline = run({ blocks: [{ text: 'a' }] });
    const candidate = run({ blocks: [{ text: 'b' }] });
    const a = baseline.blocks[0];
    const b = candidate.blocks[0];
    if (!a || !b) throw new Error('missing fixture block');
    if (left) a.realized = left;
    if (right) b.realized = right;
    let skipped = 0;
    const pairs = replyPairs(
      [baseline],
      [candidate],
      () => 'authored',
      () => {
        skipped += 1;
      },
    );
    expect(pairs.map((pair) => pair.stimulus)).toEqual(expected === undefined ? [] : [expected]);
    expect(skipped).toBe(expected === undefined ? 1 : 0);
  });

  it('resolves the pinned authored message on both sides, and fails closed when missing', () => {
    const baseline = run({ blocks: [{ text: 'a' }] });
    const candidate = run({ blocks: [{ text: 'b' }] });
    expect(replyPairs([baseline], [candidate], (r) => (r === baseline ? 'old spec' : 'new spec'))).toEqual(
      [],
    );
    expect(replyPairs([baseline], [candidate], () => undefined)).toEqual([]);
  });
});
