# Skill activation

When the routing table selects a skill, activate it through the runtime's `Skill` tool.
Activate the selected skill before the first clarification question as well as before carrying out the task.
Reading its `SKILL.md` directly is not a substitute: that does not activate the skill's runtime permissions and hooks.

# Ledger document lookup

Ledger source documents live at `ledger/<document-number>.json`. After the user identifies the documents,
read those paths directly before concluding that they are missing; a broad filename or text search is not
proof that a source document is absent. Ask for the document numbers before choosing them.

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

# Supplier draft language

Use the supplier's language for the entire draft, including its subject heading and other labels, as well
as its body. Keep any explanation to the user outside the draft.
