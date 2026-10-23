import { ANCHOR, GUARDS_DIR, helperFile, ROOT, STANDING, skillFile } from '../layout';
import { namesFor, plantSkill, rule, writeSettings } from './common';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { PlantedEstate, type ScanOutcome } from './planted';

/**
 * The coverage family: what the estate model says it read. Each item is an estate of its own.
 *
 * Unknown files: a file under the runtime's own folder that no part type covers is listed in the map's coverage,
 * exactly, and the lint is never summarised as clean while one is listed. A file a type covers (built in, or
 * declared in the estate configuration), a file a reference of the estate reaches, and a file beside the
 * runtime's folder are never listed. The configuration file and a file over the size limit are listed as
 * skipped, with the code of why.
 *
 * Not run: a lint check that had no input to read is `not-run` with the code `no-input`, never a pass, and a
 * check with an input ran (the reference checks read the prose parts). An estate with no file at all runs no
 * check, and a lint is clean only when every check ran: a lint with a check that did not run is never clean.
 *
 * Kept out: a file an ignore glob keeps out alone is skipped by its path, a folder it keeps out is one entry with
 * its file count, and a path behind the home folder is never read (`home-not-mapped`).
 *
 * The oracle reads the map's `coverage` and the lint's `outcomes` and `summary`, which are structured fields and
 * codes, never a printed line. A build without one of them fails the item with the field named.
 */

const COMPONENT = 'packages/estate/src/scan/claude-code.ts';
const LINT = 'packages/estate/src/lint/lint.ts';
/** The one change that would make each group of items pass (an item of a group fails for that group's cause). */
const CAUSE = {
  unknown: 'list the files under the runtime folder no part type covers in the map coverage',
  covered: 'count a file a part type covers or a reference reaches as covered, never unknown',
  summary: 'never summarise a lint as clean while a file is unknown or a check did not run',
  notRun: 'give a lint check that read no input the outcome not-run, and run a check that has an input',
} as const;

type Expected = {
  /** The files the map must list as unknown, exactly. */
  unknown: string[];
  /** Entries the map must list as skipped. */
  skipped?: Array<{ what: string; reason: string; files?: number }>;
  /** The lint summary code, when the item fixes it. A lint with an unknown file is never `clean`, whatever. */
  summary?: string;
  /** The checks that must not have run for want of an input, exactly. */
  notRun?: string[];
  /** Checks that must have run. */
  ran?: string[];
};

type Build = {
  estate: PlantedEstate;
  seed: number;
  owner: string;
  bare: boolean;
  guarded: string[];
  /** A rule in the standing file, so the rule check has an input and runs. */
  ruled: boolean;
  /** More lines of the standing file. */
  standing: string[];
};
type Case = {
  key: string;
  tier: Tier;
  title: string;
  cause: keyof typeof CAUSE;
  plant(build: Build): Expected;
};

/** A name for a planted file, from the seed: the oracle never depends on a fixed word. */
function name(build: Build, suffix: string): string {
  return namesFor(build.seed, `${build.owner}-${suffix}`).skill;
}

/**
 * A guard whose script names the given paths in its source, wired in the settings with a row of the check
 * registry: the paths are named by code, so none is an orphan, and the guard itself gives no finding.
 */
function guardNaming(build: Build, paths: readonly string[]): string {
  const script = `${GUARDS_DIR}/${name(build, 'guard')}.py`;
  const lines = [
    'import os',
    ...paths.map((path, index) => `PATH_${index} = "${path}"`),
    'print(os.getcwd())',
  ];
  build.estate.raw(script, `${lines.join('\n')}\n`, build.owner);
  build.guarded.push(script);
  return script;
}

