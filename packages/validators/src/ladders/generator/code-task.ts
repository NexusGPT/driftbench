import { stringify } from 'yaml';
import type { HiddenSpec } from './hidden';

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
    id: 'record-export',
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
  return { flow: flow.id, quote, instruction, family: stringify(family), oracle };
}
