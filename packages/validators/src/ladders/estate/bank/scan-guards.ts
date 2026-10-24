import { ANCHOR, ANCHOR_BARE, GUARDS_DIR, ROOT, STANDING } from '../layout';
import { plantedHeader, plantedOffState } from '../registry-record';
import { type GuardLine, namesFor, order, rule, writeSettings } from './common';
import { DISPATCH_BY_ARGUMENT, DISPATCH_BY_FLAG, SUBCOMMAND_TOOL } from './dispatch-fixtures';
import { type Family, itemsOf, type Tier } from './frame';
import { fieldIs, PlantedEstate } from './planted';

/**
 * Two families of guard reading.
 *
 * scan.catalogue: a catalogue file that lists the checks of an estate (a JSON or YAML document an estate
 * keeps beside its guards, under names other than "registry"). The oracle: the guard it lists enforces the
 * rules the entry names, and the guard records the entry's id.
 *
 * scan.dispatcher: the command forms a guard is declared with (a quiet-switch prefix, a change of folder, an
 * environment assignment, a time limit, a runner, a shell wrapper, a dispatcher script given the target's
 * name). The oracle: the guard is named after the script that does the work, finds that script, and is
 * anchored when the command reaches it from the project folder.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';
const CODE = 'packages/estate/src/scan/code.ts';

// scan.catalogue ------------------------------------------------------------------------------------------

type Entry = { id: string; guard: string; labels: string[] };
type CatalogueShape = {
  key: string;
  tier: Tier;
  title: string;
  file: string;
  /** The entry is planted in a state under which it enforces nothing: the planter records the value as off. */
  off?: boolean;
  lines(entry: Entry): string[];
};

const json = (value: unknown) => JSON.stringify(value);
const checks = (entry: Entry, guardKey = 'hook', rulesKey = 'rules', rules: unknown = entry.labels) => [
  '{',
  '  "checks": [',
  `    ${json({ id: entry.id, [guardKey]: entry.guard, event: 'PreToolUse', [rulesKey]: rules, mode: 'enforce' })}`,
  '  ]',
  '}',
];

/** The state value planted as off: not an English word, and no code or label list holds it. */
const OFF_VALUE = 'arrêté';