/** Each case plants its files and says what the map's coverage and the lint must hold. */
const CASES: Case[] = [
  {
    key: 'unknown-data-file',
    tier: 1,
    title: 'a data file under the runtime folder that code names and no type covers is listed as unknown',
    cause: 'unknown',
    plant: (b) => {
      const file = `${ROOT}/data/${name(b, 'data')}.csv`;
      b.estate.raw(file, 'code,rate\nA,1\n', b.owner);
      guardNaming(b, [file]);
      return { unknown: [file], summary: 'unknown-files' };
    },
  },
  {
    key: 'unknown-flag-file',
    tier: 2,
    title: 'a flag file with no extension, named by a guard, is listed as unknown',
    cause: 'unknown',
    plant: (b) => {
      const file = `${GUARDS_DIR}/.${name(b, 'flag')}-observe`;
      b.estate.raw(file, 'on\n', b.owner);
      guardNaming(b, [file]);
      return { unknown: [file], summary: 'unknown-files' };
    },
  },
  {
    key: 'unknown-deep-file',
    tier: 2,
    title: 'a request file three folders deep, named by a guard, is listed as unknown',
    cause: 'unknown',
    plant: (b) => {
      const file = `${GUARDS_DIR}/lib/judges/${name(b, 'judge')}.request.json`;
      b.estate.raw(file, '{ "id": "tone", "system": "Judge the tone." }\n', b.owner);
      guardNaming(b, [file]);
      return { unknown: [file], summary: 'unknown-files' };
    },
  },
  {
    key: 'unknown-empty-file',
    tier: 3,
    title: 'an empty file a guard names is listed as unknown: being empty covers nothing',
    cause: 'unknown',
    plant: (b) => {
      const file = `${ROOT}/state/${name(b, 'state')}.txt`;
      b.estate.raw(file, '', b.owner);
      guardNaming(b, [file]);
      return { unknown: [file] };
    },
  },
  {
    key: 'unknown-orphan',
    tier: 1,
    title: 'a file nothing names and no type covers is listed as unknown beside its orphan finding',
    cause: 'unknown',
    plant: (b) => {
      const file = `${ROOT}/notes/${name(b, 'note')}.txt`;
      b.estate.raw(file, 'An old plan.\n', b.owner);
      return { unknown: [file], summary: 'findings' };
    },
  },
  {
    key: 'unknown-two-sorted',
    tier: 2,
    title: 'two unknown files in two folders are both listed, sorted',
    cause: 'unknown',
    plant: (b) => {
      const files = [`${ROOT}/zeta/${name(b, 'z')}.dat`, `${ROOT}/alpha/${name(b, 'a')}.dat`];
      for (const file of files) b.estate.raw(file, 'x\n', b.owner);
      guardNaming(b, files);
      return { unknown: [...files].sort(), summary: 'unknown-files' };
    },
  },
  {
    key: 'unknown-through-link',
    tier: 4,
    title: 'an unknown file in a folder the runtime folder links to is listed under the link',
    cause: 'unknown',
    plant: (b) => {
      const folder = `${ROOT}/shared`;
      b.estate.link(folder, `library/${name(b, 'library')}`, b.owner);
      const file = `${folder}/${name(b, 'table')}.tsv`;
      b.estate.raw(file, 'a\tb\n', b.owner);
      guardNaming(b, [file]);
      return { unknown: [file] };
    },
  },
  {
    key: 'unknown-beside-skill',
    tier: 3,
    title: 'a loose file in the skills folder, outside any skill folder, is listed as unknown',
    cause: 'unknown',
    plant: (b) => {
      const file = `${ROOT}/skills/${name(b, 'loose')}.txt`;
      b.estate.raw(file, 'Loose notes.\n', b.owner);
      guardNaming(b, [file]);
      return { unknown: [file] };
    },
  },
  {
    key: 'skipped-large',
    tier: 3,
    title: 'a file over the size limit is skipped as too large, never unknown',
    cause: 'unknown',
    plant: (b) => {
      const file = `${ROOT}/data/${name(b, 'dump')}.bin`;
      b.estate.raw(file, `${'x'.repeat(1024 * 1024 + 16)}\n`, b.owner);
      return { unknown: [], skipped: [{ what: file, reason: 'too-large' }] };
    },
  },
  {
    key: 'skipped-config',
    tier: 2,
    title: 'the estate configuration under the runtime folder is skipped, never unknown',
    cause: 'unknown',
    plant: (b) => {
      const file = `${ROOT}/driftbench.estate.yaml`;
      b.estate.raw(file, 'ignore: []\n', b.owner);
      return { unknown: [], skipped: [{ what: file, reason: 'estate-config' }] };
    },
  },
  {
    key: 'skipped-ignored-file',
    tier: 2,
    title: 'a file an ignore glob keeps out alone is skipped by its path, never unknown',
    cause: 'unknown',
    plant: (b) => {
      // `*.log` is a default ignore glob that matches the file, not a folder above it.
      const file = `${ROOT}/notes/${name(b, 'run')}.log`;
      b.estate.raw(file, 'a log line\n', b.owner);
      return { unknown: [], skipped: [{ what: file, reason: 'ignored' }] };
    },
  },
  {
    key: 'skipped-ignored-folder',
    tier: 3,
    title:
      'a folder an ignore glob keeps out is skipped once, with the number of its files, never file by file',
    cause: 'unknown',
    plant: (b) => {
      const folder = `${ROOT}/hooks/lib/node_modules`;
      for (const file of ['a/index.js', 'b/index.js', `b/${name(b, 'util')}.js`])
        b.estate.raw(`${folder}/${file}`, 'module.exports = 1;\n', b.owner);
      return { unknown: [], skipped: [{ what: folder, reason: 'ignored', files: 3 }] };
    },
  },
  {
    key: 'skipped-home-path',
    tier: 3,
    title: 'a path the standing file names behind the home folder is never read: skipped, home-not-mapped',
    cause: 'unknown',
    plant: (b) => {
      const path = `~/notes/${name(b, 'notes')}.md`;
      b.standing.push('', `Read \`${path}\` before a reply.`);
      return { unknown: [], skipped: [{ what: path, reason: 'home-not-mapped' }] };
    },
  },
  {
    key: 'not-clean-without-rule',
    tier: 2,
    title:
      'a lint whose rule check had no input is not clean, though every file is covered and nothing was found',
    cause: 'summary',
    plant: (b) => {
      guardNaming(b, []);
      return { unknown: [], summary: 'checks-not-run', notRun: ['UNENFORCED'] };
    },
  },
  {
    key: 'covered-memory',
    tier: 1,
    title: 'a memory file is covered by its built-in type',
    cause: 'covered',
    plant: (b) => {
      b.estate.raw(
        `${ROOT}/memory/${name(b, 'memory')}.md`,
        '# Notes\n\nThe release is on Friday.\n',
        b.owner,
      );
      return { unknown: [] };
    },
  },
  {
    key: 'covered-command',
    tier: 2,
    title: 'a command file is covered by its built-in type',
    cause: 'covered',
    plant: (b) => {
      b.estate.raw(
        `${ROOT}/commands/${name(b, 'command')}.md`,
        '---\ndescription: Ships.\n---\n\nShip.\n',
        b.owner,
      );
      return { unknown: [] };
    },
  },
  {
    key: 'covered-skill-folder',
    tier: 2,
    title: "every file of a skill folder (references, scripts, examples) is covered by the skill's types",
    cause: 'covered',
    plant: (b) => {
      const skill = name(b, 'skill');
      plantSkill(b.estate, b.owner, skill, 'Checks a record for the team.', []);
      for (const file of ['references/guide.md', 'scripts/run.sh', 'examples/one.md', 'assets/logo.svg'])
        b.estate.raw(skillFile(skill, file), 'x\n', b.owner);
      return { unknown: [] };
    },
  },
  {
    key: 'covered-helper',
    tier: 1,
    title: 'a helper agent file is covered by its built-in type',
    cause: 'covered',
    plant: (b) => {
      b.estate
        .file(helperFile(name(b, 'helper')), b.owner)
        .lines_([
          '---',
          `name: ${name(b, 'helper')}`,
          'description: Reads.',
          'tools: Read',
          '---',
          '',
          'You read.',
        ]);
      return { unknown: [] };
    },
  },
  {
    key: 'covered-script',
    tier: 1,
    title: 'a script under the runtime folder is covered by the script type, run or not',
    cause: 'covered',
    plant: (b) => {
      b.estate.raw(`${ROOT}/tools/${name(b, 'tool')}.sh`, '#!/bin/sh\nexit 0\n', b.owner);
      return { unknown: [] };
    },
  },
  {
    key: 'covered-by-reference',
    tier: 3,
    title:
      'a document under the runtime folder that the standing file names is covered though no type locates it; its unnamed twin is unknown',
    cause: 'covered',
    plant: (b) => {
      const named = `${ROOT}/docs/${name(b, 'named')}.md`;
      const unnamed = `${ROOT}/docs/${name(b, 'unnamed')}.md`;
      for (const file of [named, unnamed])
        b.estate.raw(file, '# Policy\n\nNever delete a record.\n', b.owner);
      b.standing.push('', `Before a change, read \`${named}\`.`);
      return { unknown: [unnamed] };
    },
  },
  {
    key: 'covered-by-import',
    tier: 3,
    title:
      'a document under the runtime folder that the standing file imports with @ is covered though no type locates it; its unimported twin is unknown',
    cause: 'covered',
    plant: (b) => {
      const imported = `${ROOT}/docs/${name(b, 'imported')}.md`;
      const unnamed = `${ROOT}/docs/${name(b, 'unimported')}.md`;
      for (const file of [imported, unnamed]) b.estate.raw(file, '# Rules\n\nKeep replies short.\n', b.owner);
      b.standing.push('', `@${imported}`);
      return { unknown: [unnamed] };
    },
  },
  {
    key: 'covered-beside-root',
    tier: 2,
    title: 'files beside the runtime folder that no type locates are no file of the agent: never unknown',
    cause: 'covered',
    plant: (b) => {
      b.estate.raw('README.md', '# For people\n', b.owner);
      b.estate.raw(`src/${name(b, 'source')}.ts`, 'export const value = 1;\n', b.owner);
      b.estate.raw('AGENTS.md', '# For another runtime\n\nRun the tests.\n', b.owner);
      return { unknown: [] };
    },
  },
  {
    key: 'covered-declared-type',
    tier: 3,
    title: 'a type the estate configuration declares covers its files: none is unknown and the lint is clean',
    cause: 'covered',
    plant: (b) => {
      const file = `${GUARDS_DIR}/lib/judges/${name(b, 'judge')}.request.json`;
      b.estate.raw(file, '{ "id": "tone", "system": "Judge the tone." }\n', b.owner);
      guardNaming(b, [file]);
      b.estate.raw(
        `${ROOT}/driftbench.estate.yaml`,
        [
          'types:',
          '  judge-request:',
          '    locate: guards/lib/judges/*.request.json',
          '    fields: { id: $.id, prompt: $.system }',
          '    aspects: [guards, informs]',
          '    loaded: on-event',
          '',
        ].join('\n'),
        b.owner,
      );
      b.ruled = true;
      return { unknown: [], summary: 'clean' };
    },
  },
  {
    key: 'covered-declared-scope',
    tier: 4,
    title: 'a declared type that extends a built-in one and is scoped to it by name covers its flag files',
    cause: 'covered',
    plant: (b) => {
      const flag = `${ROOT}/hooks/.${name(b, 'flag')}-observe`;
      b.estate.raw(flag, 'on\n', b.owner);
      guardNaming(b, [flag]);
      b.estate.raw(
        `${ROOT}/driftbench.estate.yaml`,
        [
          'types:',
          '  observe-flag:',
          '    extends: script',
          '    locate: hooks/.*-observe',
          '    aspects: [configures]',
          '    scope: { type: hook, by: name }',
          '    loaded: always',
          '',
        ].join('\n'),
        b.owner,
      );
      b.ruled = true;
      return { unknown: [], summary: 'clean' };
    },
  },
  {
    key: 'refused-types-count',
    tier: 4,
    title: 'a types document with a fault is refused whole, so the files it would cover stay unknown',
    cause: 'covered',
    plant: (b) => {
      const file = `${GUARDS_DIR}/lib/judges/${name(b, 'judge')}.request.json`;
      b.estate.raw(file, '{ "id": "tone" }\n', b.owner);
      guardNaming(b, [file]);
      b.estate.raw(
        `${ROOT}/driftbench.estate.yaml`,
        [
          'types:',
          '  judge-request:',
          '    locate: guards/lib/judges/*.request.json',
          '    aspects: [guards, nonsense]',
          '    loaded: on-event',
          '',
        ].join('\n'),
        b.owner,
      );
      return { unknown: [file], summary: 'unknown-files' };
    },
  },
  {
    key: 'clean-when-covered',
    tier: 1,
    title: 'a lint with no finding and every file covered is clean',
    cause: 'summary',
    plant: (b) => {
      guardNaming(b, []);
      b.ruled = true;
      return { unknown: [], summary: 'clean' };
    },
  },
  {
    key: 'none-ran-empty',
    tier: 1,
    title: 'an estate with no file runs no check: every lint check is not-run and the summary says none ran',
    cause: 'notRun',
    plant: (b) => {
      b.bare = true;
      return {
        unknown: [],
        summary: 'none-ran',
        notRun: [
          'ORPHAN',
          'UNREACHABLE',
          'UNENFORCED',
          'OVERSIZE',
          'UNANCHORED_GUARD',
          'MISSING_REFERENCE',
          'UNRESOLVED_REFERENCE',
          'AMBIGUOUS_REFERENCE',
          'EXTERNAL',
          'MISSING_SCRIPT',
          'REGISTRY_ROW',
          'REGISTRY_GUARD',
          'QUOTE_DRIFT',
        ],
      };
    },
  },
  {
    key: 'not-run-no-guard',
    tier: 2,
    title: 'with no guard and no registry, the guard and registry checks are not-run, the file checks ran',
    cause: 'notRun',
    plant: () => ({
      unknown: [],
      // The reference checks read the prose parts: the standing file is one, so they ran.
      ran: [
        'ORPHAN',
        'UNREACHABLE',
        'OVERSIZE',
        'MISSING_REFERENCE',
        'UNRESOLVED_REFERENCE',
        'AMBIGUOUS_REFERENCE',
        'EXTERNAL',
      ],
      notRun: ['UNENFORCED', 'UNANCHORED_GUARD', 'MISSING_SCRIPT', 'REGISTRY_ROW', 'REGISTRY_GUARD'],
      summary: 'checks-not-run',
    }),
  },
  {
    key: 'ran-with-guard',
    tier: 2,
    title: 'with an anchored guard and its registry row, the guard and registry checks ran',
    cause: 'notRun',
    plant: (b) => {
      guardNaming(b, []);
      return { unknown: [], ran: ['UNANCHORED_GUARD', 'MISSING_SCRIPT', 'REGISTRY_ROW', 'REGISTRY_GUARD'] };
    },
  },
  {
    key: 'not-run-guard-without-registry',
    tier: 3,
    title: 'a guard with no registry runs the guard checks, and the registry row check is not-run',
    cause: 'notRun',
    plant: (b) => {
      const script = `${GUARDS_DIR}/${name(b, 'lone')}.sh`;
      b.estate.raw(script, '#!/bin/sh\nexit 0\n', b.owner);
      b.guarded.push(`!${script}`);
      return { unknown: [], ran: ['UNANCHORED_GUARD', 'MISSING_SCRIPT'] };
    },
  },
];

