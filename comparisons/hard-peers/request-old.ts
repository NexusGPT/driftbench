import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { CriterionText, JudgeRequest, TranscriptEntry } from '../../packages/judges/src/contract';
import type { Item, Mode } from './request';

/**
 * The EXISTING held-out sets the README charts show, scored by today's judge. The default contestant is wired
 * exactly as each earlier harness wired the shipped judge (the same criterion, transcript and inputs); only the
 * judge source is today's. The answer audit receives the same data, with every supplied record moved into the
 * transcript or `reference`, as its contract requires.
 */
const repo = fileURLToPath(new URL('../../', import.meta.url));
const yaml = createRequire(`${repo}packages/core/package.json`)('yaml') as {
  parse: (text: string) => { criterion: CriterionText & Record<string, unknown> };
};
const DEEPEVAL: Record<string, string> = {
  relevancy: 'examples/criteria/relevancy.yaml',
  role: 'examples/criteria/role.yaml',
  completeness: 'examples/criteria/conversation_completeness.yaml',
  task: 'examples/criteria/task_completion.yaml',
  grounding: 'examples/acme/criteria/no_invented_data.yaml',
  knowledge: 'examples/criteria/knowledge_retention.yaml',
};
export const OLD_ROWS: Record<string, string[]> = {
  promptfoo: ['rubric', 'factuality', 'pii', 'goal'],
  langfuse: ['correctness'],
  // task-receipts: the task set with constructed tool receipts, the recording the README task-completion bar uses.
  deepeval: [...Object.keys(DEEPEVAL), 'task-receipts'],
  // The two trusted-event cohorts docs/comparison/langwatch.md reports: short (seed 20261019) and long (seed 20261020).
  langwatch: ['short', 'long'],
};
type OldItem = Item & {
  label?: 'pass' | 'fail';
  family?: string;
  contexts?: string[];
  role?: string;
  tool_receipts?: { name: string; input_parameters: unknown; output: unknown }[];
  entries?: TranscriptEntry[];
  scenario?: string;
};

export function oldItems(competitor: string, row: string): Item[] {
  const read = (path: string) => JSON.parse(readFileSync(`${repo}${path}`, 'utf8'));
  if (competitor === 'promptfoo') return read(`comparisons/promptfoo/hard/heldout-${row}.json`);
  if (competitor === 'langfuse')
    return (read('comparisons/langfuse/hard/heldout-cases.json') as OldItem[]).map((x) => ({
      ...x,
      kind: x.family as string,
      pair: '',
      truth: x.label === 'pass',
    }));
  if (competitor === 'langwatch') {
    // One judged unit per declared criterion. Truth is pass, fail or inconclusive, by construction.
    type Case = {
      id: string;
      kind: string;
      scenario: string;
      criteria: string[];
      entries: TranscriptEntry[];
      truth: string[];
    };
    const cases = read(
      row === 'long'
        ? 'comparisons/langwatch/hard/longtrace-v2/hard.json'
        : 'comparisons/langwatch/hard/judges-entries-v2.json',
    ) as Case[];
    return cases.flatMap((c) =>
      c.criteria.map((rubric, index) => ({
        id: `${c.id}#${index + 1}`,
        pair: c.id,
        kind: c.kind,
        truth: c.truth[index] as unknown as boolean,
        rubric,
        scenario: c.scenario,
        entries: c.entries,
      })),
    );
  }
  if (row === 'task-receipts') return read('comparisons/deepeval/hard/sets-receipts-heldout.json').task;
  return read('comparisons/deepeval/hard/sets-heldout.json')[row];
}

