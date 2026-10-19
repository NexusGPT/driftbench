# Audit of the judges ladder version 4 (the pointer labellers, section 12.7)

The four rows below are the first line of the verdict file each audit helper wrote; the files are in
[audit-evidence](audit-evidence/). The helpers had not read the validator's code or the builder's handover before
their first run (the cheater, cause reviewer and planted-bug helpers read the bank because their checks need it).

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | Ten iterations, each fixed items: +2 +6 +3 +6 +3 +3 +3 +1 +1 +11 = 39 (334 to 373 of 377). 4 checkAnswer items stayed red: refusal wording not accepted (fixed since). Feed was enough for 9 of 10 causes; the refusal tags gave no wording hint. |
| cheater | pass | Round 6: no in-scope cheat gains beyond blank plus a correct implementation on seeds 1, 2, 3, 5; a table cheat scores 7 on unbaked seeds. Forwards to the shipped module (50) remain, counted 0 beyond. Known limits: hidden-seed mining, memory reading. |
| cause review | pass | 30 of 30 items agree (1.00; 0.90 if scored strictly); I find 33 distinct causes in the 43 failing items, the author's text has 27 distinct strings |
| planted bugs | pass | All 20 committed bugs and 39 of 42 extras are caught on 5501d11d0 (seeds 1, 2). The 3 still passing are set aside: m1 and m2 (no behaviour change), t06 (contrived guard). No realistic bug is missed. |

How the audit ran, in order. The cheater check failed the bank five times (the bank was closed after each round):
a run-time lookup of the fixtures and a table baked into the source, a patch of `Array.prototype.push` and the array
iterator, an inherited `then`/`toJSON` and a hook on the child's output, a forged output line, scan bypasses through a
data file, a symlink, a dependency folder and template literals. The last design runs the module in a child that only
records its answers (`tape.ts`) while the parent decides every verdict; round 6 passed on commit 47dc6eb06. The planted-bug helper planted 20 committed bugs and then 22 more of its own choice; each realistic bug it
missed became an item (five, then three, then two), and it passed on commit 5501d11d0. The blind pilot ran on the
first 43-item bank; the cause reviewer ran again on commit 47dc6eb06 (50 items). The bank has only grown since.

Known limits the cheater helper named, ruled out of scope: mining a git commit message until the hidden seed equals
a seed a cheat baked, and reading the validator's memory through a debugger or inspector. A forward to the shipped
module equals a correct implementation and is counted 0 beyond one. The lead confirmed both limits out of scope; a
salt the auditor keeps for the hidden seed is a follow-up.
