#!/bin/sh
# Runs the experiment driver on the typesafe route. JEV_SCRATCH holds the raw cassette and the call counter.
cd "$(dirname "$0")/.." || exit 1
export JEV_ROUTE=typesafe
export JEV_SCRATCH="${JEV_SCRATCH:-/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-jev-ids/scratch}"
exec pnpm exec tsx jev-experiments/run.ts "$@"
