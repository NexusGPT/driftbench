# Python

The Python package `driftbench`, in [`python/driftbench`](../python/driftbench/README.md), runs specs from Python and from pytest. It calls the driftbench command line as a subprocess (`campaign run --json`) and reads its report into typed dataclasses. It needs Python 3.11 or newer and nothing beyond the standard library; pytest is needed only for the plugin. The package is not on PyPI: the name `driftbench` there belongs to another project, so `pip install driftbench` installs something else. Version 0.1.0 is prepared (see [Releasing](releasing.md)). Install it from a clone.

```sh
pip install ./python/driftbench
```

The package finds the command line in this order: the `cli` argument, the `DRIFTBENCH_CLI` environment variable (a JSON list of strings, or a command line), then `driftbench` on the `PATH`. From a clone without a build:

```sh
export DRIFTBENCH_CLI='["/path/to/driftbench/node_modules/.bin/tsx", "--tsconfig", "/path/to/driftbench/tsconfig.json", "/path/to/driftbench/packages/cli/src/bin.ts"]'
```

## Run specs from code

```python
from driftbench import run_specs

result = run_specs(["examples/acme/specs/conversations/plan-upgrade.yaml"], target="function:acme")
result.passed                      # True
[cell] = result.cells
cell.state, cell.target            # ("pass", "function:acme")
[block.passed for block in cell.blocks]
```

`run_specs(specs, *, target=None, agent=None, python_path=(), mode="F", repeats=1, store=None, concurrency=None, cli=None, cwd=None, timeout=None)` runs spec files or folders and returns a `CampaignResult`. Exit codes 0, 1 and 3 of the command line give a result (3: nothing failed but a cell was not run or blocked; `verdict_of(result)` reads it as `not_run` or `blocked`, never a pass); any other code raises `DriftbenchError` with the command line's message, such as an unknown target.

| Type | Holds |
|---|---|
| `CampaignResult` | `campaign_id`, `checks`, `cells`, `summary`, `exit_code`, and `passed` when every cell passes |
| `Cell` | `cell_id`, `spec_id`, `target` (such as `function:acme`), `mode`, `repeat`, `perturbation_id`, `state` (pass, fail, failed, stopped, pending, not_run or blocked), `failing`, `error`, `run_id`, `blocks`, `end_state`, `passed`, and `scored` (false for not_run and blocked: no measurement) |
| `Block` | `index`, `block_id`, `passed`, `stage`, `injected`, `verdicts`, `failing` (the gating verdicts that did not pass), `status` (not_run or blocked, else None), `not_run` and `blocked` (the reason records), `scored`, and `reason` |
| `Verdict` | `id`, `outcome`, `gating`, `evidence`, and `passed` |
| `EndState` | `match` and `diff`, one entry per field that does not hold |
| `verdict_of(block, cell or campaign result)` | the one reader of a block's pass and status, a cell's state and a campaign's cells: `pass`, `fail`, `not_run` or `blocked` |
| `Summary` | `cells`, `passed`, `failed_checks` (a gating verdict did not pass), `failed` (the run broke), `stopped_by_budget`, `pending`, `not_run`, `blocked` |

## A Python function as the agent

`agent` names a Python function, as `module:function` or as a module-level callable. The function becomes the target through the [process adapter](adapters/process.md): one process per block, in a local sandbox, its working folder the spec's workspace. The target is `process:<function name>` unless `target` names another. The package passes the command line `--process-command`: this Python, the agent runner `driftbench/agent.py` by its path, and the folders to import from (`python_path`, the working folder, and the folder of the package).

The function takes the message, or the message and the history: a list of `{"role", "content"}` dicts that ends with the current user turn. It returns the reply text, a dict, or a `Reply`, which can also report the stage the agent reached, the skills it loaded and the guards that fired, as the process adapter's runtime protocol does.

```python
from driftbench import Reply


def reply(message, history):
    return Reply(text=f"echo: {message} ({len(history)} messages)", stage="echoed", skills=("echo",))
```

```python
result = run_specs(["specs/echo.yaml"], agent="my_agent:reply")
```

A process agent has no tool calls: the adapter records its standard output as the reply, and the commands it reports as executions. See the [process adapter](adapters/process.md#how-a-block-runs).

## pytest

The package registers a pytest plugin. With `--driftbench`, pytest collects every YAML file that holds a spec (a top-level `id:` and `blocks:`) under the paths it is given, as one test item per spec. The item runs the spec through the command line and fails when a cell does not pass; the failure names each failing block and the evidence of each gating verdict that did not pass. A spec whose cells were only not run or blocked (no cell failed) is skipped, never passed, and the skip names each block not run with its reason.

| Option | Meaning |
|---|---|
| `--driftbench` | collect spec files as tests; without it, spec files are not collected |
| `--driftbench-target <adapter[:agent]>` | run every spec on this target; without it, each spec runs on its own target |
| `--driftbench-agent <module:function>` | a Python function agent, through the process adapter |
| `--driftbench-repeats <n>` | runs per spec, 1 by default |
| `--driftbench-cli <command>` | the command that runs the command line |

A run in a folder that holds `specs/echo.yaml`, `specs/echo-pass.yaml` and `my_agent.py` with the function above, without `skills`; the second block of `echo.yaml` expects `farewell`, on purpose:

```
$ pytest --driftbench specs/ --driftbench-agent my_agent:reply -p no:cacheprovider
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.6.0
rootdir: <scratch>/demo-project
plugins: driftbench-0.0.0
collected 2 items

specs/echo-pass.yaml .                                                   [ 50%]
specs/echo.yaml F                                                        [100%]

=================================== FAILURES ===================================
___________________________ driftbench spec py-echo ____________________________
campaign c-8fed2918850b: 0 of 1 cells pass
py-echo on process:reply, mode F, repeat 0: fail
  block 1 (wrong) failed
    must.0 fail: /farewell/ is missing; visible text "echo: bye (3 messages)"
=========================== short test summary info ============================
FAILED specs/echo.yaml::py-echo - campaign c-8fed2918850b: 0 of 1 cells pass
========================= 1 failed, 1 passed in 17.93s =========================
```

## Tests

`python -m pytest` in `python/driftbench` runs the package's tests: the dataclasses on a report the command line wrote, the agent runner, `run_specs` against the real command line, and the plugin through pytest's `pytester`. CI runs them on Python 3.11 and 3.12.
