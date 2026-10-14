import { type Recording, SYSTEM_PROMPT } from '@agent-nexus/driftbench-generate';
import { PROMPT_PATH, type Rendered, type Span } from './render';
import { DEVIATION_SENTENCES, type HiddenSpec } from './spec';

/**
 * The perfect model, written by code. It answers the extractor's five sections the way a model that reads
 * every source correctly would, under the answer contract: each entry with a source path and a quote copied
 * character for character from the span the renderer recorded, dimensions in the order the prompt states
 * them, nothing for a decoy. It is no model: it reads the hidden specification and the spans, so a validator
 * run never calls one. A live run with a real model replaces this recording and is billed separately.
 *
 * It follows the contract as the extractor's system prompt states it: when that prompt asks for a "role" on
 * a dimension, the perfect model gives the declared role; while it does not, no role is sent, since the
 * strict answer schema would refuse the key.
 */

export const ORACLE_FAMILY = 'oracle';
export const ORACLE_MODEL = 'perfect model written by code from the hidden specification';

type AnswerValue = { id: string; title: string; source: string; quote: string };
type AnswerDimension = { id: string; title: string; kind: string; role?: string; values: AnswerValue[] };
type AnswerConstraint = { forbid: Record<string, string>; reason: string; source: string; quote: string };
type AnswerPhrase = {
  dimension: string;
  value: string;
  text: string;
  lang: string;
  source?: string;
  quote?: string;
};
type SectionAnswer = {
  section: string;
  dimensions: AnswerDimension[];
  constraints: AnswerConstraint[];
  phrases: AnswerPhrase[];
};

/** Whether the extractor's system prompt asks for a role on each dimension. */
export function contractStatesRole(systemPrompt: string = SYSTEM_PROMPT): boolean {
  return /"role"\s*:/.test(systemPrompt);
}

export type OracleOptions = {
  /** Give each dimension its declared role. By default, when the system prompt asks for one. */
  roles?: boolean;
};

/** The recording a perfect model would have produced for these rendered artefacts. */
export function oracleRecording(
  spec: HiddenSpec,
  rendered: Rendered,
  options: OracleOptions = {},
): Recording {
  const roles = options.roles ?? contractStatesRole();
  const role = (declared: string) => (roles ? { role: declared } : {});
  const quote = (id: string): string => {
    const span = rendered.spans.get(id);
    if (!span) throw new RangeError(`the renderer wrote no span for ${id}`);
    return slice(rendered.prompt, span);
  };
  const at = (id: string): number => rendered.spans.get(id)?.start ?? Number.POSITIVE_INFINITY;
  const value = (id: string, valueId: string, title: string): AnswerValue => ({
    id: valueId,
    title,
    source: PROMPT_PATH,
    quote: quote(id),
  });
  const empty = (section: string): SectionAnswer => ({
    section,
    dimensions: [],
    constraints: [],
    phrases: [],
  });

  const stages = empty('stages');
  if (spec.stages.length > 0) {
    stages.dimensions.push({
      id: 'stage',
      title: 'The stage a conversation is in',
      kind: 'stage',
      ...role('axis'),
      values: spec.stages.map((stage) => value(`stage/${stage.id}`, stage.id, stage.title)),
    });
  }
  for (const constraint of spec.stageConstraints) {
    stages.constraints.push({
      forbid: { ...constraint.forbid },
      reason: 'the stage happens on one channel only',
      source: PROMPT_PATH,
      quote: quote(`constraint/${constraint.id}`),
    });
  }

  const rules = empty('rules');
  const ruleValues = [...spec.rules]
    .sort((a, b) => at(`rule/${a.id}`) - at(`rule/${b.id}`))
    .map((rule) => value(`rule/${rule.id}`, rule.id, `${rule.main} ${rule.condition}`));
  if (ruleValues.length > 0) {
    rules.dimensions.push({
      id: 'rule',
      title: 'The rules the assistant follows',
      kind: 'behaviour',
      ...role('detail'),
      values: ruleValues,
    });
  }
  if (spec.proseDeviation) {
    rules.dimensions.push({
      id: 'deviation',
      title: 'The deviation classes the flows must be perturbed with',
      kind: 'deviation',
      ...role('axis'),
      values: [
        value(
          `deviation/${spec.proseDeviation}`,
          spec.proseDeviation,
          DEVIATION_SENTENCES[spec.proseDeviation],
        ),
      ],
    });
  }

  const personas = empty('personas');
  const data = empty('data');
  for (const dimension of [...spec.personas, ...spec.data].sort(
    (a, b) => at(`${a.id}/${a.values[0]?.id}`) - at(`${b.id}/${b.values[0]?.id}`),
  )) {
    (dimension.kind === 'persona' ? personas : data).dimensions.push({
      id: dimension.id,
      title: dimension.title,
      kind: dimension.kind,
      ...role(dimension.role),
      values: dimension.values.map((item) => value(`${dimension.id}/${item.id}`, item.id, item.title)),
    });
  }
  for (const constraint of spec.personaConstraints) {
    personas.constraints.push({
      forbid: { ...constraint.forbid },
      reason: 'this kind of customer never uses that channel',
      source: PROMPT_PATH,
      quote: quote(`constraint/${constraint.id}`),
    });
  }

  const phrases = empty('phrases');
  for (const phrase of [...spec.phrases].sort((a, b) => at(`phrase/${a.id}`) - at(`phrase/${b.id}`))) {
    const text = quote(`phrase/${phrase.id}`);
    phrases.phrases.push({
      dimension: phrase.dimension,
      value: phrase.value,
      text,
      lang: phrase.lang,
      source: PROMPT_PATH,
      quote: text,
    });
  }

  return {
    family: ORACLE_FAMILY,
    model: ORACLE_MODEL,
    answers: { stages, rules, personas, data, phrases, relations: empty('relations') },
  };
}

function slice(text: string, span: Span): string {
  return text.slice(span.start, span.end);
}
