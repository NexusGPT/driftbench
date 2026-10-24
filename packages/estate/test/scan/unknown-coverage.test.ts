import { describe, expect, it } from 'vitest';
import {
  ClaudeCodeReader,
  lintEstate,
  parseEstateMapText,
  renderEstateMap,
  scanEstate,
} from '../../src/index';
import { estate, NOW } from '../support';

/**
 * Unknown counting: a file under the runtime's own folder that no part type covers is listed in the map's
 * coverage, and the lint is never clean while one is. A file a reference reaches is covered; a file beside the
 * folder counts only when a type locates it.
 */

/**
 * An estate with no finding and two files under `.claude` no built-in type covers: the guard's source names an
 * observe flag and a judge request, so neither is an orphan, yet no type says what they are. README.md and the
 * source beside `.claude` are no file of the agent.
 */
const FILES: Record<string, string> = {
  'CLAUDE.md': '# Rules\n\nNever delete a record.\n',
  'README.md': '# Notes for people\n',
  'src/app.ts': 'export const answer = 42;\n',
  '.claude/settings.json': JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/fs-guard.py' }],
          },
        ],
      },
    },
    null,
    2,
  ),
  '.claude/hooks/fs-guard.py':
    'import os\nFLAG = ".claude/hooks/.fs-guard-observe"\nJUDGE = ".claude/hooks/lib/judges/tone.request.json"\nprint(os.path.exists(FLAG), JUDGE)\n',
  '.claude/hooks/.fs-guard-observe': 'on\n',
  '.claude/hooks/lib/judges/tone.request.json':
    '{ "id": "tone", "system": "Judge the tone.", "output": {} }\n',
  '.claude/hooks/CHECK-REGISTRY.md':
    '# Checks\n\n| Id | Guard | Enforces |\n|---|---|---|\n| G1 | fs-guard.py | "Never delete a record." |\n',
};

const UNKNOWN = ['.claude/hooks/.fs-guard-observe', '.claude/hooks/lib/judges/tone.request.json'];

/** The types of the Claude Code page's example, declared from `.claude/`. */
const TYPES = `types:
  judge-request:
    extends: hook
    locate: hooks/lib/judges/*.request.json
    fields: { id: $.id, prompt: $.system, schema: $.output }
    aspects: [guards, informs]
    loaded: on-event
  observe-flag:
    locate: hooks/.*-observe
    aspects: [configures]
    scope: { type: hook, by: name }
    loaded: always
`;

describe('unknown counting', () => {
  it('lists the files under .claude no type covers in the map, and none beside it', async () => {
    const root = await estate({ ...FILES, '.claude/notes/plan.txt': 'A plan nobody loads.\n' });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.coverage?.unknown).toEqual([...UNKNOWN, '.claude/notes/plan.txt']);
    // CLAUDE.md, the settings, the guard script and the registry.
    expect(map.coverage?.covered).toBe(4);
    const again = parseEstateMapText(renderEstateMap(map));
    expect(again.ok && again.map.coverage).toEqual(map.coverage);
  });

  it('covers a file a reference of the estate reaches, though no type locates it', async () => {
    const root = await estate({
      ...FILES,
      'CLAUDE.md': '# Rules\n\nRead `.claude/docs/policy.md` before you change a record.\n',
      '.claude/docs/policy.md': '# Policy\n\nNever delete a record.\n',
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.coverage?.unknown).toEqual(UNKNOWN);
  });

  it('covers the files a declared type locates, and skips the configuration that declares it', async () => {
    const root = await estate({ ...FILES, '.claude/driftbench.estate.yaml': TYPES });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.coverage?.unknown).toEqual([]);
    expect(raw.coverage?.skipped).toContainEqual({
      what: '.claude/driftbench.estate.yaml',
      reason: 'estate-config',
    });
    expect(raw.notes.filter((note) => note.message.startsWith('types:'))).toEqual([]);
  });

  it('refuses a malformed types document whole, with its code, and counts with the built-in types', async () => {
    const root = await estate({
      ...FILES,
      '.claude/driftbench.estate.yaml': `${TYPES}  broken:\n    locate: x/*.md\n    aspects: [shouts]\n    loaded: always\n`,
    });
    const raw = await new ClaudeCodeReader().read(root);
    expect(raw.notes.map((note) => note.message).filter((message) => message.startsWith('types:'))).toEqual([
      'types: unknown-aspect at types.broken.aspects[0]: broken: shouts is no aspect; the aspects are instructs, acts, guards, delegates, informs, configures, invokes, executes, indexes, person-facing',
    ]);
    expect(raw.coverage?.unknown).toEqual(UNKNOWN);
  });

  it('gives a lint with no finding but an unknown file the summary unknown-files, never clean', async () => {
    const root = await estate(FILES);
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const result = lintEstate(map, raw);
    expect(result.findings.filter((finding) => finding.code !== 'UNENFORCED')).toEqual([]);
    expect(result.unknown).toEqual(UNKNOWN);
    expect(result.summary).toBe('unknown-files');
    for (const outcome of result.outcomes) expect(outcome.coverage.unknown, outcome.check).toEqual(UNKNOWN);
  });

  it('has no unknown file once a type covers every file, and is not clean while a check did not run', async () => {
    const root = await estate({ ...FILES, '.claude/driftbench.estate.yaml': TYPES });
    const { map, raw } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    const result = lintEstate(map, raw);
    expect(result.unknown).toEqual([]);
    // With no model no rule is read, so the rule check had no input: a lint is clean only when every check ran.
    expect(result.summary).toBe('checks-not-run');
    expect(
      result.outcomes
        .filter((outcome) => outcome.status === 'not-run')
        .map((outcome) => [outcome.check, outcome.notRun]),
    ).toEqual([['UNENFORCED', 'no-input']]);
  });
});
