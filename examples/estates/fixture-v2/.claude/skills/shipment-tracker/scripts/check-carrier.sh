#!/bin/sh
# A guard for the shipment tracker: a call to track.sh needs a carrier code.
# Reads the tool call as JSON on stdin; exits 2 with a message to block it.
input=$(cat)
case "$input" in
  *track.sh\ [A-Z][A-Z][A-Z]\ *) exit 0 ;;
  *track.sh*)
    echo "Always pass the carrier code to track.sh" >&2
    exit 2
    ;;
esac
exit 0
