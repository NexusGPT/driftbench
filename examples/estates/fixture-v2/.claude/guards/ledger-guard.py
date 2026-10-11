#!/usr/bin/env python3
"""Warns after a command that removed a file under ledger/."""
import json
import sys

event = json.load(sys.stdin)
command = event.get("tool_input", {}).get("command", "")
if "rm " in command and "ledger/" in command:
    print("never delete a file under ledger/; move it to ledger/archive/ instead", file=sys.stderr)
    sys.exit(1)
sys.exit(0)
