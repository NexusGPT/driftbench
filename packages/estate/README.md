# @agent-nexus/driftbench-estate

Test a code-interpreter agent as a whole estate: atoms, the estate graph, lint, plans, mutants and maintenance.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-estate
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `buildGraph`
* `analyzeGraph`
* `buildPlan`
* `codeAtoms`
* `copyEstate`
* `compareReplays`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Testing an estate](https://github.com/NexusGPT/driftbench/blob/main/docs/estate.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT
