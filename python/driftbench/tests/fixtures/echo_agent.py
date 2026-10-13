"""Fixture agents for the tests: fictional, deterministic, no network."""

from driftbench import Reply


def echo(message):
    """Replies with the message, nothing else."""
    return f"echo: {message}"


def echo_with_history(message, history):
    """Replies with the message and the number of messages so far, and reports a stage and a skill."""
    return Reply(text=f"echo: {message} ({len(history)} messages)", stage="echoed", skills=("echo",))


def as_dict(message):
    """Replies with a mapping, the other accepted form."""
    return {"text": f"dict: {message}", "stage": "echoed", "guards": [("polite", "pass")]}


def broken(message):
    """Fails on purpose."""
    raise ValueError("the agent broke on purpose")


def echo_first_stage(message):
    """Reports a stage on the first block only, for the current-block reporting assertion."""
    return Reply(text=f"echo: {message}", stage="echoed" if message == "first" else None)
