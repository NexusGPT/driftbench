# Budget-bounded test generation for AI agent evaluation

**Research draft. Some results remain pending.** This paper describes the `feat/budget-seeder` implementation at commit `e13e7cb3d363c7341018dbe55325536eb48fa900`. The feature is not on `main` at the documentation base, `a97cb65e`. Appendix A pins implementation references to the feature commit. Numeric sliced Latin hypercube sampling is pending integration in that pinned snapshot, and the selector uses count balancing, not Kullback-Leibler divergence. The budget-20 controls below use the newer numeric implementation at `4bb18278097cff49f8d5d8c38c0a9a6f62107115`, on an Acme map without numeric settings; their records and analysis are pinned separately.

## Abstract

Evaluating an AI agent requires choosing conversations and settings from a combinatorial space of user types, intents, channels and data conditions. A fixed test budget can be smaller than the suite required for complete interaction coverage. We describe driftbench's budget selector, which enumerates feasible categorical conversation cells and chooses rows by a lexicographic objective: maximise newly covered pairs, then favour less frequently selected values, then use a seeded order to resolve remaining ties. Selection continues after pair coverage is complete until the budget or feasible pool is exhausted. The pinned method snapshot also exposes a stratified numeric sampling helper, but it does not integrate that helper into generated settings; the newer control implementation does. We relate the selector to covering arrays, prioritised combinatorial testing and Latin hypercube designs, giving explicit credit to prior coverage-plus-frequency methods. An experimental protocol compares the hybrid with pure pairwise generation and uniform random selection on a fictional example system with seeded faults. Thirty paired budget-20 seed trials provide preliminary categorical fault and pair-coverage comparisons on Acme. Other result cells and cost remain pending; no general effectiveness claim is established.

## Introduction

An agent can satisfy an intent for one user type and fail for another, or behave differently when a channel, data condition or conversational deviation changes. Testing each factor independently leaves their interactions unexamined. Testing every combination requires a Cartesian product whose size grows with the number of factors and values. The practical question is therefore: which tests should run when only a fixed number of conversations can be selected?

Consider a fictional assistant that supports novice and experienced users, information and action intents, and ordinary and interrupted conversations. Tool settings can vary independently, subject to compatibility constraints. A test is a feasible assignment of these categories together with a conversation and its observable expectations. Numeric settings introduce a further sampling problem within their permitted ranges. All examples and experimental fixtures in this draft are fictional.

