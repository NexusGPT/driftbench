import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

/**
 * What a read keeps out, and what the reference checks read. The cases of the estate seam tests
 * (sonnet-outside-refs, coverage.seam.test.ts; sonnet-outside-paths, variants/coverage.test.ts), red on the step 3
 * head: a file kept out on purpose is listed by path with a reason code; a named file the reader does not read as
 * prose stays unknown; the reference checks read the prose parts.
 */

const outcomeOf = (result: ReturnType<typeof lintEstate>, check: string) => {
  const found = result.outcomes.find((outcome) => outcome.check === check);
  if (!found) throw new Error(`no ${check} outcome`);
  return found;
};

describe('what a read keeps out on purpose', () => {
  it('lists each ignored file by its path, on the map and on every check, and reads the same parts', async () => {
    const files = {
      'CLAUDE.md': '# Rules\n\nKeep replies short.\n',
      '.claude/skills/aa/SKILL.md': '---\nname: aa\ndescription: Handles aa work.\n---\n\nPlain.\n',
    };
    const plain = await scanEstate({ root: await estate(files), reader: new ClaudeCodeReader(), now: NOW });
    const withIgnored = await scanEstate({
      root: await estate({ ...files, '.claude/node_modules/pkg/index.js': 'module.exports = 1;\n' }),
      reader: new ClaudeCodeReader(),
      now: NOW,
    });
    const entry = { what: '.claude/node_modules/pkg/index.js', reason: 'ignored' };
    expect(withIgnored.map.coverage?.skipped).toContainEqual(entry);
    const before = lintEstate(plain.map, plain.raw);
    const after = lintEstate(withIgnored.map, withIgnored.raw);
    expect(outcomeOf(after, 'ORPHAN').coverage.skipped).toContainEqual(entry);
    expect(
      after.outcomes.every((outcome) => outcome.coverage.skipped.every((skip) => skip.reason !== '')),
    ).toBe(true);
    // A part kept out is no part read: every check reads what it read without it.
    expect(after.outcomes.map((outcome) => outcome.coverage.read)).toEqual(
      before.outcomes.map((outcome) => outcome.coverage.read),
    );
  });

  it('keeps a file the prose names but the reader does not read as prose unknown', async () => {
    const raw = await new ClaudeCodeReader().read(
      await estate({
        // The prose names the file, so it is no orphan, yet no type says what it is.
        'CLAUDE.md': '# Rules\n\nKeep replies short. The data is in `.claude/blobs/data.bin`.\n',
        '.claude/blobs/data.bin': 'not text',
      }),
    );
    expect(raw.coverage?.unknown).toEqual(['.claude/blobs/data.bin']);
  });
});

describe('what the reference checks read', () => {
  it('reads every prose part: prose that names no path passes, having read the prose', async () => {
    const { map, raw } = await scanEstate({
      root: await estate({
        'CLAUDE.md': '# Rules\n\nKeep replies short.\n',
        '.claude/memory/a.md': '# Memory\n\nPlain notes.\n',
      }),
      reader: new ClaudeCodeReader(),
      now: NOW,
    });
    const result = lintEstate(map, raw);
    for (const check of ['MISSING_REFERENCE', 'UNRESOLVED_REFERENCE', 'AMBIGUOUS_REFERENCE', 'EXTERNAL']) {
      expect(outcomeOf(result, check).status, check).toBe('pass');
      expect(outcomeOf(result, check).coverage.read, check).toBe(2);
    }
  });

  it('is not run on an estate with no prose part', async () => {
    const { map, raw } = await scanEstate({
      root: await estate({ '.claude/settings.json': `${JSON.stringify({ model: 'opus' })}\n` }),
      reader: new ClaudeCodeReader(),
      now: NOW,
    });
    const outcome = outcomeOf(lintEstate(map, raw), 'MISSING_REFERENCE');
    expect([outcome.status, outcome.notRun, outcome.coverage.read]).toEqual(['not-run', 'no-input', 0]);
  });
});
