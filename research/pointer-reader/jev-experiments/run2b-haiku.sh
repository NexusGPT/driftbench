#!/bin/sh
cd "/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-jev-ids/wt4/research/pointer-reader/jev-experiments/.." || exit 1
export JEV_SCRATCH=/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-jev-ids/scratch4
export GOLD2_FILE=gold2b.json HAIKU_GUIDE=GUIDE.md HAIKU_PREFIX=haiku2b HAIKU_CASSETTE_RAW=cassette2b-haiku.raw.jsonl HAIKU_BUDGET=budget2b-haiku.json
pnpm exec tsx jev-experiments/run2h.ts 1 2 3 2>&1
