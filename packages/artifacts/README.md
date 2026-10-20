# @agent-nexus/driftbench-artifacts

Readers for the files a code agent produces (xlsx, docx, pptx, pdf, csv, json, text, code), answering artifact checks with evidence.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-artifacts
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `defaultReaders`
* `createRegistry`
* `kindForPath`
* `readTables`
* `parseCsv`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Checks reference](https://github.com/NexusGPT/driftbench/blob/main/docs/reference/checks.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT
