#!/bin/bash
# Network-pause supervisor (amendment 8). One model cell at a time, concurrency 2.
# Gate: 10 consecutive healthy provider probes, 30 s apart, before every run.
# The driver stops itself on 3 consecutive connection failures; then wait 10 minutes and gate again.
# Items with no model output are asked again in later cycles; an answered call is never re-sent.
# Keys load inside each command and are never printed.
cd "$(dirname "$0")" || exit 1
TSX=../../node_modules/.bin/tsx
probe() {
  local code
  if [ "$1" = gpt-6.1-sol ]; then
    code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' -H "authorization: Bearer $(cat ~/.nexus-secrets/openai.key)" https://api.openai.com/v1/models/gpt-6.1-sol 2>&1)
    [ "$code" = 200 ]
  else
    code=$(curl -sS -m 20 -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models 2>&1)
    case "$code" in 2??|4??) true ;; *) false ;; esac
  fi
}
gate() {
  local ok=0
  while [ $ok -lt 10 ]; do
    [ -e stop ] && { echo "STOP_FILE during gate"; return 1; }
    if probe "$1"; then ok=$((ok + 1)); else echo "probe failed for $1 at $(date -u +%T), count reset"; ok=0; fi
    [ $ok -lt 10 ] && sleep 30
  done
  echo "gate passed for $1 at $(date -u +%FT%TZ)"
}
pending() {
  OPENAI_API_KEY=offline $TSX run-test.mts --phase test --model "$1" --plan 2>&1 | tail -1 | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["pendingDecisions"])'
}
answered() { grep -c '"response"' "cells/$1/calls.jsonl" 2>&1; }
for model in "$@"; do
  idle=0
  while :; do
    left=$(pending "$model")
    echo "== $model pending decisions: $left at $(date -u +%FT%TZ)"
    [ "$left" = 0 ] && break
    gate "$model" || exit 3
    before=$(answered "$model")
    if [ "$model" = gpt-6.1-sol ]; then
      out=$(OPENAI_API_KEY="$(cat ~/.nexus-secrets/openai.key)" $TSX run-test.mts --phase test --model "$model" --workers 2 2>&1 | tail -3)
    else
      out=$($TSX run-test.mts --phase test --model "$model" --workers 2 2>&1 | tail -3)
    fi
    echo "$out"
    case "$out" in
      *STOP_FILE*|*BUDGET_CAP*|*LAST_CALL_CUTOFF*|*PROVIDER_PAYMENT_STOP*|*FREEZE_DRIFT*) echo "== $model halted"; exit 2 ;;
      *LINK_PAUSE*) echo "== $model link pause, 10 minutes"; sleep 600 ;;
    esac
    after=$(answered "$model")
    if [ "$after" = "$before" ]; then idle=$((idle + 1)); else idle=0; fi
    [ $idle -ge 5 ] && { echo "== $model made no progress in 5 cycles, halted"; exit 4; }
  done
  echo "== $model complete at $(date -u +%FT%TZ)"
done
echo "== all cells complete"
