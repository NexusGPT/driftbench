#!/usr/bin/env bash
# The body of the driftbench ci composite action. It reads its inputs from INPUT_* variables, runs
# `driftbench ci`, writes the verdict and the report path to $GITHUB_OUTPUT and exits with the CLI's code:
# 0 parity, 1 regression, gating flag or incomplete run, 2 bad input.
set -uo pipefail

: "${INPUT_SPECS:?the specs input is required}"
: "${INPUT_TARGET:?the target input is required}"
: "${INPUT_BASELINE:?the baseline input is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set: run this inside a GitHub Actions step}"

store="${INPUT_STORE:-.driftbench/ci.db}"
report="${INPUT_REPORT_PATH:-driftbench-ci.json}"

read -r -a cli <<< "${INPUT_DRIFTBENCH:-pnpm -s driftbench}"
args=(
  ci
  --specs "$INPUT_SPECS"
  --target "$INPUT_TARGET"
  --baseline "$INPUT_BASELINE"
  --store "$store"
  --margin "${INPUT_MARGIN:-2}"
  --repeats "${INPUT_REPEATS:-1}"
  --mode "${INPUT_MODE:-F}"
  --out "$report"
)
if [ -n "${INPUT_BUDGET_USD:-}" ]; then args+=(--budget-usd "$INPUT_BUDGET_USD"); fi
if [ -n "${INPUT_FAULTS:-}" ]; then args+=(--faults "$INPUT_FAULTS"); fi

code=0
"${cli[@]}" "${args[@]}" || code=$?

verdict=input-error
if [ "$code" -ne 2 ] && [ -f "$report" ]; then
  verdict=$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).verdict))' "$report")
  node_code=$?
  if [ "$node_code" -ne 0 ]; then
    echo "driftbench ci action: cannot read the verdict from $report (exit $node_code)" >&2
    exit "$node_code"
  fi
fi

{
  echo "verdict=$verdict"
  echo "report-path=$report"
} >> "$GITHUB_OUTPUT"

echo "driftbench ci: verdict $verdict, exit $code, summary $report"
exit "$code"
