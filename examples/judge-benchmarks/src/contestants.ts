import { buildPrompt, type JudgeRequest, pairwiseRequest, parseAnswerText } from '@driftbench/judges';
import { verifyContestants } from './verify';

/**
 * The contestants: one judge prompt each, run on the same model. driftbench's prompt comes from
 * @driftbench/judges. Each competitor's prompt is its own default judge template, copied verbatim from its
 * source at the commit named beside it, with only the variables filled in. Every contestant that takes a
 * criterion is given the same criterion text.
 *
 * A contestant has a pairwise form (two responses in one call, judged in both orders) or a pointwise form
 * (one response per call). On a pairwise benchmark a pointwise-only contestant scores each response on its
 * own and the higher score wins, the paper-sanctioned way to run a scorer on JudgeBench (`--single_game`).
 *
 * Licences: DeepEval Apache-2.0, promptfoo MIT, Inspect MIT, LangWatch Scenario MIT, Langfuse MIT.
 */

export type Prompt = { readonly system: string; readonly user: string };

/** What a pairwise call decided: the response in position A or B, or no preference. */
export type PairDecision = 'A' | 'B' | 'tie';

/** What a pointwise call decided: a score from 0 to 1 when the judge gives one, and pass or fail. */
export type PointDecision = { readonly pass?: boolean; readonly score?: number };

/** A model call made once per benchmark and reused for every item, such as DeepEval's evaluation steps. */
export type Setup = (call: (prompt: Prompt) => Promise<string>) => Promise<string>;

export type Contestant = {
  readonly id: string;
  /** Where the prompt comes from, for the report. */
  readonly source: string;
  readonly setup?: {
    readonly pair?: (criterion: string) => Prompt;
    readonly point?: (criterion: string) => Prompt;
  };
  /** A contestant that writes its own rubric for each item: the prompt that asks for it. */
  readonly rubric?: (question: string) => Prompt;
  /**
   * Asks first whether the question has a checkable answer; the reference step runs only when it does.
   * The answer is read as YES or NO.
   */
  readonly route?: (question: string) => Prompt;
  /** How many independent judgements a prompt gets; the majority decides. Default 1. */
  readonly samples?: number;
  /**
   * Pairwise only: one verdict from the judgements of both orders together, given to both games. The
   * position bias of one order is outvoted by the other, so the two games never disagree.
   */
  readonly pooled?: boolean;
  /** A contestant that first answers the question itself, once per item: the prompt that asks for it. */
  readonly reference?: (question: string) => Prompt;
  /** Method-diverse blind solves, optionally executed as restricted Python programs. */
  readonly referencePaths?: readonly {
    readonly name: string;
    readonly prompt: (question: string) => Prompt;
    readonly program?: boolean;
  }[];
  /** With method-diverse solves, only use a final answer supported by this fraction of all paths. */
  readonly referenceAgreementThreshold?: number;
  /** Compare complete blind answers, including long lists and multiline program values. */
  readonly fullReferenceAnswers?: boolean;
  /** Recheck accepted answers whose own judgment admits an unstated assumption. */
  readonly postPoint?: {
    readonly when: (decision: PointDecision, texts: readonly string[]) => boolean;
    readonly prompt: NonNullable<Contestant['point']>;
  };
  /** A deterministic, label-blind local solver. No model call or submission is supplied. */
  readonly toolEvidence?: (question: string) => Promise<string | undefined>;
  /** Extract the submitted answers before judging. This step must not solve or correct them. */
  readonly extractResponse?: (question: string, response: string) => Prompt;
  readonly responseExtractor?: {
    readonly local: (question: string, response: string) => string | undefined;
    readonly prompt: (question: string, response: string) => Prompt;
    readonly parse: (text: string, originalResponse: string) => string | undefined;
    /** Optional recovery when a literal final answer cannot be quoted. */
    readonly fallback?: (question: string, response: string) => string;
  };
  readonly pair?: (input: {
    question: string;
    a: string;
    b: string;
    criterion: string;
    setup?: string;
    reference?: string;
  }) => Prompt;
  readonly parsePair?: (text: string) => PairDecision;
  readonly point?: (input: {
    question: string;
    response: string;
    criterion: string;
    setup?: string;
    reference?: string;
  }) => Prompt;
  readonly parsePoint?: (text: string) => PointDecision;
  /** Independent solves per item; the reference is the solve whose final answer is the majority. Default 1. */
  readonly referenceSamples?: number;
  /** Retain all independent derivations instead of choosing their most common final string. */
  readonly referenceAggregation?: 'majority' | 'all';
  /**
   * Long pointwise replies only: each part is read on its own, and the readings are given to the judge as
   * reference notes. A reply longer than `threshold` characters is cut into parts of `size` characters.
   */
  readonly chunkedReading?: {
    readonly threshold: number;
    readonly size: number;
    readonly read: (input: {
      question: string;
      part: string;
      criterion: string;
      index: number;
      total: number;
    }) => Prompt;
  };
  /** Re-derive the final transition of a long response, with the original question and extracted answer. */
  readonly finalStepCheck?: {
    readonly threshold: number;
    readonly size: number;
    readonly read: (question: string, tail: string, answer: string) => Prompt;
  };
  /** A Python program the model writes for the question; its printed output is given to the judge as a reference. */
  readonly codeCheck?: {
    readonly write: (question: string, response?: string) => Prompt;
    /** The program checks the extracted submission as well as the problem. */
    readonly targeted?: boolean;
    /** Require the macOS no-write, no-network, no-child-process sandbox. */
    readonly restricted?: boolean;
  };
  /**
   * Pairwise rubric benchmarks: each reply gets one call that answers every rubric yes or no, and the reply with
   * more satisfied rubrics wins. Neither reply is judged against the other, so no order is involved.
   */
  readonly checklist?: {
    readonly reply: (input: { question: string; reply: string; rubrics: readonly string[] }) => Prompt;
    readonly parse: (text: string, count: number) => boolean[] | undefined;
  };
};

