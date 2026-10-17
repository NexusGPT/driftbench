import { parse as parseYaml } from 'yaml';
import { sha } from './cut';

export type Label = {
  name: string;
  description: string;
  examples?: string[];
  target?: 'required';
  atom?: { kind: string; polarity?: string };
};
export type LabelSet = { set: string; description: string; labels: Label[] };

export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

export function loadSets(yamlText: string): LabelSet[] {
  const doc = parseYaml(yamlText) as { labels: LabelSet[] };
  for (const s of doc.labels) {
    const names = new Set<string>();
    for (const l of s.labels) {
      if (!/^[a-z][a-z0-9-]*$/.test(l.name) || l.name === 'none') throw new Error(`bad label name ${l.name}`);
      if (names.has(l.name)) throw new Error(`duplicate label ${l.name}`);
      names.add(l.name);
    }
  }
  return doc.labels;
}
export const setHash = (set: LabelSet) => sha(canonical(set)).slice(0, 16);

/** The fixed text of the request. Nothing in it names a domain: every domain word comes from the set. */
export const TEMPLATE_SYSTEM =
  'You label numbered units of a document. For each unit give exactly one label from the list, or none. ' +
  'Answer with JSON only, no other text: {"window": "<id>", "set": "<name>", "labels": [{"units": "<n> or <a>-<b>", "label": "<name>"}]}. ' +
  'Every unit must appear once. Ranges join adjacent units that share a label. Never copy text from the units.';
export const PROMPT_VERSION = 'p1';
export const SCHEMA_VERSION = 's1';

export type Window = { id: string; path: string; headingPath: string[]; units: Array<{ n: number; text: string }> };

export function buildRequest(set: LabelSet, w: Window, model: string) {
  const labelLines = set.labels.map(
    (l) =>
      `- ${l.name}: ${l.description}${l.examples?.length ? ` Examples: ${l.examples.map((e) => JSON.stringify(e)).join('; ')}` : ''}${l.target ? ' (also give "target": the unit number of the other end)' : ''}`,
  );
  const user = [
    `SET ${set.set}: ${set.description}`,
    'LABELS:',
    ...labelLines,
    '- none: no label of this set applies.',
    `WINDOW ${w.id}  path: ${w.headingPath.join(' > ') || '(top)'}`,
    ...w.units.map((u) => `[${u.n}] ${u.text}`),
  ].join('\n');
  return {
    model,
    system: TEMPLATE_SYSTEM,
    user,
    output: { enum: [...set.labels.map((l) => l.name), 'none'] },
    maxTokens: 1024,
    thinking: 'off',
    meta: {
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      set: set.set,
      setHash: setHash(set),
      window: w.id,
      path: w.path,
    },
  };
}
export type Request = ReturnType<typeof buildRequest>;
