# @agent-nexus/driftbench-generate

Generate driftbench tests from a map of situations: extraction proposal, the deterministic block generator, the validity gate, reference sets and holdout.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-generate
```

Node.js 22.13 or newer. ESM only, with TypeScript types.

## What is inside

* `buildInstances`
* `allocate`
* `analysePilot`
* `checkSpaceMap`
* `FakeModelPort`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Generating tests](https://github.com/NexusGPT/driftbench/blob/main/docs/generating.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT
