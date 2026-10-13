import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../src/index';
import { estate, NOW } from './support';

async function lint(standing: string) {
  const root = await estate({ 'CLAUDE.md': standing });
  const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return lintEstate(map, raw).findings.filter((finding) => finding.code === 'OVERSIZE');
}

describe('the size of the standing instructions, in characters', () => {
  it('counts an emoji as one character, not as two code units', async () => {
    const line = '\u{1F956}'.repeat(100);
    expect(await lint(Array.from({ length: 300 }, () => line).join('\n'))).toEqual([]);
  });

  it('still finds a file over the ceiling', async () => {
    const findings = await lint('a'.repeat(40_001));
    expect(findings.map((finding) => finding.message)).toEqual([
      'the standing instructions hold 40001 characters, over the ceiling of 40000',
    ]);
  });
});
