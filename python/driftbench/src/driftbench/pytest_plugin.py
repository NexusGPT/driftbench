"""
The pytest plugin. `pytest --driftbench specs/` collects every spec file under the paths (a YAML file with
top-level `id:` and `blocks:`) as one test item. The item runs the spec through the driftbench CLI and fails
when a cell fails, with the evidence of each failing block. Options: --driftbench-target (a CLI target),
--driftbench-agent (module:function, a Python function agent through the process adapter),
--driftbench-repeats and --driftbench-cli.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

from .results import CampaignResult, Cell, verdict_of
from .runner import run_specs

SPEC_ID = re.compile(r"^id:\s*['\"]?([A-Za-z0-9][A-Za-z0-9._-]*)['\"]?\s*$", re.MULTILINE)
BLOCKS = re.compile(r"^blocks:", re.MULTILINE)


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("driftbench")
    group.addoption("--driftbench", action="store_true", help="collect driftbench spec files (*.yaml, *.yml) as tests")
    group.addoption("--driftbench-target", default=None, help="run every spec on this target, such as function:acme")
    group.addoption(
        "--driftbench-agent",
        default=None,
        help="module:function, a Python function agent run through the process adapter",
    )
    group.addoption("--driftbench-repeats", default=1, type=int, help="runs per spec")
    group.addoption("--driftbench-cli", default=None, help="the command that runs the driftbench CLI")


def spec_id(path: Path) -> str | None:
    """The spec id of a YAML file that holds a spec, read without a YAML parser; None for any other file."""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    found = SPEC_ID.search(text)
    return found.group(1) if found and BLOCKS.search(text) else None


def pytest_collect_file(parent: pytest.Collector, file_path: Path) -> pytest.Collector | None:
    if not parent.config.getoption("driftbench") or file_path.suffix not in (".yaml", ".yml"):
        return None
    identifier = spec_id(file_path)
    if identifier is None:
        return None
    return SpecFile.from_parent(parent, path=file_path, spec=identifier)


class SpecFile(pytest.File):
    def __init__(self, *, spec: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.spec = spec

    def collect(self):
        yield SpecItem.from_parent(self, name=self.spec)


class SpecFailed(Exception):
    def __init__(self, result: CampaignResult) -> None:
        super().__init__(result.campaign_id)
        self.result = result


class SpecItem(pytest.Item):
    def runtest(self) -> None:
        config = self.config
        result = run_specs(
            [str(self.path)],
            target=config.getoption("driftbench_target"),
            agent=config.getoption("driftbench_agent"),
            python_path=[str(config.rootpath)],
            repeats=config.getoption("driftbench_repeats"),
            cli=config.getoption("driftbench_cli"),
        )
        verdict = verdict_of(result)
        # A spec whose cells were only not run or blocked measured nothing: skipped with why, never a pass.
        if verdict in ("not_run", "blocked"):
            pytest.skip(describe(result))
        if verdict != "pass":
            raise SpecFailed(result)

    def repr_failure(self, excinfo: pytest.ExceptionInfo[BaseException], style: Any = None) -> str:
        if isinstance(excinfo.value, SpecFailed):
            return describe(excinfo.value.result)
        return super().repr_failure(excinfo, style=style)

    def reportinfo(self):
        return self.path, None, f"driftbench spec {self.name}"


def unmeasured(result: CampaignResult) -> bool:
    """True when no cell failed but some cell was not run or blocked: the spec is skipped, never passed."""
    return verdict_of(result) in ("not_run", "blocked")


def describe(result: CampaignResult) -> str:
    """Every cell that did not pass, and why: its error, each failing block with its evidence, its end state."""
    verdicts = [verdict_of(cell) for cell in result.cells]
    not_run, blocked = verdicts.count("not_run"), verdicts.count("blocked")
    unscored = ", ".join(
        part for part in (f"{not_run} not run" if not_run else "", f"{blocked} blocked" if blocked else "") if part
    )
    scored = len(verdicts) - not_run - blocked
    lines = [
        f"campaign {result.campaign_id}: {verdicts.count('pass')} of {scored} cells pass"
        + (f" ({unscored})" if unscored else "")
    ]
    for cell in result.cells:
        verdict = verdict_of(cell)
        if verdict == "pass":
            continue
        state = {"not_run": "not run", "blocked": "blocked"}.get(verdict, cell.state)
        lines.append(f"{cell.spec_id} on {cell.target}, mode {cell.mode}, repeat {cell.repeat}: {state}")
        lines += describe_cell(cell)
    return "\n".join(lines)


def describe_cell(cell: Cell) -> list[str]:
    lines = []
    if cell.error:
        lines.append(f"  error: {cell.error}")
    for block in cell.blocks:
        verdict = verdict_of(block)
        if verdict == "pass":
            continue
        name = f"block {block.index}" + (f" ({block.block_id})" if block.block_id else "")
        if verdict != "fail":
            lines.append(f"  {name} {block.reason}")
            continue
        lines.append(f"  {name} failed")
        for verdict in block.failing:
            lines.append(f"    {verdict.id} {verdict.outcome}: {verdict.evidence}")
    if cell.end_state is not None and not cell.end_state.match:
        for entry in cell.end_state.diff:
            lines.append(f"  end state {entry.get('field')}: expected {entry.get('expected')!r}, observed {entry.get('observed')!r}")
    return lines
