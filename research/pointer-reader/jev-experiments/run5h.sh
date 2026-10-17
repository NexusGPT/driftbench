#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
export CORPUS=5 JEV_SCRATCH=/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-jev-ids/scratch4
pnpm exec tsx jev-experiments/run5h.ts 2 3 2>&1
