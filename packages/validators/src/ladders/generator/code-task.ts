import type { Spec } from '@agent-nexus/driftbench-core';
import { stringify } from 'yaml';
import { type HiddenSpec, phrasePattern } from './hidden';

/** The id of the documented code-agent task family every hidden map hands its export flow to. */
export const CODE_TASK_FAMILY = 'record-export';

/** A documented code-agent task family, independent of any fault catalogue. */
export function codeTask(spec: HiddenSpec) {
  const save = spec.behaviours.find((entry) => entry.title.startsWith('Save the record'));
  const flow = spec.flows.find((entry) => save && entry.behaviours.includes(save.id)) ?? spec.flows[0];
  if (!flow) throw new Error('the export task needs a flow');
  const opening = spec.phrases.find(
    (entry) => entry.intent.kind === 'transition' && entry.intent.edge === `${spec.start}-to-${spec.goal}`,
  );
  if (!opening) throw new Error('the export task needs its opening phrase');
  const instruction = `Save the record as ${spec.saveFile}.`;
  const quote = `The ${flow.id} flow also offers a code task: open the request, then save the record from input.json as ${spec.saveFile}, state its path, and leave every other file untouched.`;
  const family = {
    version: 1,
    id: CODE_TASK_FAMILY,
    title: 'Export a record',
    description: quote,
    target: { adapter: 'function', agent: spec.agent },
    spec: {
      channel: 'web',
      lang: 'EN',
      stages: [spec.goal],
      tags: [`flow:${flow.id}`],
      covers: save ? [save.id] : [],
    },
    oracle: 'oracle.mjs',
    review: 'review.yaml',
    knobs: { wording: { class: 'style', values: ['plain'] } },
    wording_knob: 'wording',
    tables: { record: { rows: 1, columns: [{ name: 'agent', gen: { template: spec.agent } }] } },
    files: [{ path: 'input.json', json: { table: 'record', columns: ['agent'], root: 'records' } }],
    corners: { per_instance: 0, kinds: [{ id: 'duplicate-record', duplicate_row: { table: 'record' } }] },
    phrases: [
      { id: 'open', approved: true, text: opening.text },
      { id: 'save', approved: true, text: instruction },
    ],
    blocks: [
      { id: 'open', stage: spec.goal, parts: [{ phrases: ['open'] }] },
      { id: 'save', stage: spec.goal, parts: [{ phrases: ['save'] }] },
    ],
    checks: { json: ['subset'] },
    others_untouched: true,
  };
  // The oracle reads the task input. It does not read the follower or the fault catalogue.
  const oracle = `export function expected({files}) {
    const rows = JSON.parse(files['input.json']).records;
    const path = ${JSON.stringify(spec.saveFile)};
    return { slots: {}, blocks: {
      open: {files: [], workspace: {created: [], changed: [], deleted: []}},
      save: {files: [{path, kind: 'json', value: {agent: rows[0].agent, saved: true}}],
        workspace: {created: [path], changed: [], deleted: []},
        must: [path.replace(/[.*+?^$\x7b\x7d()|[\\]\\\\]/g, '\\\\$&')]}
    }};
  }\n`;
  // The Then of every block as the task seeder must place it: the stage catalogue, then the oracle's
  // expectation (the reply's `must`, the files with the declared checks, the workspace diff), no more.
  const untouched = { others_untouched: true };
  const thens: Record<string, Record<string, unknown>> = {
    open: { stage: spec.goal, workspace: { created: [], changed: [], deleted: [], ...untouched } },
    save: {
      stage: spec.goal,
      must: [spec.saveFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')],
      artifacts: [
        { path: spec.saveFile, kind: 'json', checks: [{ subset: { agent: spec.agent, saved: true } }] },
      ],
      workspace: { created: [spec.saveFile], changed: [], deleted: [], ...untouched },
    },
  };
  return {
    flow: flow.id,
    quote,
    instruction,
    family: stringify(family),
    oracle,
    phrases: family.phrases.filter((phrase) => phrase.approved).map((phrase) => phrase.text),
    thens,
  };
}

/** True when the generator placed the spec from the code-agent task family, by the task seeder. */
export function isCodeTaskSpec(spec: Spec): boolean {
  const meta = spec.metadata as { generated?: { seeder?: unknown }; family?: { id?: unknown } } | undefined;
  return meta?.generated?.seeder === 'task' && meta.family?.id === CODE_TASK_FAMILY;
}

/** True when a user turn of a task spec is one of the family's approved phrases. */
export function familyPhrase(spec: HiddenSpec, text: string): boolean {
  return codeTask(spec).phrases.some((phrase) => phrasePattern(phrase).test(text));
}

const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
          .join(',')}}`
      : JSON.stringify(value);

/**
 * True when a block of a task spec expects exactly what the family's stage catalogue and oracle give it. Such
 * a Then is the oracle's by the documented task-seeder contract: the seeder may not add a check to it.
 */
export function oracleThen(spec: HiddenSpec, task: Spec, index: number): boolean {
  const block = task.blocks[index];
  const expected = block?.id === undefined ? undefined : codeTask(spec).thens[block.id];
  return expected !== undefined && canonical(block?.expect ?? {}) === canonical(expected);
}
