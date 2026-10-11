#!/bin/sh
# Blocks a force push. Runs the check W2 of the check registry.
input=$(cat)
case "$input" in
  *"git push --force"*|*"git push -f"*)
    echo "Never run git push --force on any branch." >&2
    exit 2
    ;;
esac
exit 0
