import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ASK_INVOICE, FAKE, scratch } from './support';

/**
 * A small estate and the map that declares it, for the fake's default agent. The map is written by hand, as the
 * reader would approve it: each atom quotes a line of the estate with the span and hash the map records. The fake
 * acts on these declared fields only, so a test states the structure and the body may say it in any words.
 */

export type Atom = {
  id: string;
  kind: string;
  quote: string;
  /** The estate file the quote is in; the skill file when left out. */
  file?: string;
  fields?: Record<string, unknown>;
  evidence?: unknown[];
};

const mapOf = (cwd: string) => join(cwd, 'fake-map.json');

/** The provenance the map records for a quote: the line of the file that holds it, the span and the hash. */
export function provenanceOf(cwd: string, file: string, quote: string) {
  const path = join(cwd, file);
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split('\n') : [];
  const line = lines.findIndex((text) => text.includes(quote)) + 1;
  return {
    file,
    quote,
    startLine: line,
    endLine: line,
    hash: createHash('sha256').update(`${file}\n${line}-${line}\n${quote}`).digest('hex'),
  };
}

/** A skill folder with a policy file and a script, and its map: the route that declares the ask, and the skill. */
export async function estate(folder: string, body: string) {
  const work = await scratch();
  const dir = await realpath(work.dir);
  const unit = join(dir, '.claude/skills', folder);
  await mkdir(join(unit, 'references'), { recursive: true });
  await mkdir(join(unit, 'scripts'), { recursive: true });
  await writeFile(
    join(unit, 'SKILL.md'),
    `---\nname: ${folder}\ndescription: Match supplier invoice amounts with order amounts.\n---\n${body}\n`,
  );
  await writeFile(join(unit, 'references/policy.md'), 'Read from this estate.\n');
  await writeFile(join(unit, 'scripts/check.mjs'), 'console.log("checked this estate");\n');
  const skill = `.claude/skills/${folder}/SKILL.md`;
  await writeFile(
    mapOf(dir),
    JSON.stringify({
      atoms: [
        {
          id: `route.${folder}`,
          kind: 'route',
          provenance: provenanceOf(
            dir,
            skill,
            'description: Match supplier invoice amounts with order amounts.',
          ),
          fields: { target: folder, targetKind: 'skill', ask: { text: ASK_INVOICE } },
        },
        {
          id: `skill.${folder}`,
          kind: 'skill',
          provenance: provenanceOf(dir, skill, `name: ${folder}`),
          fields: { name: folder },
        },
      ],
    }),
  );
  return { dir, folder, skill, done: work.done };
}

/** Adds atoms to the map, each with the provenance of its quote as the files hold it now. */
export function declare(work: { dir: string; skill: string }, atoms: Atom[]) {
  const map = JSON.parse(readFileSync(mapOf(work.dir), 'utf8'));
  for (const { quote, file, ...atom } of atoms)
    map.atoms.push({ ...atom, provenance: provenanceOf(work.dir, file ?? work.skill, quote) });
  writeFileSync(mapOf(work.dir), JSON.stringify(map));
}

/** The atoms the reader gives for the lines of a skill, by kind. */
export const declared = {
  reference: (id: string, quote: string, path: string): Atom => ({
    id,
    kind: 'reference',
    quote,
    fields: { path },
  }),
  script: (id: string, quote: string, path: string): Atom => ({
    id,
    kind: 'script',
    quote,
    fields: { path, named: true },
  }),
  helper: (name: string): Atom => ({
    id: `subagent.${name}`,
    kind: 'subagent',
    quote: `name: ${name}`,
    file: `.claude/agents/${name}.md`,
    fields: { name },
  }),
  dispatch: (id: string, quote: string, helper: string): Atom => ({
    id,
    kind: 'instruction',
    quote,
    fields: { polarity: 'obligation', labelLinks: [{ kind: 'dispatches', atom: `subagent.${helper}` }] },
  }),
  /** A gate: read `path` before the acts of `after`. */
  gate: (id: string, quote: string, path: string, after: string): Atom => ({
    id,
    kind: 'gate',
    quote,
    fields: { first: path, path },
    evidence: [{ type: 'ordered', before: 'Read', after }],
  }),
  /** A gate on a command: run `first` before the acts of `after`. */
  gateCommand: (id: string, quote: string, first: string, after: string): Atom => ({
    id,
    kind: 'gate',
    quote,
    fields: { first },
    evidence: [{ type: 'ordered', before: 'Bash', after }],
  }),
  /** Two calls of one tool in order: the call holding `first` before the call holding `second`. */
  gateCalls: (id: string, quote: string, tool: string, first: string, second: string): Atom => ({
    id,
    kind: 'gate',
    quote,
    fields: { first, second },
    evidence: [{ type: 'ordered', before: `${tool}~${first}`, after: `${tool}~${second}` }],
  }),
  /** A prohibition with the call it forbids: `tool` on `material`. */
  ban: (id: string, quote: string, tool: string, material: string, condition?: string[]): Atom => ({
    id,
    kind: 'instruction',
    quote,
    fields: {
      polarity: 'prohibition',
      unitCases: [{ effect: 'forbid', tool, material }],
      ...(condition ? { condition } : {}),
    },
  }),
};

/** The route's provenance follows the description line as the skill file holds it now. */
function declareAsk(cwd: string, ask: string) {
  const map = JSON.parse(readFileSync(mapOf(cwd), 'utf8'));
  const route = map.atoms[0];
  route.fields.ask.text = ask;
  route.provenance = provenanceOf(cwd, route.provenance.file, route.provenance.quote);
  writeFileSync(mapOf(cwd), JSON.stringify(map));
}

// A stream record is read by its shape; the test names the fields it checks.
// biome-ignore lint/suspicious/noExplicitAny: loose JSON rows of a stream
export type Row = Record<string, any>;

/** One run of the fake with the map of its estate, for the ask the route declares. */
export function play(
  cwd: string,
  options: { ask?: string; declared?: boolean; env?: Record<string, string>; manifest?: string } = {},
): Row[] {
  const ask = options.ask ?? ASK_INVOICE;
  if (options.declared !== false) declareAsk(cwd, ask);
  const output = execFileSync(process.execPath, [FAKE, '-p', ask], {
    cwd,
    env: {
      PATH: process.env.PATH,
      FAKE_MAP: mapOf(cwd),
      ...options.env,
      CLAUDE_CONFIG_DIR: join(cwd, 'config'),
      ...(options.manifest ? { FAKE_MANIFEST: options.manifest } : {}),
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  return output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

/** The tool calls of a run, in order. */
export function calls(records: Row[]): Row[] {
  return records.flatMap((row) =>
    Array.isArray(row.message?.content)
      ? row.message.content.filter((part: Row) => part.type === 'tool_use')
      : [],
  );
}

export const names = (records: Row[]) => calls(records).map((call) => call.name);
