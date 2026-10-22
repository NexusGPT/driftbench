# Python

This is a hands-on guide to driftbench from Python. Your agent may be a Python function. Your tests may run inside a Python script or inside pytest. The guide writes a small Python agent, runs a test on it from a Python script, makes the test fail, and reads the failure. Then it runs the same agent as a plain command, with no driftbench code in it. Every command below is run by a test on GitHub, and every excerpt is real output. Nothing calls a model and nothing is paid for.

## Before you start

**Why you do this.** The Python side of driftbench is a thin layer. It starts the `driftbench` command for you and reads its report into Python objects. This part sets up the folder and says what to install.

**What you need.**

- Node 22.13 or newer, and driftbench installed from a clone, as the [guide index](index.md#install) shows. That gives you the command `driftbench`. Run this page from the root of the clone.
- Python 3.11 or newer. The package needs nothing beyond the standard library.
- A working folder named `py-demo`, made inside the clone by step 1.

**What you install.** The package is called `drift-bench` on the Python side, and sits in the clone, in `python/driftbench`. You still write `import driftbench` in your code. It is not on PyPI, and the name `driftbench` there belongs to another project, so `pip install driftbench` would install something else. Install it from the clone, as `pip install ./python/driftbench`. Step 1 does this in a **virtual environment**: a private folder of Python packages, so your own Python stays untouched. The guide test runs that step.

The later steps still point `PYTHONPATH` at the sources of the clone, so each one works on its own. If the package is installed, you can drop that variable.

**Words used here.**

- A **spec** is one test file. A **block** is one user message and what must be true of the reply.
- A **process target** is an agent that driftbench starts as a command, once per block. The user message arrives on standard input, and the reply is what the command prints.
- A **cell** is one spec run on one target. A report holds one cell per spec and target.

The full description of the package is in the [Python reference](../python.md). The process target is in the [process adapter reference](../adapters/process.md).

## 1. Set up the folder and check Python

**Why you do this.** Everything else runs from one folder. This step makes it and checks the Python version, so a later error cannot be about the setup.

**Relevant commands.**

- `mkdir -p py-demo/specs`: makes the working folder and the folder for the spec · `-p` makes the folders only when they are missing · it produces `py-demo/specs`.
- `cd py-demo`: goes into the working folder · no options · every later command runs from there.
- `python3 -c "import sys; print(sys.version_info >= (3, 11))"`: asks Python whether it is version 3.11 or newer · `-c` runs the text that follows as a program · it prints `True` or `False`.

```console
$ mkdir -p py-demo/specs
$ cd py-demo
$ python3 -c "import sys; print(sys.version_info >= (3, 11))"
True
```

**How to read it.** `True` means Python is new enough. `False` means you need a newer Python.

Now tell Python where the command and the package are. The command line of a clone without a build is `tsx` running the source of the command. The package finds the command in the variable `DRIFTBENCH_CLI`, a JSON list of words. These two commands write the two values into files, so the later commands stay short:

```console
$ ROOT=$(cd -P ../examples/.. && pwd -P); printf '["%s/node_modules/.bin/tsx","--tsconfig","%s/tsconfig.base.json","%s/packages/cli/src/bin.ts"]' "$ROOT" "$ROOT" "$ROOT" > cli.json
$ ROOT=$(cd -P ../examples/.. && pwd -P); printf '%s' "$ROOT/python/driftbench/src" > pypath.txt
```

With a built and linked `driftbench` on your `PATH`, skip `cli.json` and drop `DRIFTBENCH_CLI` from the commands. The package finds `driftbench` there.

Now install the package in a virtual environment inside the working folder, and check that Python can import it:

```console
$ python3 -m venv .venv
$ ROOT=$(cd -P ../examples/.. && pwd -P); .venv/bin/pip install --quiet "$ROOT/python/driftbench"
$ .venv/bin/python -c "import driftbench; print(driftbench.__name__)"
driftbench
```

- `python3 -m venv .venv` makes the virtual environment in the folder `.venv`.
- `.venv/bin/pip install --quiet <folder>` installs the package from the clone into it. `--quiet` hides the progress lines.
- `.venv/bin/python -c "import driftbench; ..."` runs the Python of the environment and prints `driftbench` when the import works.

**If it goes wrong.**

- `python3: command not found`: install Python 3.11 or newer, or try `python`.
- `False`: your Python is older than 3.11. Install a newer one and run the step again.
- `ROOT` is empty and the files hold a wrong path: you did not run the step from the clone root, so `../examples` is missing. Run `cd` to the clone, and run step 1 again.

## 2. Write the Python agent and the spec

**Why you do this.** Driftbench tests an agent, so it needs one. This short Python function stands in for yours. The spec says what a customer says and what the agent must answer.

**You need.** Two files. The agent is a function that takes the message and the history of the chat, and returns a `Reply`. A `Reply` holds the text of the answer, and may also name the stage the agent reached.

```python
# file: my_agent.py
from driftbench import Reply


def reply(message, history):
    return Reply(text=f"Hello from Acme. You said: {message} ({len(history)} messages)", stage="greeted")
```

The spec targets `process:reply`, the function `reply` seen as a process. It expects two words in the answer and the stage `greeted`:

```yaml
# file: specs/hello.yaml
id: py-hello
title: A Python agent greets the customer
target: { adapter: process, agent: reply }
blocks:
  - user: Hi, I would like to change my plan.
    expect:
      must: ['Acme', 'change my plan']
      stage: greeted
```

**Relevant commands.**

- `driftbench spec validate specs`: checks that every test file in a folder is well formed, before anything runs · `specs` is the folder to check · it prints one line per file and a count, and exits 0 when every file is valid.

```console
$ driftbench spec validate specs
✓ specs/hello.yaml  py-hello · 1 block · hash 213267ae545a
Checked 1 spec: 1 valid, 0 invalid, 0 warnings.
```

**How to read it.** The spec is valid. The hash identifies this exact spec text. It changes when you edit the file.

**If it goes wrong.**

- `spec validate` exits 1 and names a key: fix the key it names. Every code is listed in the [CLI reference](../reference/cli.md).

## 3. Run the spec from Python

**Why you do this.** This is the point of the package. A script runs the test and holds the result as objects you can inspect, print or assert on.

**You need.** The files of step 2 and a small script.

```python
# file: run.py
from driftbench import run_specs

result = run_specs(["specs/hello.yaml"], agent="my_agent:reply")
print("passed:", result.passed)
for cell in result.cells:
    print(cell.spec_id, cell.target, cell.state)
    for block in cell.blocks:
        print("  block", block.index, "passed" if block.passed else "failed")
```

**Relevant commands.**

- `run_specs(specs, agent=...)`: runs spec files or folders and returns a `CampaignResult` · `specs` is a list of paths. `agent="my_agent:reply"` names the function as `module:function`, so the package starts it as a process target. It sets the target to `process:reply` · it starts the `driftbench` command, reads its report, and returns the result.
- `python3 run.py`: runs the script · no options · it prints what the script prints. The two variables in front of it point Python at the command and at the package, as step 1 set up.

**You type.**

```console
$ DRIFTBENCH_CLI="$(cat cli.json)" PYTHONPATH="$(cat pypath.txt)" python3 run.py
passed: True
py-hello process:reply pass
  block 0 passed
```

**How to read it.** `result.passed` is true when every cell passes. Each cell has a `spec_id`, a `target` and a `state`. The state is `pass`, `fail`, `failed`, `stopped`, `pending`, `not_run` or `blocked`. Each cell holds its blocks, and each block says whether it passed.

**If it goes wrong.**

- `ModuleNotFoundError: No module named 'driftbench'`: Python does not see the package. Check that `pypath.txt` holds a path that exists, or use `.venv/bin/python` in place of `python3`, because the package is installed there.
- `DriftbenchError` and a message about a target: the command line rejected the run. The message is the command's own, so read it as you read any `driftbench` error.
- `ModuleNotFoundError: No module named 'my_agent'`: you run the script from another folder than the one that holds `my_agent.py`.

## 4. Make the test fail and read why

**Why you do this.** A test that cannot fail proves nothing. A second spec asks for a word the agent never says. The script then prints the failing check and its evidence.

**You need.** A second spec, and a second script.

```yaml
# file: specs/farewell.yaml
id: py-farewell
title: The Python agent is asked for a farewell it does not give
target: { adapter: process, agent: reply }
blocks:
  - user: Thanks, that is all.
    expect:
      must: ['farewell']
```

```python
# file: run2.py
from driftbench import run_specs

result = run_specs(["specs/farewell.yaml"], agent="my_agent:reply")
print("passed:", result.passed, "exit code:", result.exit_code)
[cell] = result.cells
print(cell.state, cell.failing)
for block in cell.blocks:
    for verdict in block.failing:
        print(verdict.id, verdict.outcome, verdict.evidence)
```

**Relevant commands.**

- `block.failing`: the gating verdicts of a block that did not pass · a verdict has an `id`, an `outcome` and an `evidence` text · it is an empty list when the block passes.
- `result.exit_code`: the exit code of the `driftbench` command · 0 when everything passed, 1 when a check failed, 3 when nothing failed but a cell was not run · `run_specs` returns a result for these three codes. Any other code raises `DriftbenchError`.

**You type.**

```console
$ DRIFTBENCH_CLI="$(cat cli.json)" PYTHONPATH="$(cat pypath.txt)" python3 run2.py
passed: False exit code: 1
fail ('block 0 must.0',)
must.0 fail /farewell/ is missing; closest span "Hell", differs by 5 characters; visible text "Hello from Acme. You said: Thanks, that is all. (1 messages)"
```

**How to read it.** The cell failed on the check `must.0`, the first pattern of `must`. The evidence says which pattern is missing and shows the text the check read. The script exits 0 anyway, because it only prints. In a real test, assert on `result.passed`.

**If it goes wrong.**

- The script prints `passed: True`: the agent now says `farewell`. Restore the agent text of step 2.

## 5. Run the same agent as a plain command

**Why you do this.** The package is a convenience. The process target underneath is a plain contract: driftbench starts a command, writes the message on its standard input, and reads its standard output. So any Python script works as an agent, with no driftbench code in it. This is the form to use from CI, or from a language other than Python.

**You need.** A script that reads standard input and prints a reply.

```python
# file: agent.py
import sys

message = sys.stdin.read().strip()
print(f"Hello from Acme. You said: {message}")
```

The stage check of step 2 needs the runtime file that the package writes for you. A plain script does not write it, so this spec only reads the text:

```yaml
# file: specs/plain.yaml
id: py-plain
title: A plain Python script greets the customer
target: { adapter: process, agent: plain }
blocks:
  - user: Hi, I would like to change my plan.
    expect:
      must: ['Acme', 'change my plan']
```

**Relevant commands.**

- `driftbench campaign run specs/plain.yaml --target process:plain --process-command ...`: runs the spec against your script · `specs/plain.yaml` is the spec. `--target process:plain` says how to reach the agent. `process` is the adapter that starts a command, and `plain` is the agent name. `--process-command` is a JSON list, the program and its arguments. Here it is `python3` and the path of `agent.py`. `$PWD` is the current folder, and the path must be absolute · it prints one verdict line per spec and a count, and exits 1 when a spec fails.

**You type.**

```console
$ driftbench campaign run specs/plain.yaml --target process:plain --process-command "[\"python3\",\"$PWD/agent.py\"]"
✓ py-plain · process:plain · F · repeat 0  pass  1 block
1 cell: 1 pass, 0 fail, 0 failed. Spent $0.00.
```

**How to read it.** The line is the same as for any other target. The script ran once for the block, in a temporary working folder. The history of the chat is in the file named by the variable `DRIFTBENCH_HISTORY_FILE`, as the [process adapter reference](../adapters/process.md#what-the-agent-reports) describes.

**If it goes wrong.**

- The run cannot start the agent: the path in `--process-command` is wrong or not absolute. Run `python3 agent.py` by hand in the folder, with a message on standard input.

## 6. Run specs inside pytest

**Why you do this.** If your team already runs pytest, a spec can be one test item in the same run. A failure shows up in the same report as the rest.

**You need.** pytest, and the package. Both go into the virtual environment of step 1, so your own Python stays untouched.

```console
$ .venv/bin/pip install --quiet pytest
$ DRIFTBENCH_CLI="$(cat cli.json)" .venv/bin/pytest --driftbench specs/hello.yaml --driftbench-agent my_agent:reply
plugins: drift-bench-0.1.0
collected 1 item
specs/hello.yaml .                                                       [100%]
```

**Relevant commands.**

- `--driftbench`: tells pytest to collect each YAML file that holds a spec as one test item · no value · without it, pytest ignores spec files.
- `--driftbench-agent my_agent:reply`: runs every spec against this Python function, as in step 3 · the value is `module:function` · without it, each spec runs on its own target.

**How to read it.** A spec that passes is a dot. A failing spec is an `F`, and its report names each failing block with the evidence of each check, as step 4 printed it. A spec whose cells were only not run or blocked is skipped, never passed. The [Python reference](../python.md#pytest) lists the other options.

## Where to go next

- The [Python reference](../python.md) lists the result types, the options of `run_specs` and the pytest options.
- The [Vitest](vitest.md) page runs specs inside a JavaScript test suite.
- The [plugins](plugins.md) page loads your own adapter or check into the command.
