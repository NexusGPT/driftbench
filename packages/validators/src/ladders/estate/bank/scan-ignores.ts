import { skillFile } from '../layout';
import { namesFor, plantSkill } from './common';
import type { Tier } from './frame';
import { type Case, standardSkill } from './hostile';
import { BASE, type Check } from './planted';

/**
 * bench.defects, ignore items: files the estate's owner keeps out of the estate and out of the labelers. A
 * `.gitignore` of the estate, a `.claude` folder nested in a skill or hook folder (an agent's local memory),
 * and a test cache are not files an agent loads. The oracle: such a file is not among the files the scan
 * read, no chunk of it is sent to the splitter (the labeler), and no lint finding names it; a local file the
 * runtime loads whatever the `.gitignore` says (`.claude/settings.local.json`) is still read.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const CAUSE =
  'leave out the files a .gitignore, a nested .claude folder or a test cache keeps out of the estate';

const PROSE = '# Local notes\n\nAlways keep the totals in whole cents.\n';

/** The file is not among the files read, and no chunk of it went to the splitter. */
function notRead(path: string): Check {
  return (scan) => {
    if (scan.raw.files.some((file) => file.path === path)) return `${path} is read as a file of the estate`;
    if (scan.requests.some((request) => request.file === path)) return `${path} is sent to the splitter`;
    return undefined;
  };
}

/** The file is read, as a control: the item does not leave out more than it should. */
function isRead(path: string): Check {
  return (scan) =>
    scan.raw.files.some((file) => file.path === path) ? undefined : `${path} is left out, and it is read`;
}

type Plan = {
  files: Array<[path: string, text: string]>;
  left: string[];
  kept?: string[];
};

function ignoreCase(key: string, tier: Tier, title: string, plan: (skill: string) => Plan): Case {
  return {
    key: `ignore-${key}`,
    tier,
    title,
    component: READER,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      const { files, left, kept } = plan(names.skill);
      for (const [path, text] of files) e.raw(path, text, BASE);
      for (const path of left) e.check(o, notRead(path));
      for (const path of kept ?? []) e.check(o, isRead(path));
    },
  };
}

const CASES: Case[] = [
  ignoreCase(
    'gitignore-file',
    2,
    'a file the estate .gitignore names is not read or sent to a labeler',
    (skill) => {
      const kept = skillFile(skill, 'references/guide.md');
      const left = skillFile(skill, 'references/local-notes.md');
      return {
        files: [
          ['.gitignore', `${left}\n`],
          [kept, '# Guide\n\nThe guide is shared.\n'],
          [left, PROSE],
        ],
        left: [left],
        kept: [kept],
      };
    },
  ),
  ignoreCase(
    'gitignore-glob',
    2,
    'a file a .gitignore glob names, at any depth, is not read or sent to a labeler',
    (skill) => {
      const kept = skillFile(skill, 'references/guide.md');
      const left = skillFile(skill, 'references/deep/memory-local.md');
      return {
        files: [
          ['.gitignore', '# local files\n*-local.md\n'],
          [kept, '# Guide\n\nThe guide is shared.\n'],
          [left, PROSE],
        ],
        left: [left],
        kept: [kept],
      };
    },
  ),
  ignoreCase(
    'gitignore-folder',
    3,
    'a folder a .gitignore names with a trailing slash is not read or sent to a labeler',
    (skill) => {
      const kept = skillFile(skill, 'references/guide.md');
      const left = skillFile(skill, 'scratch/draft.md');
      return {
        files: [
          ['.gitignore', 'scratch/\n'],
          [kept, '# Guide\n\nThe guide is shared.\n'],
          [left, PROSE],
        ],
        left: [left],
        kept: [kept],
      };
    },
  ),
  ignoreCase(
    'gitignore-negation',
    3,
    'a file a .gitignore line brings back after a glob is still read',
    (skill) => {
      const kept = skillFile(skill, 'references/keep-local.md');
      const left = skillFile(skill, 'references/drop-local.md');
      return {
        files: [
          ['.gitignore', '*-local.md\n!keep-local.md\n'],
          [kept, '# Keep\n\nThe kept notes are shared.\n'],
          [left, PROSE],
        ],
        left: [left],
        kept: [kept],
      };
    },
  ),
  ignoreCase(
    'gitignore-nested',
    3,
    'a .gitignore inside a skill folder applies to that folder only',
    (skill) => {
      const other = namesFor(1, `${skill}-other`).skill;
      const left = skillFile(skill, 'references/session.md');
      const kept = skillFile(other, 'references/session.md');
      return {
        files: [
          [skillFile(skill, '.gitignore'), 'references/session.md\n'],
          [left, PROSE],
          [kept, '# Session\n\nThis skill keeps its session notes.\n'],
        ],
        left: [left],
        kept: [kept],
      };
    },
  ),
  ignoreCase(
    'gitignore-local-settings',
    2,
    'the local settings file the runtime loads is read although the .gitignore names it',
    () => ({
      files: [
        ['.gitignore', '.claude/settings.local.json\nCLAUDE.local.md\n'],
        ['.claude/settings.local.json', '{ "permissions": { "deny": ["WebFetch"] } }\n'],
        ['CLAUDE.local.md', '# Local\n\nAlways keep the totals in whole cents.\n'],
      ],
      left: [],
      kept: ['.claude/settings.local.json', 'CLAUDE.local.md'],
    }),
  ),
  ignoreCase(
    'nested-claude-in-skill',
    2,
    'a .claude folder inside a skill folder (an agent memory) is not read or sent to a labeler',
    (skill) => {
      const left = skillFile(skill, '.claude/agent-memory-local/notes.md');
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'nested-claude-in-skills-folder',
    2,
    'a .claude folder directly inside the skills folder is not read or sent to a labeler',
    () => {
      const left = '.claude/skills/.claude/agent-memory-local/notes.md';
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'nested-claude-in-hooks',
    3,
    'a .claude folder inside a hook folder is not read or sent to a labeler',
    () => {
      const left = '.claude/hooks/lib/.claude/agent-memory-local/notes.md';
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'test-cache-in-skill',
    2,
    'a .pytest_cache folder inside a skill folder is not read or sent to a labeler',
    (skill) => {
      const left = skillFile(skill, '.pytest_cache/README.md');
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'test-cache-in-hooks',
    2,
    'a .pytest_cache folder in the hooks folder is not read, so no orphan names it',
    () => {
      const left = '.claude/hooks/.pytest_cache/README.md';
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  {
    key: 'ignore-cache-orphan',
    tier: 2,
    title: 'a test cache beside a hook is no orphan of the lint',
    component: READER,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      plantSkill(e, o, names.skill, 'Checks things.', []);
      const caches = [
        '.claude/hooks/.pytest_cache/v/cache/lastfailed',
        '.claude/hooks/.mypy_cache/meta.json',
      ];
      for (const path of caches) e.raw(path, '{}\n', BASE);
      e.check(o, (scan) => {
        const orphan = scan.lint.findings.find(
          (finding) => finding.code === 'ORPHAN' && caches.includes(finding.subject ?? ''),
        );
        return orphan ? `the lint names ${orphan.subject} as an orphan` : undefined;
      });
    },
  },
];

export function ignoreCases(): Case[] {
  return CASES;
}
