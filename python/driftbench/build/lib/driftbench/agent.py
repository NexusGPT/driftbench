"""
The process agent runner: runs a Python function as a driftbench process agent, one process per block.

    python agent.py [--path FOLDER]... module:function

The instruction arrives on stdin (or in DRIFTBENCH_STIMULUS_FILE). The function is called with the message,
and with the session history too when it takes two parameters (a list of {"role", "content"} dicts ending
with the current user turn). It returns the reply text, a mapping, or a Reply. The text goes to stdout; the
stage, skills and guards go to the runtime protocol file the adapter reads. Standard library only, so the
file runs by its path in a sandbox.
"""

from __future__ import annotations

import argparse
import importlib
import inspect
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Reply:
    """What a function agent returns when it reports more than text: a stage, skills, guards as (name, verdict)."""

    text: str
    stage: str | None = None
    skills: tuple[str, ...] = ()
    guards: tuple[tuple[str, str], ...] = field(default_factory=tuple)


def as_reply(value: Any) -> Reply:
    if isinstance(value, Reply):
        return value
    if hasattr(value, "text") and not isinstance(value, (str, dict)):
        # A Reply from driftbench.agent while this file runs as __main__: another class, the same fields.
        value = {name: getattr(value, name) for name in ("text", "stage", "skills", "guards") if hasattr(value, name)}
    if isinstance(value, str):
        return Reply(text=value)
    if isinstance(value, dict):
        return Reply(
            text=str(value.get("text", "")),
            stage=value.get("stage"),
            skills=tuple(value.get("skills", ())),
            guards=tuple((str(name), str(verdict)) for name, verdict in value.get("guards", ())),
        )
    raise TypeError(f"an agent returns a str, a dict or a Reply, not {type(value).__name__}")


def runtime_events(reply: Reply) -> list[dict[str, str]]:
    events = [{"type": "skill", "name": name} for name in reply.skills]
    events += [{"type": "guard", "name": name, "verdict": verdict} for name, verdict in reply.guards]
    if reply.stage is not None:
        events.append({"type": "stage", "name": reply.stage})
    return events


def load(target: str) -> Any:
    module_name, _, qualname = target.partition(":")
    if not module_name or not qualname:
        raise ValueError(f"name the agent as module:function, not {target!r}")
    found: Any = importlib.import_module(module_name)
    for part in qualname.split("."):
        found = getattr(found, part)
    return found


def call(function: Any, message: str, history: list[dict[str, Any]]) -> Any:
    try:
        parameters = inspect.signature(function).parameters
    except (TypeError, ValueError):
        return function(message, history)
    positional = [p for p in parameters.values() if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    takes_more = any(p.kind == p.VAR_POSITIONAL for p in parameters.values())
    return function(message, history) if len(positional) >= 2 or takes_more else function(message)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="driftbench-agent", description=__doc__.splitlines()[1])
    parser.add_argument("--path", action="append", default=[], help="a folder to import from; repeat for several")
    parser.add_argument("target", help="module:function")
    args = parser.parse_args(argv)
    for folder in reversed(args.path):
        sys.path.insert(0, folder)
    try:
        function = load(args.target)
    except (ValueError, ImportError, AttributeError) as cause:
        print(f"driftbench agent: {cause}", file=sys.stderr)
        return 2

    stimulus = os.environ.get("DRIFTBENCH_STIMULUS_FILE")
    message = Path(stimulus).read_text() if stimulus else sys.stdin.read()
    message = message.rstrip("\n")
    history_file = os.environ.get("DRIFTBENCH_HISTORY_FILE")
    history = json.loads(Path(history_file).read_text()) if history_file and Path(history_file).exists() else []

    reply = as_reply(call(function, message, history))
    runtime = os.environ.get("DRIFTBENCH_RUNTIME_FILE")
    events = runtime_events(reply)
    if runtime and events:
        with open(runtime, "a", encoding="utf-8") as out:
            out.writelines(json.dumps(event) + "\n" for event in events)
    sys.stdout.write(reply.text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
