/**
 * The fake's dispatch: which structured definitions an ask sets off.
 *
 * The fake runs in a copy that holds only the estate's own files, so it is handed the estate's approved map and
 * its phrase bank (`FAKE_MAP`, `FAKE_PHRASES`: paths to YAML or JSON; unset, the files of the fixture the fake ships in;
 * `FAKE_MAP=none`, no map). It tells an ask from the structure of
 * what it is given, and reads no word of its own:
 * - a phrase of the bank: an ask equal to the phrase sets off the atoms of its situation, unless the situation is
 *   for an ask just outside the trigger or a near miss (`use: outside | near_miss`), which sets nothing off;
 * - an ask the generator rendered, when `grammar.json` exists: it holds the frames and the act shapes of the
 *   generator, cut at their slots. An ask that fits a frame holds an act; the act is
 *   the declared ask of an atom (`fields.ask.text`), or a shape of a skill, a helper, a file or a command. A
 *   frame that only asks what an act would mean sets nothing off;
 * - an ask equal to a declared ask, as the owner writes it ("stop");
 * - nothing else. An ask that matches none of these sets nothing off, and the fake answers it plainly.
 *
 * From the atoms it sets off, the fake performs what each atom defines, against the copy it is run in:
 * a route, a skill or a helper loads that unit; a rule written in a unit's folder is in force only when the unit
 * is loaded, so it loads its carrier; a reference is read; a guard is provoked, when the ask instructs the act it
 * guards, by the event its settings name, so the real script in the copy decides; a reply atom gives the reply
 * act it declares. An atom whose quote the copy no longer holds at its file is not in force and sets off nothing:
 * that is how a mutant of the estate changes what the fake does.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The `yaml` package, found from the places a checkout of this repository keeps it. */
function yamlParser(anchors) {
  const places = [
    ...anchors,
    join(here, 'agent.mjs'),
    join(here, '../../../../../packages/generate/package.json'),
    join(here, '../../../../../packages/estate/package.json'),
  ];
  for (const place of places) {
    try {
      return createRequire(place)('yaml').parse;
    } catch {
      // Try the next place.
    }
  }
  throw new Error(
    'the fake reads YAML with the yaml package, which it could not find; give a JSON file instead',
  );
}

function readStructured(path) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) return JSON.parse(text);
  return yamlParser([path]).call(undefined, text);
}

const compact = (text) => String(text).replace(/\s+/g, ' ').trim();
const lower = (text) => compact(text).toLowerCase();

const cache = new Map();

/** The index of the map, the phrase bank and the grammar, or undefined when no map is given. */
export function loadDispatch(env) {
  // Without FAKE_MAP the fake reads the map and the bank of the fixture it ships in; FAKE_MAP=none gives it none.
  const own = (name) => {
    const path = join(here, '../..', name);
    return existsSync(path) ? path : undefined;
  };
  const mapPath = env.FAKE_MAP === undefined ? own('approved.yaml') : env.FAKE_MAP;
  if (!mapPath || mapPath === 'none') return undefined;
  const phrasesPath = env.FAKE_PHRASES ?? (env.FAKE_MAP === undefined ? own('phrases.yaml') : undefined);
  const grammarPath = env.FAKE_GRAMMAR ?? join(here, 'grammar.json');
  const key = `${mapPath}\n${phrasesPath ?? ''}\n${grammarPath}`;
  if (cache.has(key)) return cache.get(key);
  const map = readStructured(mapPath);
  const atoms = new Map((map.atoms ?? []).map((atom) => [atom.id, atom]));
  const declared = new Map();
  const units = new Map();
  for (const atom of atoms.values()) {
    // A route keeps its request cell as a plain string; every other atom declares `{ text, act, context? }`.
    const ask = atom.fields?.ask;
    const text = typeof ask === 'string' ? ask : ask?.text;
    if (typeof text === 'string' && text.trim() !== '')
      declared.set(lower(text), [...(declared.get(lower(text)) ?? []), atom.id]);
    const name = atom.fields?.name;
    if ((atom.kind === 'skill' || atom.kind === 'subagent') && typeof name === 'string' && name !== '')
      units.set(name, atom.id);
  }
  const phrases = new Map();
  if (phrasesPath && existsSync(phrasesPath)) {
    const bank = readStructured(phrasesPath);
    for (const situation of bank.situations ?? [])
      for (const phrase of situation.phrases ?? []) {
        if (typeof phrase.text !== 'string') continue;
        const at = lower(phrase.text);
        phrases.set(at, [...(phrases.get(at) ?? []), { use: situation.use, atoms: situation.atoms ?? [] }]);
      }
  }
  const grammar = existsSync(grammarPath) ? readStructured(grammarPath) : undefined;
  const index = { atoms, declared, units, phrases, grammar };
  cache.set(key, index);
  return index;
}

