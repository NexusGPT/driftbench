"""Builds the Acme price sheet from the catalog. Usage: python build_sheet.py <catalog.csv> <out.xlsx>"""
import csv
import sys

from openpyxl import Workbook

SHEETS = {"mobile": "Mobile", "home": "Home"}
HEADER = ["Plan", "Allowance", "Monthly price (USD)"]


def main(source, target):
    book = Workbook()
    book.remove(book.active)
    with open(source, newline="") as handle:
        rows = list(csv.DictReader(handle))
    for category, title in SHEETS.items():
        sheet = book.create_sheet(title)
        sheet.append(HEADER)
        for row in rows:
            if row["category"] == category:
                sheet.append([row["name"], row["allowance"], int(row["monthly_usd"])])
    book.save(target)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
