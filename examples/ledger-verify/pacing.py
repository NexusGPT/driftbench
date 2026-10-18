"""Runtime-only Haiku admission limit, independent of model verdicts and parsing."""
import datetime
import json
import os
from pathlib import Path
import re
import time


def transport_failure(message):
    if re.search(r'output token maximum|MAX_TOKENS|unparsed|parse error|invalid JSON|schema validation', message, re.I):
        return False
    return bool(re.search(r'ENOTFOUND|EAI_AGAIN|ECONN\w*|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|fetch failed|network error|socket error|ran past \d+ ms|timed? out|rate limit|overloaded|(?:HTTP|API Error:)\s*(?:408|429|5\d\d)', message, re.I))


def decide(load, failures):
    return 2 if load > 60 or failures >= 2 else 4


def observe(receipt_dir, clock=None, load=None):
    clock = time.time() if clock is None else clock
    load = os.getloadavg()[0] if load is None else load
    path = Path(receipt_dir) / 'errors.jsonl'
    failures = []
    if path.exists():
        for line in path.read_text().splitlines():
            row = json.loads(line)
            if row.get('model') != 'haiku':
                continue
            age = clock - datetime.datetime.fromisoformat(row['at'].replace('Z', '+00:00')).timestamp()
            if not 0 <= age <= 600:
                continue
            message = row.get('message', '')
            native_path = row.get('nativeReceipt')
            if native_path and Path(native_path).exists():
                try:
                    native = json.loads(Path(native_path).read_text())
                    if native.get('is_error'):
                        message += '\n' + str(native.get('result', ''))
                except json.JSONDecodeError:
                    pass  # A parse failure does not lower pacing.
            if transport_failure(message):
                failures.append(row['id'])
    return dict(observedAt=clock, loadOneMinute=load, recentTransportFailureIds=failures,
                windowSeconds=600, limit=decide(load, len(failures)))
