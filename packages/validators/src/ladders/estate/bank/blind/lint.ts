import { ANCHOR_BARE, ROOT, STANDING, skillFile } from '../../layout';
import { anchored, writeSettings } from '../common';
import type { Family } from '../frame';
import { type Case, caseFamily } from '../hostile';
import { BASE, type Check, type PlantedEstate } from '../planted';
import {
  freeHelper,
  freeSkill,
  LINT,
  lintCount,
  lintHas,
  lintLacks,
  lintNone,
  standingFree,
  tag,
  theme,
} from './util';

/**
 * blind.lint: the findings of `estate lint` that the docs name, each on an estate of its own, in the places
 * a finding is easy to miss: a file named by the wrong sibling, a guard in a second settings file, a
 * ceiling counted in bytes, a registry with another name, the first of many. The oracle: the finding the
 * planting holds, or the absence of the finding the planting avoids.
 */

const SAME_ORPHAN = 'decide that a file is named from its full path, not from its base name';
const SAME_NAMES = 'count a file as named when any body, link or table of the estate names its path';
const SAME_REACH =
  'walk the route, dispatch and reference edges from every standing, memory and settings atom';
const SAME_CEILING = 'count the standing instructions in characters, not in bytes or code units';
const SAME_ANCHOR = 'judge every guard command of every settings file and skill frontmatter by its anchor';
const SAME_MISSING = 'check that the script of every guard command exists, in every settings file';
const SAME_REGISTRY = 'read a registry from any markdown file whose name holds registry, in any folder';

const LOCAL = `${ROOT}/settings.local.json`;

function skillOf(seed: number, owner: string, word: string): string {
  return `${theme(seed, owner).place}-${word}-${tag(owner)}`;
}

/** Makes a skill routed from the standing table, so its files are reachable. */
function routed(e: PlantedEstate, name: string): void {
  const writer = standingFree(e);
  if (!writer.lines.some((line) => line.startsWith('| When the user wants to'))) {
    writer.lines_(['', '## Routing', '', '| When the user wants to | Load |', '|---|---|']);
  }
  writer.line(`| do the ${name} work | \`${name}\` |`, [
    { hid: `route:${name}`, kind: 'route', key: name },
  ]);
}

/** Settings holding one guard per command on Stop, owned by nobody. */
function guards(e: PlantedEstate, commands: readonly string[]): void {
  writeSettings(
    e,
    commands.map((command) => ({ owner: BASE, event: 'Stop', command, atoms: [] })),
  );
}

function localGuards(e: PlantedEstate, commands: readonly string[]): void {
  const writer = e.file(LOCAL, BASE);
  writer.lines_(['{', '  "hooks": {', '    "Stop": [']);
  commands.forEach((command, index) => {
    writer.lines_([
      '      {',
      `        "hooks": [{ "type": "command", "command": ${JSON.stringify(command)} }]`,
      `      }${index === commands.length - 1 ? '' : ','}`,
    ]);
  });
  writer.lines_(['    ]', '  }', '}']);
}

function script(e: PlantedEstate, name: string): string {
  const path = `${ROOT}/guards/${name}`;
  e.raw(path, '#!/bin/sh\nexit 0\n', BASE);
  return path;
}

function registry(e: PlantedEstate, path: string, rows: ReadonlyArray<[string, string, string]>): void {
  e.raw(
    path,
    [
      '| Id | Guard | Enforces |',
      '|---|---|---|',
      ...rows.map(([id, guard, rule]) => `| ${id} | ${guard} | ${rule} |`),
      '',
    ].join('\n'),
    BASE,
  );
}

