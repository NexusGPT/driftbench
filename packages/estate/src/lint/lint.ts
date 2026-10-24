import {
  type CheckCapability,
  type CheckDeclaration,
  type CheckOutcome,
  noneRan,
  runCheck,
  runtimeProfile,
  type SkippedInput,
} from '@agent-nexus/driftbench-core';
import { cutList } from '../cut';
import { analyzeGraph, isHomeScript, routingOf } from '../graph/analyze';
import { quoteDrift } from '../map/file';
import { navigationNames } from '../scan/code';
import { codeNames, runtimeProduct } from '../scan/code-names';
import { normativeEstate, normativeRanges, unloadedByDesign } from '../scan/document-roles';
import { DEFAULT_STANDING_CEILING, measureInvariants, standingFiles } from '../scan/invariants';
import type { RawEstate, RegistryRow } from '../scan/reader';
import { ignoredReference, placeholderPath, unresolvedReference } from '../scan/reference-role';
import { namedOnlyByWiring } from '../scan/wiring';
import type { Atom, EstateMap } from '../schema';
import { PERMISSION_CODES, permissionFindings } from './permissions';

/**
 * The static checks of an estate, on a map and the files it was read from. Each finding has a stable code:
 *
 *   ORPHAN              a file nothing names
 *   UNREACHABLE         a file the standing instructions never lead to (orphans are listed apart)
 *   REACHED_BY_DESCRIPTION a skill or helper the standing instructions do not name, whose description is its
 *                       route: the runtime routes by description, so it is reachable (information)
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
 *   PERMISSION_*        the permission rules of the settings (lint/permissions.ts)
 *
 * UNENFORCED is reported as a count with the atom ids; it is a fact about trust, not an error, so it alone
 * does not fail the lint.
 */

export const LINT_CODES = [
  'ORPHAN',
  'UNREACHABLE',
  'REACHED_BY_DESCRIPTION',
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
  'PERMISSION_UNKNOWN_SKILL',
  'PERMISSION_UNKNOWN_HELPER',
  'PERMISSION_READ_BYPASS',
  'PERMISSION_BYPASS_MODE',
] as const;
export type LintCode = (typeof LINT_CODES)[number];

/** Codes reported as information: counted and listed, never failing the lint. */
export const INFORMATION: ReadonlySet<LintCode> = new Set([
  'UNENFORCED',
  'EXTERNAL',
  'UNRESOLVED_REFERENCE',
  'REACHED_BY_DESCRIPTION',
  'PERMISSION_UNKNOWN_HELPER',
]);

/** Why a guard script written from the home folder was not looked for. */
export const HOME_NOT_MAPPED = 'home-not-mapped';

export type LintFinding = {
  code: LintCode;
  subject: string;
  message: string;
  /** For a finding that rests on a link: 1 when read from structure, below 1 when it rests on an assumption. */
  confidence?: number;
  /** What the finding assumes, when its confidence is below 1. */
  basis?: string;
};

/** The checks that compare the check registry with the guards: with no guard read, from any source, they cannot run. */
const GUARD_CHECKS: ReadonlySet<LintCode> = new Set(['REGISTRY_ROW', 'REGISTRY_GUARD']);

/** What each lint check requires of the run: the drift check needs the map's atoms, a policy check the settings. */
export const LINT_CHECKS: readonly CheckDeclaration[] = LINT_CODES.map((code) => ({
  id: code,
  requires:
    code === 'QUOTE_DRIFT'
      ? ['model-map']
      : PERMISSION_CODES.some((id) => id === code)
        ? ['settings']
        : GUARD_CHECKS.has(code)
          ? ['guards']
          : [],
}));

/**
 * The verdict of a lint, as a code: a finding outside INFORMATION (`findings`); no check had an input
 * (`none-ran`); no finding, but files under the root no part type covers, which no check read (`unknown-files`);
 * else `clean`. A lint is clean only when every file is covered and some check ran.
 */
export type LintSummary = 'findings' | 'none-ran' | 'unknown-files' | 'clean';

