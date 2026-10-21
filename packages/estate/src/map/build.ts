import type { ModelPort } from '@agent-nexus/driftbench-generate';
import { analyzeGraph, type GraphAnalysis } from '../graph/analyze';
import { buildGraph } from '../graph/edges';
import {
  DOCUMENT_ROLE_LABELS,
  DOCUMENT_ROLES_SET,
  DOCUMENT_ROLES_SET_NAME,
} from '../pointer/document-roles-set';
import { parseLabelSets } from '../pointer/labels';
import {
  REGISTRY_ROLE_LABELS,
  REGISTRY_ROLES_SET,
  REGISTRY_ROLES_SET_NAME,
  type RegistryRoles,
  STATE_OFF_LABEL,
} from '../pointer/registry-roles-set';
import { type LabelerUsage, pointerScan } from '../pointer/scan';
import { applyRegistryRoles, registryCellsToLabel } from '../scan/claude-code';
import { navigationNames } from '../scan/code';
import { codeNames } from '../scan/code-names';
import {
  documentInfo,
  normativeEstate,
  RUNTIME_INSTRUCTIONS,
  unloadedByDesign,
} from '../scan/document-roles';
import {
  DEFAULT_STANDING_CEILING,
  invariantAtoms,
  measureInvariants,
  type PointerScanOptions,
  type ScanAtoms,
  scanAtoms,
} from '../scan/invariants';
import type { ChunkRun, ProseRefusal } from '../scan/prose';
import type { ProseCache, ProseEstimate } from '../scan/prose-cache';
import type { EstateReader, RawEstate } from '../scan/reader';
import { quoteAtSpan, sha256 } from '../scan/text';
import type { Atom, Edge, EstateMap } from '../schema';

/** The atom kinds that are rules a guard can enforce. */
const RULE_KINDS = new Set(['instruction', 'gate', 'register']);

/**
 * The whole scan, from a folder to an estate map: the reader reads the files, code reads every structured
 * atom, the model splits the prose (when a port is given), the graph links the atoms and decides what each
 * guard enforces, the invariants are measured, and every quote is checked once more at its span before the
 * map is returned. The same estate, the same recorded answers and the same clock give the same map.
 */

/**
 * The files nothing names, given the atoms of an estate: those code read and those the prose gave. An atom names
 * a file by its path; navigation documents and files the runtime loads by place count as named.
 */
export function orphansOf(raw: RawEstate, atoms: readonly Atom[], edges: readonly Edge[]): string[] {
  const navigation = new Set(
    raw.files.filter((file) => unloadedByDesign(raw, file)).map((file) => file.path),
  );
  return analyzeGraph(atoms, edges, raw.files, navigationNames(raw), codeNames(raw).links).orphans.filter(
    (path) => !navigation.has(path),
  );
}

export type ScanEstateInput = {
  root: string;
  reader: EstateReader;
  port?: ModelPort;
  /** Read the prose with the pointer reader instead of the model port. Opt-in. */
  pointer?: PointerScanOptions;
  /**
   * The roles of the registry-table columns when no pointer reader is given (a test's hand-written labels). With a
   * pointer reader they are asked of it, and this option is not read.
   */
  registryRoles?: RegistryRoles;
  /** The root as the map records it: relative to where the map is written. Default `.`. */
  rootLabel?: string;
  ceiling?: number;
  now?: () => Date;
  maxTokens?: number;
  cache?: ProseCache;
  beforeModel?: (estimate: ProseEstimate) => void | Promise<void>;
};

export type ScanEstateResult = {
  map: EstateMap;
  raw: RawEstate;
  analysis: GraphAnalysis;
  chunks: ChunkRun[];
  refusals: ProseRefusal[];
  duplicates: string[];
  calls: number;
  pointer?: ScanAtoms['pointer'];
  /** The document-role question the pointer reader was asked once per prose file, when it ran. */
  documentRoles?: DocumentRolePass;
  /** The registry-roles question the pointer reader was asked about the registry tables, when it ran. */
  registryRoles?: RegistryRolePass;
};

export type DocumentRolePass = {
  /** Files whose role the recorded label set: role, by path. */
  labelled: Record<string, string>;
  windows: number;
  calls: number;
  recorded: number;
  usage: LabelerUsage[];
  failed: string[];
};

/** The lines of a file the document-role question reads: its first window. */
const ROLE_LINES = 40;

/**
 * Asks the pointer reader, once per prose file the estate declares no role for, what the document is as a whole
 * (the document-roles set, on the file's first lines), and gives each file the role its recorded label names.
 * Nothing is read from a word of the file's name or headings.
 */
