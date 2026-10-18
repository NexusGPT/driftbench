import { helperFile, ROOT, SETTINGS, STANDING, skillFile } from '../layout';
import { anchored, namesFor, plantSkill, rule, writeSettings } from './common';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { type Check, PlantedEstate, type ScanOutcome } from './planted';

/**
 * Two families of inputs a reader meets on a real estate and must survive (docs/validators.md section 12.2,
 * points 5 and 7), each item an estate of its own so a crash or a slow file costs only its own item.
 *
 * scan.hostile: degenerate and hostile files: an empty or bodiless definition, an unclosed frontmatter, binary
 * bytes, very long lines and descriptions, deep and wide folders, settings with a byte order mark or a wrong
 * shape, a hook that is not a command, two skills with one name, helpers in a subfolder, null bytes. The
 * oracle: the scan finishes within its time, reads what can be read, and leaves a note where it could not.
 *
 * scan.decoys: lines and tables that look like what code reads and are not: a table naming a skill that is
 * not a routing table, a negated dispatch or reading, examples inside code fences and comments, a form number
 * that looks like a rule label, a guard message that happens to quote part of a rule. The oracle: no atom
 * and no edge from the decoy.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const CODE = 'packages/estate/src/scan/code.ts';
const EDGES = 'packages/estate/src/graph/edges.ts';
// The product scanner's wall time, after fixture setup and before validator checks and cleanup.
const BUDGET_MS = 5000;

export type Case = {
  key: string;
  tier: Tier;
  title: string;
  component?: string;
  /** The one change that would make the item pass, when the cause table does not name it. */
  cause?: string;
  plant(estate: PlantedEstate, seed: number, owner: string): void;
};

export function noteNames(path: string): Check {
  return (scan) => (scan.notes.some((note) => note.startsWith(path)) ? undefined : `no note names ${path}`);
}

/** A helper file with its unit and description route planted. */
export function helperUnit(estate: PlantedEstate, owner: string, name: string): void {
  const path = helperFile(name);
  const writer = estate.file(path, owner);
  writer.line('---');
  writer.line(`name: ${name}`, [{ hid: `${owner}:helper`, kind: 'subagent', key: name }]);
  writer.line('description: Checks records.', [{ hid: `${owner}:helper-route`, kind: 'route', key: name }]);
  writer.lines_(['tools: Read', '---', '', 'You read.']);
}

export function standardSkill(estate: PlantedEstate, seed: number, owner: string, body: string[] = []) {
  const names = namesFor(seed, owner);
  plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
    rule(`${owner}:rule`, `Always name the ${names.noun} in the first line.`),
    ...body.map((text) => ({ text })),
  ]);
  return names;
}

