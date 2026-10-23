---
name: spreadsheet-report
description: Builds the monthly spreadsheet pack for a client from the bank export and the sales export. Use when a bookkeeper asks for the monthly pack.
---

# Spreadsheet report

The monthly pack is the main thing Abacus produces. It has three sheets: summary, bank and sales.

## When to use this skill

Use it when the request says monthly pack, month end or "the usual spreadsheet". Do not use it for a reconciliation; that has its own skill.

## Before you build

Check that you have both exports for the same month. If one is missing, ask for it and stop.

Open the template from the templates folder and copy it into the working folder. Never edit the template itself.

## The three sheets

| Sheet | Contents | Rule |
|---|---|---|
| summary | Totals by category and a comparison with last month | Formulas only, no typed numbers |
| bank | Every bank line of the month | Sorted by date, oldest first |
| sales | Every sale of the month | Sorted by date, oldest first |

## Filling the bank sheet

Load the bank export with Python and convert the amounts to cents. Keep the original text of the description in a separate column.

Drop the opening balance line and the closing balance line from the table. Put them in the summary sheet instead.

If a line has no date, do not drop it and do not guess one. Mark the line in red and list it in your reply.

## Filling the sales sheet

The sales export has one row per sale and one column per payment method. Add a total column that is the sum of the payment columns.

Check that the total of the sales sheet equals the total in the sales report that the client sent. A difference above one euro goes in your reply.

## Categories

Every bank line belongs to one category. The category list lives in the template, on a hidden sheet. Use only categories from that list.

If a line fits no category, give it the category other and name it in your reply. Never create a new category yourself. The partners decide when the list changes.

## Formulas

Write totals as formulas so a bookkeeper can trace them. Use `SUMIFS` for totals by category and `SUM` for the rest.

Example call: `ws["B2"] = '=SUMIFS(bank!E:E, bank!F:F, A2)'`.

Do not use macros. The firm's laptops block them and the file would not open.

## Checking the pack

Before you save, check that:

- The summary total equals the sum of the bank sheet
- No cell shows an error such as #REF!
- The sheets are in the order summary, bank, sales

If a check fails, fix it and run all the checks again.

## Delivering

Save the pack to the output folder under the naming pattern. Say in your reply how many lines each sheet holds.

Do not email the pack. The bookkeeper sends it after a quick look.

Good work.