/** Every balanced JSON object in a text that parses, in order of where it starts. */
export function jsonObjects(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const value = JSON.parse(text.slice(start, i + 1)) as unknown;
            if (value && typeof value === 'object' && !Array.isArray(value))
              found.push(value as Record<string, unknown>);
          } catch {
            // Braces that are not JSON, such as LaTeX: try the next opening brace.
          }
          break;
        }
      }
    }
  }
  return found;
}

/** The last JSON object of a text that holds the key, or the last object when no key is asked for. */
function lastJson(text: string, key?: string): Record<string, unknown> | undefined {
  const objects = jsonObjects(text).filter((o) => key === undefined || key in o);
  return objects.at(-1);
}

function score01(value: unknown, scale = 1): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n / scale)) : undefined;
}

// driftbench: the judge prompt of @driftbench/judges, pairwise through pairwiseRequest.

/** A reference answer the judge worked out itself goes in as context: it may be wrong, and the rules say so. */
function referenceEntry(reference: string | undefined): { role: 'context'; text: string }[] {
  return reference
    ? [
        {
          role: 'context',
          text: `Reference answer the judge worked out independently (it may itself be wrong): ${reference}`,
        },
      ]
    : [];
}

function driftbenchPointRequest(
  question: string,
  response: string,
  criterion: string,
  reference?: string,
): JudgeRequest {
  return {
    criterion: { name: 'benchmark', rubric: criterion, scope: 'block' },
    transcript: [
      { role: 'user', text: question },
      ...referenceEntry(reference),
      { role: 'agent', text: response },
    ],
  };
}

/**
 * A driftbench judge configuration. `extra` adds rules to the end of the system prompt; the answer is still
 * the JSON contract, read as the last JSON object of the text, so a judge may reason before it.
 */
function driftbenchJudge(id: string, source: string, extra?: string, pairExtra?: string): Contestant {
  const withRules = (prompt: Prompt, more?: string): Prompt => {
    const rules = [extra, more].filter(Boolean).join('\n\n');
    return rules ? { ...prompt, system: `${prompt.system}\n\n${rules}` } : prompt;
  };
  return {
    id,
    source,
    pair: ({ question, a, b, criterion, reference }) =>
      withRules(
        buildPrompt(
          pairwiseRequest(
            { name: 'benchmark', rubric: criterion },
            [{ role: 'user', text: question }, ...referenceEntry(reference)],
            a,
            b,
          ),
        ),
        pairExtra,
      ),
    parsePair: (text) => {
      const { answer, unparsed } = parseAnswerText(text);
      if (unparsed || answer.outcome === 'inconclusive') return 'tie';
      return answer.outcome === 'pass' ? 'A' : 'B';
    },
    point: ({ question, response, criterion, reference }) =>
      withRules(buildPrompt(driftbenchPointRequest(question, response, criterion, reference))),
    parsePoint: (text) => {
      const { answer, unparsed } = parseAnswerText(text);
      if (unparsed || answer.outcome === 'inconclusive') return {};
      return {
        pass: answer.outcome === 'pass',
        ...(answer.score === undefined ? {} : { score: answer.score }),
      };
    },
  };
}

