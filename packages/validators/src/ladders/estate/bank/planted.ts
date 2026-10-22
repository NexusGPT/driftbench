import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import {
  type Atom,
  type AtomKind,
  type EstateMap,
  type LintResult,
  lintEstate,
  type RawEstate,
  readerFor,
  scanEstate,
} from '@agent-nexus/driftbench-estate';
import type { ModelPort, ModelRequest } from '@agent-nexus/driftbench-generate';
import { RUNTIME } from '../layout';
import { matchAtoms } from '../pipeline';
import type { ExpectedAtom, ProseEntry } from '../render';
import { truthPointer } from '../truth-pointer';
import type { ItemResult } from './frame';

/**
 * A planted estate: the input of one family on one seed. Each item of the family owns files or lines of
 * shared files and declares, as it writes them, the atoms, edges and properties its form must give. One scan
 * serves every item; an item passes when every atom it planted is found, no atom is found on its own lines
 * beyond those, every edge it planted is in the map, and its own property checks hold.
 *
 * Files are written under `<tmp>/estate`; a symlink may point inside the estate or to `<tmp>/outside`, a
 * folder the estate does not hold, as a shared skill library does.
 */

export const BASE = 'base';

/**
 * An atom an item plants. A gate also names the act it waits for and the tool of that act (`act` is a part of the
 * planted line): the planted-truth labeller answers the line with them, as the shipped gate label asks.
 */
export type Planted = {
  hid: string;
  kind: AtomKind;
  key?: string;
  act?: string;
  tool?: string;
  /** The gate orders a command to run first, not a file to read. */
  command?: boolean;
  /** A route: the request as the item planted it, a part of the line. */
  ask?: string;
};

/**
 * An atom the planted-truth labeller must find on a line, that the item does not match by id: the check that
 * names it (`atomAt`, `refAt`) asserts that the scan gives it. A gate with no `act` takes the whole line.
 */
export type Hint = {
  kind: AtomKind;
  file: string;
  line: number;
  key?: string;
  act?: string;
  tool?: string;
  /** The prose rule the line states (a dispatch of a helper), as the recording would hold it. */
  prose?: Omit<ProseEntry, 'line'>;
};

export type ScanOutcome = {
  /** Product scan time only; excludes fixture I/O, matching, lint and cleanup. */
  scanMs: number;
  map: EstateMap;
  raw: RawEstate;
  lint: LintResult;
  idOf: Map<string, string>;
  atomOf: Map<string, Atom>;
  notes: string[];
  /** The chunks the scan sent to the splitter: file, lines and characters. */
  requests: Array<{ file: string; from: number; to: number; characters: number }>;
};

/** A property an item checks on the scan; a string is why it failed. */
export type Check = {
  (scan: ScanOutcome): string | undefined;
  /** The atom this check asserts on a line; the estate hands it to the planted-truth labeller. */
  hint?: Hint | Hint[];
};

/** A check that asserts an atom a line plants, with the hint the labeller answers it by. */
export function planting(check: (scan: ScanOutcome) => string | undefined, hint: Hint | Hint[]): Check {
  return Object.assign((scan: ScanOutcome) => check(scan), { hint });
}

export class FileWriter {
  readonly lines: string[] = [];
  /** The line ending and a prefix (a byte order mark), for the forms that need them. */
  eol = '\n';
  prefix = '';
  constructor(
    readonly estate: PlantedEstate,
    readonly path: string,
    public owner: string,
  ) {}

  /** Adds a line owned by the current owner; returns its number. */
  line(text: string, atoms: Planted[] = [], prose?: Omit<ProseEntry, 'line'>): number {
    this.lines.push(text);
    const number = this.lines.length;
    this.estate.own(this.path, number, this.owner);
    for (const atom of atoms) this.estate.expect(this.owner, { ...atom, file: this.path, line: number });
    if (prose) this.estate.prose(this.path, { ...prose, line: number });
    return number;
  }

