"""Typed results: the JSON `driftbench campaign run --json` prints, as frozen dataclasses."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Verdict:
    """One check's verdict on one block. A gating verdict that does not pass fails the block."""

    id: str
    outcome: str
    gating: bool
    evidence: str

    @property
    def passed(self) -> bool:
        return self.outcome == "pass"

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> Verdict:
        return cls(id=doc["id"], outcome=doc["outcome"], gating=bool(doc["gating"]), evidence=doc.get("evidence", ""))


@dataclass(frozen=True)
class Block:
    """One block of a run: its position, the spec block id when it has one, and its verdicts."""

    index: int
    block_id: str | None
    passed: bool
    stage: str | None
    injected: bool
    verdicts: tuple[Verdict, ...]

    @property
    def failing(self) -> tuple[Verdict, ...]:
        """The gating verdicts that did not pass: why the block failed."""
        return tuple(verdict for verdict in self.verdicts if verdict.gating and not verdict.passed)

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> Block:
        return cls(
            index=int(doc["index"]),
            block_id=doc.get("blockId"),
            passed=bool(doc["pass"]),
            stage=doc.get("stage"),
            injected=bool(doc.get("injected", False)),
            verdicts=tuple(Verdict.from_json(verdict) for verdict in doc.get("verdicts", [])),
        )


@dataclass(frozen=True)
class EndState:
    """The end state of a run against the spec's: a match, or one diff entry per field that does not hold."""

    match: bool
    diff: tuple[dict[str, Any], ...]

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> EndState:
        return cls(match=bool(doc["match"]), diff=tuple(doc.get("diff", [])))


@dataclass(frozen=True)
class Cell:
    """One spec on one target, in one mode, for one repeat. `state` is pass, fail, failed, stopped or pending."""

    cell_id: str
    spec_id: str
    target: str
    mode: str
    repeat: int
    perturbation_id: str | None
    state: str
    failing: tuple[str, ...]
    error: str | None
    run_id: str | None
    blocks: tuple[Block, ...]
    end_state: EndState | None

    @property
    def passed(self) -> bool:
        return self.state == "pass"

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> Cell:
        target = doc["target"]
        shown = target["adapter"] if target.get("agent") is None else f"{target['adapter']}:{target['agent']}"
        end_state = doc.get("endState")
        return cls(
            cell_id=doc["cellId"],
            spec_id=doc["specId"],
            target=shown,
            mode=doc["mode"],
            repeat=int(doc["repeat"]),
            perturbation_id=doc.get("perturbationId"),
            state=doc["state"],
            failing=tuple(doc.get("failing", [])),
            error=doc.get("error"),
            run_id=doc.get("runId"),
            blocks=tuple(Block.from_json(block) for block in doc.get("blocks", [])),
            end_state=None if end_state is None else EndState.from_json(end_state),
        )


@dataclass(frozen=True)
class Summary:
    """Cell counts: passed, failed_checks (a gating verdict did not pass), failed (the run broke), and the rest."""

    cells: int
    passed: int
    failed_checks: int
    failed: int
    stopped_by_budget: int
    pending: int

    @classmethod
    def from_json(cls, doc: dict[str, Any]) -> Summary:
        return cls(
            cells=int(doc["cells"]),
            passed=int(doc["pass"]),
            failed_checks=int(doc["fail"]),
            failed=int(doc["failed"]),
            stopped_by_budget=int(doc.get("stoppedByBudget", 0)),
            pending=int(doc.get("pending", 0)),
        )


@dataclass(frozen=True)
class CampaignResult:
    """One `campaign run`: its cells in cell order, the checks it applied, and the CLI's exit code."""

    campaign_id: str
    checks: tuple[str, ...]
    cells: tuple[Cell, ...]
    summary: Summary
    exit_code: int

    @property
    def passed(self) -> bool:
        return len(self.cells) > 0 and all(cell.passed for cell in self.cells)

    @classmethod
    def from_json(cls, doc: dict[str, Any], exit_code: int) -> CampaignResult:
        return cls(
            campaign_id=doc["campaignId"],
            checks=tuple(doc.get("checks", [])),
            cells=tuple(Cell.from_json(cell) for cell in doc["cells"]),
            summary=Summary.from_json(doc["summary"]),
            exit_code=exit_code,
        )
