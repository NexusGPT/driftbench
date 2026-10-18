import { GUARDS_DIR, helperFile, MEMORY, SETTINGS, STANDING, STEPS, skillFile } from '../layout';
import { anchored, type GuardLine, namesFor, order, plantSkill, rule, writeSettings } from './common';
import { type Family, type ItemSpec, itemsOf } from './frame';
import { type Check, PlantedEstate as Estate, fieldIs, type PlantedEstate } from './planted';

/**
 * scan.symlink: estates whose files are reached through symbolic links, as a shared skill library is. The
 * oracle: what a link holds is read as if it were at the link's path (provenance on the link's path), once;
 * a dangling link or a loop never stops the scan and leaves a note naming the link. Groups of items that
 * link a whole folder of the layout (the skills folder, the helpers folder, the settings) get an estate of
 * their own, so one item's link never carries another's files.
 */

const COMPONENT = 'packages/estate/src/scan/claude-code.ts';
const FAMILY = 'scan.symlink';

type Plant = (estate: PlantedEstate, seed: number, owner: string) => void;
type Spec = ItemSpec & { group: 'shared' | 'own'; plant: Plant };

/** A skill whose folder sits elsewhere and is linked in at the skills folder. */
function linkedSkill(target: (name: string) => string, absolute = false): Plant {
  return (estate, seed, owner) => {
    const names = namesFor(seed, owner);
    const folder = skillFile(names.skill, '').replace(/\/$/, '');
    estate.link(folder, target(names.skill), owner, absolute);
    plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
      rule(`${owner}:rule`, `Always name the ${names.noun} in the first line.`),
    ]);
  };
}

function noted(path: string): Check {
  return (scan) =>
    scan.notes.some((note) => note.includes(path)) ? undefined : `no note names the link ${path}`;
}

