---
name: workspace-layout{{n}}
description: Reference for the folders of the shared workspace and the way files are named.{{d}}
---

# Workspace layout{{n}}

The workspace is a shared drive that every bookkeeper and Abacus can read.{{d}} Only Abacus and the partners can write to the output folders.{{d}}

## Top-level folders{{n}}

| Folder{{n}} | What it holds{{n}} | Who writes to it{{n}} |
|---|---|---|
| clients{{d}} | One folder per client{{d}} | Bookkeepers{{d}} |
| scratch{{d}} | Temporary scripts and test files{{d}} | Abacus{{d}} |
| output{{d}} | Finished work, one folder per client{{d}} | Abacus and partners{{d}} |
| templates{{d}} | Spreadsheet and document templates{{d}} | Partners{{d}} |
| archive{{d}} | Closed years{{d}} | Partners only{{d}} |

The scratch folder is emptied every Sunday night.{{d}} Do not keep anything there that you want to find next week.{{p}}

## Inside a client folder{{n}}

Each client folder has the same four subfolders: input, working, output and notes.{{d}} The input folder holds what the client sent.{{d}} The notes folder holds the bookkeeper's remarks.{{d}}

Read the notes folder before you start on a client.{{g}} The notes often say which bank account is the main one.{{d}}

## Naming files{{n}}

Name every output file in this pattern: client code, period, subject, version.{{r}}

Example: harbour-bakery_2026-09_bank-reconciliation_v2.xlsx{{e}}

Use lower case and hyphens, and use underscores only between the four parts.{{r}} Do not use spaces in a file name.{{p}}

Write the period as year and month, such as 2026-09.{{r}} For a whole year write the year alone.{{r}}

## Versions{{n}}

The first file of a kind is version 1.{{d}} When you change a delivered file, save a new version and keep the old one.{{r}}

Never delete a delivered version.{{p}} Partners compare versions when a client asks a question.{{d}}

## Client codes{{n}}

Each client has a short code made of the shop name in lower case with hyphens.{{d}} The code is the name of the client folder.{{d}} If you cannot find the folder, ask the bookkeeper for the code and do not make one up.{{r}}

## File types{{n}}

| Type{{n}} | Used for{{n}} | Notes{{n}} |
|---|---|---|
| xlsx{{d}} | Spreadsheets and reconciliations{{d}} | Keep formulas live where a partner will edit{{d}} |
| csv{{d}} | Raw exports{{d}} | Comma separated, UTF-8{{d}} |
| pdf{{d}} | Reports for clients{{d}} | Partners send these{{d}} |
| png{{d}} | Charts{{d}} | 150 dots per inch{{d}} |

## A note on dates{{n}}

Dates in the workspace are written year, month, day, with hyphens.{{d}} A date such as 03-04-2026 is ambiguous and must be asked about.{{r}}

Remember that two clients keep their books on a financial year that starts in April.{{d}}

That is the whole layout.{{n}}
