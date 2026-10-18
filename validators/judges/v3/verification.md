# Verification: judges v3

Expanded-bank verification is in progress. The superseded check record is
[archived](history/finished-scorer-verification.md).

Observed so far: the advanced scorer's minimal stubs fail 13 of 14 test groups.
Three confidence-boundary regressions then fail before their repair. The
implemented scorer passes all 17 advanced groups plus 24 existing base tests.
The independent advanced-bank suite passes 42 tests, including all 334 items
and rejection of an always-throw implementation on all 34 advanced items.

All 26 advanced mutants fail independent witnesses and lose actual bank items;
the original and isolated-copy baselines each pass 334/334 at seed 71. The
combined mutation run passes all 46 tests, including the existing 20 mutants.

Final cheat, TypeScript, API-surface, pr-fast and pilot evidence is
recorded after those commands complete. All heavy commands use the shared slot
runner; Vitest uses `--maxWorkers=2`.
