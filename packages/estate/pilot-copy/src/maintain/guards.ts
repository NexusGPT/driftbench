import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { EstateMap } from '../schema';
import { GuardEvidence, GuardMode, type GuardTransition } from './diff';

/**
 * Enforcement state as data. A guard starts by observing (it logs what it would decide), then warns (it tells
 * the agent), then enforces (it blocks). The state of every guard atom of a map is kept in a file beside the
 * map, `guard-state.yaml`, one entry per guard atom id, with the decision-log evidence behind its mode:
 *
 *   version: 1
 *   guards:
 *     - guard: guard.settings.posttooluse-bash-guard-ledger-guard-py
 *       mode: enforce
 *       since: 2026-10-01
 *       evidence: { log: logs/ledger-guard.decisions.jsonl, decisions: 42, wrong: 0 }
 *
 * The file is read against its map: every entry names a guard atom of the map, and every guard atom of the map
 * has an entry. Two versions are compared guard by guard: a promotion (to a stricter mode) needs evidence with
 * at least one decision and none marked wrong; a demotion is confirmed by a person.
 */

export const GUARD_STATE_FILE = 'guard-state.yaml';

const RANK: Record<GuardMode, number> = { observe: 0, warn: 1, enforce: 2 };

export const GuardStateEntry = z.strictObject({
  guard: z.string().min(1).describe('A guard atom id of the map'),
  mode: GuardMode,
  since: z.string().min(1).optional(),
  evidence: GuardEvidence.optional(),
});
export type GuardStateEntry = z.infer<typeof GuardStateEntry>;

export const GuardState = z.strictObject({
  version: z.literal(1),
  guards: z.array(GuardStateEntry),
});
export type GuardState = z.infer<typeof GuardState>;

export type GuardStateResult = { ok: true; state: GuardState } | { ok: false; errors: string[] };

/** Parses a state file and checks it against its map. */
export function parseGuardState(text: string, map: EstateMap): GuardStateResult {
  let raw: unknown;
  try {
    raw = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [`not YAML: ${cause instanceof Error ? cause.message : String(cause)}`] };
  }
  const parsed = GuardState.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(top)'}: ${issue.message}`),
    };
  }
  const errors = checkGuardState(parsed.data, map);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, state: parsed.data };
}

/** Every entry names a guard atom of the map once; every guard atom of the map has an entry. */
export function checkGuardState(state: GuardState, map: EstateMap): string[] {
  const kinds = new Map(map.atoms.map((atom) => [atom.id, atom.kind]));
  const guards = map.atoms.filter((atom) => atom.kind === 'guard').map((atom) => atom.id);
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of state.guards) {
    const kind = kinds.get(entry.guard);
    if (kind === undefined) errors.push(`${entry.guard} is not an atom of the map`);
    else if (kind !== 'guard') errors.push(`${entry.guard} is an atom of kind ${kind}, not a guard`);
    if (seen.has(entry.guard)) errors.push(`${entry.guard} has two entries`);
    seen.add(entry.guard);
  }
  for (const guard of guards) if (!seen.has(guard)) errors.push(`the guard ${guard} has no state`);
  return errors;
}

/** The state file of a map: the file named `guard-state.yaml` in the map's folder. */
export function guardStateBeside(mapPath: string): string {
  return join(dirname(mapPath), GUARD_STATE_FILE);
}

export type LoadedGuardState =
  | { ok: true; state: GuardState | undefined }
  | { ok: false; path: string; errors: string[] };

/** Reads a state file; a missing file is no state when `required` is false, an error when true. */
export async function loadGuardState(
  path: string,
  map: EstateMap,
  required: boolean,
): Promise<LoadedGuardState> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    if (!required && (cause as { code?: string }).code === 'ENOENT') return { ok: true, state: undefined };
    return {
      ok: false,
      path,
      errors: [`cannot read: ${cause instanceof Error ? cause.message : String(cause)}`],
    };
  }
  const parsed = parseGuardState(text, map);
  return parsed.ok ? { ok: true, state: parsed.state } : { ok: false, path, errors: parsed.errors };
}

/** Guard by guard, the mode before and after: in the order of the new state, then the guards it dropped. */
export function diffGuardStates(
  before: GuardState | undefined,
  after: GuardState | undefined,
): GuardTransition[] {
  const old = new Map((before?.guards ?? []).map((entry) => [entry.guard, entry]));
  const next = new Map((after?.guards ?? []).map((entry) => [entry.guard, entry]));
  const out: GuardTransition[] = [];
  for (const entry of after?.guards ?? []) {
    const prior = old.get(entry.guard);
    const move: GuardTransition['move'] =
      prior === undefined
        ? 'added'
        : RANK[entry.mode] > RANK[prior.mode]
          ? 'promoted'
          : RANK[entry.mode] < RANK[prior.mode]
            ? 'demoted'
            : 'unchanged';
    out.push({
      guard: entry.guard,
      from: prior?.mode ?? null,
      to: entry.mode,
      move,
      ...(entry.evidence ? { evidence: entry.evidence } : {}),
    });
  }
  for (const entry of before?.guards ?? []) {
    if (!next.has(entry.guard)) out.push({ guard: entry.guard, from: entry.mode, to: null, move: 'removed' });
  }
  return out;
}

/**
 * What a person must decide: a guard promoted (or added above observe) without evidence that shows at least
 * one decision and none marked wrong, and every demotion.
 */
export function guardNeed(transition: GuardTransition): string | undefined {
  const { guard, from, to, move, evidence } = transition;
  if (move === 'demoted') return `confirm the demotion of ${guard} from ${from} to ${to}`;
  const raised = move === 'promoted' || (move === 'added' && to !== null && to !== 'observe');
  if (!raised) return undefined;
  const step = `${from ?? 'no state'} to ${to}`;
  if (evidence === undefined || evidence.decisions === 0) {
    return `the guard ${guard} went from ${step} with no decision evidence`;
  }
  if (evidence.wrong > 0) {
    return `the guard ${guard} went from ${step} although ${evidence.wrong} of ${evidence.decisions} decisions were marked wrong`;
  }
  return undefined;
}
