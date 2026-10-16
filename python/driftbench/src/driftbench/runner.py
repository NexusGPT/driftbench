"""run_specs: the driftbench CLI as a subprocess, `campaign run --json`, read into CampaignResult."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from collections.abc import Callable, Iterable, Sequence
from pathlib import Path

from . import agent as agent_module
from .results import CampaignResult


class DriftbenchError(RuntimeError):
    """The CLI refused the call (a usage or input error) or gave no report; the message is its stderr."""

    def __init__(self, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def cli_command(cli: str | Sequence[str] | None = None) -> list[str]:
    """The command that runs the CLI: the argument, else DRIFTBENCH_CLI (a JSON list or a command line), else `driftbench`."""
    if cli is None:
        cli = os.environ.get("DRIFTBENCH_CLI")
    if cli is None or cli == "":
        return ["driftbench"]
    if isinstance(cli, str):
        text = cli.strip()
        if text.startswith("["):
            parsed = json.loads(text)
            if not isinstance(parsed, list) or not all(isinstance(part, str) for part in parsed):
                raise ValueError("DRIFTBENCH_CLI must be a JSON list of strings or a command line")
            return list(parsed)
        return shlex.split(text)
    return list(cli)


def agent_name(agent: str | Callable[..., object]) -> str:
    """`module:function` for a function agent given as text or as a module-level callable."""
    if isinstance(agent, str):
        return agent
    return f"{agent.__module__}:{agent.__qualname__}"


def agent_command(agent: str | Callable[..., object], python_path: Iterable[str] = ()) -> list[str]:
    """
    The process command that runs a Python function agent: this Python, the agent runner by its file, the
    folders to import from (the given ones, the working folder, and the folder that holds this package),
    then `module:function`.
    """
    folders = [*python_path, os.getcwd(), str(Path(__file__).resolve().parents[1])]
    argv = [sys.executable, str(Path(agent_module.__file__).resolve())]
    for folder in dict.fromkeys(str(Path(folder).resolve()) for folder in folders):
        argv += ["--path", folder]
    return [*argv, agent_name(agent)]


def run_specs(
    specs: Sequence[str],
    *,
    target: str | None = None,
    agent: str | Callable[..., object] | None = None,
    python_path: Iterable[str] = (),
    mode: str = "F",
    repeats: int = 1,
    store: str | None = None,
    concurrency: int | None = None,
    cli: str | Sequence[str] | None = None,
    cwd: str | None = None,
    timeout: float | None = None,
) -> CampaignResult:
    """
    Runs spec files or folders with `driftbench campaign run --json` and returns the result. With `agent`, a
    Python function (`module:function` or a module-level callable) is the target, through the process
    adapter: the target is `process:<function name>` unless `target` names another. Without either, each spec
    runs on its own target. Exit codes 0, 1 and 3 give a result: 3 is the command's "nothing failed, but a cell
    was not run or blocked", read by `verdict_of(result)` as not_run or blocked, never as a pass. Anything else
    raises DriftbenchError.
    """
    argv = [*cli_command(cli), "campaign", "run", *specs, "--json", "--mode", mode, "--repeats", str(repeats)]
    if agent is not None:
        name = agent_name(agent).rsplit(":", 1)[-1].split(".")[-1]
        argv += ["--target", target or f"process:{name}"]
        argv += ["--process-command", json.dumps(agent_command(agent, python_path))]
    elif target is not None:
        argv += ["--target", target]
    if store is not None:
        argv += ["--store", store]
    if concurrency is not None:
        argv += ["--concurrency", str(concurrency)]
    done = subprocess.run(argv, capture_output=True, text=True, cwd=cwd, timeout=timeout, check=False)
    if done.returncode not in (0, 1, 3):
        raise DriftbenchError(done.stderr.strip() or f"driftbench exited {done.returncode}", done.returncode)
    try:
        doc = json.loads(done.stdout)
    except json.JSONDecodeError as cause:
        raise DriftbenchError(f"driftbench printed no JSON report: {done.stderr.strip()}", done.returncode) from cause
    return CampaignResult.from_json(doc, exit_code=done.returncode)
