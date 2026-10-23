import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, renderEstateMap, scanEstate } from '../../src/index';
import { PROFILE_CLASSIFIER } from '../../src/scan/claude-code';
import type { FileClassifier } from '../../src/scan/profile-classify';
import { NOW, replayPointer } from '../support';
import { LEGACY_CLASSIFIER } from './legacy-classifier';

/**
 * The equality proof of the Claude Code profile: every fixture estate read through the profile's part types gives
 * the same raw estate and the same map bytes as through the reader's classification before the move (frozen in
 * ./legacy-classifier.ts). A difference fails with the first file whose kind differs.
 */

const EXAMPLES = fileURLToPath(new URL('../../../../examples/estates/', import.meta.url));
/**
 * The committed fixture estates, each with the recorded labels its committed map was scanned with (fixture-v2 keeps
 * the labels of the first fixture's ledger, as its own test scans it).
 */
const FIXTURES: Array<[string, string | undefined]> = [
  ['fixture', undefined],
  ['fixture-v2', join(EXAMPLES, 'fixture', 'ledger.json')],
  ['reader-cases', undefined],
];

/**
 * A synthetic estate with a file at every edge of the classification: standing files at the root, in the layout
 * and nested beside it; settings; memory at two depths and a memory file that is no markdown; a skill with its
 * references, scripts, a nested `SKILL.md`, a `CLAUDE.md` and a file named like a registry; a folder under the
 * skills folder with no `SKILL.md`; a loose file in the skills folder; helpers at two depths and one that is not
 * markdown; registries by name in each case and extension; a catalogue, step lists and a check table by shape;
 * files of another runtime; and files no type locates.
 */
const EDGES: Record<string, string> = {
  'CLAUDE.md': '# Rules\n\nUse the `report` skill to write a report.\n\n@docs/extra.md\n',
  'CLAUDE.local.md': '# Local\n\nKeep replies short.\n',
  'docs/extra.md': '# Extra\n\nAlways cite the source file.\n',
  'docs/CLAUDE.md': '# Docs rules\n\nWrite plainly.\n',
  'pkg/sub/CLAUDE.local.md': '# Nested local\n\nPrefer small changes.\n',
  'AGENTS.md': '# For another runtime\n\nRun the tests.\n',
  '.mcp.json': '{ "mcpServers": { "files": { "command": "files-server" } } }\n',
  '.codex/agents/reviewer.toml': 'name = "reviewer"\n',
  '.claude/CLAUDE.md': '# Layout rules\n\nAsk before deleting.\n',
  '.claude/CLAUDE.local.md': '# Layout local\n\nNo network.\n',
  '.claude/settings.json': JSON.stringify(
    {
      model: 'sonnet',
      permissions: { allow: ['Bash(git status)'], deny: ['Bash(rm -rf *)'] },
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'python3 "$CLAUDE_PROJECT_DIR"/.claude/hooks/check.py' }],
          },
        ],
      },
    },
    null,
    2,
  ),
  '.claude/settings.local.json': '{ "outputStyle": "Concise" }\n',
  '.claude/memory.md': '# Not memory\n\nA file named memory.\n',
  '.claude/memory/notes.md': '# Notes\n\nThe release is on Friday.\n',
  '.claude/memory/deep/more.md': '# More\n\nThe team owns the parser.\n',
  '.claude/memory/data.json': '{ "facts": [] }\n',
  '.claude/skills/report/SKILL.md':
    '---\nname: report\ndescription: Writes the weekly report.\nallowed-tools: Read, Write\n---\n\nRead `references/guide.md` first.\n',
  '.claude/skills/report/references/guide.md': '# Guide\n\nOne page at most.\n',
  '.claude/skills/report/scripts/run.py': 'print("report")\n',
  '.claude/skills/report/examples/a.md': '# Example\n\nA short report.\n',
  '.claude/skills/report/CLAUDE.md': '# Skill rules\n\nUse the template.\n',
  '.claude/skills/report/nested/SKILL.md': '---\nname: nested\n---\n\nNot a skill of its own.\n',
  '.claude/skills/report/registry.md': '# Not a registry\n\nInside a skill.\n',
  '.claude/skills/no-entry/notes.md': '# Notes\n\nA folder with no SKILL.md.\n',
  '.claude/skills/loose.md': '# Loose\n\nA file in the skills folder.\n',
  '.claude/agents/checker.md':
    '---\nname: checker\ndescription: Checks a record.\ntools: Read\n---\n\nYou read.\n',
  '.claude/agents/team/lead.md': '---\nname: lead\ndescription: Leads.\n---\n\nYou lead.\n',
  '.claude/agents/catalog.md': '---\nname: catalog\ndescription: Lists.\n---\n\nYou list.\n',
  '.claude/agents/notes.txt': 'Not a helper.\n',
  '.claude/hooks/check.py': 'import sys\nsys.exit(0)\n',
  '.claude/hooks/lib/util.py': 'def helper():\n    return 1\n',
  '.claude/hooks/CHECK-REGISTRY.md':
    '# Check registry\n\n| Id | Guard | Enforces |\n|---|---|---|\n| G1 | check.py | "Ask before deleting." |\n',
  '.claude/hooks/CATALOGUE.json': JSON.stringify(
    { checks: [{ id: 'C1', kind: 'check', event: 'Stop', work: 'check.py', status: 'enforce' }] },
    null,
    2,
  ),
  '.claude/Registry.YAML': 'checks: []\n',
  '.claude/catalogue-notes.txt': 'Not a registry by extension.\n',
  '.claude/x.registry.jsonc': '{ "checks": [] }\n',
  '.claude/process-steps.json':
    '{ "processes": { "work": { "steps": [ { "id": "start", "next": [] } ] } } }\n',
  '.claude/flow.yaml': 'steps:\n  - id: plan\n  - id: build\n',
  '.claude/checks.yaml':
    'checks:\n  - id: K1\n    description: Blocks a push to main.\n    guard: check.py\n',
  '.claude/plain.json': '{ "colour": "blue" }\n',
  '.claude/commands/ship.md': '---\ndescription: Ships.\n---\n\nShip it.\n',
  'README.md': '# A readme no type covers\n',
};

