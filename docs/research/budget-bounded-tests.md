# Budget-bounded test generation for AI agent evaluation

**Research draft.** This paper describes the budget selector merged to `main` by PR 117 (merge commit `23e9f656589722e930ef9ca927474248a3125f79`). Appendix A keeps its implementation references pinned to the pre-merge snapshot `e13e7cb3d363c7341018dbe55325536eb48fa900`, where numeric sliced Latin hypercube sampling is not yet integrated and the selector uses count balancing, not Kullback-Leibler divergence. Numeric sampling is integrated at `4bb18278097cff49f8d5d8c38c0a9a6f62107115`. The measurements come from commit `68e7a455a70fa4414c4b879906d3a4fe0b110222` (PR 153, merge commit `7ccea2c1fc54e7dbc394e8411bb8198f8a75483b`). Every recorded result is on `Acme`, one fictional system.

## Abstract

Evaluating an AI agent requires choosing conversations and settings from a combinatorial space of user types, intents, channels and data conditions. A fixed test budget can be smaller than the suite required for complete interaction coverage. We describe driftbench's budget selector, which enumerates feasible categorical conversation cells and chooses rows by a lexicographic objective: maximise newly covered pairs, then favour less frequently selected values, then use a seeded order to resolve remaining ties. Selection continues after pair coverage is complete until the budget or feasible pool is exhausted. The pinned method snapshot also exposes a stratified numeric sampling helper, but it does not integrate that helper into generated settings; the newer control implementation does. We relate the selector to covering arrays, prioritised combinatorial testing and Latin hypercube designs, giving explicit credit to prior coverage-plus-frequency methods. An experimental protocol compares the hybrid with pure pairwise generation and uniform random selection on a fictional example system with seeded faults. Thirty paired seed trials at each of four budgets compare the selector with pure pairwise generation and uniform random selection on Acme, and a numeric ablation compares sliced Latin hypercube sampling with uniform draws on a separate fictional fixture. No general effectiveness claim is established.

## Claim

- Claim 1. Under a fixed row budget, choosing categorical conversation cells by pair gain, then count balance, then a seeded order covers more allowed pairs than uniform random selection from the same pool. This holds at budgets 20, 50, 100 and 200 over 30 paired seeds on Acme (exact paired p = 1.86e-9 at each budget).
- Claim 2. At budget 20 the same selector catches more seeded faults than random (mean 9.00 against 8.37 of 13) and than pure pairwise generation (9 against 8). At budgets 50, 100 and 200 the fault counts show no measured difference.
- Claim 3. Sliced Latin hypercube draws hit every numeric band once per slice on the numeric fixture, where uniform draws miss bands in every trial. No numeric fault-detection outcome is measured.
- Not claimed: generality beyond Acme, behaviour of language-model agents, dollar cost, an effect of the count criterion alone, or the four task faults that conversation rows cannot reach.

## Introduction

An agent can satisfy an intent for one user type and fail for another, or behave differently when a channel, data condition or conversational deviation changes. Testing each factor independently leaves their interactions unexamined. Testing every combination requires a Cartesian product whose size grows with the number of factors and values. The practical question is therefore: which tests should run when only a fixed number of conversations can be selected?

Consider a fictional assistant that supports novice and experienced users, information and action intents, and ordinary and interrupted conversations. Tool settings can vary independently, subject to compatibility constraints. A test is a feasible assignment of these categories together with a conversation and its observable expectations. Numeric settings introduce a further sampling problem within their permitted ranges. All examples and experimental fixtures in this draft are fictional.

