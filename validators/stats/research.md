# Research: validator stats

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## 1. 2026-10-11, V6 lane: what level 5 scores ("Chao error below 10 percent")

Question. Docs/validators.md section 7 says Good-Turing and Chao are "scored on their error against the true count", with Chao error below 10 percent when conversations exceed classes. Which estimate meets that bar on a correct implementation: the Chao1 class count, or the sample coverage?

Sources. `packages/stats/src/coverage.ts` (Chao1 and the Chao coverage, with their references: Chao and Jost 2012; Chao, Gotelli and co-authors 2014); `packages/space/src/complete.ts` and `packages/space/src/estimators.ts` (the completeness line driftbench prints: Chao-form coverage, Good-Turing discovery, and the refusal below the class count, citing Lee and Bohme 2024); a local measurement on planted populations (300 draws per cell, scratch script, seeded): class probabilities geometric or with a fixed ratio between the commonest and the rarest class, 30 to 100 classes, conversations 0.5 to 6 times the class count.

What others do. Chao1 is a lower bound for the class count by construction (it adds only what the singletons and doubletons imply), so it is reported with a coverage figure and read as a minimum. The completeness line of driftbench reports the coverage and the discovery probability, never Chao1.

Measured. Mean relative error of Chao1 against the class count at 1.5 times the class count: 0.12 (50 classes, all equal) to 0.22 (30 classes, the rarest 10 times rarer), and 0.33 with a geometric tail of ratio 0.9; at 3 times: 0.05 to 0.14 for the fixed-ratio tails; with the geometric tail of ratio 0.9 it stays at 0.16 even at 6 times. Mean relative error of the Chao coverage against the true coverage (the mass of the classes seen) at 1.5 times: 0.05 to 0.094; at 3 times: 0.02 to 0.04. On the committed populations, a coverage that ignores the singletons scores 0.256 on seed 1 (lane mutation M8).

What to try. Score the coverage estimates driftbench prints (the completeness line's Chao form and Good-Turing figure, and the stats package's chaoCoverage) against the true coverage, at 1.5 and 3 times the class count, and the refusal below it. Leave Chao1 out of the score and flag it to the owner.

Why. A level a correct implementation cannot pass gives an executor nothing to fix. The coverage is the number the report shows, so it is the number whose meaning the validator must prove.
