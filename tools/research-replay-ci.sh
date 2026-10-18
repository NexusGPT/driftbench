#!/usr/bin/env bash
# Runs both research replays offline. Each replay asserts the public decoder against its own
# simulation and the frozen recordings, and the job fails on any assertion or any break.
# The regenerated snapshots are discarded: the committed ones are frozen on purpose and their
# unit tests carry the rows that later main changes moved.
# Needs full git history (the replays read old commits) and a clean tree. Zero model calls.
set -euo pipefail
cd "$(dirname "$0")/.."
RECORDING=d25cc282013bcb170d7bd6e0c4ab0fdc6c4fa85d
REPLAY_OUT=(
  packages/judges/test/fixtures/criterion-decoder-recordings.json.gz
  research/default-decoder-ungrounded/results.json
  packages/judges/test/fixtures/evidence-source-alias-recordings.json.gz
  research/evidence-source-alias/results.json
)
git cat-file -e "$RECORDING^{commit}" || { echo "commit $RECORDING missing: fetch full history"; exit 1; }
[ -z "$(git status --porcelain -- "${REPLAY_OUT[@]}")" ] || { echo "snapshot files are not clean"; exit 1; }
BENCH_FRAME="$(mktemp -d)/bench-frame"
git worktree add --detach "$BENCH_FRAME" "$RECORDING" >/dev/null
trap 'git worktree remove --force "$BENCH_FRAME"; git checkout -- "${REPLAY_OUT[@]}"' EXIT

echo "== default-decoder-ungrounded replay.mts (assertions, zero breaks)"
BENCH_FRAME="$BENCH_FRAME" npx tsx research/default-decoder-ungrounded/replay.mts >/dev/null
node -e "
const r=JSON.parse(require('fs').readFileSync('research/default-decoder-ungrounded/results.json','utf8'));
const bad=r.summaries.filter((s)=>s.breaks>0);
if(bad.length){console.error('breaks in',bad.map((s)=>s.set));process.exit(1)}"
git checkout -- "${REPLAY_OUT[@]}"

echo "== evidence-source-alias replay.mts (assertions, zero breaks)"
npx tsx research/evidence-source-alias/replay.mts "$RECORDING" >/dev/null
node -e "
const r=JSON.parse(require('fs').readFileSync('research/evidence-source-alias/results.json','utf8'));
const bad=r.summaries.filter((s)=>s.breaks>0);
if(bad.length){console.error('breaks in',bad.map((s)=>s.set));process.exit(1)}"
echo "research replays: ok"
