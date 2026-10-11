#!/bin/sh
# Adds a reminder when the owner types stop. Enforces: R10
input=$(cat)
case "$input" in
  *'"prompt":"stop"'*|*'"prompt": "stop"'*)
    echo '{"additionalContext": "The user said stop: stop all work and confirm in one line."}'
    ;;
esac
exit 0