async function judgeCase(seed: number, family: string, item: Case): Promise<ItemResult> {
  const estate = new PlantedEstate();
  const build: Build = {
    estate,
    seed,
    owner: `${family}.${item.key}`,
    bare: false,
    guarded: [],
    ruled: false,
    standing: [],
  };
  const expected = item.plant(build);
  if (!build.bare) {
    const standing = estate.file(STANDING, 'base');
    standing.lines_(['# Planted estate', '', 'Everything here is invented for testing.', ...build.standing]);
    if (build.ruled) {
      const line = rule(`${build.owner}:rule`, 'Never delete a record of the ledger.');
      standing.line('');
      standing.line(line.text, line.atoms ?? [], line.prose);
    }
    // A guard named with `!` runs from the anchor with no registry row; the others get a row each.
    const guards = build.guarded.map((entry, index) => {
      const script = entry.replace(/^!/, '');
      return {
        owner: build.owner,
        event: 'PreToolUse',
        matcher: 'Bash',
        command: `${script.endsWith('.py') ? 'python3 ' : ''}${ANCHOR}/${script}`,
        atoms: [],
        row: entry.startsWith('!')
          ? undefined
          : `| G${index + 1} | ${script.split('/').pop()} | PreToolUse |`,
      };
    });
    writeSettings(estate, guards);
    const rows = guards.flatMap((guard) => (guard.row ? [guard.row] : []));
    if (rows.length > 0)
      estate
        .file(`${GUARDS_DIR}/CHECK-REGISTRY.md`, build.owner)
        .lines_(['# Check registry', '', '| Id | Guard | Event |', '|---|---|---|', ...rows]);
  }
  return compare(await estate.scan(), expected);
}

