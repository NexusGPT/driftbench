import { ROOT, STANDING, skillFile } from '../../layout';
import { anchored, rule, writeSettings } from '../common';
import type { Family } from '../frame';
import { type Case, caseFamily } from '../hostile';
import { BASE, type Check, type PlantedEstate } from '../planted';
import { CODE, edgeBetween, freeHelper, freeSkill, standingFree, tag, theme } from './util';

/**
 * blind.edges: the edges the docs say code decides: which guard enforces which rule and by which of the
 * three methods, which rule cites which by label, which skill allows which tool, which stage follows which,
 * and which skill or helper dispatches which helper. The planting spells each form as the docs name it.
 */

const SAME_ENFORCE = 'give a guard an enforces edge for every rule its registry row or its source names';
const SAME_CITES = 'give a rule a cites edge for every label its words name';
const SAME_ALLOWS = 'give a skill or helper an allows edge for every tool it declares, in every YAML form';
const SAME_DISPATCH = 'give a skill or helper a dispatch edge for every helper its body names';

function names(seed: number, owner: string): { thing: string; place: string; guard: string } {
  const { place, thing } = theme(seed, owner);
  return { place, thing, guard: `${tag(owner)}.sh` };
}

type Rule = { hid: string; label: string; text: string };

/** The standing file with the rules, each on a labelled bullet. Returns the rules. */
function labelled(e: PlantedEstate, owner: string, texts: readonly string[]): Rule[] {
  const writer = e.file(STANDING, owner);
  writer.lines_(['# Planted estate', '']);
  return texts.map((text, index) => {
    const label = `R${index + 1}`;
    const hid = `${owner}:${label}`;
    const planted = rule(hid, text);
    writer.line(`- **${label}.** ${planted.text}`, planted.atoms, planted.prose);
    return { hid, label, text };
  });
}

function guardOnStop(e: PlantedEstate, owner: string, script: string, hid: string): string {
  writeSettings(e, [
    {
      owner,
      event: 'Stop',
      command: anchored(`${ROOT}/guards/${script}`),
      atoms: [{ hid, kind: 'guard', key: script }],
    },
  ]);
  return script;
}

function twoGuards(e: PlantedEstate, owner: string, scripts: readonly string[]): void {
  writeSettings(
    e,
    scripts.map((script, index) => ({
      owner,
      event: 'Stop',
      command: anchored(`${ROOT}/guards/${script}`),
      atoms: [{ hid: `${owner}:g${index}`, kind: 'guard' as const, key: script }],
    })),
  );
}

function registryRows(e: PlantedEstate, rows: ReadonlyArray<[string, string, string]>): void {
  e.raw(
    `${ROOT}/guards/CHECK-REGISTRY.md`,
    [
      '| Id | Guard | Enforces |',
      '|---|---|---|',
      ...rows.map(([id, guard, rules]) => `| ${id} | ${guard} | ${rules} |`),
      '',
    ].join('\n'),
    BASE,
  );
}

/** Counts the edges of a kind that leave atoms of a file. */
function edgesOf(kind: string, file: string, count: number, endKind?: string): Check {
  return (scan) => {
    const from = new Set(
      scan.map.atoms.filter((atom) => atom.provenance.file === file).map((atom) => atom.id),
    );
    const found = scan.map.edges.filter((edge) => {
      if (edge.kind !== kind || !from.has(edge.from)) return false;
      return endKind === undefined || scan.atomOf.get(edge.to)?.kind === endKind;
    });
    return found.length === count
      ? undefined
      : `${found.length} ${kind} edges leave ${file}, expected ${count}`;
  };
}

function dispatching(
  key: string,
  tier: 1 | 2 | 3 | 4,
  title: string,
  text: (helper: string) => string,
): Case {
  return {
    key,
    tier,
    title,
    component: CODE,
    cause: SAME_DISPATCH,
    plant: (e, s, o) => {
      const helper = `${theme(s, o).place}-scout-${tag(o)}`;
      standingFree(e);
      freeSkill(e, `${theme(s, o).place}-plan-${tag(o)}`, 'Plans the day.', [text(helper)]);
      freeHelper(e, helper, ['You read.']);
      const path = skillFile(`${theme(s, o).place}-plan-${tag(o)}`, 'SKILL.md');
      e.check(o, edgeBetween('dispatch', { kind: 'skill', file: path }, { kind: 'subagent', name: helper }));
    },
  };
}

