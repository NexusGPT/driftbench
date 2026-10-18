import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAnswerText } from '../../../packages/judges/src/contract';
import { fixtureRequest, loadCriteria } from '../../../packages/judges/src/criteria';
import { buildPrompt } from '../../../packages/judges/src/prompt';

const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const MODEL = 'haiku';
const MAX_USD = '0.02';
const CRITERIA = fileURLToPath(new URL('../../../examples/acme/criteria', import.meta.url));
const REPEATS = 3;
const variant = process.argv[2] ?? 'ours';
const OUT = process.argv[3] ?? join(S_DIR(), `grader-${variant}.json`);
function S_DIR() {
  return './out';
}

// The competitor's default QA template and instructions, copied verbatim (license-free use, no attribution in driftbench).
const THEIR_TEMPLATE = `
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
const THEIR_INSTRUCTIONS = `
After assessing the submitted answer, reply with 'GRADE: $LETTER' (without quotes) where LETTER is one of CI.  Please choose ONE option for the grade: either "C" for correct answers, or "I" for incorrect answers.

For example, after reviewing a correct answer you might write 'GRADE: C' or after reviewing an incorrect answer you might write 'GRADE: I'.

First, write out in a step by step manner your reasoning about the criterion to be sure that your conclusion is correct. Avoid simply stating the correct answers at the outset. Then, end with your answer formatted as 'GRADE: $LETTER' (without quotes) where LETTER is one of CI.
`;

type Req = Parameters<typeof buildPrompt>[0];
function dataText(req: Req): string {
  const lines = req.transcript.map((e) => `${e.role}${e.tool ? ` (${e.tool})` : ''}: ${e.text}`);
  if (req.artifact) lines.push(`artifact: ${req.artifact}`);
  return lines.join('\n');
}

function theirPrompt(req: Req): { system: string; user: string } {
  const pictures = `FAIL looks like: ${req.criterion.fail ?? 'any data where the answer to the question is no'}\nPASS looks like: ${req.criterion.pass ?? 'data where the answer to the question is yes'}`;
  const user = THEIR_TEMPLATE.replace('{question}', req.criterion.rubric)
    .replace('{answer}', dataText(req))
    .replace('{criterion}', pictures)
    .replace('{instructions}', THEIR_INSTRUCTIONS.trim());
  return { system: 'You are a grader.', user };
}

function run(
  args: string[],
  stdin: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

async function judge(req: Req, folder: string) {
  const prompt = variant === 'ours' ? buildPrompt(req) : theirPrompt(req);
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    MODEL,
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
    MAX_USD,
  ];
  const ran = await run(args, prompt.user, folder);
  let result = '';
  let cost = 0;
  let isError = false;
  try {
    const parsed = JSON.parse(ran.stdout);
    result = String(parsed.result ?? '');
    cost = Number(parsed.total_cost_usd ?? 0);
    isError = Boolean(parsed.is_error);
  } catch {
    isError = true;
  }
  let outcome: 'pass' | 'fail' | 'inconclusive';
  if (isError) outcome = 'inconclusive';
  else if (variant === 'ours') outcome = parseAnswerText(result).answer.outcome;
  else {
    const grades = [...result.matchAll(/GRADE\s*:\s*([CI])/g)];
    const last = grades[grades.length - 1]?.[1];
    outcome = last === 'C' ? 'pass' : last === 'I' ? 'fail' : 'inconclusive';
  }
  return { outcome, cost, result: result.slice(0, 600), isError };
}

async function main() {
  const loaded = await loadCriteria(CRITERIA);
  const folder = await mkdtemp(join(tmpdir(), 'grader-probe-'));
  const jobs: { name: string; which: 'pass' | 'fail'; rep: number; req: Req }[] = [];
  for (const crit of loaded.criteria) {
    for (const which of ['pass', 'fail'] as const) {
      for (let rep = 0; rep < REPEATS; rep += 1)
        jobs.push({ name: crit.def.name, which, rep, req: fixtureRequest(crit, which) as Req });
    }
  }
  const results: {
    name: string;
    which: string;
    rep: number;
    outcome: string;
    cost: number;
    result: string;
    isError: boolean;
  }[] = [];
  const queue = jobs.slice(0, Number(process.env.LIMIT ?? 100000));
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) return;
      const out = await judge(job.req, folder);
      results.push({ name: job.name, which: job.which, rep: job.rep, ...out });
    }
  });
  await Promise.all(workers);
  const total = results.reduce((a, r) => a + r.cost, 0);
  await writeFile(
    OUT,
    JSON.stringify({ variant, model: MODEL, calls: results.length, costUsd: total, results }, null, 2),
  );
  const scored = results.filter((r) => r.outcome !== 'inconclusive');
  const right = scored.filter((r) =>
    r.which === 'pass' ? r.outcome === 'pass' : r.outcome === 'fail',
  ).length;
  console.log(
    JSON.stringify({
      variant,
      calls: results.length,
      inconclusive: results.length - scored.length,
      accuracyOnScored: scored.length ? right / scored.length : null,
      costUsd: Number(total.toFixed(4)),
    }),
  );
}
main();
