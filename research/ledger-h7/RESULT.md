# H7 on the ledger, second sample: result

Pre-registration: `PREREG.md` (commit `23f1fd03b`). Run once, on 2026-10-20, with the scripts in this folder, executed from the `research/block-links` tree (commit `3db52eb52`, which holds the suite, the tools, the prompt and the registered baseline).

## Result

| | Value |
|---|---|
| Mutants drawn | 300 (30 sections x 5 negate x 5 rephrase, in two operators) |
| Left out by the validity gate after their tries | 10 (listed in `h7-mutants-300.json`, `gate_failed`) |
| Mutants measured (n) | 290 |
| Mutants with a confirmed flipped block (E not empty) | 86 |
| Misses (a block of E outside the ledger selection) | 14 |
| Wilson 95% upper bound of 14 / 290 | 7.94% |
| Mean selection ratio | 0.229 |
| Bar of the row | at most 5% |

The bar is not met. A unit change stays advisory; no threshold changed and nothing skips a test on this evidence.

## Where the misses are

18 distinct (block, section) pairs over 10 sections: a block flips under a mutant of a section it does not declare a link to. The most frequent: block `p1` under 6 sections (`new_customer_details` twice, `home_address_unknown`, `order_failure`, `porting_ineligible`, `upgrade_more_data`, `upgrade_unknown_account`); `of1` and `of2` under `upgrade_more_data`; `un1` under `upgrade_identify` twice; `pl3` under `mobile_new_line` twice; and one mutant of `explicit_confirm` flipping six blocks. They are missing links, not edit detection: every mutant changes a unit. The two misses of the first sample (`explicit_confirm`, `mobile_new_line`) recur.

## Cost

| Item | USD |
|---|---|
| Generator (gpt-6-luna, 440 calls) | 0.04 |
| Suite runs: 290 mutants x 3 x 19 conversations (16,530 conversation runs, 0 errors) and 159 confirmation jobs x 3 (477 runs, 0 errors) | 8.71 |
| Total | 8.75 |

Under the 22 USD stop of the pre-registration and the 50 USD line.

## Reproduce

`h7-ledger-300.test.ts` reads `h7-mutants-300.json` (the mutants as edits of `examples/acme/prompts/acme-sales.md`, each checked by its sha256) and `h7-selection-300.json` (the confirmed flipped blocks per mutant) from `packages/core/test/fixtures/sections/`, builds each mutant's ledger, reads the selection through the radius, and counts the misses. The live part (`gen300.py`, `run300.py export`, `export_mutants300.py`) needs the keys in `~/.nexus-secrets` and is not run by CI.
