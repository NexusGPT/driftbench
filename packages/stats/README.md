# @agent-nexus/driftbench-stats

Statistics for agent evaluation: intervals, reliability, paired tests, multiple comparisons, power, non-inferiority, drift, agreement and variance components.

Part of [driftbench](https://github.com/achammah/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install @agent-nexus/driftbench-stats
```

Node.js 22 or newer. ESM only, with TypeScript types.

## What is inside

* `clopperPearson`
* `bootstrapCI`
* `mcnemar`
* `nonInferiority`
* `benjaminiHochberg`
* `icc`
* `krippendorffAlpha`
* `passAtK`
* `mde`

The full list of exports is in the type declarations (`dist/index.d.ts`).

## Documentation

[Statistics](https://github.com/achammah/driftbench/blob/main/docs/concepts/statistics.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

MIT
