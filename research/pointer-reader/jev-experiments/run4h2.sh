#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
export JEV_SCRATCH=/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-jev-ids/scratch4
pnpm exec tsx jev-experiments/run4h2.ts nothink 1 2 3 2>&1 && pnpm exec tsx jev-experiments/run4h2.ts low 1 2 3 2>&1
