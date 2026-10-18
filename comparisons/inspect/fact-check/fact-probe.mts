// Fact-check on a labelled set: does the reply state the expert fact? Two prompt formats, one model, the claude command.
// Usage: npx tsx comparisons/inspect/fact-check/fact-probe.mts ours|theirs [out.json]
// Set CLAUDE_BIN to the claude command if it is not on the path. Each call is capped at 0.02 USD.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type JudgeRequest, parseAnswerText } from '../../../packages/judges/src/contract';
import { buildPrompt } from '../../../packages/judges/src/prompt';

const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const variant = process.argv[2] ?? 'ours';
const OUT = process.argv[3] ?? fileURLToPath(new URL(`./out/fact-${variant}.json`, import.meta.url));
const REPEATS = 2;

// Labelled by construction: pass = the reply states the expert fact; fail = it does not.
const easy: Array<{ id: string; reply: string; label: 'pass' | 'fail' }> = [
  { id: 'a', reply: 'Good news: 3 Orchard Way can get our 300 Mbps fiber plan.', label: 'pass' },
  { id: 'b', reply: 'Fiber up to 300 megabits per second is available at your address.', label: 'pass' },
  { id: 'c', reply: 'We have 3 Orchard Way covered with fiber at 300 Mbps.', label: 'pass' },
  { id: 'd', reply: '3 Orchard Way has 300 Mbps fiber, call us to order it.', label: 'pass' },
  { id: 'e', reply: 'Your address, 3 Orchard Way, can get fiber at 300 Mbps.', label: 'pass' },
  { id: 'f', reply: '300 Mbps fiber is available at 3 Orchard Way today.', label: 'pass' },
  { id: 'g', reply: 'Fiber is not available at 3 Orchard Way; only ADSL is.', label: 'fail' },
  { id: 'h', reply: '3 Orchard Way is served by fiber up to 100 Mbps.', label: 'fail' },
  { id: 'i', reply: "I can't see your address, so I can't say what is available.", label: 'fail' },
  { id: 'j', reply: 'We cover 30 Orchard Way with 300 Mbps fiber.', label: 'fail' },
  { id: 'k', reply: 'Fiber at 300 Mbps is coming to 3 Orchard Way next year.', label: 'fail' },
];

// Harder replies: a condition, a negation, a double negation, a different speed, an uncertain answer.
const hard: Array<{ id: string; reply: string; label: 'pass' | 'fail' }> = [
  {
    id: 'h1',
    reply: 'At 3 Orchard Way you can order fiber; the 300 Mbps plan is the one we offer there.',
    label: 'pass',
  },
  {
    id: 'h2',
    reply: 'Our 300 Mbps fiber, which needs a two-year contract, is available at 3 Orchard Way.',
    label: 'pass',
  },
  { id: 'h3', reply: 'The 300 Mbps fiber plan reached 3 Orchard Way last month.', label: 'pass' },
  { id: 'h4', reply: 'I checked: 300 Mbps fiber at 3 Orchard Way is available.', label: 'pass' },
  { id: 'h5', reply: 'It is false that 300 Mbps fiber is unavailable at 3 Orchard Way.', label: 'pass' },
  {
    id: 'h6',
    reply:
      'Fiber is available at 3 Orchard Way, but the top speed there is 100 Mbps; 300 needs a line survey.',
    label: 'fail',
  },
  {
    id: 'h7',
    reply: '300 Mbps is not offered at 3 Orchard Way, but it is offered at 30 Orchard Way.',
    label: 'fail',
  },
  { id: 'h8', reply: 'Unfortunately 300 Mbps fiber cannot be installed at 3 Orchard Way.', label: 'fail' },
  { id: 'h9', reply: '3 Orchard Way gets 3 Gbps fiber, far above the 300 Mbps plan.', label: 'fail' },
  { id: 'h10', reply: 'The 300 Mbps plan is sold out at 3 Orchard Way.', label: 'fail' },
  {
    id: 'h11',
    reply: 'Not sure whether 3 Orchard Way is covered, but it may have 300 Mbps fiber.',
    label: 'fail',
  },
];

