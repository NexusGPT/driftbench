# The adapter contract suite on your own adapter

`@agent-nexus/driftbench-adapters/contract` is the suite every built-in adapter passes. This example runs it on a hand-written adapter.

| File | Holds |
|---|---|
| `src/queue-adapter.ts` | a team's own adapter, written against `AgentAdapter`: the agent sits behind a service the adapter calls once per block |
| `test/contract.test.ts` | the proof: `adapterContract('queue', ...)` with the suite's reference agent behind the service |

From the repository root:

```sh
pnpm vitest run examples/adapter-contract
```

```text
Tests  19 passed | 4 skipped (23)
```

The 4 skipped tests are capabilities the adapter does not declare (`endState`, `trace`) and the task mode. Break the adapter, for example return `session.history` itself from `open` in place of a copy of the prefix, and the suite says which rule it broke.

The full page: [adapters, the contract suite](../../docs/adapters/index.md#the-contract-suite).
