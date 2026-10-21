import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { LabelSetDef, ModelArm, ScanResult, SourceFile } from '../sut/port';
import { PROBE_YAML } from './sets';

/** Independent fixture authoring. No cutter, reader, recording or reference implementation is called here.
 * The public wire schema follows packages/estate/src/pointer/{labeler,dense,yesno,cassette}.ts at the head that
 * names this file: the key hashes `{wire, readable}`; the readable fields carry the labeler class and the run;
 * the system 2 labeler asks every window three times (three independent runs); the system 1 labeler asks one
 * choice question per unit and answers a probability vector that includes `none`.
 * Answers and unit boundaries are supplied by the fixture author before any implementation runs.
 */
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export type Wire = { labeler: string; body: Record<string, unknown> };
export type CassetteRow = {
  key: string;
  answer: {
    labels?: Array<{ units: string; label: string }>;
    probabilities?: Record<string, number>;
    returnedModel: string;
    stopReason: string;
    usage: { input: number; output: number };
  };
  readable: Record<string, string>;
};
export type AuthoredUnit = {
  text: string;
  label: string;
  container?: string;
  path?: string[];
  probabilities?: Record<string, number>;
};
export type AuthoredFile = { path: string; units: AuthoredUnit[]; text?: string };
export type ExpectedLabel = {
  path: string;
  quote: string;
  set: string;
  label: string;
  probabilities?: Record<string, number>;
};
export type Fixture = {
  files: SourceFile[];
  labelsYaml: string;
  expected: ExpectedLabel[];
  cassette: string;
  rows: CassetteRow[];
  wires: Wire[];
  documents: AuthoredFile[];
};
/** How many times a labeler asks the same window: the system 2 labeler asks three independent runs (design, "The default stack"). */
export const RUNS: Record<ModelArm, number> = { haiku: 3, jev: 1, 'jev-unit': 1 };
/** The labeler id the reader writes into every request: it is part of the key. */
export const LABELER_ID: Record<ModelArm, string> = {
  haiku: 'anthropic',
  jev: 'jev',
  'jev-unit': 'jev-unit',
};
/** The class of each arm. */
export const CLASS_OF: Record<ModelArm, string> = { haiku: 'system2', jev: 'system1', 'jev-unit': 'system1' };
/** Units one request may hold: the system 2 window, the system 1 window and the system 1 unit state. */
export const WINDOW_CAP: Record<ModelArm, number> = { haiku: 60, jev: 30, 'jev-unit': 1 };
/** What the `none` option of a choice question says. */
export const NONE_DEFINITION = 'None of the other labels applies to this unit.';
export const JEV_MODEL = 'jev-latest';
export const HAIKU_MODEL = 'claude-haiku-5-5';

export const DENSE_SYSTEM =
  'You label numbered units of a document. For each unit give exactly one label from the list, or none. ' +
  'Answer with JSON only, no other text: {"labels": [{"units": "<n> or <a>-<b>", "label": "<name>"}]}. ' +
  'Every unit must appear once. A range joins neighbouring units that share a label. ' +
  'For a label that asks for a target, add "target": the number of the unit that holds the other end. ' +
  'Never copy text from the units.';
const examples = (label: LabelSetDef['labels'][number]) =>
  label.examples?.length ? ` Examples: ${label.examples.map((e) => JSON.stringify(e)).join('; ')}` : '';
