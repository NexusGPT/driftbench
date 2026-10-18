# @agent-nexus/driftbench-checks

Machine checks for driftbench blocks: tool calls, text, language, personal data, stage, skills, guards, workspace, artifacts, schemas and budget, each verdict with evidence.

Part of [driftbench](https://github.com/achammah/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-checks
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `defaultChecks`
* `CheckRegistry`
* `registerCheck`
* `createCustomCheck`
* `createLangCheck`
* `createSimilarityCheck`
* `statedLength` (opt-in) and `preferByStatedLength`
* `scanPii`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Checks reference](https://github.com/achammah/driftbench/blob/main/docs/reference/checks.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

MIT
