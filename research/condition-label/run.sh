#!/bin/bash
# usage: run.sh <labels.yaml> <tag>
export ANTHROPIC_API_KEY=$(cat ~/.nexus-secrets/anthropic-driftbench.key)
cd /tmp/pcc; rm -rf e_$2 && cp -R est e_$2 && cp $1 e_$2/labels.yaml
R=/Users/assem/driftbench-lanes/pointer-chain/repo
$R/node_modules/.bin/tsx $R/packages/cli/src/bin.ts estate scan e_$2 --pointer --labels e_$2/labels.yaml --labeler system2:anthropic --cassette e_$2/c.jsonl --record --out e_$2/map.yaml > out_$2.txt 2>&1
echo "$2 exit $? $(grep -c '^ *refused:' out_$2.txt) refused; $(grep Requests out_$2.txt)"
