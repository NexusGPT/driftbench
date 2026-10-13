import { describe, expect, it } from 'vitest';
import { allowPublicPatterns } from '../src/guard-allow';

const publicMath = JSON.stringify({ text: 'Public math result +19999999999' }); // guard:allow synthetic invalid-area fixture

describe('public recording pattern annotations', () => {
  it('marks a public numeric quote and leaves unrelated recording lines unchanged', async () => {
    const other = JSON.stringify({ text: 'No matching pattern' });
    const result = await allowPublicPatterns(`${publicMath}\n${other}\n`, []);
    expect(result.marked).toBe(1);
    expect(JSON.parse(result.text.split('\n')[0] ?? '').guard).toBe('guard:allow');
    expect(result.text.split('\n')[1]).toBe(other);
    expect(result.denied).toBe(0);
  });
  it('does not mark a denylisted line even when it also contains a numeric pattern', async () => {
    const text = JSON.stringify({ text: 'private-client-placeholder Public math result +19999999999' }); // guard:allow synthetic invalid-area fixture
    const result = await allowPublicPatterns(`${text}\n`, ['private-client-placeholder']);
    expect(result.denied).toBe(1);
    expect(result.marked).toBe(0);
    expect(result.text).toBe(`${text}\n`);
  });
  it('checks text beyond the tree guard byte limit', async () => {
    const ordinary = JSON.stringify({ text: 'No matching pattern ' + 'placeholder '.repeat(30) });
    const text = `${Array(40_000).fill(ordinary).join('\n')}\n${publicMath}`;
    expect(Buffer.byteLength(text)).toBeGreaterThan(10 * 1024 * 1024);
    const result = await allowPublicPatterns(`${text}\n`, []);
    expect(result.marked).toBe(1);
    expect(JSON.parse(result.text.split('\n').at(-2) ?? '').guard).toBe('guard:allow');
  });
});
