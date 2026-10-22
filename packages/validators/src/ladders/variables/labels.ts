import { appendFileSync, readFileSync } from 'node:fs';
import type { Sources } from './interface';

/**
 * The labels a reader recorded for condition spans (docs/validators.md section 12.5). The validator puts them on
 * the spans of the sources before it calls the product, so the product reads data and nothing else: no file, no
 * variable of the environment.
 *
 * - `DRIFTBENCH_VARIABLES_CASSETTE` names a file with one JSON object per line, `{ "text": ..., "label": ... }`.
 *   Unset: no span has a label, and a span with no label gives no variable. This code reads the file and calls
 *   no model.
 * - Collect mode: `DRIFTBENCH_VARIABLES_SPANS_OUT` names a file, and every condition span a run reads is appended to
 *   it as one JSON line. The span collector job sets it; a labeller turns the spans into the cassette.
 */

type Label = unknown;

let cassette: Map<string, Label> | undefined;

/** A span with each run of white space folded to one space: the key of its label, so one clause has one label. */
export const foldSpan = (text: string): string => text.replace(/\s+/g, ' ').trim();

function labels(): Map<string, Label> {
  if (cassette) return cassette;
  const map = new Map<string, Label>();
  const file = process.env.DRIFTBENCH_VARIABLES_CASSETTE;
  if (file) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      const row = JSON.parse(line) as { text: string; label: Label };
      map.set(foldSpan(row.text), row.label);
    }
  }
  cassette = map;
  return map;
}

function recordSpans(sources: Sources): void {
  const out = process.env.DRIFTBENCH_VARIABLES_SPANS_OUT;
  if (!out) return;
  for (const rule of sources.estate?.rules ?? []) {
    for (const condition of rule.conditions)
      appendFileSync(out, `${JSON.stringify({ text: foldSpan(condition.text) })}\n`);
  }
}

/** Freezes a value at every depth. */
function freezeAll<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) freezeAll((value as Record<PropertyKey, unknown>)[key]);
  }
  return value;
}

/**
 * The sources with the recorded label on each span that has one; every span is recorded when collect mode is on.
 * The sources the item gave are returned as they are when no span gets a label, so a build that must leave its inputs
 * alone is given the very objects the item froze. When a label is added the copy is frozen too if the input was: a
 * product never receives a writable copy of a frozen input (review of PR 1170).
 */
export function labelled(sources: Sources): Sources {
  recordSpans(sources);
  const estate = sources.estate;
  if (estate === undefined) return sources;
  const known = labels();
  let added = false;
  const rules = estate.rules.map((rule) => ({
    ...rule,
    conditions: rule.conditions.map((condition) => {
      const label = known.get(foldSpan(condition.text));
      if (label === undefined || (condition as { label?: unknown }).label !== undefined) return condition;
      added = true;
      return { ...condition, label };
    }),
  }));
  if (!added) return sources;
  const out: Sources = { ...sources, estate: { ...estate, rules } };
  return Object.isFrozen(estate) ? freezeAll(out) : out;
}
