"""The process agent runner: a Python function behind the process adapter protocol."""

import json
import os
import subprocess
import sys
from pathlib import Path

import driftbench
from driftbench import agent

from conftest import FIXTURES

RUNNER = Path(agent.__file__)
SRC = Path(driftbench.__file__).resolve().parents[1]


def run(spec, message, tmp_path, history=None):
    (tmp_path / "driftbench-history.json").write_text(json.dumps(history or [{"role": "user", "content": message}]))
    env = {
        "PATH": os.environ.get("PATH", ""),
        "DRIFTBENCH_HISTORY_FILE": str(tmp_path / "driftbench-history.json"),
        "DRIFTBENCH_RUNTIME_FILE": str(tmp_path / "driftbench-runtime.jsonl"),
        "DRIFTBENCH_COMMANDS_FILE": str(tmp_path / "driftbench-commands.jsonl"),
    }
    argv = [sys.executable, str(RUNNER), "--path", str(FIXTURES), "--path", str(SRC), spec]
    return subprocess.run(argv, input=message, capture_output=True, text=True, cwd=tmp_path, env=env)


def runtime(tmp_path):
    path = tmp_path / "driftbench-runtime.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def test_a_one_argument_function_gets_the_message_and_its_text_is_the_reply(tmp_path):
    done = run("echo_agent:echo", "hello\n", tmp_path)
    assert done.returncode == 0, done.stderr
    assert done.stdout == "echo: hello\n"
    assert runtime(tmp_path) == []


def test_a_two_argument_function_gets_the_history_and_reports_its_runtime(tmp_path):
    history = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "echo: hi"}, {"role": "user", "content": "again"}]
    done = run("echo_agent:echo_with_history", "again", tmp_path, history)
    assert done.returncode == 0, done.stderr
    assert done.stdout == "echo: again (3 messages)\n"
    assert runtime(tmp_path) == [{"type": "skill", "name": "echo"}, {"type": "stage", "name": "echoed"}]


def test_a_mapping_reply_works_and_its_guards_are_reported(tmp_path):
    done = run("echo_agent:as_dict", "hi", tmp_path)
    assert done.returncode == 0, done.stderr
    assert done.stdout == "dict: hi\n"
    assert runtime(tmp_path) == [
        {"type": "guard", "name": "polite", "verdict": "pass"},
        {"type": "stage", "name": "echoed"},
    ]


def test_an_agent_that_raises_exits_non_zero_with_the_error(tmp_path):
    done = run("echo_agent:broken", "hi", tmp_path)
    assert done.returncode == 1
    assert "the agent broke on purpose" in done.stderr


def test_a_target_that_does_not_name_a_function_is_a_usage_error(tmp_path):
    done = run("echo_agent", "hi", tmp_path)
    assert done.returncode == 2
    assert "module:function" in done.stderr
