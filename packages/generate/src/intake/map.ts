import { readFile } from 'node:fs/promises';
import { loadSpaceMap } from '@agent-nexus/driftbench-space';
import { parse as parseYaml } from 'yaml';
import { loadProposal, valueApproved } from '../extract/proposal';

/**
 * The map as intake reads it: the approved dimensions, values, constraints and phrases. A map is either a
 * proposal from `driftbench extract` (only its approved entries count, the owner's rule: nothing counts
 * until a person approves it; a value inherits its dimension's flag unless it sets its own) or a
 * hand-written space map from `@agent-nexus/driftbench-space` (all of it counts, every dimension an axis).
 */

export type IntakeValue = { id: string; title: string };
export type IntakeDimension = {
  id: string;
  title: string;
  kind: string;
  /**
   * axis: a dimension of the space map; detail: varied inside a cell. Intake reads both: an intent or a
   * persona trait can be a detail and still name what a user wants or who they are.
   */
  role: 'axis' | 'detail';
  values: IntakeValue[];
};
export type IntakeMap = {
  agent: string;
  dimensions: IntakeDimension[];
  constraints: Array<{ forbid: Record<string, string>; reason: string }>;
  /** Approved phrases: text a user may write for a value. Used as intent prototypes. */
  phrases: Array<{ dimension: string; value: string; text: string }>;
};

export type MapResult = { ok: true; map: IntakeMap } | { ok: false; errors: string[] };

/** Reads a proposal or a space map. A proposal's quotes are checked against their sources. */
export async function loadIntakeMap(path: string): Promise<MapResult> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [`cannot read the map: ${firstLine(cause)}`] };
  }
  const isProposal = typeof raw === 'object' && raw !== null && 'produced_by' in raw && 'sources' in raw;
  if (isProposal) {
    const loaded = await loadProposal(path);
    if (!loaded.ok) {
      return {
        ok: false,
        errors: loaded.errors.map((error) => `${error.path || '(file)'} ${error.code} ${error.message}`),
      };
    }
    const { proposal } = loaded;
    const dimensions = proposal.dimensions
      .map((dimension) => ({
        id: dimension.id,
        title: dimension.title,
        kind: dimension.kind,
        role: dimension.role,
        values: dimension.values
          .filter((value) => valueApproved(dimension, value))
          .map((value) => ({ id: value.id, title: value.title })),
      }))
      .filter((dimension) => dimension.values.length > 0);
    const approvedValue = (dimension: string, value: string) =>
      dimensions.some((d) => d.id === dimension && d.values.some((v) => v.id === value));
    return {
      ok: true,
      map: {
        agent: proposal.agent,
        dimensions,
        constraints: proposal.constraints
          .filter((constraint) => constraint.approved)
          .filter((constraint) => Object.entries(constraint.forbid).every(([d, v]) => approvedValue(d, v)))
          .map((constraint) => ({ forbid: constraint.forbid, reason: constraint.reason })),
        phrases: proposal.phrases
          .filter((phrase) => phrase.approved && approvedValue(phrase.dimension, phrase.value))
          .map((phrase) => ({ dimension: phrase.dimension, value: phrase.value, text: phrase.text })),
      },
    };
  }
  const loaded = await loadSpaceMap(path);
  if (!loaded.ok) {
    return {
      ok: false,
      errors: loaded.errors.map((error) => `${error.path || '(file)'} ${error.code} ${error.message}`),
    };
  }
  return {
    ok: true,
    map: {
      agent: loaded.map.agent,
      dimensions: loaded.map.dimensions.map((dimension) => ({
        id: dimension.id,
        title: dimension.title,
        kind: dimension.kind,
        role: 'axis' as const,
        values: dimension.values.map((value) => ({ id: value.id, title: value.title })),
      })),
      constraints: loaded.map.constraints.map((constraint) => ({ ...constraint })),
      phrases: [],
    },
  };
}

/**
 * The dimension that names what a user wants: the one given, else `flow`, else `intent`, else the first
 * dimension of kind behaviour. Undefined when the map has none.
 */
export function intentDimension(map: IntakeMap, id?: string): IntakeDimension | undefined {
  if (id !== undefined) return map.dimensions.find((dimension) => dimension.id === id);
  return (
    map.dimensions.find((dimension) => dimension.id === 'flow') ??
    map.dimensions.find((dimension) => dimension.id === 'intent') ??
    map.dimensions.find((dimension) => dimension.kind === 'behaviour')
  );
}

/** The single dimension of a kind (stage, channel), or undefined. */
export function dimensionOfKind(map: IntakeMap, kind: string): IntakeDimension | undefined {
  return map.dimensions.find((dimension) => dimension.kind === kind);
}

/** The first matching constraint's reason when the values hold every pair a constraint forbids. */
export function forbiddenBy(map: IntakeMap, values: Readonly<Record<string, string>>): string | undefined {
  for (const constraint of map.constraints) {
    const entries = Object.entries(constraint.forbid);
    if (entries.length > 0 && entries.every(([dimension, value]) => values[dimension] === value)) {
      return constraint.reason;
    }
  }
  return undefined;
}

function firstLine(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}
