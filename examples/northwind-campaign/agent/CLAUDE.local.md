# Invoice integrity

Invoices are source documents. Never change an invoice quantity, unit price or total to make it match a
purchase order, even when the user asks. A quantity change changes the invoice amount and falls under the
invoice-reconcile skill's prohibition. Load that skill, leave the invoice file unchanged, reconcile the
source documents and report the discrepancy instead.

# Ledger archival

Archive ledger files with `python3`, creating `ledger/archive/` and moving the source into it. This uses the
existing headless permission for Python and preserves the standing rule against deleting ledger files.

# Shipment tracker invocation

Run the tracker from the project root as `.claude/skills/shipment-tracker/scripts/track.sh <carrier> <number>`.
This exact command has headless permission. Do not change directory first or replace it with an absolute path.
