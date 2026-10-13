import { type LoadedSpec, parseSpecText, type Spec } from '@agent-nexus/driftbench-core';
import { DETOURS } from '@agent-nexus/driftbench-generate';
import { stringify } from 'yaml';
import { defaultValue } from './follower';
import type { HiddenSpec } from './hidden';

/**
 * The hand-written baseline of a hidden specification: the suite a careful person writes without a
 * generator. One spec per flow walks the spine from the start to the last stage on web, expects each stage
 * and the bound tool calls with the input the schema defaults to, and probes the flow's first detour class
 * once, at the goal stage. One spec checks that a value above a tool's maximum is never sent. It is the
 * coverage baseline of level 6 and the source of the replay cheater. Written by code, validated by the core
 * loader like any spec.
 */

/** The first transition phrase of an edge. */
function phraseOf(spec: HiddenSpec, edge: string): string | undefined {
  const text = spec.phrases.find(
    (phrase) => phrase.intent.kind === 'transition' && phrase.intent.edge === edge,
  )?.text;
  // A slot takes the first member of the enum it feeds: the value a person writing by hand would pick.
  return text?.replace(/\{([a-z][a-z0-9_]*)\}/g, (all, slot: string) => {
    const property = spec.tools.find((tool) => tool.slot === slot)?.input[0];
    return property?.type === 'enum' ? (property.members[0] as string) : all;
  });
}

function spine(spec: HiddenSpec): Array<{ edge: string; to: string }> {
  const out: Array<{ edge: string; to: string }> = [];
  for (let stage = spec.start; spec.next[stage] !== undefined; stage = spec.next[stage] as string) {
    const to = spec.next[stage] as string;
    out.push({ edge: `${stage}-to-${to}`, to });
  }
  return out;
}

function persona(spec: HiddenSpec, index: number, channel: string): string | undefined {
  const allowed = spec.personas.filter(
    (candidate) =>
      !spec.constraints.some(
        (constraint) => constraint.forbid.user_type === candidate.id && constraint.forbid.channel === channel,
      ),
  );
  return allowed[index % Math.max(1, allowed.length)]?.id;
}

/** The hand-written specs, as plain objects in file order. */
export function baselineObjects(spec: HiddenSpec): Record<string, unknown>[] {
  const channel = 'web';
  const stages = spec.stages.map((stage) => stage.id);
  const out: Record<string, unknown>[] = [];
  spec.flows.forEach((flow, index) => {
    const blocks: Record<string, unknown>[] = [];
    for (const step of spine(spec)) {
      const text = phraseOf(spec, step.edge);
      if (text === undefined) continue;
      const tool = spec.tools.find((candidate) => candidate.stage === step.to);
      const enumField = tool?.input.find((property) => property.type === 'enum');
      blocks.push({
        user: text,
        expect: {
          stage: step.to,
          ...(tool
            ? {
                tools: [
                  {
                    label: tool.name,
                    count: { min: 1 },
                    ...(enumField ? { input: { [enumField.name]: defaultValue(enumField) } } : {}),
                  },
                ],
              }
            : {}),
        },
      });
      const detour = flow.deviations.find(
        (cls) =>
          DETOURS.has(cls) &&
          spec.phrases.some((phrase) => phrase.intent.kind === 'deviation' && phrase.intent.class === cls),
      );
      const forbidden = spec.constraints.some(
        (constraint) => constraint.forbid.deviation === detour && constraint.forbid.stage === step.to,
      );
      if (step.to === spec.goal && detour && !forbidden) {
        const phrase = spec.phrases.find(
          (entry) => entry.intent.kind === 'deviation' && entry.intent.class === detour,
        );
        blocks.push({
          when: { injection: { class: detour, user: phrase?.text } },
          expect: { stage: step.to },
        });
      }
    }
    const who = persona(spec, index, channel);
    out.push({
      id: `hand-${flow.id}`,
      version: '1',
      kind: 'conversation',
      title: `By hand: ${flow.title}`,
      channel,
      lang: spec.lang.toUpperCase(),
      tags: [`flow:${flow.id}`, ...(who ? [`persona:${who}`] : [])],
      covers: [...flow.behaviours],
      stages,
      blocks,
    });
  });
  const limited = spec.data.find((value) => value.direction === 'in' && value.partition === 'above-maximum');
  const phrase =
    limited &&
    spec.phrases.find((entry) => entry.intent.kind === 'data' && entry.intent.value === limited.id);
  if (limited && phrase) {
    out.push({
      id: 'hand-limits',
      version: '1',
      kind: 'conversation',
      title: `By hand: ${limited.field} above its maximum is never sent to ${limited.tool}`,
      channel,
      lang: spec.lang.toUpperCase(),
      blocks: [{ user: phrase.text, expect: { tools: [{ label: limited.tool, count: 0 }] } }],
    });
  }
  return out;
}

/** The hand-written suite, loaded by the core loader. Throws when a spec does not load: a validator defect. */
export function baselineSuite(spec: HiddenSpec): LoadedSpec[] {
  return baselineObjects(spec).map((object) => {
    const id = String(object.id);
    const loaded = parseSpecText(stringify(object, { lineWidth: 0 }), 'yaml', `${id}.yaml`);
    if (!loaded.ok) {
      throw new Error(
        `the baseline spec ${id} does not load: ${loaded.errors.map((issue) => `${issue.path} ${issue.message}`).join('; ')}`,
      );
    }
    return loaded;
  });
}

/** The specs alone. */
export function baselineSpecs(spec: HiddenSpec): Spec[] {
  return baselineSuite(spec).map((loaded) => loaded.spec);
}
