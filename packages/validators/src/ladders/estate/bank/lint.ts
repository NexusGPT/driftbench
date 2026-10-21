import { ANCHOR, GUARDS_DIR, helperFile, MEMORY, ROOT, STANDING, skillFile } from '../layout';
import { anchored, type BodyLine, type GuardLine, namesFor, plantSkill, writeSettings } from './common';
import { DISPATCH_BY_ARGUMENT, SUBCOMMAND_TOOL } from './dispatch-fixtures';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { type Planted, PlantedEstate, type ScanOutcome } from './planted';

/**
 * Two lint families, each item an estate of its own so one item's defect never shows in another's findings.
 *
 * lint.defect: one planted defect (or two) per estate, in the places estates hold them: orphans in skill and
 * layout folders, missing references from each kind of file, missing and unanchored guard scripts (behind a
 * prefix too), registry rows and guards that do not meet, an oversized standing file, units nothing reaches.
 * The oracle: exactly the findings the defects give, trust findings aside.
 *
 * lint.clean: estates with no defect, in shapes a reader that misses a form turns into a false finding: a
 * catalogue, a guard behind a prefix or a dispatcher, a reference by a link with an anchor, a nested
 * reference, a registry in another table shape, a linked guard script. The oracle: no finding at all.
 */

const LINT = 'packages/estate/src/lint/lint.ts';

const DISPATCHER = `${ROOT}/hooks/lib/run.py`;
const SUBCOMMAND_TOOL_PATH = `${ROOT}/hooks/lib/cli.py`;

/**
 * A dispatcher that runs the hook its first argument names, and beside it a tool whose first argument is a plain
 * subcommand of its own. The guard through the tool names the tool, never a file called `check`.
 */
function plantDispatchers(b: Build): void {
  b.estate.raw(DISPATCHER, DISPATCH_BY_ARGUMENT, b.owner);
  b.estate.raw(SUBCOMMAND_TOOL_PATH, SUBCOMMAND_TOOL, b.owner);
  b.guards.push({
    owner: b.owner,
    event: 'Stop',
    command: `python3 ${ANCHOR}/${SUBCOMMAND_TOOL_PATH} check`,
    atoms: [],
  });
}

/** The atoms of a body line that names a reference file: the planted-truth labeller answers the line with them. */
function ref(build: Build): Planted[] {
  build.counted += 1;
  return [{ hid: `${build.owner}:ref:${build.counted}`, kind: 'reference', key: '' }];
}

/** A line of the helper or the standing file that names a reference. */
function named(build: Build, text: string): string {
  build.refs.add(text);
  return text;
}

/** A line that hands work to a helper: the planted-truth labeller answers it as a dispatch of that helper. */
function dispatch(name: string): BodyLine {
  const text = `When stuck, dispatch the \`${name}\` agent.`;
  return {
    text,
    prose: {
      kind: 'instruction',
      title: `Dispatch ${name}`,
      quote: text,
      evidence: [{ type: 'tool_called', label: 'Agent', input: { subagent_type: name } }],
    },
  };
}

type Expected = { code: string; subject?: string; atom?: string };
type Build = {
  estate: PlantedEstate;
  seed: number;
  owner: string;
  rows: Array<{ ask: string; target: string; helper?: boolean }>;
  guards: GuardLine[];
  rules: BodyLine[];
  /** Raw lines added to the standing file after the rules. */
  standing: string[];
  /** The standing lines that name a reference, so the planted-truth labeller answers them as one. */
  refs: Set<string>;
  /** Counts the reference atoms an item plants, for their hidden ids. */
  counted: number;
};
type Case = { key: string; tier: Tier; title: string; plant(build: Build): Expected[] };