// Multi-part set: the criterion needs two facts, and each reply is labelled by construction.
const multiItems: Array<{ id: string; reply: string; label: 'pass' | 'fail' }> = [
  {
    id: 'm1',
    reply: 'Fiber at 300 Mbps is available at 3 Orchard Way, and the installation fee is 0 USD.',
    label: 'pass',
  },
  {
    id: 'm2',
    reply: 'Good news: 3 Orchard Way has our 300 Mbps fiber, installed free of charge.',
    label: 'pass',
  },
  { id: 'm3', reply: '300 Mbps fiber reaches 3 Orchard Way. Installation costs nothing.', label: 'pass' },
  {
    id: 'm4',
    reply: 'Fiber at 300 Mbps is available at 3 Orchard Way. The installation fee is 50 USD.',
    label: 'fail',
  },
  {
    id: 'm5',
    reply: 'Fiber at 300 Mbps is available at 3 Orchard Way. Installation is quoted at your visit.',
    label: 'fail',
  },
  { id: 'm6', reply: 'The installation fee is 0 USD. Fiber is not offered at 3 Orchard Way.', label: 'fail' },
  {
    id: 'm7',
    reply:
      'Fiber at 300 Mbps is at 3 Orchard Way, installation 0 USD. Correction: the 300 Mbps plan is not available there.',
    label: 'fail',
  },
  {
    id: 'm8',
    reply: 'Installation is free at 3 Orchard Way, and 300 Mbps fiber is available there.',
    label: 'pass',
  },
  {
    id: 'm9',
    reply:
      'Fiber at 300 Mbps is at 3 Orchard Way. The installation fee is 0 USD; a 50 USD fee applies on Sundays.',
    label: 'fail',
  },
  {
    id: 'm10',
    reply: 'At 3 Orchard Way, 300 Mbps fiber is on offer with zero installation cost.',
    label: 'pass',
  },
];
const multiCriterion = {
  name: 'expert_fact_multi',
  rubric:
    'Does the reply state both that fiber at 300 Mbps is available at 3 Orchard Way and that the installation fee is 0 USD? Answer fail when either part is missing, wrong, or contradicted later in the reply.',
  pass: 'the reply states both facts, with no contrary statement',
  fail: 'the reply misses either fact, states a different fee or availability, or contradicts itself',
};
const SET = process.env.FACT_SET === 'hard' ? hard : process.env.FACT_SET === 'multi' ? multiItems : easy;
const items = SET;
const CRITERION =
  process.env.FACT_SET === 'multi'
    ? multiCriterion
    : {
        name: 'expert_fact',
        rubric: `Does the reply state that fiber at 300 Mbps is available at 3 Orchard Way? Answer pass when it does, in any wording.`,
        pass: 'the reply says fiber at 300 Mbps is available at 3 Orchard Way now',
        fail: 'the reply says the service is not available, gives another speed or another address, or gives no answer',
      };

function theirPrompt(reply: string): { system: string; user: string } {
  // The competitor's default QA template and instructions, copied as text (the owner allows pasting).
  const template = `
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
  const instructions = `
After assessing the submitted answer, reply with 'GRADE: $LETTER' (without quotes) where LETTER is one of CI.  Please choose ONE option for the grade: either "C" for correct answers, or "I" for incorrect answers.

For example, after reviewing a correct answer you might write 'GRADE: C' or after reviewing an incorrect answer you might write 'GRADE: I'.

First, write out in a step by step manner your reasoning about the criterion to be sure that your conclusion is correct. Avoid simply stating the correct answers at the outset. Then, end with your answer formatted as 'GRADE: $LETTER' (without quotes) where LETTER is one of CI.
`;
  const user = template
    .replace('{question}', CRITERION.rubric)
    .replace('{answer}', reply)
    .replace('{criterion}', `FAIL looks like: ${CRITERION.fail}\nPASS looks like: ${CRITERION.pass}`)
    .replace('{instructions}', instructions.trim());
  return { system: 'You are a grader.', user };
}

function request(reply: string): JudgeRequest {
  return {
    criterion: { name: CRITERION.name, rubric: CRITERION.rubric, pass: CRITERION.pass, fail: CRITERION.fail },
    transcript: [{ role: 'agent', text: reply }],
  };
}

function run(args: string[], stdin: string, cwd: string): Promise<{ stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', () => resolve({ stdout }));
    child.stdin.end(stdin);
  });
}

async function judge(reply: string, folder: string) {
  const prompt = variant === 'ours' ? buildPrompt(request(reply)) : theirPrompt(reply);
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    'haiku',
    '--system-prompt',
    prompt.system,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--max-budget-usd',
    '0.02',
  ];
  const ran = await run(args, prompt.user, folder);
  let text = '';
  let cost = 0;
  let isError = true;
  try {
    const parsed = JSON.parse(ran.stdout);
    text = String(parsed.result ?? '');
    cost = Number(parsed.total_cost_usd ?? 0);
    isError = Boolean(parsed.is_error);
  } catch {
    isError = true;
  }
  let outcome: 'pass' | 'fail' | 'inconclusive' = 'inconclusive';
  if (!isError) {
    if (variant === 'ours') outcome = parseAnswerText(text).answer.outcome;
    else {
      const grades = [...text.matchAll(/GRADE\s*:\s*([CI])/g)];
      const last = grades[grades.length - 1]?.[1];
      outcome = last === 'C' ? 'pass' : last === 'I' ? 'fail' : 'inconclusive';
    }
  }
  return { outcome, cost };
}

async function main() {
  const folder = await mkdtemp(join(tmpdir(), 'fact-probe-'));
  const rows: Array<{ id: string; label: string; rep: number; outcome: string; cost: number }> = [];
  for (const item of items) {
    for (let rep = 0; rep < REPEATS; rep += 1) {
      const out = await judge(item.reply, folder);
      rows.push({ id: item.id, label: item.label, rep, ...out });
    }
  }
  const scored = rows.filter((r) => r.outcome !== 'inconclusive');
  const right = scored.filter((r) => r.outcome === r.label).length;
  const wrong = scored.length - right;
  const inconclusive = rows.length - scored.length;
  const costUsd = rows.reduce((a, r) => a + r.cost, 0);
  await mkdir(join(OUT, '..'), { recursive: true }).catch(() => undefined);
  await writeFile(
    OUT,
    JSON.stringify({ variant, calls: rows.length, right, wrong, inconclusive, costUsd, rows }, null, 2),
  );
  console.log(
    JSON.stringify({
      variant,
      calls: rows.length,
      right,
      wrong,
      inconclusive,
      costUsd: Number(costUsd.toFixed(4)),
    }),
  );
}
main();
