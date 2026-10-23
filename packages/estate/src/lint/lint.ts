import {
  type CheckCapability,
  type CheckDeclaration,
  type CheckOutcome,
  runCheck,
} from '@agent-nexus/driftbench-core';
import { analyzeGraph } from '../graph/analyze';
import { quoteDrift } from '../map/file';
import { PATH_NOT_IN_ESTATE, referenceGraph } from '../refs/graph';
import { navigationNames } from '../scan/code';
import { codeNames, runtimeProduct } from '../scan/code-names';
import { normativeEstate, normativeRanges, unloadedByDesign } from '../scan/document-roles';
import { DEFAULT_STANDING_CEILING, measureInvariants, standingFiles } from '../scan/invariants';
import type { RawEstate, RegistryRow } from '../scan/reader';
import { ignoredReference, placeholderPath, unresolvedReference } from '../scan/reference-role';
import type { Atom, EstateMap } from '../schema';

/**
 * The static checks of an estate, on a map and the files it was read from. Each finding has a stable code:
 *
 *   ORPHAN              a file nothing names
 *   UNREACHABLE         a file the standing instructions never lead to (orphans are listed apart)
 *   UNENFORCED          an instruction, gate or register atom no guard enforces: trusted, a finding of its own
 *   OVERSIZE            the standing instructions are over the ceiling
 *   UNANCHORED_GUARD    a guard command finds its script from the working folder, not an anchor
 *   MISSING_REFERENCE   a concrete path a body names does not exist
 *   UNRESOLVED_REFERENCE a bare name has no resolved location: information
 *   AMBIGUOUS_REFERENCE a body names a file by an ending that several files share
 *   EXTERNAL            a body names a path outside the estate (`~/`, `/`, or an external folder): information
 *   MISSING_SCRIPT      a guard command runs a script that does not exist
 *   REGISTRY_ROW        a guard has no row in the check registry
 *   REGISTRY_GUARD      a registry row names a guard the estate does not run
 *   QUOTE_DRIFT         an atom's quote is no longer at its span: scan again
 *
 * UNENFORCED is reported as a count with the atom ids; it is a fact about trust, not an error, so it alone
 * does not fail the lint.
 */

export const LINT_CODES = [
  'ORPHAN',
  'UNREACHABLE',
  'UNENFORCED',
  'OVERSIZE',
  'UNANCHORED_GUARD',
  'MISSING_REFERENCE',
  'UNRESOLVED_REFERENCE',
  'AMBIGUOUS_REFERENCE',
  'EXTERNAL',
  'MISSING_SCRIPT',
  'REGISTRY_ROW',
  'REGISTRY_GUARD',
  'QUOTE_DRIFT',
] as const;
export type LintCode = (typeof LINT_CODES)[number];

/** Codes reported as information: counted and listed, never failing the lint. */
export const INFORMATION: ReadonlySet<LintCode> = new Set(['UNENFORCED', 'EXTERNAL', 'UNRESOLVED_REFERENCE']);

export type LintFinding = { code: LintCode; subject: string; message: string };

/** What each lint check requires of the run: only the drift check needs the map's atoms. */
export const LINT_CHECKS: readonly CheckDeclaration[] = LINT_CODES.map((code) => ({
  id: code,
  requires: code === 'QUOTE_DRIFT' ? ['model-map'] : [],
}));

export type LintResult = {
  findings: LintFinding[];
  /** One outcome per code, in LINT_CODES order: a check that read no input is `not-run`, never a pass. */
  outcomes: CheckOutcome<LintFinding>[];
  /** True when a finding outside INFORMATION was found. */
  failed: boolean;
  counts: Record<LintCode, number>;
  /**
   * True when the map records no reader of the references (no model, no pointer reader, no code reader: a map
   * scanned with no model before code read them): it cannot judge them, so ORPHAN and MISSING_REFERENCE are not
   * reported for it.
   */
  referenceChecksOff: boolean;
};

export type LintOptions = { ceiling?: number };