function skill(
  build: Build,
  suffix: string,
  body: BodyLine[] = [],
  route = true,
): { name: string; path: string } {
  const names = namesFor(build.seed, `${build.owner}-${suffix}`);
  const path = plantSkill(
    build.estate,
    build.owner,
    names.skill,
    `${capital(names.title)} for the team.`,
    body,
    {
      id: `${build.owner}:${suffix}`,
    },
  );
  if (route) build.rows.push({ ask: names.title, target: names.skill });
  return { name: names.skill, path };
}

function helper(build: Build, suffix: string, route = true, body: string[] = []): string {
  const name = namesFor(build.seed, `${build.owner}-${suffix}`).skill;
  const writer = build.estate.file(helperFile(name), build.owner);
  writer.lines_([
    '---',
    `name: ${name}`,
    `description: Checks one record at a time for the ${suffix} team.`,
    'tools: Read',
    '---',
    '',
    'You read and you report.',
  ]);
  for (const text of body) {
    const line = writer.line(text);
    if (build.refs.has(text)) build.estate.hint({ kind: 'reference', file: helperFile(name), line });
  }
  if (route) build.rows.push({ ask: `check records for ${suffix}`, target: name, helper: true });
  return name;
}

function guard(
  build: Build,
  suffix: string,
  options: { command?: (script: string) => string; exists?: boolean; extension?: string } = {},
): { name: string; script: string; command: string } {
  const name = `${namesFor(build.seed, `${build.owner}-${suffix}`).skill}.${options.extension ?? 'sh'}`;
  const script = `${GUARDS_DIR}/${name}`;
  const command = options.command ? options.command(script) : anchored(script);
  if (options.exists !== false) build.estate.raw(script, '#!/bin/sh\nexit 0\n', build.owner);
  build.guards.push({
    owner: build.owner,
    event: 'PreToolUse',
    matcher: 'Bash',
    command,
    atoms: [{ hid: `${build.owner}:guard:${suffix}`, kind: 'guard', key: name }],
  });
  return { name, script, command };
}

function registry(build: Build, rows: string[], file = 'CHECK-REGISTRY.md'): void {
  build.estate
    .file(`${GUARDS_DIR}/${file}`, build.owner)
    .lines_(['# Check registry', '', '| Id | Guard | Enforces |', '|---|---|---|', ...rows]);
}