  /** Several lines with no atom. */
  lines_(texts: readonly string[]): void {
    for (const text of texts) this.line(text);
  }
}

type Link = { path: string; target: string; absolute: boolean };

export class PlantedEstate {
  readonly writers = new Map<string, FileWriter>();
  readonly raws = new Map<string, { text: string; owner: string }>();
  readonly links: Link[] = [];
  readonly outside = new Map<string, string>();
  readonly expected: Array<ExpectedAtom & { owner: string }> = [];
  readonly edges: Array<{ owner: string; from: string; to: string; kind: string }> = [];
  readonly checks: Array<{ owner: string; check: Check }> = [];
  readonly answers = new Map<string, ProseEntry[]>();
  /** Atoms planted for the labeller only: the item asserts them with a check, it does not match them by id. */
  readonly hints: Hint[] = [];
  /** file to line to owner; a file owned whole has line 0. */
  readonly owners = new Map<string, Map<number, string>>();

  file(path: string, owner: string): FileWriter {
    const known = this.writers.get(path);
    if (known) {
      known.owner = owner;
      return known;
    }
    const writer = new FileWriter(this, path, owner);
    this.writers.set(path, writer);
    this.own(path, 0, owner);
    return writer;
  }

  /** A whole file with no planted atom, owned by an item: any atom found in it is extra. */
  raw(path: string, text: string, owner: string): void {
    this.raws.set(path, { text, owner });
    this.own(path, 0, owner);
  }

  /** A file outside the estate root, under `outside/`. */
  outsideFile(path: string, text: string): void {
    this.outside.set(path, text);
  }

  /** A symlink at `path` to `target`: `outside/...` or a path from the estate root. */
  link(path: string, target: string, owner: string, absolute = false): void {
    this.links.push({ path, target, absolute });
    this.own(path, 0, owner);
  }

  own(path: string, line: number, owner: string): void {
    const lines = this.owners.get(path) ?? new Map<number, string>();
    if (line === 0 || !lines.has(line) || lines.get(line) === BASE) lines.set(line, owner);
    this.owners.set(path, lines);
  }

  ownerOf(path: string, line: number): string | undefined {
    const lines = this.owners.get(path);
    if (lines?.has(line)) return lines.get(line);
    // A file under a linked folder belongs to the link's owner unless written by someone.
    for (const link of this.links) {
      if (path === link.path || path.startsWith(`${link.path}/`)) return this.owners.get(link.path)?.get(0);
    }
    return lines?.get(0);
  }

  expect(owner: string, atom: Omit<ExpectedAtom, 'key'> & { key?: string }): void {
    this.expected.push({ ...atom, key: atom.key ?? '', owner });
  }

  edge(owner: string, from: string, to: string, kind: string): void {
    this.edges.push({ owner, from, to, kind });
  }

  check(owner: string, check: Check): void {
    this.checks.push({ owner, check });
    if (check.hint) this.hints.push(...(Array.isArray(check.hint) ? check.hint : [check.hint]));
  }

  /** Plants an atom for the labeller alone (a helper file a routing row leads to, a line a check names). */
  hint(hint: Hint): void {
    this.hints.push(hint);
  }

  prose(chunk: string, entry: ProseEntry): void {
    this.answers.set(chunk, [...(this.answers.get(chunk) ?? []), entry]);
  }

