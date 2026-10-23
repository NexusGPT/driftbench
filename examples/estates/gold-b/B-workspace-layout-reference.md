---
name: workspace-layout
description: Reference for the folders of the shared workspace and the way files are named.
---

# Workspace layout

The workspace is a shared drive that every bookkeeper and Abacus can read. Only Abacus and the partners can write to the output folders.

## Top-level folders

| Folder | What it holds | Who writes to it |
|---|---|---|
| clients | One folder per client | Bookkeepers |
| scratch | Temporary scripts and test files | Abacus |
| output | Finished work, one folder per client | Abacus and partners |
| templates | Spreadsheet and document templates | Partners |
| archive | Closed years | Partners only |

The scratch folder is emptied every Sunday night. Do not keep anything there that you want to find next week.

## Inside a client folder

Each client folder has the same four subfolders: input, working, output and notes. The input folder holds what the client sent. The notes folder holds the bookkeeper's remarks.

Read the notes folder before you start on a client. The notes often say which bank account is the main one.

## Naming files

Name every output file in this pattern: client code, period, subject, version.

Example: harbour-bakery_2026-09_bank-reconciliation_v2.xlsx

Use lower case and hyphens, and use underscores only between the four parts. Do not use spaces in a file name.

Write the period as year and month, such as 2026-09. For a whole year write the year alone.

## Versions

The first file of a kind is version 1. When you change a delivered file, save a new version and keep the old one.

Never delete a delivered version. Partners compare versions when a client asks a question.

## Client codes

Each client has a short code made of the shop name in lower case with hyphens. The code is the name of the client folder. If you cannot find the folder, ask the bookkeeper for the code and do not make one up.

## File types

| Type | Used for | Notes |
|---|---|---|
| xlsx | Spreadsheets and reconciliations | Keep formulas live where a partner will edit |
| csv | Raw exports | Comma separated, UTF-8 |
| pdf | Reports for clients | Partners send these |
| png | Charts | 150 dots per inch |

## A note on dates

Dates in the workspace are written year, month, day, with hyphens. A date such as 03-04-2026 is ambiguous and must be asked about.

Remember that two clients keep their books on a financial year that starts in April.

That is the whole layout.
