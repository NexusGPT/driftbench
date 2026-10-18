# @agent-nexus/driftbench

The `driftbench` command line: validate and run specs, campaigns in teacher-forced, free-running and perturbed modes, reports, generation and validators.

Part of [driftbench](https://github.com/achammah/driftbench), block-level evaluation for AI agents: every exchange is a unit test with a Given, a When and a Then.

## Install

```sh
npm install --save-dev @agent-nexus/driftbench
npx driftbench --help
```

Node.js 22.13 or newer (the result store uses `node:sqlite`).

## First commands

```sh
driftbench spec validate specs/        # parse and validate every spec; exit 1 on an invalid one
driftbench campaign run specs/ --target function:my-agent --mode T,F --repeats 3
driftbench report                      # the scorecard of the latest campaign, as HTML and JUnit XML
driftbench ci --specs specs/ --target function:my-agent --baseline <store>  # exit 0 on parity
```

`driftbench --help` lists every command; each one takes `--help`.

## Documentation

[CLI reference](https://github.com/achammah/driftbench/blob/main/docs/reference/cli.md), [Running](https://github.com/achammah/driftbench/blob/main/docs/running.md), and the [docs index](https://github.com/achammah/driftbench/blob/main/docs/index.md).

## License

MIT
