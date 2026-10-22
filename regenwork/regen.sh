#!/bin/bash
set -u
F=examples/estates/fixture
V=examples/estates/fixture-v2
P=packages/generate/test/estate/fixtures
T=$(mktemp -d)
echo "== 1 scan"; pnpm -s driftbench estate scan $F --runtime claude-code --pointer --cassette $F/cassette.jsonl --ledger $F/ledger.json --out $F/map.yaml --force 2>&1 
echo "== 2 approve"; cp $F/map.yaml $F/approved.yaml; pnpm -s driftbench estate approve $F/approved.yaml --all 2>&1 | tail -2
pnpm -s driftbench estate map $F/approved.yaml --to $F/space.yaml --agent northwind 2>&1 | tail -2
HASH=$(grep -m1 '^hash:' $F/approved.yaml | cut -d' ' -f2)
perl -pi -e "s/^mapHash: \S+/mapHash: $HASH/" $F/phrases.yaml $P/plan.yaml
perl -pi -e "s/MAP_HASH = '[0-9a-f]+'/MAP_HASH = '$HASH'/" packages/adapters/test/claude-code/live/support.ts
echo "== 4 plan"; pnpm -s driftbench estate map $F/approved.yaml --to $T/space.yaml --agent estate 2>&1 | tail -1
pnpm -s driftbench estate plan $F/approved.yaml --out $F/plan.yaml --space $T/space.yaml --force 2>&1 | tail -3
echo "== 5 plan approve"; head -3 $P/planner-plan.approved.yaml > $T/notes.txt
pnpm -s driftbench estate plan approve $F/plan.yaml --all --out $T/approved-plan.yaml 2>&1 | tail -1
cat $T/notes.txt $T/approved-plan.yaml > $P/planner-plan.approved.yaml
echo "== 6 generate"; pnpm -s driftbench estate generate --map $F/approved.yaml --plan $P/planner-plan.approved.yaml --out $F/generated --force 2>&1 | tail -6
echo "== 7 v2"; cp $F/ledger.json $V/ledger.json; pnpm -s driftbench estate scan $V --runtime claude-code --pointer --cassette $V/cassette.jsonl --ledger $V/ledger.json --update --out $V/map.yaml --force 2>&1 
pnpm -s driftbench estate diff $F/approved.yaml $V/map.yaml --old-guards $V/maintain/guard-state.v1.yaml --old-ledger $F/ledger.json --new-ledger $V/ledger.json --out $V/maintain/diff.json > $V/maintain/diff.txt 2>&1
pnpm -s driftbench estate impact $V/maintain/diff.json --tests $V/tests > $V/maintain/impact.txt 2>&1
pnpm -s driftbench estate impact $V/maintain/diff.json --tests $V/tests --out $V/maintain/impact.json > /tmp/impact-json.log 2>&1
pnpm exec biome format --write $V/maintain/diff.json $V/maintain/impact.json 2>&1 | tail -1
echo "== 8 reader-cases"; R=examples/estates/reader-cases
pnpm -s driftbench estate scan $R --runtime claude-code --pointer --cassette $R/cassette.jsonl --out $R/map.yaml --force 2>&1 
cp $R/map.yaml $R/approved.yaml; pnpm -s driftbench estate approve $R/approved.yaml --all 2>&1 | tail -1
rm -rf "$T"
echo done
