#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
set -e
CORPUS=3 pnpm exec tsx jev-experiments/dumpfeat.ts
CORPUS=5 pnpm exec tsx jev-experiments/dumpfeat.ts
pnpm exec tsx jev-experiments/xhead.ts
CORPUS=5 pnpm exec tsx jev-experiments/an24.ts J1 > /dev/null
CORPUS=5 pnpm exec tsx jev-experiments/an24.ts Jx > /dev/null
echo finished
