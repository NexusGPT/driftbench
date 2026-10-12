"""Test setup: the driftbench CLI of this repository, run from source, unless DRIFTBENCH_CLI names another."""

import json
import os
from importlib.metadata import entry_points
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).resolve().parent / "fixtures"

pytest_plugins = ["pytester"]

if "DRIFTBENCH_CLI" not in os.environ:
    os.environ["DRIFTBENCH_CLI"] = json.dumps(
        [
            str(REPO / "node_modules" / ".bin" / "tsx"),
            "--tsconfig",
            str(REPO / "tsconfig.json"),
            str(REPO / "packages" / "cli" / "src" / "bin.ts"),
        ]
    )


def plugin_args() -> list:
    """The -p option that loads the plugin, unless an installed package already registers it."""
    installed = any(entry.name == "driftbench" for entry in entry_points(group="pytest11"))
    return [] if installed else ["-p", "driftbench.pytest_plugin"]
