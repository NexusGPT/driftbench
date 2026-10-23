---
name: data-cleaning
description: Cleans exports from banks and till systems before analysis. Use when a file has odd dates, mixed number formats or duplicates.
---

# Data cleaning

Exports from banks and tills are never clean. Cleaning is half the work and it has to be repeatable.

## The order of cleaning

Work in this order, and do not skip a step:

1. Look at the raw file and count the rows
2. Fix the encoding and the separators
3. Parse the dates
4. Parse the amounts
5. Remove exact duplicates
6. Count the rows again and explain the difference

## Looking at the file

Print the first ten rows and the last five before you do anything else. The last rows often hold totals that must not be treated as data.

Note the number of rows in the raw file. You will compare it with the clean file at the end.

## Encoding and separators

Banks in the region export with semicolons and a decimal comma. Tills export with commas and a decimal point. Read the file with the separator that matches its source.

If accented letters look broken, the file is probably in a Western European encoding and not UTF-8. Reread it with that encoding and do not edit the letters by hand.

## Dates

Parse dates with an explicit format and never with automatic detection. Automatic detection reads 03/04/2026 as March in some places and April in others.

If a date does not match the format, keep the row and put the date in a column named date_problem. Report the number of such rows in your reply.

## Amounts

Remove the currency sign and the thousands separator, then convert the text to a number. Store the result in cents.

A minus sign may sit before the number, after it or inside brackets. Treat all three as negative.

Never drop a row because its amount is zero. A zero line may be a cancelled payment that the partners want to see.

## Duplicates

Only exact duplicates are removed: same date, same amount, same description and same reference. Two payments of the same amount on the same day with different references are two payments.

If you are unsure whether two rows are duplicates, keep both and say so. Removing a real payment is worse than keeping a repeated one.

## A cleaning log

Write every change to a log file in the working folder. The log names the rule, the number of rows touched and one sample row.

Example log line: parsed dates with the format day-month-year, 412 rows, 3 failed, sample row 88.

## Reusing the script

Save the cleaning script in the working folder with the client code in its name. The next month starts from the same script.

Do not change a saved script without noting what changed at the top.

## Common traps

| Trap | What happens |
|---|---|
| A header repeated in the middle of the file | The amount column turns into text |
| A total line at the end | The totals are counted twice |
| Trailing spaces in names | Matching two lists fails silently |

Remember that a file can be correct and still not be the file you were asked for.

Well done.