/** The judge prompt of @driftbench/judges as it ships, untuned. */
const driftbench = driftbenchJudge(
  'driftbench',
  'packages/judges/src/prompt.ts and pairwise.ts (this repository)',
);

/**
 * Tuning candidates, chosen on the dev split only. Each adds rules to the shipped prompt; none changes the
 * answer contract.
 */
export const STEPWISE_RULES = [
  'Before the JSON object, reason step by step in plain text. Read every part of the data the criterion depends on.',
  'When the question has a checkable answer (a computation, a fact, a choice among options, code that must run), work out the answer yourself first, then compare each response with your own answer. A fluent response with a wrong final answer fails.',
  'Then give the JSON object as the last thing you write. Its reasoning field summarises your reasoning in two sentences.',
]
  .map((rule) => `- ${rule}`)
  .join('\n');

/**
 * RubricBench's question: the same judge with a rubric it writes itself from the instruction, instead of
 * the human one. The rubric prompt asks for atomic, checkable requirements derived from the instruction only.
 */
const RUBRIC_PROMPT = `Write the rubric a strict reviewer would use to judge any response to the instruction below.
List 3 to 8 atomic requirements, one per line, each a yes or no question about the response, each derived
only from what the instruction asks (explicit constraints first, then the implicit ones a careful expert
would expect). Do not answer the instruction. Write only the list.`;

const driftbenchSelfRubric: Contestant = {
  ...driftbench,
  id: 'driftbench-selfrubric',
  source: 'the shipped prompt with a rubric the judge writes itself (RubricBench mode)',
  rubric: (question) => ({
    system: '',
    user: `${RUBRIC_PROMPT}\n\n<instruction>\n${question}\n</instruction>`,
  }),
};

const driftbenchStepwise = driftbenchJudge(
  'driftbench-stepwise',
  'the shipped prompt plus a reasoning step and solve-first rules (tuning candidate)',
  `Reasoning rules:\n${STEPWISE_RULES}`,
);

// DeepEval (confident-ai/deepeval at 4598fe8): ArenaGEval for pairs, GEval for single responses. Both first
// generate evaluation steps from the criteria (one call per benchmark), then judge with those steps.
// Templates: deepeval/metrics/arena_g_eval/templates/*.txt and deepeval/metrics/g_eval/templates/*.txt.

const DEEPEVAL_ARENA_STEPS = `Given an evaluation criteria which outlines how you should choose the winner out of all contestants based on the {{ parameters }}, generate 3-4 concise evaluation steps based on the criteria below. You MUST make it clear how to evaluate {{ parameters }} in relation to one another.



Evaluation Criteria:
{{ criteria }}

**
IMPORTANT: Please make sure to only return in JSON format, with the "steps" key as a list of strings. No words or explanation is needed.
Example JSON:
{
  "steps": <list_of_strings>
}
**

JSON:`;

const DEEPEVAL_ARENA_WINNER = `
You are a judge. Given the following evaluation steps, select the single contestant that best aligns with the evaluation steps.



Return a JSON object with two fields:

- \`"winner"\`: the exact contestant name that is best aligned with the evaluation steps. This MUST NOT contain any symbols or $ wrappers (e.g., return "Grace", not "$Grace$").
- \`"reason"\`: a brief explanation for why the contestant was chosen. This must mention specific strengths or shortcomings, and reference relevant details from BOTH the winner's parameters AND ALL the other contestants' parameters, but DO NOT mention the contestant indeces, and refer to the contestants ONLY by their Contestant Name formatted by wrapping in $contesntant_name$.

Your explanation should:
- Be specific and grounded in the evaluation steps.
- Mention key details from the contestants' parameters.
- Be concise, clear, and focused on the evaluation logic.
- Wrap the contestant name in $contesntant_name$ when referring to the contestant.

!!! IMPORTANT\x20
Refer to contestants ONLY by their unique contestant name.
!!!\x20

Only return valid JSON. Do **not** include any extra commentary or text.

---

Evaluation Steps:
{{ evaluation_steps }}

Contestants:
{{ test_case_contents }}

Parameters:
{{ parameters }}

---
**Example JSON:**
{
  "winner": "Grace",
  "reason": "<your-concise-and-informative-reason-here>"
}

JSON:`;

