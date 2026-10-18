# vitest

`@agent-nexus/driftbench-vitest` runs a spec inside a vitest suite, one test per block. Version 0.1.0 is on npm as `@agent-nexus/driftbench-vitest`.

```ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { describeSpec } from '@agent-nexus/driftbench-vitest';
import { createAcmeAgent } from './acme';

describeSpec('specs/plan-upgrade.yaml', functionAdapter({ respond: createAcmeAgent().respond }));
```

`describeSpec(path, target, options?)` reads the spec at `path` (from the working folder, an absolute path, or a file URL) when the test file loads, and registers a describe block named after the spec id with one test per block, then one `end state` test when the spec names an end state. `target` is an adapter, or a function that returns one when the spec first runs. The spec runs once, free-running, with the scripted driver and `defaultChecks()`, when its first test runs; each test then passes or fails on its own block. A failing block's error lists each gating verdict that did not pass, with its evidence. An invalid spec registers one failing test that lists its errors.

| Option | Meaning |
|---|---|
| `checks` | the machine checks; `defaultChecks()` of `@agent-nexus/driftbench-checks` by default |
| `driver` | the user driver; the scripted driver by default |
| `repeat` | the repeat number the run records, 0 by default |
| `timeoutMs` | the timeout of each test, 60000 by default: the first test waits for the whole run |

A test is named `block <n>`, then the block id when it has one, then its user message, cut to 60 characters. On an Acme agent that drops the first tool call of every block (the fixture `packages/vitest/test/fixtures/broken.fixture.ts`), blocks 1 and 3 fail on the tools check:

```
 ✓ packages/vitest/test/fixtures/broken.fixture.ts > acme-plan-upgrade > block 0: Hi, I'm already an Acme customer and I keep running out o... 16ms
 × packages/vitest/test/fixtures/broken.fixture.ts > acme-plan-upgrade > block 1: It's sam.rivera@example.com 1ms
   → block 1 failed
  tools.catalog.search.count fail: catalog.search called 0 times, expected exactly 1; calls in this block: none
  tools.catalog.search.input.category fail: catalog.search was not called, so input.category could not be equal to "mobile"
  tools.catalog.search.input.customer_email fail: catalog.search was not called, so input.customer_email could not be equal to "sam.rivera@example.com"
  tools.catalog.search.input.address_id fail: catalog.search was not called, so input.address_id could not be absent
 ✓ packages/vitest/test/fixtures/broken.fixture.ts > acme-plan-upgrade > block 2: The unlimited one, please. 0ms
 × packages/vitest/test/fixtures/broken.fixture.ts > acme-plan-upgrade > block 3: Confirm 0ms
   → block 3 failed
  tools.order.create.count fail: order.create called 0 times, expected exactly 1; calls in this block: none
  tools.order.create.input.type fail: order.create was not called, so input.type could not be equal to "upgrade"
  tools.order.create.input.customer_id fail: order.create was not called, so input.customer_id could not be equal to "cust-001"
  tools.order.create.input.plan_id fail: order.create was not called, so input.plan_id could not be equal to "mobile-l"
  tools.order.create.input.port_number fail: order.create was not called, so input.port_number could not be absent
 ✓ packages/vitest/test/fixtures/broken.fixture.ts > acme-plan-upgrade > block 4: No, that's all. Thanks! 0ms
 ✓ packages/vitest/test/fixtures/broken.fixture.ts > acme-plan-upgrade > end state 0ms
```

A block the runner did not send (`not_run`, such as a forced tool result on an adapter without `toolStubs`, or `blocked` behind a failed ancestor) is no pass and no failure of the agent. Its test is skipped with the reason, as the JUnit report skips it, for example `block 0 was not run (unsupported, check capability): expected ...; got ...`, and the end state test is skipped because no end state was compared.

For the [Python](python.md) side, the pytest plugin does the same per spec.
