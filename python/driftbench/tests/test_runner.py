"""run_specs: the driftbench CLI as a subprocess, its JSON read into dataclasses."""

import json

import pytest

from driftbench import CampaignResult, DriftbenchError, cli_command, run_specs, verdict_of

from conftest import FIXTURES, REPO

ACME = str(REPO / "examples" / "acme" / "specs" / "conversations" / "plan-upgrade.yaml")


def test_a_spec_that_passes_gives_a_passing_campaign():
    result = run_specs([ACME], target="function:acme")
    assert isinstance(result, CampaignResult)
    assert result.passed
    assert result.exit_code == 0
    [cell] = result.cells
    assert (cell.spec_id, cell.target, cell.mode, cell.repeat, cell.state) == ("acme-plan-upgrade", "function:acme", "F", 0, "pass")
    assert [block.passed for block in cell.blocks] == [True] * 5
    assert cell.end_state is not None and cell.end_state.match
    assert "tools" in result.checks


def test_a_python_function_agent_runs_through_the_process_adapter():
    result = run_specs([str(FIXTURES / "echo.yaml")], agent="echo_agent:echo_with_history", python_path=[str(FIXTURES)])
    assert not result.passed
    assert result.exit_code == 1
    [cell] = result.cells
    assert cell.target == "process:echo_with_history"
    assert cell.state == "fail"
    assert [(block.block_id, block.passed, block.stage) for block in cell.blocks] == [
        ("greet", True, "echoed"),
        ("wrong", False, "echoed"),
    ]
    [failing] = cell.blocks[1].failing
    assert failing.id == "must.0"
    assert "farewell" in failing.evidence
    assert cell.failing == ("block 1 must.0",)


def test_a_spec_not_run_gives_exit_3_and_a_not_run_campaign_never_a_pass():
    result = run_specs([str(FIXTURES / "echo-not-run.yaml")], agent="echo_agent:echo_with_history", python_path=[str(FIXTURES)])
    assert result.exit_code == 3
    assert not result.passed
    assert verdict_of(result) == "not_run"
    [cell] = result.cells
    assert cell.state == "not_run"
    assert verdict_of(cell.blocks[0]) == "not_run"
    assert cell.blocks[0].not_run["check"] == "capability"


def test_a_callable_is_named_by_its_module_and_name():
    from echo_agent import echo_with_history  # noqa: PLC0415, the fixtures folder is on the path in conftest

    result = run_specs([str(FIXTURES / "echo-pass.yaml")], agent=echo_with_history, python_path=[str(FIXTURES)])
    assert result.passed, result.cells[0].blocks


def test_repeats_give_one_cell_each():
    result = run_specs([ACME], target="function:acme", repeats=2)
    assert [cell.repeat for cell in result.cells] == [0, 1]
    assert result.summary.cells == 2 and result.summary.passed == 2


def test_a_usage_error_raises_with_the_cli_message():
    with pytest.raises(DriftbenchError) as raised:
        run_specs([ACME], target="nowhere:agent")
    assert raised.value.exit_code == 2
    assert "nowhere:agent" in str(raised.value)


def test_the_cli_command_comes_from_the_argument_the_environment_or_the_path(monkeypatch):
    assert cli_command(["node", "bin.js"]) == ["node", "bin.js"]
    assert cli_command("pnpm -s driftbench") == ["pnpm", "-s", "driftbench"]
    monkeypatch.setenv("DRIFTBENCH_CLI", json.dumps(["/opt/node", "/opt/bin.js"]))
    assert cli_command() == ["/opt/node", "/opt/bin.js"]
    monkeypatch.delenv("DRIFTBENCH_CLI")
    assert cli_command() == ["driftbench"]


def test_stage_reported_requires_this_python_block_to_report_a_stage(tmp_path):
    spec = {
        "id": "current-python-stage",
        "stages": ["echoed"],
        "blocks": [
            {"user": "first", "expect": {"stage": "echoed", "stage_reported": True}},
            {"user": "second", "expect": {"stage": "echoed", "stage_reported": True}},
        ],
    }
    path = tmp_path / "current-stage.yaml"
    path.write_text(json.dumps(spec))
    missing = run_specs([str(path)], agent="echo_agent:echo_first_stage", python_path=[str(FIXTURES)])
    assert [block.passed for block in missing.cells[0].blocks] == [True, False]
    assert [verdict.id for verdict in missing.cells[0].blocks[1].failing] == ["stage.reported"]

    restored = run_specs([str(path)], agent="echo_agent:echo_with_history", python_path=[str(FIXTURES)])
    assert restored.passed
    for block in spec["blocks"]:
        del block["expect"]["stage_reported"]
    path.write_text(json.dumps(spec))
    legacy = run_specs([str(path)], agent="echo_agent:echo_first_stage", python_path=[str(FIXTURES)])
    assert legacy.passed
