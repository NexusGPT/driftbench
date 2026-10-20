# @agent-nexus/driftbench-vitest

Run a driftbench spec inside a vitest suite: `describeSpec(path, target)` registers one test per block, with the evidence of each failing verdict.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install --save-dev @agent-nexus/driftbench-vitest @agent-nexus/driftbench-adapters vitest
```

Node.js 22 or newer, vitest 3 or newer. ESM only, with TypeScript types.

## Use

```ts
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { describeSpec } from '@agent-nexus/driftbench-vitest';
import { respond } from './my-agent';

describeSpec('specs/plan-upgrade.yaml', functionAdapter({ respond }));
```

The spec runs once, free-running, with the scripted driver and the default machine checks, when its first test runs. Each test then passes or fails on its own block, and a failing block lists each gating verdict that did not pass, with its evidence. Options: `checks`, `driver`, `repeat`, `timeoutMs`.

## Documentation

[vitest](https://github.com/NexusGPT/driftbench/blob/main/docs/vitest.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT
