import { lineOf } from '../../../src/ladders/pointer/kit/compose';
import type {
  Atom,
  CassetteMissView,
  Diagnostic,
  LabelRequest,
  LedgerEntry,
  LedgerView,
  ListedCandidates,
  ScanRequest,
  ScanResult,
  WarningRecord,
} from '../../../src/ladders/pointer/sut/port';
import { anchorUnits, type NewUnit } from './anchor';
import { referenceBugsA } from './bugs-a';
import { referenceBugsB } from './bugs-b';
import { bugsC } from './bugs-c';
import { referenceBugsD } from './bugs-d';
import { referenceBugsPrivacy } from './bugs-privacy';
import { cutText, fingerprintText, sha } from './cut';
import type { Why } from './extras';
import { base32Id, canonicalCompact, canonicalJson } from './hash';
import { LabelSetError, type ParsedSet, parseLabelSets } from './labelset';
import {
  type AnswerLabel,
  type AnswerLink,
  askModel,
  Cassette,
  CassetteError,
  DECISIONS_THRESHOLD,
  httpLabelerId,
  type ModelCtx,
  readKey,
  validateAnswer,
} from './ports';
import { DEFAULT_MARGIN_CUT, stackWindow } from './stack-scan';
import { type Candidates, candidateOf, planWindows, type WindowPlan } from './window';

/** A title holds at most this many characters, an ellipsis included (docs, section 6). */
const TITLE_CHARACTERS = 90;

