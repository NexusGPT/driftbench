| cheater | pass | Round 6: no in-scope cheat gains beyond blank plus a correct implementation on seeds 1, 2, 3, 5; a table cheat scores 7 on unbaked seeds. Forwards to the shipped module (50) remain, counted 0 beyond. Known limits: hidden-seed mining, memory reading. |

## Round 6 (P = pw2 at commit 47dc6eb06; 50 items; blank = 7)

Status: complete. Seed 5 is now measured for all 12 new cheats and the re-run bypass cheats; no new cheat was built after the classifier stop. Two earlier rows were refreshed: d5 in layout A at seed 2 (49) and n6 in layout A (3; the 50 in the first n6 row came from a run before the restore step was added to my runner).

Threat-model ruling applied (stated by sonnet-p4-intervals, pending the lead's confirmation): mining a commit until the hidden seed equals a baked seed (Round 5b d5) is OUT of scope and is a KNOWN LIMIT, as are debugger and memory-reading cheats. Proposed fix for the known limit: a salt kept by the auditor, written into the journal, so the committer cannot predict the hidden seed.

Files: $S/audit-out/cheater/r6/ with S = /private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/sonnet-p4-closure (res/ holds the results, table6.py prints them; layouts A = module copy outside the repository, B and C = copy inside packages/estate/work). pw2 was not written.

### Controls
Blank 7 of 50. Shipped module 50 of 50 in layouts A and B (no source item lost). Correct six functions 24; correct four 13.

### (1) Round 4 and 5b bypass cheats re-run on the new scan (layout A, seeds 1, 2, 3, 5)
- Cheats that carried their payload in non-source files, symlinks, data files, or a package manifest: each now loses at least the `escapes-the-tree` item (c3 48, c7 49, d1 49, d5 49, n9 21, n11 49, n14 18), or falls to the hybrid or blank baseline.
- Cheats whose payload sat in plain sight (n7, n8, n10, r2-ref, r3-ref, c10, c10p): 18 to 22, each losing 1 to 4 source items; the correct six functions score 24.
- A dependency folder or a config alias outside the module tree (c2, c5) still scores 50 in layout A with all source items passing (forward to the shipped module = correct implementation, 0 beyond). Placed inside the repository (layouts B and C) the dependency-folder variant falls to 6 and the alias variant to 49 or 23.
- c8 (fixture lookups) stays at blank 7.

### (2) Table and hacks
- d5 table: 49 at seeds 1, 3, 5 in layout A (it now loses `escapes-the-tree`); an equivalent table kept in a `.ts` source file loses no source item and scores 50 at seeds 1 to 20 and 1000123 (baked) and 7 at unbaked seeds 21, 99 and 7777777. Every-seed over 1..20 plus an unknown hidden seed: 7.
- 30 recording-interface hacks at seeds 1 and 2: 36 to 48, identical at both seeds; none above the correct implementation of the function it replaces, and none above its Round 5b number.

### (3) New cheats against the new scan (ordinary source means; seeds 1, 2, 3 measured, 5 partial)
Twelve cheats in six kinds: an escaped identifier, a string built from character codes, bracket access to globals, a dynamically loaded unreferenced file, a renamed shipped file, a case variant of a shipped file, a package imports map, a dependency folder inside packages/estate, a payload folder beside src, and a fixture reader. Results:
- Oracle through the validator's own reference functions (n1, n2, n8, n11): 24 at every seed, equal to the correct six functions (24).
- Fixture lookups (n3): 7, no gain.
- Payload folder beside src (n4): 50 with all source items passing, a forward to the shipped module (a six-function forward 24 = correct six).
- Dependency folder inside packages/estate (n5): 50 in layout C, 7 in layout A.
- Renamed shipped file (n6r): 6, loses a source item. Imports map (n7): 6, loses a source item. Case variant (n10): 7, collides with the shipped file on a case-insensitive disk.

### Verdict
`pass`, by the ruling given: hidden-seed mining and memory reading are out of scope and stay as known limits; a forward to the shipped module equals a correct implementation (0 beyond) and is reported with its number.
- Seeds 1, 2, 3, 5 (all measured, same numbers at each): oracle through the validator's reference functions (n1, n2, n8, n11) 24 = correct six functions; fixture lookups (n3) 7; renamed shipped file (n6r) 6; imports map (n7) 6; case variant (n10) 7; dependency folder inside packages/estate (n5) 50 in layout C and 7 in A; payload folder beside src (n4) 50, six-function forward 24. The forwards (n4, n5, c2, c5) equal the correct 14 functions (50) or the correct six (24): 0 beyond.
- Table cheat (xn9, source file, no source item lost): 50 on baked seeds 1 to 20 and 1000123, 7 on unbaked seeds 21, 99 and 7777777. Every-seed over 1..20 plus an unknown hidden seed: 7. No gain.
- Re-run Round 4 and 5b bypass cheats: each loses a source item or falls to its hybrid or blank number.
- Remaining and stated plainly: forwards to the shipped module still pass all source items when the payload sits outside the scanned folder, and the two known limits (hidden-seed mining; debugger and memory reading) are not closed.

Open point for the owner: forwards to the shipped module are exempt by rule, but the source items do not stop a module that implements nothing. A closure to consider, untested: run the audit's module copy in a folder with no sibling folders and no readable shipped module. For the hidden-seed limit: a salt kept by the auditor and written into the journal.

## Round 5b (summary)
`fail`: a table of recorded answers scored 50 of 50 on seeds 1 to 20 and on a hidden seed ground by mining the commit message (now ruled out of scope). Forwards through dependency folders, symlinks, a package `main` and a path alias scored 50; the recording interface, replay and resource cases gave no gain over correct hybrids.

## Round 5 (summary)
`fail` for lack of evidence; 76 old cheats closed; two inspector-based cheats equal to correct hybrids (out of scope, known limit).

## Round 4 (summary)
`fail`: four cheats rewrote the child's verdict line (49 of 49). Closed by record-and-replay in Round 5. The source scan was beaten six ways, each at hybrid level.

## Rounds 1 to 3 (summary)
Hard-coded seeds, oracle reads, prototype patches, fixture lookups: all closed by the lock, the child and the seeded cases.
