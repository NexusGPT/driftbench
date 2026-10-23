import type { Aspect, Link, LinkKind, Loaded, ModelCoverage, Part } from '@agent-nexus/driftbench-core';
import { capKey, refKey, type Spec, type UnitKey } from './spec';

/**
 * The common model as the tests see it: parts with aspects and a load time, typed links, and coverage. The types
 * are the core package's (step 1 of the common model); the reader that fills them is step 2. This module holds
 * (1) what each role of a generated setup must be in the model, written from the definitions of the vocabulary,
 * (2) the findings derived from parts and links alone, with no type name and no path, and (3) the view a spec
 * must give. A reader of step 2 is correct when its view equals `viewOf(spec)` and its findings equal
 * `findingsOf(view)`.
 */

export type ModelView = { parts: Part[]; links: Link[]; coverage: ModelCoverage };

export type Role = 'instruction' | 'capability' | 'reference';

/**
 * What a part of each role is, by the vocabulary's own definitions: the standing instruction is text the model
 * reads and the runtime loads before every turn; a capability is text the model reads when it asks for it; a
 * reference is facts the model retrieves, only when a capability points at it.
 */
export const ROLE: Record<Role, { aspects: Aspect[]; loaded: Loaded }> = {
  instruction: { aspects: ['instructs'], loaded: { when: 'always' } },
  capability: { aspects: ['instructs'], loaded: { when: 'on-demand' } },
  reference: { aspects: ['informs'], loaded: { when: 'by-reference' } },
};

/** The link kinds that make a part reachable from another: the source brings the target into the model's reach. */
export const REACHING: readonly LinkKind[] = ['includes', 'references', 'routes-to', 'loads', 'delegates-to'];

/** An unresolved link: a `references` link the reader found whose target is no part. */
export type Unresolved = { from: string; to: string };

export type Findings = {
  /** Links that name no part. */
  unresolved: Unresolved[];
  /** Parts no link brings into reach and that the runtime does not load by itself. */
  orphans: string[];
  /** Parts not reachable from a part loaded `always`, orphans left out. */
  unreachable: string[];
};

const idOf = (key: UnitKey) => key;

/**
 * The findings of a view, from parts and links only. A part is reached when a part loaded `always` points at it
 * through a reaching link, directly or through other parts. A part loaded `always` is reached by itself. A part
 * with no incoming reaching link that is not loaded `always` is an orphan; one with an incoming link that no
 * `always` part reaches is unreachable. A part loaded `on-demand` (a capability the runtime lists by its
 * description) is never an orphan, but it is unreachable until a part reached from an `always` part points at it.
 */
export function findingsOf(view: ModelView): Findings {
  const ids = new Set(view.parts.map((part) => part.id));
  const reaching = view.links.filter((link) => REACHING.includes(link.kind));
  const unresolved = view.links
    .filter((link) => link.kind === 'references' && !ids.has(link.to))
    .map((link) => ({ from: link.from, to: link.to }));
  const pointedAt = new Set(reaching.filter((link) => ids.has(link.to)).map((link) => link.to));
  const roots = view.parts.filter((part) => part.loaded.when === 'always').map((part) => part.id);
  const reached = new Set(roots);
  const queue = [...roots];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as string;
    for (const link of reaching) {
      if (link.from !== id || !ids.has(link.to) || reached.has(link.to)) continue;
      reached.add(link.to);
      queue.push(link.to);
    }
  }
  const orphans = view.parts
    .filter((part) => part.loaded.when !== 'always' && !pointedAt.has(part.id))
    .filter((part) => part.loaded.when !== 'on-demand')
    .map((part) => part.id)
    .sort();
  const orphanSet = new Set(orphans);
  const unreachable = view.parts
    .filter((part) => part.loaded.when !== 'always' && !reached.has(part.id) && !orphanSet.has(part.id))
    .map((part) => part.id)
    .sort();
  return { unresolved, orphans, unreachable };
}

// The view a spec must give ------------------------------------------------------------------------------------------

const part = (id: string, role: Role, name: string): Part => ({
  id,
  type: role,
  runtime: 'claude-code',
  path: id,
  name,
  aspects: [...ROLE[role].aspects],
  loaded: ROLE[role].loaded,
  fields: {},
});

const link = (from: string, to: string, kind: LinkKind): Link => ({
  from,
  to,
  kind,
  provenance: { reader: 'expected', file: from },
  confidence: 1,
});

/**
 * The parts and links a spec means: the instruction, a capability per capability, a reference per reference. A
 * capability's `references` link points at the reference of the exact name it writes; a link written in other
 * letters points at a name no part has. The id of a part is its unit key, the same in every layout.
 */
export function viewOf(spec: Spec): ModelView {
  const parts: Part[] = [part(idOf('instruction:main'), 'instruction', 'main')];
  const links: Link[] = [];
  for (const cap of spec.caps) {
    parts.push(part(capKey(cap), 'capability', cap.name));
    links.push(link('instruction:main', capKey(cap), 'routes-to'));
    for (const ref of cap.refs) parts.push(part(refKey(cap, ref), 'reference', ref.stem));
    for (const written of cap.links) {
      const target = cap.refs.find((ref) => ref.stem === written.ref && ref.stored === written.written);
      const to = target ? refKey(cap, target) : `reference:${cap.name}:${written.ref}:${written.written}`;
      links.push(link(capKey(cap), to, 'references'));
    }
  }
  return { parts, links, coverage: { covered: parts.length, unknown: [], skipped: [] } };
}
