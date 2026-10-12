import { helperFile, ROOT, STANDING, skillFile } from '../../layout';
import { anchored, rule, writeSettings } from '../common';
import type { Family } from '../frame';
import { type Case, caseFamily } from '../hostile';
import { BASE, type FileWriter, type PlantedEstate } from '../planted';
import { atomAt, atomsIn, noAtomOn, READER, standingFree, tag, theme } from './util';

/**
 * blind.layout: where a Claude Code estate keeps its parts and the shapes the structured files take. Each
 * item plants one layout form in an estate of its own and asks only for what the docs say the reader holds:
 * the standing files and memory files, the settings files and their guards, permissions and keys, the
 * hooks of a skill's frontmatter, the step list wherever it lives, a skill or helper under its own name.
 */

const LOCAL = `${ROOT}/settings.local.json`;
const SCRIPT_BODY = '#!/bin/sh\nexit 0\n';

const SAME_LOCAL = 'read the hooks and permissions of .claude/settings.local.json as it reads settings.json';
const SAME_MEMORY = 'read every file under .claude/memory/, at any depth, as a standing file';
const SAME_STEPS = 'take a stage list from any JSON file holding a steps list, wherever the key sits';
const SAME_FRONT = 'read the hooks written in a skill frontmatter as guards, in the nested YAML form';
const SAME_UNITS = 'read the unit name from the frontmatter of every skill and helper file, in any YAML form';
const SAME_HOOKS = 'read every hook group and every command of the hooks list, not the first of each';

/** A script the guard commands run, planted free; returns its path from the project folder. */
function script(estate: PlantedEstate, _owner: string, name: string): string {
  const path = `${ROOT}/guards/${name}`;
  estate.raw(path, SCRIPT_BODY, BASE);
  return path;
}

function guardName(owner: string, index = 0): string {
  return `${tag(owner)}-${index}.sh`;
}

/** A settings-style JSON file written line by line, so each line has a number. */
function jsonFile(estate: PlantedEstate, path: string, owner: string): FileWriter {
  return estate.file(path, owner);
}

function memoryRule(estate: PlantedEstate, seed: number, owner: string, path: string): void {
  standingFree(estate);
  const { place, thing } = theme(seed, owner);
  const writer = estate.file(path, owner);
  writer.line('# Notes');
  writer.line('');
  const planted = rule(`${owner}:rule`, `Always label every ${thing} with the ${place} name.`);
  writer.line(planted.text, planted.atoms, planted.prose);
}

/** A local settings file holding one hook group for an event, the command on its own line. */
function localHook(
  estate: PlantedEstate,
  owner: string,
  event: string,
  command: string,
  hid: string,
  key: string,
): void {
  const writer = jsonFile(estate, LOCAL, owner);
  writer.line('{');
  writer.line('  "hooks": {');
  writer.line(`    ${JSON.stringify(event)}: [`);
  writer.line('      {');
  writer.line('        "matcher": "Bash",');
  writer.line('        "hooks": [');
  writer.line(`          { "type": "command", "command": ${JSON.stringify(command)} }`, [
    { hid, kind: 'guard', key },
  ]);
  writer.lines_(['        ]', '      }', '    ]', '  }', '}']);
}

function unitFront(estate: PlantedEstate, path: string, owner: string, lines: readonly string[]): FileWriter {
  const writer = estate.file(path, owner);
  writer.lines_(lines);
  return writer;
}

