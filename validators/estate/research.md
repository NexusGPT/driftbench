# Research: validator estate

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## 2026-10-11, the lane that built the validator: what keeps estate specs incomplete

* Question: on an estate nobody wrote by hand, which parts of the loop leave a generated spec incomplete or wrong, once the phrase bank is complete?
* Sources: the estate tests lane handoff (235 of 1338 generated specs of the Northwind fixture complete, gaps by marker); docs/estate.md sections 4 to 8 (the contract per atom kind, generation, replay, maintenance); docs/validators.md section 6 (the seven levels); packages/generate/src/estate/then.ts (the predicate to check table and its markers).
* What others do: the Northwind count mixes two causes, phrases the bank lacks and checks the generator cannot write. A validator that writes a complete bank by construction separates them: on seeds 1 to 20 about half the specs are complete and green, and the rest wait for checks.
* What to try: a "some call matches" tools check first (the largest group on every seed), then the k distinct positive asks per route, then registered custom checks.
* Why: each item of level 4 names the one file whose change completes its specs; the largest group moves the metric most.

## 2026-10-12, the bank and its pilot: is the estate bank hard enough

* Question: does the estate bank of docs/validators.md section 12 take an executor 100 iterations or more, measured by the pilot of section 12.4?
* Sources: docs/validators.md sections 12.4 and 12.6; the reader gap list of the estate validation verdict (symlinks, registry tables, process maps, catalogue JSON, dispatcher commands, compact frontmatter, long references); the ten pilot commits of exec/v-estate-pilot; validators/estate/hardness.json.
* What the pilot showed: iteration 0 passes 341 of 707 items (0.482); ten honest fixes, each one cause in packages/estate, raise it to 452 (0.639), fixing 111 items and breaking none. Mean 11.1 per iteration, 255 failing, forecast 23.0. The gate fails on both terms.
* Why the forecast is low: families of one cause collapse at once. The walker change fixed 25 items (every symlink form), the catalogue reader 19, path anchors 17. The pilot picked the largest causes first, so its mean overstates the rate on what is left: the 255 items left spread over many smaller causes (a hand count of distinct causes in the failing details gives about 117, a claim, not a measurement).
* What to try: adding items of the same kinds does not move the ratio, because every new item of a known cause falls with that cause. The bank must grow in causes, not items: families where each item needs its own change (hostile inputs, decoys, the generation classes, the agent mutant classes), and items whose pass needs a combination of causes. scan.hostile and scan.decoys were extended in this lane; the generation and mutant classes are the largest remaining lever.

## 2026-10-12, the second pilot: the bank on the reader merged from main

* Question: after main merged the reader lane (registry tables of any column set, process maps, catalogue entries of a check catalogue, dispatcher prefixes, a tolerant frontmatter pass, chunked reference files, symbolic links), is the bank still hard, and how many distinct causes does it hold?
* Sources: docs/validators.md sections 12.4 and 12.7 on main; `driftbench validate estate --hardness`; the commits of exec/v-estate-pilot2; bank/causes.ts.
* What the measurement showed: iteration 0 on the merged reader passes 424 of 744 items (0.570) and holds 104 distinct failing causes. Ten honest fixes reach 507 (0.681), fixing 83 items, breaking none. Mean 8.3 per iteration, 237 failing, forecast 28.6. Distinct causes after the pilot: 94. The gate fails on all three terms.
* Why: three causes hold 94 of the 237 failing items (a registered custom check for the rule, a "some call matches" check, the plan's relevance table); each falls in one change. The first pilot (on the reader before the merge) is history: the merged reader already held several of its fixes, so its rows measured another component.
* What to try: the bank grows in causes, not items. The families extended in this lane give the reader forms the merged reader refuses one cause each (scan.standing, new forms of scan.gates and scan.paths, 37 items, 19 causes). The next extension: generation classes whose specs need different checks, mutant classes whose deletion only a specific check notices, and plan situations whose relevance differs, so that the three large causes split into many.

## 2026-10-12, the third measurement: bench defects, a blind breaker and split causes

* Question: with the bench defects as items, a blind breaker's families and the custom-check cause split by predicate, does the bank hold the gate?
* Sources: scratchpad reports/bench/defects.md (D2, D5, D6, D7, D9 and the 5000-atom scan); docs/estate.md and docs/adapters/claude-code.md (the breaker read only these, the CLI help and the bank API); `driftbench validate estate --hardness`.
* What the measurement showed: the bank has 940 items. Iteration 0 passes 587 (0.624) with 130 distinct failing causes. The same ten pilot fixes reach 673 (0.716), fixing 86 items, none broken. Mean 8.6, failing 267, forecast 31.0, causes 118. The cause term holds; the forecast and the score do not.
* Why: the breaker's 176 items fail on 11 items only, so the reader already holds most capabilities the docs state. The 5000-atom loss is one cause: a routing table longer than one prose chunk loses its rows past the chunk's end.
* What to try: items whose fix is a capability the docs ask for and the component lacks entirely (live runs, maintenance on real diffs), not more forms of what the reader reads.
