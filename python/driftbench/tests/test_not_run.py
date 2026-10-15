"""The not_run and blocked verdicts in the Python client: the JSON of `campaign run --json` with a cell not run
and a cell blocked."""

import json

from driftbench import CampaignResult
from driftbench.pytest_plugin import describe, unmeasured

from conftest import FIXTURES

NOT_RUN = {
    "kind": "unsupported",
    "layer": "5 world",
    "check": "capability",
    "expected": "the adapter applies forced tool results (lookup) (toolStubs)",
    "got": "process declares toolStubs false: the agent would never see it",
}


def report():
    """The fixture report with two cells, one not run and one blocked, as the CLI prints them."""
    doc = json.loads((FIXTURES / "report.json").read_text())
    [cell] = doc["cells"]
    passing = dict(cell["blocks"][0])
    not_run = {
        **cell,
        "cellId": "c-not-run",
        "state": "not_run",
        "failing": ["block 1 not_run capability"],
        "blocks": [passing, {"index": 1, "pass": False, "status": "not_run", "notRun": NOT_RUN, "verdicts": []}],
    }
    blocked = {
        **cell,
        "cellId": "c-blocked",
        "repeat": 1,
        "state": "blocked",
        "failing": ["block 1 blocked by block 0"],
        "blocks": [
            passing,
            {"index": 1, "pass": False, "status": "blocked", "blocked": {"by": "block 0", "root": "block 0"}, "verdicts": []},
        ],
    }
    doc["cells"] = [not_run, blocked]
    doc["summary"] = {"cells": 2, "pass": 0, "fail": 0, "notRun": 1, "blocked": 1, "failed": 0}
    return doc


def test_the_new_states_parse_and_never_pass():
    result = CampaignResult.from_json(report(), exit_code=1)
    assert [cell.state for cell in result.cells] == ["not_run", "blocked"]
    assert not any(cell.passed for cell in result.cells)
    assert not result.passed
    assert [block.passed for block in result.cells[0].blocks] == [True, False]
    # A block not run holds no verdict: nothing is listed as failing.
    assert result.cells[0].blocks[1].failing == ()


def test_the_summary_counts_add_up_to_the_cells():
    summary = CampaignResult.from_json(report(), exit_code=1).summary
    counted = (
        summary.passed
        + summary.failed_checks
        + summary.failed
        + summary.stopped_by_budget
        + summary.pending
        + summary.not_run
        + summary.blocked
    )
    assert counted == summary.cells


def test_the_plugin_names_a_block_not_run_and_why():
    text = describe(CampaignResult.from_json(report(), exit_code=1))
    assert "block 1 failed" not in text
    assert "not run" in text
    assert "toolStubs" in text


def test_the_blocks_carry_their_status_and_reason():
    cell = CampaignResult.from_json(report(), exit_code=1).cells[0]
    block = cell.blocks[1]
    assert (block.status, block.scored, cell.scored) == ("not_run", False, False)
    assert block.reason == "not run (capability): process declares toolStubs false: the agent would never see it"
    text = describe(CampaignResult.from_json(report(), exit_code=1))
    assert "block 1 blocked by block 0" in text
    assert "0 of 0 cells pass (1 not run, 1 blocked)" in text


def test_a_spec_only_not_run_is_skipped_and_one_that_failed_still_fails():
    result = CampaignResult.from_json(report(), exit_code=1)
    assert unmeasured(result)
    doc = report()
    doc["cells"][1] = {**doc["cells"][1], "state": "fail"}
    assert not unmeasured(CampaignResult.from_json(doc, exit_code=1))


def test_verdict_of_reads_blocks_and_cells():
    from driftbench import verdict_of

    result = CampaignResult.from_json(report(), exit_code=1)
    assert [verdict_of(cell) for cell in result.cells] == ["not_run", "blocked"]
    assert [verdict_of(block) for block in result.cells[0].blocks] == ["pass", "not_run"]
    text = describe(result)
    assert "repeat 0: not run" in text
    assert " failed" not in text


def test_one_pass_and_one_not_run_cell_read_one_of_one_and_no_failure():
    doc = report()
    passing = {**doc["cells"][0], "cellId": "c-pass", "state": "pass", "failing": [], "blocks": [doc["cells"][0]["blocks"][0]]}
    doc["cells"] = [passing, doc["cells"][0]]
    doc["summary"] = {"cells": 2, "pass": 1, "fail": 0, "failed": 0}
    text = describe(CampaignResult.from_json(doc, exit_code=1))
    assert "1 of 1 cells pass (1 not run)" in text
    assert "failed" not in text
    assert "block 1 not run (capability)" in text
