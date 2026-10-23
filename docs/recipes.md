# How to use it

Three short recipes. Each continues the `my-evals` folder of the quickstart.

## Evaluate your own agent

From the command line, any program that reads a message and prints a reply is an agent: pass it with `--process-command`, as in the quickstart. A Python script works the same way: `--process-command "[\"python3\",\"$PWD/agent.py\"]"`.

From code, wrap your agent in an adapter. Save this as `run.mjs` and run `node run.mjs`:

```js
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import { blockStatus, loadSpecFile, runOutcome, runSpec } from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

// Your agent: any async function from the conversation so far to a reply.
async function myAgent(messages) {
  const last = messages.at(-1).content;
  const order = last.match(/A-\d+/)?.[0];
  return order
    ? `Refund started for order ${order}. You will get an email within 2 days.`
    : 'I can help with a refund. What is your order number?';
}

// The adapter: wrap the reply in the shape driftbench observes.
const adapter = functionAdapter({
  respond: async (messages) => {
    const started = Date.now();
    const text = await myAgent(messages);
    return {
      segments: [{ type: 'text', text }],
      text,
      toolCalls: [],
      cost: { usd: 0 },
      latencyMs: Date.now() - started,
    };
  },
});

const loaded = await loadSpecFile('specs/refund.yaml');
if (!loaded.ok) throw new Error('the spec is invalid');

const run = await runSpec(loaded.spec, {
  adapter,
  driver: createScriptedDriver(),
  checks: defaultChecks(),
  mode: 'F',
  repeat: 0,
});
for (const block of run.blocks) console.log(`block ${block.index}: ${blockStatus(block)}`);
process.exit(runOutcome(run) === 'pass' ? 0 : 1);
```

```
block 0: pass
block 1: pass
```

Report the tool calls your agent made in `toolCalls` and the `tools` check reads them. Using an agent SDK? There is [an adapter for it](extending.md#adapters). Prefer your test runner? [`describeSpec`](vitest.md) gives one vitest test per block, and a [pytest plugin](python.md) one test per spec.

## Add a judge

Some rules cannot be checked by a pattern. Write the rule as a criterion, with one transcript that passes and one that fails. Save this as `criteria/asks_before_acting.yaml`:

```yaml
criterion:
  name: asks_before_acting
  rubric: >
    The agent starts a refund only after the customer has given an order number.
    A refund started with no order number in the conversation fails.
  pass: The refund starts in a turn after the customer gave an order number.
  fail: The refund starts before any order number appears.
  gating: true
  scope: conversation
  judge_class: system2
fixtures:
  pass:
    note: The agent asks first, then acts on the number it was given.
    transcript:
      - { role: user, text: "I would like a refund." }
      - { role: agent, text: "What is your order number?" }
      - { role: user, text: "A-1042" }
      - { role: agent, text: "Refund started for order A-1042." }
  fail:
    note: The agent starts a refund with no order number.
    transcript:
      - { role: user, text: "I would like a refund." }
      - { role: agent, text: "Refund started. You will get an email within 2 days." }
```

```bash
npx driftbench judge check criteria
```

```
ok  asks_before_acting [system2, gating]: pass fixture 4 line(s), fail fixture 2 line(s)

1 valid criteria, 0 issue(s).
```

A judge owns a criterion only after it tells the two transcripts apart 3 times out of 3 and agrees with your hand labels: `driftbench judge calibrate` measures that and writes which judge owns what. In a run, the judges come in through code, `defaultChecks({ judges: council })`, with a judge client for OpenAI, Anthropic, Google or any HTTP endpoint. `campaign run` on the command line applies the machine checks only; loading judges from the command line is not built yet. See [judges](concepts/judges.md#the-judge-check-in-a-run).

To see a panel of judges at work with no key and no model call, clone the repository and replay recorded answers on the 12 Acme criteria:

```bash
pnpm driftbench judge run --criteria examples/acme/criteria --cassette examples/acme/criteria/council.cassette.json
```

```
separated  explicit_confirmation [system1, gating]: pass fixture pass, fail fixture fail
separated  holds_instructions [system1, gating]: pass fixture pass, fail fixture fail (split, re-judged)
separated  no_invented_data [system2, gating]: pass fixture pass, fail fixture fail

12 of 12 criteria separated in mode hybrid.
```

## Gate a pull request

Run the suite on the main branch and keep it as the baseline. Run it again on the pull request. `compare` pairs the two, conversation by conversation, and its exit code is the gate: 0 for parity, 1 for a regression or for a suite too small to tell.

```bash
AGENT="[\"node\",\"$PWD/agent.mjs\"]"
npx driftbench campaign run specs --target process:my-agent --process-command "$AGENT" \
  --repeats 3 --store runs.db --campaign baseline
# ...change the agent, then:
npx driftbench campaign run specs --target process:my-agent --process-command "$AGENT" \
  --repeats 3 --store runs.db --campaign candidate
npx driftbench compare --store runs.db --baseline baseline --candidate candidate
```

With the broken agent of quickstart step 5 as the candidate:

```
Warning: this suite cannot show parity under 15 points (the all-pass flag needs 79.3 points); about 22 goldens would.
  side       passing  rate    95% interval
  baseline   1 of 1   100.0%  [20.7%, 100.0%]
  candidate  0 of 1   0.0%    [0.0%, 79.3%]
Verdict: NOT SHOWN NON-INFERIOR.
```

A golden is one reference conversation. With one golden, driftbench will not call it parity and will not call it a proven regression either: it says the suite needs about 22. That is the point of the gate.

On the bundled Acme example, with ten goldens and a planted fault that skips the order recap, `driftbench ci` does the run and the comparison in one step:

```
  goldens paired                               10
  regressed                                    5
  all-pass regression effect                   +50.00 points
  95% interval                                 [+11.74, +76.34] points
  margin                                       28 points (auto)
Verdict: REGRESSION. Exit 1.
```

The same command on the unchanged agent prints `Verdict: PARITY. Exit 0.` A [GitHub Action](../action/action.yml) wraps `driftbench ci`; a workflow that uses it is in [examples/acme/ci](../examples/acme/ci/driftbench-ci.yml). Today `driftbench ci` and the Action reach the bundled example targets only. For your own agent, use the two runs and `compare` above.