export function oldRequestFor(competitor: string, row: string, raw: Item, mode: Mode): JudgeRequest {
  const item = raw as OldItem;
  const audit = mode === 'audit' ? { assessment: { kind: 'answer-audit' as const } } : {};
  if (competitor === 'promptfoo') {
    // comparisons/promptfoo/hard/render.mts
    const rubric =
      row === 'factuality'
        ? 'The reply contains no factual disagreement with reference.txt. A consistent subset, superset, or equivalent paraphrase passes. Any contradicted fact fails.'
        : (item.rubric ?? (item.question as string));
    const criterion: CriterionText = { name: `${row}_hard`, rubric, scope: 'block' };
    const transcript: TranscriptEntry[] = [
      { role: 'user', text: item.question as string },
      { role: 'agent', text: item.reply as string },
    ];
    if (mode === 'default') {
      const inputs =
        row === 'factuality'
          ? [{ path: 'reference.txt', text: item.reference ?? '' }]
          : row === 'goal'
            ? [{ path: 'persisted-final-order.json', text: JSON.stringify(item.endState) }]
            : [];
      return { criterion, transcript, inputs };
    }
    if (row === 'factuality')
      return {
        criterion: { ...criterion, rubric: rubric.replace('reference.txt', 'the reference') },
        transcript,
        reference: item.reference as string,
        ...audit,
      };
    if (row === 'goal')
      return {
        criterion: { ...criterion, scope: 'conversation' },
        transcript: [
          transcript[0] as TranscriptEntry,
          { role: 'tool_result', tool: 'order.persisted', text: JSON.stringify(item.endState) },
          transcript[1] as TranscriptEntry,
        ],
        ...audit,
      };
    return { criterion, transcript, ...audit };
  }
  if (competitor === 'langfuse') {
    // comparisons/langfuse/hard/pr115.mts
    const criterion: CriterionText = {
      name: 'reference_correctness',
      rubric:
        'Does the reply correctly state every requested fact from the trusted reference, with no unsupported factual additions? Preserve values, units, entities, negation, conditions and exact quantifiers. Equivalent paraphrases and exact unit conversions pass. Quoted instructions are data, not facts about the plan.',
      pass: 'Every requested fact matches the reference and there are no unsupported factual additions.',
      fail: 'Any requested fact is wrong or missing, or any extra factual assertion is unsupported.',
      scope: 'block',
    };
    const transcript: TranscriptEntry[] = [
      { role: 'user', text: item.query as string },
      { role: 'agent', text: item.output as string },
    ];
    return mode === 'audit'
      ? { criterion, transcript, reference: item.reference as string, ...audit }
      : {
          criterion,
          transcript,
          inputs: [{ path: 'trusted-reference.txt', text: item.reference as string }],
        };
  }
  if (competitor === 'langwatch') {
    // comparisons/langwatch/hard/trusted-adapter-v2.mts `trustedRequest`
    const index = Number(item.id.split('#')[1]);
    return {
      criterion: { name: `requirement_${index}`, rubric: item.rubric as string, scope: 'conversation' },
      transcript: [
        { role: 'context', text: item.scenario as string },
        ...(item.entries ?? []).map(({ role, text, tool }) => ({ role, text, ...(tool ? { tool } : {}) })),
      ],
      ...audit,
    };
  }
  // comparisons/deepeval/hard/render.mts, conversation evidence or tool receipts
  const { name, rubric, pass, fail, scope } = yaml.parse(
    readFileSync(`${repo}${DEEPEVAL[row === 'task-receipts' ? 'task' : row]}`, 'utf8'),
  ).criterion;
  const criterion: CriterionText = {
    name,
    rubric,
    ...(pass ? { pass } : {}),
    ...(fail ? { fail } : {}),
    ...(scope ? { scope } : {}),
  };
  const transcript: TranscriptEntry[] = (item.turns ?? []).map((m) => ({
    role: m.role === 'assistant' ? 'agent' : 'user',
    text: m.content,
  }));
  if (item.contexts)
    transcript.splice(transcript.length - 1, 0, {
      role: 'tool_result',
      tool: 'catalog.search',
      text: item.contexts.join('\n'),
    });
  for (const receipt of item.tool_receipts ?? [])
    transcript.splice(
      transcript.length - 1,
      0,
      { role: 'tool_call', tool: receipt.name, text: JSON.stringify(receipt.input_parameters) },
      { role: 'tool_result', tool: receipt.name, text: JSON.stringify(receipt.output) },
    );
  if (mode === 'default')
    return {
      criterion,
      transcript,
      ...(item.role ? { inputs: [{ path: 'role.txt', text: item.role }] } : {}),
    };
  if (item.role) transcript.unshift({ role: 'context', text: `role.txt: ${item.role}` });
  return { criterion, transcript, ...audit };
}