const HOSTILE: Case[] = [
  {
    key: 'empty-definition',
    tier: 2,
    title: 'an empty skill definition: noted, no atom',
    plant: (e, s, o) => {
      const path = skillFile(namesFor(s, o).skill, 'SKILL.md');
      e.raw(path, '', o);
      e.check(o, noteNames(path));
    },
  },
  {
    key: 'frontmatter-only',
    tier: 1,
    title: 'a definition with a frontmatter and no body',
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      e.file(skillFile(names.skill, 'SKILL.md'), o).lines_(['---', `name: ${names.skill}`, '---']);
      e.expect(o, {
        hid: `${o}:skill`,
        kind: 'skill',
        file: skillFile(names.skill, 'SKILL.md'),
        line: 2,
        key: names.skill,
      });
    },
  },
  {
    key: 'unclosed-frontmatter',
    tier: 2,
    title: 'a frontmatter never closed: noted',
    plant: (e, s, o) => {
      const folder = namesFor(s, o).skill;
      const path = skillFile(folder, 'SKILL.md');
      e.raw(path, '---\nname: half\ndescription: Never closed.\n\nBody.\n', o);
      // Nothing can be read from the block: the folder names the skill, and a note says why.
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 1, key: folder });
      e.check(o, noteNames(path));
    },
  },
  {
    key: 'binary-reference',
    tier: 2,
    title: 'binary bytes in a reference file: no atom, no crash',
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      e.raw(skillFile(names.skill, 'references/scan.md'), `\u0000\u0001\u0002PNG\u0000${'ÿ'.repeat(200)}`, o);
    },
  },
  {
    key: 'null-bytes-in-body',
    tier: 2,
    title: 'null bytes inside a body line',
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      plantSkill(e, o, names.skill, 'Checks things.', [
        { text: `Always name the ${names.noun}\u0000 first.` },
      ]);
    },
  },
  {
    key: 'long-line',
    tier: 3,
    title: 'a body line of 200,000 characters',
    plant: (e, s, o) => {
      standardSkill(e, s, o, [`Note: ${'the team keeps every record '.repeat(7000)}`]);
    },
  },
  {
    key: 'huge-description',
    tier: 3,
    title: 'a description of 100,000 characters',
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      plantSkill(
        e,
        o,
        names.skill,
        `Checks a ${names.noun}. ${'Each record keeps its own owner. '.repeat(3000)}`,
        [],
      );
    },
  },
  {
    key: 'deep-folders',
    tier: 2,
    title: 'a reference forty folders deep',
    plant: (e, s, o) => {
      const deep = `references/${Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')}/leaf.md`;
      const names = namesFor(s, o);
      e.raw(skillFile(names.skill, deep), '# Leaf\n', o);
      plantSkill(e, o, names.skill, 'Checks things.', [
        {
          text: `When unsure, open \`${deep}\`.`,
          atoms: [{ hid: `${o}:ref`, kind: 'reference', key: skillFile(names.skill, deep) }],
        },
      ]);
    },
  },
  {
    key: 'wide-folder',
    tier: 3,
    title: 'a references folder of two thousand files',
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      for (let index = 0; index < 2000; index += 1)
        e.raw(skillFile(names.skill, `references/n${index}.md`), `# ${index}\n`, o);
    },
  },
  {
    key: 'settings-bom',
    tier: 3,
    title: 'settings that start with a byte order mark are read',
    plant: (e, _s, o) => {
      e.raw(SETTINGS, '﻿{\n  "model": "sonnet"\n}\n', o);
      e.expect(o, { hid: `${o}:model`, kind: 'setting', file: SETTINGS, line: 2, key: 'model' });
    },
  },
  {
    key: 'settings-comments',
    tier: 3,
    title: 'settings with comments: noted, the scan goes on',
    plant: (e, _s, o) => {
      e.raw(SETTINGS, '{\n  // the model\n  "model": "sonnet"\n}\n', o);
      e.check(o, noteNames(SETTINGS));
    },
  },
  {
    key: 'hooks-wrong-shape',
    tier: 3,
    title: 'hooks given as an object, not a list: noted',
    plant: (e, _s, o) => {
      e.raw(SETTINGS, '{\n  "hooks": { "Stop": { "type": "command", "command": "x.sh" } }\n}\n', o);
      e.check(o, noteNames(SETTINGS));
    },
  },
  {
    key: 'prompt-hook',
    tier: 3,
    title: 'a hook of type prompt is a guard with no script',
    plant: (e, _s, o) => {
      e.raw(
        SETTINGS,
        '{\n  "hooks": {\n    "Stop": [ { "hooks": [ { "type": "prompt", "prompt": "Check the reply." } ] } ]\n  }\n}\n',
        o,
      );
      // The guard is the hook on line 3 (its event), named by the prompt's words; it has no script.
      e.expect(o, { hid: `${o}:guard`, kind: 'guard', file: SETTINGS, line: 3, key: 'check-the-reply' });
    },
  },
  {
    key: 'long-command',
    tier: 2,
    title: 'a guard command of ten thousand characters',
    plant: (e, s, o) => {
      const script = `${ROOT}/guards/${namesFor(s, o).skill}.sh`;
      e.raw(script, '#!/bin/sh\nexit 0\n', o);
      writeSettings(e, [
        {
          owner: o,
          event: 'Stop',
          command: `${anchored(script)} ${'--flag '.repeat(1400)}`,
          atoms: [{ hid: `${o}:guard`, kind: 'guard', key: script.split('/').pop() as string }],
        },
      ]);
    },
  },
  {
    key: 'duplicate-names',
    tier: 3,
    title: 'two skill folders with one name: both read, noted',
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      for (const folder of [`${names.skill}-a`, `${names.skill}-b`]) {
        const path = skillFile(folder, 'SKILL.md');
        e.file(path, o).lines_([
          '---',
          `name: ${names.skill}`,
          'description: Checks things.',
          '---',
          '',
          'Body.',
        ]);
        e.expect(o, { hid: `${o}:${folder}:skill`, kind: 'skill', file: path, line: 2, key: names.skill });
        e.expect(o, { hid: `${o}:${folder}:route`, kind: 'route', file: path, line: 3, key: names.skill });
      }
      e.check(o, (scan) =>
        scan.notes.some((note) => note.includes(names.skill)) ? undefined : 'no note names the shared name',
      );
    },
  },
  {
    key: 'helper-subfolder',
    tier: 3,
    title: 'a helper in a subfolder of the helpers folder',
    plant: (e, s, o) => {
      const name = namesFor(s, o).skill;
      const path = helperFile(`team/${name}`);
      e.file(path, o).lines_([
        '---',
        `name: ${name}`,
        'description: Checks records.',
        'tools: Read',
        '---',
        '',
        'You read.',
      ]);
      e.expect(o, { hid: `${o}:unit`, kind: 'subagent', file: path, line: 2, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: name });
    },
  },
  {
    key: 'name-with-capitals',
    tier: 2,
    title: 'a skill named with capitals and a space',
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      const path = skillFile(names.skill, 'SKILL.md');
      e.file(path, o).lines_([
        '---',
        'name: Weekly Report',
        'description: Checks things.',
        '---',
        '',
        'Body.',
      ]);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: 'Weekly Report' });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: 'Weekly Report' });
    },
  },
  {
    key: 'folder-without-definition',
    tier: 2,
    title: 'a skill folder with files and no definition: no skill atom',
    plant: (e, s, o) => {
      e.raw(skillFile(namesFor(s, o).skill, 'references/notes.md'), '# Notes\n', o);
    },
  },
  {
    key: 'empty-standing',
    tier: 1,
    title: 'an empty standing file',
    plant: (e, _s, o) => {
      e.raw(STANDING, '', o);
    },
  },
  {
    key: 'big-registry',
    tier: 3,
    title: 'a registry table of five thousand rows',
    plant: (e, _s, o) => {
      const rows = Array.from({ length: 5000 }, (_, i) => `| G${i} | g${i}.sh | none |`);
      e.raw(
        `${ROOT}/guards/CHECK-REGISTRY.md`,
        ['| Id | Guard | Enforces |', '|---|---|---|', ...rows, ''].join('\n'),
        o,
      );
    },
  },
  {
    key: 'crlf-settings',
    tier: 2,
    title: 'settings with carriage-return line endings',
    plant: (e, _s, o) => {
      e.raw(SETTINGS, '{\r\n  "model": "sonnet"\r\n}\r\n', o);
      e.expect(o, { hid: `${o}:model`, kind: 'setting', file: SETTINGS, line: 2, key: 'model' });
    },
  },
  {
    key: 'tabs-in-frontmatter',
    tier: 3,
    title: 'a frontmatter indented with tabs',
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      const path = skillFile(names.skill, 'SKILL.md');
      e.file(path, o).lines_([
        '---',
        `name: ${names.skill}`,
        'description: Checks things.',
        'allowed-tools:',
        '\t- Read',
        '---',
        '',
        'Body.',
      ]);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: names.skill });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: names.skill });
    },
  },
];

