---
name: weekly-report
description: Prepare the weekly operations report from the ledger and the shipment log. Use when the user asks for the weekly report or a summary of last week.
allowed-tools: Read, Write, Edit, Bash(python3 *)
---

# Weekly report

!! Before writing the report: Read `templates/report.md` !!

Fill the template in this order: invoices reconciled, shipments late, supplier emails sent, open questions.
Count only what the ledger and the shipment log show for the last seven days. Read
`references/kpi-definitions.md` when a number needs a definition. Save the report as
`reports/<year>-W<week>.md` and never overwrite an earlier week.
