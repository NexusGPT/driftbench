# function adapter

Status: planned, phase 1.

The function adapter runs an agent that is an async function in the same process as driftbench. There is no network call and no API key. It suits tests of an agent's logic, and it drives the synthetic example agent.

## Contract as designed

* `open` hands the function the resolved Given of the block: prefix, ledger, world and vars.
* `send` passes the stimulus to the function and takes back what the agent did, in order: text, tool calls with their inputs and outputs, cards. The adapter turns it into the observed record of the block (`Observed` in `packages/core/src/schema/run.ts`).
* It passes the same contract tests as every adapter. See [adapters](index.md).

The exact signature of the function is fixed when the adapter ships.

## Target

```yaml
target:
  adapter: function
  agent: acme-sales
```
