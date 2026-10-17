---
name: data-cleaning{{n}}
description: Cleans exports from banks and till systems before analysis. Use when a file has odd dates, mixed number formats or duplicates.{{d}}
---

# Data cleaning{{n}}

Exports from banks and tills are never clean.{{d}} Cleaning is half the work and it has to be repeatable.{{d}}

## The order of cleaning{{n}}

Work in this order, and do not skip a step:{{g#a}}

1. Look at the raw file and count the rows{{g#a}}
2. Fix the encoding and the separators{{g#a}}
3. Parse the dates{{g#a}}
4. Parse the amounts{{g#a}}
5. Remove exact duplicates{{g#a}}
6. Count the rows again and explain the difference{{g#a}}

## Looking at the file{{n}}

Print the first ten rows and the last five before you do anything else.{{r}} The last rows often hold totals that must not be treated as data.{{d}}

Note the number of rows in the raw file.{{r}} You will compare it with the clean file at the end.{{d}}

## Encoding and separators{{n}}

Banks in the region export with semicolons and a decimal comma.{{d}} Tills export with commas and a decimal point.{{d}} Read the file with the separator that matches its source.{{r}}

If accented letters look broken, the file is probably in a Western European encoding and not UTF-8.{{d}} Reread it with that encoding and do not edit the letters by hand.{{r}}

## Dates{{n}}

Parse dates with an explicit format and never with automatic detection.{{r}} Automatic detection reads 03/04/2026 as March in some places and April in others.{{d}}

If a date does not match the format, keep the row and put the date in a column named date_problem.{{r#b}} Report the number of such rows in your reply.{{r#b}}

## Amounts{{n}}

Remove the currency sign and the thousands separator, then convert the text to a number.{{g}} Store the result in cents.{{r}}

A minus sign may sit before the number, after it or inside brackets.{{d}} Treat all three as negative.{{r}}

Never drop a row because its amount is zero.{{p}} A zero line may be a cancelled payment that the partners want to see.{{d}}

## Duplicates{{n}}

Only exact duplicates are removed: same date, same amount, same description and same reference.{{r}} Two payments of the same amount on the same day with different references are two payments.{{d}}

If you are unsure whether two rows are duplicates, keep both and say so.{{r}} Removing a real payment is worse than keeping a repeated one.{{d}}

## A cleaning log{{n}}

Write every change to a log file in the working folder.{{r}} The log names the rule, the number of rows touched and one sample row.{{r}}

Example log line: parsed dates with the format day-month-year, 412 rows, 3 failed, sample row 88.{{e}}

## Reusing the script{{n}}

Save the cleaning script in the working folder with the client code in its name.{{r}} The next month starts from the same script.{{d}}

Do not change a saved script without noting what changed at the top.{{p}}

## Common traps{{n}}

| Trap{{n}} | What happens{{n}} |
|---|---|
| A header repeated in the middle of the file{{d}} | The amount column turns into text{{d}} |
| A total line at the end{{d}} | The totals are counted twice{{d}} |
| Trailing spaces in names{{d}} | Matching two lists fails silently{{d}} |

Remember that a file can be correct and still not be the file you were asked for.{{d}}

Well done.{{n}}