export function lintEstate(map: EstateMap, raw: RawEstate, options: LintOptions = {}): LintResult {
  raw = normativeEstate(raw);
  const referenceChecksOff = map.producedBy === undefined && map.referenceReader === undefined;
  const files = new Map(raw.files.map((file) => [file.path, file]));
  const atoms = map.atoms.filter((atom) => {
    if (ignoredReference(raw, atom.provenance.file)) return false;
    // A skill's script is owned by the skill's folder, whatever role its own text has: it states no rule.
    if (atom.kind === 'script') return true;
    const file = files.get(atom.provenance.file);
    if (!file) return true;
    return normativeRanges(file, atom.provenance.startLine, atom.provenance.endLine).length > 0;
  });
  const findings: LintFinding[] = [];
  const texts = new Map(raw.files.map((file) => [file.path, file.text]));
  for (const drift of quoteDrift(atoms, texts)) {
    findings.push({ code: 'QUOTE_DRIFT', subject: drift.path, message: drift.message });
  }

  const analysis = analyzeGraph(atoms, map.edges, raw.files, navigationNames(raw), codeNames(raw).links);
  // Findings look atoms up by id: the first atom of each id, as a search from the start would find it.
  const byId = new Map<string, Atom>();
  for (const atom of atoms) if (!byId.has(atom.id)) byId.set(atom.id, atom);
  for (const path of referenceChecksOff ? [] : analysis.orphans) {
    const file = files.get(path);
    if (file && unloadedByDesign(raw, file)) continue;
    findings.push({
      code: 'ORPHAN',
      subject: path,
      message: `${path}: nothing in the estate names this file`,
    });
  }
  for (const path of analysis.unreachableFiles) {
    const file = files.get(path);
    if (file && unloadedByDesign(raw, file)) continue;
    findings.push({
      code: 'UNREACHABLE',
      subject: path,
      message: `${path}: no route, reference or dispatch from the standing instructions leads here`,
    });
  }
  for (const id of referenceChecksOff ? [] : analysis.missingReferences) {
    const atom = byId.get(id);
    const path = String(atom?.fields?.path ?? '');
    if (atom?.fields?.ignored === true || ignoredReference(raw, path) || placeholderPath(path)) continue;
    // A script writes or creates the path: the runtime makes it, so a sentence about it is no broken link.
    if (atom && atom.fields?.external !== true && !atom.fields?.candidates && runtimeProduct(raw, path))
      continue;
    if (atom?.fields?.external === true) {
      findings.push({
        code: 'EXTERNAL',
        subject: id,
        message: `${atom.provenance.file}:${atom.provenance.startLine} names ${String(atom.fields.path)}, outside the estate`,
      });
      continue;
    }
    const candidates = atom?.fields?.candidates;
    if (Array.isArray(candidates) && candidates.length > 1) {
      findings.push({
        code: 'AMBIGUOUS_REFERENCE',
        subject: id,
        message: `${atom?.provenance.file}:${atom?.provenance.startLine} names ${String(atom?.fields?.path)}, which several files could be: ${candidates.join(', ')}`,
      });
      continue;
    }
    if (atom && unresolvedReference(atom)) {
      findings.push({
        code: 'UNRESOLVED_REFERENCE',
        subject: id,
        message: `${atom.provenance.file}:${atom.provenance.startLine} names ${String(atom.fields?.written ?? atom.title.replace(/^Read /, ''))}, which could not be resolved within the estate`,
      });
      continue;
    }
    findings.push({
      code: 'MISSING_REFERENCE',
      subject: id,
      message: `${atom?.provenance.file}:${atom?.provenance.startLine} names ${String(atom?.fields?.path)}, which does not exist`,
    });
  }
  for (const id of analysis.missingScripts) {
    const atom = byId.get(id);
    findings.push({
      code: 'MISSING_SCRIPT',
      subject: id,
      message:
        typeof atom?.fields?.dispatcher === 'string'
          ? `the guard's dispatcher ${atom.fields.dispatcher} names ${String(atom.fields.script)}, which no file of the estate is`
          : `the guard runs ${String(atom?.fields?.script)}, which does not exist`,
    });
  }

  const ceiling = options.ceiling ?? DEFAULT_STANDING_CEILING;
  const state = measureInvariants(raw, analysis.orphans, ceiling);
  if (state.standingCharacters > ceiling) {
    findings.push({
      code: 'OVERSIZE',
      subject: standingFiles(raw)
        .map((file) => file.path)
        .join(', '),
      message: `the standing instructions hold ${state.standingCharacters} characters, over the ceiling of ${ceiling}`,
    });
  }
  for (const command of state.unanchored) {
    findings.push({
      code: 'UNANCHORED_GUARD',
      subject: command,
      message: `the guard command "${command}" finds its script from the working folder; anchor it on the project folder`,
    });
  }
  for (const name of state.guardsWithoutRow) {
    findings.push({
      code: 'REGISTRY_ROW',
      subject: name,
      message: `the guard ${name} has no row in the check registry`,
    });
  }
  const rows = new Map<string, RegistryRow>();
  for (const row of raw.registry) if (!rows.has(row.id)) rows.set(row.id, row);
  for (const id of state.rowsWithoutGuard) {
    const row = rows.get(id);
    findings.push({
      code: 'REGISTRY_GUARD',
      subject: id,
      message: `registry row ${id} names ${row?.guard}, which no guard of the estate runs`,
    });
  }
  for (const id of analysis.unenforced) {
    findings.push({ code: 'UNENFORCED', subject: id, message: `${id}: no guard enforces it` });
  }

  const counts = Object.fromEntries(LINT_CODES.map((code) => [code, 0])) as Record<LintCode, number>;
  for (const finding of findings) counts[finding.code]++;
  const references = atoms.filter((atom) => atom.kind === 'reference').length;
  const read: Record<LintCode, number> = {
    ORPHAN: raw.files.length,
    UNREACHABLE: raw.files.length,
    UNENFORCED: atoms.filter((atom) => ['instruction', 'gate', 'register'].includes(atom.kind)).length,
    OVERSIZE: standingFiles(raw).length,
    UNANCHORED_GUARD: raw.guards.length,
    MISSING_REFERENCE: references,
    UNRESOLVED_REFERENCE: references,
    AMBIGUOUS_REFERENCE: references,
    EXTERNAL: references,
    MISSING_SCRIPT: raw.guards.length,
    REGISTRY_ROW: raw.registry.filter((row) => row.origin !== 'catalogue').length,
    REGISTRY_GUARD: raw.registry.length,
    QUOTE_DRIFT: atoms.length,
  };
  // What this run has: the map always; settings and guards when the estate declares them.
  const available = new Set<CheckCapability>(['model-map']);
  if (raw.files.some((file) => file.kind === 'settings')) available.add('settings');
  if (raw.guards.length > 0) available.add('guards');
  // A map that records no reader of the references cannot judge them: those two checks did not run.
  const unjudged = (code: string) =>
    referenceChecksOff && (code === 'ORPHAN' || code === 'MISSING_REFERENCE');
  // A mention that leads to no file and has too little evidence for a finding is listed, with its reason: a path the
  // reader of this map found, or a module import (a library, a file the estate does not hold), whatever read the map.
  const unresolved = referenceGraph(raw)
    .unresolved.filter((entry) => map.referenceReader === 'code' || entry.mention.syntax === 'module')
    .map((entry) => ({
      what: `${entry.from}:${entry.mention.line} ${entry.mention.written}`,
      reason: entry.reason ?? PATH_NOT_IN_ESTATE,
    }));
  const outcomes = LINT_CHECKS.map((check) =>
    runCheck(check, available, () =>
      unjudged(check.id)
        ? { read: 0, skipped: [{ what: 'map', reason: 'no-reference-reader' }], findings: [] }
        : {
            read: read[check.id as LintCode],
            ...(check.id === 'MISSING_REFERENCE' ? { skipped: unresolved } : {}),
            findings: findings.filter((finding) => finding.code === check.id),
          },
    ),
  );
  return {
    findings,
    outcomes,
    failed: findings.some((finding) => !INFORMATION.has(finding.code)),
    counts,
    referenceChecksOff,
  };
}