/** The act inside an ask the generator rendered, and whether its frame requests the act; undefined when the ask fits no frame. */
function frameOf(grammar, ask, isAct) {
  for (const frame of Object.values(grammar.frames)) {
    if (!ask.startsWith(frame.before) || !ask.endsWith(frame.after)) continue;
    const core = ask.slice(frame.before.length, ask.length - frame.after.length);
    for (let at = core.indexOf(frame.mid); at >= 0; at = core.indexOf(frame.mid, at + 1)) {
      const act = core.slice(0, at);
      const rest = core.slice(at + frame.mid.length);
      // What follows the act is nothing, or one sentence of context.
      const context = frame.background && rest.startsWith(' ') && rest.endsWith('.');
      if ((rest === '' || context) && isAct(act)) return { act, request: frame.request };
    }
  }
  return undefined;
}

/** The piece of an act written in one of the generator's shapes, by the slot of the shape; undefined when it fits none. */
function shapeOf(grammar, act) {
  for (const [kind, shape] of Object.entries(grammar.shapes)) {
    const parts = shape.split(grammar.slot);
    if (parts.length !== 2) continue;
    const [before, after] = parts;
    if (act.length > before.length + after.length && act.startsWith(before) && act.endsWith(after))
      return { kind, piece: act.slice(before.length, act.length - after.length) };
  }
  return undefined;
}

/**
 * The atoms an ask sets off, in the order the map or the situation lists them, each with `provoke`: whether the
 * ask instructs the guarded act itself (a declared ask of a guard, a `forced` situation). `named` lists the file
 * and the command an act written as a shape names.
 */
export function setOff(index, ask) {
  const asked = lower(ask);
  const banked = index.phrases.get(asked);
  if (banked) {
    const out = new Map();
    for (const situation of banked) {
      if (situation.use === 'outside' || situation.use === 'near_miss') continue;
      for (const id of situation.atoms) out.set(id, (out.get(id) ?? false) || situation.use === 'forced');
    }
    return { atoms: [...out].map(([id, provoke]) => ({ id, provoke })), named: [] };
  }
  const grammar = index.grammar;
  const isAct = (act) =>
    index.declared.has(lower(act)) || (grammar !== undefined && shapeOf(grammar, act) !== undefined);
  const framed = grammar === undefined ? undefined : frameOf(grammar, ask.trim(), isAct);
  if (framed !== undefined && !framed.request) return { atoms: [], named: [] };
  const act = framed === undefined ? ask : framed.act;
  const declaredIds = index.declared.get(lower(act));
  if (declaredIds !== undefined)
    return { atoms: declaredIds.map((id) => ({ id, provoke: true })), named: [] };
  const shaped = grammar === undefined || framed === undefined ? undefined : shapeOf(grammar, act);
  if (shaped === undefined) return { atoms: [], named: [] };
  if (shaped.kind === 'skill' || shaped.kind === 'helper') {
    const id = index.units.get(shaped.piece);
    return { atoms: id === undefined ? [] : [{ id, provoke: false }], named: [] };
  }
  return { atoms: [], named: [{ kind: shaped.kind, piece: shaped.piece }] };
}

/**
 * Whether an atom is in force in the copy: the map's own claim holds (the provenance hash is the SHA-256 of the file,
 * the span and the quote), and the copy's file still holds the quote byte for byte. A quote the map folded across
 * the line breaks of a wrapped paragraph is held when the file has it with a run of white space for each break.
 * An atom whose quote a mutant edited, inverted or deleted is not in force, and the fake does not perform it.
 */
function inForce(atom, cwd) {
  const { file, quote, startLine, endLine, hash } = atom.provenance ?? {};
  if (typeof file !== 'string' || typeof quote !== 'string' || quote === '') return false;
  if (hash !== createHash('sha256').update(`${file}\n${startLine}-${endLine}\n${quote}`).digest('hex'))
    return false;
  const path = join(cwd, file);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return text.includes(quote) || compact(text).includes(compact(quote));
}

const folderOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/** The skill or helper atom whose folder or file holds the passage of an atom. */
function carrierOf(atom, atoms) {
  const file = atom.provenance.file;
  return [...atoms.values()]
    .filter((other) => {
      if (other.kind === 'subagent') return other.provenance.file === file;
      if (other.kind !== 'skill') return false;
      const folder = folderOf(other.provenance.file);
      return other.provenance.file === file || (folder !== '' && file.startsWith(`${folder}/`));
    })
    .sort((a, b) => b.provenance.file.length - a.provenance.file.length)[0];
}

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * What the atoms in force set the fake to do: the units to load (`{ kind: 'skill' | 'helper', name }`), the files
 * to read, the guards to provoke (atoms) and the reply acts declared, each in order and without repeats.
 */
