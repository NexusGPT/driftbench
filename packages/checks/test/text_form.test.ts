import { describe, expect, it } from 'vitest';
import { finishReason } from '../src/checks/finish_reason';
import { markup } from '../src/checks/markup';
import { must, mustNot } from '../src/checks/must';
import { startsWith } from '../src/checks/starts_with';
import { acme } from './support/acme';
import { context, failing, observed, outcomes, run, verdict } from './support/context';

const coverage = acme('acme-new-customer-coverage');
const block = (text: string, expect: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  context(coverage, 1, observed(text, [], extra as never), { expect: expect as never });

describe('markup (xml and html validity)', () => {
  it('passes well-formed XML', async () => {
    const verdicts = await run(markup, block('<plan><name>Mobile L</name></plan>', { markup: 'xml' }));
    expect(outcomes(verdicts)).toEqual({ 'markup.valid': 'pass' });
  });
  it('fails XML with an unclosed element and names it', async () => {
    const verdicts = await run(markup, block('<plan><name>Mobile L</plan>', { markup: 'xml' }));
    expect(failing(verdicts)).toEqual(['markup.valid']);
    expect(verdict(verdicts, 'markup.valid').evidence).toContain('</plan>');
  });
  it('passes HTML with void elements such as br and img, which need no close tag', async () => {
    const verdicts = await run(markup, block('<p>Fiber<br>5G<img src="x.png"></p>', { markup: 'html' }));
    expect(outcomes(verdicts)).toEqual({ 'markup.valid': 'pass' });
  });
  it('fails HTML with a mismatched close tag', async () => {
    const verdicts = await run(markup, block('<div><span>Fiber</div>', { markup: 'html' }));
    expect(failing(verdicts)).toEqual(['markup.valid']);
  });
  it('gives no verdict when the block declares no markup', async () => {
    expect(await run(markup, block('<a>', {}))).toEqual([]);
  });
  it('mutation: a closing tag removed fails the same XML that passed', async () => {
    const ok = await run(markup, block('<a><b>x</b></a>', { markup: 'xml' }));
    const bad = await run(markup, block('<a><b>x</a>', { markup: 'xml' }));
    expect(outcomes(ok)).toEqual({ 'markup.valid': 'pass' });
    expect(failing(bad)).toEqual(['markup.valid']);
  });
});

describe('ignore_case on must and must_not', () => {
  it('matches "fiber" in a reply that says "Fiber" when ignore_case is set', async () => {
    const ctx = block('Fiber is available here.', { must: ['fiber'], ignore_case: true } as never);
    expect(outcomes(await run(must, ctx))).toEqual({ 'must.0': 'pass' });
  });
  it('keeps case-sensitive matching when ignore_case is not set', async () => {
    const ctx = block('Fiber is available here.', { must: ['fiber'] });
    expect(outcomes(await run(must, ctx))).toEqual({ 'must.0': 'fail' });
  });
  it('applies ignore_case to must_not too', async () => {
    const ctx = block('We sell FIBER plans.', { must_not: ['fiber'], ignore_case: true } as never);
    expect(outcomes(await run(mustNot, ctx))).toEqual({ 'must_not.0': 'fail' });
  });
});

describe('starts_with', () => {
  it('passes a reply whose whole text starts with the text', async () => {
    const verdicts = await run(startsWith, block('Hi, I am Sam.', { starts_with: 'Hi' }));
    expect(outcomes(verdicts)).toEqual({ 'starts_with.0': 'pass' });
  });
  it('fails a reply that has the text only on a later line', async () => {
    const verdicts = await run(startsWith, block('Sure.\nHi, I am Sam.', { starts_with: 'Hi' }));
    expect(failing(verdicts)).toEqual(['starts_with.0']);
    expect(verdict(verdicts, 'starts_with.0').evidence).toBe(
      'the reply starts with "Sure.", expected it to start with "Hi"',
    );
  });
  it('ignores leading space', async () => {
    const verdicts = await run(startsWith, block('   Hi there', { starts_with: 'Hi' }));
    expect(outcomes(verdicts)).toEqual({ 'starts_with.0': 'pass' });
  });
  it('mutation: a line-start pattern passes the later line that starts_with fails', async () => {
    const line = await run(must, block('Sure.\nHi, I am Sam.', { must: ['^Hi'] }));
    const whole = await run(startsWith, block('Sure.\nHi, I am Sam.', { starts_with: 'Hi' }));
    expect(outcomes(line)).toEqual({ 'must.0': 'pass' });
    expect(failing(whole)).toEqual(['starts_with.0']);
  });
});

describe('finish_reason', () => {
  it('passes when the runtime reports the expected reason', async () => {
    const verdicts = await run(
      finishReason,
      block('ok', { finish_reason: 'stop' }, { runtime: { finishReason: 'stop' } }),
    );
    expect(outcomes(verdicts)).toEqual({ 'finish_reason.reason': 'pass' });
  });
  it('fails a truncated reply and names the reason it reported', async () => {
    const verdicts = await run(
      finishReason,
      block('The plan includes', { finish_reason: 'stop' }, { runtime: { finishReason: 'length' } }),
    );
    expect(failing(verdicts)).toEqual(['finish_reason.reason']);
    expect(verdict(verdicts, 'finish_reason.reason').evidence).toBe(
      'the runtime reported length, expected stop',
    );
  });
  it('is inconclusive when the runtime reports no reason, and does not gate', async () => {
    const verdicts = await run(finishReason, block('ok', { finish_reason: 'stop' }));
    expect(verdicts.map((v) => v.outcome)).toEqual(['inconclusive']);
  });
});
