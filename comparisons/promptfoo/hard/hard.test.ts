import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
describe('hard comparison evidence', () => {
  it('checks labels, malformed ledgers, factual categories and paired statistics', () => {
    const output = execFileSync(
      'python3',
      ['-m', 'unittest', 'discover', '-s', here, '-p', 'test_*.py', '-v'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(output).toBe('');
  });

  it('replays every saved decision under its exact input and procedure', () => {
    const output = execFileSync('python3', [`${here}verify.py`], { encoding: 'utf8' });
    expect(output).toContain('2496 case/procedure decisions verified; no model calls.');
  }, 30_000);
});
