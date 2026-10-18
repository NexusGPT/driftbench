"""Blast-radius audit of schema_version (PR 431) in the Python client: a spec written for a newer format is
refused by the CLI with the upgrade message, which reaches the caller as a DriftbenchError, exit 2."""

import pytest

from driftbench import DriftbenchError, run_specs
from driftbench.pytest_plugin import spec_id


def test_a_newer_spec_is_refused_with_the_upgrade_message(tmp_path=None):
    import tempfile
    from pathlib import Path

    folder = Path(tmp_path) if tmp_path is not None else Path(tempfile.mkdtemp())
    spec = folder / "newer.yaml"
    spec.write_text("schema_version: 2\nid: newer\nfuture_key: 1\nblocks:\n  - user: Hi\n")
    # The plugin still collects it as a spec: the refusal comes from the CLI, with the fix.
    assert spec_id(spec) == "newer"
    with pytest.raises(DriftbenchError) as raised:
        run_specs([str(spec)], target="function:acme", store=str(folder / "c.db"))
    assert raised.value.exit_code == 2
    assert "upgrade driftbench" in str(raised.value)
