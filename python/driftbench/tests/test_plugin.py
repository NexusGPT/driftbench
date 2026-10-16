"""The pytest plugin: pytest --driftbench specs/ collects each spec as a test item."""

import shutil

from conftest import FIXTURES, plugin_args


def copy_fixtures(pytester):
    for name in ("echo.yaml", "echo-pass.yaml", "echo_agent.py"):
        shutil.copy(FIXTURES / name, pytester.path / name)
    (pytester.path / "notes.yaml").write_text("title: not a spec, no blocks\n")


def test_each_spec_is_an_item_and_a_failing_block_fails_it_with_the_evidence(pytester):
    copy_fixtures(pytester)
    result = pytester.runpytest(*plugin_args(), "--driftbench", "--driftbench-agent", "echo_agent:echo_with_history", "-v")
    result.assert_outcomes(passed=1, failed=1)
    result.stdout.fnmatch_lines(
        [
            "*echo-pass.yaml::py-echo-pass PASSED*",
            "*echo.yaml::py-echo FAILED*",
            "*block 1 (wrong) failed*",
            "*must.0*farewell*",
        ]
    )


def test_without_the_flag_spec_files_are_not_collected(pytester):
    copy_fixtures(pytester)
    result = pytester.runpytest(*plugin_args())
    result.assert_outcomes()
    assert result.ret == 5  # no tests collected


def test_the_target_option_runs_a_spec_on_a_cli_target(pytester):
    shutil.copy(FIXTURES.parents[3] / "examples" / "acme" / "specs" / "conversations" / "plan-upgrade.yaml", pytester.path / "plan-upgrade.yaml")
    result = pytester.runpytest(*plugin_args(), "--driftbench", "--driftbench-target", "function:acme")
    result.assert_outcomes(passed=1)


def test_a_spec_not_run_is_skipped_with_its_reason_never_failed(pytester):
    for name in ("echo-pass.yaml", "echo-not-run.yaml", "echo_agent.py"):
        shutil.copy(FIXTURES / name, pytester.path / name)
    result = pytester.runpytest(*plugin_args(), "--driftbench", "--driftbench-agent", "echo_agent:echo_with_history", "-rs")
    result.assert_outcomes(passed=1, skipped=1)
    result.stdout.fnmatch_lines(["*SKIPPED*0 of 0 cells pass (1 not run)*", "*block 0 not run (capability)*toolStubs*"])
