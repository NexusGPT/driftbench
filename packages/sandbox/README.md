# @agent-nexus/driftbench-sandbox

The workspace a code agent works in for one driftbench run: a local folder or a docker container, with snapshots, diffs and bounded commands.

Part of [driftbench](https://github.com/NexusGPT/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-sandbox
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `LocalSandbox`
* `DockerSandbox`
* `localProvider`
* `dockerProvider`
* `diffSnapshots`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[The process adapter](https://github.com/NexusGPT/driftbench/blob/main/docs/adapters/process.md), and the [docs index](https://github.com/NexusGPT/driftbench/blob/main/docs/index.md).

## License

MIT
