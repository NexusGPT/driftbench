import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Frame, FrameError, isolate } from '../../src/frame';
import { checkReply } from '../../src/frame/isolate';
import type * as answers from './fixtures/answers';

/**
 * The answers of the confined runs are matched to the calls by id (PR 986: on Node 22 a seed came out tainted because
 * run A answered a call with the answer of another, GitHub run 39881420053). A reply for another call is a named
 * frame error with both numbers and both call names, never a silent shift. A product that prints text without a
 * newline during a call cannot hide the frame's answer line behind it.
 */

vi.setConfig({ testTimeout: 60_000 });

const PRODUCT = fileURLToPath(new URL('./fixtures/answers.ts', import.meta.url));
type Product = typeof answers;
const open: Frame<unknown>[] = [];
afterEach(() => {
  for (const frame of open.splice(0)) frame.close();
});
const frameOf = () => {
  const frame = isolate<Product>({ module: PRODUCT, seed: 21, plain: false });
  open.push(frame as Frame<unknown>);
  return frame;
};

describe('a product that prints during a call', () => {
  it('gets its answers back in order when it prints text without a newline', () => {
    const frame = frameOf();
    expect([0, 1, 2, 3].map((n) => frame.product.printsPartial(n))).toEqual([1, 2, 3, 4]);
    expect(frame.divergence()).toBeUndefined();
  });

  it('gets its answers back in order when it prints whole lines, one like an answer', () => {
    const frame = frameOf();
    expect([0, 1, 2].map((n) => frame.product.printsLines(n))).toEqual([2, 3, 4]);
    expect(frame.divergence()).toBeUndefined();
  });

  it('keeps the next call in step after a call that threw, with a hostile message', () => {
    const frame = frameOf();
    expect(() => frame.product.throwsOnCall(0)).toThrow();
    expect(() => frame.product.throwsOnCall(1)).toThrow();
    expect(frame.product.answersLast(3)).toBe(30);
    expect(frame.product.answersLast(4)).toBe(40);
    expect(frame.divergence()).toBeUndefined();
  });
});

describe('checkReply', () => {
  it('takes the reply to the call that waits', () => {
    expect(() => checkReply({ id: 3, call: 'f', answers: [{ ret: 1 }] }, 3, 'f')).not.toThrow();
    expect(() => checkReply({ answers: [] }, 3, 'f')).not.toThrow();
  });

  it('names both numbers and both calls when the reply is for another call', () => {
    expect(() => checkReply({ id: 2, call: 'wilson', answers: [] }, 3, 'bootstrapCI')).toThrow(FrameError);
    expect(() => checkReply({ id: 2, call: 'wilson', answers: [] }, 3, 'bootstrapCI')).toThrow(
      /call 2 \(wilson\) while call 3 \(bootstrapCI\) was waiting/,
    );
  });

  it('names a run that answered another request', () => {
    const desync = { desync: 'the run A answered request 7 while request 8 was waiting' };
    expect(() => checkReply({ id: 8, call: 'f', answers: [desync, { ret: 1 }, { ret: 1 }] }, 8, 'f')).toThrow(
      /run A answered request 7 while request 8 was waiting \(call 8, f\)/,
    );
  });
});
