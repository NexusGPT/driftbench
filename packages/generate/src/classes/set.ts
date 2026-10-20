import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { contentHash, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import type { ModelPort } from '../model/port';
import { type GateModels, type GateVerdict, gateCandidate, realiseRow } from './gate';
import {
  type Coverage,
  cellKey,
  classAxes,
  coverageOf,
  type PlanOptions,
  planClass,
  type Row,
} from './planner';
import { classHash, type UtteranceClass } from './schema';
import { vendi } from './text';

/**
 * Realising a class: one realiser call per planned row, every candidate through the gate, a rejected one tried
 * again with the gate's reason. The accepted realisations are frozen: each carries the SHA-256 of its text, and
 * the set carries one hash over the class hash and every item. A block names that set hash in `when.class`, so
 * a changed item, or a changed class file, is refused until the set is frozen again.
 */

export const SET_KIND = 'driftbench.class-set';

export type SetItem = { id: string; cell: Row; text: string; sha: string };

export type GateSummary = {
  planned: number;
  candidates: number;
  accepted: number;
  /** Rejections by the first stage that refused the candidate. */
  rejectedBy: Record<string, number>;
  /** Planned rows with no accepted realisation after every attempt. */
  unfilled: number;
  /** Coverage of the strength-t tuples by the accepted items (the post-gate coverage). */
  coverage: Coverage;
  /** Vendi score of the accepted texts (4-gram cosine kernel): a report figure, never a gate. */
  vendi: number;
};

export type RealisationSet = {
  kind: typeof SET_KIND;
  class: string;
  class_hash: string;
  /** 12 hex characters over the class hash and every item: what `when.class.set` names. */
  set: string;
  items: SetItem[];
  gate: GateSummary;
  produced_by: { realiser: string; judge: string; style: string };
};

export type RealiseOptions = PlanOptions & {
  realiser: ModelPort;
  models: GateModels;
  /** Attempts per planned row, the first included. Default 3. */
  attempts?: number;
  /** Called after each candidate, for progress. */
  onCandidate?: (row: number, verdict: GateVerdict) => void;
};

export type RealiseResult = { set: RealisationSet; candidates: (GateVerdict & { row: number })[] };

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const portName = (port: ModelPort) => `${port.family}/${port.model ?? 'unknown'}`;

/** The set hash: over the class id and hash and each item's id, cell and text. */
export function setHashOf(cls: string, hash: string, items: readonly SetItem[]): string {
  return contentHash({
    class: cls,
    class_hash: hash,
    items: items.map(({ id, cell, text }) => ({ id, cell, text })),
  });
}

/** Plans the class, realises and gates every row, and freezes the accepted items. */
export async function realiseClass(cls: UtteranceClass, options: RealiseOptions): Promise<RealiseResult> {
  const rows = planClass(cls, options);
  const attempts = options.attempts ?? 3;
  const accepted: { row: Row; text: string }[] = [];
  const candidates: (GateVerdict & { row: number })[] = [];
  const rejectedBy: Record<string, number> = {};
  let unfilled = 0;
  for (const [index, row] of rows.entries()) {
    let previous: { text: string; reason: string } | undefined;
    let done = false;
    for (let attempt = 0; attempt < attempts && !done; attempt++) {
      const text = await realiseRow(cls, row, index, options.realiser, previous);
      const verdict = await gateCandidate(
        cls,
        text,
        row,
        accepted.map((a) => a.text),
        options.models,
      );
      candidates.push({ ...verdict, row: index });
      options.onCandidate?.(index, verdict);
      if (verdict.accepted) {
        accepted.push({ row, text });
        done = true;
      } else {
        const stage = verdict.stages.find((s) => !s.ok)?.stage ?? 'unknown';
        rejectedBy[stage] = (rejectedBy[stage] ?? 0) + 1;
        previous = { text, reason: verdict.reason ?? stage };
      }
    }
    if (!done) unfilled += 1;
  }
  const hash = classHash(cls);
  const items = accepted.map(({ row, text }, i) => ({
    id: `r${String(i + 1).padStart(3, '0')}`,
    cell: row,
    text,
    sha: sha256(text),
  }));
  const set: RealisationSet = {
    kind: SET_KIND,
    class: cls.id,
    class_hash: hash,
    set: setHashOf(cls.id, hash, items),
    items,
    gate: {
      planned: rows.length,
      candidates: candidates.length,
      accepted: items.length,
      rejectedBy,
      unfilled,
      coverage: coverageOf(
        cls,
        items.map((item) => item.cell),
        options.t ?? cls.strength,
      ),
      vendi: vendi(items.map((item) => item.text)),
    },
    produced_by: {
      realiser: portName(options.realiser),
      judge: portName(options.models.judge),
      style: portName(options.models.style ?? options.models.judge),
    },
  };
  return { set, candidates };
}

export type SetCheck = { ok: true } | { ok: false; errors: string[] };

/**
 * Checks a frozen set against itself and its class: every item's text against its sha, the set hash against its
 * items, the class hash against the class file as it is now, and every cell against the class's axes.
 */
export function verifySet(set: RealisationSet, cls: UtteranceClass): SetCheck {
  const errors: string[] = [];
  if (set.kind !== SET_KIND) errors.push(`not a class set: kind is ${JSON.stringify(set.kind)}`);
  if (set.class !== cls.id) errors.push(`the set is for class ${set.class}, not ${cls.id}`);
  const hash = classHash(cls);
  if (set.class_hash !== hash) {
    errors.push(
      `the class file changed since the set was frozen (class hash ${hash}, set made from ${set.class_hash}): run class realise again`,
    );
  }
  const ids = new Set<string>();
  const axes = classAxes(cls);
  for (const item of set.items) {
    if (ids.has(item.id)) errors.push(`item ${item.id} is listed twice`);
    ids.add(item.id);
    if (sha256(item.text) !== item.sha)
      errors.push(`item ${item.id} changed after the set was frozen: its text no longer matches its sha`);
    for (const axis of axes) {
      if (!axis.values.includes(item.cell[axis.name] ?? ''))
        errors.push(`item ${item.id}: no ${axis.name} value in its cell`);
    }
  }
  const recomputed = setHashOf(set.class, set.class_hash, set.items);
  if (recomputed !== set.set)
    errors.push(`the set hash ${set.set} does not match its items (${recomputed}): the set was edited`);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export async function readSet(path: string): Promise<RealisationSet> {
  return JSON.parse(await readFile(path, 'utf8')) as RealisationSet;
}

/** The class block of an expanded spec: which class, set, block and realisation it measures. */
export type ClassVariant = { id: string; set: string; block: number; item: string; cell: string };

export type Expansion = { ok: true; specs: Spec[]; classBlocks: number } | { ok: false; errors: string[] };

/**
 * One copy of the spec per frozen realisation of each class block: the block sends the realisation's text (and
 * no longer names the class), and the copy records `metadata.class`. Each copy is its own spec, so each
 * realisation has its own spec hash and its own cache entries. A block that names a set hash the given set does
 * not have is refused. A spec with no class block gives no copy.
 */
export function expandClassSpec(
  spec: Spec,
  sets: ReadonlyMap<string, { set: RealisationSet; class: UtteranceClass }>,
): Expansion {
  const errors: string[] = [];
  const specs: Spec[] = [];
  let classBlocks = 0;
  spec.blocks.forEach((block, index) => {
    const when = block.when as { user?: string; class?: { id: string; set: string } };
    if (!when.class) return;
    classBlocks += 1;
    const found = sets.get(when.class.id);
    if (!found) {
      errors.push(`block ${index}: no frozen set for class ${when.class.id}`);
      return;
    }
    if (found.set.set !== when.class.set) {
      errors.push(
        `block ${index}: names set ${when.class.set} of class ${when.class.id}, the set file holds ${found.set.set}: update the block or freeze again`,
      );
      return;
    }
    const check = verifySet(found.set, found.class);
    if (!check.ok) {
      errors.push(...check.errors.map((e) => `block ${index}: ${e}`));
      return;
    }
    for (const item of found.set.items) {
      const raw = structuredClone(spec) as Spec & { metadata?: Record<string, unknown> };
      const target = raw.blocks[index] as { when: unknown };
      target.when = { user: item.text };
      raw.id = `${spec.id}.c${index}.${item.id}`;
      const variant: ClassVariant = {
        id: when.class.id,
        set: when.class.set,
        block: index,
        item: item.id,
        cell: cellKey(found.class, item.cell),
      };
      raw.metadata = { ...(raw.metadata ?? {}), class: variant };
      const result = validateSpec(raw);
      if (!result.ok) {
        errors.push(
          `block ${index} item ${item.id}: ${result.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
        );
        continue;
      }
      specs.push(result.spec);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, specs, classBlocks };
}

/** The class variant a spec records, or undefined for a spec `expandClassSpec` did not write. */
export function classVariantOf(spec: Spec): ClassVariant | undefined {
  const value = (spec.metadata as { class?: unknown } | undefined)?.class as
    | Partial<ClassVariant>
    | undefined;
  if (
    !value ||
    typeof value.id !== 'string' ||
    typeof value.item !== 'string' ||
    typeof value.block !== 'number'
  )
    return undefined;
  return value as ClassVariant;
}
