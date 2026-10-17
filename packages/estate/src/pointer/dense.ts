import {
  errorText,
  type HttpOptions,
  isRecord,
  ModelError,
  postJson,
} from '@agent-nexus/driftbench-generate';
import type { Recorded } from './cassette';
import { type Labeler, LabelerError, type Opinion, type Opinions, usageOf } from './labeler';
import { checkAnswer, type Label, type Labelled, type LabelSet, type Window } from './labels';

/**
 * The dense shape of a system 2 labeler: the whole numbered window in one request, one label per unit in the
 * answer, ranges allowed. Every word of a domain comes from the label set, never from the text here.
 */

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

function labelLine(label: Label): string {
  const examples = label.examples?.length
    ? ` Examples: ${label.examples.map((example) => JSON.stringify(example)).join('; ')}`
    : '';
  const target = label.target ? ' (also give "target": the number of the unit that holds the other end)' : '';
  return `- ${label.name}: ${label.description}${examples}${target}`;
}

/** The fixed text of the dense request. */
export const DENSE_SYSTEM =
  'You label numbered units of a document. For each unit give exactly one label from the list, or none. ' +
  'Answer with JSON only, no other text: {"labels": [{"units": "<n> or <a>-<b>", "label": "<name>"}]}. ' +
  'Every unit must appear once. A range joins neighbouring units that share a label. ' +
  'For a label that asks for a target, add "target": the number of the unit that holds the other end. ' +
  'Never copy text from the units.';

/** The numbered units of a window, one per line: `[n] text`. */
export function windowLines(window: Window): string[] {
  return window.units.map((unit) => `[${unit.n}] ${squash(unit.text)}`);
}

export function denseUser(set: LabelSet, window: Window): string {
  return [
    `SET ${set.set}: ${set.description}`,
    'LABELS:',
    ...set.labels.map(labelLine),
    '- none: no label of this set applies.',
    `WINDOW ${window.id}  path: ${window.headingPath.join(' > ') || '(top)'}`,
    ...windowLines(window),
  ].join('\n');
}

/** Reads the labels of a dense answer: JSON, optionally in one code fence. The request and its answer are one pair, so no id is echoed. */
export function parseDenseAnswer(text: string): Labelled[] {
  const trimmed = text.trim();
  const body = /^```[A-Za-z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed)?.[1] ?? trimmed;
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new LabelerError('the answer is not JSON');
  }
  return denseLabels(value);
}

/** The labels of an answer already parsed: `{ labels: [{ units, label, target? }] }`. */
export function denseLabels(value: unknown): Labelled[] {
  if (!isRecord(value) || !Array.isArray(value.labels)) {
    throw new LabelerError('the answer has no labels list');
  }
  const out: Labelled[] = [];
  for (const entry of value.labels) {
    if (
      !isRecord(entry) ||
      (typeof entry.units !== 'string' && typeof entry.units !== 'number') ||
      typeof entry.label !== 'string'
    ) {
      throw new LabelerError('a label entry is not {units, label}');
    }
    const target = entry.target;
    out.push({
      units: String(entry.units),
      label: entry.label,
      ...(typeof target === 'number' ? { target } : {}),
    });
  }
  return out;
}

/** The opinions of a dense answer: one label per unit it named, a target as the index of the unit in the file. */
export function denseOpinions(answer: Recorded, set: LabelSet, window: Window): Opinions {
  const checked = checkAnswer(set, window, answer.labels ?? []);
  const byUnit = new Map<number, Opinion>();
  for (const unit of window.units) {
    if (!checked.covered.has(unit.n)) continue;
    const accepted = checked.accepted.get(unit.n);
    const targetUnit = accepted?.target === undefined ? undefined : window.units[accepted.target - 1];
    byUnit.set(unit.index, {
      label: accepted?.label ?? 'none',
      ...(targetUnit ? { target: targetUnit.index } : {}),
    });
  }
  return { byUnit, refusals: checked.refusals };
}

export type AnthropicLabelerOptions = HttpOptions & {
  model?: string;
  /** The key. Without it the labeler replays only. It stays in this closure and is never printed. */
  key?: string;
  baseUrl?: string;
  maxTokens?: number;
  /** Hidden reasoning before the answer. Off by default: labelling a numbered window needs none, and it costs output tokens. */
  thinking?: 'off' | 'default';
};

export const DEFAULT_ANTHROPIC_LABELER_MODEL = 'claude-haiku-5-5';

/** A system 2 labeler on the Anthropic Messages API: one dense request per window and set. */
export function createAnthropicLabeler(options: AnthropicLabelerOptions = {}): Labeler {
  const model = options.model ?? DEFAULT_ANTHROPIC_LABELER_MODEL;
  const maxTokens = options.maxTokens ?? 4096;
  const base = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const key = options.key;
  const labeler: Labeler = {
    id: 'anthropic',
    cls: 'system2',
    family: 'anthropic',
    model,
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({
      labeler: 'anthropic',
      body: {
        model,
        max_tokens: maxTokens,
        ...(options.thinking === 'default' ? {} : { thinking: { type: 'disabled' } }),
        system: DENSE_SYSTEM,
        messages: [{ role: 'user', content: denseUser(set, window) }],
      },
    }),
    opinions: denseOpinions,
  };
  if (!key) return labeler;
  return {
    ...labeler,
    async call(wire) {
      const payload = await postJson(
        `${base}/v1/messages`,
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        wire.body,
        errorText,
        options,
      );
      if (!isRecord(payload) || !Array.isArray(payload.content)) {
        throw new ModelError('bad_response', `${model} answered without a content list`);
      }
      const stop = String(payload.stop_reason ?? '');
      if (stop === 'refusal') throw new ModelError('refusal', `${model} declined the request`);
      if (stop === 'max_tokens')
        throw new ModelError('truncated', `${model} stopped at max_tokens: the answer is cut`);
      // Thinking blocks may come before the text: read the blocks by type.
      const text = payload.content
        .filter(
          (block): block is { type: 'text'; text: string } =>
            isRecord(block) && block.type === 'text' && typeof block.text === 'string',
        )
        .map((block) => block.text)
        .join('');
      return {
        labels: parseDenseAnswer(text),
        returnedModel: String(payload.model ?? model),
        stopReason: stop,
        usage: usageOf(payload),
      };
    },
  };
}