export function wireFor(
  arm: ModelArm,
  set: LabelSetDef,
  window: string,
  units: Array<{ n: number; text: string }>,
  path: string[] = [],
): Wire {
  const shown = units.map((u) => `[${u.n}] ${u.text.replace(/\s+/g, ' ').trim()}`);
  if (arm === 'haiku')
    return {
      labeler: LABELER_ID[arm],
      body: {
        model: HAIKU_MODEL,
        max_tokens: 4096,
        thinking: { type: 'disabled' },
        system: DENSE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              `SET ${set.set}: ${set.description}`,
              'LABELS:',
              ...set.labels.map(
                (l) =>
                  `- ${l.name}: ${l.description}${examples(l)}${l.target ? ' (also give "target": the number of the unit that holds the other end, as a JSON number)' : ''}`,
              ),
              '- none: no label of this set applies.',
              `WINDOW ${window}  path: ${path.join(' > ') || '(top)'}`,
              ...shown,
            ].join('\n'),
          },
        ],
      },
    };
  const asked = askedLabels(set);
  const criteria = {
    ...Object.fromEntries(asked.map((l) => [l.name, `${l.description}${examples(l)}`])),
    none: NONE_DEFINITION,
  };
  return {
    labeler: LABELER_ID[arm],
    body: {
      model: JEV_MODEL,
      state: { set: set.set, window, text: [`path: ${path.join(' > ') || '(top)'}`, ...shown].join('\n') },
      questions: Object.fromEntries(
        units.map((u) => [
          `u${u.n}`,
          {
            type: 'choice',
            instructions: `Which label does unit [${u.n}] of the numbered text have?`,
            criteria,
          },
        ]),
      ),
    },
  };
}
/** The labels a choice model is asked about: a label that names a target cannot be asked (a probability names no unit). */
function askedLabels(set: LabelSetDef): LabelSetDef['labels'] {
  const asked = set.labels.filter((l) => l.target !== 'required');
  if (asked.length < set.labels.length)
    throw new Error(`the set ${set.set} has a label with a target: a choice model cannot be asked about it`);
  return asked;
}
/** The key of a request: the hash of the wire and of everything that identifies the answer besides it. */
export const requestKey = (wire: Wire, readable: Record<string, string>): string =>
  hash(canonical({ wire, readable }));
