import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  DEFAULT_EXTERNALS,
  ESTATE_CONFIG,
  isExternal,
  lintEstate,
  scanEstate,
} from '../../src/index';
import { estate, NOW, structurePointer } from '../support';
import { CASES } from './cases';

async function references(files: Record<string, string>) {
  const root = await estate(files);
  const { map, raw } = await scanEstate({
    root,
    reader: new ClaudeCodeReader(),
    now: NOW,
    pointer: structurePointer(),
  });
  const atoms = map.atoms.filter((atom) => atom.kind === 'reference');
  return {
    lint: lintEstate(map, raw),
    raw,
    named: Object.fromEntries(
      atoms.map((atom) => [
        atom.title.replace(/^Read /, ''),
        [atom.fields?.exists, atom.fields?.external ?? false],
      ]),
    ),
  };
}

describe('paths outside the estate', () => {
  it('reads a path as external only from how it is written: ~/, /, or an external folder', () => {
    expect([...DEFAULT_EXTERNALS]).toEqual(['docs/', '_meta/']);
    expect(isExternal('~/notes/a.md', DEFAULT_EXTERNALS)).toBe(true);
    expect(isExternal('/etc/claude/a.md', DEFAULT_EXTERNALS)).toBe(true);
    expect(isExternal('docs/DESIGN.md', DEFAULT_EXTERNALS)).toBe(true);
    expect(isExternal('./_meta/IDENTITY.md', DEFAULT_EXTERNALS)).toBe(true);
    expect(isExternal('my-docs/a.md', DEFAULT_EXTERNALS)).toBe(false);
    expect(isExternal('capture.mjs', DEFAULT_EXTERNALS)).toBe(false);
    expect(isExternal('companies/a.md', DEFAULT_EXTERNALS)).toBe(false);
    expect(isExternal('companies/a.md', ['companies'])).toBe(true);
  });

  it('marks an external path found, never guesses one, and lets a file the estate holds win', async () => {
    const { named, lint } = await references({
      'CLAUDE.md': [
        '# Rules',
        '',
        '- Read `docs/DESIGN.md`, `_meta/IDENTITY.md` and `~/notes/today.md` before a build.',
        '- Run `capture.mjs` and read `design-notes.md` after it.',
        '- The local guide is `docs/guide.md`.',
        '',
      ].join('\n'),
      'docs/guide.md': '# Guide\n',
      '.claude/docs/guide.md': '# Guide\n',
    });
    expect(named).toEqual({
      'docs/DESIGN.md': [false, true],
      '_meta/IDENTITY.md': [false, true],
      '~/notes/today.md': [false, true],
      'capture.mjs': [false, false],
      'design-notes.md': [false, false],
      'docs/guide.md': [true, false],
    });
    expect(lint.counts.EXTERNAL).toBe(3);
    expect(lint.counts.MISSING_REFERENCE).toBe(2);
  });

  it('takes the external folders from the config, in place of the defaults', async () => {
    const { named, raw } = await references({
      'CLAUDE.md': '# Rules\n\nRead `companies/fjord.md` and `docs/DESIGN.md` first.\n',
      [ESTATE_CONFIG]: 'externals:\n  - companies/\n',
    });
    expect(raw.externals).toEqual(['companies/']);
    expect(named).toEqual({ 'companies/fjord.md': [false, true], 'docs/DESIGN.md': [false, false] });
  });

  it('does not fail the lint on external paths alone', async () => {
    const { lint } = await references({ 'CLAUDE.md': '# Rules\n\nRead `~/notes/today.md` first.\n' });
    expect(lint.findings.map((finding) => finding.code)).toEqual(['EXTERNAL']);
    expect(lint.failed).toBe(false);
  });

  it('counts the four reader-cases paths outside the estate as information', async () => {
    const { map, raw } = await scanEstate({
      root: CASES,
      reader: new ClaudeCodeReader(),
      now: NOW,
      pointer: structurePointer(),
    });
    const external = lintEstate(map, raw).findings.filter((finding) => finding.code === 'EXTERNAL');
    expect(external.map((finding) => finding.message.replace(/^CLAUDE\.md:\d+ names /, ''))).toEqual([
      'companies/fjord-kitchenware.md, outside the estate',
      '_meta/IDENTITY.md, outside the estate',
      'docs/DESIGN.md, outside the estate',
      '~/notes/claims.md, outside the estate',
    ]);
  });
});