const CATALOGUES: CatalogueShape[] = [
  {
    key: 'upper-json',
    tier: 3,
    title: 'CATALOGUE.json with checks',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e),
  },
  { key: 'lower-json', tier: 3, title: 'catalogue.json', file: 'catalogue.json', lines: (e) => checks(e) },
  { key: 'american-spelling', tier: 3, title: 'catalog.json', file: 'catalog.json', lines: (e) => checks(e) },
  {
    key: 'prefixed-name',
    tier: 3,
    title: 'a checks-catalogue.json',
    file: 'checks-catalogue.json',
    lines: (e) => checks(e),
  },
  {
    key: 'in-hooks-folder',
    tier: 3,
    title: 'a catalogue in the hooks folder',
    file: 'hooks/CATALOGUE.json',
    lines: (e) => checks(e),
  },
  {
    key: 'yaml',
    tier: 4,
    title: 'a YAML catalogue',
    file: 'CATALOGUE.yaml',
    lines: (e) => [
      'checks:',
      `  - id: ${e.id}`,
      `    hook: ${e.guard}`,
      `    rules: [${e.labels.join(', ')}]`,
    ],
  },
  {
    key: 'hooks-key',
    tier: 3,
    title: 'entries under a hooks key',
    file: 'CATALOGUE.json',
    lines: (e) => [
      '{',
      '  "hooks": [',
      `    ${json({ id: e.id, hook: e.guard, rules: e.labels })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'entries-key',
    tier: 3,
    title: 'entries under an entries key',
    file: 'CATALOGUE.json',
    lines: (e) => [
      '{',
      '  "entries": [',
      `    ${json({ id: e.id, hook: e.guard, rules: e.labels })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'keyed-by-id',
    tier: 4,
    title: 'entries keyed by their id',
    file: 'CATALOGUE.json',
    lines: (e) => ['{', `  ${json(e.id)}: ${json({ hook: e.guard, rules: e.labels })}`, '}'],
  },
  {
    key: 'by-event',
    tier: 4,
    title: 'entries grouped by event',
    file: 'CATALOGUE.json',
    lines: (e) => [
      '{',
      '  "PreToolUse": [',
      `    ${json({ id: e.id, hook: e.guard, rules: e.labels })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'wrapped',
    tier: 3,
    title: 'a version wrapper around the checks',
    file: 'CATALOGUE.json',
    lines: (e) => [
      '{',
      '  "version": 2,',
      '  "catalogue": {',
      '    "checks": [',
      `      ${json({ id: e.id, hook: e.guard, rules: e.labels })}`,
      '    ]',
      '  }',
      '}',
    ],
  },
  {
    key: 'guard-script-key',
    tier: 3,
    title: 'the guard under a script key',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e, 'script'),
  },
  {
    key: 'guard-file-key',
    tier: 3,
    title: 'the guard under a file key',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e, 'file'),
  },
  {
    key: 'guard-path-key',
    tier: 3,
    title: 'the guard by its path',
    file: 'CATALOGUE.json',
    lines: (e) => checks({ ...e, guard: `${GUARDS_DIR}/${e.guard}` }, 'path'),
  },
  {
    key: 'guard-command-key',
    tier: 4,
    title: 'the guard by its command',
    file: 'CATALOGUE.json',
    lines: (e) => checks({ ...e, guard: `python3 ${ANCHOR}/${GUARDS_DIR}/${e.guard}` }, 'command'),
  },
  {
    key: 'enforces-key',
    tier: 3,
    title: 'the rules under an enforces key',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e, 'hook', 'enforces'),
  },
  {
    key: 'gates-key',
    tier: 3,
    title: 'the rules under a gates key',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e, 'hook', 'gates'),
  },
  {
    key: 'rules-string',
    tier: 3,
    title: 'the rules as one string',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e, 'hook', 'rules', e.labels.join(', ')),
  },
  {
    key: 'rules-objects',
    tier: 4,
    title: 'the rules as objects with ids',
    file: 'CATALOGUE.json',
    lines: (e) =>
      checks(
        e,
        'hook',
        'rules',
        e.labels.map((id) => ({ id })),
      ),
  },
  {
    key: 'two-rules',
    tier: 3,
    title: 'an entry naming two rules',
    file: 'CATALOGUE.json',
    lines: (e) => checks(e),
  },
  {
    key: 'pretty',
    tier: 3,
    title: 'a pretty-printed catalogue',
    file: 'CATALOGUE.json',
    lines: (e) => [
      '{',
      '  "checks": [',
      '    {',
      `      "id": ${json(e.id)},`,
      `      "hook": ${json(e.guard)},`,
      `      "rules": ${json(e.labels)}`,
      '    }',
      '  ]',
      '}',
    ],
  },
  {
    key: 'off-state',
    tier: 3,
    title: 'a check in an off state, which enforces nothing, beside one that is on',
    file: 'CATALOGUE.json',
    off: true,
    lines: (e) => [
      '{',
      '  "checks": [',
      `    ${json({ id: e.id, event: 'PreToolUse', status: plantedOffState(OFF_VALUE), watches: e.labels })},`,
      `    ${json({ id: `${e.id}-on`, event: 'PreToolUse', status: 'actif', watches: e.labels })}`,
      '  ]',
      '}',
    ],
  },
  {
    key: 'markdown-table',
    tier: 4,
    title: 'a markdown catalogue table',
    file: 'CATALOGUE.md',
    lines: (e) => [
      '# Catalogue',
      '',
      plantedHeader([
        ['id', 'Id'],
        ['guard', 'Hook'],
        ['enforces', 'Rules'],
      ]),
      '|---|---|---|',
      `| ${e.id} | ${e.guard} | ${e.labels.join(', ')} |`,
    ],
  },
];

export function catalogueFamily(): Family {
  const family = 'scan.catalogue';
  const items = itemsOf(
    family,
    1,
    READER,
    CATALOGUES.map(({ key, tier, title }) => ({ key, tier, title: `the reader reads ${title}` })),
  );
  return {
    id: family,
    level: 1,
    component: READER,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      const standing = estate.file(STANDING, 'base');
      standing.line('# Planted estate');
      standing.line('');
      const guards: GuardLine[] = [];
      let label = 0;
      CATALOGUES.forEach((shape, index) => {
        const owner = `${family}.${shape.key}`;
        const names = namesFor(seed, owner);
        const labels: string[] = [];
        for (let n = 0; n < (shape.key === 'two-rules' ? 2 : 1); n += 1) {
          label += 1;
          const text = `Always ${names.verb} a ${names.noun} before noon, entry ${index}-${n}.`;
          const planted = rule(`${owner}:rule${n}`, text);
          standing.owner = owner;
          standing.line(`- **R${label}.** ${text}`, planted.atoms, planted.prose);
          labels.push(`R${label}`);
          if (!shape.off) estate.edge(owner, `${owner}:guard`, `${owner}:rule${n}`, 'enforces');
        }
        standing.owner = 'base';
        const guard = `${names.skill}.py`;
        estate.raw(`${GUARDS_DIR}/${guard}`, '#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n', owner);
        guards.push({
          owner,
          event: 'PreToolUse',
          matcher: 'Bash',
          command: `python3 ${ANCHOR}/${GUARDS_DIR}/${guard}`,
          atoms: [{ hid: `${owner}:guard`, kind: 'guard', key: guard }],
        });
        const entry: Entry = { id: `C${index + 1}`, guard, labels };
        const file = shape.file.includes('/')
          ? `${ROOT}/${shape.file.replace(/\/([^/]+)$/, `/${names.noun}${index}-$1`)}`
          : `${GUARDS_DIR}/${names.noun}${index}-${shape.file}`;
        estate.file(file, owner).lines_(shape.lines(entry));
        if (shape.off) {
          // The two entries are two checks the scan reads as guards of their own, on lines 3 and 4 of the file.
          estate.expect(owner, { hid: `${owner}:check-off`, kind: 'guard', file, line: 3, key: entry.id });
          estate.expect(owner, {
            hid: `${owner}:check-on`,
            kind: 'guard',
            file,
            line: 4,
            key: `${entry.id}-on`,
          });
          estate.check(owner, (scanned) => {
            const rows = scanned.raw.registry.filter(
              (row) => row.id === entry.id || row.id === `${entry.id}-on`,
            );
            const off = rows.find((row) => row.id === entry.id);
            const on = rows.find((row) => row.id === `${entry.id}-on`);
            if (!off || !on) return `the catalogue rows of ${entry.id} were not read`;
            if (off.enforces.length > 0)
              return `${entry.id} is in an off state and still enforces ${off.enforces.length} rule(s)`;
            if (on.enforces.length === 0) return `${entry.id}-on is on and enforces nothing`;
            return undefined;
          });
        } else estate.check(owner, fieldIs(`${owner}:guard`, 'registry', entry.id));
      });
      writeSettings(estate, order(seed, family, guards));
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}

// scan.dispatcher -----------------------------------------------------------------------------------------

type Command = {
  key: string;
  tier: Tier;
  title: string;
  /** The command for a script path; the script the work happens in, relative to the root. */
  command(script: string, name: string): string;
  /** The script the guard names: by default the planted one. */
  target?: (script: string, name: string) => string;
  anchored: boolean;
  extension?: string;
  /** Files the form needs beside the target script. */
  extra?: (name: string) => Record<string, string>;
  /**
   * A second guard of the same estate whose argument is no script: a plain subcommand of a tool. The reader names
   * the tool as the script and leaves the subcommand alone.
   */
  control?: { tool: string; command: string; text: string };
};

/** Each dispatcher form has a script of its own: a form shares no path, so none inherits another's source. */
const DISPATCHER = (key: string) => `${ROOT}/hooks/lib/run-${key}.py`;
const SUBCOMMAND_PATH = `${ROOT}/hooks/lib/cli.py`;

const COMMANDS: Command[] = [
  {
    key: 'quoted-anchor',
    tier: 1,
    title: 'the quoted project anchor',
    command: (s) => `${ANCHOR}/${s}`,
    anchored: true,
    extension: 'sh',
  },
  {
    key: 'interpreter-anchor',
    tier: 1,
    title: 'an interpreter and the anchor',
    command: (s) => `python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'braced-anchor',
    tier: 1,
    title: 'the anchor in braces',
    command: (s) => `python3 \${CLAUDE_PROJECT_DIR}/${s}`,
    anchored: true,
  },
  {
    key: 'bare-anchor',
    tier: 1,
    title: 'the anchor unquoted',
    command: (s) => `python3 ${ANCHOR_BARE}/${s}`,
    anchored: true,
  },
  {
    key: 'relative',
    tier: 1,
    title: 'a path from the working folder',
    command: (s) => `python3 ${s}`,
    anchored: false,
  },
  {
    key: 'flag-before',
    tier: 2,
    title: 'an interpreter flag before the script',
    command: (s) => `python3 -u ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'arguments-after',
    tier: 1,
    title: 'arguments after the script',
    command: (s) => `python3 ${ANCHOR}/${s} --mode strict`,
    anchored: true,
  },
  {
    key: 'node',
    tier: 1,
    title: 'a node script',
    command: (s) => `node ${ANCHOR}/${s}`,
    anchored: true,
    extension: 'mjs',
  },
  {
    key: 'shell-runner',
    tier: 1,
    title: 'a shell running a script',
    command: (s) => `sh ${ANCHOR}/${s}`,
    anchored: true,
    extension: 'sh',
  },
  {
    key: 'whole-quoted',
    tier: 2,
    title: 'the whole path quoted',
    command: (s) => `"${ANCHOR_BARE}/${s}"`,
    anchored: true,
    extension: 'sh',
  },
  {
    key: 'plugin-anchor',
    tier: 2,
    title: 'the plugin root anchor',
    command: (s) => `python3 \${CLAUDE_PLUGIN_ROOT}/${s}`,
    anchored: true,
  },
  {
    key: 'quiet-prefix',
    tier: 3,
    title: 'a quiet-switch prefix before the command',
    command: (s) => `[ "$QUIET_GUARDS" = "$PPID" ] || python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'test-prefix',
    tier: 3,
    title: 'a test prefix before the command',
    command: (s) => `test -n "$CI" || python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'change-folder',
    tier: 3,
    title: 'a change into the project folder first',
    command: (s) => `cd ${ANCHOR} && python3 ${s}`,
    anchored: true,
  },
  {
    key: 'env-runner',
    tier: 3,
    title: 'an environment runner with an assignment',
    command: (s) => `env MODE=strict python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'assignment-prefix',
    tier: 3,
    title: 'a bare assignment before the interpreter',
    command: (s) => `PYTHONPATH=${ANCHOR} python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'time-limit',
    tier: 3,
    title: 'a time limit before the interpreter',
    command: (s) => `timeout 5 python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'exec',
    tier: 3,
    title: 'exec before the interpreter',
    command: (s) => `exec python3 ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'uv-run',
    tier: 3,
    title: 'a package runner',
    command: (s) => `uv run ${ANCHOR}/${s}`,
    anchored: true,
  },
  {
    key: 'shell-wrapper',
    tier: 4,
    title: 'a shell wrapper with a quoted command',
    command: (s) => `bash -c 'python3 ${ANCHOR}/${s}'`,
    anchored: true,
  },
  {
    key: 'dispatcher',
    tier: 4,
    title: 'a dispatcher script given the target name',
    command: (_s, name) => `python3 ${ANCHOR}/${DISPATCHER('dispatcher')} ${name}`,
    target: (_s, name) => `${ROOT}/hooks/${name}.py`,
    anchored: true,
    extra: () => ({ [DISPATCHER('dispatcher')]: DISPATCH_BY_ARGUMENT }),
    control: {
      tool: SUBCOMMAND_PATH,
      command: `python3 ${ANCHOR}/${SUBCOMMAND_PATH} check`,
      text: SUBCOMMAND_TOOL,
    },
  },
  {
    key: 'dispatcher-with-prefix',
    tier: 5,
    title: 'a quiet-switch prefix and a dispatcher',
    command: (_s, name) =>
      `[ "$QUIET_GUARDS" = "$PPID" ] || python3 ${ANCHOR}/${DISPATCHER('dispatcher-with-prefix')} ${name}`,
    target: (_s, name) => `${ROOT}/hooks/${name}.py`,
    anchored: true,
    extra: () => ({ [DISPATCHER('dispatcher-with-prefix')]: DISPATCH_BY_ARGUMENT }),
  },
  {
    key: 'dispatcher-flag',
    tier: 5,
    title: 'a dispatcher given the target by a flag',
    command: (_s, name) => `python3 ${ANCHOR}/${DISPATCHER('dispatcher-flag')} --hook ${name}`,
    target: (_s, name) => `${ROOT}/hooks/${name}.py`,
    anchored: true,
    extra: () => ({ [DISPATCHER('dispatcher-flag')]: DISPATCH_BY_FLAG }),
  },
  {
    key: 'home-path',
    tier: 2,
    title: 'a path from the home folder',
    command: (s) => `python3 ~/${s}`,
    target: (s) => `~/${s}`,
    anchored: true,
  },
];

export function dispatcherFamily(): Family {
  const family = 'scan.dispatcher';
  const items = itemsOf(
    family,
    1,
    CODE,
    COMMANDS.map(({ key, tier, title }) => ({
      key,
      tier,
      title: `a guard declared with ${title} names and finds its script`,
    })),
  );
  return {
    id: family,
    level: 1,
    component: CODE,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      estate.file(STANDING, 'base').line('# Planted estate');
      const guards: GuardLine[] = [];
      for (const form of COMMANDS) {
        const owner = `${family}.${form.key}`;
        const name = namesFor(seed, owner).skill;
        const script = `${GUARDS_DIR}/${name}.${form.extension ?? 'py'}`;
        const target = form.target ? form.target(script, name) : script;
        const file = target.startsWith('~/') ? script : target;
        estate.raw(file, '#!/bin/sh\nexit 0\n', owner);
        for (const [path, text] of Object.entries(form.extra?.(name) ?? {})) {
          if (!estate.raws.has(path)) estate.raw(path, text, 'base');
        }
        const base = target.split('/').pop() as string;
        guards.push({
          owner,
          event: 'PreToolUse',
          matcher: 'Bash',
          command: form.command(script, name),
          atoms: [{ hid: `${owner}:guard`, kind: 'guard', key: base }],
        });
        estate.check(owner, fieldIs(`${owner}:guard`, 'script', target));
        estate.check(owner, fieldIs(`${owner}:guard`, 'anchored', form.anchored));
        if (form.control) {
          estate.raw(form.control.tool, form.control.text, owner);
          guards.push({
            owner,
            event: 'PreToolUse',
            matcher: 'Bash',
            command: form.control.command,
            atoms: [
              { hid: `${owner}:control`, kind: 'guard', key: form.control.tool.split('/').pop() as string },
            ],
          });
          estate.check(owner, fieldIs(`${owner}:control`, 'script', form.control.tool));
        }
      }
      writeSettings(estate, order(seed, family, guards));
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}