const DECOYS: Case[] = [
  {
    key: 'owner-table',
    tier: 3,
    title: 'a table of owners that names a skill is no routing table',
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      e.file(STANDING, o).lines_([
        '',
        '| Owner | Skill they maintain |',
        '|---|---|',
        `| Ana | \`${names.skill}\` |`,
      ]);
    },
  },
  {
    key: 'negated-route',
    tier: 4,
    title: 'a routing row that says not to load a skill',
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      e.file(STANDING, o).lines_([
        '',
        '| When the user wants to | Load |',
        '|---|---|',
        `| chat about the weather | nothing, never \`${names.skill}\` |`,
      ]);
    },
  },
  {
    key: 'negated-dispatch',
    tier: 4,
    title: 'a sentence that forbids dispatching a helper gives no dispatch edge',
    component: EDGES,
    plant: (e, s, o) => {
      const helper = namesFor(s, `${o}-h`).skill;
      helperUnit(e, o, helper);
      standardSkill(e, s, o, [`Never dispatch the \`${helper}\` agent for this.`]);
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'dispatch')
          ? 'a dispatch edge from a negated sentence'
          : undefined,
      );
    },
  },
  {
    key: 'dispatch-in-fence',
    tier: 3,
    title: 'a helper named inside a code fence gives no dispatch edge',
    component: EDGES,
    plant: (e, s, o) => {
      const helper = namesFor(s, `${o}-h`).skill;
      helperUnit(e, o, helper);
      standardSkill(e, s, o, ['```text', `example: dispatch the \`${helper}\` agent`, '```']);
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'dispatch')
          ? 'a dispatch edge from a code fence'
          : undefined,
      );
    },
  },
  {
    key: 'reference-in-fence',
    tier: 3,
    title: 'a file named inside a code fence is no reference',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['```text', 'cat `references/example.md`', '```']);
    },
  },
  {
    key: 'reference-in-comment',
    tier: 3,
    title: 'a file named inside a comment is no reference',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['<!-- old: see `references/old.md` -->']);
    },
  },
  {
    key: 'negated-reference',
    tier: 4,
    title: 'a file the agent must not read is no reference to read',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['Do not read `references/private.md` under any condition.']);
    },
  },
  {
    key: 'changelog-reference',
    tier: 4,
    title: 'a file named in a change note is no reference',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['## Changes', '', '- Version 2 removed `references/legacy.md`.']);
    },
  },
  {
    key: 'gate-in-fence',
    tier: 3,
    title: 'a gate written inside a code fence is no gate',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['```text', 'Before editing a file: read `rules.md`.', '```']);
    },
  },
  {
    key: 'hazard-in-fence',
    tier: 3,
    title: 'a hazard word inside a code fence is no hazard',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['```text', 'log: restart of the worker after a compaction', '```']);
    },
  },
  {
    key: 'routing-in-fence',
    tier: 3,
    title: 'a routing table quoted inside a code fence gives no route',
    component: CODE,
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      e.file(STANDING, o).lines_([
        '',
        '```markdown',
        '| When the user wants to | Load |',
        '|---|---|',
        `| do it | \`${names.skill}\` |`,
        '```',
      ]);
    },
  },
  {
    key: 'form-number-label',
    tier: 4,
    title: 'a form number that reads like a rule label cites no rule',
    component: EDGES,
    plant: (e, _s, o) => {
      const writer = e.file(STANDING, o);
      const first = rule(`${o}:r1`, 'Read a file before you edit it.');
      writer.line(`- **R1.** ${first.text}`, first.atoms, first.prose);
      const second = rule(`${o}:r2`, 'Keep tax form R1 in the archive for ten years.');
      writer.line(`- **R2.** ${second.text}`, second.atoms, second.prose);
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'cites') ? 'a form number cited a rule' : undefined,
      );
    },
  },
  {
    key: 'guard-message-overlap',
    tier: 4,
    title: "a guard message that quotes part of a rule's words is no enforcement",
    component: EDGES,
    plant: (e, s, o) => {
      const writer = e.file(STANDING, o);
      const planted = rule(`${o}:r1`, 'When the user asks to stop, stop all work and confirm in one line.');
      writer.line(`- **R1.** ${planted.text}`, planted.atoms, planted.prose);
      const script = `${ROOT}/guards/${namesFor(s, o).skill}.py`;
      e.raw(script, 'import sys\nprint("the user asks to stop")\nsys.exit(0)\n', o);
      writeSettings(e, [
        {
          owner: o,
          event: 'Stop',
          command: anchored(script, 'python3'),
          atoms: [{ hid: `${o}:guard`, kind: 'guard', key: script.split('/').pop() as string }],
        },
      ]);
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'enforces')
          ? 'the guard enforces a rule it only quotes in passing'
          : undefined,
      );
    },
  },
  {
    key: 'registry-in-fence',
    tier: 3,
    title: 'a registry row quoted inside a code fence enforces nothing',
    component: READER,
    plant: (e, s, o) => {
      const writer = e.file(STANDING, o);
      const planted = rule(`${o}:r1`, 'Never push with force.');
      writer.line(`- **R1.** ${planted.text}`, planted.atoms, planted.prose);
      const guard = `${namesFor(s, o).skill}.sh`;
      e.raw(`${ROOT}/guards/${guard}`, '#!/bin/sh\nexit 0\n', o);
      writeSettings(e, [
        {
          owner: o,
          event: 'Stop',
          command: anchored(`${ROOT}/guards/${guard}`),
          atoms: [{ hid: `${o}:guard`, kind: 'guard', key: guard }],
        },
      ]);
      e.raw(
        `${ROOT}/guards/CHECK-REGISTRY.md`,
        [
          'An example of a row:',
          '',
          '```markdown',
          '| Id | Guard | Enforces |',
          '|---|---|---|',
          `| G1 | ${guard} | R1 |`,
          '```',
          '',
        ].join('\n'),
        o,
      );
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'enforces')
          ? 'an example row enforced a rule'
          : undefined,
      );
    },
  },
  {
    key: 'script-name-in-prose',
    tier: 3,
    title: "a script's name mentioned in passing anchors no script on that line",
    component: CODE,
    plant: (e, s, o) => {
      const names = namesFor(s, o);
      const script = skillFile(names.skill, 'scripts/tally.py');
      e.raw(script, '#!/usr/bin/env python3\n"""Tallies."""\n', o);
      plantSkill(e, o, names.skill, 'Checks things.', [
        { text: 'The old tally.py was slow; never mind it.' },
        {
          text: 'Run `python3 scripts/tally.py ID` to count.',
          atoms: [{ hid: `${o}:script`, kind: 'script', key: script }],
        },
      ]);
    },
  },
  {
    key: 'hazard-in-example-quote',
    tier: 4,
    title: 'a hazard word inside a quoted example is no hazard',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['An error reads like "rate limit exceeded for order 42"; quote it as it is.']);
    },
  },
  {
    key: 'route-to-unknown',
    tier: 2,
    title: 'a routing row naming no known skill gives no route',
    component: CODE,
    plant: (e, _s, o) => {
      e.file(STANDING, o).lines_([
        '',
        '| When the user wants to | Load |',
        '|---|---|',
        '| plan a party | `party-planner` |',
      ]);
    },
  },
  {
    key: 'url-in-link-text',
    tier: 3,
    title: 'a web address as a link target is no reference',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, [
        'See [the guide](http://example.com/guide.md) and [the notes](ftp://example.com/notes.md).',
      ]);
    },
  },
  {
    key: 'glob-in-link',
    tier: 3,
    title: 'a glob as a link target is no reference',
    component: CODE,
    plant: (e, s, o) => {
      standardSkill(e, s, o, ['See [every guide](references/*.md) when in doubt.']);
    },
  },
  {
    key: 'two-tables-one-route',
    tier: 2,
    title: 'two routing tables naming one skill give two routes',
    component: CODE,
    plant: (e, s, o) => {
      const names = standardSkill(e, s, o);
      const writer = e.file(STANDING, o);
      writer.lines_(['', '| When the user wants to | Load |', '|---|---|']);
      writer.line(`| count things | \`${names.skill}\` |`, [
        { hid: `${o}:row1`, kind: 'route', key: names.skill },
      ]);
      writer.lines_(['', '| When the team wants to | Load |', '|---|---|']);
      writer.line(`| audit things | \`${names.skill}\` |`, [
        { hid: `${o}:row2`, kind: 'route', key: names.skill },
      ]);
    },
  },
];

