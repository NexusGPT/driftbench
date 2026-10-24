import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, lintEstate, renderEstateMap, scanEstate } from '../../src/index';
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
    // node_modules is ignored as a folder: it is one entry, with the number of its files.
    const entry = { what: '.claude/node_modules', reason: 'ignored', files: 1 };
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

  it('lists a file an ignore glob matches alone by its path, and a folder of ignored files once with its count', async () => {
    const raw = await new ClaudeCodeReader().read(
      await estate({
        'CLAUDE.md': '# Rules\n\nKeep replies short.\n',
        '.claude/notes/debug.log': 'a log line\n',
        '.claude/hooks/lib/node_modules/a/index.js': '1\n',
        '.claude/hooks/lib/node_modules/b/index.js': '2\n',
        '.claude/hooks/lib/node_modules/b/util.js': '3\n',
      }),
    );
    expect(raw.coverage?.skipped.filter((entry) => entry.reason === 'ignored')).toEqual([
      { what: '.claude/notes/debug.log', reason: 'ignored' },
      { what: '.claude/hooks/lib/node_modules', reason: 'ignored', files: 3 },
    ]);
  });

  it('keeps the map and the lint small when an ignored folder holds 10,000 files', async () => {
    const files: Record<string, string> = { 'CLAUDE.md': '# Rules\n\nKeep replies short.\n' };
    for (let index = 0; index < 10_000; index++) files[`.claude/hooks/lib/node_modules/f${index}.js`] = '1\n';
    const { map, raw } = await scanEstate({
      root: await estate(files),
      reader: new ClaudeCodeReader(),
      now: NOW,
    });
    expect(map.coverage?.skipped).toContainEqual({
      what: '.claude/hooks/lib/node_modules',
      reason: 'ignored',
      files: 10_000,
    });
    // One entry for the folder: the map stays a few kilobytes and every check carries one entry, not 10,000.
    expect(renderEstateMap(map).length).toBeLessThan(10_000);
    expect(JSON.stringify(lintEstate(map, raw).outcomes).length).toBeLessThan(20_000);
  }, 120_000);

  it('never reads a path the prose names behind the home folder, and lists it as skipped: home-not-mapped', async () => {
    // A guard script behind the home folder is the guard checks' (the MISSING_SCRIPT exemption, #1522).
    const raw = await new ClaudeCodeReader().read(
      await estate({
        'CLAUDE.md': [
          '# Rules',
          '',
          'Read `~/notes/policy.md` before a reply.',
          "Read '~/notes/quoted.md' too.",
          '@~/notes/tone.md',
          '@$HOME/notes/style.md',
          // Prose names no path behind a variable: this line is neither read nor listed.
          'Read $HOME/notes/variable.md too.',
          '',
        ].join('\n'),
      }),
    );
    // Quotes in prose are punctuation, not a shell's: a quoted tilde in prose is a home path all the same.
    expect(raw.coverage?.skipped.filter((skip) => skip.reason === 'home-not-mapped')).toEqual([
      { what: '$HOME/notes/style.md', reason: 'home-not-mapped' },
      { what: '~/notes/policy.md', reason: 'home-not-mapped' },
      { what: '~/notes/quoted.md', reason: 'home-not-mapped' },
      { what: '~/notes/tone.md', reason: 'home-not-mapped' },
    ]);
    expect(raw.files.map((file) => file.path)).toEqual(['CLAUDE.md']);
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