const SPECS: Spec[] = [
  {
    key: 'skill-folder-inside',
    tier: 2,
    title: 'a skill folder linked from a library folder of the estate',
    group: 'shared',
    plant: linkedSkill((name) => `library/${name}`),
  },
  {
    key: 'skill-folder-outside',
    tier: 2,
    title: 'a skill folder linked from outside the estate root',
    group: 'shared',
    plant: linkedSkill((name) => `outside/skills/${name}`),
  },
  {
    key: 'skill-folder-absolute',
    tier: 3,
    title: 'a skill folder linked by an absolute path',
    group: 'shared',
    plant: linkedSkill((name) => `outside/absolute/${name}`, true),
  },
  {
    key: 'skill-folder-hidden-target',
    tier: 3,
    title: 'a skill folder linked from a hidden folder',
    group: 'shared',
    plant: linkedSkill((name) => `.library/${name}`),
  },
  {
    key: 'skill-folder-spaced-target',
    tier: 3,
    title: 'a skill folder linked from a folder whose name holds spaces',
    group: 'shared',
    plant: linkedSkill((name) => `library/shared skills/${name}`),
  },
  {
    key: 'skill-folder-chain',
    tier: 3,
    title: 'a skill folder reached through a link to a link',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(`library/${names.skill}-hop`, `library/${names.skill}`, owner);
      linkedSkill((name) => `library/${name}-hop`)(estate, seed, owner);
    },
  },
  {
    key: 'skill-file',
    tier: 2,
    title: 'a skill definition file that is itself a link',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(skillFile(names.skill, 'SKILL.md'), `library/${names.skill}.md`, owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        rule(`${owner}:rule`, `Always name the ${names.noun} in the first line.`),
      ]);
    },
  },
  {
    key: 'skill-renamed',
    tier: 3,
    title: 'a skill linked under a name its target folder does not carry',
    group: 'shared',
    plant: linkedSkill((name) => `library/old-${name}-v1`),
  },
  {
    key: 'agent-file',
    tier: 2,
    title: 'a helper file that is a link',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      const path = helperFile(names.skill);
      estate.link(path, `library/agents/${names.skill}.md`, owner);
      plantHelper(estate, owner, names.skill, names.noun);
    },
  },
  {
    key: 'references-folder',
    tier: 3,
    title: "a skill's references folder linked from a library: the reference exists",
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(skillFile(names.skill, 'references'), `library/${names.skill}-refs`, owner);
      const path = skillFile(names.skill, 'references/terms.md');
      estate.raw(path, '# Terms\nOne line per term.\n', owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        {
          text: 'When a term is unknown, open `references/terms.md` to find it.',
          atoms: [{ hid: `${owner}:ref`, kind: 'reference', key: path }],
        },
      ]);
      estate.edge(owner, `${owner}:skill`, `${owner}:ref`, 'reference');
      estate.check(owner, fieldIs(`${owner}:ref`, 'exists', true));
    },
  },
  {
    key: 'script-file',
    tier: 3,
    title: "a skill's script that is a link: its script atom is read",
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      const path = skillFile(names.skill, 'scripts/tally.py');
      estate.link(path, `library/${names.skill}-tally.py`, owner);
      estate.raw(path, '#!/usr/bin/env python3\n"""Tallies the records."""\n', owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        {
          text: 'Run `python3 scripts/tally.py RECORD` and show what it prints.',
          atoms: [{ hid: `${owner}:script`, kind: 'script', key: path }],
        },
      ]);
      estate.edge(owner, `${owner}:skill`, `${owner}:script`, 'script');
    },
  },
  {
    key: 'nested-link',
    tier: 4,
    title: 'a references folder linked inside a linked skill folder',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(skillFile(names.skill, '').replace(/\/$/, ''), `library/${names.skill}`, owner);
      estate.link(skillFile(names.skill, 'references'), `library/${names.skill}-refs`, owner);
      const path = skillFile(names.skill, 'references/codes.md');
      estate.raw(path, '# Codes\n', owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        {
          text: 'When a code is unknown, open `references/codes.md` to find it.',
          atoms: [{ hid: `${owner}:ref`, kind: 'reference', key: path }],
        },
      ]);
      estate.check(owner, fieldIs(`${owner}:ref`, 'exists', true));
    },
  },
  {
    key: 'dangling',
    tier: 3,
    title: 'a dangling skill link: the scan goes on and notes it',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      const folder = skillFile(names.skill, '').replace(/\/$/, '');
      estate.link(folder, `library/missing-${names.skill}`, owner);
      estate.check(owner, noted(folder));
    },
  },
  {
    key: 'loop',
    tier: 4,
    title: 'a link inside a skill pointing back at the skill: read once, noted',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      const folder = skillFile(names.skill, '').replace(/\/$/, '');
      estate.link(`${folder}/again`, folder, owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        rule(`${owner}:rule`, `Always name the ${names.noun} in the first line.`),
      ]);
      estate.check(owner, noted(`${folder}/again`));
    },
  },
  {
    key: 'guard-script',
    tier: 3,
    title: 'a guard script that is a link: the guard finds its script',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      const script = `${GUARDS_DIR}/${names.skill}.sh`;
      estate.link(script, `library/guards/${names.skill}.sh`, owner);
      estate.raw(script, '#!/bin/sh\nexit 0\n', owner);
      guards.push({
        owner,
        event: 'PreToolUse',
        matcher: 'Bash',
        command: anchored(script),
        atoms: [{ hid: `${owner}:guard`, kind: 'guard', key: `${names.skill}.sh` }],
      });
      estate.check(owner, fieldIs(`${owner}:guard`, 'scriptExists', true));
    },
  },
  {
    key: 'standing-file',
    tier: 1,
    title: 'the standing file is a link',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(STANDING, 'library/standing.md', owner);
      const writer = estate.file(STANDING, owner);
      writer.line('# Linked standing instructions');
      writer.line('');
      const body = rule(`${owner}:rule`, `Never change a ${names.noun} without saying which one.`);
      writer.line(body.text, body.atoms, body.prose);
    },
  },
  {
    key: 'memory-folder',
    tier: 3,
    title: 'the memory folder is a link',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(MEMORY.replace(/\/[^/]+$/, ''), 'library/memory', owner);
      const writer = estate.file(MEMORY, owner);
      writer.line('# Memory');
      writer.line('');
      const body = rule(`${owner}:rule`, `Write every ${names.noun} code in capitals.`, 'register');
      writer.line(body.text, body.atoms, body.prose);
    },
  },
  {
    key: 'steps-file',
    tier: 3,
    title: 'the step list is a link',
    group: 'shared',
    plant: (estate, _seed, owner) => {
      estate.link(STEPS, 'library/steps.json', owner);
      const writer = estate.file(STEPS, owner);
      writer.line('{');
      writer.line('  "steps": [');
      writer.line('    { "id": "linked-start", "next": ["linked-end"] },', [
        { hid: `${owner}:a`, kind: 'stage', key: 'linked-start' },
      ]);
      writer.line('    { "id": "linked-end", "next": [] }', [
        { hid: `${owner}:b`, kind: 'stage', key: 'linked-end' },
      ]);
      writer.line('  ]');
      writer.line('}');
      estate.edge(owner, `${owner}:a`, `${owner}:b`, 'next');
    },
  },
  {
    key: 'skills-folder',
    tier: 3,
    title: 'the whole skills folder is a link to a shared library',
    group: 'own',
    plant: (estate, seed, owner) => {
      estate.link(skillFile('x', '').replace(/\/x\/$/, ''), 'outside/library/skills', owner);
      for (const suffix of ['one', 'two']) {
        const names = namesFor(seed, `${owner}-${suffix}`);
        plantSkill(
          estate,
          owner,
          names.skill,
          `${capital(names.title)} for the team.`,
          [rule(`${owner}:${suffix}:rule`, `Always name the ${names.noun} in the first line.`)],
          { id: `${owner}:${suffix}` },
        );
      }
    },
  },
  {
    key: 'agents-folder',
    tier: 3,
    title: 'the whole helpers folder is a link',
    group: 'own',
    plant: (estate, seed, owner) => {
      estate.link(helperFile('x').replace(/\/x\.md$/, ''), 'outside/library/agents', owner);
      for (const suffix of ['one', 'two']) {
        const names = namesFor(seed, `${owner}-${suffix}`);
        plantHelper(estate, owner, names.skill, names.noun, suffix);
      }
    },
  },
  {
    key: 'settings-file',
    tier: 3,
    title: 'the settings file is a link: its guards and permissions are read',
    group: 'own',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      estate.link(SETTINGS, 'library/settings.json', owner);
      const script = `${GUARDS_DIR}/${names.skill}.sh`;
      estate.raw(script, '#!/bin/sh\nexit 0\n', owner);
      writeSettings(estate, [
        {
          owner,
          event: 'Stop',
          command: anchored(script),
          atoms: [{ hid: `${owner}:guard`, kind: 'guard', key: `${names.skill}.sh` }],
        },
      ]);
      estate.check(owner, (scan) =>
        scan.map.atoms.some((atom) => atom.kind === 'tool' && atom.provenance.file === SETTINGS)
          ? undefined
          : 'no permission rule of the linked settings was read',
      );
    },
  },
  {
    key: 'claude-folder',
    tier: 4,
    title: 'the whole layout folder is a link',
    group: 'own',
    plant: (estate, seed, owner) => {
      estate.link('.claude', 'outside/layout', owner);
      const names = namesFor(seed, owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        rule(`${owner}:rule`, `Always name the ${names.noun} in the first line.`),
      ]);
    },
  },
  {
    key: 'agent-in-linked-skill-library',
    tier: 4,
    title: 'a helper dispatched from a linked skill: the dispatch edge is read',
    group: 'shared',
    plant: (estate, seed, owner) => {
      const names = namesFor(seed, owner);
      const helper = `${names.noun}-helper-${owner.split('.').pop()}`;
      plantHelper(estate, `${owner}`, helper, names.noun, 'h');
      estate.link(skillFile(names.skill, '').replace(/\/$/, ''), `outside/skills/${names.skill}`, owner);
      plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
        rule(
          `${owner}:rule`,
          `When a ${names.noun} is late, dispatch the \`${helper}\` agent with its number.`,
        ),
      ]);
      estate.edge(owner, `${owner}:skill`, `${owner}:h:unit`, 'dispatch');
    },
  },
];

