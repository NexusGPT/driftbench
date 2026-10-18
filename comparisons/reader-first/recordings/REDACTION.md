# Benchmark contact redaction

The owner requests removal of a contact on a registered domain from public benchmark evidence. For item `43f5c75c-3554-4b10-b356-38ff14fb45ec`, the loader replaces only the email matching the hash below with `support@example.com`. Other items contain emails, so the rule uses both item ID and address hash.

Original address SHA-256: `ca05b867c8c0007209a7d2d5136555ea3e8678a2b933898785a7ebb9bf7fb6df`.

Candidate text and recorded evidence use the same replacement. Both AB and BA recording keys are recomputed with `promptKey` from `src/call.ts` and the exact prompts from `buildPrompt(readerFirstRequest(...))`. The final DEV export's content-derived pair key is updated too. The exploratory export has no pair key. Redundant display-only markers and this address's leak-guard exception are removed. Exact-substring validation remains active.

Before and after replay on 2026-10-13 finds all 526 recordings without a model call. Scores are unchanged:

| Split | Pairs | Games | Length correct | Features correct | Combined correct |
|---|---:|---:|---:|---:|---:|
| DEV | 90 | 180 | 142 | 142 | 144 |
| TEST | 173 | 346 | 242 | 242 | 248 |

Aggregate tables and every pair's machine features and result match byte for byte. Their combined JSON SHA-256 is `35495a8e5f6fd49653e1376deb44d8277ff94cf592467c3cc46f07f6bd569c43`. Full replay rows differ only in the approved address and its derived pair key. All 262 other candidate pairs and their request keys remain unchanged. The 20 reader-first tests and nine caller tests pass before and after.

Historical source-hash freeze receipts describe the original measurement and stay unchanged. The normalization and recording migration are post-study privacy edits, with no new evaluation or tuning.