async function documentRolePass(read: RawEstate, pointer: PointerScanOptions): Promise<DocumentRolePass> {
  const parsed = parseLabelSets(DOCUMENT_ROLES_SET);
  if (!parsed.ok) throw new Error(`the shipped document-roles set does not load: ${parsed.message}`);
  const declared = (path: string) =>
    read.files
      .find((file) => file.path === path)
      ?.document?.reasons?.some(
        (reason) => reason === 'declared in driftbench.estate.yaml' || reason === RUNTIME_INSTRUCTIONS,
      ) === true;
  const paths = [...new Set(read.prose.map((chunk) => chunk.file))].filter((path) => !declared(path)).sort();
  const files = paths.map((path) => ({
    path,
    text: (read.files.find((file) => file.path === path)?.text ?? '')
      .split('\n')
      .slice(0, ROLE_LINES)
      .join('\n'),
  }));
  const { onPlan: _onPlan, previous: _previous, ...rest } = pointer;
  const done = await pointerScan({ ...rest, sets: parsed.sets, atoms: [], files });
  const labelled: Record<string, string> = {};
  for (const unit of [...done.labelled].sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index)) {
    if (unit.set.set !== DOCUMENT_ROLES_SET_NAME || labelled[unit.path] !== undefined) continue;
    const role = DOCUMENT_ROLE_LABELS[unit.label];
    if (role === undefined) continue;
    labelled[unit.path] = role;
    const file = read.files.find((each) => each.path === unit.path);
    if (file) file.document = { path: file.path, role, reasons: [`recorded label: ${unit.label}`] };
  }
  return {
    labelled,
    windows: done.windows,
    calls: done.calls,
    recorded: done.recorded,
    usage: done.usage,
    failed: done.failed,
  };
}

export type RegistryRolePass = {
  roles: RegistryRoles;
  windows: number;
  calls: number;
  recorded: number;
  usage: LabelerUsage[];
  failed: string[];
};

/** A list of cells as the markdown file the label pass reads: one list item per cell. */
const asList = (cells: readonly string[]) => `${cells.map((cell) => `- ${cell}`).join('\n')}\n`;

/**
 * Asks the pointer reader what the header cells of the estate's registry tables name, and then which values of
 * their state column mean a check is off (the registry-roles set, one unit per cell). The roles are the recorded
 * labels; no word of a table decides. Two questions, because the state values are known only after the columns.
 */
async function registryRolePass(read: RawEstate, pointer: PointerScanOptions): Promise<RegistryRolePass> {
  const parsed = parseLabelSets(REGISTRY_ROLES_SET);
  if (!parsed.ok) throw new Error(`the shipped registry-roles set does not load: ${parsed.message}`);
  const { onPlan: _onPlan, previous: _previous, ...rest } = pointer;
  const roles: RegistryRoles = { columns: {}, offStates: [] };
  const pass: RegistryRolePass = { roles, windows: 0, calls: 0, recorded: 0, usage: [], failed: [] };
  const ask = async (path: string, cells: readonly string[]) => {
    if (cells.length === 0) return [];
    const done = await pointerScan({
      ...rest,
      sets: parsed.sets,
      atoms: [],
      files: [{ path, text: asList(cells) }],
    });
    pass.windows += done.windows;
    pass.calls += done.calls;
    pass.recorded += done.recorded;
    pass.usage.push(...done.usage);
    pass.failed.push(...done.failed);
    return done.labelled
      .filter((unit) => unit.set.set === REGISTRY_ROLES_SET_NAME)
      .map((unit) => ({ cell: unit.unit.text.replace(/^[-*]\s+/, '').trim(), label: unit.label }));
  };
  for (const { cell, label } of await ask('registry-roles/headers.md', registryCellsToLabel(read).headers)) {
    const role = REGISTRY_ROLE_LABELS[label];
    if (role !== undefined && roles.columns[cell] === undefined) roles.columns[cell] = role;
  }
  applyRegistryRoles(read, roles);
  for (const { cell, label } of await ask('registry-roles/states.md', registryCellsToLabel(read).states)) {
    if (label === STATE_OFF_LABEL && !roles.offStates.includes(cell)) roles.offStates.push(cell);
  }
  applyRegistryRoles(read, roles);
  return pass;
}

