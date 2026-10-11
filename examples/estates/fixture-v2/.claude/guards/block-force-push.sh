#!/bin/sh
# Blocks a force push. Enforces: R6
input=$(cat)
case "$input" in
  *"git push --force"*|*"git push -f"*)
    echo "Never run git push --force on any branch." >&2
    exit 2
    ;;
esac
exit 0
