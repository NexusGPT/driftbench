# Script

A script writes one conversation spec in code. Each step is a function call, and the result is the same spec the command line reads from a YAML file. The script API lives in `@agent-nexus/driftbench-core` as `script`, with the steps `user`, `agent`, `judge` and `injection`.

## The steps

| Step | What it adds |
|---|---|
| `user(text, expect)` | A block whose stimulus is the user's message, with its expectations. |
| `injection(class, text, expect)` | A block whose stimulus is a deviation of that class. See [recovery](recovery.md). |
| `agent(expect)` | Expectations on the reply to the last block. Needs a block before it. |
| `judge(criteria)` | Judged criteria, by name, on the last block. Needs criteria. |
| `proceed(n, { hint, expect })` | `n` blocks reserved for the simulated user, each with the hint as its stimulus. |

`proceed(n, { hint, expect })` reserves `n` user turns for the simulated user. The spec gets one block per turn, whose stimulus is the hint, and the block positions are listed in the metadata under `simulated_blocks`. The simulated driver plays those turns at run time, from the hint. `succeed(reason?)` and `fail(reason?)` end the script with a verdict. The run stops after the blocks before them, and the spec records the verdict in its `end` field. The scripted driver returns it with the stop, and the run result carries it as `endVerdict`. A failure verdict makes the run not passed in the report. They can stand at any step: the run stops after the block before them, and the turns after them are kept as blocks the verdict skips. The report lists the skipped blocks under the run, as skipped by the verdict, and they neither pass nor fail. An `agent()` or `judge()` after the verdict is refused, because it would check a block that never runs, and a script has one verdict.

## An example

```ts
import { script } from '@agent-nexus/driftbench-core';

const { agent, conversation, injection, judge, toYaml, user } = script;

const result = conversation(
  'refund-basic',
  [
    user('I want a refund for order 1234.', { must: ['refund'] }),
    agent({ must_not: ['refunded already'] }),
    judge(['refund.issued@gating']),
    injection('D1_off_topic', 'is the shop open on Saturday?', { must_not: ['refund issued'] }),
  ],
  {
    title: 'Refund for one order',
    channel: 'chat',
    lang: 'EN',
    criteria: [{ name: 'refund.issued', rubric: 'The agent issues the refund only after it confirms the order.' }],
  },
);

result.load.ok; // true: the loader accepts the spec
console.log(toYaml(result.spec));
```

The compiled spec, as the command line reads it:

```yaml
id: refund-basic
kind: conversation
title: Refund for one order
channel: chat
lang: EN
criteria:
  - name: refund.issued
    rubric: The agent issues the refund only after it confirms the order.
blocks:
  - id: b1
    when:
      user: I want a refund for order 1234.
    expect:
      must:
        - refund
      must_not:
        - refunded already
      criteria:
        - refund.issued@gating
  - id: b2
    when:
      injection:
        class: D1_off_topic
        user: is the shop open on Saturday?
    expect:
      must_not:
        - refund issued
```

## Rules the compiler applies

- Blocks are numbered `b1`, `b2` and so on, in script order.
- A list expectation given twice in one block concatenates, so `must` in `user()` and `must` in `agent()` both hold.
- A scalar expectation, such as `lang`, given twice in one block throws, because one value would silently win.
- `judge([])` throws, and so does an `agent()` or `judge()` with no block before it.
- A spec the loader rejects comes back with `load.ok` set to false and its issues in `load.errors`. Nothing is thrown for a bad value.

The compiled object is the spec. `toYaml` writes it, and the loader reads it back unchanged.

A script writes a conversation spec. A task spec for a code agent has no script form yet, so write it as YAML.
