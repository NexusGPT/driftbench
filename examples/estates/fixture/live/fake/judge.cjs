#!/usr/bin/env node
// @driftbench-stand-in: a fake judge on the claude command. No model call, no cost of its own.
/**
 * A FAKE `claude -p --output-format json` for the judge of a run (`--judge claude:<model> --judge-command
 * <this file>`). It reads the judge prompt on its input and prints one JSON result, as the command does:
 * fail when the prompt holds the words of FAKE_JUDGE_FAIL (default "public holiday"), pass otherwise, and a
 * reported cost of FAKE_JUDGE_COST US dollars per call (default 0.0015). Fictional data only.
 */
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const words = process.env.FAKE_JUDGE_FAIL ?? 'public holiday';
  const fail = words !== '' && input.includes(words);
  const answer = {
    outcome: fail ? 'fail' : 'pass',
    reasoning: fail ? `The reply does not keep to the rule about ${words}.` : 'The reply keeps to the rule.',
  };
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: JSON.stringify(answer),
      total_cost_usd: Number(process.env.FAKE_JUDGE_COST ?? '0.0015'),
    }),
  );
});
