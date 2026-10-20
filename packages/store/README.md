# @agent-nexus/driftbench-store

The driftbench result store: specs, campaigns, runs, the response cache and cost units in one SQLite file through node:sqlite.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-store
```

Node.js 22.13 or newer. ESM only, with TypeScript types.

## What is inside

* `openStore`
* `openMemoryStore`
* `readCampaignBundle`
* `projectCost`
* `measuredUnits`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Running](https://github.com/NexusGPT/driftbench/blob/main/docs/running.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT
