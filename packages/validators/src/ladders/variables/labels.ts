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

/** The sources with the recorded label on each span that has one; every span is recorded when collect mode is on. */
export function labelled(sources: Sources): Sources {
  recordSpans(sources);
  if (sources.estate === undefined) return sources;
  const known = labels();
  return {
    ...sources,
    estate: {
      ...sources.estate,
      rules: sources.estate.rules.map((rule) => ({
        ...rule,
        conditions: rule.conditions.map((condition) => {
          const label = known.get(foldSpan(condition.text));
          return label === undefined ? condition : { ...condition, label };
        }),
      })),
    },
  };
}
