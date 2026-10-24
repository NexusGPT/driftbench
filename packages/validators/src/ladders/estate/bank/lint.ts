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
type Case = {
  key: string;
  tier: Tier;
  title: string;
  /**
   * Scan with no model: code alone reads the references of the prose. Such a scan has no route from the standing
   * instructions to a skill, so the item judges the reference findings only.
   */
  noModel?: boolean;
  plant(build: Build): Expected[];
};

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
      const lines = ['# Notes', 'For codes, open `codes.md`.'];
      b.estate.raw(notes, `${lines.join('\n')}\n`, b.owner);
      b.estate.hint({ kind: 'reference', file: notes, line: lines.length });
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
  {
    key: 'no-model-missing-reference',
    tier: 2,
    title: 'a file a skill body names, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [{ text: 'When unsure, open `references/absent.md`.' }]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'orphan-module-named-in-docstring',
    tier: 3,
    title: 'a module a guard script only mentions in a docstring',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { extension: 'py' });
      const module = `${GUARDS_DIR}/helpers.py`;
      b.estate.raw(g.script, '"""\nimport helpers\n"""\nprint("done")\n', b.owner);
      b.estate.raw(module, 'VALUE = 1\n', b.owner);
      return [{ code: 'ORPHAN', subject: module }];
    },
  },
  {
    key: 'no-model-missing-extensionless-link',
    tier: 2,
    title: 'a link to a file with no file type that does not exist, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [{ text: 'When unsure, read [the entry](references/leaf) first.' }]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-missing-definition-target',
    tier: 2,
    title: 'a link definition whose file has no file type and does not exist, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [{ text: 'See [the entry][r] first.' }, { text: '' }, { text: '[r]: references/leaf' }]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-missing-after-list-fence',
    tier: 3,
    title: 'a missing file named after a fenced block that a list item opens, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [
        { text: '- ```text' },
        { text: '  Read `references/example.md` first.' },
        { text: '  ```' },
        { text: '' },
        { text: 'Then read `references/absent.md`.' },
      ]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-missing-angle-destination',
    tier: 2,
    title:
      'a link destination in angle brackets, with a space and no file type, that does not exist, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [{ text: 'When unsure, read [the entry](<references/my leaf>) first.' }]);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-orphan-beside-named',
    tier: 2,
    title: 'an orphan beside a reference a table cell names, read with no model',
    noModel: true,
    plant: (b) => {
      const { name } = skill(b, 'a', [
        { text: '| Case | Read |' },
        { text: '|---|---|' },
        { text: '| unsure | `references/guide.md` |' },
      ]);
      b.estate.raw(skillFile(name, 'references/guide.md'), '# Guide\n', b.owner);
      const old = skillFile(name, 'references/old.md');
      b.estate.raw(old, '# Old\n', b.owner);
      return [{ code: 'ORPHAN', subject: old }];
    },
  },
  {
    key: 'no-model-missing-import',
    tier: 2,
    title: 'a standing import of a file that does not exist, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push('@rules/absent.md');
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-inline-missing-import',
    tier: 2,
    title: 'an import written inside a sentence, of a file that does not exist, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push('For the details see @rules/absent.md before you start.');
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-outside-import',
    tier: 2,
    title: 'a standing import of a file in the home folder, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push('@~/notes/personal.md');
      return [{ code: 'EXTERNAL' }];
    },
  },
  {
    key: 'no-model-import-from-importer-folder',
    tier: 3,
    title: 'an import read from the folder of the file that holds it, whose file stands at the root only',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.estate.file(`${ROOT}/CLAUDE.md`, b.owner).lines_(['# More', '', '@rules/shared.md']);
      b.estate.file('rules/shared.md', b.owner).lines_(['# Shared', '', '- Keep replies short.']);
      return [{ code: 'MISSING_REFERENCE' }];
    },
  },
  {
    key: 'no-model-denied-import',
    tier: 3,
    title: 'an import through a link that leads out of the estate, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.estate.outsideFile('rules/personal.md', '- Keep replies short.\n');
      b.estate.link('shared', 'outside/rules', b.owner);
      b.standing.push('@shared/personal.md');
      return [{ code: 'EXTERNAL' }];
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
      const notes = skillFile(name, 'references/notes.md');
      const lines = ['# Notes', 'For codes, open `codes.md`.'];
      b.estate.raw(notes, `${lines.join('\n')}\n`, b.owner);
      b.estate.hint({ kind: 'reference', file: notes, line: lines.length });
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
  {
    key: 'no-model-named-reference',
    tier: 2,
    title: 'a reference a table cell and a link name, read with no model',
    noModel: true,
    plant: (b) => {
      const { name } = skill(b, 'a', [
        { text: '| Case | Read |' },
        { text: '|---|---|' },
        { text: '| unsure | `references/guide.md` |' },
        { text: 'The checklist is in [the list](references/checklist.md).' },
      ]);
      b.estate.raw(skillFile(name, 'references/guide.md'), '# Guide\n', b.owner);
      b.estate.raw(skillFile(name, 'references/checklist.md'), '# Checklist\n', b.owner);
      return [];
    },
  },
  {
    key: 'python-imports',
    tier: 3,
    title: 'library modules a guard script imports',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { extension: 'py' });
      const lib = `${GUARDS_DIR}/lib`;
      b.estate.raw(
        g.script,
        'import sys\nimport helpers\nfrom lib.tools import run\n\nrun(sys.argv)\n',
        b.owner,
      );
      b.estate.raw(`${GUARDS_DIR}/helpers.py`, 'VALUE = 1\n', b.owner);
      b.estate.raw(
        `${lib}/tools.py`,
        'from .shared import limit\n\n\ndef run(argv):\n    return limit\n',
        b.owner,
      );
      b.estate.raw(`${lib}/shared.py`, 'limit = 3\n', b.owner);
      return [];
    },
  },
  {
    key: 'javascript-imports',
    tier: 3,
    title: 'modules a guard script imports and requires',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { extension: 'mjs' });
      b.estate.raw(
        g.script,
        "import { run } from './util.mjs';\nconst legacy = require('./legacy');\n\nrun(legacy);\n",
        b.owner,
      );
      b.estate.raw(`${GUARDS_DIR}/util.mjs`, 'export const run = () => 1;\n', b.owner);
      b.estate.raw(`${GUARDS_DIR}/legacy.js`, 'module.exports = {};\n', b.owner);
      return [];
    },
  },
  {
    key: 'typescript-imports',
    tier: 3,
    title: 'modules a TypeScript guard script imports, by the name its compiled file has and by a folder',
    plant: (b) => {
      skill(b, 'a');
      const g = guard(b, 'g', { extension: 'ts' });
      b.estate.raw(
        g.script,
        "import { run } from './util.js';\nimport { limit } from './shared';\n\nrun(limit);\n",
        b.owner,
      );
      b.estate.raw(`${GUARDS_DIR}/util.ts`, 'export const run = (n: number) => n;\n', b.owner);
      b.estate.raw(`${GUARDS_DIR}/shared/index.ts`, 'export const limit = 3;\n', b.owner);
      return [];
    },
  },
  {
    key: 'no-model-extensionless-file',
    tier: 2,
    title: 'a file with no file type that a link and a code span name, read with no model',
    noModel: true,
    plant: (b) => {
      const { name } = skill(b, 'a', [
        { text: 'When unsure, read [the entry](references/leaf) first.' },
        { text: 'Then run `scripts/tool`.' },
      ]);
      b.estate.raw(skillFile(name, 'references/leaf'), 'leaf\n', b.owner);
      b.estate.raw(skillFile(name, 'scripts/tool'), '#!/bin/sh\n', b.owner);
      return [];
    },
  },
  {
    key: 'no-model-fenced-example',
    tier: 2,
    title: 'a four-backtick example holding a three-backtick fence and a path, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [
        { text: '````text' },
        { text: '```' },
        { text: 'Read `notes/absent.md` first.' },
        { text: '````' },
      ]);
      return [];
    },
  },
  {
    key: 'no-model-path-in-indented-code',
    tier: 2,
    title: 'a path in an indented code block, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [
        { text: 'An example of a path:' },
        { text: '' },
        { text: '    Read `references/absent.md` first.' },
      ]);
      return [];
    },
  },
  {
    key: 'no-model-path-in-code-span-over-lines',
    tier: 2,
    title: 'a path inside a code span that runs over two lines, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a', [{ text: 'A `span of words' }, { text: 'references/absent.md more words` ends here.' }]);
      return [];
    },
  },
  {
    key: 'no-model-import-not-text',
    tier: 3,
    title:
      'an import written in a definition, an image description and an indented code block, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push('[ref]: @rules/absent.md');
      b.standing.push('![picture @rules/absent.md](picture.png)');
      b.standing.push('');
      b.standing.push('    @rules/absent.md');
      return [];
    },
  },
  {
    key: 'no-model-import-in-link-label',
    tier: 2,
    title: 'an import that ends a link label, whose file exists, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push(`[see @${ROOT}/rules/shared.md](https://example.org/page)`);
      b.estate.file(`${ROOT}/rules/shared.md`, b.owner).lines_(['# Shared', '', '- Keep replies short.']);
      return [];
    },
  },
  {
    key: 'no-model-inline-import',
    tier: 2,
    title: 'an import written inside a sentence, whose file exists, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push(`For the details see @${ROOT}/rules/shared.md before you start.`);
      b.estate.file(`${ROOT}/rules/shared.md`, b.owner).lines_(['# Shared', '', '- Keep replies short.']);
      return [];
    },
  },
  {
    key: 'no-model-chained-import',
    tier: 3,
    title: 'a standing import of a file that imports another, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push(`@${ROOT}/rules/first.md`);
      b.estate.file(`${ROOT}/rules/first.md`, b.owner).lines_(['# First', '', '@second.md']);
      b.estate.file(`${ROOT}/rules/second.md`, b.owner).lines_(['# Second', '', '- Keep replies short.']);
      return [];
    },
  },
  {
    key: 'no-model-self-import',
    tier: 2,
    title: 'a standing file that imports itself, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.estate.file(`${ROOT}/CLAUDE.md`, b.owner).lines_(['# More', '', '@CLAUDE.md']);
      return [];
    },
  },
  {
    key: 'no-model-import-in-label-code',
    tier: 2,
    title: 'an import written in a code span inside a link label, read with no model',
    noModel: true,
    plant: (b) => {
      skill(b, 'a');
      b.standing.push('See [the page `write @rules/absent.md` as text](https://example.org/page).');
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
  const scan = await estate.scan(item.noModel ? { noModel: true } : {});
  return compare(scan, expected, item.noModel ? REFERENCE_CODES : undefined);
}

/** The findings a scan with no model judges: what it says about the files that are named and the names that lead nowhere. */
const REFERENCE_CODES: ReadonlySet<string> = new Set([
  'ORPHAN',
  'MISSING_REFERENCE',
  'AMBIGUOUS_REFERENCE',
  'UNRESOLVED_REFERENCE',
  'EXTERNAL',
]);

function compare(scan: ScanOutcome, expected: readonly Expected[], scope?: ReadonlySet<string>): ItemResult {
  const found = scan.lint.findings.filter(
    (finding) => finding.code !== 'UNENFORCED' && (scope === undefined || scope.has(finding.code)),
  );
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