/** The fields the oracle reads, each optional: a build without one fails the item, naming the field. */
type Read = {
  coverage?: { unknown?: unknown; skipped?: unknown };
};
type LintRead = {
  summary?: unknown;
  outcomes?: Array<{ check?: unknown; status?: unknown; notRun?: unknown }>;
};

function compare(scan: ScanOutcome, expected: Expected): ItemResult {
  const problems: string[] = [];
  const coverage = (scan.map as unknown as Read).coverage;
  const lint = scan.lint as unknown as LintRead;
  const unknown = Array.isArray(coverage?.unknown) ? (coverage.unknown as string[]) : undefined;
  if (unknown === undefined) problems.push('the map has no coverage.unknown');
  else if (JSON.stringify(unknown) !== JSON.stringify(expected.unknown))
    problems.push(`coverage.unknown is ${JSON.stringify(unknown)}, not ${JSON.stringify(expected.unknown)}`);
  const skipped = Array.isArray(coverage?.skipped)
    ? (coverage.skipped as Array<{ what?: unknown; reason?: unknown; files?: unknown }>)
    : undefined;
  for (const want of expected.skipped ?? []) {
    if (
      !skipped?.some(
        (entry) =>
          entry.what === want.what &&
          entry.reason === want.reason &&
          (want.files === undefined ? entry.files === undefined : entry.files === want.files),
      )
    )
      problems.push(`coverage.skipped holds no ${want.reason} entry for ${want.what}`);
  }
  if (typeof lint.summary !== 'string') problems.push('the lint has no summary code');
  else {
    if ((unknown?.length ?? 0) > 0 && lint.summary === 'clean')
      problems.push('the lint is summarised clean while a file is unknown');
    if (
      lint.summary === 'clean' &&
      Array.isArray(lint.outcomes) &&
      lint.outcomes.some((outcome) => outcome.status === 'not-run')
    )
      problems.push('the lint is summarised clean while a check did not run');
    if (expected.summary !== undefined && lint.summary !== expected.summary)
      problems.push(`the lint summary is ${lint.summary}, not ${expected.summary}`);
  }
  if (expected.notRun || expected.ran) {
    if (!Array.isArray(lint.outcomes)) problems.push('the lint has no outcomes');
    else {
      const notRun = lint.outcomes
        .filter((outcome) => outcome.status === 'not-run' && outcome.notRun === 'no-input')
        .map((outcome) => String(outcome.check));
      if (expected.notRun && JSON.stringify(notRun) !== JSON.stringify(expected.notRun))
        problems.push(
          `the checks not run for want of input are ${JSON.stringify(notRun)}, not ${JSON.stringify(expected.notRun)}`,
        );
      for (const check of expected.ran ?? []) {
        const outcome = lint.outcomes.find((candidate) => candidate.check === check);
        if (!outcome || outcome.status === 'not-run') problems.push(`the check ${check} did not run`);
      }
    }
  }
  return {
    pass: problems.length === 0,
    detail: problems.length === 0 ? 'holds' : problems.slice(0, 3).join('; '),
  };
}

export function lintCoverageFamily(): Family {
  const family = 'lint.coverage';
  const items = itemsOf(
    family,
    2,
    COMPONENT,
    CASES.map(({ key, tier, title, cause }) => ({
      key,
      tier,
      title,
      cause: CAUSE[cause],
      ...(cause === 'summary' || cause === 'notRun' ? { component: LINT } : {}),
    })),
  );
  return {
    id: family,
    level: 2,
    component: COMPONENT,
    items,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const item of CASES) {
        try {
          out.set(`${family}.${item.key}`, await judgeCase(seed, family, item));
        } catch (cause) {
          out.set(`${family}.${item.key}`, {
            pass: false,
            detail: `the scan threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          });
        }
      }
      return out;
    },
  };
}