export async function judgeCase(seed: number, family: string, item: Case): Promise<ItemResult> {
  const estate = new PlantedEstate();
  const owner = `${family}.${item.key}`;
  item.plant(estate, seed, owner);
  if (!estate.writers.has(STANDING) && !estate.raws.has(STANDING))
    estate.file(STANDING, 'base').line('# Planted estate');
  if (!estate.writers.has(SETTINGS) && !estate.raws.has(SETTINGS)) writeSettings(estate);
  let scan: ScanOutcome;
  try {
    scan = await estate.scan();
  } catch (cause) {
    return {
      pass: false,
      detail: `the scan threw: ${cause instanceof Error ? cause.message.slice(0, 160) : String(cause)}`,
    };
  }
  const elapsed = scan.scanMs;
  const result = estate.judge(scan, [owner]).get(owner) as ItemResult;
  if (elapsed > BUDGET_MS)
    return { pass: false, detail: `the scan took ${elapsed} ms, over ${BUDGET_MS} ms; ${result.detail}` };
  return result;
}

export function caseFamily(family: string, component: string, cases: readonly Case[], verb: string): Family {
  const items = itemsOf(
    family,
    1,
    component,
    cases.map(({ key, tier, title, component: own, cause }) => ({
      key,
      tier,
      title: `${verb} ${title}`,
      ...(own ? { component: own } : {}),
      ...(cause ? { cause } : {}),
    })),
  );
  return {
    id: family,
    level: 1,
    component,
    items,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const item of cases) out.set(`${family}.${item.key}`, await judgeCase(seed, family, item));
      return out;
    },
  };
}

export function hostileFamily(): Family {
  return caseFamily('scan.hostile', READER, HOSTILE, 'the scan survives');
}
export function decoysFamily(): Family {
  return caseFamily('scan.decoys', CODE, DECOYS, 'code is not fooled:');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
