"""The dataclasses read the JSON the CLI prints."""

import json

from driftbench import Block, CampaignResult, Cell, Verdict

from conftest import FIXTURES


def report():
    return json.loads((FIXTURES / "report.json").read_text())


def test_the_report_becomes_typed_dataclasses():
    result = CampaignResult.from_json(report(), exit_code=1)
    assert result.campaign_id.startswith("c-")
    [cell] = result.cells
    assert isinstance(cell, Cell)
    assert isinstance(cell.blocks[0], Block)
    assert isinstance(cell.blocks[0].verdicts[0], Verdict)
    assert cell.blocks[1].failing[0].id == "must.0"
    assert result.summary.failed_checks == 1
    assert not result.passed


def test_a_cell_without_a_run_has_no_blocks():
    doc = report()
    doc["cells"][0] = {key: value for key, value in doc["cells"][0].items() if key not in ("runId", "blocks", "cost", "cacheHit")}
    doc["cells"][0]["state"] = "pending"
    [cell] = CampaignResult.from_json(doc, exit_code=1).cells
    assert cell.blocks == () and cell.run_id is None and not cell.passed


def test_failing_holds_only_the_gating_verdicts_that_did_not_pass():
    block = Block.from_json(
        {
            "index": 2,
            "pass": False,
            "verdicts": [
                {"id": "must.0", "outcome": "pass", "gating": True, "evidence": "matched"},
                {"id": "lang.stable", "outcome": "inconclusive", "gating": False, "evidence": "too short"},
                {"id": "tools.argument_accuracy", "outcome": "fail", "gating": False, "evidence": "1 of 2"},
                {"id": "tools.order.create.count", "outcome": "fail", "gating": True, "evidence": "called 0 times"},
            ],
        }
    )
    assert [verdict.id for verdict in block.failing] == ["tools.order.create.count"]
    assert block.block_id is None and block.stage is None and not block.injected