const DEFECTS: Case[] = [
  {
    key: 'orphan-reference-folder',
    tier: 1,
    title: "an orphan in a skill's references folder",
    plant: (b) => {
      const { name } = skill(b, 'a');
      const path = skillFile(name, 'references/old.md');
      b.estate.raw(path, '# Old\n', b.owner);
      return [{ code: 'ORPHAN', subject: path }];
    },
  },
  {
    key: 'orphan-layout-folder',
    tier: 1,
    title: 'an orphan note in the layout folder',
    plant: (b) => {
      skill(b, 'a');
      b.estate.raw(`${ROOT}/notes/old.md`, '# Old\n', b.owner);
      return [{ code: 'ORPHAN', subject: `${ROOT}/notes/old.md` }];
    },
  },
  {
    key: 'orphan-data-file',
    tier: 1,
    title: 'an orphan data file',
    plant: (b) => {
      skill(b, 'a');
      b.estate.raw(`${ROOT}/data/codes.json`, '{ "codes": [] }\n', b.owner);
      return [{ code: 'ORPHAN', subject: `${ROOT}/data/codes.json` }];
    },
  },
  {
    key: 'missing-from-skill',
    tier: 1,
    title: 'a missing reference named by a skill',
    plant: (b) => {
      skill(b, 'a', [
        {
          text: 'When unsure, open `references/gone.md`.',
          atoms: [{ hid: `${b.owner}:ref`, kind: 'reference' as const, key: '' }],
        },
      ]);
      return [{ code: 'MISSING_REFERENCE', atom: `${b.owner}:ref` }];
    },
  },
  {
    key: 'missing-from-standing',
    tier: 1,
    title: 'a missing reference named by the standing file',
    plant: (b) => {
      skill(b, 'a');
      b.standing.push(named(b, 'Read the policy in `.claude/docs/policy.md` when in doubt.'));
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'missing-from-helper',
    tier: 2,
    title: 'a missing reference named by a helper',
    plant: (b) => {
      skill(b, 'a');
      helper(b, 'h', true, [named(b, 'When unsure, open `.claude/docs/gone.md`.')]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'missing-script',
    tier: 1,
    title: 'a guard whose script does not exist',
    plant: (b) => {
      skill(b, 'a');
      guard(b, 'g', { exists: false });
      return [{ code: 'MISSING_SCRIPT', atom: `${b.owner}:guard:g` }];
    },
  },
  {
    key: 'unanchored-shell',
    tier: 1,
    title: 'a shell guard found from the working folder',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { command: (s) => s });
      return [{ code: 'UNANCHORED_GUARD', subject: g.command }];
    },
  },
  {
    key: 'unanchored-python',
    tier: 1,
    title: 'a python guard found from the working folder',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { command: (s) => `python3 ${s}`, extension: 'py' });
      return [{ code: 'UNANCHORED_GUARD', subject: g.command }];
    },
  },
  {
    key: 'unanchored-behind-prefix',
    tier: 3,
    title: 'an unanchored guard behind a quiet-switch prefix',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', {
        command: (s) => `[ "$QUIET_GUARDS" = "$PPID" ] || python3 ${s}`,
        extension: 'py',
      });
      return [{ code: 'UNANCHORED_GUARD', subject: g.command }];
    },
  },
  {
    key: 'row-without-guard',
    tier: 1,
    title: 'a registry row naming no guard',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      registry(b, [`| G1 | ${g.name} | none |`, '| G2 | ghost-check.sh | none |']);
      return [{ code: 'REGISTRY_GUARD', subject: 'G2' }];
    },
  },
  {
    key: 'guard-without-row',
    tier: 1,
    title: 'a guard with no registry row',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      const other = guard(b, 'h');
      registry(b, [`| G1 | ${g.name} | none |`]);
      return [{ code: 'REGISTRY_ROW', subject: other.name }];
    },
  },
  {
    key: 'json-row-without-guard',
    tier: 1,
    title: 'a JSON registry row naming no guard',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      b.estate
        .file(`${GUARDS_DIR}/check-registry.json`, b.owner)
        .lines_([
          '{ "checks": [',
          `  { "id": "G1", "guard": "${g.name}", "enforces": [] },`,
          '  { "id": "G2", "guard": "ghost-check.sh", "enforces": [] }',
          '] }',
        ]);
      return [{ code: 'REGISTRY_GUARD', subject: 'G2' }];
    },
  },
  {
    key: 'oversize',
    tier: 1,
    title: 'standing instructions over the ceiling',
    plant: (b) => {
      skill(b, 'a');
      for (let index = 0; index < 600; index += 1)
        b.standing.push(`Note ${index}: the team keeps every record in the shared folder for one year.`);
      return [{ code: 'OVERSIZE' }];
    },
  },
  {
    key: 'unreachable-helper',
    tier: 1,
    title: 'a helper nothing routes to or dispatches',
    plant: (b) => {
      skill(b, 'a');
      const name = helper(b, 'h', false);
      return [{ code: 'UNREACHABLE', subject: helperFile(name) }];
    },
  },
  {
    key: 'unreachable-skill',
    tier: 1,
    title: 'a skill reached only by its description',
    plant: (b) => {
      skill(b, 'a');
      const { path } = skill(b, 'b', [], false);
      return [{ code: 'UNREACHABLE', subject: path }];
    },
  },
  {
    key: 'missing-by-anchored-link',
    tier: 3,
    title: 'a missing reference named by a link to a section',
    plant: (b) => {
      skill(b, 'a', [{ text: 'When unsure, see [the guide](references/gone.md#limits).', atoms: ref(b) }]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'missing-inside-reference',
    tier: 4,
    title: 'a missing file named inside a reference',
    plant: (b) => {
      const { name } = skill(b, 'a', [{ text: 'When unsure, open `references/notes.md`.', atoms: ref(b) }]);
      const notes = skillFile(name, 'references/notes.md');
      b.estate.raw(notes, '# Notes\nFor codes, open `codes.md`.\n', b.owner);
      b.estate.hint({ kind: 'reference', file: notes, line: 2 });
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'orphan-in-linked-skill',
    tier: 4,
    title: 'an orphan inside a skill folder reached by a link',
    plant: (b) => {
      const names = namesFor(b.seed, `${b.owner}-a`);
      b.estate.link(skillFile(names.skill, '').replace(/\/$/, ''), `library/${names.skill}`, b.owner);
      skill(b, 'a');
      const path = skillFile(names.skill, 'references/old.md');
      b.estate.raw(path, '# Old\n', b.owner);
      return [{ code: 'ORPHAN', subject: path }];
    },
  },
  {
    key: 'catalogue-entry-without-guard',
    tier: 4,
    title: 'a catalogue entry naming no guard',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      b.estate
        .file(`${GUARDS_DIR}/CATALOGUE.json`, b.owner)
        .lines_([
          '{ "checks": [',
          `  { "id": "C1", "hook": "${g.name}", "rules": [] },`,
          '  { "id": "C2", "hook": "ghost-check.sh", "rules": [] }',
          '] }',
        ]);
      return [{ code: 'REGISTRY_GUARD', subject: 'C2' }];
    },
  },
  {
    key: 'dispatcher-target-missing',
    tier: 4,
    title: 'a dispatcher naming a hook script that does not exist',
    plant: (b) => {
      skill(b, 'a');
      plantDispatchers(b);
      b.guards.push({
        owner: b.owner,
        event: 'Stop',
        command: `python3 ${ANCHOR}/${DISPATCHER} gone-hook`,
        atoms: [],
      });
      return [{ code: 'MISSING_SCRIPT' }];
    },
  },
  {
    key: 'two-defects',
    tier: 2,
    title: 'an orphan and a missing reference together',
    plant: (b) => {
      const { name } = skill(b, 'a', [{ text: 'When unsure, open `references/gone.md`.', atoms: ref(b) }]);
      b.estate.raw(skillFile(name, 'references/old.md'), '# Old\n', b.owner);
      return [
        { code: 'ORPHAN', subject: skillFile(name, 'references/old.md') },
        { code: 'MISSING_REFERENCE' },
      ];
    },
  },
  {
    key: 'unnamed-step-list',
    tier: 1,
    title: 'a step list nothing names',
    plant: (b) => {
      skill(b, 'a');
      b.estate.raw(`${ROOT}/steps.json`, '{ "steps": [ { "id": "start", "next": [] } ] }\n', b.owner);
      return [{ code: 'ORPHAN', subject: `${ROOT}/steps.json` }];
    },
  },
  {
    key: 'chain-unreachable',
    tier: 2,
    title: 'a helper dispatched only by an unreachable skill',
    plant: (b) => {
      skill(b, 'a');
      const name = helper(b, 'h', false);
      const { path } = skill(b, 'b', [dispatch(name)], false);
      return [
        { code: 'UNREACHABLE', subject: path },
        { code: 'UNREACHABLE', subject: helperFile(name) },
      ];
    },
  },
];

const CLEAN: Case[] = [
  {
    key: 'minimal',
    tier: 1,
    title: 'a minimal estate',
    plant: (b) => {
      skill(b, 'a');
      return [];
    },
  },
  {
    key: 'skill-with-files',
    tier: 1,
    title: 'a skill with a reference and a named script',
    plant: (b) => {
      const { name } = skill(b, 'a', [
        { text: 'When unsure, open `references/guide.md`.', atoms: ref(b) },
        { text: 'Run `python3 scripts/tally.py ID` to count.' },
      ]);
      b.estate.raw(skillFile(name, 'references/guide.md'), '# Guide\n', b.owner);
      b.estate.raw(skillFile(name, 'scripts/tally.py'), '#!/usr/bin/env python3\n', b.owner);
      return [];
    },
  },
  {
    key: 'dispatched-helper',
    tier: 1,
    title: 'a helper reached only by a dispatch',
    plant: (b) => {
      const name = helper(b, 'h', false);
      skill(b, 'a', [dispatch(name)]);
      return [];
    },
  },
  {
    key: 'anchored-guard-with-row',
    tier: 1,
    title: 'an anchored guard with its registry row',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      registry(b, [`| G1 | ${g.name} | none |`]);
      return [];
    },
  },
  {
    key: 'json-registry',
    tier: 1,
    title: 'a complete JSON registry',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      b.estate
        .file(`${GUARDS_DIR}/check-registry.json`, b.owner)
        .lines_([`{ "checks": [ { "id": "G1", "guard": "${g.name}", "enforces": [] } ] }`]);
      return [];
    },
  },
  {
    key: 'memory-and-local',
    tier: 1,
    title: 'a memory file and a local standing file',
    plant: (b) => {
      skill(b, 'a');
      b.estate.file(MEMORY, b.owner).lines_(['# Memory', '', '- Dates are written year first.']);
      b.estate.file('CLAUDE.local.md', b.owner).lines_(['# Local', '', '- Use the north printer.']);
      return [];
    },
  },
  {
    key: 'unnamed-skill-script',
    tier: 1,
    title: 'a script in a skill that the body never names',
    plant: (b) => {
      const { name } = skill(b, 'a');
      b.estate.raw(
        skillFile(name, 'scripts/helpers.py'),
        '#!/usr/bin/env python3\n"""Helpers."""\n',
        b.owner,
      );
      return [];
    },
  },
  {
    key: 'skill-via-helper',
    tier: 2,
    title: 'a skill reached only through the skills a routed helper may use',
    plant: (b) => {
      const { name } = skill(b, 'a', [], false);
      const helperName = namesFor(b.seed, `${b.owner}-h`).skill;
      b.estate
        .file(helperFile(helperName), b.owner)
        .lines_([
          '---',
          `name: ${helperName}`,
          'description: Checks records.',
          'tools: Read',
          `skills: ${name}`,
          '---',
          '',
          'You read.',
        ]);
      b.rows.push({ ask: 'check records', target: helperName, helper: true });
      return [];
    },
  },
  {
    key: 'catalogue',
    tier: 3,
    title: 'a catalogue that lists the guards',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      b.estate
        .file(`${GUARDS_DIR}/CATALOGUE.json`, b.owner)
        .lines_([`{ "checks": [ { "id": "C1", "hook": "${g.name}", "rules": [] } ] }`]);
      return [];
    },
  },
  {
    key: 'guard-behind-prefix',
    tier: 3,
    title: 'an anchored guard behind a quiet-switch prefix',
    plant: (b) => {
      skill(b, 'a');
      guard(b, 'g', {
        command: (s) => `[ "$QUIET_GUARDS" = "$PPID" ] || python3 ${ANCHOR}/${s}`,
        extension: 'py',
      });
      return [];
    },
  },
  {
    key: 'guard-by-dispatcher',
    tier: 4,
    title: 'a guard run by a dispatcher script',
    plant: (b) => {
      skill(b, 'a');
      plantDispatchers(b);
      b.estate.raw(`${ROOT}/hooks/block-push.py`, '#!/usr/bin/env python3\n', b.owner);
      b.guards.push({
        owner: b.owner,
        event: 'Stop',
        command: `python3 ${ANCHOR}/${DISPATCHER} block-push`,
        atoms: [],
      });
      return [];
    },
  },
  {
    key: 'reference-by-anchored-link',
    tier: 3,
    title: 'a reference by a link to a section',
    plant: (b) => {
      const { name } = skill(b, 'a', [
        { text: 'When unsure, see [the guide](references/guide.md#limits).', atoms: ref(b) },
      ]);
      b.estate.raw(skillFile(name, 'references/guide.md'), '# Guide\n', b.owner);
      return [];
    },
  },
  {
    key: 'reference-with-space',
    tier: 3,
    title: 'a reference whose name holds a space',
    plant: (b) => {
      const { name } = skill(b, 'a', [
        { text: 'When unsure, open `references/team notes.md`.', atoms: ref(b) },
      ]);
      b.estate.raw(skillFile(name, 'references/team notes.md'), '# Notes\n', b.owner);
      return [];
    },
  },
  {
    key: 'nested-reference',
    tier: 4,
    title: 'a reference named inside a reference',
    plant: (b) => {
      const { name } = skill(b, 'a', [{ text: 'When unsure, open `references/notes.md`.', atoms: ref(b) }]);
      b.estate.raw(skillFile(name, 'references/notes.md'), '# Notes\nFor codes, open `codes.md`.\n', b.owner);
      b.estate.raw(skillFile(name, 'references/codes.md'), '# Codes\n', b.owner);
      return [];
    },
  },
  {
    key: 'registry-adapter-column',
    tier: 3,
    title: 'a registry naming guards in an Adapter column',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      b.estate
        .file(`${GUARDS_DIR}/CHECK-REGISTRY.md`, b.owner)
        .lines_(['| Id | Adapter | Event |', '|---|---|---|', `| G1 | ${g.name} | PreToolUse |`]);
      return [];
    },
  },
  {
    key: 'yaml-registry',
    tier: 4,
    title: 'a YAML registry',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g');
      b.estate
        .file(`${GUARDS_DIR}/registry.yaml`, b.owner)
        .lines_(['checks:', '  - id: G1', `    guard: ${g.name}`]);
      return [];
    },
  },
  {
    key: 'linked-guard-script',
    tier: 3,
    title: 'a guard whose script is a link',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { exists: false });
      b.estate.link(g.script, 'library/guard.sh', b.owner);
      b.estate.raw(g.script, '#!/bin/sh\nexit 0\n', b.owner);
      return [];
    },
  },
  {
    key: 'linked-skill',
    tier: 3,
    title: 'a skill folder reached by a link, routed from the standing file',
    plant: (b) => {
      const names = namesFor(b.seed, `${b.owner}-a`);
      b.estate.link(skillFile(names.skill, '').replace(/\/$/, ''), `library/${names.skill}`, b.owner);
      skill(b, 'a', [{ text: 'When unsure, open `references/guide.md`.', atoms: ref(b) }]);
      b.estate.raw(skillFile(names.skill, 'references/guide.md'), '# Guide\n', b.owner);
      return [];
    },
  },
  {
    key: 'process-map-named',
    tier: 3,
    title: 'a process map the standing file names',
    plant: (b) => {
      skill(b, 'a');
      b.standing.push(named(b, 'Every task follows `.claude/process-steps.json`.'));
      b.estate.raw(
        `${ROOT}/process-steps.json`,
        '{ "processes": { "work": { "steps": [ { "id": "start", "next": [] } ] } } }\n',
        b.owner,
      );
      return [];
    },
  },
  {
    key: 'standing-in-layout',
    tier: 1,
    title: 'standing instructions inside the layout folder',
    plant: (b) => {
      skill(b, 'a');
      b.estate.file(`${ROOT}/CLAUDE.md`, b.owner).lines_(['# More', '', '- Keep replies short.']);
      return [];
    },
  },
  {
    key: 'frontmatter-guard-with-row',
    tier: 2,
    title: "a skill's own guard with its registry row",
    plant: (b) => {
      const names = namesFor(b.seed, `${b.owner}-a`);
      const script = skillFile(names.skill, 'scripts/check.sh');
      plantSkill(b.estate, b.owner, names.skill, 'Checks things.', [], {
        frontmatter: [
          { text: '---' },
          { text: `name: ${names.skill}` },
          { text: 'description: Checks things for the team.' },
          { text: 'hooks:' },
          { text: '  PreToolUse:' },
          { text: '    - matcher: Bash' },
          { text: '      hooks:' },
          { text: '        - type: command' },
          { text: `          command: "$CLAUDE_PROJECT_DIR/${script}"` },
          { text: '---' },
        ],
      });
      b.rows.push({ ask: 'check things', target: names.skill });
      b.estate.raw(script, '#!/bin/sh\nexit 0\n', b.owner);
      registry(b, ['| G1 | check.sh | none |']);
      return [];
    },
  },
  {
    key: 'data-file-named',
    tier: 1,
    title: 'a data file a skill names',
    plant: (b) => {
      const { name } = skill(b, 'a', [{ text: 'Look codes up in `data/codes.json`.', atoms: ref(b) }]);
      b.estate.raw(skillFile(name, 'data/codes.json'), '{ "codes": [] }\n', b.owner);
      return [];
    },
  },
];

