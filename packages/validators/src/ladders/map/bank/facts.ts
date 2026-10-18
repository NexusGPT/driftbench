import { canonicalJson } from '@agent-nexus/driftbench-core';
import type { Proposal } from '@agent-nexus/driftbench-generate';
import { fold, forbidKey } from '../truth';
import { asModelWrites, type Planted } from './perfect';

/**
 * A map as a set of facts, so an item compares the extractor's proposal with what the generator planted, up
 * to quotes and titles. The same vocabulary is written from the planted entries (the expected facts) and read
 * from the proposal (the actual facts); an item passes when the two sets are equal over the parts it checks.
 */

/** Keys a richer contract may carry on a value; read from the proposal whenever present. */
export const VALUE_FIELDS = [
  'polarity',
  'when',
  'unless',
  'limit',
  'within',
  'priority',
  'weight',
  'required',
] as const;

export type Parts = {
  /** Dimensions, values and their kinds. */
  values?: boolean;
  /** Only the dimensions this predicate keeps (all when absent). */
  dimension?: (id: string) => boolean;
  /** produced_by of every value, constraint and relation. */
  produced?: boolean;
  /** The value fields of VALUE_FIELDS: all of them, or only those listed. */
  fields?: boolean | readonly string[];
  roles?: boolean;
  constraints?: boolean;
  phrases?: boolean;
  relations?: boolean;
};

export const ALL: Parts = {
  values: true,
  produced: true,
  fields: true,
  roles: false,
  constraints: true,
  phrases: true,
  relations: true,
};

/** A relation without its evidence and flags: what it says. */
function relationBody(relation: Record<string, unknown>): string {
  const { evidence: _e, produced_by: _p, approved: _a, source: _s, quote: _q, ...body } = relation;
  return canonicalJson(body);
}

/** Whether the parts check one value field. */
function fieldOn(parts: Parts, field: string): boolean {
  return Array.isArray(parts.fields) ? parts.fields.includes(field) : parts.fields === true;
}

/** The facts a proposal holds. */
export function proposalFacts(proposal: Proposal, parts: Parts): Set<string> {
  const facts = new Set<string>();
  const keep = parts.dimension ?? (() => true);
  for (const dimension of proposal.dimensions) {
    if (!keep(dimension.id)) continue;
    if (parts.values) facts.add(`dimension ${dimension.id} (${dimension.kind})`);
    if (parts.roles) facts.add(`role ${dimension.id} = ${dimension.role}`);
    for (const value of dimension.values) {
      const key = `${dimension.id}/${value.id}`;
      if (parts.values) facts.add(`value ${key}`);
      if (parts.produced) facts.add(`by ${key} = ${value.produced_by}`);
      if (parts.fields) {
        const record = value as unknown as Record<string, unknown>;
        for (const field of VALUE_FIELDS) {
          if (!fieldOn(parts, field)) continue;
          if (record[field] !== undefined) facts.add(`${field} ${key} = ${canonicalJson(record[field])}`);
        }
      }
    }
  }
  if (parts.constraints) {
    for (const constraint of proposal.constraints) {
      facts.add(`constraint ${forbidKey(constraint.forbid)}`);
      if (parts.produced)
        facts.add(`by constraint ${forbidKey(constraint.forbid)} = ${constraint.produced_by}`);
    }
  }
  if (parts.phrases) {
    for (const phrase of proposal.phrases) {
      facts.add(`phrase ${phrase.dimension}/${phrase.value} [${phrase.lang}] ${fold(phrase.text)}`);
    }
  }
  if (parts.relations) {
    for (const relation of proposal.relations ?? []) {
      const body = relationBody(relation as unknown as Record<string, unknown>);
      facts.add(`relation ${body}`);
      if (parts.produced) facts.add(`by relation ${body} = ${relation.produced_by}`);
    }
  }
  return facts;
}

/** An entry code proposes from a structured file, with no model: the expected side of the pre-pass. */
export type CodeEntry =
  | {
      type: 'value';
      dimension: string;
      kind: string;
      value: string;
      role?: 'axis' | 'detail';
      /** The quote the value must carry, whole: folded unless `exact`. */
      quote?: string;
      exact?: boolean;
      /** Text the value's title must hold. */
      titleIncludes?: string;
    }
  | { type: 'constraint'; forbid: Record<string, string> }
  | { type: 'relation'; relation: Record<string, unknown> };

