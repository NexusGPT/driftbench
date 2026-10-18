# Inspect comparison: how to reproduce each claim

Every claim in the Inspect comparison table is reproduced by one command here, from this repository. The competitor is inspect_ai 0.3.278 (MIT, UK AI Security Institute). Its Python scripts need a venv of their own:

```bash
python3 -m venv .venv-inspect
.venv-inspect/bin/pip install inspect-ai==0.3.278
```

Run every command from the repository root. TypeScript scripts run with `npx tsx`, after `pnpm install`. Scripts marked **paid** call a model through the `claude` command: set `CLAUDE_BIN` if it is not on the path, and budget before running them. Recorded results of the paid runs are kept under the topic folders, so the table can be checked without spending anything.

## One command per row

| Table row | Command | Makes a paid call |
|---|---|---|
| Model-graded QA prompt | `FACT_SET=hard npx tsx comparisons/inspect/fact-check/fact-probe.mts ours` (and `theirs`) | paid (recorded: `fact-check/results/fact-hard-*.json`) |
| Fact template, multi-part | `FACT_SET=multi npx tsx comparisons/inspect/fact-check/fact-probe.mts ours` (and `theirs`) | paid (recorded: `fact-check/results/fact-multi-*.json`) |
| GRADE verdict parse | `npx vitest run packages/judges/test/contract-parse.test.ts` | no |
| Grader panel, clean council (12 criteria) | `SPLIT=all npx tsx comparisons/inspect/panel/council-measure.mts` | no (replays `panel/data/claude-council.cassette.json`) |
| Grader panel, simulation | `npx tsx comparisons/inspect/panel/panel-sim.mts` | no |
| Grader panel, borderline blocks | `npx tsx comparisons/inspect/council-borderline/compare.mts` | no (reads the recorded answers) |
| Borderline recording itself | `npx tsx comparisons/inspect/council-borderline/record.mts <haiku\|sonnet\|opus>` | paid (recorded: `council-borderline/recorded-*.json`) |
| mode reducer | `.venv-inspect/bin/python comparisons/inspect/reducers/mode-extra.py` and `npx vitest run packages/stats/test/repeat-reducers.test.ts` | no |
| median, at_least, pass^k values | `.venv-inspect/bin/python comparisons/inspect/reducers/reducer-measure.py` and `npx tsx comparisons/inspect/reducers/reducer-measure-ours.ts` | no |
| pass^k on incomplete runs | `.venv-inspect/bin/python comparisons/inspect/intervals/passk-incomplete.py` and `npx tsx comparisons/inspect/intervals/passk-incomplete-ours.mts` | no |
| pass@k on short samples | `.venv-inspect/bin/python comparisons/inspect/intervals/passat-measure.py` and `npx tsx comparisons/inspect/intervals/short-sample-ours.mts` | no |
| pass^k and pass@k interval coverage | `npx tsx comparisons/inspect/intervals/coverage-sim.mts widened` (and `raw`) | no |
| Output bound, 20 MB command | `.venv-inspect/bin/python comparisons/inspect/sandbox/sandbox-measure.py` and `npx tsx comparisons/inspect/sandbox/sandbox-measure-ours.mts` | no |
| Read path confinement | `.venv-inspect/bin/python comparisons/inspect/sandbox/sandbox-isolation.py` and `npx tsx comparisons/inspect/sandbox/read-ours.mts` | no |
| Read bound on a 150 MB FIFO | `.venv-inspect/bin/python comparisons/inspect/sandbox/fifo-read.py` and `npx tsx comparisons/inspect/sandbox/read-bound-stream-ours.mts` | no |
| Built-in scorers | `.venv-inspect/bin/python comparisons/inspect/scorers/scorers-measure.py` and `npx tsx comparisons/inspect/scorers/scorers-ours.mts` | no |
| Per-sample lifecycle: folder left after an unclean exit | `npx tsx comparisons/inspect/lifecycle/leak-probe.mts` (prints `leftAfterUncleanExit`; 1 before the cleanup change, 0 after) | no |
| Per-sample lifecycle: command outliving its process | `npx tsx comparisons/inspect/lifecycle/orphan-probe.mts` (prints `survivingCommands`; 1 before, 0 after) | no |
| Container network default | `npx vitest run packages/sandbox/test/docker.test.ts` (mocked docker only; no docker on the host it was built on) | no |
| Tool approval, HTTP chat path | `npx vitest run packages/adapters/test/http.test.ts` | no |
| Resume, killed run | `npx vitest run packages/core/test/runner/resume.test.ts` | no |
| Event timeline | `npx vitest run packages/cli/test/view.test.ts` | no |
| Fact-check (cost) | the recorded totals in `fact-check/results/` | no |

## Files

- `fact-check/` — the probe, its labelled case sets (easy, hard, multi-part) and the recorded results.
- `council-borderline/` — 20 hand-labelled borderline blocks (`labels/`), the recorded answers of haiku, sonnet and opus, the recording script and the comparison script.
- `panel/` — the panel simulation and measurements; `data/` holds the council cassette and the recorded outputs.
- `reducers/`, `intervals/`, `sandbox/`, `scorers/`, `lifecycle/` — the probes named in the table above.

## Limits of these results

- The Inspect scripts run inspect_ai 0.3.278 with its mock model where a model is needed. The paid probes use haiku, sonnet and opus through the claude command, not any other provider.
- The mocked docker tests check the flag on the command line, not enforcement by a docker daemon.
- The lifecycle probes measure the cases listed; SIGKILL is not among them, and no unclean docker exit is measured.
