import { rngFor } from '@agent-nexus/driftbench-generate';
import type { Evidence } from '../hidden';
import { ANCHOR, SETTINGS, STANDING, skillFile } from '../layout';
import type { ProseEntry } from '../render';
import { BASE, type FileWriter, type Planted, type PlantedEstate } from './planted';

/**
 * Shared pieces of the planted estates: seeded fictional names, the standing file with its routing table,
 * the base settings (every tool a planted unit declares is allowed bare, so no declared-tool atom couples two
 * items), and a skill or helper planted in a standard or a given frontmatter form.
 */

const NOUNS = [
  'invoice',
  'parcel',
  'shelf',
  'menu',
  'roster',
  'ticket',
  'ledger',
  'route',
  'label',
  'crate',
  'permit',
  'tariff',
  'voucher',
  'pallet',
  'recipe',
  'badge',
] as const;
const VERBS = [
  'check',
  'update',
  'count',
  'review',
  'plan',
  'close',
  'audit',
  'sort',
  'price',
  'pack',
] as const;

export type Names = { noun: string; verb: string; skill: string; title: string };

/** Fictional names for an item on a seed: the same item gets other words on another seed. */
export function namesFor(seed: number, owner: string): Names {
  const rng = rngFor(seed, `bank:${owner}`);
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)] as string;
  const verb = VERBS[Math.floor(rng() * VERBS.length)] as string;
  // A hash, not the owner's words: an item key such as "compaction" must never reach the files it plants.
  let hash = 0x811c9dc5;
  for (const char of owner) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  const tag = hash.toString(36);
  return { noun, verb, skill: `${noun}-${verb}-${tag}`, title: `${verb} a ${noun}` };
}

/** A seeded shuffle of the items, so line order and file order change with the seed. */
export function order<T>(seed: number, label: string, items: readonly T[]): T[] {
  const rng = rngFor(seed, `bank-order:${label}`);
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    const held = out[index] as T;
    out[index] = out[other] as T;
    out[other] = held;
  }
  return out;
}

export type StandingRow = { owner: string; ask: string; target: string; helper?: boolean; hid: string };
export type StandingRule = {
  owner: string;
  text: string;
  atoms?: Planted[];
  prose?: Omit<ProseEntry, 'line'>;
};

/** The standing file: a title, the rules, then the routing table. */
export function writeStanding(
  estate: PlantedEstate,
  rows: readonly StandingRow[],
  rules: readonly StandingRule[] = [],
): FileWriter {
  const writer = estate.file(STANDING, BASE);
  writer.line('# Planted estate');
  writer.line('');
  writer.line('Everything in this estate is invented for testing.');
  if (rules.length > 0) {
    writer.owner = BASE;
    writer.line('');
    writer.line('## Rules');
    writer.line('');
    for (const rule of rules) {
      writer.owner = rule.owner;
      writer.line(rule.text, rule.atoms ?? [], rule.prose);
    }
  }
  if (rows.length > 0) {
    writer.owner = BASE;
    writer.line('');
    writer.line('## Routing');
    writer.line('');
    writer.line('| When the user wants to | Load |');
    writer.line('|---|---|');
    for (const row of rows) {
      writer.owner = row.owner;
      const cell = row.helper ? `the \`${row.target}\` agent` : `\`${row.target}\``;
      writer.line(`| ${row.ask} | ${cell} |`, [{ hid: row.hid, kind: 'route', key: row.target }]);
    }
  }
  writer.owner = BASE;
  return writer;
}

export const ALLOWED = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'Agent', 'Skill'] as const;

export type GuardLine = { owner: string; event: string; matcher?: string; command: string; atoms: Planted[] };

/** The base settings: every tool allowed bare, then the guards items plant, grouped by event. */
export function writeSettings(estate: PlantedEstate, guards: readonly GuardLine[] = []): void {
  const writer = estate.file(SETTINGS, BASE);
  writer.line('{');
  writer.line('  "permissions": {');
  writer.line('    "allow": [');
  ALLOWED.forEach((tool, index) => {
    writer.line(`      ${JSON.stringify(tool)}${index === ALLOWED.length - 1 ? '' : ','}`);
  });
  writer.line('    ]');
  writer.line(`  }${guards.length > 0 ? ',' : ''}`);
  if (guards.length > 0) {
    writer.line('  "hooks": {');
    const events = [...new Set(guards.map((guard) => guard.event))];
    events.forEach((event, eventIndex) => {
      writer.owner = BASE;
      writer.line(`    ${JSON.stringify(event)}: [`);
      const group = guards.filter((guard) => guard.event === event);
      group.forEach((guard, index) => {
        writer.owner = guard.owner;
        writer.line('      {');
        if (guard.matcher) writer.line(`        "matcher": ${JSON.stringify(guard.matcher)},`);
        writer.line(
          `        "hooks": [{ "type": "command", "command": ${JSON.stringify(guard.command)} }]`,
          guard.atoms,
        );
        writer.line(`      }${index === group.length - 1 ? '' : ','}`);
      });
      writer.owner = BASE;
      writer.line(`    ]${eventIndex === events.length - 1 ? '' : ','}`);
    });
    writer.line('  }');
  }
  writer.owner = BASE;
  writer.line('}');
}

/** An anchored guard command for a script under the guards folder. */
export function anchored(script: string, interpreter?: string): string {
  const path = `${ANCHOR}/${script}`;
  return interpreter ? `${interpreter} ${path}` : path;
}

export type BodyLine = { text: string; atoms?: Planted[]; prose?: Omit<ProseEntry, 'line'> };

/** A prose rule the recording states, as a body line. */
export function rule(
  hid: string,
  text: string,
  kind: 'instruction' | 'gate' | 'register' = 'instruction',
  evidence: Evidence[] = [{ type: 'custom', name: 'planted_rule' }],
  atoms: Planted[] = [],
): BodyLine {
  return {
    text,
    atoms: [{ hid, kind }, ...atoms],
    prose: { kind, title: text.replace(/[`.]/g, '').slice(0, 60), quote: text, evidence },
  };
}

/** A skill in the standard form: name, description, tools; then the body lines. Returns its path. */
export function plantSkill(
  estate: PlantedEstate,
  owner: string,
  name: string,
  description: string,
  body: readonly BodyLine[],
  options: { folder?: string; frontmatter?: readonly BodyLine[]; id?: string } = {},
): string {
  const path = skillFile(options.folder ?? name, 'SKILL.md');
  const writer = estate.file(path, owner);
  const id = options.id ?? owner;
  const front = options.frontmatter ?? [
    { text: '---' },
    { text: `name: ${name}`, atoms: [{ hid: `${id}:skill`, kind: 'skill', key: name }] },
    { text: `description: ${description}`, atoms: [{ hid: `${id}:route`, kind: 'route', key: name }] },
    { text: 'allowed-tools: Read, Edit, Bash' },
    { text: '---' },
  ];
  for (const line of front) writer.line(line.text, line.atoms ?? [], line.prose);
  writer.line('');
  writer.line(`# ${name}`);
  writer.line('');
  for (const line of body) writer.line(line.text, line.atoms ?? [], line.prose);
  if (options.frontmatter === undefined) estate.edge(owner, `${id}:route`, `${id}:skill`, 'route');
  return path;
}