export function intentsOf(index, setOffAtoms, cwd) {
  const units = [];
  const reads = [];
  const guards = [];
  const replies = [];
  const unit = (kind, name) => {
    if (name && !units.some((entry) => entry.kind === kind && entry.name === name))
      units.push({ kind, name });
  };
  for (const { id, provoke } of setOffAtoms) {
    const atom = index.atoms.get(id);
    if (!atom || !inForce(atom, cwd)) continue;
    const fields = atom.fields ?? {};
    switch (atom.kind) {
      case 'skill':
        unit('skill', text(fields.name));
        break;
      case 'subagent':
        unit('helper', text(fields.name));
        break;
      case 'route':
        unit(fields.targetKind === 'subagent' ? 'helper' : 'skill', text(fields.target));
        break;
      case 'reference': {
        const path = text(fields.path);
        if (path && !reads.includes(path)) reads.push(path);
        break;
      }
      case 'guard':
        if (provoke) guards.push(atom);
        break;
      case 'instruction':
      case 'register': {
        const carrier = carrierOf(atom, index.atoms);
        if (carrier) unit(carrier.kind === 'subagent' ? 'helper' : 'skill', text(carrier.fields?.name));
        break;
      }
      default:
        break;
    }
    if (typeof atom.replyAct?.id === 'string')
      replies.push({
        id: atom.replyAct.id,
        part: atom.replyAct.evidence?.part === 'draft' ? 'draft' : 'reply',
      });
  }
  return { units, reads, guards, replies };
}

/**
 * The reply act (`{ id, part }`) most atoms declare. On a tie the completion act, `report`, wins when it is among
 * the tied acts, else the first declared: a run that did its work reports it.
 */
export function replyActOf(replies) {
  const counts = new Map();
  for (const act of replies) {
    const key = `${act.id}/${act.part}`;
    const entry = counts.get(key) ?? { act, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const most = Math.max(0, ...[...counts.values()].map((entry) => entry.count));
  const tied = [...counts.values()].filter((entry) => entry.count === most).map((entry) => entry.act);
  return tied.find((act) => act.id === 'report') ?? tied[0];
}

/**
 * The files an agent reads again after a compaction, from the hazard atoms of the map whose `fields.hazard` is
 * `compaction` and that are in force in the copy: the files a hazard declares to read again (`fields.reread`, or
 * `reread` in the options of its `hazard_recovery` evidence), and the file the passage is written in, which is the
 * standing instruction the hazard orders to be read again. Taken from structure only: no prose is read.
 */
export function recoveryReads(index, cwd) {
  const paths = [];
  for (const atom of index.atoms.values()) {
    if (atom.kind !== 'hazard' || atom.fields?.hazard !== 'compaction' || !inForce(atom, cwd)) continue;
    const declared = [
      ...(Array.isArray(atom.fields?.reread) ? atom.fields.reread : []),
      ...(atom.evidence ?? []).flatMap((entry) =>
        entry.name === 'hazard_recovery' && Array.isArray(entry.options?.reread) ? entry.options.reread : [],
      ),
    ];
    for (const path of [...declared, atom.provenance?.file])
      if (typeof path === 'string' && path.trim() !== '' && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/**
 * The tool call that provokes a guard, from the rule the guard enforces: the rule's declared unit case for a tool
 * the matcher of the guard's hook covers (the settings give it), or the string its typed `command_not_run`
 * evidence names. A guard on a reply (Stop) is provoked by a reply longer than the limit the rule's
 * `max_characters` evidence gives.
 */
export function provocation(index, guard, matcher, covers) {
  const rules = [
    ...(guard.fields?.enforces ?? []).map((link) => index.atoms.get(link.atom)),
    ...[...index.atoms.values()].filter((atom) => (atom.enforcement ?? []).includes(guard.id)),
  ].filter(Boolean);
  const event = guard.fields?.event;
  if (event === 'Stop') {
    for (const rule of rules)
      for (const entry of rule.evidence ?? [])
        if (entry.name === 'max_characters' && Number.isInteger(entry.options?.max))
          return { event, longerThan: entry.options.max };
    return undefined;
  }
  if (event !== 'PreToolUse') return undefined;
  for (const rule of rules) {
    for (const unitCase of rule.fields?.unitCases ?? []) {
      if (unitCase.effect !== 'forbid' || typeof unitCase.tool !== 'string') continue;
      if (covers(matcher, unitCase.tool) && typeof unitCase.material === 'string')
        return { event, tool: unitCase.tool, material: unitCase.material };
    }
    for (const entry of rule.evidence ?? [])
      if (
        entry.name === 'command_not_run' &&
        typeof entry.options?.contains === 'string' &&
        covers(matcher, 'Bash')
      )
        return { event, tool: 'Bash', material: entry.options.contains };
  }
  return undefined;
}
