# driftbench for Python

Runs driftbench specs from Python through the driftbench CLI, gives the results as typed dataclasses, and
adds a pytest plugin. No runtime dependency beyond the standard library. See
[the Python page](https://github.com/achammah/driftbench/blob/main/docs/python.md).

## Install

```sh
pip install ./python/driftbench           # this package, from a clone of the repository; Python 3.11 or newer
npm install -g @agent-nexus/driftbench    # the driftbench command it runs, Node.js 22.13 or newer
```

This package is not on PyPI yet. Its name there will be `drift-bench`; it is still imported as `driftbench`.
The name `driftbench` on PyPI belongs to another project, a tool that analyses process drift:
`pip install driftbench` installs that project, not this one.

The package finds the command in this order: the `cli` argument, the `DRIFTBENCH_CLI` environment variable
(a JSON list of strings, or a command line), then `driftbench` on the `PATH`.

## Run specs from code

```python
from driftbench import run_specs

result = run_specs(["specs/plan-upgrade.yaml"], target="function:acme")
result.passed
```

A Python function can be the agent: `run_specs(["specs/echo.yaml"], agent="my_agent:reply")`.

## pytest

```sh
pytest --driftbench specs/ --driftbench-agent my_agent:reply
```

Each spec is one test item; a failing block fails the item and prints the evidence of each gating verdict
that did not pass.

## License

MIT
