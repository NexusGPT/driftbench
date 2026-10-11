#!/usr/bin/env python3
"""Reconcile one invoice against one purchase order.

Usage: python3 reconcile.py <invoice.csv> <order.csv>
Prints one line per article: matched, short or over, and the difference in EUR.
Exits 0 when every line matches, 1 when a line differs, 2 on a usage error.
"""
import csv
import sys


def load(path):
    with open(path, newline="") as handle:
        return {row["article"]: (int(row["quantity"]), float(row["unit_price"])) for row in csv.DictReader(handle)}


def main(argv):
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    invoice, order = load(argv[1]), load(argv[2])
    differs = False
    for article in sorted(set(invoice) | set(order)):
        got = invoice.get(article, (0, 0.0))
        want = order.get(article, (0, 0.0))
        difference = got[0] * got[1] - want[0] * want[1]
        state = "matched" if abs(difference) < 0.05 else ("over" if difference > 0 else "short")
        differs = differs or state != "matched"
        print(f"{article}: {state} {difference:.2f} EUR")
    return 1 if differs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