  /** Every file as text, by its logical path. */
  texts(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [path, writer] of this.writers) {
      out.set(path, `${writer.prefix}${writer.lines.join(writer.eol)}${writer.eol}`);
    }
    for (const [path, raw] of this.raws) out.set(path, raw.text);
    return out;
  }

  /** Where a logical path is written: through a folder link, into its target. */
  private physical(path: string): string {
    // The longest link holding the path wins: a link inside a linked folder resolves first to its own target.
    const links = [...this.links].sort((a, b) => b.path.length - a.path.length);
    for (const link of links) {
      if (path === link.path) return link.target;
      if (path.startsWith(`${link.path}/`)) {
        return this.physical(posix.join(link.target, path.slice(link.path.length + 1)));
      }
    }
    return path;
  }

  /** Writes, scans with the recorded answers, lints; the folder is removed after. */
  async scan(): Promise<ScanOutcome> {
    const top = await mkdtemp(join(tmpdir(), 'driftbench-estate-bank-'));
    const root = join(top, 'estate');
    try {
      await mkdir(root, { recursive: true });
      const absolute = (path: string) => (path.startsWith('outside/') ? join(top, path) : join(root, path));
      const place = async (path: string, text: string) => {
        const physical = this.physical(path);
        const full = absolute(physical);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, text);
      };
      for (const [path, text] of this.texts()) await place(path, text);
      for (const [path, text] of this.outside) await place(`outside/${path}`, text);
      for (const link of [...this.links].sort((a, b) => a.path.length - b.path.length)) {
        // A link inside a linked folder is made in the folder's target.
        const parent = posix.dirname(link.path);
        const at = join(absolute(parent === '.' ? '' : this.physical(parent)), posix.basename(link.path));
        const target = absolute(link.target);
        await mkdir(dirname(at), { recursive: true });
        await symlink(link.absolute ? target : relative(dirname(at), target) || '.', at);
      }
      const texts = Object.fromEntries(this.texts());
      const hinted = this.hints.map((hint) => ({
        hid: `hint:${hint.file}:${hint.line}`,
        kind: hint.kind,
        file: hint.file,
        line: hint.line,
        key: hint.key ?? '',
        ...(hint.act !== undefined ? { act: hint.act } : {}),
        ...(hint.tool !== undefined ? { tool: hint.tool } : {}),
      }));
      const atoms = [...this.expected, ...hinted];
      // A planted gate names the act it waits for and its tool; a hinted gate with no act takes the whole line.
      const gates = atoms
        .filter((atom) => atom.kind === 'gate' && (atom as Planted).tool !== undefined)
        .map((atom) => {
          const planted = atom as Planted;
          const text = (texts[atom.file] ?? '').split('\n')[atom.line - 1] ?? '';
          return {
            file: atom.file,
            line: atom.line,
            act: planted.act ?? text,
            tool: planted.tool as string,
            ...(planted.act === undefined ? { whole: true } : {}),
            ...(planted.command ? { command: true } : {}),
          };
        });
      const answers = new Map([...this.answers].map(([file, list]) => [file, [...list]]));
      for (const hint of this.hints) {
        if (!hint.prose) continue;
        const prose = { ...hint.prose, line: hint.line };
        answers.set(hint.file, [...(answers.get(hint.file) ?? []), prose]);
      }
      const truth = truthPointer({ files: texts, atoms, answers, gates, edges: this.edges });
      const reader = readerFor(RUNTIME);
      if (!reader) throw new Error(`no reader for ${RUNTIME}`);
      const started = Date.now();
      const result = await scanEstate({
        root,
        reader,
        pointer: truth,
        now: () => new Date('2026-10-11T00:00:00.000Z'),
      });
      const scanMs = Date.now() - started;
      const map: EstateMap = {
        ...result.map,
        atoms: result.map.atoms.map((atom) => ({ ...atom, approved: true })),
      };
      const match = matchAtoms(this.expected, map.atoms);
      return {
        scanMs,
        map,
        raw: result.raw,
        lint: lintEstate(map, result.raw),
        idOf: match.idOf,
        atomOf: new Map(map.atoms.map((atom) => [atom.id, atom])),
        notes: result.raw.notes.map((note) => `${note.file}: ${note.message}`),
        requests: truth.windows.map((window) => ({
          file: window.file,
          from: 1,
          to: window.units,
          characters: window.characters,
        })),
      };
    } finally {
      await rm(top, { recursive: true, force: true });
    }
  }

  /** Judges every item named in `owners` on a scan. */
  judge(scan: ScanOutcome, owners: readonly string[]): Map<string, ItemResult> {
    const out = new Map<string, ItemResult>();
    const matched = new Set(scan.idOf.values());
    const edges = new Set(scan.map.edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`));
    for (const owner of owners) {
      const problems: string[] = [];
      for (const atom of this.expected.filter((candidate) => candidate.owner === owner)) {
        if (!scan.idOf.has(atom.hid)) {
          problems.push(`missed ${atom.kind}${atom.key ? ` ${atom.key}` : ''} at ${atom.file}:${atom.line}`);
        }
      }
      for (const atom of scan.map.atoms) {
        // An invariant is a property of the whole estate, anchored on whatever line comes first: no item's.
        if (matched.has(atom.id) || atom.kind === 'invariant') continue;
        if (this.ownerOf(atom.provenance.file, atom.provenance.startLine) !== owner) continue;
        problems.push(
          `found ${atom.kind} ${atom.id} at ${atom.provenance.file}:${atom.provenance.startLine}, never planted`,
        );
      }
      for (const edge of this.edges.filter((candidate) => candidate.owner === owner)) {
        const from = edge.from.startsWith('event.') ? edge.from : scan.idOf.get(edge.from);
        const to = edge.to.startsWith('event.') ? edge.to : scan.idOf.get(edge.to);
        if (!from || !to || !edges.has(`${from} ${edge.kind} ${to}`)) {
          problems.push(`missed the ${edge.kind} edge ${edge.from} to ${edge.to}`);
        }
      }
      for (const { check } of this.checks.filter((candidate) => candidate.owner === owner)) {
        let reason: string | undefined;
        try {
          reason = check(scan);
        } catch (cause) {
          reason = `the check threw: ${cause instanceof Error ? cause.message : String(cause)}`;
        }
        if (reason) problems.push(reason);
      }
      out.set(owner, {
        pass: problems.length === 0,
        detail: problems.length === 0 ? 'holds' : problems.slice(0, 4).join('; '),
      });
    }
    return out;
  }
}

/** A scanned atom by hidden id, for checks. */
export function atomOfHid(scan: ScanOutcome, hid: string): Atom | undefined {
  const id = scan.idOf.get(hid);
  return id ? scan.atomOf.get(id) : undefined;
}

/** A field of the atom planted under a hidden id, or why it cannot be read. */
export function fieldIs(hid: string, field: string, expected: unknown): Check {
  return (scan) => {
    const atom = atomOfHid(scan, hid);
    if (!atom) return undefined; // the missed atom is reported already
    const actual = atom.fields?.[field];
    return JSON.stringify(actual) === JSON.stringify(expected)
      ? undefined
      : `${hid}: ${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
  };
}

/**
 * The splitter's answers by construction: for any chunk the scan sends, the planted prose atoms of that file
 * whose line lies inside the chunk's lines. It holds no model; it answers what a correct splitter answers,
 * however the reader cuts a file into chunks, and it keeps the size of every chunk it was sent.
 */
export function truthPort(
  answers: ReadonlyMap<string, readonly ProseEntry[]>,
): ModelPort & { requests: ScanOutcome['requests'] } {
  const requests: ScanOutcome['requests'] = [];
  return {
    family: 'recording',
    model: 'estate-bank-truth',
    requests,
    async complete(request: ModelRequest): Promise<string> {
      const head = /^CHUNK: (.+)$/m.exec(request.user)?.[1]?.trim() ?? '';
      const place = /File (.+), lines (\d+) to (\d+)\./.exec(request.user);
      const file = place?.[1] ?? head;
      const from = Number(place?.[2] ?? 1);
      const to = Number(place?.[3] ?? Number.MAX_SAFE_INTEGER);
      const body = /<<<CHUNK\n([\s\S]*)\nCHUNK>>>/.exec(request.user)?.[1] ?? '';
      requests.push({ file, from, to, characters: body.length });
      const atoms = (answers.get(file) ?? []).filter((entry) => entry.line >= from && entry.line <= to);
      return JSON.stringify({ chunk: head, atoms });
    },
  };
}