const CASES: Case[] = [
  {
    key: 'enforce-registry-two-labels',
    tier: 3,
    title: 'a registry row that lists two rule labels',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing, guard } = names(s, o);
      const rules = labelled(e, o, [
        `Never ship a ${thing} without a label.`,
        `Always weigh a ${thing} twice before it leaves.`,
        `Keep every ${thing} receipt for a year.`,
      ]);
      guardOnStop(e, o, guard, `${o}:guard`);
      e.raw(`${ROOT}/guards/${guard}`, '#!/bin/sh\nexit 0\n', BASE);
      registryRows(e, [['G1', guard, 'R1, R3']]);
      e.edge(o, `${o}:guard`, (rules[0] as Rule).hid, 'enforces');
      e.edge(o, `${o}:guard`, (rules[2] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'enforce-registry-second-row',
    tier: 2,
    title: 'a registry whose second row names the second guard and its rule',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing } = names(s, o);
      const rules = labelled(e, o, [
        `Never ship a ${thing} without a label.`,
        `Always weigh a ${thing} twice before it leaves.`,
      ]);
      const scripts = [`${tag(o)}-a.sh`, `${tag(o)}-b.sh`];
      for (const script of scripts) e.raw(`${ROOT}/guards/${script}`, '#!/bin/sh\nexit 0\n', BASE);
      twoGuards(e, o, scripts);
      registryRows(e, [
        ['G1', scripts[0] as string, 'R1'],
        ['G2', scripts[1] as string, 'R2'],
      ]);
      e.edge(o, `${o}:g0`, (rules[0] as Rule).hid, 'enforces');
      e.edge(o, `${o}:g1`, (rules[1] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'enforce-registry-quoted-passage',
    tier: 4,
    title: 'a registry row that quotes the rule instead of naming its label',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing, guard } = names(s, o);
      const text = `Never ship a ${thing} without a label.`;
      const rules = labelled(e, o, [text]);
      guardOnStop(e, o, guard, `${o}:guard`);
      e.raw(`${ROOT}/guards/${guard}`, '#!/bin/sh\nexit 0\n', BASE);
      registryRows(e, [['G1', guard, `"${text}"`]]);
      e.edge(o, `${o}:guard`, (rules[0] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'enforce-source-declares-label',
    tier: 3,
    title: 'a guard source that declares the label it enforces',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing, guard } = names(s, o);
      const rules = labelled(e, o, [
        `Never ship a ${thing} without a label.`,
        `Always weigh a ${thing} twice.`,
      ]);
      guardOnStop(e, o, guard, `${o}:guard`);
      e.raw(`${ROOT}/guards/${guard}`, '#!/bin/sh\n# Enforces: R2\nexit 0\n', BASE);
      e.edge(o, `${o}:guard`, (rules[1] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'enforce-source-declares-list',
    tier: 3,
    title: 'a guard source that declares two labels in a list',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing, guard } = names(s, o);
      const rules = labelled(e, o, [
        `Never ship a ${thing} without a label.`,
        `Always weigh a ${thing} twice.`,
        `Keep every ${thing} receipt.`,
      ]);
      guardOnStop(e, o, guard, `${o}:guard`);
      e.raw(`${ROOT}/guards/${guard}`, '#!/bin/sh\n# Enforces: R1, R3\nexit 0\n', BASE);
      e.edge(o, `${o}:guard`, (rules[0] as Rule).hid, 'enforces');
      e.edge(o, `${o}:guard`, (rules[2] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'enforce-source-repeats-quote',
    tier: 3,
    title: 'a guard source that repeats a rule in its own words of 16 characters or more',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing, guard } = names(s, o);
      const text = `Never ship a ${thing} without a label.`;
      const rules = labelled(e, o, [text, `Always weigh a ${thing} twice.`]);
      guardOnStop(e, o, guard, `${o}:guard`);
      e.raw(`${ROOT}/guards/${guard}`, `#!/bin/sh\necho "denied: ${text}"\nexit 2\n`, BASE);
      e.edge(o, `${o}:guard`, (rules[0] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'enforce-source-python-comment',
    tier: 4,
    title: 'a guard written in python that declares its label in a docstring',
    component: CODE,
    cause: SAME_ENFORCE,
    plant: (e, s, o) => {
      const { thing } = names(s, o);
      const guard = `${tag(o)}.py`;
      const rules = labelled(e, o, [`Never ship a ${thing} without a label.`]);
      writeSettings(e, [
        {
          owner: o,
          event: 'Stop',
          command: anchored(`${ROOT}/guards/${guard}`, 'python3'),
          atoms: [{ hid: `${o}:guard`, kind: 'guard', key: guard }],
        },
      ]);
      e.raw(
        `${ROOT}/guards/${guard}`,
        '"""Checks the labels.\n\nEnforces: R1\n"""\nimport sys\nsys.exit(0)\n',
        BASE,
      );
      e.edge(o, `${o}:guard`, (rules[0] as Rule).hid, 'enforces');
    },
  },
  {
    key: 'cites-one-label',
    tier: 3,
    title: 'a rule whose words name another rule by its label',
    component: CODE,
    cause: SAME_CITES,
    plant: (e, s, o) => {
      const { thing } = names(s, o);
      const rules = labelled(e, o, [`Always weigh a ${thing} twice.`, `Keep the receipt as R1 asks.`]);
      e.edge(o, (rules[1] as Rule).hid, (rules[0] as Rule).hid, 'cites');
    },
  },
  {
    key: 'cites-two-labels',
    tier: 3,
    title: 'a rule whose words name two rules by their labels',
    component: CODE,
    cause: SAME_CITES,
    plant: (e, s, o) => {
      const { thing } = names(s, o);
      const rules = labelled(e, o, [
        `Always weigh a ${thing} twice.`,
        `Never ship a ${thing} without a label.`,
        'Obey R1 and R2 before any late delivery.',
      ]);
      e.edge(o, (rules[2] as Rule).hid, (rules[0] as Rule).hid, 'cites');
      e.edge(o, (rules[2] as Rule).hid, (rules[1] as Rule).hid, 'cites');
    },
  },
  {
    key: 'cites-unknown-label',
    tier: 3,
    title: 'a rule that names a label no rule holds and finds no cites edge',
    component: CODE,
    cause: 'cite a rule only when a rule with that label exists in the estate',
    plant: (e, s, o) => {
      const { thing } = names(s, o);
      labelled(e, o, [`Always weigh a ${thing} twice.`, 'Keep the receipt as R9 asks.']);
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'cites')
          ? 'a cites edge to a label that no rule holds'
          : undefined,
      );
    },
  },
  {
    key: 'cites-label-inside-word',
    tier: 4,
    title: 'a rule with words that end in a label-like letter and digit and finds no cites edge',
    component: CODE,
    cause: 'match a rule label as a whole word',
    plant: (e, s, o) => {
      const { thing } = names(s, o);
      labelled(e, o, [
        `Always weigh a ${thing} twice.`,
        'Print the BR1 barcode on the crate and the XR1 sticker beside it.',
      ]);
      e.check(o, (scan) =>
        scan.map.edges.some((edge) => edge.kind === 'cites')
          ? 'a cites edge from a code that holds the label as part of a word'
          : undefined,
      );
    },
  },
  {
    key: 'allows-comma-list',
    tier: 2,
    title: 'a skill that declares two tools in a comma list',
    component: CODE,
    cause: SAME_ALLOWS,
    plant: (e, s, o) => {
      standingFree(e);
      const name = `${theme(s, o).place}-tools-${tag(o)}`;
      const path = skillFile(name, 'SKILL.md');
      e.file(path, BASE).lines_([
        '---',
        `name: ${name}`,
        'description: Uses tools.',
        'allowed-tools: Read, Grep',
        '---',
        '',
        'Body.',
      ]);
      e.check(o, edgesOf('allows', path, 2, 'tool'));
    },
  },
  {
    key: 'allows-block-list',
    tier: 3,
    title: 'a skill that declares two tools as a YAML list',
    component: CODE,
    cause: SAME_ALLOWS,
    plant: (e, s, o) => {
      standingFree(e);
      const name = `${theme(s, o).place}-tools-${tag(o)}`;
      const path = skillFile(name, 'SKILL.md');
      e.file(path, BASE).lines_([
        '---',
        `name: ${name}`,
        'description: Uses tools.',
        'allowed-tools:',
        '  - Read',
        '  - Grep',
        '---',
        '',
        'Body.',
      ]);
      e.check(o, edgesOf('allows', path, 2, 'tool'));
    },
  },
  {
    key: 'allows-helper-tools',
    tier: 2,
    title: 'a helper that declares three tools',
    component: CODE,
    cause: SAME_ALLOWS,
    plant: (e, s, o) => {
      standingFree(e);
      const name = `${theme(s, o).place}-clerk-${tag(o)}`;
      const path = `${ROOT}/agents/${name}.md`;
      e.file(path, BASE).lines_([
        '---',
        `name: ${name}`,
        'description: Reads.',
        'tools: Read, Grep, Glob',
        '---',
        '',
        'You read.',
      ]);
      e.check(o, edgesOf('allows', path, 3, 'tool'));
    },
  },
  {
    key: 'next-edges-four-steps',
    tier: 2,
    title: 'a step list of four steps',
    component: CODE,
    cause: 'give each stage a next edge to the stage after it, in the order of the list',
    plant: (e, _s, o) => {
      const path = `${ROOT}/steps.json`;
      e.file(path, BASE).lines_([
        '{',
        '  "steps": [',
        '    "gather",',
        '    "bake",',
        '    "pack",',
        '    "deliver"',
        '  ]',
        '}',
      ]);
      e.check(o, edgesOf('next', path, 3, 'stage'));
    },
  },
  {
    key: 'next-edges-direction',
    tier: 3,
    title: 'a step list whose first step leads to the second',
    component: CODE,
    cause: 'give each stage a next edge to the stage after it, in the order of the list',
    plant: (e, _s, o) => {
      const path = `${ROOT}/steps.json`;
      e.file(path, BASE).lines_([
        '{',
        '  "steps": [',
        '    "gather",',
        '    "bake",',
        '    "pack"',
        '  ]',
        '}',
      ]);
      e.check(o, (scan) => {
        const byId = new Map(
          scan.map.atoms.filter((a) => a.kind === 'stage').map((a) => [a.id, String(a.fields?.id)]),
        );
        const pairs = scan.map.edges
          .filter((edge) => edge.kind === 'next')
          .map((edge) => `${byId.get(edge.from)}>${byId.get(edge.to)}`);
        return pairs.includes('gather>bake') && pairs.includes('bake>pack') && !pairs.includes('bake>gather')
          ? undefined
          : `the next edges are ${pairs.join(', ')}`;
      });
    },
  },
  dispatching(
    'dispatch-backticks',
    1,
    'a skill body that dispatches a helper by name in backticks',
    (h) => `Dispatch the \`${h}\` agent to check the records.`,
  ),
  dispatching(
    'dispatch-plain-name',
    3,
    'a skill body that dispatches a helper by its plain name',
    (h) => `Dispatch the ${h} agent to check the records.`,
  ),
  dispatching(
    'dispatch-hand-over',
    3,
    'a skill body that hands a task to a helper',
    (h) => `Hand the final count to the \`${h}\` agent.`,
  ),
  dispatching(
    'dispatch-in-bullet',
    2,
    'a skill body that dispatches a helper in a bullet',
    (h) => `- Dispatch the \`${h}\` agent when the count is over fifty.`,
  ),
  {
    key: 'dispatch-two-helpers',
    tier: 3,
    title: 'a skill body that names two helpers in one sentence',
    component: CODE,
    cause: SAME_DISPATCH,
    plant: (e, s, o) => {
      standingFree(e);
      const place = theme(s, o).place;
      const [one, two] = [`${place}-scout-${tag(o)}`, `${place}-clerk-${tag(o)}`];
      const name = `${place}-plan-${tag(o)}`;
      const made = freeSkill(e, name, 'Plans the day.', [
        `Dispatch the \`${one}\` agent, then the \`${two}\` agent.`,
      ]);
      freeHelper(e, one, ['You read.']);
      freeHelper(e, two, ['You add.']);
      e.check(
        o,
        edgeBetween('dispatch', { kind: 'skill', file: made.path }, { kind: 'subagent', name: one }),
      );
      e.check(
        o,
        edgeBetween('dispatch', { kind: 'skill', file: made.path }, { kind: 'subagent', name: two }),
      );
    },
  },
  {
    key: 'dispatch-from-helper',
    tier: 2,
    title: 'a helper body that dispatches another helper',
    component: CODE,
    cause: SAME_DISPATCH,
    plant: (e, s, o) => {
      standingFree(e);
      const place = theme(s, o).place;
      const [one, two] = [`${place}-scout-${tag(o)}`, `${place}-clerk-${tag(o)}`];
      const first = freeHelper(e, one, [`Dispatch the \`${two}\` agent for the totals.`]);
      freeHelper(e, two, ['You add.']);
      e.check(
        o,
        edgeBetween('dispatch', { kind: 'subagent', file: first.path }, { kind: 'subagent', name: two }),
      );
    },
  },
  {
    key: 'edge-reference-from-skill',
    tier: 1,
    title: 'a skill that names a reference file it ships',
    component: CODE,
    cause: 'give a skill a reference edge for every file its body names',
    plant: (e, s, o) => {
      standingFree(e);
      const name = `${theme(s, o).place}-plan-${tag(o)}`;
      e.raw(skillFile(name, 'references/menu.md'), '# Menu\n', BASE);
      const made = freeSkill(e, name, 'Plans the day.', ['Open `references/menu.md` when a menu changes.']);
      e.check(o, edgesOf('reference', made.path, 1));
    },
  },
  {
    key: 'edge-script-from-skill',
    tier: 1,
    title: 'a skill that names a script it ships',
    component: CODE,
    cause: 'give a skill a script edge for every script its body names',
    plant: (e, s, o) => {
      standingFree(e);
      const name = `${theme(s, o).place}-plan-${tag(o)}`;
      e.raw(skillFile(name, 'scripts/close.sh'), '#!/bin/sh\n', BASE);
      const made = freeSkill(e, name, 'Plans the day.', ['Run `bash scripts/close.sh` to close the day.']);
      e.check(o, edgesOf('script', made.path, 1));
    },
  },
  {
    key: 'edge-reference-twice-named',
    tier: 3,
    title: 'a skill that names the same file on two lines',
    component: CODE,
    cause: 'give a skill a reference edge for every file its body names, once for each file',
    plant: (e, s, o) => {
      standingFree(e);
      const name = `${theme(s, o).place}-plan-${tag(o)}`;
      e.raw(skillFile(name, 'references/menu.md'), '# Menu\n', BASE);
      const made = freeSkill(e, name, 'Plans the day.', [
        'Open `references/menu.md` when a menu changes.',
        'Open `references/menu.md` again when a price changes.',
      ]);
      e.check(o, (scan) => {
        const ids = new Set(scan.map.atoms.filter((a) => a.provenance.file === made.path).map((a) => a.id));
        const to = scan.map.edges
          .filter((edge) => edge.kind === 'reference' && ids.has(edge.from))
          .map((edge) => edge.to);
        return to.length >= 1 && new Set(to).size >= 1 ? undefined : 'no reference edge from the skill';
      });
    },
  },
];

export function edgesFamily(): Family {
  return caseFamily('blind.edges', CODE, CASES, 'the reader reads');
}
