---
name: invoice-reconciliation
description: Matches a list of invoices with a list of bank payments and reports what is unpaid or unexplained.
---

# Invoice reconciliation

A reconciliation answers two questions: which invoices have been paid, and which payments have no invoice. The partners read the answer before they chase a client.

## What you need

You need the invoice list, the bank export and the date to reconcile up to. The invoice list comes from the accounting package and the bank export from the bank.

If one of the three is missing, ask for it and do not begin. A reconciliation on half the data misleads everyone.

## Matching rules

Match in three passes, from the strongest rule to the weakest:

1. Same amount and same invoice number in the description
2. Same amount and same client name
3. Same amount within three days of the due date

A payment can match only one invoice. Once a payment is matched, take it out of the pool.

Do not match on the amount alone. Two invoices of the same amount are common in a small shop.

## Partial payments

A client may pay an invoice in two parts. If two payments from the same client add up exactly to an invoice, match both to it.

If the sum is close but not exact, do not match. List the case under questions for the bookkeeper.

## Output sheets

The workbook has four sheets: matched, unpaid, unexplained and questions.

| Sheet | Holds | Sorted by |
|---|---|---|
| matched | Invoices with their payments | Invoice date |
| unpaid | Invoices with no payment | Days overdue, largest first |
| unexplained | Payments with no invoice | Date |
| questions | Cases you could not decide | Amount, largest first |

## Overdue days

Count the days overdue from the due date to the reconciliation date. If the due date is missing, use the invoice date plus thirty days and say so.

Do not write a chasing message for the client. The bookkeeper decides how to approach a client.

## Checks

Before you save, check that the total of the matched sheet plus the unpaid sheet equals the total of the invoice list. Check the same for the payments with the matched and unexplained sheets.

If a total differs, find the row that is missing or counted twice. Do not hide the difference in a rounding line.

## An example

Example: invoice 2041 for 480.00 euros was paid in two payments of 240.00 on the 3rd and the 9th. Both payments went to the matched sheet under invoice 2041.

## Notes on clients

Some clients pay several invoices in one transfer. The description then lists the invoice numbers. Split such a payment between the invoices in the order the numbers appear.

Remember that one client pays on the last day of the month, whatever the due date.

Good luck.
