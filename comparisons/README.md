# Comparisons

Scripts that measure driftbench against a competitor on the same input. Each topic folder holds the scripts that produced one entry of the comparison log, and the numbers they print. Run every script from the repository root. Each script finds its own files from its location, so it also runs from its own folder.

## Python scripts: a venv with the competitor installed

The competitor is inspect_ai 0.3.278 (the Python package from the UK AI Security Institute). Install it once in a venv of your own:

```bash
python3 -m venv .venv-inspect
.venv-inspect/bin/pip install inspect-ai==0.3.278
```

Run a Python script with that interpreter: `.venv-inspect/bin/python comparisons/inspect/reducers/reducer-measure.py`. The eval-based sandbox script uses the mock model, so it makes no paid call.

## TypeScript scripts: the repository's own packages

Install the repository's dependencies (`pnpm install`), then run with `tsx`: `npx tsx comparisons/inspect/reducers/reducer-measure-ours.ts`.

## Topics

| Folder (under comparisons/inspect/) | Compares | Scripts | Makes a paid call |
|---|---|---|---|
| `reducers/` | mode, median, at_least and pass^k on the same repeat lists | `reducer-measure.py` (inspect_ai), `reducer-measure-ours.ts` | no |
| `sandbox/` | command output bound: a 20 MB command in each sandbox | `sandbox-measure.py` (inspect_ai, mock model), `sandbox-measure-ours.mts` | no |
| `intervals/` | coverage of the pass^k and pass@k intervals by simulation | `coverage-sim.mts [raw\|widened]` | no |
| `panel/` | plain majority against a calibrated, abstaining weighted panel | `panel-sim.mts` (simulation), `panel-measure.mts` (the calibration cassette) | no |
| `grader-prompt/` | the competitor's closed-question GRADE format against our JSON contract, through the claude command | `grader-probe.mts ours\|theirs [out.json]` | yes, about 0.04 USD for both variants |

The grader probe needs the `claude` command on the path, or `CLAUDE_BIN` set to its location. It writes its answers to `./out/`. Its spend is recorded in the spend ledger of the harvest lane, not in this repository.

## Reading the output

Each script prints one line per case or one JSON summary. The entries in the comparison log quote those numbers and name the script that printed them.
