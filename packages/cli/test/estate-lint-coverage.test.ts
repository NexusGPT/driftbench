import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ClaudeCodeReader, renderEstateMap, scanEstate } from '@agent-nexus/driftbench-estate';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

async function run(argv: string[], cwd: string) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function estate(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-lint-coverage-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** No finding, and two files under `.claude` that the guard's source names but no part type covers. */
const FILES: Record<string, string> = {
  'CLAUDE.md': '# Rules\n\nNever delete a record.\n',
  '.claude/settings.json': JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/fs-guard.py' }],
        },
      ],
    },
  }),
  '.claude/hooks/fs-guard.py':
    'import os\nFLAG = ".claude/hooks/.fs-guard-observe"\nJUDGE = ".claude/hooks/lib/judges/tone.request.json"\nprint(os.path.exists(FLAG), JUDGE)\n',
  '.claude/hooks/.fs-guard-observe': 'on\n',
  '.claude/hooks/lib/judges/tone.request.json':
    '{ "id": "tone", "system": "Judge the tone.", "output": {} }\n',
  '.claude/hooks/CHECK-REGISTRY.md':
    '# Checks\n\n| Id | Guard | Enforces |\n|---|---|---|\n| G1 | fs-guard.py | "Never delete a record." |\n',
};

const TYPES = `types:
  judge-request:
    extends: hook
    locate: hooks/lib/judges/*.request.json
    aspects: [guards, informs]
    loaded: on-event
  observe-flag:
    locate: hooks/.*-observe
    aspects: [configures]
    scope: { type: hook, by: name }
    loaded: always
`;

async function lint(files: Record<string, string>) {
  const root = await estate(files);
  const scan = await run(['estate', 'scan', '.', '--no-model', '--out', 'map.yaml'], root);
  expect(scan.err).toBe('');
  return run(['estate', 'lint', 'map.yaml'], root);
}

/** The map of an estate whose standing rule a stand-in model splits, so the rule checks have an input. */
async function lintWithRule(files: Record<string, string>) {
  const root = await estate(files);
  const port = new FakeModelPort([
    JSON.stringify({
      chunk: 'CLAUDE.md',
      atoms: [
        {
          kind: 'register',
          title: 'No deletes',
          quote: 'Never delete a record.',
          evidence: [{ type: 'custom', name: 'no_delete' }],
        },
      ],
    }),
  ]);
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), port });
  await writeFile(join(root, 'map.yaml'), renderEstateMap(map));
  return run(['estate', 'lint', 'map.yaml'], root);
}

describe('driftbench estate lint with unknown files and checks that did not run', () => {
  it('never prints Clean while a file under .claude is one no type covers, names the files, and exits 1', async () => {
    const result = await lint(FILES);
    expect(result.out).toContain(
      '  unknown     2 files no part type covers: .claude/hooks/.fs-guard-observe, .claude/hooks/lib/judges/tone.request.json.',
    );
    expect(result.out).toContain(
      'Not clean: 2 files no part type covers, which no check read; 1 check did not run.',
    );
    expect(result.out).not.toContain('Clean.');
    // The exit code says what the last line says: not clean is 1, unknown files included.
    expect(result.code).toBe(1);
  });

  it('names each check with no input on the not-run line, and is not clean while one did not run', async () => {
    // With no model, no rule is read: the rule check has no input, so it did not run.
    const result = await lint({ ...FILES, '.claude/driftbench.estate.yaml': TYPES });
    const notRun = result.out.split('\n').find((line) => line.startsWith('  not-run     '));
    expect(notRun).toBe('  not-run     UNENFORCED: no input to read.');
    expect(result.out).not.toContain('  unknown ');
    expect(result.out).toContain('Not clean: 1 check did not run.');
    expect(result.out).not.toContain('Clean.');
    expect(result.code).toBe(1);
  });

  it('prints Clean and exits 0 once every check ran and passed and a type covers every file', async () => {
    const result = await lintWithRule({ ...FILES, '.claude/driftbench.estate.yaml': TYPES });
    expect(result.out).not.toContain('  not-run ');
    expect(result.out).not.toContain('  unknown ');
    expect(result.out).toContain('Clean.');
    expect(result.code).toBe(0);
  });
});