/** Guards a shared-group item adds to the settings; written once the group is planted. */
let guards: GuardLine[] = [];

function plantHelper(estate: PlantedEstate, owner: string, name: string, noun: string, suffix = ''): void {
  const id = suffix ? `${owner}:${suffix}` : owner;
  const writer = estate.file(helperFile(name), owner);
  writer.line('---');
  writer.line(`name: ${name}`, [{ hid: `${id}:unit`, kind: 'subagent', key: name }]);
  writer.line(`description: Checks one ${noun} at a time. Dispatch it with the ${noun} number.`, [
    { hid: `${id}:route`, kind: 'route', key: name },
  ]);
  writer.line('tools: Read, Grep');
  writer.line('---');
  writer.line('');
  const body = rule(`${id}:rule`, `You never edit a ${noun}: you read and you report.`);
  writer.line(body.text, body.atoms, body.prose);
  estate.edge(owner, `${id}:route`, `${id}:unit`, 'route');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function symlinkFamily(): Family {
  const items = itemsOf(
    FAMILY,
    1,
    COMPONENT,
    SPECS.map(({ key, tier, title }) => ({ key, tier, title: `the reader follows ${title}` })),
  );
  return {
    id: FAMILY,
    level: 1,
    component: COMPONENT,
    items,
    async evaluate(seed) {
      const out = new Map<string, { pass: boolean; detail: string }>();
      const shared = new Estate();
      guards = [];
      const sharedSpecs = order(
        seed,
        FAMILY,
        SPECS.filter((spec) => spec.group === 'shared'),
      );
      for (const spec of sharedSpecs) spec.plant(shared, seed, `${FAMILY}.${spec.key}`);
      if (!sharedSpecs.some((spec) => spec.key === 'standing-file')) {
        shared.file(STANDING, 'base').line('# Planted estate');
      }
      writeSettings(shared, guards);
      const scan = await shared.scan();
      for (const [id, result] of shared.judge(
        scan,
        sharedSpecs.map((spec) => `${FAMILY}.${spec.key}`),
      )) {
        out.set(id, result);
      }
      for (const spec of SPECS.filter((candidate) => candidate.group === 'own')) {
        const estate = new Estate();
        const owner = `${FAMILY}.${spec.key}`;
        if (spec.key !== 'settings-file') writeSettings(estate);
        estate.file(STANDING, 'base').line('# Planted estate');
        spec.plant(estate, seed, owner);
        const own = await estate.scan();
        for (const [id, result] of estate.judge(own, [owner])) out.set(id, result);
      }
      return out;
    },
  };
}
