import type { Atom } from '@agent-nexus/driftbench-estate';
import { STANDING, skillFile } from '../layout';
import { lintLevel } from '../levels';
import { type EstateRun, estateRun } from '../pipeline';
import { namesFor, rule, writeSettings } from './common';
import { type Family, type ItemResult, itemsOf, type Tier } from './frame';
import { atomOfHid, type Planted, PlantedEstate } from './planted';

/**
 * scan.combination: one skill per pair of reader forms, so an item passes only when both forms are read
 * together: a linked skill folder, a description holding a colon and a space, a literal block description,
 * a rule inside a reference, a reference by a link to a section, a hazard decoy, a gate whose act is in
 * bold, a guard of the skill's own behind a quiet-switch prefix, carriage-return line endings, a web address
 * in backticks. The oracle is the union of the two forms' oracles. Generated, never listed by hand: every
 * pair of the ten forms is an item.
 *
 * scan.generated: the generated estates of the earlier ladder (both profiles), scored by kind and edge kind:
 * every planted atom of a kind found and none other, every edge of a kind found, the lint's findings exactly
 * the planted defects.
 */

const READER = 'packages/estate/src/scan/claude-code.ts';

export const FORMS = [
  'linked',
  'colon',
  'block',
  'refprose',
  'anchorlink',
  'hazarddecoy',
  'gatebold',
  'prefixguard',
  'crlf',
  'urldecoy',
] as const;
type Form = (typeof FORMS)[number];
const HARD: ReadonlySet<Form> = new Set(['linked', 'refprose', 'prefixguard', 'colon']);

function plantCombo(estate: PlantedEstate, seed: number, owner: string, forms: ReadonlySet<Form>): void {
  const names = namesFor(seed, owner);
  const name = names.skill;
  const folder = skillFile(name, '').replace(/\/$/, '');
  if (forms.has('linked')) estate.link(folder, `library/${name}`, owner);
  const path = skillFile(name, 'SKILL.md');
  const writer = estate.file(path, owner);
  if (forms.has('crlf')) writer.eol = '\r\n';
  const sentence = `${forms.has('colon') ? 'Use when: ' : ''}the user asks to ${names.verb} a ${names.noun}.`;
  const skill: Planted = { hid: `${owner}:skill`, kind: 'skill', key: name };
  const route: Planted = { hid: `${owner}:route`, kind: 'route', key: name };
  writer.line('---');
  writer.line(`name: ${name}`, [skill]);
  if (forms.has('block')) {
    writer.line('description: |', [route]);
    writer.line(`  ${sentence}`);
  } else writer.line(`description: ${sentence}`, [route]);
  writer.line('allowed-tools: Read, Edit, Bash');
  if (forms.has('prefixguard')) {
    const script = skillFile(name, 'scripts/check.sh');
    estate.raw(script, '#!/bin/sh\nexit 0\n', owner);
    const command = `[ "$QUIET_GUARDS" = "$PPID" ] || "$CLAUDE_PROJECT_DIR"/${script}`;
    writer.lines_([
      'hooks:',
      '  PreToolUse:',
      '    - matcher: Bash',
      '      hooks:',
      '        - type: command',
    ]);
    writer.line(`          command: '${command}'`, [
      { hid: `${owner}:guard`, kind: 'guard', key: 'check.sh' },
    ]);
    estate.check(owner, (scan) => {
      const atom = atomOfHid(scan, `${owner}:guard`);
      return atom && atom.fields?.script !== script
        ? `the guard's script is ${atom.fields?.script}`
        : undefined;
    });
  }
  writer.line('---');
  writer.line('');
  writer.line(`# ${capital(names.title)}`);
  writer.line('');
  const body = rule(`${owner}:rule`, `Always name the ${names.noun} in the first line.`);
  writer.line(body.text, body.atoms, body.prose);
  if (forms.has('refprose')) {
    const notes = skillFile(name, 'references/notes.md');
    writer.line('When unsure, open `references/notes.md` first.', [
      { hid: `${owner}:notes`, kind: 'reference', key: notes },
    ]);
    const file = estate.file(notes, owner);
    file.line('# Notes');
    const inner = rule(`${owner}:inner`, `Never ${names.verb} a ${names.noun} that another person holds.`);
    file.line(inner.text, inner.atoms, inner.prose);
    estate.edge(owner, `${owner}:skill`, `${owner}:notes`, 'reference');
  }
  if (forms.has('anchorlink')) {
    const guide = skillFile(name, 'references/guide.md');
    estate.raw(guide, '# Guide\n', owner);
    writer.line('When unsure, see [the guide](references/guide.md#limits).', [
      { hid: `${owner}:guide`, kind: 'reference', key: guide },
    ]);
  }
  if (forms.has('hazarddecoy')) writer.line('Keep the summary table compact and short.');
  if (forms.has('gatebold')) {
    const rules = skillFile(name, 'references/rules.md');
    estate.raw(rules, '# Rules\n', owner);
    writer.line(`**Before editing a ${names.noun}**: read \`references/rules.md\`.`, [
      { hid: `${owner}:gate`, kind: 'gate', act: `editing a ${names.noun}`, tool: 'Edit' },
      { hid: `${owner}:rules`, kind: 'reference', key: rules },
    ]);
    estate.check(owner, (scan) => {
      const atom = atomOfHid(scan, `${owner}:gate`);
      return atom && /\*/.test(String(atom.fields?.trigger))
        ? `the act keeps its markup: ${atom.fields?.trigger}`
        : undefined;
    });
  }
  if (forms.has('urldecoy')) writer.line('The public guide is at `https://example.com/guide.md`.');
  estate.edge(owner, `${owner}:route`, `${owner}:skill`, 'route');
  estate.check(owner, (scan) => {
    const atom = atomOfHid(scan, `${owner}:route`);
    return atom && atom.situation?.trim() !== sentence
      ? `the route's situation is ${JSON.stringify(atom.situation)}`
      : undefined;
  });
}