/** The title of an atom built from a unit: its text without marks, cut to 90 characters with an ellipsis. */
function titleOf(text: string): string {
  const flat = text
    .replace(/[*`]/g, '')
    .replace(/^\s*(?:[-+]|\d+[.)]|#+|>)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= TITLE_CHARACTERS) return flat;
  const keep = referenceBugsB.has('title-91') ? TITLE_CHARACTERS : TITLE_CHARACTERS - 1;
  return `${flat.slice(0, keep).trimEnd()}\u2026`;
}

/** The text of the first inline code span of a unit, by Markdown structure. */
const codeSpanOf = (text: string): string | undefined => /`([^`\n]+)`/.exec(text)?.[1]?.trim() || undefined;

const UNRESOLVED = Symbol('unresolved');
const SLOT = /^(?:code|unit|file|link\.[a-z][a-z0-9-]*)$/;

/**
 * Fills a template of a mapping (docs, section 6): a value that is exactly `$<slot>`, or `${<slot>}` inside a
 * longer text. A slot the unit does not fill leaves the whole value unresolved.
 */
function fillTemplate(value: string, slot: (name: string) => string | undefined): string | typeof UNRESOLVED {
  const whole = /^\$(.+)$/.exec(value)?.[1];
  if (whole !== undefined && SLOT.test(whole)) return slot(whole) ?? UNRESOLVED;
  if (!value.includes('${')) return value;
  let unresolved = false;
  const text = value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    if (!SLOT.test(name)) return `$${name}`;
    const found = slot(name);
    if (found === undefined) unresolved = true;
    return found ?? '';
  });
  return unresolved && !referenceBugsB.has('partial-template') ? UNRESOLVED : text;
}

/** Reference ledgers always record lineage; absence is an invalid reference fixture. */
function lineageOf(entry: LedgerEntry): NonNullable<LedgerEntry['lineage']> {
  if (!entry.lineage) throw new Error(`reference ledger ${entry.id} has no lineage`);
  return entry.lineage;
}

type LedgerFile = { entries: LedgerEntry[]; scan: number; version: number };

const ESTATE_KEY = 'pointer-estate';
const READ_FILE = /(^|\/)\.claude\/(skills\/[^/]+\/SKILL\.md|agents\/[^/]+\.md)$/;

function fail(error: string, extra: Partial<ScanResult> = {}): ScanResult {
  return { ok: false, error, warnings: [], warningRecords: [], atoms: [], diagnostics: [], ...extra };
}

function liveEntries(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return entries.filter((e) => e.status === 'live');
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The hash of what decides a label besides the answers, kept with each label: a label made under another hash
 * is asked again. The reference models the parts the bank varies between two scans: who labels (the planted
 * labeller or the arm of the model port), the runs of the planted labeller, the threshold of the
 * `openai-decisions` arm, the address of an `http` labeler and the stack.
 */
function labelerHashOf(req: ScanRequest): string {
  const parts: Record<string, unknown> = {};
  // Planted bug of lane bugs C: a label made by another labeler is carried.
  if (!bugsC.has('carry-ignores-labeler')) parts.labeler = req.model ? req.model.arm : 'planted';
  const runs = req.labelerRuns ?? 1;
  if (!req.model && runs !== 1 && !referenceBugsD.has('stack-hash-ignores-runs')) parts.runs = runs;
  if (req.model?.arm === 'openai-decisions' && !referenceBugsD.has('stack-hash-ignores-settings'))
    parts.threshold = req.model.threshold ?? DECISIONS_THRESHOLD;
  if (req.model?.arm === 'http') parts.id = httpLabelerId(req.model.url ?? '');
  if (req.model?.stack) parts.stack = req.model.stack.marginCut ?? DEFAULT_MARGIN_CUT;
  return sha(canonicalCompact(parts)).slice(0, 16);
}

export function viewOf(raw: string): LedgerView {
  const file = JSON.parse(raw) as LedgerFile;
  return { raw, entries: file.entries };
}

export async function scanEstate(req: ScanRequest): Promise<ScanResult> {
  const warnings: string[] = [];
  const warningRecords: WarningRecord[] = [];
  const diagnostics: Diagnostic[] = [];
  let sets: ParsedSet[];
  try {
    sets = parseLabelSets(req.labelsYaml);
  } catch (cause) {
    if (cause instanceof LabelSetError) return fail(cause.message, { failure: cause.failure });
    throw cause;
  }
  let previous: LedgerFile | undefined;
  if (req.previousLedger !== undefined && req.previousLedger.trim() !== '') {
    try {
      previous = JSON.parse(req.previousLedger) as LedgerFile;
    } catch {
      return fail('the previous ledger is not JSON');
    }
  }
  const prevEntries = previous?.entries ?? [];
  const prevScan = previous?.scan ?? 0;
  // Who labels in this scan: a recorded label is carried only when the same labeler made it.
  // A yes or no model names no clause and no atom: alone, it cannot label a set whose label needs one. A
  // system 2 labeler (the `haiku` arm, an `http` labeler, the system 2 of a stack) can.
  const system2 = req.model?.arm === 'haiku' || req.model?.arm === 'http' || req.model?.stack !== undefined;
  if (req.model && !system2 && !bugsC.has('link-labels-asked')) {
    for (const set of sets) {
      if (set.labels.some((label) => label.spans || label.links)) {
        return fail(
          `the set ${set.set} has a label with a target, spans or links; a yes or no model cannot name any of them: add a system 2 labeler`,
          { failure: { code: 'set-needs-system2', set: set.set } },
        );
      }
    }
  }

  // ---- cut
  /** UTF-16 code units of source kept on each side of a quote (docs/estate-pointer-reader.md section 15). */
  const context = referenceBugsA.has('context-window-8') ? 8 : 24;
  const files = [...req.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const sources = new Map(files.map((f) => [f.path, f.text]));
  const news: NewUnit[] = [];
  const digests = new Map<string, string>();
  const fileUnits = new Map<string, number[]>();
  for (const file of files) {
    const cut = cutText(file.text);
    digests.set(
      file.path,
      req.cassette?.text?.includes('"readable"')
        ? sha(cut.units.map((u) => `${u.container}:${u.fp.slice(0, 16)}`).join('\n'))
        : cut.cutDigest,
    );
    const globals: number[] = [];
    cut.units.forEach((unit, index) => {
      globals.push(news.length);
      news.push({
        path: file.path,
        index,
        text: unit.text,
        fp: unit.fp,
        start: unit.start,
        end: unit.end,
        container: unit.container,
        sectionPath: unit.path,
        prefix: file.text.slice(Math.max(0, unit.start - context), unit.start),
        suffix: file.text.slice(unit.end, unit.end + context),
        ctxFp: '',
        ...(unit.yamlPath ? { yamlPath: unit.yamlPath } : {}),
      });
    });
    fileUnits.set(file.path, globals);
    for (const [at, g] of globals.entries()) {
      const before = news[globals[at - 1] ?? -1]?.fp ?? '';
      const after = news[globals[at + 1] ?? -1]?.fp ?? '';
      // The heading path above the unit is part of its context, as the neighbours are.
      (news[g] as NewUnit).ctxFp = sha(`${before}|${after}|${(news[g] as NewUnit).sectionPath.join('>')}`);
    }
  }

  // ---- anchor
  const verdict = anchorUnits(liveEntries(prevEntries), news);
  // Every id of the previous ledger is taken, a deleted one too (the planted bug forgets the deleted ones).
  const usedIds = new Set(
    (referenceBugsA.has('ids-forget-deleted') ? liveEntries(prevEntries) : prevEntries).map((e) => e.id),
  );
  const estateKey = req.estateKey ?? ESTATE_KEY;
  const occurrence = new Map<string, number>();
  const occurrenceOf: number[] = [];
  news.forEach((unit, g) => {
    const k = `${unit.path}|${unit.fp}`;
    const n = occurrence.get(k) ?? 0;
    occurrence.set(k, n + 1);
    occurrenceOf[g] = n;
  });
  const mint = (unit: NewUnit, occ: number): string => {
    let n = occ;
    for (;;) {
      const id = base32Id(
        referenceBugsA.has('mint-drops-estate-key')
          ? `${unit.path}|${unit.fp}|${n}`
          : `${estateKey}|${unit.path}|${unit.fp}|${n}`,
      );
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
      n += 1;
    }
  };

  type Work = { entry: LedgerEntry; base?: LedgerEntry; event: string; g: number };
  const work: Work[] = news.map((unit, g) => {
    const hit = verdict.assigned.get(g);
    const base = hit?.entry;
    const entry: LedgerEntry = {
      id: base ? base.id : mint(unit, occurrenceOf[g] as number),
      path: unit.path,
      sectionPath: unit.sectionPath,
      container: unit.container,
      fp: unit.fp,
      ctxFp: unit.ctxFp,
      quote: unit.text,
      prefix: unit.prefix,
      suffix: unit.suffix,
      hint: { start: unit.start, end: unit.end },
      status: 'live',
      labels: base ? JSON.parse(JSON.stringify(base.labels)) : {},
      lineage: base ? [...lineageOf(base)] : [],
      twinOf: null,
    };
    return { entry, base, event: hit ? hit.event : 'new', g };
  });
  const byG = new Map(work.map((w) => [w.g, w]));

  // ---- what each set lists for its link kinds: a closed list, or the atoms of the kinds it names, by id
  const linkCandidates = (to: readonly string[]) => {
    if (referenceBugsPrivacy.has('candidates-all-withheld')) return [];
    const listed = (req.atoms ?? [])
      .filter((atom) => referenceBugsB.has('candidates-any-kind') || to.includes(atom.kind))
      .map(candidateOf);
    return referenceBugsB.has('candidates-unsorted')
      ? listed
      : listed.sort((a, b) => (a.shown ?? a.id).localeCompare(b.shown ?? b.id));
  };
  const candidatesOf = new Map<string, Candidates>(
    sets.map((set) => [
      set.set,
      Object.fromEntries(
        (set.links ?? []).map((kind) => [
          kind.name,
          kind.values
            ? kind.values.map((value) => ({ id: value, label: value }))
            : linkCandidates(kind.to ?? []),
        ]),
      ),
    ]),
  );
  const shownBack = new Map<string, string>(
    [...candidatesOf.values()].flatMap((byKind) =>
      Object.values(byKind).flatMap((list) =>
        list.flatMap((c) => (c.shown === undefined ? [] : [[c.shown, c.id] as [string, string]])),
      ),
    ),
  );
  const linksOf = new Map<string, AnswerLink[]>();

  // ---- labels
  const labelerHash = labelerHashOf(req);
  const onKeyRead = req.model?.onKeyRead;
  const modelCtx: ModelCtx | undefined = req.model
    ? {
        arm: req.model.arm,
        transport: req.model.transport,
        cassette: new Cassette(req.cassette?.text, req.cassette?.mode ?? 'replay'),
        threshold: req.model.threshold,
        cutDigestOf: (file) => digests.get(file) ?? '',
        warnings,
        warningRecords,
        refusals: [],
        keyHeader: readKey(),
        candidates: candidatesOf,
        ...(req.model.url !== undefined ? { url: req.model.url } : {}),
        // The key of the `haiku` arm is read when a request of that arm leaves, and never before.
        ...(onKeyRead
          ? {
              haikuKey: () => {
                onKeyRead();
                return readKey();
              },
            }
          : {}),
      }
    : undefined;
  if (
    onKeyRead &&
    referenceBugsD.has('privacy-getter-key-read-early') &&
    (req.cassette?.mode ?? 'replay') === 'record'
  )
    onKeyRead();
  const tally = { fellBack: 0 };
  let windowCount = 0;
  let callCount = 0;
  const cassetteKeyOf = new Map<string, string>();
  const gateTargets = new Map<string, number>();
  const listed: ListedCandidates[] = [];
  if (modelCtx) modelCtx.listed = { rows: listed, seen: new Set<string>() };
  const finish = (result: ScanResult): ScanResult => {
    result.listed = listed;
    if (modelCtx) result.cassette = modelCtx.cassette.dump();
    result.warnings = warnings;
    result.warningRecords = warningRecords;
    return result;
  };
  if (!req.labeler && !req.model) return fail('no labeller was given');
  try {
    for (const set of sets) {
      for (const file of files) {
        const globals = fileUnits.get(file.path) ?? [];
        const dirty = new Set<number>();
        const read = new Set<number>();
        globals.forEach((g, index) => {
          const w = byG.get(g) as Work;
          const unit = news[g] as NewUnit;
          if (unit.container === 'fence' || unit.container === 'comment') return;
          if (READ_FILE.test(file.path) && unit.container === 'front_matter') {
            const head = unit.yamlPath?.[0];
            if (head === 'name' || head === 'description') {
              read.add(index);
              return;
            }
          }
          const base = w.base;
          const before = base?.labels[set.set] as { setHash: string; labeler?: string } | undefined;
          const carried =
            base !== undefined &&
            base.fp === unit.fp &&
            base.ctxFp === unit.ctxFp &&
            before?.setHash === set.hash &&
            (before.labeler === undefined || before.labeler === labelerHash) &&
            w.event !== 'changed' &&
            w.event !== 'split' &&
            w.event !== 'merged';
          if (!carried) dirty.add(index);
        });
        const plans = planWindows(
          file.path,
          globals.map((g) => news[g] as NewUnit),
          dirty,
          read,
        );
        for (const plan of plans) {
          windowCount += 1;
          const outcome = await labelWindow(
            plan,
            set,
            req,
            modelCtx,
            candidatesOf.get(set.set) ?? {},
            () => {
              callCount += 1;
            },
            tally,
          );
          if ('abort' in outcome) {
            return finish(fail(outcome.abort, outcome.miss ? { miss: outcome.miss } : {}));
          }
          const labelUnits = plan.units.filter((u) => u.mode === 'label');
          if (outcome.failed !== undefined) {
            diagnostics.push({
              code: 'window_failed',
              reason: outcome.why.reason,
              ...whyFields(outcome.why),
              window: plan.id,
              set: set.set,
              detail: `the window ${plan.id} was refused twice: ${outcome.failed}`,
            });
          }
          for (const u of labelUnits) {
            const g = globals[u.index] as number;
            const w = byG.get(g) as Work;
            const got = outcome.labels?.get(u.n);
            const old = w.base?.labels[set.set];
            if (got) {
              const source = outcome.key ? `cassette:${outcome.key}` : 'labeler:planted';
              Object.defineProperty(w.entry.labels, set.set, {
                value: { label: got.label, source, setHash: set.hash, labeler: labelerHash },
                enumerable: true,
                writable: true,
                configurable: true,
              });
              if (outcome.key) cassetteKeyOf.set(`${w.entry.id}|${set.set}`, outcome.key);
              if (got.links) linksOf.set(`${w.entry.id}|${set.set}`, got.links);
              if (got.target !== undefined) {
                const targetUnit = plan.units[got.target - 1];
                if (targetUnit) gateTargets.set(`${w.entry.id}|${set.set}`, targetUnit.index);
              }
              if (old && old.label !== got.label && w.base?.fp === w.entry.fp) {
                diagnostics.push({
                  code: 'label_flip',
                  unit: w.entry.id,
                  window: plan.id,
                  detail: `the label of ${w.entry.id} went from ${old.label} to ${got.label} under ${set.set}`,
                });
              }
            } else {
              delete w.entry.labels[set.set];
              diagnostics.push({
                code: 'unlabeled',
                unit: w.entry.id,
                window: plan.id,
                detail: `the unit ${w.entry.id} has no label under ${set.set}`,
              });
            }
          }
        }
      }
      // drop labels of a set that is no longer declared
    }
  } catch (cause) {
    if (cause instanceof CassetteError) return finish(fail(cause.message));
    throw cause;
  }
  // A choice answer whose probabilities are no vector is refused unit by unit, with the reason.
  for (const record of modelCtx?.refusals ?? []) diagnostics.push(record);
  const setNames = new Set(sets.map((s) => s.set));
  for (const w of work) {
    for (const name of Object.keys(w.entry.labels)) if (!setNames.has(name)) delete w.entry.labels[name];
  }

  // ---- twins
  const firstOf = new Map<string, LedgerEntry>();
  for (const w of work) {
    const key = `${w.entry.fp}#${occurrenceOf[w.g]}`;
    const first = firstOf.get(key);
    if (!first) firstOf.set(key, w.entry);
    else if (first.path !== w.entry.path) w.entry.twinOf = first.id;
  }

  // ---- ledger text
  const goneEntries: LedgerEntry[] = verdict.gone.map(({ entry, event }) => ({
    ...entry,
    status: event === 'deleted' ? 'deleted' : event,
    lineage: [...lineageOf(entry)],
  }));
  const eventOf = new Map<string, string>();
  for (const w of work) eventOf.set(w.entry.id, w.event);
  for (const g of goneEntries)
    eventOf.set(g.id, verdict.gone.find((x) => x.entry.id === g.id)?.event ?? 'deleted');
  const liveIds = new Set(work.map((w) => w.entry.id));
  const untouched = prevEntries.filter((e) => e.status !== 'live' && !liveIds.has(e.id));
  const build = (scanNo: number): string => {
    const entries: LedgerEntry[] = [];
    for (const w of work) {
      const e = JSON.parse(JSON.stringify(w.entry)) as LedgerEntry;
      if (w.event !== 'unchanged') lineageOf(e).push({ scan: scanNo, event: w.event });
      entries.push(e);
    }
    for (const g of goneEntries) {
      const e = JSON.parse(JSON.stringify(g)) as LedgerEntry;
      lineageOf(e).push({ scan: scanNo, event: eventOf.get(g.id) ?? 'deleted' });
      entries.push(e);
    }
    entries.push(...untouched);
    const order = (e: LedgerEntry) => (e.status === 'live' ? 0 : 1);
    entries.sort(
      (a, b) =>
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
        order(a) - order(b) ||
        (a.hint?.start ?? 0) - (b.hint?.start ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return canonicalJson({ version: 1, scan: scanNo, entries });
  };
  let raw = build(prevScan);
  if (previous === undefined || raw !== req.previousLedger) raw = build(prevScan + 1);
  if (previous !== undefined && sameJson(JSON.parse(raw).entries, previous.entries))
    raw = canonicalJson(previous);
  const ledger = viewOf(raw);

  if (req.check) {
    if (req.previousLedger === undefined || raw !== req.previousLedger) {
      const oldByPath = new Map<string, string>();
      for (const e of prevEntries)
        oldByPath.set(e.path, `${oldByPath.get(e.path) ?? ''}${e.id}${e.fp}${e.status};`);
      const newByPath = new Map<string, string>();
      for (const e of ledger.entries)
        newByPath.set(e.path, `${newByPath.get(e.path) ?? ''}${e.id}${e.fp}${e.status};`);
      const changed = [...new Set([...oldByPath.keys(), ...newByPath.keys()])]
        .filter((p) => oldByPath.get(p) !== newByPath.get(p))
        .sort();
      return finish(
        fail(`the ledger is stale for ${changed.join(', ') || 'the estate'}; update it`, {
          diagnostics,
          failure: { code: 'ledger-out-of-date', files: changed },
        }),
      );
    }
  }

  // ---- atoms
  const atoms: Atom[] = [];
  const knownAtoms = new Set((req.atoms ?? []).map((atom) => atom.id));
  for (const entry of ledger.entries) {
    if (entry.status !== 'live') continue;
    const text = sources.get(entry.path) ?? '';
    for (const set of sets) {
      const label = entry.labels[set.set];
      if (!label) continue;
      const def = set.labels.find((l) => l.name === label.label);
      if (!def?.atom) continue;
      const named = `${entry.path} unit ${entry.id} (${label.label})`;
      // A link to `none` names nothing; one to a closed list keeps its value; one to an atom needs that atom.
      const links: AnswerLink[] = [];
      for (const given of linksOf.get(`${entry.id}|${set.set}`) ?? []) {
        // the answer may name a candidate by the hash the request showed; it is carried back to the atom's id
        const link = { ...given, to: shownBack.get(given.to) ?? given.to };
        if (link.to === 'none' && !referenceBugsB.has('none-link-refused')) continue;
        if (set.links?.find((kind) => kind.name === link.kind)?.values) links.push(link);
        else if (knownAtoms.has(link.to)) links.push(link);
        else
          diagnostics.push({
            code: 'atom-refusal',
            reason: 'link-target-not-atom',
            unit: entry.id,
            set: set.set,
            label: label.label,
            path: entry.path,
            kind: link.kind,
            target: link.to,
            detail: `${named}: the ${link.kind} link names ${link.to}, which is no atom of the estate`,
          });
      }
      let start = entry.hint?.start ?? 0;
      let end = entry.hint?.end ?? start;
      if (def.target === 'required') {
        const target = gateTargets.get(`${entry.id}|${set.set}`);
        const g = fileUnits.get(entry.path)?.[target ?? -1];
        const other = g === undefined ? undefined : news[g];
        if (other) {
          start = Math.min(start, other.start);
          end = Math.max(end, other.end);
        }
      }
      const key = cassetteKeyOf.get(`${entry.id}|${set.set}`);
      // An atom of the same kind on the same lines with the same quote as one already built is a repeat.
      const quote = text.slice(start, end);
      const startLine = lineOf(text, start);
      const endLine = lineOf(text, Math.max(start, end - 1));
      const squash = (value: string) => value.replace(/\s+/g, ' ').trim();
      const repeated = atoms.find(
        (other) =>
          other.kind === def.atom?.kind &&
          other.file === entry.path &&
          other.startLine <= endLine &&
          startLine <= other.endLine &&
          squash(other.quote) === squash(quote),
      );
      if (repeated) {
        diagnostics.push({
          code: 'duplicate',
          reason: 'atom-duplicate',
          unit: entry.id,
          set: set.set,
          label: label.label,
          path: entry.path,
          repeats: repeated.fields.unit,
          detail: `the unit ${entry.id} repeats an atom of kind ${def.atom.kind}`,
        });
        continue;
      }
      const extra = set.mappings.get(def.name) ?? {};
      const code = codeSpanOf(entry.quote);
      // A `whenFile` mapping builds only when the first code span of the unit names a file of the estate.
      if (extra.whenFile) {
        const builds = referenceBugsB.has('whenfile-ignores-exists')
          ? code !== undefined
          : code !== undefined && sources.has(code);
        if (!builds) continue;
      }
      const slot = (name: string): string | undefined => {
        if (name === 'code') return code;
        if (name === 'unit') return entry.quote;
        if (name === 'file') return entry.path;
        return links.find((link) => `link.${link.kind}` === name)?.to;
      };
      const title = extra.title === undefined ? undefined : fillTemplate(extra.title, slot);
      const situation = extra.situation === undefined ? undefined : fillTemplate(extra.situation, slot);
      if (title === UNRESOLVED || situation === UNRESOLVED) {
        diagnostics.push({
          code: 'atom-refusal',
          reason: 'template-unfilled',
          unit: entry.id,
          set: set.set,
          label: label.label,
          path: entry.path,
          detail: `${named}: the label ${label.label} needs a span, a link or a code span that the unit does not give`,
        });
        continue;
      }
      atoms.push({
        kind: def.atom.kind,
        ...(def.atom.polarity ? { polarity: def.atom.polarity } : {}),
        title: title ?? titleOf(entry.quote),
        ...(situation ? { situation } : {}),
        file: entry.path,
        startLine,
        endLine,
        quote,
        producedBy: 'model',
        approved: false,
        fields: {
          extraction: 'pointer',
          unit: entry.id,
          labelSet: set.set,
          ...(key ? { cassette: key } : {}),
        },
        evidence: [
          { type: 'custom', name: 'prose_pointer', reviewRequired: true, options: { reviewRequired: true } },
        ],
      });
    }
  }
  // ---- conditions: the text of a condition unit is the situation of the atom built from its target
  const conditions = new Map<Atom, Array<{ start: number; text: string; id: string }>>();
  for (const entry of ledger.entries) {
    if (entry.status !== 'live') continue;
    for (const set of sets) {
      const label = entry.labels[set.set];
      if (!label || !set.labels.find((l) => l.name === label.label)?.condition) continue;
      const targetIndex = gateTargets.get(`${entry.id}|${set.set}`);
      const g = fileUnits.get(entry.path)?.[targetIndex ?? -1];
      const targetId = g === undefined ? undefined : byG.get(g)?.entry.id;
      const atom = atoms.find((a) => a.fields.unit === targetId && a.fields.labelSet === set.set);
      if (!atom) {
        // A condition whose target holds no atom sets no situation, and says so.
        const targetEntry = ledger.entries.find((other) => other.id === targetId);
        const targetLabel = targetEntry?.labels[set.set]?.label;
        const mapped = set.labels.find((l) => l.name === targetLabel)?.atom !== undefined;
        if (referenceBugsB.has('orphan-condition-unreported') && mapped) continue;
        diagnostics.push({
          code: 'atom-refusal',
          reason: 'condition-unattached',
          unit: entry.id,
          ...(targetId !== undefined ? { target: targetId } : {}),
          set: set.set,
          label: label.label,
          path: entry.path,
          detail: `${entry.path} unit ${entry.id} (${label.label}): the condition points at a unit that holds no atom`,
        });
        continue;
      }
      conditions.set(atom, [
        ...(conditions.get(atom) ?? []),
        { start: entry.hint?.start ?? 0, text: entry.quote.trim(), id: entry.id },
      ]);
    }
  }
  for (const [atom, list] of conditions) {
    list.sort((x, y) => x.start - y.start);
    atom.situation = list.map((c) => c.text).join(' ');
    // The prose pointer names the units that set the situation, in file order.
    const ids = list.map((c) => c.id);
    atom.fields.condition = ids;
    const pointer = atom.evidence.find((e) => e.name === 'prose_pointer');
    if (pointer) pointer.options = { ...pointer.options, condition: ids };
  }
  const events: Record<string, string> = {};
  const eventCounts: Record<string, number> = {};
  for (const w of work) {
    events[w.entry.id] = w.event;
    eventCounts[w.event] = (eventCounts[w.event] ?? 0) + 1;
  }
  for (const g of verdict.gone) {
    events[g.entry.id] = g.event;
    eventCounts[g.event] = (eventCounts[g.event] ?? 0) + 1;
  }
  // The planted bug: the deleted count also counts the entries an earlier scan deleted.
  if (referenceBugsA.has('deleted-event-counts-old-deleted') && untouched.length > 0)
    eventCounts.deleted = (eventCounts.deleted ?? 0) + untouched.length;
  return finish({
    ok: true,
    warnings,
    ledger,
    atoms,
    diagnostics,
    events,
    eventCounts,
    windows: windowCount,
    calls: callCount,
    fellBack: tally.fellBack,
  });
}

type Outcome =
  | { abort: string; miss?: CassetteMissView }
  | { labels?: Map<number, AnswerLabel>; key?: string; failed?: string; why: Why }
  | { labels?: Map<number, AnswerLabel>; key?: string; failed?: undefined; why?: undefined };

/** The names a refusal is about, as fields of a diagnostic. */
function whyFields(why: Why): Partial<Diagnostic> {
  const { reason: _reason, ...names } = why;
  return names;
}

async function labelWindow(
  plan: WindowPlan,
  set: ParsedSet,
  req: ScanRequest,
  model: ModelCtx | undefined,
  candidates: Candidates,
  onCall: () => void,
  tally: { fellBack: number },
): Promise<Outcome> {
  if (model && req.model?.stack) {
    const out = await stackWindow(plan, set, model, req.model.stack.marginCut ?? DEFAULT_MARGIN_CUT);
    if ('abort' in out) return out;
    for (let call = 0; call < out.calls; call += 1) onCall();
    tally.fellBack += out.fellBack;
    return { labels: out.labels, ...(out.key ? { key: out.key } : {}) };
  }
  if (!model) {
    // The planted labeller is asked once per run; a unit takes the label (and target) every run gave.
    const runs: Array<Map<number, AnswerLabel>> = [];
    for (let run = 0; run < Math.max(1, req.labelerRuns ?? 1); run += 1) {
      const once = await plantedOnce(plan, set, req, candidates, onCall);
      if (!('labels' in once) || !once.labels) return once;
      runs.push(once.labels);
    }
    const [head, ...rest] = runs;
    // The links of a unit every run agrees on are those of the first run.
    const labels = new Map<number, AnswerLabel>();
    for (const [n, got] of head ?? []) {
      const same = rest.every((other) => {
        const there = other.get(n);
        return there?.label === got.label && there?.target === got.target;
      });
      if (same) labels.set(n, got);
    }
    return { labels };
  }
  let reason = '';
  let why: Why = { reason: 'answer-unreadable' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    onCall();
    let result: Awaited<ReturnType<typeof askModel>>;
    try {
      result = await askModel(plan, set, model);
    } catch {
      // A transport error may hold the request it failed on, and the request holds unit text: the failure names the window only.
      return { abort: `the model call failed for ${plan.id}` };
    }
    if (result.kind === 'error')
      return { abort: result.message, ...(result.miss ? { miss: result.miss } : {}) };
    if (result.kind === 'refused') {
      reason = result.reason;
      why = result.why;
      continue;
    }
    const checked = validateAnswer(result.answer, plan, set, candidates);
    if (checked.ok) return { labels: checked.labels, key: result.key };
    reason = checked.reason;
    why = checked.why;
  }
  return { failed: reason, why };
}

/** One run of the planted labeller over a window: a refused answer is asked once more. */
async function plantedOnce(
  plan: WindowPlan,
  set: ParsedSet,
  req: ScanRequest,
  candidates: Candidates,
  onCall: () => void,
): Promise<Outcome> {
  let reason = '';
  let why: Why = { reason: 'answer-unreadable' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    onCall();
    const request: LabelRequest = {
      set: set.set,
      setHash: set.hash,
      labels: set.labels,
      window: {
        id: plan.id,
        file: plan.file,
        path: plan.path,
        units: plan.units.map((u) => ({
          n: u.n,
          text: u.text,
          container: u.container,
          path: u.path,
          mode: u.mode,
        })),
      },
    };
    const answer = await (req.labeler as NonNullable<ScanRequest['labeler']>)(request);
    const checked = validateAnswer(answer, plan, set, candidates);
    if (checked.ok) return { labels: checked.labels };
    reason = checked.reason;
    why = checked.why;
  }
  return { failed: reason, why };
}

export { fingerprintText };
