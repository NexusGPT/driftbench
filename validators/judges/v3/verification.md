# Verification: judges v3

The expanded bank and scorer pass the checks below. The superseded check
record is [archived](history/finished-scorer-verification.md). Pilot evidence
uses frozen checkpoint `6579b72536697bc99bccb5c138d007d4e3a4a44d` and hidden
seed `703475557`; subsequent changes format the harness and record evidence.

Observed so far: the advanced scorer's minimal stubs fail 13 of 14 test groups.
Three confidence-boundary regressions then fail before their repair. The
implemented scorer passes all 17 advanced groups plus 24 existing base tests.
The independent advanced-bank suite passes 42 tests, including all 334 items
and rejection of an always-throw implementation on all 34 advanced items.

All 26 advanced mutants fail independent witnesses and lose actual bank items;
the original and isolated-copy baselines each pass 334/334 at seed 71. The
combined mutation run passes all 46 tests, including the existing 20 mutants.

## Regression and audit results

- Focused scoring, bank, shared validator and CLI-version run: 183/183 tests
  across eight files. This includes period 1–8 position cheats, every phase
  offset, on seeds 1–20 and the checkpoint's hidden seed.
- Independent cheat audit: 2/2 tests, 19 attacks, each passing 0/334 items and
  0/7014 item-seed observations. Every candidate factory is invoked.
- Help topic contracts: the extra level-two heading fails before repair;
  701 tests pass after changing it to the existing level-three structure.
  The filtered run skips 288 unrelated tests.
- Journal: all 22 rows pass the shared schema. Parsed hardness agrees with
  the pilot's score, rate, forecast and raw author-tag count.
- Version-specific handover check exits 0. Hardness exits 1 as expected:
  the original cause and independent-audit requirements remain unmet.

The [audit reports](audit.md) preserve independent results and scope limits.
These are targeted runs, not a claim that the entire workspace test suite ran.

## Local PR checks

All seven commands from `pr fast` pass on Node 24 and pnpm 10.30.2:

```sh
pnpm install --frozen-lockfile --prefer-offline
pnpm lint
pnpm typecheck
node tools/structure/api-surface.mjs --build --check
node packages/cli/dist/bin.js --version
pnpm docs:reference --check
pnpm exec vitest run tools/docs --maxWorkers=2
```

The API check confirms 2539 exports against the regenerated snapshot. The
CHANGELOG names the 34 additions; no exports are removed. Documentation tests
pass 50/50 across seven files. The first final lint run finds one import-order
error in `pilot-round.ts`; formatting it and rerunning all seven commands gives
exit 0 for each. Both pilot JSON files pass Biome formatting.

All heavy commands use the shared slot runner; Vitest uses `--maxWorkers=2`.
The finished scorer and isolated pilot candidates are different artifacts:
seven unimplemented pilot cases do not describe missing production APIs.
