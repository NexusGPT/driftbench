---
name: invoice-reconcile
description: Reconcile a supplier invoice against its purchase order and the goods received. Use when the user asks to check, match or reconcile an invoice.
allowed-tools: Read, Edit, Bash(python3 *)
---

# Invoice reconcile

1. Read `references/matching-rules.md` before matching any line.
2. When the invoice is not in EUR, read `references/currency-table.md` to convert every amount.
3. Run `python3 scripts/reconcile.py <invoice> <order>` and show the summary it prints.
4. Never change an amount on an invoice; report the difference instead.
5. When the total difference is above 50.00 EUR, dispatch the `ledger-auditor` agent with the invoice number and the order number.
6. End with one line per invoice: matched, short or over, and the amount.