/** The facts the planted entries and the code entries make, over the parts asked for. */
export function expectedFacts(
  planted: readonly Planted[],
  code: readonly CodeEntry[],
  parts: Parts,
): Set<string> {
  const facts = new Set<string>();
  const keep = parts.dimension ?? (() => true);
  const value = (
    dimension: string,
    kind: string,
    id: string,
    by: string,
    fields?: Record<string, unknown>,
  ) => {
    if (!keep(dimension)) return;
    if (parts.values) {
      facts.add(`dimension ${dimension} (${kind})`);
      facts.add(`value ${dimension}/${id}`);
    }
    if (parts.produced) facts.add(`by ${dimension}/${id} = ${by}`);
    if (parts.fields) {
      for (const [field, content] of Object.entries(fields ?? {})) {
        if (!fieldOn(parts, field)) continue;
        if (content !== undefined) facts.add(`${field} ${dimension}/${id} = ${canonicalJson(content)}`);
      }
    }
  };
  for (const entry of code) {
    if (entry.type === 'value') {
      value(entry.dimension, entry.kind, entry.value, 'code');
      if (parts.roles && entry.role && keep(entry.dimension))
        facts.add(`role ${entry.dimension} = ${entry.role}`);
    } else if (entry.type === 'constraint' && parts.constraints) {
      facts.add(`constraint ${forbidKey(entry.forbid)}`);
      if (parts.produced) facts.add(`by constraint ${forbidKey(entry.forbid)} = code`);
    } else if (entry.type === 'relation' && parts.relations) {
      const body = relationBody(entry.relation);
      facts.add(`relation ${body}`);
      if (parts.produced) facts.add(`by relation ${body} = code`);
    }
  }
  for (const entry of planted) {
    // A silent entry is one a reader must not report: it makes no fact.
    if (entry.silent) continue;
    if (entry.type === 'value') {
      value(entry.dimension.id, entry.dimension.kind, entry.value.id, 'model', entry.fields);
      if (parts.roles && entry.dimension.role && keep(entry.dimension.id)) {
        facts.add(`role ${entry.dimension.id} = ${entry.dimension.role}`);
      }
    } else if (entry.type === 'constraint' && parts.constraints) {
      facts.add(`constraint ${forbidKey(entry.forbid)}`);
      if (parts.produced) facts.add(`by constraint ${forbidKey(entry.forbid)} = model`);
    } else if (entry.type === 'phrase' && parts.phrases) {
      facts.add(
        `phrase ${entry.dimension}/${entry.value} [${entry.lang}] ${fold(asModelWrites(entry.text))}`,
      );
    } else if (entry.type === 'relation' && parts.relations) {
      const body = relationBody(entry.relation);
      facts.add(`relation ${body}`);
      if (parts.produced) facts.add(`by relation ${body} = model`);
    }
  }
  return facts;
}

/** What one set holds that the other does not, both ways, sorted. */
export function compareFacts(expected: ReadonlySet<string>, actual: ReadonlySet<string>) {
  return {
    lost: [...expected].filter((fact) => !actual.has(fact)).sort(),
    gained: [...actual].filter((fact) => !expected.has(fact)).sort(),
  };
}

/** A short list for an item detail. */
export function listFacts(facts: readonly string[], limit = 4): string {
  if (facts.length === 0) return 'nothing';
  const shown = facts.slice(0, limit).join('; ');
  return facts.length > limit ? `${shown}; and ${facts.length - limit} more` : shown;
}

/**
 * Prose entries whose quote is not about them: the folded quote, as a model writes it, must lie inside the
 * folded text the entry was planted with. Returns the entries that break this.
 */
export function quotesOffAnchor(proposal: Proposal, planted: readonly Planted[]): string[] {
  const out: string[] = [];
  const norm = (text: string) => fold(asModelWrites(text));
  for (const entry of planted) {
    if (entry.type !== 'value' || entry.silent) continue;
    const value = proposal.dimensions
      .find((dimension) => dimension.id === entry.dimension.id)
      ?.values.find((candidate) => candidate.id === entry.value.id);
    if (!value) continue;
    if (!norm(entry.quote).includes(norm(value.evidence.quote)) || value.evidence.source !== entry.source) {
      out.push(`${entry.dimension.id}/${entry.value.id}`);
    }
  }
  return out;
}
