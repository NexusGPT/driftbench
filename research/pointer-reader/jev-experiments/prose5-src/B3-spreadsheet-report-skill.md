---
name: spreadsheet-report{{n}}
description: Builds the monthly spreadsheet pack for a client from the bank export and the sales export. Use when a bookkeeper asks for the monthly pack.{{d}}
---

# Spreadsheet report{{n}}

The monthly pack is the main thing Abacus produces.{{d}} It has three sheets: summary, bank and sales.{{d}}

## When to use this skill{{n}}

Use it when the request says monthly pack, month end or "the usual spreadsheet".{{d}} Do not use it for a reconciliation; that has its own skill.{{p}}

## Before you build{{n}}

Check that you have both exports for the same month.{{g}} If one is missing, ask for it and stop.{{r}}

Open the template from the templates folder and copy it into the working folder.{{g}} Never edit the template itself.{{p}}

## The three sheets{{n}}

| Sheet{{n}} | Contents{{n}} | Rule{{n}} |
|---|---|---|
| summary{{d}} | Totals by category and a comparison with last month{{d}} | Formulas only, no typed numbers{{d}} |
| bank{{d}} | Every bank line of the month{{d}} | Sorted by date, oldest first{{d}} |
| sales{{d}} | Every sale of the month{{d}} | Sorted by date, oldest first{{d}} |

## Filling the bank sheet{{n}}

Load the bank export with Python and convert the amounts to cents.{{r#a}} Keep the original text of the description in a separate column.{{r#a}}

Drop the opening balance line and the closing balance line from the table.{{r#b}} Put them in the summary sheet instead.{{r#b}}

If a line has no date, do not drop it and do not guess one.{{p}} Mark the line in red and list it in your reply.{{r}}

## Filling the sales sheet{{n}}

The sales export has one row per sale and one column per payment method.{{d}} Add a total column that is the sum of the payment columns.{{r}}

Check that the total of the sales sheet equals the total in the sales report that the client sent.{{g}} A difference above one euro goes in your reply.{{r}}

## Categories{{n}}

Every bank line belongs to one category.{{d}} The category list lives in the template, on a hidden sheet.{{d}} Use only categories from that list.{{r}}

If a line fits no category, give it the category other and name it in your reply.{{r}} Never create a new category yourself.{{p}} The partners decide when the list changes.{{d}}

## Formulas{{n}}

Write totals as formulas so a bookkeeper can trace them.{{r}} Use `SUMIFS` for totals by category and `SUM` for the rest.{{r}}

Example call: `ws["B2"] = '=SUMIFS(bank!E:E, bank!F:F, A2)'`.{{e}}

Do not use macros.{{p}} The firm's laptops block them and the file would not open.{{d}}

## Checking the pack{{n}}

Before you save, check that:{{g#c}}

- The summary total equals the sum of the bank sheet{{g#c}}
- No cell shows an error such as #REF!{{g#c}}
- The sheets are in the order summary, bank, sales{{g#c}}

If a check fails, fix it and run all the checks again.{{r}}

## Delivering{{n}}

Save the pack to the output folder under the naming pattern.{{r}} Say in your reply how many lines each sheet holds.{{r}}

Do not email the pack.{{p}} The bookkeeper sends it after a quick look.{{d}}

Good work.{{n}}
