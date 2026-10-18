import { describe, expect, it } from 'vitest';
import { must, mustNot } from '../src/checks/must';
import { acme } from './support/acme';
import { context, failing, observed, run } from './support/context';

const base = acme('acme-new-customer-coverage');
const withRules = (match_case: boolean | undefined) => ({
  ...base,
  rules: { ...(base.rules ?? {}), ...(match_case === undefined ? {} : { match_case }) },
});
const spec = (text: string, pattern: string, kind: 'must' | 'must_not', strict?: boolean) => {
  const s = withRules(strict);
  const blocks = s.blocks.map((b, i) =>
    i === 0 ? { ...b, expect: { ...(b.expect ?? {}), [kind]: [pattern] } } : b,
  );
  return { spec: { ...s, blocks }, text };
};

describe('must: case-insensitive and trailing-punctuation tolerant by default', () => {
  it('matches a pattern whatever the case of the reply', async () => {
    const { spec: s, text } = spec('Fiber is here.', 'fiber', 'must');
    expect(failing(await run(must, context(s, 0, observed(text))))).toEqual([]);
  });

  it('matches an end anchor after trailing punctuation', async () => {
    const { spec: s, text } = spec('Fiber at 300 Mbps.', 'Mbps$', 'must');
    expect(failing(await run(must, context(s, 0, observed(text))))).toEqual([]);
  });

  it('keeps word boundaries: 300 with \\b does not match 3000', async () => {
    const { spec: s, text } = spec('3000 Mbps plan', '\\b300\\b', 'must');
    expect(failing(await run(must, context(s, 0, observed(text))))).toEqual(['must.0']);
  });

  it('a must_not pattern is case-insensitive too', async () => {
    const { spec: s, text } = spec('NO FIBER here', 'fiber', 'must_not');
    expect(failing(await run(mustNot, context(s, 0, observed(text))))).toEqual(['must_not.0']);
  });
});

describe('must: strict matching', () => {
  it('with match_case true, the pattern must match the case of the reply', async () => {
    const { spec: s, text } = spec('Fiber is here.', 'fiber', 'must', true);
    expect(failing(await run(must, context(s, 0, observed(text))))).toEqual(['must.0']);
  });

  it('with match_case true, a trailing punctuation mark is not ignored', async () => {
    const { spec: s, text } = spec('Fiber at 300 Mbps.', 'Mbps$', 'must', true);
    expect(failing(await run(must, context(s, 0, observed(text))))).toEqual(['must.0']);
  });
});
