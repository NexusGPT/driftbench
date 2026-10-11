#!/usr/bin/env python3
"""Blocks an Edit or a Write on a file the session has not read. Enforces: R3, R5"""
import json
import sys

event = json.load(sys.stdin)
path = event.get("tool_input", {}).get("file_path", "")
read = set(event.get("session_reads", []))
if path and path not in read:
    print("Read a file before you edit it.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
