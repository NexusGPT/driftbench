# driftbench docs

driftbench evaluates AI agents block by block. A block is one exchange with a conversational agent, or one step of a task done by a code-interpreter agent. Each block is a unit test with a Given, a When and a Then, and a spec is a succession of blocks. Both kinds of block share one model: the same runner, checks, judges and statistics.

Every page says what exists today and what is planned, with the phase that delivers it.

## Concepts

* [Block](concepts/block.md): the unit of evaluation, the four runtime concepts (tools, skills, guards, stages), one conversation spec and one task spec.
* [Given, When, Then](concepts/given-when-then.md): the initial conditions, the stimulus and the expected result of a block.
* [Run modes](concepts/run-modes.md): teacher-forced, free-running and perturbed runs of the same spec.
* [Drift](concepts/drift.md): the five drift classes, and the metrics across a succession of blocks.
* [Recovery](concepts/recovery.md): the ten deviation classes, and how fast the agent comes back.
* [Judges](concepts/judges.md): judged criteria, the judge council and calibration.
* [Statistics](concepts/statistics.md): repeats, intervals, paired tests and the parity verdict.

## Reference

* [Spec reference](reference/spec.md): every field of a spec, generated from the zod schemas.
* [CLI](reference/cli.md): the `driftbench` commands, their output and their exit codes.
* [Checks](reference/checks.md): every field of `expect`, and the check that reads it.

## Adapters

* [Adapters](adapters/index.md): the contract between driftbench and the agent under test.
* [function](adapters/function.md): an async function in the same process.
* [http](adapters/http.md): an endpoint in the OpenAI-compatible chat shape.
* [nexus](adapters/nexus.md): an agent on the Nexus platform.
* [process](adapters/process.md): a code-interpreter agent run as a command in a sandbox.

## Comparison

* [Comparison](comparison.md): driftbench beside seven evaluation tools and six code-agent benchmarks, with a source and a read date for every cell.

## What exists today

Phase 0 is in progress. These parts are built:

* The spec format: zod schemas in `packages/core/src/schema`, with the TypeScript types inferred from them.
* The loader: YAML and JSON files, authoring shorthand, schema errors with their path, semantic checks, and lint advice.
* `driftbench spec validate`, `driftbench spec lint`, and `driftbench spec coverage` with the behaviour inventory it reads. See [CLI](reference/cli.md).
* The run record schemas: the shapes the runner will write.
* A leak guard that refuses personal data in the repository, and CI.
* These docs, the generator of the spec reference, and a link checker.
* The Acme Telecom example in [`examples/acme`](../examples/acme/README.md): a deterministic agent with tools and no model, six conversation specs, one task spec and a behaviour inventory.

## Roadmap

| Phase | Delivers | Status |
|---|---|---|
| 0, foundations | spec format, loader, `spec validate`, `spec lint`, `spec coverage`, leak guard, CI, synthetic example agent, docs | in progress |
| 1, runner | runner in free-running mode with a scripted user; machine checks for text, language, personal data, tools, skills, guards, cards, end state, budget, execution, artifacts, workspace and safety; store, cache and resume; cost and latency per segment; sandbox workspace; artifact readers; function, http, nexus and process adapters | planned |
| 2, judges | judge clients, the council and its cascade, calibration on fixture pairs and hand labels, judges for task artifacts | planned |
| 3, perturbation, drift and recovery | simulated user, perturbing driver with the ten deviation classes, stage classifier and ledger check, drift classes, recovery metrics, teacher-forced mode; the same deviations on code-agent tasks | planned |
| 4, statistics and gates | statistics functions with reference fixtures, the parity verdict, scorecard, run diff, JUnit output, CI gate, runtime battery | planned |
| Release | SDK agent adapters, docs site, version 0.1.0 on npm | planned |

There is no separate phase for code agents. A task spec runs through each phase with the conversation specs.

## Working on the docs

* `pnpm docs:reference` writes [the spec reference](reference/spec.md) from the zod schemas. `pnpm docs:reference --check` exits 1 when the committed page is stale.
* `pnpm exec tsx tools/docs/check-links.ts` checks that every relative link in `docs/` resolves and that every page is reachable from this one.
* `pnpm test` runs the tests of both tools, and checks the pages: every YAML example loads, no page has an em dash or an en dash, every issue and warning code is on the CLI page, names that belong to one runtime appear only under `docs/adapters`, and every comparison cell has a source and a read date.
* Pages use present tense and short sentences. A claim about a part that is not built says "planned, phase N". A number has a source, or it is left out.