export type LintResult = {
  findings: LintFinding[];
  /** One outcome per code, in LINT_CODES order: a check that read no input is `not-run`, never a pass. */
  outcomes: CheckOutcome<LintFinding>[];
  /** True when a finding outside INFORMATION was found. */
  failed: boolean;
  counts: Record<LintCode, number>;
  /** Files under the estate root no part type covers, from the read: no check looked at them. */
  unknown: string[];
  summary: LintSummary;
};

export type LintOptions = { ceiling?: number };

/** The findings a report lists, and how many each code has in all. */
export type FindingsCut = {
  /** The findings to list, in their order: at most `limit` of each code. */
  shown: LintFinding[];
  /** Per code that has findings, in the order the codes first appear. */
  totals: Array<{ code: LintCode; total: number; shown: number; omitted: number }>;
};

/**
 * Cuts a long list of findings for a report: the first `limit` of each code are shown and the rest are only
 * counted, so one code with a thousand findings cannot bury the others. Without a limit every finding is shown.
 */
export function summariseLint(
  findings: readonly LintFinding[],
  options: { limit?: number } = {},
): FindingsCut {
  const byCode = new Map<LintCode, LintFinding[]>();
  for (const finding of findings) byCode.set(finding.code, [...(byCode.get(finding.code) ?? []), finding]);
  const cuts = new Map([...byCode].map(([code, list]) => [code, cutList(list, options.limit)] as const));
  // The findings keep their order across codes: a finding is shown when it is among the first of its code.
  const taken = new Map<LintCode, number>();
  const shown = findings.filter((finding) => {
    const count = (taken.get(finding.code) ?? 0) + 1;
    taken.set(finding.code, count);
    return count <= (cuts.get(finding.code)?.shown.length ?? 0);
  });
  return {
    shown,
    totals: [...cuts].map(([code, cut]) => ({
      code,
      total: cut.total,
      shown: cut.shown.length,
      omitted: cut.omitted,
    })),
  };
}

