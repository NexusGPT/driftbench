---
name: invoice-reconciliation{{n}}
description: Matches a list of invoices with a list of bank payments and reports what is unpaid or unexplained.{{d}}
---

# Invoice reconciliation{{n}}

A reconciliation answers two questions: which invoices have been paid, and which payments have no invoice.{{d}} The partners read the answer before they chase a client.{{d}}

## What you need{{n}}

You need the invoice list, the bank export and the date to reconcile up to.{{d}} The invoice list comes from the accounting package and the bank export from the bank.{{d}}

If one of the three is missing, ask for it and do not begin.{{r#a}} A reconciliation on half the data misleads everyone.{{r#a}}

## Matching rules{{n}}

Match in three passes, from the strongest rule to the weakest:{{g#b}}

1. Same amount and same invoice number in the description{{g#b}}
2. Same amount and same client name{{g#b}}
3. Same amount within three days of the due date{{g#b}}

A payment can match only one invoice.{{d}} Once a payment is matched, take it out of the pool.{{r}}

Do not match on the amount alone.{{p}} Two invoices of the same amount are common in a small shop.{{d}}

## Partial payments{{n}}

A client may pay an invoice in two parts.{{d}} If two payments from the same client add up exactly to an invoice, match both to it.{{r}}

If the sum is close but not exact, do not match.{{p}} List the case under questions for the bookkeeper.{{r}}

## Output sheets{{n}}

The workbook has four sheets: matched, unpaid, unexplained and questions.{{d}}

| Sheet{{n}} | Holds{{n}} | Sorted by{{n}} |
|---|---|---|
| matched{{d}} | Invoices with their payments{{d}} | Invoice date{{d}} |
| unpaid{{d}} | Invoices with no payment{{d}} | Days overdue, largest first{{d}} |
| unexplained{{d}} | Payments with no invoice{{d}} | Date{{d}} |
| questions{{d}} | Cases you could not decide{{d}} | Amount, largest first{{d}} |

## Overdue days{{n}}

Count the days overdue from the due date to the reconciliation date.{{r}} If the due date is missing, use the invoice date plus thirty days and say so.{{r}}

Do not write a chasing message for the client.{{p}} The bookkeeper decides how to approach a client.{{d}}

## Checks{{n}}

Before you save, check that the total of the matched sheet plus the unpaid sheet equals the total of the invoice list.{{g}} Check the same for the payments with the matched and unexplained sheets.{{r}}

If a total differs, find the row that is missing or counted twice.{{r}} Do not hide the difference in a rounding line.{{p}}

## An example{{n}}

Example: invoice 2041 for 480.00 euros was paid in two payments of 240.00 on the 3rd and the 9th.{{e}} Both payments went to the matched sheet under invoice 2041.{{e}}

## Notes on clients{{n}}

Some clients pay several invoices in one transfer.{{d}} The description then lists the invoice numbers.{{d}} Split such a payment between the invoices in the order the numbers appear.{{r}}

Remember that one client pays on the last day of the month, whatever the due date.{{d}}

Good luck.{{n}}