function pad(characters: number, line: string): string[] {
  const lines: string[] = [];
  let used = 0;
  while (used < characters) {
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}

function bigStanding(e: PlantedEstate, body: string[]): void {
  const writer = e.file(STANDING, BASE);
  writer.line('# Planted estate');
  for (const line of body) writer.line(line);
}

function both(...checks: Check[]): Check {
  return (scan) => {
    for (const check of checks) {
      const reason = check(scan);
      if (reason) return reason;
    }
    return undefined;
  };
}

const CASES: Case[] = [
  // ORPHAN
  {
    key: 'orphan-unnamed-reference',
    tier: 1,
    title: 'an orphan in a reference file nothing names',
    component: LINT,
    cause: SAME_ORPHAN,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'desk');
      routed(e, name);
      freeSkill(e, name, 'Keeps the desk.', ['Body.']);
      e.raw(skillFile(name, 'references/old-tray.md'), '# Old\n', BASE);
      e.check(o, lintHas('ORPHAN', 'old-tray.md'));
    },
  },
  {
    key: 'orphan-nested',
    tier: 2,
    title: 'an orphan in an unnamed reference file three folders down',
    component: LINT,
    cause: SAME_ORPHAN,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'desk');
      routed(e, name);
      freeSkill(e, name, 'Keeps the desk.', ['Body.']);
      e.raw(skillFile(name, 'references/a/b/c/deep-oven.md'), '# Old\n', BASE);
      e.check(o, lintHas('ORPHAN', 'deep-oven.md'));
    },
  },
  {
    key: 'orphan-in-second-skill',
    tier: 2,
    title: 'an orphan in the second of two skills',
    component: LINT,
    cause: SAME_ORPHAN,
    plant: (e, s, o) => {
      const [first, second] = [skillOf(s, o, 'one'), skillOf(s, o, 'two')];
      for (const name of [first, second]) {
        routed(e, name);
        freeSkill(e, name, 'Keeps a desk.', ['Body.']);
      }
      e.raw(skillFile(second, 'references/stale-crate.md'), '# Old\n', BASE);
      e.check(o, lintHas('ORPHAN', 'stale-crate.md'));
    },
  },
  {
    key: 'orphan-three-files',
    tier: 3,
    title: 'three orphans in three unnamed files',
    component: LINT,
    cause: SAME_ORPHAN,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'desk');
      routed(e, name);
      freeSkill(e, name, 'Keeps the desk.', ['Body.']);
      for (const word of ['a', 'b', 'c'])
        e.raw(skillFile(name, `references/lone-${word}-${tag(o)}.md`), '# Old\n', BASE);
      e.check(o, (scan) => {
        const found = scan.lint.findings.filter(
          (f) => f.code === 'ORPHAN' && f.subject.includes(`lone-`) && f.subject.includes(tag(o)),
        );
        return found.length === 3 ? undefined : `${found.length} ORPHAN findings for the three files`;
      });
    },
  },
  {
    key: 'orphan-same-base-name',
    tier: 4,
    title:
      'an orphan in the guide.md of the skill that does not name it, beside a named guide.md of the same name',
    component: LINT,
    cause: SAME_ORPHAN,
    plant: (e, s, o) => {
      const [first, second] = [skillOf(s, o, 'one'), skillOf(s, o, 'two')];
      routed(e, first);
      routed(e, second);
      freeSkill(e, first, 'Keeps a desk.', ['Open `references/guide.md` when in doubt.']);
      freeSkill(e, second, 'Keeps a desk.', ['Body.']);
      e.raw(skillFile(first, 'references/guide.md'), '# Guide\n', BASE);
      e.raw(skillFile(second, 'references/guide.md'), '# Guide\n', BASE);
      e.check(o, lintHas('ORPHAN', skillFile(second, 'references/guide.md')));
      e.check(o, lintLacks('ORPHAN', skillFile(first, 'references/guide.md')));
    },
  },
  {
    key: 'named-by-sentence-not-orphan',
    tier: 1,
    title: 'no orphan in a reference file a skill body names',
    component: LINT,
    cause: SAME_NAMES,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'desk');
      routed(e, name);
      freeSkill(e, name, 'Keeps the desk.', ['Open `references/guide.md` when the totals look wrong.']);
      e.raw(skillFile(name, 'references/guide.md'), '# Guide\n', BASE);
      e.check(o, lintLacks('ORPHAN', 'guide.md'));
    },
  },
  {
    key: 'named-by-link-not-orphan',
    tier: 2,
    title: 'no orphan in a reference file a skill body links',
    component: LINT,
    cause: SAME_NAMES,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'desk');
      routed(e, name);
      freeSkill(e, name, 'Keeps the desk.', ['See [the guide](references/linked-guide.md) first.']);
      e.raw(skillFile(name, 'references/linked-guide.md'), '# Guide\n', BASE);
      e.check(o, lintLacks('ORPHAN', 'linked-guide.md'));
    },
  },
  {
    key: 'named-by-standing-not-orphan',
    tier: 2,
    title: 'no orphan in a file the standing file names',
    component: LINT,
    cause: SAME_NAMES,
    plant: (e, _s, o) => {
      const path = `.claude/docs/${tag(o)}-rota.md`;
      e.raw(path, '# Rota\n', BASE);
      standingFree(e).line(`Open \`${path}\` when a rota clashes.`);
      e.check(o, lintLacks('ORPHAN', 'rota.md'));
    },
  },
  {
    key: 'named-by-memory-not-orphan',
    tier: 3,
    title: 'no orphan in a file only a memory file names',
    component: LINT,
    cause: SAME_NAMES,
    plant: (e, _s, o) => {
      const path = `.claude/docs/${tag(o)}-lanterns.md`;
      e.raw(path, '# Lanterns\n', BASE);
      standingFree(e);
      e.file(`${ROOT}/memory/${tag(o)}-notes.md`, BASE).lines_([
        '# Notes',
        '',
        `Open \`${path}\` when a lantern flickers.`,
      ]);
      e.check(o, lintLacks('ORPHAN', 'lanterns.md'));
    },
  },
  {
    key: 'named-by-helper-not-orphan',
    tier: 3,
    title: 'no orphan in a file only a helper body names',
    component: LINT,
    cause: SAME_NAMES,
    plant: (e, s, o) => {
      const path = `.claude/docs/${tag(o)}-moorings.md`;
      e.raw(path, '# Moorings\n', BASE);
      freeHelper(e, skillOf(s, o, 'scout'), [`Open \`${path}\` when a mooring slips.`]);
      e.check(o, lintLacks('ORPHAN', 'moorings.md'));
    },
  },
  // UNREACHABLE
  {
    key: 'unreachable-skill',
    tier: 1,
    title: 'an unreachable skill that only its own description leads to',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'lone');
      const made = freeSkill(e, name, 'Does lonely work.', ['Body.']);
      e.check(o, lintHas('UNREACHABLE', made.path));
    },
  },
  {
    key: 'routed-skill-reachable',
    tier: 1,
    title: 'no unreachable file for a skill a routing row names',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'plan');
      routed(e, name);
      const made = freeSkill(e, name, 'Plans the day.', ['Body.']);
      e.check(o, lintLacks('UNREACHABLE', made.path));
    },
  },
  {
    key: 'reference-of-routed-skill-reachable',
    tier: 2,
    title: 'no unreachable file for a reference of a reachable skill',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'plan');
      routed(e, name);
      freeSkill(e, name, 'Plans the day.', ['Open `references/menu.md` when a menu changes.']);
      e.raw(skillFile(name, 'references/menu.md'), '# Menu\n', BASE);
      e.check(o, lintLacks('UNREACHABLE', 'menu.md'));
    },
  },
  {
    key: 'helper-dispatched-by-routed-skill',
    tier: 2,
    title: 'no unreachable file for a helper a reachable skill dispatches',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'plan');
      const helper = skillOf(s, o, 'scout');
      routed(e, name);
      freeSkill(e, name, 'Plans the day.', [`Dispatch the \`${helper}\` agent to check the records.`]);
      const made = freeHelper(e, helper, ['You read.']);
      e.check(o, lintLacks('UNREACHABLE', made.path));
    },
  },
  {
    key: 'helper-two-hops',
    tier: 3,
    title: 'no unreachable file for a helper a helper dispatches',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'plan');
      const [first, second] = [skillOf(s, o, 'scout'), skillOf(s, o, 'clerk')];
      routed(e, name);
      freeSkill(e, name, 'Plans the day.', [`Dispatch the \`${first}\` agent to check the records.`]);
      freeHelper(e, first, [`Dispatch the \`${second}\` agent for the totals.`]);
      const made = freeHelper(e, second, ['You add.']);
      e.check(o, lintLacks('UNREACHABLE', made.path));
    },
  },
  {
    key: 'helper-of-unreachable-skill',
    tier: 3,
    title: 'an unreachable helper that only an unreachable skill dispatches',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'lone');
      const helper = skillOf(s, o, 'scout');
      freeSkill(e, name, 'Does lonely work.', [`Dispatch the \`${helper}\` agent to check the records.`]);
      const made = freeHelper(e, helper, ['You read.']);
      e.check(o, lintHas('UNREACHABLE', made.path));
    },
  },
  {
    key: 'local-standing-reaches',
    tier: 3,
    title: 'no unreachable file for a skill routed from CLAUDE.local.md',
    component: LINT,
    cause: SAME_REACH,
    plant: (e, s, o) => {
      standingFree(e);
      const name = skillOf(s, o, 'plan');
      const made = freeSkill(e, name, 'Plans the day.', ['Body.']);
      e.file('CLAUDE.local.md', BASE).lines_([
        '# Local',
        '',
        '| When the user wants to | Load |',
        '|---|---|',
        `| plan the day | \`${name}\` |`,
      ]);
      e.check(o, lintLacks('UNREACHABLE', made.path));
    },
  },
  // OVERSIZE
  {
    key: 'oversize-many-lines',
    tier: 1,
    title: 'an oversize standing file of 45,000 characters',
    component: LINT,
    cause: SAME_CEILING,
    plant: (e, _s, o) => {
      bigStanding(e, pad(45000, 'Keep every tray labelled.'));
      e.check(o, lintHas('OVERSIZE', STANDING));
    },
  },
  {
    key: 'oversize-one-long-line',
    tier: 2,
    title: 'an oversize standing file of one line of 80,000 characters',
    component: LINT,
    cause: SAME_CEILING,
    plant: (e, _s, o) => {
      bigStanding(e, [`${'Keep every tray labelled. '.repeat(3100)}`]);
      e.check(o, lintHas('OVERSIZE', STANDING));
    },
  },
  {
    key: 'under-ceiling',
    tier: 1,
    title: 'no oversize finding for a standing file of 30,000 characters',
    component: LINT,
    cause: SAME_CEILING,
    plant: (e, _s, o) => {
      bigStanding(e, pad(30000, 'Keep every tray labelled.'));
      e.check(o, lintNone('OVERSIZE'));
    },
  },
  {
    key: 'accents-count-as-characters',
    tier: 3,
    title: 'no oversize finding for a standing file of 25,000 accented characters',
    component: LINT,
    cause: SAME_CEILING,
    plant: (e, _s, o) => {
      bigStanding(e, pad(25000, 'é'.repeat(99)));
      e.check(o, lintNone('OVERSIZE'));
    },
  },
  {
    key: 'emoji-count-as-characters',
    tier: 4,
    title: 'no oversize finding for a standing file of 30,000 emoji',
    component: LINT,
    cause: SAME_CEILING,
    plant: (e, _s, o) => {
      bigStanding(
        e,
        Array.from({ length: 300 }, () => '🥖'.repeat(100)),
      );
      e.check(o, lintNone('OVERSIZE'));
    },
  },
  // UNANCHORED_GUARD
  {
    key: 'anchor-relative-python',
    tier: 1,
    title: 'an unanchored guard whose command runs a script from the working folder',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.py`;
      script(e, name);
      guards(e, [`python3 ${ROOT}/guards/${name}`]);
      e.check(o, lintHas('UNANCHORED_GUARD', name));
    },
  },
  {
    key: 'anchor-quoted-clean',
    tier: 1,
    title: 'no unanchored guard for a command anchored on the quoted project folder',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      guards(e, [anchored(script(e, name))]);
      e.check(o, lintNone('UNANCHORED_GUARD'));
    },
  },
  {
    key: 'anchor-bare-clean',
    tier: 2,
    title: 'no unanchored guard for a command anchored on the bare project folder variable',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      guards(e, [`${ANCHOR_BARE}/${script(e, name)}`]);
      e.check(o, lintNone('UNANCHORED_GUARD'));
    },
  },
  {
    key: 'anchor-dot-slash',
    tier: 2,
    title: 'an unanchored guard whose command starts with a dot and a slash',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      guards(e, [`./${script(e, name)}`]);
      e.check(o, lintHas('UNANCHORED_GUARD', name));
    },
  },
  {
    key: 'anchor-one-of-two',
    tier: 2,
    title: 'one unanchored guard among two guard commands',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const [good, bad] = [`${tag(o)}-good.sh`, `${tag(o)}-bad.sh`];
      guards(e, [anchored(script(e, good)), `bash ${script(e, bad)}`]);
      e.check(o, both(lintCount('UNANCHORED_GUARD', 1), lintHas('UNANCHORED_GUARD', bad)));
    },
  },
  {
    key: 'anchor-local-settings',
    tier: 3,
    title: 'an unanchored guard in settings.local.json',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      localGuards(e, [`bash ${script(e, name)}`]);
      e.check(o, lintHas('UNANCHORED_GUARD', name));
    },
  },
  {
    key: 'anchor-skill-frontmatter',
    tier: 3,
    title: 'an unanchored guard in a skill frontmatter',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, s, o) => {
      const name = `${tag(o)}.sh`;
      script(e, name);
      const skill = skillOf(s, o, 'hooked');
      routed(e, skill);
      freeSkill(e, skill, 'Guards the desk.', ['Body.'], {
        extraFront: [
          'hooks:',
          '  PreToolUse:',
          '    - matcher: Bash',
          '      hooks:',
          '        - type: command',
          `          command: bash ${ROOT}/guards/${name}`,
        ],
      });
      e.check(o, lintHas('UNANCHORED_GUARD', name));
    },
  },
  {
    key: 'anchor-env-prefix',
    tier: 4,
    title: 'no unanchored guard for an anchored command that starts with a variable assignment',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      guards(e, [`FERRY_MODE=1 ${anchored(script(e, name))}`]);
      e.check(o, lintNone('UNANCHORED_GUARD'));
    },
  },
  {
    key: 'anchor-prompt-hook',
    tier: 3,
    title: 'no unanchored guard and no missing script for a hook of type prompt',
    component: LINT,
    cause: SAME_ANCHOR,
    plant: (e, _s, o) => {
      e.raw(
        `${ROOT}/settings.json`,
        '{\n  "hooks": {\n    "Stop": [ { "hooks": [ { "type": "prompt", "prompt": "Check the reply." } ] } ]\n  }\n}\n',
        BASE,
      );
      e.check(o, both(lintNone('UNANCHORED_GUARD'), lintNone('MISSING_SCRIPT')));
    },
  },
  // MISSING_SCRIPT
  {
    key: 'missing-script',
    tier: 1,
    title: 'a missing script in a guard command',
    component: LINT,
    cause: SAME_MISSING,
    plant: (e, _s, o) => {
      const name = `${tag(o)}-gone.sh`;
      guards(e, [anchored(`${ROOT}/guards/${name}`)]);
      e.check(o, lintHas('MISSING_SCRIPT', name));
    },
  },
  {
    key: 'present-script',
    tier: 1,
    title: 'no missing script for a guard command whose script exists',
    component: LINT,
    cause: SAME_MISSING,
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      guards(e, [anchored(script(e, name))]);
      e.check(o, lintNone('MISSING_SCRIPT'));
    },
  },
  {
    key: 'missing-script-with-interpreter-and-flags',
    tier: 2,
    title: 'a missing script behind an interpreter and flags',
    component: LINT,
    cause: SAME_MISSING,
    plant: (e, _s, o) => {
      const name = `${tag(o)}-gone.py`;
      guards(e, [`python3 -u ${anchored(`${ROOT}/guards/${name}`)} --strict`]);
      e.check(o, lintHas('MISSING_SCRIPT', name));
    },
  },
  {
    key: 'missing-script-local-settings',
    tier: 3,
    title: 'a missing script in settings.local.json',
    component: LINT,
    cause: SAME_MISSING,
    plant: (e, _s, o) => {
      const name = `${tag(o)}-gone.sh`;
      localGuards(e, [anchored(`${ROOT}/guards/${name}`)]);
      e.check(o, lintHas('MISSING_SCRIPT', name));
    },
  },
  {
    key: 'missing-script-second-guard',
    tier: 2,
    title: 'a missing script in the second of two guard commands',
    component: LINT,
    cause: SAME_MISSING,
    plant: (e, _s, o) => {
      const [here, gone] = [`${tag(o)}-here.sh`, `${tag(o)}-gone.sh`];
      guards(e, [anchored(script(e, here)), anchored(`${ROOT}/guards/${gone}`)]);
      e.check(o, both(lintHas('MISSING_SCRIPT', gone), lintLacks('MISSING_SCRIPT', here)));
    },
  },
  // REGISTRY
  {
    key: 'registry-covers-guard',
    tier: 2,
    title: 'a registry guard finding for a row of a guard nobody runs',
    component: LINT,
    cause: SAME_REGISTRY,
    plant: (e, _s, o) => {
      const [run, ghost] = [`${tag(o)}-run.sh`, `${tag(o)}-ghost.sh`];
      guards(e, [anchored(script(e, run))]);
      registry(e, `${ROOT}/guards/CHECK-REGISTRY.md`, [
        ['G1', run, 'none'],
        ['G2', ghost, 'none'],
      ]);
      e.check(o, both(lintLacks('REGISTRY_ROW', run), lintHas('REGISTRY_GUARD', ghost)));
    },
  },
  {
    key: 'registry-lowercase-name',
    tier: 2,
    title: 'a registry guard finding in a registry file named in lower case',
    component: LINT,
    cause: SAME_REGISTRY,
    plant: (e, _s, o) => {
      const [run, ghost] = [`${tag(o)}-run.sh`, `${tag(o)}-ghost.sh`];
      guards(e, [anchored(script(e, run))]);
      registry(e, `${ROOT}/guards/guard-registry.md`, [
        ['G1', run, 'none'],
        ['G2', ghost, 'none'],
      ]);
      e.check(o, both(lintLacks('REGISTRY_ROW', run), lintHas('REGISTRY_GUARD', ghost)));
    },
  },
  {
    key: 'registry-other-folder',
    tier: 3,
    title: 'a registry guard finding in a registry file in a folder of its own',
    component: LINT,
    cause: SAME_REGISTRY,
    plant: (e, _s, o) => {
      const [run, ghost] = [`${tag(o)}-run.sh`, `${tag(o)}-ghost.sh`];
      guards(e, [anchored(script(e, run))]);
      registry(e, `${ROOT}/audit/hook-registry.md`, [
        ['G1', run, 'none'],
        ['G2', ghost, 'none'],
      ]);
      e.check(o, both(lintLacks('REGISTRY_ROW', run), lintHas('REGISTRY_GUARD', ghost)));
    },
  },
  {
    key: 'registry-row-by-path',
    tier: 3,
    title: 'a registry row finding beside a row that names its guard script by path',
    component: LINT,
    cause: 'match a registry row to a guard by the script name at the end of the path it holds',
    plant: (e, _s, o) => {
      const [run, other] = [`${tag(o)}-run.sh`, `${tag(o)}-other.sh`];
      guards(e, [anchored(script(e, run)), anchored(script(e, other))]);
      registry(e, `${ROOT}/guards/CHECK-REGISTRY.md`, [['G1', `${ROOT}/guards/${run}`, 'none']]);
      e.check(o, both(lintLacks('REGISTRY_ROW', run), lintHas('REGISTRY_ROW', other)));
    },
  },
  {
    key: 'registry-ten-guards-nine-rows',
    tier: 3,
    title: 'one registry row finding for ten guards and a registry of nine rows',
    component: LINT,
    cause: SAME_REGISTRY,
    plant: (e, _s, o) => {
      const names = Array.from({ length: 10 }, (_, i) => `${tag(o)}-g${i}.sh`);
      guards(
        e,
        names.map((name) => anchored(script(e, name))),
      );
      registry(
        e,
        `${ROOT}/guards/CHECK-REGISTRY.md`,
        names.slice(0, 9).map((name, i) => [`G${i}`, name, 'none']),
      );
      e.check(o, both(lintCount('REGISTRY_ROW', 1), lintHas('REGISTRY_ROW', names[9] as string)));
    },
  },
  {
    key: 'registry-row-missing',
    tier: 1,
    title: 'a registry row finding for a guard with no row',
    component: LINT,
    cause: SAME_REGISTRY,
    plant: (e, _s, o) => {
      const [run, other] = [`${tag(o)}-run.sh`, `${tag(o)}-other.sh`];
      guards(e, [anchored(script(e, run)), anchored(script(e, other))]);
      registry(e, `${ROOT}/guards/CHECK-REGISTRY.md`, [['G1', run, 'none']]);
      e.check(o, lintHas('REGISTRY_ROW', other));
    },
  },
  {
    key: 'no-registry-no-row-finding',
    tier: 3,
    title: 'no registry row finding for guards when no registry file exists',
    component: LINT,
    cause: 'report a missing registry row only when the estate keeps a registry',
    plant: (e, _s, o) => {
      const name = `${tag(o)}.sh`;
      guards(e, [anchored(script(e, name))]);
      e.check(o, lintNone('REGISTRY_ROW'));
    },
  },
  // MISSING_REFERENCE and the verdict
  {
    key: 'missing-reference-in-helper',
    tier: 2,
    title: 'a missing reference in a helper body',
    component: LINT,
    cause: 'check every file a skill or helper body names, in every folder',
    plant: (e, s, o) => {
      freeHelper(e, skillOf(s, o, 'scout'), [
        `Open \`.claude/docs/${tag(o)}-gone.md\` when a mooring slips.`,
      ]);
      e.check(o, lintHas('MISSING_REFERENCE', `${tag(o)}-gone.md`));
    },
  },
  {
    key: 'unenforced-alone-passes',
    tier: 2,
    title: 'a passing verdict for an estate whose only finding is an unenforced rule',
    component: LINT,
    cause: 'report unenforced rules as a count and leave the verdict to the failing codes',
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'plan');
      routed(e, name);
      const writer = e.file(skillFile(name, 'SKILL.md'), BASE);
      writer.lines_(['---', `name: ${name}`, 'description: Plans the day.', '---', '', '# Plan', '']);
      writer.line('Always label every tray.', [{ hid: `${o}:rule`, kind: 'instruction' }], {
        kind: 'instruction',
        title: 'Always label every tray',
        quote: 'Always label every tray.',
        evidence: [{ type: 'custom', name: 'planted_rule' }],
      });
      e.check(o, (scan) =>
        scan.lint.counts.UNENFORCED >= 1 ? undefined : 'the rule was not counted as unenforced',
      );
      e.check(o, (scan) => {
        const failing = scan.lint.findings.filter((f) => f.code !== 'UNENFORCED');
        return failing.length === 0 && scan.lint.failed === false
          ? undefined
          : `failed is ${scan.lint.failed} with ${failing.map((f) => f.code).join(', ')}`;
      });
    },
  },
  {
    key: 'missing-reference-fails',
    tier: 1,
    title: 'a failing verdict for an estate with one missing reference',
    component: LINT,
    cause: 'fail the lint on a missing reference',
    plant: (e, s, o) => {
      const name = skillOf(s, o, 'plan');
      routed(e, name);
      freeSkill(e, name, 'Plans the day.', ['Open `references/nowhere.md` when in doubt.']);
      e.check(o, (scan) => (scan.lint.failed === true ? undefined : 'the lint did not fail'));
    },
  },
];

export function lintFamily(): Family {
  return caseFamily('blind.lint', LINT, CASES, 'lint finds');
}
