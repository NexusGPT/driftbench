import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createClaudeCliJudge,
  createCouncil,
  emptyCassette,
  JudgeError,
  type JudgeRequest,
  playerClient,
  recordingClient,
  LEGACY_SYSTEM_PROMPT as SYSTEM_PROMPT,
} from '../src/index';

/**
 * The claude command judge, on a fake command: a Node script that reads stdin, records its arguments and
 * working folder, and prints what its mode says. No model is called.
 */

const REQUEST: JudgeRequest = {
  answerContract: 'legacy',
  criterion: {
    name: 'one_question_per_turn',
    rubric: 'The reply asks the customer at most one question.',
    pass: 'One question, or none.',
    fail: 'Two or more questions in the same reply.',
  },
  transcript: [
    { role: 'user', text: 'What faster plans do you have?' },
    { role: 'agent', text: 'Which address is it for? And do you want fiber?' },
  ],
};

const FAKE = `
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), input }));
  const mode = process.env.FAKE_MODE;
  const result = (text, extra = {}) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0.0021, num_turns: 1, ...extra }));
  if (mode === 'pass') result('{"outcome":"fail","score":0.1,"reasoning":"two questions"}');
  else if (mode === 'fenced') result('Here it is:\\n\`\`\`json\\n{"outcome":"pass","reasoning":"one question"}\\n\`\`\`');
  else if (mode === 'prose') result('I think the reply is fine.');
  else if (mode === 'max-turns') result('', { subtype: 'error_max_turns', result: undefined });
  else if (mode === 'api-error') result('API Error: 529 overloaded', { is_error: true });
  else if (mode === 'crash') { process.stderr.write('boom: not logged in'); process.exit(3); }
  else if (mode === 'garbage') process.stdout.write('not json');
  else if (mode === 'hang') setTimeout(() => {}, 60000);
});
`;

let dir: string;
let script: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-cli-judge-'));
  script = join(dir, 'fake-claude.cjs');
  await writeFile(script, FAKE);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function judge(mode: string, extra: Record<string, unknown> = {}) {
  const log = join(dir, `${mode}.json`);
  const client = createClaudeCliJudge({
    model: 'haiku',
    command: process.execPath,
    commandArgs: [script],
    env: { ...process.env, FAKE_MODE: mode, FAKE_LOG: log },
    ...extra,
  });
  return { client, log: async () => JSON.parse(await readFile(log, 'utf8')) };
}

describe('the claude command judge', () => {
  it('sends the judge prompt with no tools, no settings and no session, and reads the verdict and its cost', async () => {
    const { client, log } = judge('pass');
    expect(client).toMatchObject({ id: 'claude-haiku', family: 'anthropic', cls: 'system2', model: 'haiku' });
    const result = await client.judge(REQUEST);
    expect(result.answer).toEqual({ outcome: 'fail', score: 0.1, reasoning: 'two questions' });
    expect(result.costUsd).toBe(0.0021);
    expect(result.unparsed).toBeUndefined();
    const call = await log();
    const flag = (name: string) => call.argv[call.argv.indexOf(name) + 1];
    expect(call.argv.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(flag('--model')).toBe('haiku');
    expect(flag('--system-prompt')).toBe(SYSTEM_PROMPT);
    expect(flag('--tools')).toBe('');
    expect(flag('--setting-sources')).toBe('');
    expect(flag('--max-turns')).toBe('1');
    expect(call.argv).toContain('--no-session-persistence');
    expect(call.argv).toContain('--strict-mcp-config');
    // The data travels on stdin, inside its data tag, never as an argument.
    expect(call.input).toContain('<transcript_data>');
    expect(call.input).toContain('And do you want fiber?');
    expect(call.argv.join(' ')).not.toContain('And do you want fiber?');
    // An empty folder of its own: no project file or memory of the caller reaches the judge.
    expect(call.cwd).not.toBe(process.cwd());
  });

  it('passes a budget cap per call when one is set', async () => {
    const { client, log } = judge('pass', { maxBudgetUsd: 0.05 });
    await client.judge(REQUEST);
    const call = await log();
    expect(call.argv[call.argv.indexOf('--max-budget-usd') + 1]).toBe('0.05');
  });

  it('reads an answer in a fenced block, and keeps prose as an unparsed answer with its cost', async () => {
    expect((await judge('fenced').client.judge(REQUEST)).answer.outcome).toBe('pass');
    const prose = await judge('prose').client.judge(REQUEST);
    expect(prose).toMatchObject({ unparsed: true, costUsd: 0.0021, answer: { outcome: 'inconclusive' } });
  });

  it('reads a run that stopped at its turn limit as unparsed, never a pass', async () => {
    const result = await judge('max-turns').client.judge(REQUEST);
    expect(result).toMatchObject({ unparsed: true, answer: { outcome: 'inconclusive' } });
    expect(result.answer.reasoning).toContain('error_max_turns');
  });

  it('throws a retryable error on an API error result, so the vote is no answer, not a verdict', async () => {
    const error = await judge('api-error')
      .client.judge(REQUEST)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JudgeError);
    expect(error).toMatchObject({ code: 'http', retryable: true });
    expect((error as Error).message).toContain('529 overloaded');
  });

  it('throws when the command fails or prints something that is not its JSON result', async () => {
    await expect(judge('crash').client.judge(REQUEST)).rejects.toThrow(/exited 3: boom: not logged in/);
    await expect(judge('garbage').client.judge(REQUEST)).rejects.toThrow(/not a JSON result/);
  });

  it('stops a call that runs past its timeout', async () => {
    await expect(judge('hang', { timeoutMs: 300 }).client.judge(REQUEST)).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('needs a model', () => {
    expect(() => createClaudeCliJudge({ env: {} })).toThrow(/CLAUDE_JUDGE_MODEL is not set/);
    expect(createClaudeCliJudge({ env: { CLAUDE_JUDGE_MODEL: 'sonnet' } }).model).toBe('sonnet');
  });

  it('plugs into the council, which refuses it for an agent of its own family', () => {
    const judges = ['a', 'b', 'c'].map((id) => judge('pass', { id }).client);
    expect(createCouncil({ mode: 'llm', judges, agentFamily: 'none' }).mode).toBe('llm');
    expect(() => createCouncil({ mode: 'llm', judges, agentFamily: 'anthropic' })).toThrow(
      /anthropic family/,
    );
  });

  it('records its cost on a cassette, and the replay gives it back', async () => {
    const cassette = emptyCassette();
    const recorded = await recordingClient(judge('pass').client, cassette).judge(REQUEST);
    expect(cassette.entries[0]?.cost_usd).toBe(0.0021);
    const replayed = await playerClient(cassette, 'claude-haiku').judge(REQUEST);
    expect(replayed).toEqual(recorded);
  });
});

describe('the claude command judge cost', () => {
  it('ranks the models by list price, so the cascade and calibration try haiku first', () => {
    const cost = (model: string) => createClaudeCliJudge({ model, env: {} }).cost;
    expect([cost('haiku'), cost('sonnet'), cost('opus')]).toEqual([10, 30, 50]);
    expect(cost('claude-sonnet-5-5')).toBe(30);
    expect(cost('some-other-model')).toBe(10);
    expect(createClaudeCliJudge({ model: 'opus', env: {}, cost: 7 }).cost).toBe(7);
  });
});