const CASES: Case[] = [
  {
    key: 'dot-claude-standing',
    tier: 1,
    title: 'a rule in .claude/CLAUDE.md',
    component: READER,
    cause: 'read .claude/CLAUDE.md as a standing file',
    plant: (e, s, o) => memoryRule(e, s, o, `${ROOT}/CLAUDE.md`),
  },
  {
    key: 'memory-topic-file',
    tier: 1,
    title: 'a rule in a memory file beside the memory index',
    component: READER,
    cause: SAME_MEMORY,
    plant: (e, s, o) => memoryRule(e, s, o, `${ROOT}/memory/people-${tag(o)}.md`),
  },
  {
    key: 'memory-nested-folder',
    tier: 2,
    title: 'a rule in a memory file two folders down',
    component: READER,
    cause: SAME_MEMORY,
    plant: (e, s, o) => memoryRule(e, s, o, `${ROOT}/memory/crews/night/${tag(o)}.md`),
  },
  {
    key: 'memory-index-rule',
    tier: 1,
    title: 'a rule in the memory index itself',
    component: READER,
    cause: SAME_MEMORY,
    plant: (e, s, o) => memoryRule(e, s, o, `${ROOT}/memory/MEMORY.md`),
  },
  {
    key: 'local-settings-guard',
    tier: 2,
    title: 'a guard in settings.local.json',
    component: READER,
    cause: SAME_LOCAL,
    plant: (e, _s, o) => {
      const name = guardName(o);
      localHook(e, o, 'Stop', anchored(script(e, o, name)), `${o}:guard`, name);
    },
  },
  {
    key: 'local-settings-guard-event-edge',
    tier: 3,
    title: 'the event of a guard in settings.local.json',
    component: READER,
    cause: SAME_LOCAL,
    plant: (e, _s, o) => {
      const name = guardName(o);
      localHook(e, o, 'PreToolUse', anchored(script(e, o, name)), `${o}:guard`, name);
      e.edge(o, `${o}:guard`, 'event.PreToolUse', 'event');
    },
  },
  {
    key: 'local-settings-model',
    tier: 2,
    title: 'the model named in settings.local.json',
    component: READER,
    cause: SAME_LOCAL,
    plant: (e, _s, o) => {
      const writer = jsonFile(e, LOCAL, o);
      writer.line('{');
      writer.line('  "model": "sonnet"', [{ hid: `${o}:model`, kind: 'setting', key: 'model' }]);
      writer.line('}');
    },
  },
  {
    key: 'local-settings-deny',
    tier: 2,
    title: 'a deny rule in settings.local.json',
    component: READER,
    cause: SAME_LOCAL,
    plant: (e, _s, o) => {
      const writer = jsonFile(e, LOCAL, BASE);
      writer.lines_(['{', '  "permissions": {', '    "deny": [']);
      const line = writer.line('      "Bash(rm:*)"');
      writer.lines_(['    ]', '  }', '}']);
      e.check(o, atomAt('tool', LOCAL, line));
    },
  },
  {
    key: 'ask-rule',
    tier: 2,
    title: 'an ask rule in the permissions',
    component: READER,
    cause: 'read the ask list of the permissions as it reads allow and deny',
    plant: (e, _s, o) => {
      const writer = jsonFile(e, LOCAL, BASE);
      writer.lines_(['{', '  "permissions": {', '    "ask": [']);
      const line = writer.line('      "Bash(git push:*)"');
      writer.lines_(['    ]', '  }', '}']);
      e.check(o, atomAt('tool', LOCAL, line));
    },
  },
  {
    key: 'default-mode',
    tier: 2,
    title: 'the default permission mode',
    component: READER,
    cause: 'read permissions.defaultMode as a setting',
    plant: (e, _s, o) => {
      const writer = jsonFile(e, LOCAL, BASE);
      writer.lines_(['{', '  "permissions": {']);
      const line = writer.line('    "defaultMode": "plan"');
      writer.lines_(['  }', '}']);
      e.check(o, atomAt('setting', LOCAL, line));
    },
  },
  {
    key: 'env-keys-never-values',
    tier: 3,
    title: 'every key of env as a setting and no value of it',
    component: READER,
    cause: 'read every key of the env object as a setting and keep its value out of the map',
    plant: (e, _s, o) => {
      const secret = `zq-${tag(o)}-pw`;
      const writer = jsonFile(e, LOCAL, BASE);
      writer.lines_(['{', '  "env": {']);
      const keys = ['BAKERY_API_URL', 'FERRY_DESK_TOKEN', 'LIBRARY_SHELF_CODE'];
      keys.forEach((key, index) => {
        const line = writer.line(`    "${key}": "${secret}-${index}"${index === keys.length - 1 ? '' : ','}`);
        e.check(o, atomAt('setting', LOCAL, line));
      });
      writer.lines_(['  }', '}']);
      e.check(o, (scan) =>
        JSON.stringify(scan.map).includes(secret) ? 'the value of an env key reached the map' : undefined,
      );
    },
  },
  {
    key: 'env-single-key-first-line',
    tier: 2,
    title: 'an env object written on one line',
    component: READER,
    cause: 'read the keys of an env object whatever its line layout',
    plant: (e, _s, o) => {
      const writer = jsonFile(e, LOCAL, BASE);
      writer.line('{');
      const line = writer.line(`  "env": { "HARBOUR_KEY": "zq-${tag(o)}", "KILN_MODE": "slow" }`);
      writer.line('}');
      e.check(o, atomAt('setting', LOCAL, line));
      e.check(o, (scan) =>
        scan.map.atoms.filter((a) => a.kind === 'setting' && a.provenance.file === LOCAL).length >= 2
          ? undefined
          : 'only one key of the env object was read',
      );
    },
  },
  {
    key: 'seven-events',
    tier: 2,
    title: 'seven guards on seven events, each with its event',
    component: READER,
    cause: 'read a guard for every hook event of the settings, not a fixed short list',
    plant: (e, _s, o) => {
      const events = [
        'PreToolUse',
        'PostToolUse',
        'UserPromptSubmit',
        'SessionStart',
        'PreCompact',
        'SubagentStop',
        'Stop',
      ];
      writeSettings(
        e,
        events.map((event, index) => {
          const name = guardName(o, index);
          script(e, o, name);
          return {
            owner: o,
            event,
            command: anchored(`${ROOT}/guards/${name}`),
            atoms: [{ hid: `${o}:g${index}`, kind: 'guard' as const, key: name }],
          };
        }),
      );
      for (const [index, event] of events.entries()) e.edge(o, `${o}:g${index}`, `event.${event}`, 'event');
    },
  },
  {
    key: 'two-commands-one-group',
    tier: 3,
    title: 'two commands in one hook group',
    component: READER,
    cause: SAME_HOOKS,
    plant: (e, _s, o) => {
      const [a, b] = [guardName(o, 1), guardName(o, 2)];
      script(e, o, a);
      script(e, o, b);
      const writer = jsonFile(e, LOCAL, o);
      writer.lines_(['{', '  "hooks": {', '    "PreToolUse": [', '      {', '        "matcher": "Edit",']);
      writer.line('        "hooks": [');
      writer.line(
        `          { "type": "command", "command": ${JSON.stringify(anchored(`${ROOT}/guards/${a}`))} },`,
        [{ hid: `${o}:a`, kind: 'guard', key: a }],
      );
      writer.line(
        `          { "type": "command", "command": ${JSON.stringify(anchored(`${ROOT}/guards/${b}`))} }`,
        [{ hid: `${o}:b`, kind: 'guard', key: b }],
      );
      writer.lines_(['        ]', '      }', '    ]', '  }', '}']);
    },
  },
  {
    key: 'two-groups-one-event',
    tier: 2,
    title: 'two hook groups on one event',
    component: READER,
    cause: SAME_HOOKS,
    plant: (e, _s, o) => {
      const names = [guardName(o, 1), guardName(o, 2)];
      writeSettings(
        e,
        names.map((name, index) => {
          script(e, o, name);
          return {
            owner: o,
            event: 'PreToolUse',
            matcher: index === 0 ? 'Bash' : 'Write',
            command: anchored(`${ROOT}/guards/${name}`),
            atoms: [{ hid: `${o}:g${index}`, kind: 'guard' as const, key: name }],
          };
        }),
      );
    },
  },
  {
    key: 'pipe-and-regex-matchers',
    tier: 2,
    title: 'guards whose matchers are a pipe list and a pattern',
    component: READER,
    cause: SAME_HOOKS,
    plant: (e, _s, o) => {
      const names = [guardName(o, 1), guardName(o, 2)];
      writeSettings(
        e,
        names.map((name, index) => {
          script(e, o, name);
          return {
            owner: o,
            event: 'PostToolUse',
            matcher: index === 0 ? 'Edit|Write|MultiEdit' : 'mcp__ferry__.*',
            command: anchored(`${ROOT}/guards/${name}`),
            atoms: [{ hid: `${o}:g${index}`, kind: 'guard' as const, key: name }],
          };
        }),
      );
    },
  },
  {
    key: 'skill-frontmatter-hook',
    tier: 3,
    title: 'a guard written in a skill frontmatter',
    component: READER,
    cause: SAME_FRONT,
    plant: (e, s, o) => {
      const name = guardName(o);
      const path = script(e, o, name);
      const { place } = theme(s, o);
      const folder = `${place}-desk-${tag(o)}`;
      const file = skillFile(folder, 'SKILL.md');
      const writer = e.file(file, BASE);
      writer.lines_([
        '---',
        `name: ${folder}`,
        'description: Keeps the desk tidy.',
        'hooks:',
        '  PreToolUse:',
        '    - matcher: Bash',
        '      hooks:',
        '        - type: command',
      ]);
      const line = writer.line(`          command: "$CLAUDE_PROJECT_DIR/${path}"`);
      writer.lines_(['---', '', 'Body.']);
      e.check(o, atomAt('guard', file, line));
    },
  },
  {
    key: 'skill-frontmatter-two-events',
    tier: 4,
    title: 'two events in one skill frontmatter',
    component: READER,
    cause: SAME_FRONT,
    plant: (e, s, o) => {
      const [a, b] = [guardName(o, 1), guardName(o, 2)];
      script(e, o, a);
      script(e, o, b);
      const { place } = theme(s, o);
      const folder = `${place}-gate-${tag(o)}`;
      const file = skillFile(folder, 'SKILL.md');
      const writer = e.file(file, BASE);
      writer.lines_([
        '---',
        `name: ${folder}`,
        'description: Guards a gate.',
        'hooks:',
        '  PreToolUse:',
        '    - hooks:',
      ]);
      writer.line('        - type: command');
      const first = writer.line(`          command: $CLAUDE_PROJECT_DIR/${ROOT}/guards/${a}`);
      writer.lines_(['  Stop:', '    - hooks:', '        - type: command']);
      const second = writer.line(`          command: $CLAUDE_PROJECT_DIR/${ROOT}/guards/${b}`);
      writer.lines_(['---', '', 'Body.']);
      e.check(o, atomAt('guard', file, first));
      e.check(o, atomAt('guard', file, second));
    },
  },
  {
    key: 'steps-pretty-list',
    tier: 2,
    title: 'a step list written one step to a line',
    component: READER,
    cause: SAME_STEPS,
    plant: (e, _s, o) => {
      const writer = e.file(`${ROOT}/steps.json`, BASE);
      writer.lines_([
        '{',
        '  "steps": [',
        '    "gather",',
        '    "bake",',
        '    "pack",',
        '    "deliver"',
        '  ]',
        '}',
      ]);
      e.check(o, atomsIn('stage', `${ROOT}/steps.json`, 4));
    },
  },
  {
    key: 'steps-in-renamed-file',
    tier: 3,
    title: 'a step list in a file with another name',
    component: READER,
    cause: SAME_STEPS,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const path = `${ROOT}/${place}/stages-${tag(o)}.json`;
      const writer = e.file(path, BASE);
      writer.lines_(['{', '  "steps": [', '    "load",', '    "weigh",', '    "sail"', '  ]', '}']);
      e.check(o, atomsIn('stage', path, 3));
    },
  },
  {
    key: 'steps-after-other-keys',
    tier: 3,
    title: 'a step list that is not the first key of its file',
    component: READER,
    cause: SAME_STEPS,
    plant: (e, _s, o) => {
      const path = `${ROOT}/steps.json`;
      const writer = e.file(path, BASE);
      writer.lines_([
        '{',
        '  "name": "morning run",',
        '  "version": 2,',
        '  "steps": [',
        '    "knead",',
        '    "proof",',
        '    "bake"',
        '  ]',
        '}',
      ]);
      e.check(o, atomsIn('stage', path, 3));
    },
  },
  {
    key: 'stages-key-is-no-step-list',
    tier: 3,
    title: 'a JSON file with a stages list and no steps list',
    component: READER,
    cause: 'read stage atoms only from a steps list',
    plant: (e, _s, o) => {
      const path = `${ROOT}/${tag(o)}-flow.json`;
      e.raw(path, '{\n  "stages": ["one", "two", "three"],\n  "title": "not a step list"\n}\n', o);
    },
  },
  {
    key: 'steps-is-no-list',
    tier: 3,
    title: 'a steps key that holds a text',
    component: READER,
    cause: 'read stage atoms only from a steps list',
    plant: (e, _s, o) => {
      e.raw(`${ROOT}/${tag(o)}-flow.json`, '{\n  "steps": "plan then do then verify"\n}\n', o);
    },
  },
  {
    key: 'agent-fields',
    tier: 2,
    title: 'a helper with a model, an effort and a skills list',
    component: READER,
    cause: 'read the model, effort and skills of a helper frontmatter into its atom',
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-clerk-${tag(o)}`;
      const path = helperFile(name);
      const writer = e.file(path, BASE);
      writer.lines_([
        '---',
        `name: ${name}`,
        'description: Keeps the harbour records tidy.',
        'tools: Read, Grep',
        'model: haiku',
        'effort: low',
        'skills:',
        '  - harbour-desk',
        '---',
        '',
        'You keep records.',
      ]);
      e.check(o, atomAt('subagent', path, 2));
      e.check(o, (scan) => {
        const atom = scan.map.atoms.find((a) => a.kind === 'subagent' && a.provenance.file === path);
        const text = JSON.stringify(atom?.fields ?? {});
        return text.includes('haiku') && text.includes('low') && text.includes('harbour-desk')
          ? undefined
          : `the helper atom lacks its model, effort or skills: ${text.slice(0, 160)}`;
      });
    },
  },
  {
    key: 'agent-tools-block-list',
    tier: 3,
    title: 'a helper whose tools are a YAML block list',
    component: READER,
    cause: SAME_UNITS,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-reader-${tag(o)}`;
      const path = helperFile(name);
      unitFront(e, path, BASE, [
        '---',
        `name: ${name}`,
        'description: Reads the records.',
        'tools:',
        '  - Read',
        '  - Grep',
        '---',
        '',
        'You read.',
      ]);
      e.check(o, atomAt('subagent', path, 2));
      e.check(o, (scan) => {
        const atom = scan.map.atoms.find((a) => a.kind === 'subagent' && a.provenance.file === path);
        const text = JSON.stringify(atom?.fields ?? {});
        return text.includes('Read') && text.includes('Grep')
          ? undefined
          : `the tools were not read: ${text.slice(0, 160)}`;
      });
    },
  },
  {
    key: 'twelve-helpers',
    tier: 2,
    title: 'twelve helper files',
    component: READER,
    cause: 'read every helper file of the helpers folder, not the first ones',
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      for (let index = 0; index < 12; index += 1) {
        const name = `${place}-h${index}-${tag(o)}`;
        const path = helperFile(name);
        unitFront(e, path, BASE, [
          '---',
          `name: ${name}`,
          'description: Checks records.',
          'tools: Read',
          '---',
          '',
          'You read.',
        ]);
        e.check(o, atomAt('subagent', path, 2));
      }
    },
  },
  {
    key: 'twelve-skills',
    tier: 2,
    title: 'twelve skill folders',
    component: READER,
    cause: 'read every skill folder of the skills folder, not the first ones',
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      for (let index = 0; index < 12; index += 1) {
        const name = `${place}-s${index}-${tag(o)}`;
        const path = skillFile(name, 'SKILL.md');
        unitFront(e, path, BASE, ['---', `name: ${name}`, 'description: Counts crates.', '---', '', 'Body.']);
        e.check(o, atomAt('skill', path, 2));
        e.check(o, atomAt('route', path, 3));
      }
    },
  },
  {
    key: 'name-differs-from-folder',
    tier: 2,
    title: 'a skill whose name differs from its folder',
    component: READER,
    cause: SAME_UNITS,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const folder = `old-${tag(o)}`;
      const name = `${place}-rota-${tag(o)}`;
      const path = skillFile(folder, 'SKILL.md');
      e.file(path, o).lines_([
        '---',
        `name: ${name}`,
        'description: Plans the weekly rota.',
        '---',
        '',
        'Body.',
      ]);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: name });
    },
  },
  {
    key: 'crlf-skill',
    tier: 3,
    title: 'a skill file with carriage returns',
    component: READER,
    cause: 'split every file on carriage returns as well as line feeds before reading its frontmatter',
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-crew-${tag(o)}`;
      const path = skillFile(name, 'SKILL.md');
      e.raw(
        path,
        ['---', `name: ${name}`, 'description: Plans the crew.', '---', '', 'Body.', ''].join('\r\n'),
        o,
      );
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: name });
    },
  },
  {
    key: 'bom-skill',
    tier: 3,
    title: 'a skill file that starts with a byte order mark',
    component: READER,
    cause: 'drop a byte order mark before reading the frontmatter of any file',
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-oven-${tag(o)}`;
      const path = skillFile(name, 'SKILL.md');
      e.raw(path, `﻿---\nname: ${name}\ndescription: Times the oven.\n---\n\nBody.\n`, o);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: name });
    },
  },
  {
    key: 'quoted-frontmatter-values',
    tier: 3,
    title: 'a skill whose name and description are quoted and hold a colon',
    component: READER,
    cause: SAME_UNITS,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-notes-${tag(o)}`;
      const path = skillFile(name, 'SKILL.md');
      e.file(path, o).lines_([
        '---',
        `name: "${name}"`,
        'description: "Keeps notes: one per shift."',
        '---',
        '',
        'Body.',
      ]);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: name });
    },
  },
  {
    key: 'unicode-skill-name',
    tier: 4,
    title: 'a skill named with accented letters',
    component: READER,
    cause: SAME_UNITS,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-crème-${tag(o)}`;
      const path = skillFile(`${place}-creme-${tag(o)}`, 'SKILL.md');
      e.file(path, o).lines_(['---', `name: ${name}`, 'description: Whips the crème.', '---', '', 'Body.']);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 2, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 3, key: name });
    },
  },
  {
    key: 'description-after-allowed-tools',
    tier: 2,
    title: 'a skill whose description comes after its tools',
    component: READER,
    cause: SAME_UNITS,
    plant: (e, s, o) => {
      const { place } = theme(s, o);
      const name = `${place}-lamp-${tag(o)}`;
      const path = skillFile(name, 'SKILL.md');
      e.file(path, o).lines_([
        '---',
        'allowed-tools: Read, Grep',
        `name: ${name}`,
        'description: Trims the lamp.',
        '---',
        '',
        'Body.',
      ]);
      e.expect(o, { hid: `${o}:skill`, kind: 'skill', file: path, line: 3, key: name });
      e.expect(o, { hid: `${o}:route`, kind: 'route', file: path, line: 4, key: name });
    },
  },
  {
    key: 'standing-file-root-only-once',
    tier: 1,
    title: 'a rule in the standing file and a different rule in the dot-claude one',
    component: READER,
    cause: 'read .claude/CLAUDE.md as a standing file',
    plant: (e, s, o) => {
      const { place, thing } = theme(s, o);
      const first = e.file(STANDING, o);
      first.lines_(['# Planted estate', '']);
      const one = rule(`${o}:one`, `Always weigh every ${thing} before the ${place} opens.`);
      first.line(one.text, one.atoms, one.prose);
      const second = e.file(`${ROOT}/CLAUDE.md`, o);
      second.lines_(['# More', '']);
      const two = rule(`${o}:two`, `Never leave a ${thing} outside the ${place} after dark.`);
      second.line(two.text, two.atoms, two.prose);
    },
  },
  {
    key: 'no-atom-from-guard-scripts',
    tier: 2,
    title: 'a guard script with a rule-like sentence and finds no instruction in it',
    component: READER,
    cause: 'read prose atoms only from standing, memory, skill and helper files',
    plant: (e, _s, o) => {
      const name = guardName(o);
      e.raw(
        `${ROOT}/guards/${name}`,
        '#!/bin/sh\n# Always read the ledger before you edit it.\nexit 0\n',
        BASE,
      );
      writeSettings(e, [
        {
          owner: BASE,
          event: 'Stop',
          command: anchored(`${ROOT}/guards/${name}`),
          atoms: [],
        },
      ]);
      e.check(o, noAtomOn('instruction', `${ROOT}/guards/${name}`, [1, 2, 3]));
    },
  },
];

export function layoutFamily(): Family {
  return caseFamily('blind.layout', READER, CASES, 'the reader reads');
}
