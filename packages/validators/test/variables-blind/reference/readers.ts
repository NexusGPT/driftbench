import { createHash } from 'node:crypto';
import { meaningOf, type SpanMeaning } from '../../../src/ladders/variables/blind/spans';
import type {
  ImpossiblePair,
  Provenance,
  Refusal,
  RuleDoc,
  Sources,
  StoreBoundary,
  StoreDoc,
  StoreValue,
  StoreVariable,
} from '../../../src/ladders/variables/interface';
import { fold } from './validate';

/**
 * A reference for `buildStore`, written from docs/variables.md (Reader rules R1 to R5) alone. The page does not
 * say how a condition is worded, so the reference takes the meaning of each span from the bank's own declaration.
 */

export function slug(raw: string): string {
  const s = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/_+$/g, '');
  return s === '' ? 'x' : s;
}

/**
 * What a condition span says. The page asks a reader to turn English text into a variable; the bank writes every
 * span itself and declares its meaning (blind/spans.ts), and this reference looks the declared meaning up by the
 * exact text, so no word list reads English here (.cursor/BUGBOT.md rule 1).
 */
function parseCondition(text: string): SpanMeaning | undefined {
  return meaningOf(text);
}

function fmt(n: number): string {
  return String(n).replace('-', 'm').replace('.', 'p');
}

type Var = {
  key: string;
  title: string;
  values: StoreValue[];
  byId: Map<string, StoreValue>;
  boundaries: StoreBoundary[];
};

class Builder {
  readonly vars = new Map<string, Var>();
  readonly refused: Refusal[] = [];
  readonly rules: Array<{ id: string; keys: string[] }> = [];
  readonly impossible: ImpossiblePair[] = [];
  private final: StoreVariable[] = [];
  readonly idOf = new Map<string, string>();

  variable(key: string, title: string): Var {
    let v = this.vars.get(key);
    if (!v) {
      v = { key, title, values: [], byId: new Map(), boundaries: [] };
      this.vars.set(key, v);
    }
    return v;
  }

  addValue(v: Var, value: StoreValue): StoreValue {
    const existing = v.byId.get(value.id);
    if (existing) {
      for (const p of value.provenance ?? []) addProvenance(existing, p);
      return existing;
    }
    v.values.push(value);
    v.byId.set(value.id, value);
    return value;
  }

  /** Stable ids: slugs sorted by key, a collision gets a numbered suffix. */
  finish(): StoreVariable[] {
    const groups = new Map<string, Var[]>();
    for (const v of this.vars.values()) {
      const s = slug(
        v.key
          .replace(/^[a-z]+:/, '')
          .split(String.fromCharCode(0))
          .join('_'),
      );
      const list = groups.get(s) ?? [];
      list.push(v);
      groups.set(s, list);
    }
    const used = new Set<string>();
    for (const [s, list] of groups) {
      list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      list.forEach((v, i) => {
        let id = i === 0 ? s : `${s}_${i + 1}`;
        while (used.has(id)) id = `${id}_x`;
        used.add(id);
        this.idOf.set(v.key, id);
      });
    }
    this.final = [...this.vars.values()].map((v) => ({
      id: this.idOf.get(v.key) as string,
      title: v.title,
      values: v.values,
      ...(v.boundaries.length > 0 ? { boundaries: v.boundaries } : {}),
    }));
    return this.final;
  }

  find(id: string): Var | undefined {
    for (const v of this.vars.values()) if (this.idOf.get(v.key) === id) return v;
    return undefined;
  }
}

function addProvenance(value: StoreValue, p: Provenance): void {
  const list = value.provenance ?? [];
  value.provenance = list;
  const key = JSON.stringify(p);
  if (!list.some((x) => JSON.stringify(x) === key)) list.push(p);
}

const realDay = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
};

function refuse(b: Builder, what: string, reason: string): void {
  b.refused.push({ what, reason: reason.length >= 8 ? reason : `${reason} (refused)` });
}

