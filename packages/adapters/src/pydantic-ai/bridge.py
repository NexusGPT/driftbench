"""driftbench bridge for a Pydantic AI agent, run by the pydantic-ai adapter of @agent-nexus/driftbench-adapters.

Usage: python bridge.py <module>:<name>

<module>:<name> names an Agent, or a function that takes no argument and returns one. The bridge reads one
JSON object on stdin, {"user_prompt": "...", "message_history": [...]}, where the history is in Pydantic
AI's own message format (what ModelMessagesTypeAdapter reads), runs the agent once, and prints one line on
stdout:

    driftbench-result <the run's new messages, as result.new_messages_json() writes them>

A failure prints `driftbench-error {"type": ..., "message": ..., "status": ...}` and exits 3; `status` is the
HTTP status of a provider error (ModelHTTPError.status_code), when there is one, so the adapter can retry
a 429 or a 5xx under its policy. Everything else the agent prints goes to stderr.
"""

import contextlib
import importlib
import json
import os
import sys

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")


def load(target):
    module_name, _, attribute = target.partition(":")
    value = getattr(importlib.import_module(module_name), attribute or "agent")
    return value() if callable(value) and not hasattr(value, "run_sync") else value


def main():
    if len(sys.argv) != 2:
        print("usage: bridge.py <module>:<name>", file=sys.stderr)
        return 2
    request = json.loads(sys.stdin.read() or "{}")
    real_stdout = sys.stdout
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from pydantic_ai.messages import ModelMessagesTypeAdapter

            agent = load(sys.argv[1])
            history = ModelMessagesTypeAdapter.validate_python(request.get("message_history", []))
            result = agent.run_sync(request.get("user_prompt", ""), message_history=history)
            new_messages = result.new_messages_json().decode()
        real_stdout.write("driftbench-result " + new_messages + "\n")
        return 0
    except Exception as error:  # the adapter decides what is retried
        status = getattr(error, "status_code", None)
        failure = {"type": type(error).__name__, "message": str(error)}
        if isinstance(status, int):
            failure["status"] = status
        real_stdout.write("driftbench-error " + json.dumps(failure) + "\n")
        return 3


if __name__ == "__main__":
    sys.exit(main())
