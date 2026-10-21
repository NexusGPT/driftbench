import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type {
  FileIssue,
  FileStore,
  QuotesResult,
  ValidateResult,
} from '../../../src/ladders/variables/interface';

/**
 * A reference for `validate` and `quotes`, written from docs/variables.md alone: the schema of the file, the
 * references and the quote check. It exists to prove that every item of the blind bank can be passed by a
 * product that follows the page. It is not the product.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KINDS = ['stage', 'behaviour', 'deviation', 'persona', 'channel', 'data', 'task'];
const ROLES = ['axis', 'detail'];
const PRODUCERS = ['code', 'model', 'owner'];
const COMPARISONS = ['lt', 'le', 'gt', 'ge'];
const DEVIATIONS = [
  'none',
  'D1_off_topic',
  'D2_goal_shift',
  'D3_contradiction',
  'D4_loose_confirmation',
  'D5_language_switch',
  'D6_instruction_in_data',
  'D7_silence_or_burst',
  'D8_tool_failure',
  'D9_out_of_scope',
  'D10_return',
  'D11_pii_leak',
  'D12_prompt_extraction',
];

class Sink {
  readonly issues: FileIssue[] = [];
  add(code: string, path: string): void {
    this.issues.push({ code, path });
  }
}

const join = (base: string, key: string | number): string => (base === '' ? String(key) : `${base}.${key}`);

function strictKeys(o: Obj, allowed: string[], path: string, sink: Sink): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) sink.add('SCHEMA_UNRECOGNIZED_KEYS', path);
}

function text(o: Obj, key: string, path: string, sink: Sink, required = true): string | undefined {
  const v = o[key];
  const p = join(path, key);
  if (v === undefined) {
    if (required) sink.add('SCHEMA_INVALID_TYPE', p);
    return undefined;
  }
  if (typeof v !== 'string') {
    sink.add('SCHEMA_INVALID_TYPE', p);
    return undefined;
  }
  if (v === '') sink.add('SCHEMA_TOO_SMALL', p);
  return v;
}

function oneOf(o: Obj, key: string, list: string[], path: string, sink: Sink, required: boolean): void {
  const v = o[key];
  const p = join(path, key);
  if (v === undefined) {
    if (required) sink.add('SCHEMA_INVALID_TYPE', p);
    return;
  }
  if (typeof v !== 'string') sink.add('SCHEMA_INVALID_TYPE', p);
  else if (!list.includes(v)) sink.add('SCHEMA_INVALID_VALUE', p);
}

function bool(o: Obj, key: string, path: string, sink: Sink, required: boolean): void {
  const v = o[key];
  if (v === undefined) {
    if (required) sink.add('SCHEMA_INVALID_TYPE', join(path, key));
  } else if (typeof v !== 'boolean') sink.add('SCHEMA_INVALID_TYPE', join(path, key));
}

function realDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function relativePath(p: string): boolean {
  return !(p.startsWith('/') || p.startsWith('~') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(p) || p.includes('\\'));
}

function provenance(v: unknown, path: string, sink: Sink): void {
  if (!Array.isArray(v)) {
    sink.add('SCHEMA_INVALID_TYPE', path);
    return;
  }
  v.forEach((entry, i) => {
    const p = join(path, i);
    if (
      !isObj(entry) ||
      typeof entry.kind !== 'string' ||
      !['quote', 'structure', 'conversations', 'owner'].includes(entry.kind)
    ) {
      sink.add('SCHEMA_INVALID_UNION', p);
      return;
    }
    if (entry.kind === 'quote') {
      strictKeys(entry, ['kind', 'path', 'quote', 'ledger'], p, sink);
      const pa = text(entry, 'path', p, sink);
      if (pa !== undefined && pa !== '' && !relativePath(pa)) sink.add('SCHEMA_CUSTOM', join(p, 'path'));
      const q = entry.quote;
      if (typeof q !== 'string') sink.add('SCHEMA_INVALID_TYPE', join(p, 'quote'));
      else if (q.length === 0) sink.add('SCHEMA_TOO_SMALL', join(p, 'quote'));
      else if (q.length > 1000) sink.add('SCHEMA_TOO_BIG', join(p, 'quote'));
      else if (q.trim() === '') sink.add('SCHEMA_CUSTOM', join(p, 'quote'));
      if (
        entry.ledger !== undefined &&
        (typeof entry.ledger !== 'string' || !/^[a-z2-7]{10}$/.test(entry.ledger))
      )
        sink.add('SCHEMA_INVALID_FORMAT', join(p, 'ledger'));
    } else if (entry.kind === 'structure') {
      strictKeys(entry, ['kind', 'path', 'pointer', 'lines', 'hash'], p, sink);
      const pa = text(entry, 'path', p, sink);
      if (pa !== undefined && pa !== '' && !relativePath(pa)) sink.add('SCHEMA_CUSTOM', join(p, 'path'));
      if (typeof entry.hash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.hash))
        sink.add('SCHEMA_INVALID_FORMAT', join(p, 'hash'));
      const hasPointer = entry.pointer !== undefined;
      const hasLines = entry.lines !== undefined;
      if (hasPointer === hasLines) sink.add('SCHEMA_CUSTOM', p);
      if (hasPointer && typeof entry.pointer !== 'string')
        sink.add('SCHEMA_INVALID_TYPE', join(p, 'pointer'));
      if (hasLines) {
        const l = entry.lines;
        if (!isObj(l) || !Number.isInteger(l.start) || !Number.isInteger(l.end))
          sink.add('SCHEMA_INVALID_TYPE', join(p, 'lines'));
        else if ((l.start as number) < 1 || (l.end as number) < (l.start as number))
          sink.add('SCHEMA_CUSTOM', join(p, 'lines'));
      }
    } else if (entry.kind === 'conversations') {
      strictKeys(entry, ['kind', 'count', 'total', 'set_hash'], p, sink);
      const c = entry.count;
      const t = entry.total;
      if (typeof c !== 'number' || !Number.isInteger(c)) sink.add('SCHEMA_INVALID_TYPE', join(p, 'count'));
      else if (c < 0) sink.add('SCHEMA_TOO_SMALL', join(p, 'count'));
      if (typeof t !== 'number' || !Number.isInteger(t)) sink.add('SCHEMA_INVALID_TYPE', join(p, 'total'));
      else if (t < 1) sink.add('SCHEMA_TOO_SMALL', join(p, 'total'));
      if (
        typeof c === 'number' &&
        typeof t === 'number' &&
        Number.isInteger(c) &&
        Number.isInteger(t) &&
        c > t
      )
        sink.add('SCHEMA_CUSTOM', join(p, 'count'));
      if (typeof entry.set_hash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.set_hash))
        sink.add('SCHEMA_INVALID_FORMAT', join(p, 'set_hash'));
    } else {
      strictKeys(entry, ['kind', 'words', 'date'], p, sink);
      const w = entry.words;
      if (typeof w !== 'string') sink.add('SCHEMA_INVALID_TYPE', join(p, 'words'));
      else if (w.length > 1000) sink.add('SCHEMA_TOO_BIG', join(p, 'words'));
      else if (w.trim() === '') sink.add('SCHEMA_CUSTOM', join(p, 'words'));
      if (typeof entry.date !== 'string' || !realDay(entry.date))
        sink.add('SCHEMA_INVALID_FORMAT', join(p, 'date'));
    }
  });
}

function value(v: unknown, path: string, sink: Sink): void {
  if (!isObj(v)) {
    sink.add('SCHEMA_INVALID_TYPE', path);
    return;
  }
  strictKeys(
    v,
    [
      'id',
      'title',
      'weight',
      'required',
      'approved',
      'produced_by',
      'provenance',
      'polarity',
      'when',
      'unless',
      'limit',
      'within',
      'priority',
    ],
    path,
    sink,
  );
  if (typeof v.id !== 'string') sink.add('SCHEMA_INVALID_TYPE', join(path, 'id'));
  else if (!ID.test(v.id)) sink.add('SCHEMA_INVALID_FORMAT', join(path, 'id'));
  text(v, 'title', path, sink);
  if (v.weight !== undefined) {
    if (typeof v.weight !== 'number' || !Number.isFinite(v.weight))
      sink.add('SCHEMA_INVALID_TYPE', join(path, 'weight'));
    else if (v.weight < 0) sink.add('SCHEMA_TOO_SMALL', join(path, 'weight'));
  }
  bool(v, 'required', path, sink, false);
  bool(v, 'approved', path, sink, false);
  if (v.produced_by !== undefined) oneOf(v, 'produced_by', PRODUCERS, path, sink, false);
  if (v.provenance !== undefined) provenance(v.provenance, join(path, 'provenance'), sink);
  if (v.polarity !== undefined) oneOf(v, 'polarity', ['must', 'must_not'], path, sink, false);
  if (v.priority !== undefined) oneOf(v, 'priority', ['first'], path, sink, false);
  for (const key of ['when', 'unless'] as const) {
    const m = v[key];
    if (m === undefined) continue;
    if (!isObj(m)) {
      sink.add('SCHEMA_INVALID_TYPE', join(path, key));
      continue;
    }
    for (const [name, list] of Object.entries(m)) {
      if (!Array.isArray(list) || list.some((x) => typeof x !== 'string'))
        sink.add('SCHEMA_INVALID_TYPE', join(join(path, key), name));
      else if (list.length === 0) sink.add('SCHEMA_TOO_SMALL', join(join(path, key), name));
    }
  }
  if (v.limit !== undefined) {
    if (typeof v.limit !== 'number' || !Number.isInteger(v.limit))
      sink.add('SCHEMA_INVALID_TYPE', join(path, 'limit'));
    else if (v.limit <= 0) sink.add('SCHEMA_TOO_SMALL', join(path, 'limit'));
  }
  if (v.within !== undefined) {
    if (!isObj(v.within) || typeof v.within.minutes !== 'number')
      sink.add('SCHEMA_INVALID_TYPE', join(path, 'within'));
    else if (v.within.minutes <= 0) sink.add('SCHEMA_TOO_SMALL', join(join(path, 'within'), 'minutes'));
  }
}

function boundary(b: unknown, path: string, sink: Sink): void {
  if (!isObj(b)) {
    sink.add('SCHEMA_INVALID_TYPE', path);
    return;
  }
  strictKeys(b, ['holds', 'fails', 'edge', 'limit', 'comparison', 'unit', 'provenance'], path, sink);
  for (const k of ['holds', 'fails', 'edge']) {
    if (typeof b[k] !== 'string') sink.add('SCHEMA_INVALID_TYPE', join(path, k));
  }
  let limitOk = true;
  if (b.limit !== undefined) {
    if (typeof b.limit !== 'number' || !Number.isFinite(b.limit)) {
      sink.add('SCHEMA_INVALID_TYPE', join(path, 'limit'));
      limitOk = false;
    }
  }
  if (b.comparison !== undefined) oneOf(b, 'comparison', COMPARISONS, path, sink, false);
  if (b.unit !== undefined) text(b, 'unit', path, sink, false);
  if (limitOk && (b.limit !== undefined) !== (b.comparison !== undefined)) sink.add('SCHEMA_CUSTOM', path);
  if (b.unit !== undefined && b.limit === undefined) sink.add('SCHEMA_CUSTOM', path);
  if (b.provenance !== undefined) provenance(b.provenance, join(path, 'provenance'), sink);
}

function schema(root: unknown, sink: Sink): void {
  if (!isObj(root)) {
    sink.add('SCHEMA_INVALID_TYPE', '');
    return;
  }
  strictKeys(
    root,
    ['format', 'agent', 'version', 'inventory', 'prior', 'variables', 'constraints'],
    '',
    sink,
  );
  if (root.format === undefined) sink.add('SCHEMA_INVALID_TYPE', 'format');
  else if (root.format !== 1) sink.add('SCHEMA_INVALID_VALUE', 'format');
  text(root, 'agent', '', sink);
  text(root, 'version', '', sink);
  text(root, 'inventory', '', sink, false);
  if (root.prior !== undefined) {
    if (!isObj(root.prior)) sink.add('SCHEMA_INVALID_TYPE', 'prior');
    else {
      strictKeys(root.prior, ['kind', 'source'], 'prior', sink);
      oneOf(root.prior, 'kind', ['declared', 'fitted'], 'prior', sink, true);
      if (root.prior.source !== undefined) text(root.prior, 'source', 'prior', sink, false);
    }
  }
  if (!Array.isArray(root.variables)) sink.add('SCHEMA_INVALID_TYPE', 'variables');
  else {
    if (root.variables.length === 0) sink.add('SCHEMA_TOO_SMALL', 'variables');
    root.variables.forEach((v, i) => {
      const p = join('variables', i);
      if (!isObj(v)) {
        sink.add('SCHEMA_INVALID_TYPE', p);
        return;
      }
      strictKeys(
        v,
        [
          'id',
          'title',
          'kind',
          'role',
          'scope',
          'approved',
          'produced_by',
          'provenance',
          'values',
          'boundaries',
        ],
        p,
        sink,
      );
      if (typeof v.id !== 'string') sink.add('SCHEMA_INVALID_TYPE', join(p, 'id'));
      else if (!ID.test(v.id)) sink.add('SCHEMA_INVALID_FORMAT', join(p, 'id'));
      text(v, 'title', p, sink);
      oneOf(v, 'kind', KINDS, p, sink, true);
      oneOf(v, 'role', ROLES, p, sink, true);
      if (v.scope !== undefined) oneOf(v, 'scope', ['conversation', 'turn'], p, sink, false);
      bool(v, 'approved', p, sink, true);
      if (v.produced_by !== undefined) oneOf(v, 'produced_by', PRODUCERS, p, sink, false);
      if (v.provenance !== undefined) provenance(v.provenance, join(p, 'provenance'), sink);
      if (!Array.isArray(v.values)) sink.add('SCHEMA_INVALID_TYPE', join(p, 'values'));
      else {
        if (v.values.length === 0) sink.add('SCHEMA_TOO_SMALL', join(p, 'values'));
        v.values.forEach((x, j) => {
          value(x, join(join(p, 'values'), j), sink);
        });
      }
      if (v.boundaries !== undefined) {
        if (!Array.isArray(v.boundaries)) sink.add('SCHEMA_INVALID_TYPE', join(p, 'boundaries'));
        else {
          v.boundaries.forEach((b, j) => {
            boundary(b, join(join(p, 'boundaries'), j), sink);
          });
        }
      }
    });
  }
  if (root.constraints !== undefined) {
    if (!Array.isArray(root.constraints)) sink.add('SCHEMA_INVALID_TYPE', 'constraints');
    else {
      root.constraints.forEach((c, i) => {
        const p = join('constraints', i);
        if (!isObj(c)) {
          sink.add('SCHEMA_INVALID_TYPE', p);
          return;
        }
        strictKeys(c, ['forbid', 'reason', 'approved', 'produced_by', 'provenance'], p, sink);
        if (!isObj(c.forbid) || Object.values(c.forbid).some((x) => typeof x !== 'string'))
          sink.add('SCHEMA_INVALID_TYPE', join(p, 'forbid'));
        text(c, 'reason', p, sink);
        bool(c, 'approved', p, sink, true);
        if (c.produced_by !== undefined) oneOf(c, 'produced_by', PRODUCERS, p, sink, false);
        if (c.provenance !== undefined) provenance(c.provenance, join(p, 'provenance'), sink);
      });
    }
  }
}

type V = {
  id: string;
  kind: string;
  role: string;
  values: Array<{
    id: string;
    weight?: number;
    when?: Record<string, string[]>;
    unless?: Record<string, string[]>;
    provenance?: unknown[];
  }>;
  boundaries?: Array<Obj>;
  provenance?: unknown[];
};

function references(store: Obj, sink: Sink): FileIssue[] {
  const variables = store.variables as V[];
  const constraints = (store.constraints ?? []) as Array<{
    forbid: Record<string, string>;
    provenance?: unknown[];
  }>;
  const warnings: FileIssue[] = [];
  const index = new Map<string, number>();
  variables.forEach((v, i) => {
    if (index.has(v.id)) sink.add('VARIABLES_DUPLICATE', join(join('variables', i), 'id'));
    else index.set(v.id, i);
  });
  const valuesOf = (id: string): Set<string> | undefined => {
    const i = index.get(id);
    return i === undefined ? undefined : new Set(variables[i]?.values.map((x) => x.id));
  };
  variables.forEach((v, i) => {
    const seen = new Set<string>();
    v.values.forEach((x, j) => {
      if (seen.has(x.id))
        sink.add('VARIABLES_DUPLICATE', join(join(join('variables', i), 'values'), `${j}.id`));
      seen.add(x.id);
    });
  });
  // Kinds that may appear once among the axes.
  const onceKinds = new Set<string>();
  variables.forEach((v, i) => {
    if (v.role !== 'axis') return;
    if (['stage', 'deviation', 'channel'].includes(v.kind)) {
      if (onceKinds.has(v.kind)) sink.add('VARIABLES_KIND_REPEATED', join(join('variables', i), 'kind'));
      onceKinds.add(v.kind);
    }
  });
  // A value id sits in one axis only among the axes of kind behaviour, persona, data and task together.
  const named = new Set<string>();
  variables.forEach((v, i) => {
    if (v.role !== 'axis' || !['behaviour', 'persona', 'data', 'task'].includes(v.kind)) return;
    const own = new Set<string>();
    v.values.forEach((x, j) => {
      if (x.id !== 'none' && named.has(x.id) && !own.has(x.id))
        sink.add('VARIABLES_AMBIGUOUS_VALUE', join(join(join('variables', i), 'values'), `${j}.id`));
      own.add(x.id);
    });
    for (const id of own) named.add(id);
  });
  variables.forEach((v, i) => {
    if (v.role === 'axis' && v.kind === 'deviation') {
      v.values.forEach((x, j) => {
        if (!DEVIATIONS.includes(x.id))
          sink.add('VARIABLES_UNKNOWN_DEVIATION', join(join(join('variables', i), 'values'), `${j}.id`));
      });
    }
  });
  const prior = store.prior as Obj | undefined;
  if (prior?.kind === 'fitted' && prior.source === undefined)
    sink.add('VARIABLES_PRIOR_SOURCE', 'prior.source');
  // when / unless
  variables.forEach((v, i) => {
    v.values.forEach((x, j) => {
      for (const key of ['when', 'unless'] as const) {
        const m = x[key];
        if (!m) continue;
        for (const [name, list] of Object.entries(m)) {
          const known = valuesOf(name);
          const p = join(join(join(join('variables', i), 'values'), j), key);
          if (!known) sink.add('VARIABLES_UNKNOWN_VARIABLE', join(p, name));
          else
            list.forEach((val, k) => {
              if (!known.has(val)) sink.add('VARIABLES_UNKNOWN_VALUE', join(join(p, name), k));
            });
        }
      }
    });
    (v.boundaries ?? []).forEach((b, k) => {
      const known = new Set(v.values.map((x) => x.id));
      const p = join(join(join('variables', i), 'boundaries'), k);
      for (const side of ['holds', 'fails', 'edge'] as const)
        if (!known.has(b[side] as string)) sink.add('VARIABLES_UNKNOWN_VALUE', join(p, side));
      if (known.has(b.holds as string) && known.has(b.fails as string) && known.has(b.edge as string)) {
        if (b.holds === b.fails) sink.add('VARIABLES_BOUNDARY', join(p, 'fails'));
        else if (b.comparison !== undefined) {
          const strict = b.comparison === 'gt' || b.comparison === 'lt';
          if ((strict && b.edge === b.holds) || (!strict && b.edge === b.fails))
            sink.add('VARIABLES_BOUNDARY', join(p, 'edge'));
        }
      }
    });
    // weights
    const weighted = v.values.filter((x) => x.weight !== undefined);
    if (weighted.length > 0 && weighted.length < v.values.length) {
      const first = v.values.findIndex((x) => x.weight === undefined);
      sink.add('VARIABLES_WEIGHT_INCOMPLETE', join(join(join('variables', i), 'values'), `${first}.weight`));
    } else if (weighted.length > 0 && weighted.every((x) => x.weight === 0)) {
      sink.add('VARIABLES_WEIGHT_ZERO', join(join('variables', i), 'values'));
    }
  });
  // constraints
  const seenForbid = new Set<string>();
  constraints.forEach((c, i) => {
    const p = join('constraints', i);
    const entries = Object.entries(c.forbid);
    if (entries.length === 0) {
      sink.add('VARIABLES_EMPTY_CONSTRAINT', join(p, 'forbid'));
      return;
    }
    for (const [name, val] of entries) {
      const known = valuesOf(name);
      if (!known) sink.add('VARIABLES_UNKNOWN_VARIABLE', join(join(p, 'forbid'), name));
      else if (!known.has(val)) sink.add('VARIABLES_UNKNOWN_VALUE', join(join(p, 'forbid'), name));
    }
    const key = JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
    if (seenForbid.has(key)) sink.add('VARIABLES_DUPLICATE', p);
    seenForbid.add(key);
  });
  if (sink.issues.length === 0) {
    // Grid: some cell of the axes avoids every constraint that names axes only.
    const axes = variables.filter((v) => v.role === 'axis');
    const axisIds = new Set(axes.map((a) => a.id));
    const relevant = constraints
      .map((c) => c.forbid)
      .filter((f) => Object.keys(f).every((k) => axisIds.has(k)));
    const cell: Record<string, string> = {};
    const walk = (i: number): boolean => {
      if (i === axes.length) return true;
      const a = axes[i] as V;
      for (const x of a.values) {
        cell[a.id] = x.id;
        const cut = relevant.some((f) => Object.entries(f).every(([k, val]) => cell[k] === val));
        if (!cut && walk(i + 1)) return true;
      }
      delete cell[a.id];
      return false;
    };
    if (axes.length > 0 && !walk(0)) sink.add('VARIABLES_GRID_EMPTY', 'constraints');
  }
  // advice
  variables.forEach((v, i) => {
    v.values.forEach((x, j) => {
      if (!x.provenance || x.provenance.length === 0)
        warnings.push({ code: 'VARIABLES_UNSOURCED', path: join(join(join('variables', i), 'values'), j) });
    });
    (v.boundaries ?? []).forEach((b, k) => {
      if (!b.provenance || (b.provenance as unknown[]).length === 0)
        warnings.push({
          code: 'VARIABLES_UNSOURCED',
          path: join(join(join('variables', i), 'boundaries'), k),
        });
    });
  });
  constraints.forEach((c, i) => {
    if (!c.provenance || c.provenance.length === 0)
      warnings.push({ code: 'VARIABLES_UNSOURCED', path: join('constraints', i) });
  });
  return warnings;
}

export function validate(input: unknown): ValidateResult {
  const sink = new Sink();
  schema(input, sink);
  if (sink.issues.length > 0) return { ok: false, errors: sink.issues };
  const warnings = references(input as Obj, sink);
  if (sink.issues.length > 0) return { ok: false, errors: sink.issues };
  return { ok: true, store: input, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// The quote check.

/** Switches the mutation tests turn on to break the quote check in one place; all off by default. */
export const quoteMutation = {
  skipWhitespace: false,
  skipZeroWidth: false,
  skipTypographic: false,
  skipNormalize: false,
  skipBackslash: false,
  ignoreCase: false,
  perQuoteUnreadable: false,
  ignoreHash: false,
};