async function judgeCase(seed: number, family: string, item: Case): Promise<ItemResult> {
  const estate = new PlantedEstate();
  const owner = `${family}.${item.key}`;
  const build: Build = {
    estate,
    seed,
    owner,
    rows: [],
    guards: [],
    rules: [],
    standing: [],
    refs: new Set(),
    counted: 0,
  };
  const expected = item.plant(build);
  const writer = estate.file(STANDING, 'base');
  writer.lines_(['# Planted estate', '', 'Everything here is invented for testing.']);
  if (build.standing.length > 0) {
    writer.line('');
    for (const text of build.standing) {
      const line = writer.line(text);
      if (build.refs.has(text)) estate.hint({ kind: 'reference', file: STANDING, line });
    }
  }
  if (build.rows.length > 0) {
    writer.lines_(['', '| When the user wants to | Load |', '|---|---|']);
    for (const row of build.rows) {
      writer.line(`| ${row.ask} | ${row.helper ? `the \`${row.target}\` agent` : `\`${row.target}\``} |`, [
        { hid: `${owner}:row:${row.target}`, kind: 'route', key: row.target },
      ]);
      if (row.helper)
        estate.hint({ kind: 'subagent', file: helperFile(row.target), line: 1, key: row.target });
    }
  }
  writeSettings(estate, build.guards);
  const scan = await estate.scan();
  return compare(scan, expected);
}

function compare(scan: ScanOutcome, expected: readonly Expected[]): ItemResult {
  const found = scan.lint.findings.filter((finding) => finding.code !== 'UNENFORCED');
  const open = [...found];
  const missed: string[] = [];
  for (const want of expected) {
    const subject = want.atom ? scan.idOf.get(want.atom) : want.subject;
    const at = open.findIndex(
      (finding) => finding.code === want.code && (subject === undefined || finding.subject === subject),
    );
    if (at < 0) missed.push(`${want.code}${subject ? ` on ${subject}` : ''}`);
    else open.splice(at, 1);
  }
  const problems = [
    ...missed.map((text) => `the lint did not give ${text}`),
    ...open.map((finding) => `the lint gave ${finding.code} on ${finding.subject}, never planted`),
  ];
  return {
    pass: problems.length === 0,
    detail: problems.length === 0 ? 'holds' : problems.slice(0, 3).join('; '),
  };
}

function caseFamily(family: string, cases: readonly Case[], verb: string): Family {
  const items = itemsOf(
    family,
    2,
    LINT,
    cases.map(({ key, tier, title }) => ({ key, tier, title: `${verb} ${title}` })),
  );
  return {
    id: family,
    level: 2,
    component: LINT,
    items,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const item of cases) {
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

export function lintDefectFamily(): Family {
  return caseFamily('lint.defect', DEFECTS, 'the lint finds');
}
export function lintCleanFamily(): Family {
  return caseFamily('lint.clean', CLEAN, 'the lint finds nothing in');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
