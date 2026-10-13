import { createClaudeCliJudge } from '../../packages/judges/src/clients/claude-cli';
import {
  createAnthropicJudge,
  createGoogleJudge,
  createJevJudge,
  createOpenAiDecisionsJudge,
  createOpenAiJudge,
  type JudgeClient,
  type JudgeRequest,
} from '../../packages/judges/src/index';

/** One cheap live call per judge client. Prints outcome, latency and a short raw head; never a key. */
const REQUEST: JudgeRequest = {
  criterion: {
    name: 'greets_customer',
    rubric: 'The agent greets the customer before answering.',
    pass: 'The reply opens with a greeting.',
    fail: 'The reply has no greeting.',
  },
  transcript: [
    { role: 'user', text: 'What time does the Acme store open?' },
    { role: 'agent', text: 'Hello! The Acme store opens at 9.' },
  ],
};

const which = process.argv[2] ?? '';
const makers: Record<string, () => JudgeClient> = {
  jev: () => createJevJudge(),
  decisions: () => createOpenAiDecisionsJudge(),
  openai: () => createOpenAiJudge(),
  google: () => createGoogleJudge(),
  anthropic: () => createAnthropicJudge(),
  claude: () => createClaudeCliJudge({ model: 'haiku' } as never),
};
const scrub = (s: string) => s.replace(/sk-[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]+/g, '[redacted]');
for (const name of which.split(',')) {
  const started = Date.now();
  try {
    const judge = makers[name]!();
    const result = await judge.judge(REQUEST);
    console.log(
      JSON.stringify({
        client: name,
        works: !result.unparsed,
        ms: Date.now() - started,
        outcome: result.answer.outcome,
        score: result.answer.score,
        costUsd: result.costUsd,
        raw: scrub(String(result.raw ?? '')).slice(0, 400),
      }),
    );
  } catch (cause) {
    console.log(
      JSON.stringify({
        client: name,
        works: false,
        ms: Date.now() - started,
        error: scrub(String(cause)).slice(0, 500),
      }),
    );
  }
}
