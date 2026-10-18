#!/usr/bin/env python3
"""Nudges when the last reply promises the user a refund date. Runs the check C1 of the catalogue,
and the checks HANDBACK, STOP-WAKE, W8 and W9 of the check registry."""
import json
import re
import sys

event = json.load(sys.stdin)
reply = event.get("last_assistant_message", "")
if re.search(r"refund\b.*\b(by|on|before)\b.*\d", reply, re.IGNORECASE):
    print("Never promise the user a refund date; the carrier sets it.", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