export function lintEstate(map: EstateMap, raw: RawEstate, options: LintOptions = {}): LintResult {
  raw = normativeEstate(raw);
  const files = new Map(raw.files.map((file) => [file.path, file]));
  // What this run has: the map always; settings and guards when the estate declares them.
  const available = new Set<CheckCapability>(['model-map']);
  if (raw.files.some((file) => file.kind === 'settings')) available.add('settings');
  if (raw.guards.length > 0) available.add('guards');
  const profile = runtimeProfile(map.runtime);
  // Without the settings nothing can name the parts only the wiring names: they are left out, not orphans.
  const wiringSkipped: Record<'ORPHAN' | 'UNREACHABLE', SkippedInput[]> = { ORPHAN: [], UNREACHABLE: [] };
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

  const analysis = analyzeGraph(
    atoms,
    map.edges,
    raw.files,
    navigationNames(raw),
    codeNames(raw).links,
    routingOf(raw),
  );
  // Findings look atoms up by id: the first atom of each id, as a search from the start would find it.
  const byId = new Map<string, Atom>();
  for (const atom of atoms) if (!byId.has(atom.id)) byId.set(atom.id, atom);
  for (const path of analysis.orphans) {
    const file = files.get(path);
    if (file && unloadedByDesign(raw, file)) continue;
    if (!available.has('settings') && profile && namedOnlyByWiring(profile, path)) {
      wiringSkipped.ORPHAN.push({ what: path, reason: 'wiring-not-read' });
      continue;
    }
    findings.push({
      code: 'ORPHAN',
      subject: path,
      message: `${path}: nothing in the estate names this file`,
    });
  }
  for (const path of analysis.unreachableFiles) {
    const file = files.get(path);
    if (file && unloadedByDesign(raw, file)) continue;
    if (!available.has('settings') && profile && namedOnlyByWiring(profile, path)) {
      wiringSkipped.UNREACHABLE.push({ what: path, reason: 'wiring-not-read' });
      continue;
    }
    findings.push({
      code: 'UNREACHABLE',
      subject: path,
      message: `${path}: no route, reference or dispatch from the standing instructions leads here`,
    });
  }
  for (const path of analysis.describedFiles) {
    findings.push({
      code: 'REACHED_BY_DESCRIPTION',
      subject: path,
      message: `${path}: the standing instructions do not name it; the runtime routes to it by its description`,
    });
  }
  for (const id of analysis.missingReferences) {
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

  // A script written from the home folder lies outside the estate. It is looked for in the home folder the run
  // was given, and only there: without one it is skipped, never read from the machine and never called missing.
  const skippedScripts: SkippedInput[] = [];
  for (const atom of atoms.filter(isHomeScript)) {
    const script = String(atom.fields?.script);
    if (raw.home === undefined) skippedScripts.push({ what: script, reason: HOME_NOT_MAPPED });
    else if (!raw.home.present.includes(script))
      findings.push({
        code: 'MISSING_SCRIPT',
        subject: atom.id,
        message: `the guard runs ${script}, which the home folder does not hold`,
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

  const policy = permissionFindings(raw);
  findings.push(...policy.findings);

  // A check whose requirement the run lacks does not run: it reports nothing, and it does not fail the lint.
  const unable = new Set(
    LINT_CHECKS.filter((check) => check.requires.some((need) => !available.has(need))).map(
      (check) => check.id,
    ),
  );
  const kept = findings.filter((finding) => !unable.has(finding.code));
  const counts = Object.fromEntries(LINT_CODES.map((code) => [code, 0])) as Record<LintCode, number>;
  for (const finding of kept) counts[finding.code]++;
  const references = atoms.filter((atom) => atom.kind === 'reference').length;
  // The routes a unit's description gives: read when the runtime's profile routes by description, else skipped.
  const byDescription = routingOf(raw).includes('description');
  const describedRoutes = atoms.filter(
    (atom) => atom.kind === 'route' && atom.fields?.via === 'description',
  ).length;
  const read: Record<LintCode, number> = {
    ORPHAN: raw.files.length,
    UNREACHABLE: raw.files.length,
    REACHED_BY_DESCRIPTION: byDescription ? describedRoutes : 0,
    UNENFORCED: atoms.filter((atom) => ['instruction', 'gate', 'register'].includes(atom.kind)).length,
    OVERSIZE: standingFiles(raw).length,
    UNANCHORED_GUARD: raw.guards.length,
    MISSING_REFERENCE: references,
    UNRESOLVED_REFERENCE: references,
    AMBIGUOUS_REFERENCE: references,
    EXTERNAL: references,
    MISSING_SCRIPT: Math.max(0, raw.guards.length - skippedScripts.length),
    REGISTRY_ROW: raw.registry.filter((row) => row.origin !== 'catalogue').length,
    REGISTRY_GUARD: raw.registry.length,
    QUOTE_DRIFT: atoms.length,
    ...policy.reads,
  };
  const unknown = [...(raw.coverage?.unknown ?? [])];
  const outcomes = LINT_CHECKS.map((check) =>
    runCheck(check, available, () => ({
      read: read[check.id as LintCode],
      ...(check.id === 'REACHED_BY_DESCRIPTION' && !byDescription && describedRoutes > 0
        ? {
            skipped: [
              {
                what: `${describedRoutes} routes given by a description`,
                reason: 'runtime-does-not-route-by-description',
              },
            ],
          }
        : {}),
      unknown,
      ...(check.id === 'MISSING_SCRIPT' && skippedScripts.length > 0 ? { skipped: skippedScripts } : {}),
      ...(check.id === 'ORPHAN' || check.id === 'UNREACHABLE' ? { skipped: wiringSkipped[check.id] } : {}),
      findings: kept.filter((finding) => finding.code === check.id),
    })),
  );
  const failed = kept.some((finding) => !INFORMATION.has(finding.code));
  const summary: LintSummary = failed
    ? 'findings'
    : noneRan(outcomes)
      ? 'none-ran'
      : unknown.length > 0
        ? 'unknown-files'
        : 'clean';
  return { findings: kept, outcomes, failed, counts, unknown, summary };
}