function pairs(): Array<[Form, Form]> {
  const out: Array<[Form, Form]> = [];
  FORMS.forEach((a, i) => {
    for (const b of FORMS.slice(i + 1)) out.push([a, b]);
  });
  return out;
}

export function comboFamily(): Family {
  const family = 'scan.combination';
  const items = itemsOf(
    family,
    1,
    READER,
    pairs().map(([a, b]) => ({
      key: `${a}+${b}`,
      tier: (HARD.has(a) && HARD.has(b) ? 5 : HARD.has(a) || HARD.has(b) ? 4 : 3) as Tier,
      title: `the reader reads a skill with both ${a} and ${b}`,
    })),
  );
  return {
    id: family,
    level: 1,
    component: READER,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      estate.file(STANDING, 'base').line('# Planted estate');
      writeSettings(estate);
      for (const [a, b] of pairs()) plantCombo(estate, seed, `${family}.${a}+${b}`, new Set([a, b]));
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}

// scan.generated -----------------------------------------------------------------------------------------

const KINDS = [
  'instruction',
  'gate',
  'route',
  'skill',
  'reference',
  'script',
  'subagent',
  'guard',
  'tool',
  'setting',
  'stage',
  'register',
  'hazard',
  'invariant',
] as const;
const EDGE_KINDS = [
  'route',
  'reference',
  'script',
  'dispatch',
  'enforces',
  'event',
  'allows',
  'next',
  'cites',
] as const;

function kindResult(run: EstateRun, kind: string): ItemResult {
  const expected = run.rendered.atoms.filter((atom) => atom.kind === kind);
  const missed = expected.filter((atom) => !run.scanned.match.idOf.has(atom.hid));
  const extra = run.scanned.match.extra.filter((atom: Atom) => atom.kind === kind);
  const problems = [
    ...missed.slice(0, 2).map((atom) => `missed ${atom.hid} at ${atom.file}:${atom.line}`),
    ...extra.slice(0, 2).map((atom) => `found ${atom.id}, never planted`),
  ];
  return {
    pass: missed.length + extra.length === 0,
    detail: problems.length === 0 ? `holds (${expected.length})` : problems.join('; '),
  };
}

function edgeResult(run: EstateRun, kind: string): ItemResult {
  const edges = new Set(run.scanned.map.edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`));
  const id = (hid: string) => (hid.startsWith('event.') ? hid : run.scanned.match.idOf.get(hid));
  const missed = run.rendered.edges.filter(
    (edge) => edge.kind === kind && !edges.has(`${id(edge.from)} ${kind} ${id(edge.to)}`),
  );
  return {
    pass: missed.length === 0,
    detail:
      missed.length === 0
        ? 'holds'
        : `missed ${missed.length}, such as ${missed[0]?.from} to ${missed[0]?.to}`,
  };
}

export function generatedFamily(): Family {
  const family = 'scan.generated';
  const specs = (['visible', 'holdout'] as const).flatMap((profile) => [
    ...KINDS.map((kind) => ({
      key: `${profile}-${kind}`,
      tier: (profile === 'visible' ? 1 : 2) as Tier,
      title: `every planted ${kind} atom of a ${profile} estate is found, and no other`,
    })),
    ...EDGE_KINDS.map((kind) => ({
      key: `${profile}-edge-${kind}`,
      tier: (profile === 'visible' ? 1 : 2) as Tier,
      title: `every ${kind} edge of a ${profile} estate is found`,
      component: 'packages/estate/src/graph/edges.ts',
    })),
    {
      key: `${profile}-lint`,
      tier: (profile === 'visible' ? 1 : 2) as Tier,
      title: `the lint of a ${profile} estate gives exactly its planted defects`,
      component: 'packages/estate/src/lint/lint.ts',
    },
  ]);
  const items = itemsOf(family, 1, 'packages/estate/src/scan/code.ts', specs);
  return {
    id: family,
    level: 1,
    component: 'packages/estate/src/scan/code.ts',
    items,
    async evaluate(seed) {
      const out = new Map<string, ItemResult>();
      for (const profile of ['visible', 'holdout'] as const) {
        const run = await estateRun(seed, profile);
        for (const kind of KINDS) out.set(`${family}.${profile}-${kind}`, kindResult(run, kind));
        for (const kind of EDGE_KINDS) out.set(`${family}.${profile}-edge-${kind}`, edgeResult(run, kind));
        const lint = lintLevel(run);
        out.set(`${family}.${profile}-lint`, {
          pass: lint.value >= 1,
          detail: lint.items.map((item) => item.id).join(', ') || 'holds',
        });
      }
      return out;
    },
  };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