export function fold(text: string): string {
  let t = text;
  if (!quoteMutation.skipBackslash) t = t.replace(/\\([\\`*_{}[\]()#+\-.!|<>~"'])/g, '$1');
  if (!quoteMutation.skipZeroWidth) t = t.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '');
  if (!quoteMutation.skipNormalize) t = t.normalize('NFC');
  if (!quoteMutation.skipTypographic)
    t = t.replace(/[\u2018\u2019\u201a\u201b]/g, "'").replace(/[\u201c\u201d\u201e\u201f]/g, '"');
  if (!quoteMutation.skipWhitespace) t = t.replace(/\s+/g, ' ').trim();
  if (quoteMutation.ignoreCase) t = t.toLowerCase();
  return t;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Obj)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

function resolvePointer(doc: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === '') return { found: true, value: doc };
  let cur: unknown = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= cur.length) return { found: false };
      cur = cur[Number(key)];
    } else if (isObj(cur) && Object.hasOwn(cur, key)) cur = cur[key];
    else return { found: false };
  }
  return { found: true, value: cur };
}

function parseDoc(text: string): { ok: boolean; value?: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    try {
      const v = parseYaml(text);
      return typeof v === 'object' && v !== null ? { ok: true, value: v } : { ok: false };
    } catch {
      return { ok: false };
    }
  }
}

export function quotes(store: FileStore, files: Record<string, string>): QuotesResult {
  const errors: FileIssue[] = [];
  const reported = new Set<string>();
  const folded = new Map<string, string>();
  const entries: Array<{ entry: Obj; path: string }> = [];
  const collect = (list: unknown, base: string): void => {
    if (!Array.isArray(list)) return;
    list.forEach((e, i) => {
      entries.push({ entry: e as Obj, path: join(base, i) });
    });
  };
  store.variables.forEach((v, i) => {
    const vp = join('variables', i);
    collect(v.provenance, join(vp, 'provenance'));
    v.values.forEach((x, j) => {
      collect(x.provenance, join(join(join(vp, 'values'), j), 'provenance'));
    });
    (v.boundaries ?? []).forEach((b, k) => {
      collect(b.provenance, join(join(join(vp, 'boundaries'), k), 'provenance'));
    });
  });
  (store.constraints ?? []).forEach((c, i) => {
    collect(c.provenance, join(join('constraints', i), 'provenance'));
  });
  for (const { entry, path } of entries) {
    const p = path;
    if (entry.kind !== 'quote' && entry.kind !== 'structure') continue;
    const file = entry.path as string;
    const text = Object.hasOwn(files, file) ? files[file] : undefined;
    if (text === undefined) {
      if (!reported.has(file) || quoteMutation.perQuoteUnreadable) {
        reported.add(file);
        errors.push({ code: 'VARIABLES_SOURCE_UNREADABLE', path: join(p, 'path') });
      }
      continue;
    }
    if (entry.kind === 'quote') {
      let f = folded.get(file);
      if (f === undefined) {
        f = fold(text);
        folded.set(file, f);
      }
      if (!f.includes(fold(entry.quote as string)))
        errors.push({ code: 'VARIABLES_QUOTE_NOT_FOUND', path: join(p, 'quote') });
    } else if (entry.pointer !== undefined) {
      const doc = parseDoc(text);
      const hit = doc.ok ? resolvePointer(doc.value, entry.pointer as string) : { found: false };
      if (!hit.found) errors.push({ code: 'VARIABLES_POINTER_UNRESOLVED', path: join(p, 'pointer') });
      else if (
        !quoteMutation.ignoreHash &&
        createHash('sha256').update(canonical(hit.value)).digest('hex') !== entry.hash
      )
        errors.push({ code: 'VARIABLES_HASH_MISMATCH', path: join(p, 'hash') });
    } else {
      const lines = text.split(/\r?\n/);
      const { start, end } = entry.lines as { start: number; end: number };
      if (end > lines.length) errors.push({ code: 'VARIABLES_POINTER_UNRESOLVED', path: join(p, 'lines') });
      else if (
        createHash('sha256')
          .update(lines.slice(start - 1, end).join('\n'))
          .digest('hex') !== entry.hash
      )
        errors.push({ code: 'VARIABLES_HASH_MISMATCH', path: join(p, 'hash') });
    }
  }
  return { errors };
}