/** The metadata of one run of one window: the readable fields that are not hashes of the wire. */
export function windowMeta(
  arm: ModelArm,
  fields: { path: string; window: string; set: LabelSetDef; wire: Wire; cutDigest: string; run: number },
): Record<string, string> {
  return {
    path: fields.path,
    window: fields.window,
    promptVersion: 'p1',
    schemaVersion: 's1',
    set: fields.set.set,
    setHash: hash(canonical(fields.set)).slice(0, 16),
    model: String(fields.wire.body.model),
    cutDigest: fields.cutDigest,
    cls: CLASS_OF[arm],
    run: String(fields.run),
  };
}
/** A probability vector over the options of a choice question: the labels and `none`, summing to one. */
export function vectorFor(
  set: LabelSetDef,
  n: number,
  unit: Pick<AuthoredUnit, 'label' | 'probabilities'>,
): Record<string, number> {
  const names = askedLabels(set).map((l) => l.name);
  const round = (p: number) => Math.round(p * 10_000) / 10_000;
  const given = unit.probabilities;
  const raw: Record<string, number> = {};
  if (given) {
    for (const name of names) raw[name] = given[name] ?? 0;
    raw.none = given.none ?? Math.max(0, 1 - names.reduce((sum, name) => sum + (raw[name] as number), 0));
  } else {
    const options = [...names, 'none'];
    for (const name of options) raw[name] = name === unit.label ? 0.94 : 0.06 / (options.length - 1);
  }
  const total = Object.values(raw).reduce((sum, p) => sum + p, 0);
  if (Math.abs(total - 1) > 0.005)
    throw new Error(`the authored probabilities of unit ${n} sum to ${total}: a choice answer is a vector`);
  return Object.fromEntries(Object.entries(raw).map(([name, p]) => [`u${n}__${name}`, round(p)]));
}
export function readableFor(wire: Wire, meta: Record<string, string>): Record<string, string> {
  return {
    ...meta,
    labeler: wire.labeler,
    ...Object.fromEntries(
      Object.entries(wire.body).map(([k, v]) => [`part.${k}`, hash(canonical(v)).slice(0, 12)]),
    ),
  };
}
export function makeFixture(arm: ModelArm, documents: AuthoredFile[], labelsYaml = PROBE_YAML): Fixture {
  const sets = (parse(labelsYaml) as { labels: LabelSetDef[] }).labels;
  const files = documents.map((d) => ({
    path: d.path,
    text: d.text ?? `${d.units.map((u) => u.text).join('\n\n')}\n`,
  }));
  for (const [index, doc] of documents.entries()) {
    let cursor = 0;
    for (const unit of doc.units) {
      const found = files[index]?.text.indexOf(unit.text, cursor) ?? -1;
      if (found < 0 || !unit.text) throw new Error('authored unit is not an ordered source span');
      cursor = found + unit.text.length;
      for (const set of sets)
        if (unit.label !== 'none' && !set.labels.some((label) => label.name === unit.label))
          throw new Error(`authored label ${unit.label} is absent from ${set.set}`);
    }
  }
  const rows: CassetteRow[] = [],
    wires: Wire[] = [],
    expected: ExpectedLabel[] = [];
  const cap = WINDOW_CAP[arm];
  for (const set of sets)
    for (const doc of documents) {
      const digest = hash(
        doc.units
          .map(
            (u) =>
              `${u.container ?? 'sentence'}:${hash(u.text.normalize('NFC').replace(/\s+/g, ' ').trim()).slice(0, 16)}`,
          )
          .join('\n'),
      );
      for (let offset = 0; offset < doc.units.length; offset += cap) {
        const selected = doc.units.slice(offset, offset + cap),
          window = `${doc.path}#${Math.floor(offset / cap) + 1}`;
        const wire = wireFor(
          arm,
          set,
          window,
          selected.map((u, i) => ({ n: i + 1, text: u.text })),
          selected[0]?.path ?? [],
        );
        const probabilities = Object.assign(
          {},
          ...selected.map((u, i) => (arm === 'haiku' ? {} : vectorFor(set, i + 1, u))),
        ) as Record<string, number>;
        // The same request is asked once per run; the runs differ only in the `run` readable field.
        for (let run = 1; run <= RUNS[arm]; run++) {
          const readable = readableFor(
            wire,
            windowMeta(arm, { path: doc.path, window, set, wire, cutDigest: digest, run }),
          );
          wires.push(wire);
          rows.push({
            key: requestKey(wire, readable),
            readable,
            answer: {
              ...(arm === 'haiku'
                ? { labels: selected.map((u, i) => ({ units: String(i + 1), label: u.label })) }
                : { probabilities }),
              returnedModel: String(wire.body.model),
              stopReason: 'end_turn',
              usage: { input: 10, output: 10 },
            },
          });
        }
      }
      for (const u of doc.units)
        expected.push({
          path: doc.path,
          quote: u.text,
          set: set.set,
          label: u.label,
          ...(u.probabilities ? { probabilities: u.probabilities } : {}),
        });
    }
  return {
    files,
    labelsYaml,
    expected,
    rows,
    wires,
    documents,
    cassette: rows.map(canonical).concat('').join('\n'),
  };
}
export function loadFixture(arm: ModelArm): Fixture {
  const fixture = JSON.parse(
    readFileSync(new URL(`../../../../fixtures/pointer/replay/${arm}.json`, import.meta.url), 'utf8'),
  ) as Fixture;
  const cassette = readFileSync(
    new URL(`../../../../fixtures/pointer/replay/${arm}.jsonl`, import.meta.url),
    'utf8',
  );
  if (cassette !== fixture.cassette)
    throw new Error('committed cassette differs from its reviewed fixture sidecar');
  return fixture;
}
/** Every expected source unit must occur exactly once with its authored label; zero, partial and all-one-label outputs fail. */
export function requireFixtureLabels(result: ScanResult, fixture: Fixture, threshold?: number): void {
  if (!result.ok || !result.ledger)
    throw new Error(`positive witness: fixture replay failed: ${result.error ?? 'no ledger'}`);
  const live = result.ledger.entries.filter((e) => e.status === 'live');
  if (live.length !== fixture.documents.reduce((n, d) => n + d.units.length, 0))
    throw new Error('positive witness: fixture replay dropped or invented a unit');
  const groups = new Map<string, typeof live>();
  for (const entry of live) {
    for (const set of Object.keys(entry.labels)) {
      const key = JSON.stringify([entry.path, entry.quote, set]);
      const found = groups.get(key) ?? [];
      found.push(entry);
      groups.set(key, found);
    }
  }
  for (const expected of fixture.expected) {
    const match = groups.get(JSON.stringify([expected.path, expected.quote, expected.set]))?.shift();
    let want = expected.label;
    if (threshold !== undefined && expected.probabilities) {
      const [best] = Object.entries(expected.probabilities).sort((a, b) => b[1] - a[1]);
      want = best && best[1] >= threshold ? best[0] : 'none';
    }
    if (match?.labels[expected.set]?.label !== want)
      throw new Error(
        `positive witness: fixture label ${expected.path} ${JSON.stringify(expected.quote)} must be ${want}`,
      );
  }
}
/** Change exactly one stored input field. The key is left alone: this probes that readable metadata is validated on a hit. */
export function perturb(
  fixture: Fixture,
  _arm: ModelArm,
  index: number,
  field: string,
  value: string,
): { cassette: string; window: string } {
  const rows = structuredClone(fixture.rows),
    candidates = rows.filter((r) => field in r.readable);
  const row = candidates[index % candidates.length];
  if (!row) throw new Error(`no fixture entry carries ${field}`);
  row.readable[field] = value;
  return { cassette: rows.map(canonical).concat('').join('\n'), window: row.readable.window ?? '' };
}