Combinatorial testing provides an established vocabulary for this problem. A strength-two covering array represents every feasible pair of values, but a budget may expire before such coverage is attained. Partial covering arrays provide a related formulation when complete coverage is unnecessary or unaffordable [D3](#reference-d3), [D44](#reference-d44). Coverage is a structural property of selected inputs; it is not itself evidence of fault detection. Equal-budget random selection must therefore remain a substantive control [D52](#reference-d52).

This paper documents the implemented selection rule and defines an evaluation protocol. Its contribution is a reproducible budget-first application of pair coverage and count balancing to approved agent situation maps. The coverage-plus-frequency ordering has prior art, particularly Choi et al. [D41](#reference-d41). We do not claim to introduce that ordering, to implement Choi's divergence criterion, or to establish superiority from the current preliminary run. The intended numeric extension connects categorical selection with sliced Latin hypercube sampling, but that connection is not operational in the pinned version.

A further distinction is essential: `--budget N` bounds the replacement rows of the conversation seeder. It does not cap all generated specs, conversation turns, model tokens or execution cost. Other seeders and coverage completion still contribute tests. Experiments must isolate the selected rows when comparing fixed budgets, and report whole-suite outcomes separately.

## Related work

### Combinatorial testing and covering arrays

The case for low-strength interaction coverage rests on empirical fault data. Kuhn, Wallace and Gallo studied fault reports from several software systems to ask how many parameters must interact to trigger a failure [N1](#reference-n1). Their finding that failures in the studied systems involved few interacting parameters motivates strength-two coverage, but it was observed on other systems and is not evidence about agent conversations. The present measurements are the only fault evidence this paper offers for its subject.

Cohen et al.'s AETG system establishes greedy selection based on newly covered interactions [D1](#reference-d1). Nie and Leung survey combinatorial models, construction strategies and their use in testing [D3](#reference-d3). Constrained interaction testing addresses configurations that cannot occur together; Cohen, Dwyer and Shi integrate constraints with test construction [D27](#reference-d27). driftbench follows the same semantic requirement: a pair counts as feasible only if some valid full assignment can contain it. Its implementation uses a depth-first feasibility search rather than the satisfiability-based construction of that prior work.

Partial covering arrays study designs that cover a fraction of interactions [D44](#reference-d44). That literature prevents treating a fixed row count with incomplete coverage as a new combinatorial problem. The present work applies a particular greedy rule to agent conversation maps and reports the coverage remaining at the chosen budget. Coverage measures for arbitrary test sets provide the basis for expressing covered pairs relative to an explicitly defined feasible domain [D46](#reference-d46).

### Frequency balancing and the closest prior work

Choi, Kitamura, Artho and Oiwa's *Design of prioritized N-wise testing* is the closest ordering precedent [D41](#reference-d41). Their method considers new tuple coverage, tuple weights and a value-frequency criterion based on Kullback-Leibler divergence. The paper stops at complete coverage and explicitly excludes constraints. With uniform weights, the broad ordering of coverage before frequency resembles driftbench's rule. The numerical objectives are different: driftbench sums the negative current counts of the candidate's values, without computing a divergence, target probabilities or tuple weights.

Fujimoto, Kojima and Tsuchiya address desired value frequencies by augmenting a pairwise suite [D39](#reference-d39). driftbench instead applies count balancing during selection and keeps a fixed row limit. After every feasible pair is covered, count balancing alone determines subsequent choices, with seeded ordering as the final tie-break. These distinctions describe the pinned implementation; they do not imply that its choices coincide with a weighted or divergence-based algorithm.

### Latin hypercube sampling and sliced designs

McKay, Beckman and Conover introduce Latin hypercube sampling (LHS), which stratifies each input's range and samples each stratum [D59](#reference-d59). Qian's sliced Latin hypercube designs maintain Latin hypercube structure both within slices and across their union [D69](#reference-d69). Deng, Hung and Lin study coupled designs for qualitative and quantitative factors [D74](#reference-d74). These works motivate combining categorical coverage with numeric stratification, while targeting experimental design rather than agent fault detection.

The implemented categorical rule is LHS-inspired count balancing, not a formal Latin hypercube construction. It can favour underused categories, but constraints and coverage priority can prevent equal counts. Similarly, the helper named `slicedLhs` currently draws a shuffled stratified sample on a single interval. It does not construct jointly Latin slices across category combinations. A claim of Qian-style global and within-slice stratification must await integration and verification.

Li et al.'s ComOpT is a close testing precedent outside language agents: it combines constrained abstract scenario selection with numeric instantiation under a limited testing budget [D92](#reference-d92). Its numeric instantiation differs from the planned sliced-LHS extension. This overlap further narrows our contribution to the concrete selector, its agent-map integration and the proposed evaluation, rather than the general discrete-to-continuous pipeline.

### Test prioritisation

Bryce and Colbourn prioritise pairwise interactions with seeding and constraints [D33](#reference-d33). A prefix of a prioritised suite is a natural budgeted test set. driftbench constructs its selected categorical rows from the feasible pool; it does not use observed failures to reorder them. Prioritisation and budgeted generation still share the goal of placing useful tests early. Random selection remains necessary because interaction coverage alone need not imply a fault-detection advantage on every subject [D52](#reference-d52).

### LLM evaluation and simulation

Garn et al. apply pairwise combinatorial testing to language-model inputs [D119](#reference-d119), so pairwise selection for LLM testing is already established. Levi and Kadar's IntellAgent samples composed policy scenarios and simulates dialogues [D112](#reference-d112). Yao et al.'s tau-bench combines simulated users, tool interfaces and policies [D124](#reference-d124). These approaches concern scenario construction and execution as well as evaluation; our selector concerns which categorical conversation rows receive a limited allocation.

Feng et al.'s Vera composes risk, attack-method and environment taxonomies into executable safety cases [D111](#reference-d111). Its inspected construction considers risk and attack-method pairs, samples environment leaves and filters incompatible combinations. It is not a covering-array method and does not impose the same fixed row-selection budget or count-balancing rule. We make no claim that it guarantees coverage of pairs involving every environment value.

Budget-efficient benchmark estimation is a different objective. Maia Polo et al.'s tinyBenchmarks selects representative items to estimate full-benchmark performance [D147](#reference-d147). Here the intended outcome is fault discovery under a row budget. A set useful for estimating aggregate accuracy need not expose the same faults as a set chosen for interaction coverage.

## Method

### Input model and budget scope

The selector consumes an approved map, not unrestricted model-generated test descriptions. The prepared representation contains approved axes, detail dimensions, forbidden combinations, phrases and relations used to build expectations. Conversation selection crosses the axes in map-index order, excluding stage, stage-transition and task-kind axes. Task axes with a `none` value are held there when checking conversation feasibility. Details are completed within selected cells rather than treated as selection factors. Thus, the budget does not allocate task-family instances or directly select every setting dimension in the full map.

Let the selected categorical dimensions be indexed by `i`, with declared value counts `s_i`. Let `P` be the pool of full assignments over these dimensions that can be extended to a feasible assignment of the prepared map, including the fixed task values. Each member of `P` is a conversation cell. Feasibility checks cache answers to partial assignments and search constrained dimensions before free dimensions, rejecting a branch when a forbidden tuple is fully matched.

The pool enumerator traverses the categorical grid with the last dimension changing fastest. It retains feasible cells and refuses a raw grid larger than `MAX_POOL`, currently `5_000_000`, before constraints are applied. This is an implementation limit on the enumeration strategy, not a theoretical limit on constrained combinatorial testing. No approximation or automatic partitioning is performed when this limit is exceeded.

The selection count is `K = min(N, |P|)`. Pool rows are chosen without replacement. An empty pool yields no selected rows. The CLI validates the requested budget as a positive integer. Selected pair coverage has strength two regardless of the ordinary generator's `--t` setting. Other seeders and the later coverage-completion stage retain their existing behaviour, so total output can exceed `N`.

### Pair coverage as the primary criterion

For a cell `x`, define `pairs(x)` as all assignments to two distinct selected dimensions that occur in `x`. The allowed pair universe is `U = union(pairs(x) for x in P)`. This definition excludes pairs without a feasible completion, including pairs made impossible indirectly by constraints on other dimensions.

After `k` selections, let `C_k` be the covered pair set. For an unselected candidate `x`, its gain is:

```text
gain(x, k) = |pairs(x) \ C_k|
```

The implementation stores dimension-pair offsets and value-pair indices in byte arrays. It scans the pool to mark allowed pairs and values, then scans every untaken candidate at each selection step. A candidate with greater gain always wins over one with smaller gain, regardless of value balance. This is a per-step greedy maximum, not a proof of globally optimal coverage at budget `N`.

While an allowed pair remains uncovered, at least one remaining feasible row contains it, so the maximum gain is positive. Once all allowed pairs are covered, every candidate has zero gain. Selection then continues using only the secondary and final criteria until `K` rows have been selected.

### Count balancing and reproducible tie-breaking

Let `c_i(v, k)` count previously selected rows whose value on dimension `i` is `v`. Let `a_i` count values of dimension `i` that occur somewhere in the feasible pool. The stated fair-share interpretation assigns each such value a target of `N / a_i`. A candidate's sum of deficits is:

```text
deficit(x, k) = sum_i (N / a_i - c_i(x_i, k))
```

Every candidate has one value per selected dimension, so the sum of fair-share terms is constant across candidates. The code cancels those terms and compares exact integer scores:

```text
balance(x, k) = -sum_i c_i(x_i, k)
```

Among candidates with equal pair gain, the largest balance score wins. This favours combinations of less-used values. It does not guarantee perfectly equal marginals, especially when forbidden combinations restrict which underused values can coexist. The implementation does not evaluate Kullback-Leibler divergence, a maximin distance or a discrepancy objective.

The pool indices are shuffled once using the run seed and the stream label `budget`. Candidates are scanned in this order on every step. Equal gain and equal balance do not replace the current winner, so the first tied candidate in that shuffled order wins. Counts and covered pairs are updated only after choosing the winner. The named stream isolates this selection's random draws from other seeder streams.

```text
P := enumerate feasible categorical conversation cells
U := pairs present in P
order := one seeded shuffle of the indices of P
covered := empty; counts := zero; selected := empty
repeat min(N, |P|) times:
    candidates := untaken rows in order
    choose the first lexicographic maximum of (new pair gain, negative count sum)
    mark the chosen row taken
    add its pairs to covered and increment its value counts
return selected indices, pair coverage and per-value counts
```

For a fixed prepared map and seeded order, the cancelled fair-share terms mean that changing `N` does not change an earlier categorical choice before selection stops. This prefix property follows from the comparison rule. It does not imply prefix stability for future numeric filling, whose stratification could depend on the final sample size.

### Rendering and reporting

Selected indices are mapped back to the original dimensions and passed to `rowDrafts`. That function uses approved paths and deviations to build conversations, or emits a carrier with reasons when a supported path cannot be built. The resulting drafts keep the `twise` seeder identity and `gen-twise-` identifiers. Rendering distinguishes complete specs from specs that lack approved phrases or supported expectations. A selected abstract cell therefore need not become an executable test.

The budget report records the requested budget, seed, selected dimensions, feasible pool size, actual pick count and whether the request exceeds the pool. It reports covered and allowed pairs, value counts, fair shares and signed deviations. Reporting uses the actual selected count `K`, so a present value's fair share is `K / a_i`. The maximum value-count deviation is the largest absolute difference between a count and that fair share. Values absent from every feasible pool cell do not enter this calculation.

For `M = |P|` and `d` selected dimensions, the repeated candidate scans require order `K M d^2` pair comparisons, plus count comparisons. Pool enumeration and feasibility search have separate costs. Pair arrays are sized from declared dimension products, even for pairs later found infeasible. The pinned code does not use lazy pool generation or a candidate subsample. These are source-derived complexity descriptions, not measured runtime results.

### Numeric sampling

The exported helper `slicedLhs(rng, low, high, n)` requires a positive integer `n` and an ordered interval. It divides the interval into `n` equal bands, shuffles the band indices and draws once uniformly inside each band:

```text
width = (high - low) / n
sample = low + (band + rng()) * width
```

This gives one-dimensional stratification for that call, including a degenerate interval when the endpoints coincide. At the pinned commit, no production caller connects it to budgeted conversation settings. Existing numeric partition rendering still derives concrete values from schema bounds.

The intended extension is to fill numeric settings within chosen category combinations. Such integration must define the slices, coordinate draws across numeric dimensions, preserve admissibility and verify the required within-slice and global properties. Independent calls on category groups do not by themselves establish Qian's sliced-LHS guarantee [D69](#reference-d69). The later implementation at `4bb18278097cff49f8d5d8c38c0a9a6f62107115` slices by categorical row; the numeric sampling ablation in the results reports its band coverage. No numeric fault-detection outcome is measured.

## Experiment design

### Subject and fault oracle

The current study uses the repository's fictional example system under `examples/acme`, with its approved situation map and scripted reference and faulty agents. The measurement script runs deterministic function-backed conversations and process-backed tasks with a scripted user driver. It does not call a language model. Consequently, the current study tests selection and observable fault detection in the framework, not stochastic LLM behaviour or simulated-user fidelity.

A fault is counted as caught when a block passes its machine checks on the reference and fails them on the corresponding faulty agent. The script records witness spec and block identifiers. Identity controls and an equivalent fault are excluded from the scored set; the equivalence assumption is checked against projected reference traces during measurement. Mutation-based assessment requires caution about equivalent, duplicate and subsumed faults [D153](#reference-d153).

Selected conversation rows contain no task-family instances. Some scored faults target tasks and can only be exercised by other suite components. Reporting faults against the common scored set preserves a fixed denominator but does not imply that every fault is reachable by the selected-row method. An eventual analysis should also distinguish target classes and report which faults each method can exercise.

### Budgets and methods

The grid in `comparisons/budget/measure.ts` is `N` in `{20, 50, 100, 200}`. The full measurement in `comparisons/budget/full-control.ts` runs hybrid, pure pairwise and uniform random selection over seeds 1 through 30 at every budget, with execution seed 1. These are design settings, not performance values.

| Method | Definition and scope |
|---|---|
| Hybrid | The pinned budget selector: pair gain, count balancing and seeded tie resolution. Score only its selected conversation rows for the budget comparison. |
| Pure pairwise | The existing `--t 2 --max N` covering-array seeder. It extends rows from uncovered tuples with seeded dimension and value order, without the hybrid's count objective. It may stop before `N` when coverage is complete. |
| Random mean | Uniform sampling without replacement from the same feasible pool, rendered through the same conversation builder. Aggregate the completed seed trials. |
| Random spread | Sample standard deviation and minimum-to-maximum range over those trials, computed separately for each metric. |
| Full suite | Every executable complete spec in the hybrid generation output, including other seeders and coverage completion. This is a diagnostic comparator with its own cost, not an equal-budget method. |

The pure pairwise comparison is a practical baseline, not an exact ablation of only the count tie-break: its candidate-construction procedure differs from the hybrid's exhaustive candidate scan. An isolated count-balancing ablation would keep the same pool, gain calculation and seeded order while removing the count criterion. Numeric ablations must wait for integration.

The current CLI comparison also applies `--max N` to other seeders in pairwise mode while hybrid mode leaves them at their defaults. Whole-suite outcomes from these commands therefore cannot establish an equal-cost advantage. The row-level comparison is the primary budget comparison; full-suite outcomes show what the additional generated tests contribute.

### Metrics and analysis plan

Faults caught are distinct scored faults with a reference-pass and faulty-fail witness. Pairs covered are distinct allowed pairs present in selected categorical cells, with the denominator fixed by the common feasible pool [D46](#reference-d46). Full-suite coverage uses the broader map and must name its axis set and denominator separately. Value-count deviation is `max_i,v |c_i(v) - K/a_i|`, including feasible values selected zero times. Cost should report actual executed specs and blocks, elapsed execution time, and any metered model or tool usage separately.

Selection coverage and counts can include incomplete rows, while fault scoring executes complete specs only. A final analysis must expose that difference by recording selected, complete and executed counts and reference failures. It must also distinguish abstract selected-cell coverage from coverage actually exercised by runnable conversations.

For hybrid and random budget-20 trials, report the mean, sample standard deviation and range. Both use seeds 1 through 30 for selection and scenario rendering; the selector seed only changes its tie-breaks. Balance, cost and the other budgets use the same 30 seeds. Following Arcuri and Briand's guidance for randomised algorithm evaluation [D161](#reference-d161), retain trial records and estimate uncertainty and effect sizes rather than treating a single seed as representative. The results report exact paired tests and mean paired differences, conditional on the stated null. No dollar-cost saving or general advantage is claimed.

Reproduction must record the feature commit, map hash, selected indices, run seed, method, generated spec paths, reference failures and fault witnesses. The numeric implementation version must be recorded separately once integrated. Appendix A links the scripts and method source; this draft does not replace or modify their measurement output.

## Results

The first table holds the original seed-1 and budget-20 observations. The sections after it add the 30-seed grid at all four budgets, exact paired tests, a reachability audit, a numeric ablation and whole-suite runs. Recorded sources, all under `comparisons/budget/`: `full-results.json` (selected rows and paired tests), `time-balance-results.json` (wall time and balance tests), `numeric-results.json` with `numeric-{20,50,100,200}-samples.json` (numeric ablation), `reachability-results.json` (task faults), `full-suite-results.json` (whole suite), `random-results.json` and `hybrid-results.json` (budget-20 controls). Where a quantity was not recorded, this paper does not state it.

| Budget / output | Method | Faults caught | Pairs covered | Value-count deviation | Cost |
|---|---|---|---|---|---|
| 20 | Hybrid | 9 of 13 (preliminary, budget 20, seed 1) | 154 of 314 (preliminary, budget 20, seed 1) | 2.00 (measured, budget 20, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 367.32 ms; 20 complete / 0 incomplete; model calls 0, $0 (measured, budget 20, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 20 | Pure pairwise | 8.00; SD 0.00; range 8.00 to 8.00; 95% CI 8.00 to 8.00 of 13 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 73.00; SD 0.00; range 73.00 to 73.00; 95% CI 73.00 to 73.00 of 314 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 16.00; SD 0.00; range 16.00 to 16.00; 95% CI 16.00 to 16.00 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 103.87; SD 42.03; range 58.17 to 235.33; 95% CI 88.17 to 119.56 ms; mean 20.00 complete / 0.00 incomplete; model calls 0, $0 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 20 | Hybrid mean | 9.00 of 13 (preliminary, budget 20, seeds 1 through 30) | 153.60 of 314 (preliminary, budget 20, seeds 1 through 30) | 2.33; SD 0.48; range 2.00 to 3.00; 95% CI 2.15 to 2.51 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 125.15; SD 59.81; range 71.58 to 367.32; 95% CI 102.82 to 147.48 ms; mean 19.93 complete / 0.07 incomplete; model calls 0, $0 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 20 | Hybrid spread | sample SD 0.00, range 9 to 9 (preliminary, budget 20, seeds 1 through 30) | sample SD 0.62, range 152 to 154 (preliminary, budget 20, seeds 1 through 30) | sample SD 0.48, range 2.00 to 3.00 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 59.81, range 71.58 to 367.32 ms (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 20 | Random mean | 8.37 of 13 (preliminary, budget 20, seeds 1 through 30) | 119.30 of 314 (preliminary, budget 20, seeds 1 through 30) | 4.85; SD 1.20; range 3.18 to 7.00; 95% CI 4.40 to 5.30 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 121.29; SD 41.60; range 69.19 to 218.79; 95% CI 105.76 to 136.83 ms; mean 19.57 complete / 0.43 incomplete; model calls 0, $0 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 20 | Random spread | sample SD 0.76, range 7 to 9 (preliminary, budget 20, seeds 1 through 30) | sample SD 4.78, range 110 to 130 (preliminary, budget 20, seeds 1 through 30) | sample SD 1.20, range 3.18 to 7.00 (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 41.60, range 69.19 to 218.79 ms (measured, budget 20, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 50 | Hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 232.00; SD 0.00; range 232.00 to 232.00; 95% CI 232.00 to 232.00 of 314 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 5.47; SD 0.68; range 5.00 to 7.00; 95% CI 5.21 to 5.72 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 358.96; SD 155.23; range 154.91 to 671.09; 95% CI 301.00 to 416.92 ms; mean 49.83 complete / 0.17 incomplete; model calls 0, $0 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 50 | Pure pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 174.20; SD 0.55; range 173.00 to 175.00; 95% CI 173.99 to 174.41 of 314 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 12.00; SD 0.00; range 12.00 to 12.00; 95% CI 12.00 to 12.00 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 308.43; SD 136.55; range 136.04 to 582.74; 95% CI 257.44 to 359.42 ms; mean 50.00 complete / 0.00 incomplete; model calls 0, $0 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 50 | Random mean | 8.97; SD 0.18; range 8.00 to 9.00; 95% CI 8.90 to 9.03 of 13 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 187.13; SD 6.88; range 173.00 to 198.00; 95% CI 184.57 to 189.70 of 314 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 11.08; SD 2.87; range 7.00 to 16.00; 95% CI 10.01 to 12.15 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 356.10; SD 188.18; range 171.68 to 1058.87; 95% CI 285.83 to 426.36 ms; mean 48.60 complete / 1.40 incomplete; model calls 0, $0 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 50 | Random spread | sample SD 0.18, range 8.00 to 9.00 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 6.88, range 173.00 to 198.00 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 2.87, range 7.00 to 16.00 (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 188.18, range 171.68 to 1058.87 ms (measured, budget 50, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 100 | Hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 282.00; SD 0.00; range 282.00 to 282.00; 95% CI 282.00 to 282.00 of 314 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 9.07; SD 0.25; range 9.00 to 10.00; 95% CI 8.97 to 9.16 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 648.10; SD 396.29; range 292.96 to 2015.76; 95% CI 500.12 to 796.07 ms; mean 99.83 complete / 0.17 incomplete; model calls 0, $0 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 100 | Pure pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 263.23; SD 1.41; range 260.00 to 266.00; 95% CI 262.71 to 263.76 of 314 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 29.73; SD 1.44; range 26.00 to 32.00; 95% CI 29.20 to 30.27 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 720.87; SD 361.08; range 306.59 to 1924.36; 95% CI 586.04 to 855.70 ms; mean 98.37 complete / 1.63 incomplete; model calls 0, $0 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 100 | Random mean | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 234.40; SD 7.08; range 212.00 to 249.00; 95% CI 231.75 to 237.05 of 314 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 21.72; SD 5.23; range 9.00 to 32.00; 95% CI 19.77 to 23.67 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 654.15; SD 257.71; range 340.90 to 1238.44; 95% CI 557.92 to 750.39 ms; mean 97.20 complete / 2.80 incomplete; model calls 0, $0 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 100 | Random spread | sample SD 0.00, range 9.00 to 9.00 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 7.08, range 212.00 to 249.00 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 5.23, range 9.00 to 32.00 (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 257.71, range 340.90 to 1238.44 ms (measured, budget 100, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 200 | Hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 314.00; SD 0.00; range 314.00 to 314.00; 95% CI 314.00 to 314.00 of 314 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 17.00; SD 0.00; range 17.00 to 17.00; 95% CI 17.00 to 17.00 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 1801.43; SD 578.18; range 731.58 to 3301.67; 95% CI 1585.53 to 2017.33 ms; mean 199.83 complete / 0.17 incomplete; model calls 0, $0 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 200 | Pure pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 314.00; SD 0.00; range 314.00 to 314.00; 95% CI 314.00 to 314.00 of 314 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 34.33; SD 1.44; range 30.60 to 36.60; 95% CI 33.80 to 34.87 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 1260.76; SD 403.56; range 502.82 to 2289.62; 95% CI 1110.07 to 1411.45 ms; mean 130.37 complete / 1.63 incomplete; model calls 0, $0 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 200 | Random mean | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 of 13 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 271.47; SD 3.97; range 263.00 to 282.00; 95% CI 269.98 to 272.95 of 314 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 42.03; SD 6.20; range 26.00 to 58.00; 95% CI 39.72 to 44.35 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 1807.97; SD 452.74; range 1145.89 to 2645.71; 95% CI 1638.92 to 1977.03 ms; mean 194.13 complete / 5.87 incomplete; model calls 0, $0 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| 200 | Random spread | sample SD 0.00, range 9.00 to 9.00 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 3.97, range 263.00 to 282.00 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 6.20, range 26.00 to 58.00 (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | sample SD 452.74, range 1145.89 to 2645.71 ms (measured, budget 200, seeds 1 through 30, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| Whole output associated with budget 20 | Full suite | 13 of 13 (preliminary, budget 20, seed 1) | 637 of 637 (measured, budget 20, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 208.27 (complete-spec/value incidences) (measured, budget 20, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 85490.98 ms; 251 complete / 74 incomplete; model calls 0, $0 (measured, budget 20, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| Whole output associated with budget 50 | Full suite | 13 of 13 (measured, budget 50, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 637 of 637 (measured, budget 50, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 205.00 (complete-spec/value incidences) (measured, budget 50, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 68680.52 ms; 247 complete / 75 incomplete; model calls 0, $0 (measured, budget 50, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| Whole output associated with budget 100 | Full suite | 13 of 13 (measured, budget 100, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 637 of 637 (measured, budget 100, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 209.09 (complete-spec/value incidences) (measured, budget 100, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 60723.56 ms; 252 complete / 75 incomplete; model calls 0, $0 (measured, budget 100, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |
| Whole output associated with budget 200 | Full suite | 13 of 13 (measured, budget 200, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 637 of 637 (measured, budget 200, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 263.91 (complete-spec/value incidences) (measured, budget 200, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) | 81505.95 ms; 319 complete / 75 incomplete; model calls 0, $0 (measured, budget 200, seed 1, commit `68e7a455a70fa4414c4b879906d3a4fe0b110222`) |

The selected-row and full-suite observations answer different questions. The former concerns conversations allocated by the selector; the latter includes task and other generated tests outside that allocation. They cannot be combined into an equal-budget efficacy or efficiency estimate. The paired budget-20 control compares hybrid with random on this one scripted subject. The pairwise comparison, the other budgets and the cost measures appear under Additional paired measurements; none of them generalises beyond this map.

### Paired budget-20 control

The generator source is `4bb18278097cff49f8d5d8c38c0a9a6f62107115`; [the retained control records and analysis](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/README.md#paired-controls-at-20-rows) are pinned to `452337ee3b505e66278fc63f86c6ee3ef278308b`. Both methods use map hash `b583de68c530`, the same 747 feasible conversation cells and seeds 1 through 30. These are provenance and design settings. Acme has no numeric settings, so these results measure categorical selection, not numeric sliced-LHS effectiveness.

Incomplete rows are excluded from fault scoring and included in selected pair counts for every method, without replacement draws. Hybrid has 2 incomplete rows out of 600 and random has 13 out of 600 (preliminary, budget 20, seeds 1 through 30). All complete control rows pass their reference blocks and the first-email equivalence check (preliminary, budget 20, seeds 1 through 30). Selected, complete and incomplete counts are [reported for each method and seed](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/README.md#paired-controls-at-20-rows). Only nine of the fixed 13 scored faults apply to these conversation rows; the four task faults remain outside them.

The exact two-sided paired test uses the absolute mean of hybrid-minus-random differences. It independently swaps method labels within each seed pair and counts all 2^30 assignments using integer-sum dynamic programming, including zero ties and equal-extreme tails. No Monte Carlo approximation or added-one correction is used. The null assumes exchangeable method labels within each seed pair and independent swaps across pairs. These are unadjusted tests for two metrics, conditional on this null, this map and these scripted faults, not evidence of a causal or general advantage.

| Metric | Mean paired difference | Hybrid wins / ties / losses | Exact two-sided p | Extreme assignments / all assignments |
|---|---|---|---|---|
| Faults caught | 0.6333 (preliminary, budget 20, seeds 1 through 30) | 14 / 16 / 0 (preliminary, budget 20, seeds 1 through 30) | 0.0001220703125 (preliminary, budget 20, seeds 1 through 30) | 131072 / 1073741824 (preliminary, budget 20, seeds 1 through 30) |
| Pairs covered | 34.30 (preliminary, budget 20, seeds 1 through 30) | 30 / 0 / 0 (preliminary, budget 20, seeds 1 through 30) | 1.862645149230957e-9 (preliminary, budget 20, seeds 1 through 30) | 2 / 1073741824 (preliminary, budget 20, seeds 1 through 30) |

[Random records](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/random-results.json), [hybrid records and paired tests](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/hybrid-results.json), and [the exact-test implementation](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/paired.ts) retain the selected indices, incomplete cells, witnesses and exact tail fractions. Small-case exhaustive enumeration and an independent closed-form check of these nonnegative paired differences verify the exact tail counts. The broader method description and Appendix A keep their earlier snapshot pins.

## Threats to validity

**One example system.** The current subject is a single fictional system with a particular approved map and constraint structure. Generalisation to other maps, agent architectures, user populations or production environments is untested. Excluding task axes also limits what the selected conversation rows can exercise.

**Seeded faults.** Detection depends on the chosen fault operators and observable checks. Equivalent, redundant or subsumed faults can distort conclusions [D153](#reference-d153). A generated suite can favour faults anticipated by its map and expectations. Equivalence controls and witness traces help audit the measurement but do not establish representativeness of real agent defects.

**Repeated seeds at one budget.** All methods use 30 paired seeds at each budget. A seeded shuffle resolves hybrid ties, and scenario rendering uses each seed in both methods. Consecutive deterministic pseudorandom seeds do not establish independence of real agent failures; the paired tests are conditional on within-seed method-label exchangeability and independent swaps across seed pairs.

**Deterministic execution.** Scripted references, faults and users remove stochastic language-model and user-simulation variation. They support an offline selector check, but not a reliability claim for an LLM-backed agent. Such evaluation must vary execution seeds or repeated runs separately from selection seeds [D124](#reference-d124).

**Coverage and execution mismatch.** Abstract pair coverage can include incomplete rows, whereas fault checks run only complete specs. Other seeders and coverage repair can increase whole-suite detection outside the selected-row budget. Whole-suite denominators and cost must therefore remain separate from selector statistics.

**Baseline and cost confounds.** The existing pure pairwise generator differs in row construction and stopping behaviour, and `--max` affects other seeders. Equal requested row budgets need not mean equal executed rows, blocks or runtime. An exact count-balancing ablation is not run. Cost is reported only as executed adapter runs, blocks and wall time on a shared machine.

**Numeric and scalability limits.** Numeric sliced LHS is absent from the pinned method snapshot. The newer implementation used for these controls integrates it, but Acme has no numeric settings. The numeric ablation uses a separate fictional fixture and measures band coverage only, not fault detection. Exhaustive pool enumeration excludes spaces above the implementation cap and can dominate runtime below it. Count balancing can conflict with feasibility and pair coverage, and does not guarantee uniform marginals under arbitrary constraints.

## Conclusion

driftbench's pinned budget selector gives a precise rule for allocating categorical conversation rows: maximise uncovered pair gain, balance selected value counts on ties, and resolve remaining ties reproducibly. It works over feasible assignments, reports residual pair coverage and value imbalance, and continues after complete pair coverage until its row limit is reached. The limit applies to one seeder rather than the entire generated suite.

The method builds on established combinatorial selection and frequency-prioritisation work, with Choi et al. as the closest ordering precedent. Its count criterion differs from their divergence criterion. The pinned method snapshot has only the numeric helper; the newer control implementation integrates sliced numeric sampling, whose effectiveness remains pending. The paired results at four budgets are limited to this scripted subject. Numeric fault detection, language-model agents, a count-balancing ablation and dollar cost are not measured.

## Open questions

- Do the budget-20 fault and pair-coverage advantages hold for agents backed by a language model, with a simulated user and stochastic execution? Acme is scripted, so this is untested.
- How much of the budget-20 advantage comes from the count criterion alone? The pairwise baseline differs in row construction, so an ablation with the same pool, gain and seeded order but no count term is needed.
- Does the pair-coverage gain carry over to maps with other sizes and constraint structures, including pools near the `MAX_POOL` cap?
- Does sliced Latin hypercube sampling of numeric settings change fault detection? The ablation shows band coverage only, on a fixture with no seeded numeric faults.
- Is strength two the right default for agent conversations? The fault-interaction data cited in the related work come from other kinds of software [N1](#reference-n1).
- Which seeded faults would conversation rows reach if task axes entered the selector? Four of the 13 scored faults sit outside the current rows.

## References

Labels starting with D retain the entry IDs of the supplied bibliography dossier. Label N1 was added later; its title, authors, venue and year match the Crossref record for its DOI. Page ranges are omitted.

### Reference N1

Kuhn D.R., Wallace D.R., Gallo A.M. (2004). *Software fault interactions and implications for software testing.* IEEE Transactions on Software Engineering 30(6). [DOI](https://doi.org/10.1109/TSE.2004.24).

### Reference D1

Cohen D.M., Dalal S.R., Fredman M.L., Patton G.C. (1997). *The AETG system: an approach to testing based on combinatorial design.* IEEE Transactions on Software Engineering 23(7). [DOI](https://doi.org/10.1109/32.605761).

### Reference D3

Nie C., Leung H. (2011). *A survey of combinatorial testing.* ACM Computing Surveys 43(2). [DOI](https://doi.org/10.1145/1883612.1883618).

### Reference D27

Cohen M.B., Dwyer M.B., Shi J. (2007). *Interaction testing of highly-configurable systems in the presence of constraints.* ISSTA. [DOI](https://doi.org/10.1145/1273463.1273482).

### Reference D33

Bryce R.C., Colbourn C.J. (2006). *Prioritized interaction testing for pair-wise coverage with seeding and constraints.* Information and Software Technology 48(10). [DOI](https://doi.org/10.1016/j.infsof.2006.03.004).

### Reference D39

Fujimoto S., Kojima H., Tsuchiya T. (2013). *A value weighting method for pair-wise testing.* APSEC. [DOI](https://doi.org/10.1109/apsec.2013.24).

### Reference D41

Choi E.-H., Kitamura T., Artho C., Oiwa Y. (2014). *Design of prioritized N-wise testing.* ICTSS, LNCS. [DOI](https://doi.org/10.1007/978-3-662-44857-1_14).

### Reference D44

Sarkar K., Colbourn C.J., De Bonis A., Vaccaro U. (2018, online 2017). *Partial covering arrays: algorithms and asymptotics.* Theory of Computing Systems 62. [DOI](https://doi.org/10.1007/s00224-017-9782-9).

### Reference D46

Kuhn D.R., Kacker R.N., Lei Y. (2016, online 2015). *Measuring and specifying combinatorial coverage of test input configurations.* Innovations in Systems and Software Engineering 12. [DOI](https://doi.org/10.1007/s11334-015-0266-2).

### Reference D52

Schroeder P.J., Bolaki P., Gopu V. (2004). *Comparing the fault detection effectiveness of n-way and random test suites.* ISESE. [DOI](https://doi.org/10.1109/isese.2004.1334893).

### Reference D59

McKay M.D., Beckman R.J., Conover W.J. (1979). *A comparison of three methods for selecting values of input variables in the analysis of output from a computer code.* Technometrics 21(2). [DOI](https://doi.org/10.1080/00401706.1979.10489755).

### Reference D69

Qian P.Z.G. (2012). *Sliced Latin hypercube designs.* Journal of the American Statistical Association 107(497). [DOI](https://doi.org/10.1080/01621459.2011.644132).

### Reference D74

Deng X., Hung Y., Lin C.D. (2015). *Design for computer experiments with qualitative and quantitative factors.* Statistica Sinica 25. [DOI](https://doi.org/10.5705/ss.2013.388).

### Reference D92

Li C., Cheng C.-H., Sun T., Chen Y., Yan R. (2022). *ComOpT: combination and optimization for testing autonomous driving systems.* ICRA. [DOI](https://doi.org/10.1109/icra46639.2022.9811794).

### Reference D111

Feng Y., Lin R., Wen M., He Q., Guo Y., et al. (2026). *Safety testing LLM agents at scale: from risk discovery to evidence-grounded verification.* arXiv 2607.01793. [Preprint](https://arxiv.org/abs/2607.01793).

### Reference D112

Levi E., Kadar I. (2025). *IntellAgent: a multi-agent framework for evaluating conversational AI systems.* arXiv 2501.11067. [Preprint](https://arxiv.org/abs/2501.11067).

### Reference D119

Garn B., Kampel L., Leithner M., Celic B., Çulha C., Hiess I., et al. (2023). *Applying pairwise combinatorial testing to large language model testing.* LNCS. [DOI](https://doi.org/10.1007/978-3-031-43240-8_16).

### Reference D124

Yao S., Shinn N., Razavi P., Narasimhan K. (2024). *tau-bench: a benchmark for tool-agent-user interaction in real-world domains.* arXiv 2406.12045. [Preprint](https://arxiv.org/abs/2406.12045).

### Reference D147

Maia Polo F., Weber L., Choshen L., Sun Y., Xu G., Yurochkin M. (2024). *tinyBenchmarks: evaluating LLMs with fewer examples.* ICML; arXiv 2402.14992. [Preprint](https://arxiv.org/abs/2402.14992).

### Reference D153

Papadakis M., Henard C., Harman M., Jia Y., Le Traon Y. (2016). *Threats to the validity of mutation-based test assessment.* ISSTA. [DOI](https://doi.org/10.1145/2931037.2931040).

### Reference D161

Arcuri A., Briand L. (2011). *A practical guide for using statistical tests to assess randomized algorithms in software engineering.* ICSE. [DOI](https://doi.org/10.1145/1985793.1985795).


## Appendix A: implementation traceability

All feature and measurement references below pin commit `e13e7cb3d363c7341018dbe55325536eb48fa900`. Labels are repository-relative `file:line` references; links include the full commit and line span. These references describe that snapshot, not a feature already merged to `main`.

| Claim | File:line reference | Source scope |
|---|---|---|
| Budget CLI option and positive-integer parsing | [`packages/cli/src/commands/generate.ts:75`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/cli/src/commands/generate.ts#L74-L77), [`generate.ts:125`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/cli/src/commands/generate.ts#L125-L135) | Budget replaces conversation rows; usage validation is separate from selection. |
| Conversation dimensions | [`packages/generate/src/seed/seeders.ts:347`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/seeders.ts#L343-L353), [`seeders.ts:480`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/seeders.ts#L480-L498) | Excludes stage, transitions and task axes; fixes task `none` values for feasibility. |
| Feasible completion | [`packages/generate/src/seed/feasible.ts:44`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/feasible.ts#L44-L94) | Cached partial-assignment search; rejects fully matched forbidden tuples. |
| Pool enumeration and raw-grid cap | [`packages/generate/src/seed/budget.ts:18`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/budget.ts#L18-L51) | Checks the Cartesian product before filtering; enumerates feasible rows. |
| Feasible pair and value universe | [`packages/generate/src/seed/budget.ts:61`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/budget.ts#L61-L86) | Pair offsets and byte-array presence flags derived from the pool. |
| Budget cap, candidate scan and count tie-break | [`packages/generate/src/seed/budget.ts:88`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/budget.ts#L88-L117) | One shuffle; `min(budget, pool.length)`; gain before negative count sum. |
| Selection updates and no replacement | [`packages/generate/src/seed/budget.ts:118`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/budget.ts#L118-L135) | Marks taken indices; updates covered pairs and marginal counts. |
| Named random stream and shuffle | [`packages/generate/src/seed/random.ts:11`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/random.ts#L11-L42) | Stream seed derives from the run seed and label; shuffle copies indices. |
| Conversation rendering | [`packages/generate/src/seed/seeders.ts:433`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/seeders.ts#L433-L476) | Approved-path scenarios or reason-bearing carriers retain `twise` identity. |
| Selector integration and report statistics | [`packages/generate/src/seed/seeders.ts:549`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/seeders.ts#L549-L612) | Builds the pool, calls the selector, fixes strength two, reports actual-count fair shares. |
| Other seeders still run | [`packages/generate/src/enumerate/generate.ts:155`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/enumerate/generate.ts#L155-L186), [`generate.ts:281`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/enumerate/generate.ts#L281-L308) | Replaces `twise` only; coverage completion can add further specs. |
| Complete versus incomplete outputs | [`packages/generate/src/enumerate/generate.ts:209`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/enumerate/generate.ts#L209-L251) | Missing phrases or expectations keep specs out of the executable subset. |
| Numeric helper and current partition values | [`packages/generate/src/seed/budget.ts:138`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/budget.ts#L138-L149), [`values.ts:53`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/values.ts#L53-L70) | Helper samples one interval; existing numeric values derive from schema partitions. |
| Helper export and integration status | [`packages/generate/src/enumerate/index.ts:14`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/enumerate/index.ts#L14), [`comparisons/budget/README.md:47`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/comparisons/budget/README.md#L47) | Exported helper is tested but not called by the generator. |
| Existing pure pairwise baseline | [`packages/generate/src/seed/twise.ts:70`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/src/seed/twise.ts#L70-L143) | Seed uncovered tuples and greedily complete rows under constraints; not the same candidate scan. |
| Actual budget grid and CLI comparison | [`comparisons/budget/measure.ts:48`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/comparisons/budget/measure.ts#L48-L64) | Budgets 20, 50, 100 and 200; seed 1; `--max` versus `--budget`. |
| Measurement cells and fault witnesses | [`comparisons/budget/measure.ts:82`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/comparisons/budget/measure.ts#L82-L153) | Recounts selected cells, includes incomplete selection rows, scores executable reference/fault contrasts. |
| Random control and trial summaries | [`comparisons/budget/random-control.ts:76`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/comparisons/budget/random-control.ts#L76-L155) | Budget 20 over 30 seeds; no-replacement shuffle; means, sample deviations and ranges for faults and pairs. |
| Selector and numeric fixture assertions | [`packages/generate/test/seed/budget.test.ts:67`](https://github.com/achammah/driftbench/blob/e13e7cb3d363c7341018dbe55325536eb48fa900/packages/generate/test/seed/budget.test.ts#L67-L213) | Checks per-step ordering, feasibility, repeatability, capped selection and numeric bands; these are tests, not experimental results. |

The documentation base's [README Test generation section](https://github.com/achammah/driftbench/blob/a97cb65e/README.md#test-generation) describes the wider approved-map, generation and validity-gate pipeline. Its [Budget mode paragraph](https://github.com/achammah/driftbench/blob/a97cb65e/README.md#budget-mode-in-progress) labels the feature in progress. Appendix A uses the feature implementation for algorithm claims and does not treat that forward-looking paragraph as proof of numeric integration.

<!-- paired-budget-measurements -->

Raw records pinned to data commit `812f48aee0a5848c7849aa660f1fd4dbbf29ea94`. Earlier method sections retain their historical snapshot pins.

## Additional paired measurements

Measurement source: `68e7a455a70fa4414c4b879906d3a4fe0b110222`. Acme map hash: `6d29ed7a7539`. Selection/rendering seeds: 1 through 30. Execution seed: 1. Model calls: 0. Model/tool spend: $0.

The selected-row study uses the production budget and pairwise seeders. Random samples the same 747-cell pool without replacement. Both complete and incomplete rows count toward drawn pair coverage and balance. Only complete rows enter fault scoring. All complete rows pass their reference and excluded-fault equivalence checks.

Each summary cell reports mean, sample SD, range and a two-sided 95% Student t interval for the seed mean (29 degrees of freedom). These intervals assume independent seed trials. Constant observations give a zero-width interval. The intervals describe this seed distribution, not variation across systems.

### Selected rows

| Budget | Method | Faults / 13 | Drawn pairs / 314 | Selected rows | Complete rows | Incomplete rows | Wall ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 153.60; SD 0.62; range 152.00 to 154.00; 95% CI 153.37 to 153.83 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 19.93; SD 0.25; range 19.00 to 20.00; 95% CI 19.84 to 20.03 | 0.07; SD 0.25; range 0.00 to 1.00; 95% CI -0.03 to 0.16 | 125.15; SD 59.81; range 71.58 to 367.32; 95% CI 102.82 to 147.48 |
| 20 | pairwise | 8.00; SD 0.00; range 8.00 to 8.00; 95% CI 8.00 to 8.00 | 73.00; SD 0.00; range 73.00 to 73.00; 95% CI 73.00 to 73.00 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 103.87; SD 42.03; range 58.17 to 235.33; 95% CI 88.17 to 119.56 |
| 20 | random | 8.37; SD 0.76; range 7.00 to 9.00; 95% CI 8.08 to 8.65 | 119.30; SD 4.78; range 110.00 to 130.00; 95% CI 117.52 to 121.08 | 20.00; SD 0.00; range 20.00 to 20.00; 95% CI 20.00 to 20.00 | 19.57; SD 0.63; range 18.00 to 20.00; 95% CI 19.33 to 19.80 | 0.43; SD 0.63; range 0.00 to 2.00; 95% CI 0.20 to 0.67 | 121.29; SD 41.60; range 69.19 to 218.79; 95% CI 105.76 to 136.83 |
| 50 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 232.00; SD 0.00; range 232.00 to 232.00; 95% CI 232.00 to 232.00 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 49.83; SD 0.38; range 49.00 to 50.00; 95% CI 49.69 to 49.97 | 0.17; SD 0.38; range 0.00 to 1.00; 95% CI 0.03 to 0.31 | 358.96; SD 155.23; range 154.91 to 671.09; 95% CI 301.00 to 416.92 |
| 50 | pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 174.20; SD 0.55; range 173.00 to 175.00; 95% CI 173.99 to 174.41 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 308.43; SD 136.55; range 136.04 to 582.74; 95% CI 257.44 to 359.42 |
| 50 | random | 8.97; SD 0.18; range 8.00 to 9.00; 95% CI 8.90 to 9.03 | 187.13; SD 6.88; range 173.00 to 198.00; 95% CI 184.57 to 189.70 | 50.00; SD 0.00; range 50.00 to 50.00; 95% CI 50.00 to 50.00 | 48.60; SD 1.00; range 46.00 to 50.00; 95% CI 48.23 to 48.97 | 1.40; SD 1.00; range 0.00 to 4.00; 95% CI 1.03 to 1.77 | 356.10; SD 188.18; range 171.68 to 1058.87; 95% CI 285.83 to 426.36 |
| 100 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 282.00; SD 0.00; range 282.00 to 282.00; 95% CI 282.00 to 282.00 | 100.00; SD 0.00; range 100.00 to 100.00; 95% CI 100.00 to 100.00 | 99.83; SD 0.38; range 99.00 to 100.00; 95% CI 99.69 to 99.97 | 0.17; SD 0.38; range 0.00 to 1.00; 95% CI 0.03 to 0.31 | 648.10; SD 396.29; range 292.96 to 2015.76; 95% CI 500.12 to 796.07 |
| 100 | pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 263.23; SD 1.41; range 260.00 to 266.00; 95% CI 262.71 to 263.76 | 100.00; SD 0.00; range 100.00 to 100.00; 95% CI 100.00 to 100.00 | 98.37; SD 1.13; range 96.00 to 100.00; 95% CI 97.95 to 98.79 | 1.63; SD 1.13; range 0.00 to 4.00; 95% CI 1.21 to 2.05 | 720.87; SD 361.08; range 306.59 to 1924.36; 95% CI 586.04 to 855.70 |
| 100 | random | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 234.40; SD 7.08; range 212.00 to 249.00; 95% CI 231.75 to 237.05 | 100.00; SD 0.00; range 100.00 to 100.00; 95% CI 100.00 to 100.00 | 97.20; SD 1.13; range 95.00 to 100.00; 95% CI 96.78 to 97.62 | 2.80; SD 1.13; range 0.00 to 5.00; 95% CI 2.38 to 3.22 | 654.15; SD 257.71; range 340.90 to 1238.44; 95% CI 557.92 to 750.39 |
| 200 | hybrid | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 314.00; SD 0.00; range 314.00 to 314.00; 95% CI 314.00 to 314.00 | 200.00; SD 0.00; range 200.00 to 200.00; 95% CI 200.00 to 200.00 | 199.83; SD 0.38; range 199.00 to 200.00; 95% CI 199.69 to 199.97 | 0.17; SD 0.38; range 0.00 to 1.00; 95% CI 0.03 to 0.31 | 1801.43; SD 578.18; range 731.58 to 3301.67; 95% CI 1585.53 to 2017.33 |
| 200 | pairwise | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 314.00; SD 0.00; range 314.00 to 314.00; 95% CI 314.00 to 314.00 | 132.00; SD 0.00; range 132.00 to 132.00; 95% CI 132.00 to 132.00 | 130.37; SD 1.13; range 128.00 to 132.00; 95% CI 129.95 to 130.79 | 1.63; SD 1.13; range 0.00 to 4.00; 95% CI 1.21 to 2.05 | 1260.76; SD 403.56; range 502.82 to 2289.62; 95% CI 1110.07 to 1411.45 |
| 200 | random | 9.00; SD 0.00; range 9.00 to 9.00; 95% CI 9.00 to 9.00 | 271.47; SD 3.97; range 263.00 to 282.00; 95% CI 269.98 to 272.95 | 200.00; SD 0.00; range 200.00 to 200.00; 95% CI 200.00 to 200.00 | 194.13; SD 2.00; range 189.00 to 198.00; 95% CI 193.39 to 194.88 | 5.87; SD 2.00; range 2.00 to 11.00; 95% CI 5.12 to 6.61 | 1807.97; SD 452.74; range 1145.89 to 2645.71; 95% CI 1638.92 to 1977.03 |

Wall time starts before selection/drafting and ends after rendering and fault scoring. It excludes map loading, result-file output and analysis. Execution order rotates across methods. Scoring is uncached, and a mutant stops running after its first witness, matching the retained controls. Wall times are observations on a shared machine.

#### Balance and runnable coverage

| Budget | Method | Maximum value-count deviation | Runnable pairs / 314 | Executed adapter runs | Executed blocks |
| --- | --- | --- | --- | --- | --- |
| 20 | hybrid | 2.33; SD 0.48; range 2.00 to 3.00; 95% CI 2.15 to 2.51 | 153.17; SD 1.78; range 147.00 to 154.00; 95% CI 152.50 to 153.83 | 74.77; SD 6.91; range 59.00 to 87.00; 95% CI 72.19 to 77.35 | 382.67; SD 34.31; range 307.00 to 474.00; 95% CI 369.85 to 395.48 |
| 20 | pairwise | 16.00; SD 0.00; range 16.00 to 16.00; 95% CI 16.00 to 16.00 | 73.00; SD 0.00; range 73.00 to 73.00; 95% CI 73.00 to 73.00 | 96.20; SD 1.32; range 95.00 to 99.00; 95% CI 95.71 to 96.69 | 414.17; SD 26.00; range 377.00 to 479.00; 95% CI 404.46 to 423.87 |
| 20 | random | 4.85; SD 1.20; range 3.18 to 7.00; 95% CI 4.40 to 5.30 | 117.63; SD 4.82; range 110.00 to 127.00; 95% CI 115.83 to 119.43 | 89.03; SD 12.95; range 70.00 to 116.00; 95% CI 84.20 to 93.87 | 454.00; SD 71.83; range 348.00 to 638.00; 95% CI 427.18 to 480.82 |
| 50 | hybrid | 5.47; SD 0.68; range 5.00 to 7.00; 95% CI 5.21 to 5.72 | 231.30; SD 1.60; range 227.00 to 232.00; 95% CI 230.70 to 231.90 | 134.57; SD 6.96; range 119.00 to 147.00; 95% CI 131.97 to 137.16 | 669.20; SD 34.65; range 595.00 to 756.00; 95% CI 656.26 to 682.14 |
| 50 | pairwise | 12.00; SD 0.00; range 12.00 to 12.00; 95% CI 12.00 to 12.00 | 174.20; SD 0.55; range 173.00 to 175.00; 95% CI 173.99 to 174.41 | 159.20; SD 1.32; range 158.00 to 162.00; 95% CI 158.71 to 159.69 | 712.77; SD 27.96; range 669.00 to 783.00; 95% CI 702.33 to 723.21 |
| 50 | random | 11.08; SD 2.87; range 7.00 to 16.00; 95% CI 10.01 to 12.15 | 185.37; SD 7.37; range 169.00 to 198.00; 95% CI 182.61 to 188.12 | 153.53; SD 18.58; range 129.00 to 191.00; 95% CI 146.59 to 160.47 | 778.93; SD 94.37; range 635.00 to 1000.00; 95% CI 743.69 to 814.17 |
| 100 | hybrid | 9.07; SD 0.25; range 9.00 to 10.00; 95% CI 8.97 to 9.16 | 281.47; SD 1.22; range 278.00 to 282.00; 95% CI 281.01 to 281.92 | 234.57; SD 6.96; range 219.00 to 247.00; 95% CI 231.97 to 237.16 | 1180.47; SD 37.76; range 1109.00 to 1278.00; 95% CI 1166.37 to 1194.56 |
| 100 | pairwise | 29.73; SD 1.44; range 26.00 to 32.00; 95% CI 29.20 to 30.27 | 261.57; SD 1.61; range 258.00 to 264.00; 95% CI 260.96 to 262.17 | 255.93; SD 2.69; range 251.00 to 262.00; 95% CI 254.93 to 256.94 | 1278.43; SD 35.67; range 1208.00 to 1357.00; 95% CI 1265.11 to 1291.75 |
| 100 | random | 21.72; SD 5.23; range 9.00 to 32.00; 95% CI 19.77 to 23.67 | 233.53; SD 7.15; range 212.00 to 249.00; 95% CI 230.86 to 236.20 | 250.80; SD 19.41; range 224.00 to 291.00; 95% CI 243.55 to 258.05 | 1273.37; SD 97.22; range 1127.00 to 1496.00; 95% CI 1237.06 to 1309.67 |
| 200 | hybrid | 17.00; SD 0.00; range 17.00 to 17.00; 95% CI 17.00 to 17.00 | 313.57; SD 1.01; range 311.00 to 314.00; 95% CI 313.19 to 313.94 | 434.57; SD 6.96; range 419.00 to 447.00; 95% CI 431.97 to 437.16 | 2184.87; SD 36.51; range 2105.00 to 2260.00; 95% CI 2171.23 to 2198.50 |
| 200 | pairwise | 34.33; SD 1.44; range 30.60 to 36.60; 95% CI 33.80 to 34.87 | 312.33; SD 1.18; range 310.00 to 314.00; 95% CI 311.89 to 312.78 | 319.93; SD 2.69; range 315.00 to 326.00; 95% CI 318.93 to 320.94 | 1573.10; SD 36.32; range 1504.00 to 1655.00; 95% CI 1559.54 to 1586.66 |
| 200 | random | 42.03; SD 6.20; range 26.00 to 58.00; 95% CI 39.72 to 44.35 | 271.13; SD 4.07; range 261.00 to 281.00; 95% CI 269.62 to 272.65 | 444.67; SD 20.10; range 416.00 to 491.00; 95% CI 437.16 to 452.17 | 2262.70; SD 100.97; range 2070.00 to 2510.00; 95% CI 2225.00 to 2300.40 |

### Exact paired comparisons

Each test swaps method labels independently within each seed pair and uses the absolute sum of differences. Integer-sum dynamic programming counts all 1,073,741,824 assignments, including zero differences and equal-extreme tails. The null assumes exchangeable labels within pairs and independent swaps across pairs. P-values are unadjusted.

| Budget | Comparison | Fault difference | Fault p | Fault exact tail | Pair difference | Pair p | Pair exact tail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | hybrid minus pairwise | 1.00; SD 0.00; range 1.00 to 1.00; 95% CI 1.00 to 1.00 | 1.862645149230957e-09 | 2/1073741824 | 80.60; SD 0.62; range 79.00 to 81.00; 95% CI 80.37 to 80.83 | 1.862645149230957e-09 | 2/1073741824 |
| 20 | hybrid minus random | 0.63; SD 0.76; range 0.00 to 2.00; 95% CI 0.35 to 0.92 | 0.0001220703125 | 131072/1073741824 | 34.30; SD 5.08; range 22.00 to 44.00; 95% CI 32.40 to 36.20 | 1.862645149230957e-09 | 2/1073741824 |
| 50 | hybrid minus pairwise | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 57.80; SD 0.55; range 57.00 to 59.00; 95% CI 57.59 to 58.01 | 1.862645149230957e-09 | 2/1073741824 |
| 50 | hybrid minus random | 0.03; SD 0.18; range 0.00 to 1.00; 95% CI -0.03 to 0.10 | 1 | 1073741824/1073741824 | 44.87; SD 6.88; range 34.00 to 59.00; 95% CI 42.30 to 47.43 | 1.862645149230957e-09 | 2/1073741824 |
| 100 | hybrid minus pairwise | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 18.77; SD 1.41; range 16.00 to 22.00; 95% CI 18.24 to 19.29 | 1.862645149230957e-09 | 2/1073741824 |
| 100 | hybrid minus random | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 47.60; SD 7.08; range 33.00 to 70.00; 95% CI 44.95 to 50.25 | 1.862645149230957e-09 | 2/1073741824 |
| 200 | hybrid minus pairwise | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 |
| 200 | hybrid minus random | 0.00; SD 0.00; range 0.00 to 0.00; 95% CI 0.00 to 0.00 | 1 | 1073741824/1073741824 | 42.53; SD 3.97; range 32.00 to 51.00; 95% CI 41.05 to 44.02 | 1.862645149230957e-09 | 2/1073741824 |

At budgets 50, 100 and 200, hybrid versus pairwise fault catches show **no measured difference**: all 30 paired differences are zero and each exact two-sided p-value is 1.

At budget 200, pairwise stops at 132 selected rows (complete pair coverage) and catches 9 of 13. Hybrid selects 200 rows and catches the same 9. The 68 extra hybrid rows (34% of 200) add no measured fault catch, so on this subject pairwise is cheaper per catch at budget 200. Executed blocks agree: pairwise 1573.10 against hybrid 2184.87 (mean over 30 seeds). The comparison measures selected rows, runs and blocks, not dollars.

#### Exact wall-time and balance tests

Post-measurement analysis source: `4953e14309c3b2693c63e8ea5330e133f88c878a`. These tests retain the binary64 observations exactly, convert them to a common power-of-two integer scale, and count paired label-swap tails by splitting each assignment into two halves. No rounding or Monte Carlo sampling enters the tests. Wall-time comparisons remain shared-machine observations.

| Budget | Comparison | Wall-ms paired difference | Wall-time p | Balance paired difference | Balance p |
| --- | --- | --- | --- | --- | --- |
| 20 | hybrid minus pairwise | 21.28; SD 49.46; range -126.16 to 131.99; 95% CI 2.81 to 39.75 | 0.024678237736225128 | -13.67; SD 0.48; range -14.00 to -13.00; 95% CI -13.85 to -13.49 | 1.862645149230957e-09 |
| 20 | hybrid minus random | 3.86; SD 64.27; range -107.84 to 254.26; 95% CI -20.14 to 27.86 | 0.7760960552841425 | -2.52; SD 1.31; range -5.00 to -0.33; 95% CI -3.01 to -2.03 | 1.862645149230957e-09 |
| 50 | hybrid minus pairwise | 50.53; SD 162.07; range -405.76 to 439.91; 95% CI -9.99 to 111.05 | 0.09886249154806137 | -6.53; SD 0.68; range -7.00 to -5.00; 95% CI -6.79 to -6.28 | 1.862645149230957e-09 |
| 50 | hybrid minus random | 2.86; SD 136.18; range -387.78 to 249.12; 95% CI -47.99 to 53.72 | 0.910104850307107 | -5.61; SD 2.98; range -11.00 to -2.00; 95% CI -6.72 to -4.50 | 1.862645149230957e-09 |
| 100 | hybrid minus pairwise | -72.77; SD 337.06; range -609.00 to 1023.66; 95% CI -198.63 to 53.09 | 0.25031455233693123 | -20.67; SD 1.49; range -23.00 to -17.00; 95% CI -21.22 to -20.11 | 1.862645149230957e-09 |
| 100 | hybrid minus random | -6.06; SD 338.73; range -810.46 to 1457.09; 95% CI -132.54 to 120.42 | 0.9321412872523069 | -12.66; SD 5.23; range -23.00 to 0.00; 95% CI -14.61 to -10.70 | 3.725290298461914e-09 |
| 200 | hybrid minus pairwise | 540.67; SD 432.86; range -143.62 to 1672.22; 95% CI 379.04 to 702.31 | 1.210719347000122e-07 | -17.33; SD 1.44; range -19.60 to -13.60; 95% CI -17.87 to -16.80 | 1.862645149230957e-09 |
| 200 | hybrid minus random | -6.54; SD 420.95; range -759.45 to 992.07; 95% CI -163.73 to 150.65 | 0.9327673949301243 | -25.03; SD 6.20; range -41.00 to -9.00; 95% CI -27.35 to -22.72 | 1.862645149230957e-09 |

#### Per-seed differences at budget 20

| Seed | Hybrid faults | Pairwise faults | Hybrid minus pairwise | Random faults | Hybrid minus random |
| --- | --- | --- | --- | --- | --- |
| 1 | 9 | 8 | 1 | 9 | 0 |
| 2 | 9 | 8 | 1 | 8 | 1 |
| 3 | 9 | 8 | 1 | 9 | 0 |
| 4 | 9 | 8 | 1 | 7 | 2 |
| 5 | 9 | 8 | 1 | 7 | 2 |
| 6 | 9 | 8 | 1 | 8 | 1 |
| 7 | 9 | 8 | 1 | 8 | 1 |
| 8 | 9 | 8 | 1 | 9 | 0 |
| 9 | 9 | 8 | 1 | 8 | 1 |
| 10 | 9 | 8 | 1 | 9 | 0 |
| 11 | 9 | 8 | 1 | 9 | 0 |
| 12 | 9 | 8 | 1 | 9 | 0 |
| 13 | 9 | 8 | 1 | 8 | 1 |
| 14 | 9 | 8 | 1 | 7 | 2 |
| 15 | 9 | 8 | 1 | 9 | 0 |
| 16 | 9 | 8 | 1 | 8 | 1 |
| 17 | 9 | 8 | 1 | 8 | 1 |
| 18 | 9 | 8 | 1 | 9 | 0 |
| 19 | 9 | 8 | 1 | 9 | 0 |
| 20 | 9 | 8 | 1 | 9 | 0 |
| 21 | 9 | 8 | 1 | 8 | 1 |
| 22 | 9 | 8 | 1 | 9 | 0 |
| 23 | 9 | 8 | 1 | 9 | 0 |
| 24 | 9 | 8 | 1 | 7 | 2 |
| 25 | 9 | 8 | 1 | 9 | 0 |
| 26 | 9 | 8 | 1 | 9 | 0 |
| 27 | 9 | 8 | 1 | 9 | 0 |
| 28 | 9 | 8 | 1 | 8 | 1 |
| 29 | 9 | 8 | 1 | 9 | 0 |
| 30 | 9 | 8 | 1 | 7 | 2 |

### Four uncaught faults: reachability diagnosis

The full-space audit renders all 747 allowed conversation cells at each of 30 seeds (22,410 renderings). It finds zero task specs or operations targets. The conversation dimensions exclude task-kind axes and hold task values at `none`; the renderer emits conversation specs. These four faults are outside the selected-conversation space, not rows missed by the selector. The whole generator supplies task-family specs and catches all four, so this is a conversation-scope gap, not an absent full-generator oracle.

| Fault | Trigger / observation | Reachable in selected conversations? | Full-generator task witness |
| --- | --- | --- | --- |
| `ops-x1-wrong-price` | Writes the first Mobile price one dollar too high in the workbook, and its yearly result with it. The reply is unchanged. | No: process-backed task target | `acme-price-sheet-i01-base#build` |
| `ops-x4-narrates` | Narrates its internal steps in the final reply and never names the file it wrote. | No: process-backed task target | `acme-price-sheet-i01-base#build` |
| `ops-x5-skips-check` | Leaves no record of the read-back command: the block shows no command run. | No: process-backed task target | `acme-price-sheet-i01-base#build` |
| `ops-d6-deletes-readme` | Acts on an instruction planted in the workspace: it removes README.txt after its own work. | No: process-backed task target | `acme-price-sheet-i01-base#build` |

### Numeric sampling ablation

Numeric map hash: `d1cb91852e1f`. The approved fictional fixture has temperature and delay ranges plus integer iterations, and six categorical cells. The uniform control uses the identical ordered categorical rows and changes only numeric quantiles. Band counts use latent quantiles; integer levels can repeat. Every rendered row retains the same categorical metadata and delivers its sampled values through `given.vars`.

| Budget | Method | Global bands hit | Per-slice bands hit | Perfect slice/setting checks | Categorical pairs |
| --- | --- | --- | --- | --- | --- |
| 20 | sliced-lhs | 60.00; SD 0.00; range 60.00 to 60.00; 95% CI 60.00 to 60.00 of 60 | 60.00; SD 0.00; range 60.00 to 60.00; 95% CI 60.00 to 60.00 of 60 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 20 | uniform | 38.07; SD 2.64; range 33.00 to 43.00; 95% CI 37.08 to 39.05 of 60 | 42.17; SD 2.55; range 36.00 to 47.00; 95% CI 41.22 to 43.12 of 60 | 6.73; SD 1.48; range 1.00 to 9.00; 95% CI 6.18 to 7.29 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 50 | sliced-lhs | 150.00; SD 0.00; range 150.00 to 150.00; 95% CI 150.00 to 150.00 of 150 | 150.00; SD 0.00; range 150.00 to 150.00; 95% CI 150.00 to 150.00 of 150 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 50 | uniform | 95.73; SD 3.40; range 90.00 to 103.00; 95% CI 94.46 to 97.00 of 150 | 98.93; SD 3.52; range 92.00 to 104.00; 95% CI 97.62 to 100.25 of 150 | 5.63; SD 1.54; range 0.00 to 7.00; 95% CI 5.06 to 6.21 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 100 | sliced-lhs | 300.00; SD 0.00; range 300.00 to 300.00; 95% CI 300.00 to 300.00 of 300 | 300.00; SD 0.00; range 300.00 to 300.00; 95% CI 300.00 to 300.00 of 300 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 100 | uniform | 189.83; SD 6.42; range 179.00 to 201.00; 95% CI 187.44 to 192.23 of 300 | 193.70; SD 5.06; range 176.00 to 200.00; 95% CI 191.81 to 195.59 of 300 | 5.60; SD 1.52; range 0.00 to 6.00; 95% CI 5.03 to 6.17 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 200 | sliced-lhs | 600.00; SD 0.00; range 600.00 to 600.00; 95% CI 600.00 to 600.00 of 600 | 600.00; SD 0.00; range 600.00 to 600.00; 95% CI 600.00 to 600.00 of 600 | 18.00; SD 0.00; range 18.00 to 18.00; 95% CI 18.00 to 18.00 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |
| 200 | uniform | 379.87; SD 8.08; range 364.00 to 400.00; 95% CI 376.85 to 382.89 of 600 | 384.07; SD 7.82; range 366.00 to 398.00; 95% CI 381.15 to 386.99 of 600 | 5.60; SD 1.52; range 0.00 to 6.00; 95% CI 5.03 to 6.17 of 18 | 11.00; SD 0.00; range 11.00 to 11.00; 95% CI 11.00 to 11.00 of 11 |

Sliced LHS hits every global band once and every within-slice band once for all three settings in every trial. All 2,160 slice/setting checks and 360 global-setting checks pass. Each uniform trial misses at least one band. Singleton slices trivially pass within-slice checks for both methods; the raw records retain every slice size. Categorical coverage stays 11 of 11 for both methods at all budgets. No numeric fault-detection outcome is measured.

| Budget | Global band-count paired p | Per-slice band-count paired p | Perfect slice/setting-count paired p |
| --- | --- | --- | --- |
| 20 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |
| 50 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |
| 100 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |
| 200 | 1.862645149230957e-09 | 1.862645149230957e-09 | 1.862645149230957e-09 |

### Whole-suite seed-1 supplement

These CLI runs include other seeders and coverage completion, outside the selected-row budget. Whole value balance counts complete-spec/value incidences at strength one on all map axes; fair share is incidences divided by feasible values per dimension. A spec can expose multiple values. This balance measure differs from one-cell-per-selected-row balance.

| Budget | Method | Complete / incomplete | Faults / 13 | Whole pairs / 637 | Whole value-count deviation | Wall ms | Executed adapter runs / blocks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | budget | 251 / 74 | 13 | 637 | 208.27 | 85490.98 | 588 / 2648 |
| 20 | pairwise | 114 / 22 | 13 | 379 | 96.18 | 75453.12 | 296 / 1178 |
| 50 | budget | 247 / 75 | 13 | 637 | 205.00 | 68680.52 | 585 / 2632 |
| 50 | pairwise | 194 / 52 | 13 | 549 | 161.64 | 63940.91 | 449 / 2037 |
| 100 | budget | 252 / 75 | 13 | 637 | 209.09 | 60723.56 | 591 / 2631 |
| 100 | pairwise | 253 / 75 | 13 | 637 | 209.91 | 76508.40 | 641 / 2889 |
| 200 | budget | 319 / 75 | 13 | 637 | 263.91 | 81505.95 | 754 / 3519 |
| 200 | pairwise | 251 / 75 | 13 | 637 | 208.27 | 86980.58 | 645 / 2946 |

### Reproduction and raw records

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec tsx comparisons/budget/check-analysis.ts
pnpm exec tsx comparisons/budget/full-control.ts
pnpm exec tsx comparisons/budget/numeric-control.ts
pnpm exec tsx comparisons/budget/full-suite-control.ts
pnpm exec tsx comparisons/budget/reachability.ts
pnpm exec tsx comparisons/budget/time-balance-tests.ts
python3 comparisons/budget/audit-results.py
python3 comparisons/budget/report.py
```

- [Selected grid, seeds, witnesses and paired tests](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/full-results.json)
- [Numeric summaries and paired tests](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/numeric-results.json)
- [Whole-suite seed-1 records](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/full-suite-results.json)
- [Exhaustive conversation routing and task witnesses](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/reachability-results.json)
- [Exact wall-time and balance paired tests](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/time-balance-results.json)
- [Numeric raw trials, budget 20](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/numeric-20-samples.json)
- [Numeric raw trials, budget 50](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/numeric-50-samples.json)
- [Numeric raw trials, budget 100](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/numeric-100-samples.json)
- [Numeric raw trials, budget 200](https://github.com/achammah/driftbench/blob/812f48aee0a5848c7849aa660f1fd4dbbf29ea94/comparisons/budget/numeric-200-samples.json)

The budget-20 hybrid and random grid is checked seed by seed against the retained earlier records. The current Acme map hash is `6d29ed7a7539`; the retained controls use `b583de68c530`. All 30 selected-index, fault, pair, complete-row and incomplete-row records match those controls. Exact-test checks use independent exhaustive enumeration on mixed-sign small cases. The interval critical value is checked by independently integrating the Student t density. Pure pairwise is a practical baseline with different row construction, not a count-balancing ablation.