const DEEPEVAL_GEVAL_STEPS = `Given an evaluation criteria which outlines how you should judge the {{ parameters }}, generate 3-4 concise evaluation steps based on the criteria below. You MUST make it clear how to evaluate {{ parameters }} in relation to one another.



Evaluation Criteria:
{{ criteria }}

**
IMPORTANT: Please make sure to only return in JSON format, with the "steps" key as a list of strings. No words or explanation is needed.
Example JSON:
{
  "steps": <list_of_strings>
}
**

JSON:`;

const DEEPEVAL_GEVAL_RESULTS = `You are an evaluator. Given the following evaluation steps, assess the response below and return a JSON object with two fields:

- \`"score"\`: an integer between 0 and 10, with 10 indicating strong alignment with the evaluation steps and 0 indicating no alignment.
- \`"reason"\`: a brief explanation for why the score was given. This must mention specific strengths or shortcomings, referencing relevant details from the input. Do **not** quote the score itself in the explanation.

Your explanation should:
- Be specific and grounded in the evaluation steps.
- Mention key details from the test case parameters.
- Be concise, clear, and focused on the evaluation logic.


Only return valid JSON. Do **not** include any extra commentary or text.

---

Evaluation Steps:
{{ evaluation_steps }}

Test Case:
{{ test_case_content }}

Parameters:
{{ parameters }}

---
**Example JSON:**
{
  "reason": "your concise and informative reason here",
  "score": 0
}

JSON:`;

const DEEPEVAL_PARAMETERS = 'Input and Actual Output';

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{ (\w+) \}\}/g, (match, key: string) => values[key] ?? match);
}

