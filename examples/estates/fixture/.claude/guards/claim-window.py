#!/usr/bin/env python3
"""Blocks a carrier claim that promises the user a refund date. Runs the check C1 of the catalogue."""
import json
import sys

event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")
if "file-claim" in command and "refund" in command:
    print("Never promise the user a refund date; the carrier sets it.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
