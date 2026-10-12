# Script

A script writes one conversation spec in code. Each step is a function call, and the result is the same spec the command line reads from a YAML file. The script API lives in `@driftbench/core` as `script`, with the steps `user`, `agent`, `judge` and `injection`.

## The steps

| Step | What it adds |
|---|---|
| `user(text, expect)` | A block whose stimulus is the user's message, with its expectations. |
| `injection(class, text, expect)` | A block whose stimulus is a deviation of that class. See [recovery](recovery.md). |
| `agent(expect)` | Expectations on the reply to the last block. Needs a block before it. |
| `judge(criteria)` | Judged criteria, by name, on the last block. Needs criteria. |

Two steps throw, because the spec has no form for them. `proceed()` needs the simulated user, which no command runs yet, so write the user turns out. `succeed()` and `fail()` end a run early, and the spec has no early-stop step, so end the script instead.

## An example

```ts
import { script } from '@driftbench/core';

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