export async function scanEstate(input: ScanEstateInput): Promise<ScanEstateResult> {
  const read = await input.reader.read(input.root);
  const documentRoles = input.pointer ? await documentRolePass(read, input.pointer) : undefined;
  const registryRoles = input.pointer ? await registryRolePass(read, input.pointer) : undefined;
  if (!input.pointer && input.registryRoles) applyRegistryRoles(read, input.registryRoles);
  const recordedRoles = registryRoles?.roles ?? input.registryRoles;
  const raw = normativeEstate(read);
  const scanned = await scanAtoms(raw, {
    ...(input.port ? { port: input.port } : {}),
    ...(input.cache ? { cache: input.cache } : {}),
    ...(input.beforeModel ? { beforeModel: input.beforeModel } : {}),
    ...(input.pointer ? { pointer: input.pointer } : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
  });
  const { builder } = scanned;
  // A rule's concrete forms often sit on its lines beside the words quoted: keep every backticked span of
  // its whole source lines, so a guard that enforces it can be sent what it checks.
  const lineTexts = new Map(raw.files.map((file) => [file.path, file.text.split('\n')]));
  for (const atom of builder.atoms) {
    if (!RULE_KINDS.has(atom.kind)) continue;
    const lines = lineTexts.get(atom.provenance.file);
    if (!lines) continue;
    const text = lines.slice(atom.provenance.startLine - 1, atom.provenance.endLine).join('\n');
    const spans = [...new Set([...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? ''))].filter(
      (span) => span.trim() !== '',
    );
    if (spans.length > 0) atom.fields = { ...atom.fields, spans };
  }
  const graph = buildGraph(builder.atoms, raw);
  const byId = new Map(builder.atoms.map((atom) => [atom.id, atom]));
  for (const [guard, entries] of graph.enforces) {
    const atom = byId.get(guard);
    if (atom) atom.fields = { ...atom.fields, enforces: entries };
    for (const entry of entries) {
      const rule = byId.get(entry.atom);
      if (rule && !rule.enforcement.includes(guard)) rule.enforcement.push(guard);
    }
  }
  const navigation = new Set(
    raw.files.filter((file) => unloadedByDesign(raw, file)).map((file) => file.path),
  );
  const documented = navigationNames(raw);
  const codeLinks = codeNames(raw).links;
  const analyze = () => {
    const result = analyzeGraph(builder.atoms, graph.edges, raw.files, documented, codeLinks);
    return {
      ...result,
      orphans: result.orphans.filter((path) => !navigation.has(path)),
      unreachableFiles: result.unreachableFiles.filter((path) => !navigation.has(path)),
    };
  };
  const before = analyze();
  invariantAtoms(
    raw,
    builder,
    measureInvariants(raw, before.orphans, input.ceiling ?? DEFAULT_STANDING_CEILING),
  );
  const analysis = analyze();

  const texts = new Map(raw.files.map((file) => [file.path, file.text]));
  for (const atom of builder.atoms) {
    const text = texts.get(atom.provenance.file);
    if (text === undefined || !quoteAtSpan(text, atom.provenance)) {
      throw new Error(
        `the scan built an atom whose quote is not at its span: ${atom.id} (${atom.provenance.file}:${atom.provenance.startLine})`,
      );
    }
  }

  const at = (input.now ?? (() => new Date()))().toISOString();
  const atoms = builder.atoms;
  const map: EstateMap = {
    version: 1,
    runtime: raw.runtime,
    root: input.rootLabel ?? '.',
    readAt: at,
    atoms,
    documents: raw.files.map(documentInfo),
    edges: graph.edges,
    ...(raw.ignored?.chosen && raw.ignored.chosen.length > 0 ? { ignore: raw.ignored.chosen } : {}),
    ...(raw.userLayer ? { userSkills: true as const } : {}),
    ...(raw.followedLinks && raw.followedLinks.length > 0 ? { followedLinks: raw.followedLinks } : {}),
    ...(recordedRoles && (Object.keys(recordedRoles.columns).length > 0 || recordedRoles.offStates.length > 0)
      ? { registryRoles: recordedRoles }
      : {}),
    ...(input.pointer
      ? {
          producedBy: {
            family: input.pointer.labelling.members.map((member) => member.family).join('+'),
            model: input.pointer.labelling.members.map((member) => member.model).join('+'),
            at,
          },
        }
      : input.port
        ? { producedBy: { family: input.port.family, model: input.port.model ?? 'unknown', at } }
        : {}),
    hash: mapHash(atoms, graph.edges),
  };
  return {
    map,
    raw,
    analysis,
    chunks: scanned.chunks,
    refusals: scanned.refusals,
    duplicates: scanned.duplicates,
    calls: scanned.calls,
    ...(scanned.pointer ? { pointer: scanned.pointer } : {}),
    ...(documentRoles ? { documentRoles } : {}),
    ...(registryRoles ? { registryRoles } : {}),
  };
}

/** SHA-256 over the sorted atom hashes (with their ids) and the sorted edges. Approval does not change it. */
export function mapHash(atoms: readonly Atom[], edges: readonly Edge[]): string {
  const lines = [
    ...atoms.map((atom) => `${atom.id} ${atom.provenance.hash}`).sort(),
    ...edges.map((edge) => `${edge.from} ${edge.kind} ${edge.to}`).sort(),
  ];
  return sha256(lines.join('\n'));
}