Combinatorial testing provides an established vocabulary for this problem. A strength-two covering array represents every feasible pair of values, but a budget may expire before such coverage is attained. Partial covering arrays provide a related formulation when complete coverage is unnecessary or unaffordable [D3](#reference-d3), [D44](#reference-d44). Coverage is a structural property of selected inputs; it is not itself evidence of fault detection. Equal-budget random selection must therefore remain a substantive control [D52](#reference-d52).

This paper documents the implemented selection rule and defines an evaluation protocol. Its contribution is a reproducible budget-first application of pair coverage and count balancing to approved agent situation maps. The coverage-plus-frequency ordering has prior art, particularly Choi et al. [D41](#reference-d41). We do not claim to introduce that ordering, to implement Choi's divergence criterion, or to establish superiority from the current preliminary run. The intended numeric extension connects categorical selection with sliced Latin hypercube sampling, but that connection is not operational in the pinned version.

A further distinction is essential: `--budget N` bounds the replacement rows of the conversation seeder. It does not cap all generated specs, conversation turns, model tokens or execution cost. Other seeders and coverage completion still contribute tests. Experiments must isolate the selected rows when comparing fixed budgets, and report whole-suite outcomes separately.

## Related work

### Combinatorial testing and covering arrays

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

### Numeric sampling, pending integration

The exported helper `slicedLhs(rng, low, high, n)` requires a positive integer `n` and an ordered interval. It divides the interval into `n` equal bands, shuffles the band indices and draws once uniformly inside each band:

```text
width = (high - low) / n
sample = low + (band + rng()) * width
```

This gives one-dimensional stratification for that call, including a degenerate interval when the endpoints coincide. At the pinned commit, no production caller connects it to budgeted conversation settings. Existing numeric partition rendering still derives concrete values from schema bounds.

The intended extension is to fill numeric settings within chosen category combinations. Such integration must define the slices, coordinate draws across numeric dimensions, preserve admissibility and verify the required within-slice and global properties. Independent calls on category groups do not by themselves establish Qian's sliced-LHS guarantee [D69](#reference-d69). All claims about numeric sliced-LHS effectiveness remain pending.

## Experimental setup

### Subject and fault oracle

The current study uses the repository's fictional example system under `examples/acme`, with its approved situation map and scripted reference and faulty agents. The measurement script runs deterministic function-backed conversations and process-backed tasks with a scripted user driver. It does not call a language model. Consequently, the current study tests selection and observable fault detection in the framework, not stochastic LLM behaviour or simulated-user fidelity.

A fault is counted as caught when a block passes its machine checks on the reference and fails them on the corresponding faulty agent. The script records witness spec and block identifiers. Identity controls and an equivalent fault are excluded from the scored set; the equivalence assumption is checked against projected reference traces during measurement. Mutation-based assessment requires caution about equivalent, duplicate and subsumed faults [D153](#reference-d153).

Selected conversation rows contain no task-family instances. Some scored faults target tasks and can only be exercised by other suite components. Reporting faults against the common scored set preserves a fixed denominator but does not imply that every fault is reachable by the selected-row method. An eventual analysis should also distinguish target classes and report which faults each method can exercise.

### Budgets and methods

The actual grid in `comparisons/budget/measure.ts` is `N` in `{20, 50, 100, 200}`, with seed `1`. The table below follows that grid. The random control in `comparisons/budget/random-control.ts` samples budget `20` over `30` seeds. Those are design settings, not measured performance values. Hybrid budget 20 is also measured over those same 30 seeds. Random controls at the other budgets and repeated pure pairwise trials remain pending.

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

For hybrid and random budget-20 trials, report the mean, sample standard deviation and range. Both use seeds 1 through 30 for selection and scenario rendering; the selector seed only changes its tie-breaks. Balance, cost, other-budget controls and repeated pure pairwise trials remain pending. Following Arcuri and Briand's guidance for randomised algorithm evaluation [D161](#reference-d161), retain trial records and estimate uncertainty and effect sizes rather than treating a single seed as representative. The budget-20 subsection reports exact paired tests and mean paired differences, conditional on the stated null. No cost saving or general advantage is claimed.

Reproduction must record the feature commit, map hash, selected indices, run seed, method, generated spec paths, reference failures and fault witnesses. The numeric implementation version must be recorded separately once integrated. Appendix A links the scripts and method source; this draft does not replace or modify their measurement output.

## Results

Only the supplied seed-1 observations and the requested 30-seed hybrid/random budget-20 controls are entered. Each numeric observation carries the required provenance label. All other result cells remain the literal token `[PENDING MEASUREMENT]`, including cells for trials that may still be running or awaiting review. No percentages, derived savings or extrapolated results are calculated.

| Budget / output | Method | Faults caught | Pairs covered | Value-count deviation | Cost |
|---|---|---|---|---|---|
| 20 | Hybrid | 9 of 13 (preliminary, budget 20, seed 1) | 154 of 314 (preliminary, budget 20, seed 1) | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 20 | Pure pairwise | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 20 | Hybrid mean | 9.00 of 13 (preliminary, budget 20, seeds 1 through 30) | 153.60 of 314 (preliminary, budget 20, seeds 1 through 30) | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 20 | Hybrid spread | sample SD 0.00, range 9 to 9 (preliminary, budget 20, seeds 1 through 30) | sample SD 0.62, range 152 to 154 (preliminary, budget 20, seeds 1 through 30) | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 20 | Random mean | 8.37 of 13 (preliminary, budget 20, seeds 1 through 30) | 119.30 of 314 (preliminary, budget 20, seeds 1 through 30) | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 20 | Random spread | sample SD 0.76, range 7 to 9 (preliminary, budget 20, seeds 1 through 30) | sample SD 4.78, range 110 to 130 (preliminary, budget 20, seeds 1 through 30) | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 50 | Hybrid | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 50 | Pure pairwise | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 50 | Random mean | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 50 | Random spread | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 100 | Hybrid | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 100 | Pure pairwise | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 100 | Random mean | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 100 | Random spread | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 200 | Hybrid | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 200 | Pure pairwise | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 200 | Random mean | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| 200 | Random spread | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| Whole output associated with budget 20 | Full suite | 13 of 13 (preliminary, budget 20, seed 1) | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| Whole output associated with budget 50 | Full suite | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| Whole output associated with budget 100 | Full suite | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |
| Whole output associated with budget 200 | Full suite | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] | [PENDING MEASUREMENT] |

The selected-row and full-suite observations answer different questions. The former concerns conversations allocated by the selector; the latter includes task and other generated tests outside that allocation. They cannot be combined into an equal-budget efficacy or efficiency estimate. The paired budget-20 control compares hybrid with random on this one scripted subject. It does not establish an advantage over pure pairwise generation, an equal-cost advantage or generalisation beyond this map.

### Paired budget-20 control

The generator source is `4bb18278097cff49f8d5d8c38c0a9a6f62107115`; [the retained control records and analysis](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/README.md#paired-controls-at-20-rows) are pinned to `452337ee3b505e66278fc63f86c6ee3ef278308b`. Both methods use map hash `b583de68c530`, the same 747 feasible conversation cells and seeds 1 through 30. These are provenance and design settings. Acme has no numeric settings, so these results measure categorical selection, not numeric sliced-LHS effectiveness.

Incomplete rows are excluded from fault scoring and included in selected pair counts for every method, without replacement draws. Hybrid has 2 incomplete rows out of 600 and random has 13 out of 600 (preliminary, budget 20, seeds 1 through 30). All complete control rows pass their reference blocks and the first-email equivalence check (preliminary, budget 20, seeds 1 through 30). Selected, complete and incomplete counts are [reported for each method and seed](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/README.md#paired-controls-at-20-rows). Only nine of the fixed 13 scored faults apply to these conversation rows; the four task faults remain outside them.

The exact two-sided paired test uses the absolute mean of hybrid-minus-random differences. It independently swaps method labels within each seed pair and counts all 2^30 assignments using integer-sum dynamic programming, including zero ties and equal-extreme tails. No Monte Carlo approximation or added-one correction is used. The null assumes exchangeable method labels within each seed pair and independent swaps across pairs. These are unadjusted tests for two metrics, conditional on this null, this map and these scripted faults, not evidence of a causal or general advantage.

| Metric | Mean paired difference | Hybrid wins / ties / losses | Exact two-sided p | Extreme assignments / all assignments |
|---|---|---|---|---|
| Faults caught | 0.6333 (preliminary, budget 20, seeds 1 through 30) | 14 / 16 / 0 (preliminary, budget 20, seeds 1 through 30) | 0.0001220703125 (preliminary, budget 20, seeds 1 through 30) | 131072 / 1073741824 (preliminary, budget 20, seeds 1 through 30) |
| Pairs covered | 34.30 (preliminary, budget 20, seeds 1 through 30) | 30 / 0 / 0 (preliminary, budget 20, seeds 1 through 30) | 1.862645149230957e-9 (preliminary, budget 20, seeds 1 through 30) | 2 / 1073741824 (preliminary, budget 20, seeds 1 through 30) |

[Random records](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/random-results.json), [hybrid records and paired tests](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/hybrid-results.json), and [the exact-test implementation](https://github.com/achammah/driftbench/blob/452337ee3b505e66278fc63f86c6ee3ef278308b/comparisons/budget/paired.ts) retain the selected indices, incomplete cells, witnesses and exact tail fractions. Small-case exhaustive enumeration and an independent closed-form check of these nonnegative paired differences verify the exact tail counts. The broader method description and Appendix A keep their earlier snapshot pins until the feature PR merges. Every other result cell retains `[PENDING MEASUREMENT]`.

## Threats to validity

**One example system.** The current subject is a single fictional system with a particular approved map and constraint structure. Generalisation to other maps, agent architectures, user populations or production environments is untested. Excluding task axes also limits what the selected conversation rows can exercise.

**Seeded faults.** Detection depends on the chosen fault operators and observable checks. Equivalent, redundant or subsumed faults can distort conclusions [D153](#reference-d153). A generated suite can favour faults anticipated by its map and expectations. Equivalence controls and witness traces help audit the measurement but do not establish representativeness of real agent defects.

**Repeated seeds at one budget.** Hybrid and random budget-20 controls use 30 paired seeds. A seeded shuffle resolves hybrid ties, and scenario rendering uses each seed in both methods. Pure pairwise repeated trials and controls at the other budgets remain pending. Consecutive deterministic pseudorandom seeds do not establish independence of real agent failures; the paired tests are conditional on within-seed method-label exchangeability and independent swaps across seed pairs.

**Deterministic execution.** Scripted references, faults and users remove stochastic language-model and user-simulation variation. They support an offline selector check, but not a reliability claim for an LLM-backed agent. Such evaluation must vary execution seeds or repeated runs separately from selection seeds [D124](#reference-d124).

**Coverage and execution mismatch.** Abstract pair coverage can include incomplete rows, whereas fault checks run only complete specs. Other seeders and coverage repair can increase whole-suite detection outside the selected-row budget. Whole-suite denominators and cost must therefore remain separate from selector statistics.

**Baseline and cost confounds.** The existing pure pairwise generator differs in row construction and stopping behaviour, and `--max` affects other seeders. Equal requested row budgets need not mean equal executed rows, blocks or runtime. Cost and an exact count-balancing ablation remain pending.

**Numeric and scalability limits.** Numeric sliced LHS is absent from the pinned method snapshot. The newer implementation used for these controls integrates it, but Acme has no numeric settings, so numeric effectiveness remains pending. Exhaustive pool enumeration excludes spaces above the implementation cap and can dominate runtime below it. Count balancing can conflict with feasibility and pair coverage, and does not guarantee uniform marginals under arbitrary constraints.

## Conclusion

driftbench's pinned budget selector gives a precise rule for allocating categorical conversation rows: maximise uncovered pair gain, balance selected value counts on ties, and resolve remaining ties reproducibly. It works over feasible assignments, reports residual pair coverage and value imbalance, and continues after complete pair coverage until its row limit is reached. The limit applies to one seeder rather than the entire generated suite.

The method builds on established combinatorial selection and frequency-prioritisation work, with Choi et al. as the closest ordering precedent. Its count criterion differs from their divergence criterion. The pinned method snapshot has only the numeric helper; the newer control implementation integrates sliced numeric sampling, whose effectiveness remains pending. The paired budget-20 results are limited to this scripted subject. Other-budget controls, pure pairwise repeated trials, numeric effectiveness and cost measurements remain pending.

## References

Citation labels retain the entry IDs of the supplied bibliography dossier. Only dossier entries are cited; page ranges are omitted.

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
