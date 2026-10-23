import { skillFile } from '../layout';
import { namesFor, plantSkill } from './common';
import type { Tier } from './frame';
import { type Case, standardSkill } from './hostile';
import { BASE, type Check } from './planted';

/**
 * bench.defects, ignore items: parts kept out of the setup, or not the setup's. A part an ignore file names, a
 * copy of the runtime's own layout folder inside it, and a folder a tool tagged as a cache are not parts an agent
 * loads. The oracle: such a file is not among the files the scan read, no chunk of it is sent to the splitter (the
 * labeler), and no lint finding names it; a file that only looks like these is read, and a file the runtime loads
 * by itself is read whatever an ignore file says.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const CAUSE =
  'keep out of the setup the files an ignore file names, a copy of the layout folder inside it and a folder tagged as a cache';

const PROSE = '# Notes\n\nAlways keep the totals in whole cents.\n';
const TAG = 'Signature: 8a477f597d28d172789f06886806bc55\n# This directory is a cache.\n';

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

type Plan = { files: Array<[path: string, text: string]>; left: string[]; kept?: string[] };

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
  ignoreCase('file-name', 2, 'a part an ignore file names is not read or sent to a labeler', (skill) => {
    const kept = skillFile(skill, 'references/guide.md');
    const left = skillFile(skill, 'references/quarry-notes.md');
    return {
      files: [
        ['.gitignore', `${left}\n`],
        [kept, '# Guide\n\nThe guide is shared.\n'],
        [left, PROSE],
      ],
      left: [left],
      kept: [kept],
    };
  }),
  ignoreCase('file-glob', 2, 'a part an ignore glob names, at any depth, is not read', (skill) => {
    const kept = skillFile(skill, 'references/guide.md');
    const left = skillFile(skill, 'references/deep/windlass-local.md');
    return {
      files: [
        ['.gitignore', '# local files\n*-local.md\n'],
        [kept, '# Guide\n\nThe guide is shared.\n'],
        [left, PROSE],
      ],
      left: [left],
      kept: [kept],
    };
  }),
  ignoreCase('file-folder', 3, 'a folder an ignore file names with a trailing slash is not read', (skill) => {
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
  }),
  ignoreCase('file-negation', 3, 'a part a later ignore line brings back is still read', (skill) => {
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
  }),
  ignoreCase('file-nested', 3, 'an ignore file inside a unit folder applies to that unit only', (skill) => {
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
  }),
  ignoreCase(
    'file-loaded-by-itself',
    2,
    'a local instruction and a local setting the runtime loads are read although an ignore file names them',
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
    'layout-copy-in-unit',
    2,
    'a copy of the layout folder inside a skill folder is not read',
    (skill) => {
      const left = skillFile(skill, '.claude/ledger-notes/draft.md');
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'layout-copy-in-skills',
    2,
    'a copy of the layout folder directly inside the skills folder is not read',
    () => {
      const left = '.claude/skills/.claude/ledger-notes/draft.md';
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'layout-copy-deep',
    3,
    'a copy of the layout folder deep inside the layout folder is not read',
    () => {
      const left = '.claude/hooks/lib/.claude/ledger-notes/draft.md';
      return { files: [[left, PROSE]], left: [left] };
    },
  ),
  ignoreCase(
    'layout-lookalike',
    2,
    'a folder named almost like the layout folder is read (control)',
    (skill) => {
      const kept = skillFile(skill, '.claude-notes/draft.md');
      return { files: [[kept, PROSE]], left: [], kept: [kept] };
    },
  ),
  ignoreCase('cache-tag', 2, 'a folder tagged as a cache is not read', (skill) => {
    const left = skillFile(skill, '.windlass-cache/notes.md');
    return {
      files: [
        [left, PROSE],
        [skillFile(skill, '.windlass-cache/CACHEDIR.TAG'), TAG],
      ],
      left: [left],
    };
  }),
  ignoreCase('cache-tag-in-hooks', 3, 'a folder tagged as a cache among the hooks is not read', () => {
    const left = '.claude/hooks/quarrycache/notes.md';
    return {
      files: [
        [left, PROSE],
        ['.claude/hooks/quarrycache/CACHEDIR.TAG', TAG],
      ],
      left: [left],
    };
  }),
  ignoreCase('cache-no-tag', 2, 'a folder with no cache tag is read (control)', (skill) => {
    const kept = skillFile(skill, '.windlass-cache/notes.md');
    return { files: [[kept, PROSE]], left: [], kept: [kept] };
  }),
  ignoreCase('cache-wrong-tag', 3, 'a folder whose tag has another signature is read (control)', (skill) => {
    const kept = skillFile(skill, '.windlass-cache/notes.md');
    return {
      files: [
        [kept, PROSE],
        [skillFile(skill, '.windlass-cache/CACHEDIR.TAG'), 'Signature: 0000\n'],
      ],
      left: [],
      kept: [kept],
    };
  }),
  {
    key: 'ignore-file-is-no-orphan',
    tier: 2,
    title: 'an ignore file inside a unit folder is no orphan of the lint',
    component: READER,
    cause: CAUSE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      plantSkill(e, o, names.skill, 'Checks things.', []);
      const path = skillFile(names.skill, '.gitignore');
      e.raw(path, 'scratch/\n', BASE);
      e.check(o, (scan) => {
        const orphan = scan.lint.findings.find(
          (finding) => finding.code === 'ORPHAN' && finding.subject === path,
        );
        return orphan ? `the lint names ${path} as an orphan` : undefined;
      });
    },
  },
];

export function ignoreCases(): Case[] {
  return CASES;
}