/** DeepEval numbers the generated steps one per line. */
function numberedSteps(setup: string | undefined): string {
  const steps = lastJson(setup ?? '', 'steps')?.steps;
  const list = Array.isArray(steps) ? steps.map(String) : [setup ?? ''];
  return list.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

const deepeval: Contestant = {
  id: 'deepeval',
  source: 'DeepEval 4598fe8: ArenaGEval (pairs) and GEval (single responses)',
  setup: {
    pair: (criteria) => ({
      system: '',
      user: fill(DEEPEVAL_ARENA_STEPS, { parameters: DEEPEVAL_PARAMETERS, criteria }),
    }),
    point: (criteria) => ({
      system: '',
      user: fill(DEEPEVAL_GEVAL_STEPS, { parameters: DEEPEVAL_PARAMETERS, criteria }),
    }),
  },
  // Contestant names are masked; DeepEval draws them at random, here Alice holds position A and Bob B.
  pair: ({ question, a, b, setup }) => {
    const contents = JSON.stringify(
      {
        input: question,
        arena_test_cases: {
          Alice: JSON.stringify({ actual_output: a }, null, 2),
          Bob: JSON.stringify({ actual_output: b }, null, 2),
        },
      },
      null,
      2,
    );
    return {
      system: '',
      user: fill(DEEPEVAL_ARENA_WINNER, {
        evaluation_steps: numberedSteps(setup),
        test_case_contents: contents,
        parameters: DEEPEVAL_PARAMETERS,
      }),
    };
  },
  parsePair: (text) => {
    const winner = String(lastJson(text, 'winner')?.winner ?? '')
      .replace(/\$/g, '')
      .trim();
    return winner === 'Alice' ? 'A' : winner === 'Bob' ? 'B' : 'tie';
  },
  point: ({ question, response, setup }) => ({
    system: '',
    user: fill(DEEPEVAL_GEVAL_RESULTS, {
      evaluation_steps: numberedSteps(setup),
      test_case_content: `Input:\n${question}\n\nActual Output:\n${response}`,
      parameters: DEEPEVAL_PARAMETERS,
    }),
  }),
  // GEval normalises the 0 to 10 score to 0 to 1; its default threshold is 0.5.
  parsePoint: (text) => {
    const score = score01(lastJson(text, 'score')?.score, 10);
    return score === undefined ? {} : { score, pass: score >= 0.5 };
  },
};

// promptfoo (promptfoo/promptfoo at 8014282, src/prompts/grading.ts): select-best for pairs, llm-rubric for
// single responses. select-best is one system message; the output index 0 is position A.

const PROMPTFOO_SELECT_BEST = `You are comparing multiple pieces of text to see which best fits the following criteria: {{criteria}}

Here are the pieces of text:

<Text index="0">
{{a}}
</Text>

<Text index="1">
{{b}}
</Text>

Output the index of the text that best fits the criteria. You must output a single integer.`;

const PROMPTFOO_RUBRIC_SYSTEM = `You are grading output according to a user-specified rubric. If the statement in the rubric is true, then the output passes the test. You respond with a JSON object with this structure: {reason: string, pass: boolean, score: number}

Examples:

<Output>Hello world</Output>
<Rubric>Content contains a greeting</Rubric>
{"reason": "the content contains the word 'Hello'", "pass": true, "score": 1.0}

<Output>Avast ye swabs, repel the invaders!</Output>
<Rubric>Does not speak like a pirate</Rubric>
{"reason": "'avast ye' is a common pirate term", "pass": false, "score": 0.0}`;

const promptfoo: Contestant = {
  id: 'promptfoo',
  source: 'promptfoo 8014282: select-best (pairs) and llm-rubric (single responses)',
  // select-best shows only the outputs; the question goes into the criteria, as a user templates it.
  pair: ({ question, a, b, criterion }) => ({
    system: PROMPTFOO_SELECT_BEST.replace('{{criteria}}', `${criterion} The question: ${question}`)
      .replace('{{a}}', a)
      .replace('{{b}}', b),
    user: 'Output the index now.',
  }),
  parsePair: (text) => {
    const index = text.trim().match(/-?\d+/)?.[0];
    return index === '0' ? 'A' : index === '1' ? 'B' : 'tie';
  },
  point: ({ question, response, criterion }) => ({
    system: PROMPTFOO_RUBRIC_SYSTEM,
    user: `<Output>\n${response}\n</Output>\n<Rubric>\n${criterion} The question: ${question}\n</Rubric>`,
  }),
  parsePoint: (text) => {
    const json = lastJson(text, 'pass') ?? lastJson(text, 'score');
    if (!json) return {};
    const score = score01(json.score);
    const pass = typeof json.pass === 'boolean' ? json.pass : undefined;
    return { ...(pass === undefined ? {} : { pass }), ...(score === undefined ? {} : { score }) };
  },
};

// Inspect (UKGovernmentBEIS/inspect_ai at a1dbea8, scorer/_model.py): model_graded_qa, the default template
// and instructions. No pairwise scorer: pairs are scored one response at a time.

const INSPECT_TEMPLATE = `
You are assessing a submitted answer on a given task based on a criterion. Here is the data:

[BEGIN DATA]
***
[Task]: {question}
***
[Submission]: {answer}
***
[Criterion]: {criterion}
***
[END DATA]

Does the submission meet the criterion?

{instructions}
`;

const INSPECT_INSTRUCTIONS = `
After assessing the submitted answer, reply with 'GRADE: $LETTER' (without quotes) where LETTER is one of CI.  Please choose ONE option for the grade: either "C" for correct answers, or "I" for incorrect answers.

For example, after reviewing a correct answer you might write 'GRADE: C' or after reviewing an incorrect answer you might write 'GRADE: I'.

First, write out in a step by step manner your reasoning about the criterion to be sure that your conclusion is correct. Avoid simply stating the correct answers at the outset. Then, end with your answer formatted as 'GRADE: $LETTER' (without quotes) where LETTER is one of CI.
`;

const inspect: Contestant = {
  id: 'inspect',
  source: 'Inspect a1dbea8: model_graded_qa default template',
  point: ({ question, response, criterion }) => ({
    system: '',
    user: INSPECT_TEMPLATE.replace('{question}', question)
      .replace('{answer}', response)
      .replace('{criterion}', criterion)
      .replace('{instructions}', INSPECT_INSTRUCTIONS),
  }),
  parsePoint: (text) => {
    const grade = [...text.matchAll(/GRADE:\s*([CI])/g)].at(-1)?.[1];
    return grade === 'C' ? { pass: true, score: 1 } : grade === 'I' ? { pass: false, score: 0 } : {};
  },
};

// LangWatch Scenario (langwatch/scenario at ad220e6, python/scenario/judge_agent.py and
// _judge/criterion_verdicts.py): the default judge system prompt and the finish_test schema. The judge
// answers through a forced tool call; the claude command runs with no tool, so the same schema is asked for
// as a JSON object, the one change to their mechanism.

const SCENARIO_RULES = [
  'Judge each criterion on its own: restate it as a positive requirement, check the conversation and the collected evidence for that requirement alone, write the reasoning, then choose its status. The outcome of one criterion never decides another.',
  'passed means the agent satisfied the requirement. A criterion phrased as a fail condition ("fail if X", "fail only if X", "pass unless X", "the agent must not X") passes when X did not happen and fails when X happened.',
  'When the evidence to decide a criterion is not available (the conversation ended before the moment it depends on, or it depends on internal behavior that left no trace), mark it inconclusive and name the missing evidence in its reasoning instead of guessing.',
];

function scenarioSystem(criterion: string): string {
  return `
<role>
You are an LLM as a judge delivering the final verdict on a simulated conversation, determining if the agent under test meets the criteria or not.
</role>

<goal>
Your goal is to deliver the final verdict of the scenario below with the finish_test tool, judging each criterion on its own against the conversation and the collected evidence.
</goal>

<scenario>
A user asks a question and the agent answers it.
</scenario>

<criteria>
1. ${criterion}
</criteria>

<rules>
- Be strict: a criterion passes only when the conversation or the collected evidence clearly shows it was met.
- DO NOT make any judgment calls that are not explicitly listed in the success or failure criteria, withhold judgement if necessary
${SCENARIO_RULES.map((rule) => `- ${rule}`).join('\n')}
</rules>
`;
}

const SCENARIO_FINISH_TEST = `Complete the test with a verdict on each criterion, judged one by one. Answer with the arguments of the finish_test tool as one JSON object: {"criteria": {"criterion_1": {"requirement": "This criterion restated as a positive requirement the agent must satisfy.", "reasoning": "What the conversation and the collected evidence show about this requirement alone, pointing at the moment that decides it. Written before the status.", "status": "passed | failed | inconclusive"}}, "reasoning": "A short summary of the verdict across all criteria, written after judging each one."}`;

const scenario: Contestant = {
  id: 'scenario',
  source: 'LangWatch Scenario ad220e6: default judge prompt and finish_test schema',
  point: ({ question, response, criterion }) => ({
    system: scenarioSystem(criterion),
    user: `
<transcript>
user: ${question}
assistant: ${response}
</transcript>
<opentelemetry_traces>
No traces.
</opentelemetry_traces>

${SCENARIO_FINISH_TEST}`,
  }),
  parsePoint: (text) => {
    const criteria = lastJson(text, 'criteria')?.criteria as Record<string, { status?: string }> | undefined;
    const status = criteria ? Object.values(criteria)[0]?.status : undefined;
    return status === 'passed'
      ? { pass: true, score: 1 }
      : status === 'failed'
        ? { pass: false, score: 0 }
        : {};
  },
};

// Langfuse (langfuse/langfuse at cb2ceba, worker/src/constants/managed-evaluators.json): the managed
// "Simple Criteria" evaluator, the one that takes a criterion of the user's. A score from 0 to 1. Its first
// three lines are the template; the last line is its output definition, which Langfuse asks for as
// structured output and is here asked for as a JSON object.

const LANGFUSE_SIMPLE_CRITERIA = `Evaluate the input based on the criteria defined.
Criteria Definition: {{criteria_definition}}
Input: {{input}}
{"score": "Score between 0 and 1. Score 0 if false or negative and 1 if true or positive", "reasoning": "One sentence reasoning for the score"}`;

const langfuse: Contestant = {
  id: 'langfuse',
  source: 'Langfuse cb2ceba: managed evaluator "Simple Criteria"',
  point: ({ question, response, criterion }) => ({
    system: '',
    user: LANGFUSE_SIMPLE_CRITERIA.replace('{{criteria_definition}}', criterion).replace(
      '{{input}}',
      `Question: ${question}\nResponse: ${response}`,
    ),
  }),
  parsePoint: (text) => {
    const score = score01(lastJson(text, 'score')?.score);
    return score === undefined ? {} : { score, pass: score >= 0.5 };
  },
};

export const CONTESTANTS: readonly Contestant[] = [
  driftbench,
  deepeval,
  promptfoo,
  inspect,
  scenario,
  langfuse,
];

/** driftbench judge configurations tried on the dev split, beside the shipped one. */
/** Pairwise: a choice between two replies, symmetric in the two positions. */
export const PAIRWISE_RULES = [
  'This is a choice between two replies, not a strict pass check: pass means Reply A is the better reply, fail means Reply B is the better reply. Both answers need the same evidence; neither is a default.',
  'Decide which reply better meets the criterion on its merits. The order of the replies must not change your choice: judge as if their positions were swapped.',
  'When the criterion is about correctness and one final answer is right and the other wrong, the right one is better, whatever the style or length of either. Answer inconclusive only when both replies are equally right or equally wrong.',
]
  .map((rule) => `- ${rule}`)
  .join('\n');

/** Pointwise checks of a verifiable answer: decide, do not abstain. */
export const VERIFY_RULES = [
  'When the criterion is whether an answer is correct and the question can be checked, check it yourself and decide pass or fail. Inconclusive is only for data that is missing, never for a hard check.',
]
  .map((rule) => `- ${rule}`)
  .join('\n');

const driftbenchTuned = driftbenchJudge(
  'driftbench-tuned',
  'the shipped prompt plus reasoning, solve-first, symmetric pairwise and no-abstain rules (tuned on dev)',
  `Reasoning rules:\n${STEPWISE_RULES}\n${VERIFY_RULES}`,
  `Pairwise rules:\n${PAIRWISE_RULES}`,
);

const driftbenchSymmetric = driftbenchJudge(
  'driftbench-symmetric',
  'the shipped prompt plus the symmetric pairwise rules only (tuning candidate)',
  undefined,
  `Pairwise rules:\n${PAIRWISE_RULES}`,
);

/**
 * The reference step: before judging, the judge answers the question itself, once per item; the answer goes
 * in as context for both orders, so the two games compare against the same reference.
 */
const REFERENCE_PROMPT = `Answer the question below yourself, as an expert would. Work it out step by step, then end with
one line that starts with "Final answer:". If the question asks for writing or advice rather than a
checkable answer, list in a few lines what a correct and complete answer must contain instead.`;

const referencePrompt = (question: string): Prompt => ({
  system: '',
  user: `${REFERENCE_PROMPT}\n\n<question>\n${question}\n</question>`,
});

const driftbenchReference: Contestant = {
  ...driftbenchJudge(
    'driftbench-reference',
    'driftbench-tuned plus a reference answer the judge works out first (tuning candidate)',
    `Reasoning rules:\n${STEPWISE_RULES}\n${VERIFY_RULES}\n- When a reference answer is given, check it before relying on it; where it agrees with your own check, prefer the reply that matches it.`,
    `Pairwise rules:\n${PAIRWISE_RULES}`,
  ),
  reference: referencePrompt,
};

const driftbenchReference3: Contestant = {
  ...driftbenchReference,
  id: 'driftbench-reference3',
  source:
    'driftbench-reference with three independent judgements per prompt, the majority deciding (tuning candidate)',
  samples: 3,
};

/** Stricter answer checks: a verified reference, and a final-answer comparison before the verdict. */
const CHECK_RULES = [
  'Before the verdict, write the final answer the response gives, then the final answer you verified. Pass only when they agree, allowing equivalent forms (2/4 and 1/2, the same option in other words).',
  'When your answer and the reference disagree, recheck the step where they part before deciding. A response that reaches the right answer through wrong steps still has the right final answer.',
]
  .map((rule) => `- ${rule}`)
  .join('\n');

const REFERENCE_CHECKED_PROMPT = `${REFERENCE_PROMPT}
Before the final line, check your answer by a second, independent method (substitute it back, estimate it,
or test the option against every condition). If the two disagree, find the error first.`;

const driftbenchChecked: Contestant = {
  ...driftbenchJudge(
    'driftbench-checked',
    'driftbench-reference3 with a checked reference and a final-answer comparison (tuning candidate)',
    `Reasoning rules:\n${STEPWISE_RULES}\n${VERIFY_RULES}\n${CHECK_RULES}`,
    `Pairwise rules:\n${PAIRWISE_RULES}`,
  ),
  reference: (question) => ({
    system: '',
    user: `${REFERENCE_CHECKED_PROMPT}\n\n<question>\n${question}\n</question>`,
  }),
  samples: 3,
};

const ROUTE_PROMPT = `Does the question below have one checkable correct answer, such as a number, a choice among options,
a fact, a proof result or the behaviour of code? Creative writing, advice, opinion, style and open-ended
requests do not. Answer with one word: YES or NO.`;

/**
 * The adaptive judge: driftbench-reference3 where the question has a checkable answer, and the same judge
 * without a reference (three judgements, symmetric pairwise rules) where it does not.
 */
const driftbenchAdaptive: Contestant = {
  ...driftbenchReference3,
  id: 'driftbench-adaptive',
  source:
    'the shipped prompt with reasoning, solve-first and symmetric pairwise rules, three judgements, and a reference answer when the question is checkable (tuned on dev)',
  route: (question) => ({ system: '', user: `${ROUTE_PROMPT}\n\n<question>\n${question}\n</question>` }),
};

/** driftbench-adaptive with the judgements of both orders pooled into one verdict (tuned on dev). */
const driftbenchPooled: Contestant = {
  ...driftbenchAdaptive,
  id: 'driftbench-pooled',
  source:
    'driftbench-adaptive, with the three judgements of each order pooled into one verdict for the pair (tuned on dev)',
  pooled: true,
};

/** Reference from the majority of five solves: the first solve is the one adaptive already records. */
const driftbenchMajRef: Contestant = {
  ...driftbenchAdaptive,
  id: 'driftbench-majref',
  source:
    'driftbench-adaptive with the reference taken from the majority of five independent solves (tuning candidate)',
  referenceSamples: 5,
};

/** Long replies read in parts before the verdict (tuning candidate). */
const driftbenchChunked: Contestant = {
  ...driftbenchAdaptive,
  id: 'driftbench-chunked',
  source:
    'driftbench-adaptive with long replies read in parts, and the readings given as reference notes (tuning candidate)',
  chunkedReading: {
    threshold: 10000,
    size: 4000,
    read: ({ question, part, criterion, index, total }) => ({
      system: '',
      user: `You are reading part ${index} of ${total} of a longer reply to a question. Judge the criterion only from what the question asks.\n\nCriterion: ${criterion}\n\n<question>\n${question}\n</question>\n\n<part>\n${part}\n</part>\n\nIn at most five lines: state any step, calculation or claim in this part that is wrong, and the final answer this part gives if it gives one. If this part has no errors, say so.`,
    }),
  },
};

/** A program the model writes is run, and its output is a reference (tuning candidate). */
const driftbenchCodeCheck: Contestant = {
  ...driftbenchAdaptive,
  id: 'driftbench-codecheck',
  source:
    'driftbench-adaptive with the printed output of a program the model writes as a reference (tuning candidate)',
  codeCheck: {
    write: (question) => ({
      system: '',
      user: `Write a short Python 3 program, standard library only, that works out the answer to the question below independently and prints only the final answer on one line. Output only the program, in one python code block.\n\n<question>\n${question}\n</question>`,
    }),
  },
};

/** Rubric checklist: one call per reply, every rubric answered yes or no (tuning candidate). */
const driftbenchChecklist: Contestant = {
  ...driftbench,
  id: 'driftbench-checklist',
  source:
    'the rubrics answered one by one for each reply, the reply with more satisfied rubrics wins (tuning candidate)',
  checklist: {
    reply: ({ question, reply, rubrics }) => ({
      system:
        'You check a reply against a list of requirements, one at a time. Judge only what the reply itself says.',
      user: `Question:\n${question}\n\nReply:\n${reply}\n\nRequirements:\n${rubrics.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nFor each requirement, decide whether the reply satisfies it. Answer with one JSON object and nothing else: {"checks": [true or false for each requirement, in order]}`,
    }),
    parse: (text, count) => {
      const checks = jsonObjects(text)
        .filter((o) => Array.isArray(o.checks))
        .at(-1)?.checks as unknown[] | undefined;
      if (!checks || checks.length !== count) return undefined;
      const out: boolean[] = [];
      for (const c of checks) {
        if (c === true || c === 'true' || c === 'yes') out.push(true);
        else if (c === false || c === 'false' || c === 'no') out.push(false);
        else return undefined;
      }
      return out;
    },
  },
};

export const CANDIDATES: readonly Contestant[] = [
  ...verifyContestants(referencePrompt, jsonObjects),
  driftbenchAdaptive,
  driftbenchChecked,
  driftbenchChecklist,
  driftbenchChunked,
  driftbenchCodeCheck,
  driftbenchMajRef,
  driftbenchPooled,
  driftbenchReference,
  driftbenchReference3,
  driftbenchStepwise,
  driftbenchSelfRubric,
  driftbenchSymmetric,
  driftbenchTuned,
];

export function contestantById(id: string): Contestant {
  const all = [...CONTESTANTS, ...CANDIDATES];
  const found = all.find((c) => c.id === id);
  if (!found) throw new Error(`no contestant ${id}; known: ${all.map((c) => c.id).join(', ')}`);
  return found;
}

/** The verbatim template texts, for the check against each source. */
export const TEMPLATES = {
  DEEPEVAL_ARENA_STEPS,
  DEEPEVAL_ARENA_WINNER,
  DEEPEVAL_GEVAL_STEPS,
  DEEPEVAL_GEVAL_RESULTS,
  PROMPTFOO_SELECT_BEST,
  PROMPTFOO_RUBRIC_SYSTEM,
  INSPECT_TEMPLATE,
  INSPECT_INSTRUCTIONS,
  LANGFUSE_SIMPLE_CRITERIA,
  SCENARIO_RULES,
} as const;