export function buildStore(sources: Sources): StoreDoc {
  const b = new Builder();
  const foldedFiles = new Map<string, string>();
  const findable = (path: string, quote: string): boolean => {
    const files = sources.estate?.files ?? {};
    if (!Object.hasOwn(files, path)) return false;
    let f = foldedFiles.get(path);
    if (f === undefined) {
      f = fold(files[path] as string);
      foldedFiles.set(path, f);
    }
    return f.includes(fold(quote));
  };
  const ruleKeys: Array<{ id: string; keys: string[] }> = [];
  for (const rule of sources.estate?.rules ?? []) {
    const keys: string[] = [];
    for (const c of rule.conditions) {
      if (!findable(rule.source, c.text)) {
        refuse(b, `${rule.id}: ${c.text}`, 'the condition text is not in the file it names');
        continue;
      }
      const parsed = parseCondition(c.text);
      if (!parsed) {
        refuse(b, `${rule.id}: ${c.text}`, 'the condition has no reading the reader knows');
        continue;
      }
      const prov: Provenance = { kind: 'quote', path: rule.source, quote: c.text };
      const subjectKey = fold(parsed.subject).toLowerCase();
      if (parsed.kind === 'numeric' || parsed.kind === 'range') {
        const v = b.variable(`num:${subjectKey}`, parsed.subject);
        keys.push(v.key);
        const sampleValue = (sample: number): StoreValue =>
          b.addValue(v, {
            id: `s${fmt(sample)}`,
            title: `${parsed.subject} is ${sample}`,
            sample,
            provenance: [prov],
          });
        if (parsed.kind === 'range') {
          const { lo, hi } = parsed;
          const inside = hi - lo >= 2 ? lo + 1 : lo + (hi - lo) / 2;
          for (const s of [lo - 1, lo, inside, hi, hi + 1]) sampleValue(s);
        } else {
          const { limit } = parsed;
          const below = sampleValue(limit - 1);
          const edge = sampleValue(limit);
          const above = sampleValue(limit + 1);
          if (parsed.flavour === 'cmp' && parsed.cmp) {
            const c2 = parsed.cmp;
            const holds = c2 === 'gt' || c2 === 'ge' ? above : below;
            const fails = c2 === 'gt' || c2 === 'ge' ? below : above;
            v.boundaries.push({ holds: holds.id, fails: fails.id, edge: edge.id, limit, comparison: c2 });
          }
        }
      } else if (parsed.kind === 'boolean') {
        const v = b.variable(`bool:${subjectKey}`, parsed.subject);
        keys.push(v.key);
        b.addValue(v, {
          id: 'true',
          title: `${parsed.subject} ${parsed.word}`,
          sample: true,
          provenance: [prov],
        });
        b.addValue(v, {
          id: 'false',
          title: `${parsed.subject} not ${parsed.word}`,
          sample: false,
          provenance: [prov],
        });
      } else {
        const v = b.variable(`set:${subjectKey}`, parsed.subject);
        keys.push(v.key);
        for (const item of parsed.list)
          b.addValue(v, { id: slug(item), title: item, sample: item, provenance: [prov] });
        b.addValue(v, {
          id: 'other_value',
          title: 'a value outside the list',
          sample: 'other_value',
          provenance: [prov],
        });
      }
    }
    for (const t of rule.tools) {
      const accepted: Array<{ id: string; quote: string }> = [];
      for (const val of t.values) {
        if (findable(t.source, val.quote)) accepted.push(val);
        else refuse(b, `${t.tool}.${t.field}.${val.id}`, 'the quote is not in the file it names');
      }
      if (accepted.length === 0) continue;
      const v = b.variable(`tool:${t.tool}\u0000${t.field}`, `${t.field} of ${t.tool}`);
      keys.push(v.key);
      const taken = new Set(v.values.map((x) => x.id));
      for (const val of accepted) {
        let id = slug(val.id);
        // A second raw id that normalises to a taken id of another raw id gets a numbered suffix.
        const base = id;
        let n = 1;
        const known = v.values.find((x) => x.title === val.id);
        if (known) id = known.id;
        else {
          while (taken.has(id)) {
            n += 1;
            id = `${base}_${n}`;
          }
        }
        taken.add(id);
        b.addValue(v, {
          id,
          title: val.id,
          provenance: [{ kind: 'quote', path: t.source, quote: val.quote }],
        });
      }
    }
    ruleKeys.push({ id: rule.id, keys: [...new Set(keys)] });
  }
  const variables = b.finish();
  const byId = new Map(variables.map((v) => [v.id, v]));

  // Conversations: counts only.
  const sessions = sources.conversations ?? [];
  if (sessions.length > 0) {
    const canonical = sessions
      .map((s) =>
        JSON.stringify(
          Object.keys(s.values)
            .sort()
            .map((k) => [k, s.values[k]]),
        ),
      )
      .sort();
    const setHash = createHash('sha256').update(canonical.join('\n')).digest('hex');
    const seen = new Map<string, { total: number; counts: Map<string, number> }>();
    const unknownVars = new Set<string>();
    for (const s of sessions) {
      for (const [vid, val] of Object.entries(s.values)) {
        const variable = byId.get(vid);
        if (!variable) {
          if (!unknownVars.has(vid)) {
            unknownVars.add(vid);
            refuse(b, `conversation variable ${vid}`, 'the store has no variable of this name');
          }
          continue;
        }
        const e = seen.get(vid) ?? { total: 0, counts: new Map<string, number>() };
        seen.set(vid, e);
        e.total += 1;
        e.counts.set(val, (e.counts.get(val) ?? 0) + 1);
      }
    }
    for (const [vid, e] of seen) {
      const variable = byId.get(vid) as StoreVariable;
      const ids = new Set(variable.values.map((x) => x.id));
      for (const val of e.counts.keys()) {
        if (!ids.has(val)) {
          variable.values.push({ id: val, title: val, approved: false });
          ids.add(val);
        }
      }
      for (const x of variable.values) {
        const count = e.counts.get(x.id) ?? 0;
        addProvenance(x, { kind: 'conversations', count, total: e.total, set_hash: setHash });
        x.weight = count;
      }
    }
  }

  // Owner: values, impossible pairs, weights.
  const owner = sources.owner;
  const ownerOk = (words: string, date: string): string | undefined => {
    if (typeof words !== 'string' || words.trim() === '') return 'the owner words are blank';
    if (!realDay(date)) return 'the date is not a real day written YYYY-MM-DD';
    return undefined;
  };
  const impossible: ImpossiblePair[] = [];
  const ownerIndex = new Map<string, Map<string, StoreValue>>();
  if (owner) {
    for (const o of owner.values ?? []) {
      const bad = ownerOk(o.words, o.date);
      const variable = byId.get(o.variable);
      if (bad) refuse(b, `owner value ${o.variable}.${o.value}`, bad);
      else if (!variable)
        refuse(b, `owner value ${o.variable}.${o.value}`, 'the store has no variable of this name');
      else {
        let index = ownerIndex.get(o.variable);
        if (!index) {
          index = new Map(variable.values.map((x) => [x.id, x]));
          ownerIndex.set(o.variable, index);
        }
        const existing = index.get(o.value);
        const p: Provenance = { kind: 'owner', words: o.words, date: o.date };
        if (existing) addProvenance(existing, p);
        else {
          const added: StoreValue = {
            id: slug(o.value) === o.value ? o.value : slug(o.value),
            title: o.value,
            provenance: [p],
          };
          variable.values.push(added);
          index.set(added.id, added);
        }
      }
    }
    for (const o of owner.impossible ?? []) {
      const bad = ownerOk(o.words, o.date);
      const va = byId.get(o.a.variable);
      const vb = byId.get(o.b.variable);
      const label = `owner pair ${o.a.variable}.${o.a.value} with ${o.b.variable}.${o.b.value}`;
      if (bad) refuse(b, label, bad);
      else if (!va || !vb) refuse(b, label, 'the store has no variable of this name');
      else if (!va.values.some((x) => x.id === o.a.value) || !vb.values.some((x) => x.id === o.b.value))
        refuse(b, label, 'the variable has no value of this name');
      else {
        const key = [`${o.a.variable}\u0000${o.a.value}`, `${o.b.variable}\u0000${o.b.value}`]
          .sort()
          .join('\u0001');
        if (
          !impossible.some(
            (p) =>
              [`${p.a.variable}\u0000${p.a.value}`, `${p.b.variable}\u0000${p.b.value}`]
                .sort()
                .join('\u0001') === key,
          )
        ) {
          impossible.push({
            a: { ...o.a },
            b: { ...o.b },
            provenance: [{ kind: 'owner', words: o.words, date: o.date }],
          });
        }
      }
    }
    for (const o of owner.weights ?? []) {
      const bad = ownerOk(o.words, o.date);
      const variable = byId.get(o.variable);
      const x = variable?.values.find((y) => y.id === o.value);
      const label = `owner weight ${o.variable}.${o.value}`;
      if (bad) refuse(b, label, bad);
      else if (typeof o.weight !== 'number' || !Number.isFinite(o.weight) || o.weight < 0)
        refuse(b, label, 'the weight is not a finite number from 0 up');
      else if (!x) refuse(b, label, 'the store has no value of this name');
      else {
        x.weight = o.weight;
        addProvenance(x, { kind: 'owner', words: o.words, date: o.date });
      }
    }
  }

  const rules: RuleDoc[] = ruleKeys.map((r) => ({
    id: r.id,
    variables: r.keys.map((k) => b.idOf.get(k) as string),
  }));
  return { variables, impossible, rules, refused: b.refused };
}
