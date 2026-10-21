#!/usr/bin/env python3
"""Reconcile one invoice against one purchase order.

Usage: python3 reconcile.py <invoice> <order>
Each file is a .json file with a list of lines, or a CSV file with the columns article, quantity, unit_price.
Prints one line per article: matched, short or over, and the difference in EUR.
A line matches when the quantities are equal and the unit prices differ by less than 0.05 EUR (rounding).
Exits 0 when every line matches, 1 when a line differs, 2 on a usage error or a missing or invalid JSON lines list.
"""
import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import sys
from decimal import Decimal

ROUNDING = Decimal("0.05")


class InputShapeError(ValueError):
    pass


def load(path):
    with open(path, newline="") as handle:
        if path.endswith(".json"):
            data = json.load(handle)
            if not isinstance(data, dict) or not isinstance(data.get("lines"), list):
                raise InputShapeError(
                    f"{path}: missing or invalid 'lines'; expected a JSON object with a 'lines' list "
                    "of {article, quantity, unit_price} records"
                )
            rows = data["lines"]
        else:
            rows = list(csv.DictReader(handle))
    return {row["article"]: (int(row["quantity"]), Decimal(str(row["unit_price"]))) for row in rows}


def compare(got, want):
    if got[0] == want[0] and abs(got[1] - want[1]) < ROUNDING:
        return "matched", Decimal("0")
    difference = got[0] * got[1] - want[0] * want[1]
    if got[0] != want[0]:
        return ("over" if got[0] > want[0] else "short"), difference
    return ("over" if difference > 0 else "short"), difference


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    try:
        invoice, order = load(argv[1]), load(argv[2])
    except InputShapeError as error:
        print(error, file=sys.stderr)
        return 2
    differs = False
    for article in sorted(set(invoice) | set(order)):
        state, difference = compare(invoice.get(article, (0, Decimal("0"))), order.get(article, (0, Decimal("0"))))
        differs = differs or state != "matched"
        print(f"{article}: {state} {difference:.2f} EUR")
    return 1 if differs else 0


def log_execution():
    # The fixture's trusted location defines the workspace; command environment cannot redirect this log.
    path = Path(__file__).resolve().parents[4] / ".claude/northwind/reconcile-executions.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"id": uuid4().hex, "at": datetime.now(timezone.utc).isoformat()}) + "\n")


if __name__ == "__main__":
    log_execution()
    sys.exit(main(sys.argv))
