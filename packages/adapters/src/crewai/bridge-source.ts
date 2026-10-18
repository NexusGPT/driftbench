// The text of bridge.py, which the adapter writes to a temporary file and runs with Python. Kept equal to
// bridge.py by a test; edit bridge.py, then copy it here.
export const CREWAI_BRIDGE = `"""driftbench bridge for a CrewAI crew, run by the crewai adapter of @agent-nexus/driftbench-adapters.

Usage: python bridge.py <module>:<name>

<module>:<name> names a Crew, or a function that takes no argument and returns a fresh Crew (one per block,
so no state leaks between blocks). The bridge reads one JSON object on stdin, {"inputs": {...}}, kicks the
crew off with those inputs, and prints one line on stdout:

    driftbench-result {"raw": ..., "tasks": [...], "tools": [...], "usage": {...}}

\`tools\` lists every tool the crew's agents used, in order, from CrewAI's event bus: the tool name, its
arguments, and its output or error. A failure prints \`driftbench-error {"type": ..., "message": ...,
"status": ...}\` and exits 3; \`status\` is the HTTP status of a provider error, when there is one, so the
adapter can retry a 429 or a 5xx under its policy. Everything else the crew prints goes to stderr.
"""

import contextlib
import importlib
import json
import os
import sys

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")


def load(target):
    module_name, _, attribute = target.partition(":")
    value = getattr(importlib.import_module(module_name), attribute or "crew")
    return value() if callable(value) and not hasattr(value, "kickoff") else value


def jsonable(value):
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


def main():
    if len(sys.argv) != 2:
        print("usage: bridge.py <module>:<name>", file=sys.stderr)
        return 2
    request = json.loads(sys.stdin.read() or "{}")
    real_stdout = sys.stdout
    tools = []
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from crewai.events import (
                ToolUsageErrorEvent,
                ToolUsageFinishedEvent,
                crewai_event_bus,
            )

            with crewai_event_bus.scoped_handlers():

                @crewai_event_bus.on(ToolUsageFinishedEvent)
                def finished(_source, event):
                    tools.append({"tool": event.tool_name, "input": jsonable(event.tool_args), "output": jsonable(event.output)})

                @crewai_event_bus.on(ToolUsageErrorEvent)
                def failed(_source, event):
                    tools.append({"tool": event.tool_name, "input": jsonable(event.tool_args), "error": str(event.error)})

                crew = load(sys.argv[1])
                output = crew.kickoff(inputs=request.get("inputs", {}))
                if hasattr(crewai_event_bus, "flush"):
                    crewai_event_bus.flush()
        usage = getattr(output, "token_usage", None)
        result = {
            "raw": output.raw,
            "tasks": [
                {"name": task.name, "agent": task.agent, "raw": task.raw} for task in (output.tasks_output or [])
            ],
            "tools": tools,
            "usage": {
                "prompt_tokens": getattr(usage, "prompt_tokens", None),
                "completion_tokens": getattr(usage, "completion_tokens", None),
            },
        }
        real_stdout.write("driftbench-result " + json.dumps(result) + "\\n")
        return 0
    except Exception as error:  # the adapter decides what is retried
        status = getattr(error, "status_code", None) or getattr(error, "status", None)
        failure = {"type": type(error).__name__, "message": str(error)}
        if isinstance(status, int):
            failure["status"] = status
        real_stdout.write("driftbench-error " + json.dumps(failure) + "\\n")
        return 3


if __name__ == "__main__":
    sys.exit(main())
`;