async function writeEstate(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-profile-equality-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** Every file under a folder, relative to it, with `/`. */
async function filesUnder(root: string, folder = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = folder === '' ? entry.name : posix.join(folder, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

async function readBoth(root: string, options: { userSkills?: string } = {}) {
  const legacy = await new ClaudeCodeReader({ ...options, classifier: LEGACY_CLASSIFIER }).read(root);
  const profile = await new ClaudeCodeReader({ ...options, classifier: PROFILE_CLASSIFIER }).read(root);
  return { legacy, profile };
}

/** The first file whose kind or owner differs, for a readable failure before the whole diff. */
function firstDifference(a: { files: Array<{ path: string; kind: string; owner?: string }> }, b: typeof a) {
  const theirs = new Map(b.files.map((file) => [file.path, `${file.kind}/${file.owner ?? ''}`]));
  for (const file of a.files) {
    const other = theirs.get(file.path);
    if (other !== `${file.kind}/${file.owner ?? ''}`)
      return `${file.path}: ${file.kind}/${file.owner ?? ''} vs ${other}`;
  }
  return undefined;
}

describe('the Claude Code profile reads every estate as the reader did', () => {
  it('classifies every path the reader can meet the same way, file by file', async () => {
    const root = await writeEstate(EDGES);
    const classifiers: Array<[string, FileClassifier]> = [
      ['legacy', LEGACY_CLASSIFIER],
      ['profile', PROFILE_CLASSIFIER],
    ];
    const seen: string[] = [];
    for (const path of await filesUnder(root)) {
      const text = await readFile(join(root, path), 'utf8');
      // The reader classifies a file of the layout folder or a standing file; any other path never reaches it.
      if (path.startsWith('.claude/') || LEGACY_CLASSIFIER.besideLayout(path)) {
        const [legacy, profile] = classifiers.map(([, classifier]) => classifier.classify(path, text));
        expect(profile, path).toEqual(legacy);
        seen.push(`${path} ${legacy?.kind}`);
      }
      expect(PROFILE_CLASSIFIER.besideLayout(path), path).toBe(LEGACY_CLASSIFIER.besideLayout(path));
    }
    // Every kind of the map is met at least once, so no rule of the classification goes untested.
    const kinds = new Set(seen.map((line) => line.split(' ')[1]));
    expect([...kinds].sort()).toEqual([
      'memory',
      'other',
      'registry',
      'settings',
      'skill',
      'skill_file',
      'standing',
      'step_list',
      'subagent',
    ]);
  });

  it('gives the same raw estate and the same map bytes on the edge estate, with a user skill layer', async () => {
    const root = await writeEstate(EDGES);
    const layer = await writeEstate({
      'mine/SKILL.md': '---\nname: mine\ndescription: My own.\n---\n\nDo it my way.\n',
      'mine/references/a.md': '# A\n',
      'group/inner/SKILL.md': '---\nname: inner\n---\n\nInner.\n',
    });
    const { legacy, profile } = await readBoth(root, { userSkills: layer });
    expect(firstDifference(profile, legacy)).toBeUndefined();
    expect(JSON.stringify(profile)).toBe(JSON.stringify(legacy));
    const maps = await Promise.all(
      [LEGACY_CLASSIFIER, PROFILE_CLASSIFIER].map(async (classifier) =>
        renderEstateMap(
          (
            await scanEstate({
              root,
              reader: new ClaudeCodeReader({ userSkills: layer, classifier }),
              now: NOW,
            })
          ).map,
        ),
      ),
    );
    expect(maps[1]).toBe(maps[0]);
  });

  it.each(FIXTURES)('gives the same raw estate and the same map bytes on %s', async (name, ledger) => {
    const root = join(EXAMPLES, name);
    const { legacy, profile } = await readBoth(root);
    expect(firstDifference(profile, legacy)).toBeUndefined();
    expect(JSON.stringify(profile)).toBe(JSON.stringify(legacy));
    const maps = await Promise.all(
      [LEGACY_CLASSIFIER, PROFILE_CLASSIFIER].map(async (classifier) =>
        renderEstateMap(
          (
            await scanEstate({
              root,
              reader: new ClaudeCodeReader({ classifier }),
              now: NOW,
              pointer: await replayPointer(root, ledger),
            })
          ).map,
        ),
      ),
    );
    expect(maps[1]).toBe(maps[0]);
  });
});
