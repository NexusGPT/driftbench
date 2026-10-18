# @agent-nexus/driftbench-core

The driftbench core: the spec schema, blocks with Given, When and Then, the runner, the adapter contract and coverage.

Part of [driftbench](https://github.com/achammah/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-core
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `runSpec`
* `parseSpecText`
* `findSpecFiles`
* `computeCoverage`
* `importTable`
* `compareEndState`

`checkSpec(raw, path?)` normalizes and checks an already parsed value, including schema validation,
semantic checks and lint warnings. Its `SpecValidationResult` omits the content hash. Use
`validateSpec(raw, path?)` when the result also needs that hash.

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Spec reference](https://github.com/achammah/driftbench/blob/main/docs/reference/spec.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

MIT
