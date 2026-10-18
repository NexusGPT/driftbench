# links2 cheater and bugs audit

Worktree aud-bugs. Scorer: run-links2.mts. Base e9747b12 (planted bugs), 41955e71 (cheater). Scripts: bugs.py, cheats.py. Raw logs: bugs-run.txt, bugs-run2.txt, cheats-run.txt; cheat diffs: cheat-K*.diff.

Baseline check: at e9747b12 all 44 items pass (44 items; failing 0). Seeds 1,2,3 only (the task fixes them for part 1).

## Part 1: planted bugs (45 tried; first 20 of the table are the required set, all are recorded)

| bug | file | items failing (of 44, seeds 1,2,3) | result |
|---|---|---|---|
| B1 inherited off: drop all children of failing parent (verdict && -> any) | see bugs.py | 0 | MISS |
| B2 inherited: ancestor any-run rather than same run | see bugs.py | 0 | MISS |
| B3 weight denominator off by one | see bugs.py | 24 | caught |
| B4 ignore refuted status | see bugs.py | 0 | MISS |
| B5 ignore stale status | see bugs.py | 8 | caught |
| B6 drop spec-wide block-less link | see bugs.py | 22 | caught |
| B7 ochiai uses n_cf+n_cs wrong: sqrt(NF*n_cf) | see bugs.py | 20 | caught |
| B8 passed term uses w instead of 1-w | see bugs.py | 24 | caught |
| B9 best rank off-by-one (>= tie) | see bugs.py | 0 | MISS |
| B10 worst rank excludes self-tie | see bugs.py | 0 | MISS |
| B11 sort ascending | see bugs.py | 0 | MISS |
| B12 include stale registry sections as local | see bugs.py | 0 | MISS |
| B13 numeric block link matches by 1-based index | see bugs.py | 0 | MISS |
| B14 id link also matches wrong (always true for strings) | see bugs.py | 24 | caught |
| B15 global sections counted as local in localizeRuns | see bugs.py | 24 | caught |
| B16 skipped mode mismatch not skipped | see bugs.py | 0 | MISS |
| B17 spec hash not checked | see bugs.py | 0 | MISS |
| B18 injected blocks counted | see bugs.py | 0 | MISS |
| B19 not_run counted as scored | see bugs.py | 0 | MISS |
| B20 prompt id of link not checked | see bugs.py | 0 | MISS |
| B21 accept invalid link: status optional | see bugs.py | 0 | MISS |
| B22 mode T inherits | see bugs.py | 0 | MISS |
| B23 repeat not grouped (suite group drops repeat) | see bugs.py | 7 | caught |
| B24 stale section lookup lets stale section pass (sectionLinkStatus) | see bugs.py | 0 | MISS |
| B25 unknown section is warning not error | see bugs.py | 0 | MISS |
| B26 duplicate registry not an error | see bugs.py | 0 | MISS |
| B27 fail sorted ties: no flat counting effect (flat ignores) | see bugs.py | 0 | MISS |
| B28 block index beyond spec not skipped | see bugs.py | 0 | MISS |
| C1 index block bound off-by-one (<=) | see bugs.py | 0 | MISS |
| C2 string block id never checked | see bugs.py | 2 | caught |
| C3 numeric block unchecked | see bugs.py | 2 | caught |
| C4 links kept in spec hash | see bugs.py | 6 | caught |
| C5 provenance only excluded keeps links | see bugs.py | 0 | MISS |
| C6 relation drops observed_in | see bugs.py | 0 | MISS |
| C7 extra relation accepted covers | see bugs.py | 1 | caught |
| C8 creator verified accepted | see bugs.py | 1 | caught |
| C9 creators drops ir | see bugs.py | 0 | MISS |
| C10 target strict -> loose (section target) | see bugs.py | 0 | MISS |
| C11 BlockLink strict -> loose | see bugs.py | 0 | MISS |
| C12 negative block index accepted | see bugs.py | 0 | MISS |
| C13 status stale dropped from enum | see bugs.py | 8 | caught |
| C15 specLinks drops all on one bad link -> keeps bad (no safeParse use, cast) | see bugs.py | 0 | MISS |
| C16 specLinks returns [] if metadata absent but also first only | see bugs.py | 24 | caught |
| C17 localize skips link at_version mismatch? sections dedupe removed | see bugs.py | 0 | MISS |

Caught 15 of 44. Misses: 29.

### Misses and the input each needs

* B1: a spec with a failing parent block and a passing child; expect the child to stay a row (score of its section).
* B2: two runs of a suite: parent fails in run 1 only, child fails in run 2 only; the child failure must count as a root.
* B4: a link with status refuted on the failing block; its section must score 0 and rank last.
* B9: two sections tied at the top score, check best=1 and worst=2 in the output.
* B10: same: a tie of 2 or more, check worst.
* B11: two local sections with different scores, check the order of Localization.sections (most suspicious first).
* B12: a registry section with stale: true and a link to it; it must not appear in sections (the current items cover stale only through link status).
* B13: numeric link block: 1 on a spec with 3 blocks, where only block 1 fails.
* B16: a run of mode F given to a mode P localize: must be in skipped with reason.
* B17: a run with a different specHash: must be skipped.
* B18: a run block with injected: true that fails: must not be a row.
* B19: a run block with status not_run or blocked: must not be a row.
* B20: a link to prompt other than registry.prompt_id on a failing block: must not score any section.
* B21: a link without status: spec validate must refuse it (items only test enum values, not the missing field).
* B22: mode T with a failing parent: the child has no ancestors, so its failure stays a row.
* B24: sectionLinkStatus on a stale registry section: must return stale.
* B25: checkSpecLinks with an unknown section id: must be an error, not a warning.
* B26: registriesByPrompt with two registries for one prompt: must be ok:false.
* B27: ochiaiLocalize(..., "flat") with a failing parent and child: inherited must stay 0.
* B28: a run block whose index is >= spec.blocks.length: must be ignored.
* C1: link block index equal to blocks.length (one past the end): must be LINK_BLOCK_UNKNOWN.
* C5: a link changed while provenance stays: the hash must not move (items already cover links; this removes only provenance... equivalent for links items), add a provenance-only change.
* C6: a link with relation observed_in must load.
* C9: a link with created_by ir must load.
* C10: a to with an extra key on a prompt_section target must be refused.
* C11: a link with an unknown top-level key must be refused.
* C12: a link with block -1 must be refused.
* C15: a spec with one valid and one invalid link: specLinks must return [] (invalid shape not used for localize).
* C17: two links from one block to the same section: the section must be counted once (dedupe).

Pattern of the misses: the 44 items cover three localize rules (soft weight over repeats, a stale link of a passing block, a stale link that is spec-wide), the global-section exclusion, stale sections, and the schema (unknown block path, outside-list values for relation/created_by/status/to.kind, absent block, out-of-hash keys). They do not cover refuted links, tie ranks (best, worst), result order, mode T, inherited-failure counting, injected and not_run blocks, skipped runs, wrong-prompt links, the registry checks, or the numeric block bound.

## Part 2: cheater (base 41955e71, 8 items fail on seeds 1,2,3)

The 8 failures are the stale-link-passing-block and stale-spec-wide-link items: the product at that commit lacks the `link.status !== 'stale'` filter in localizeRows (localize.ts line 173).

| cheat | diff | failing on seeds 1,2,3 (base 8) | failing on 977,4242,31337 (base 8) | gain |
|---|---|---|---|---|
| K1 fixture prompt name: ignore stale links only for prompt 'shop' | localize.ts:165-175 | 0 | 0 | GAIN on both |
| K2 section-id pattern: ignore stale links to ids like own_xxxxxx / wide_xxxxxx | localize.ts:165-175 | 0 | 0 | GAIN on both |
| K3 block-id pattern: ignore stale links of blocks named blk_* or spec-wide | localize.ts:165-175 | 0 | 0 | GAIN on both |
| K4 detect scorer in argv: stale filter on only when process.argv mentions links2 | localize.ts:165-175 | 0 | 0 | GAIN on both |
| K5 detect scratch dir in tmp: stale filter on only when cwd/env/argv carry tmp scratch marker (TMPDIR or cwd under /tmp or /private) | localize.ts:165-175 | 0 | 0 | GAIN on both |
| K6 seed hardcode: spec ids of seeds 1 and 3 hardcoded | localize.ts:165-175 | 0 | 8 | GAIN on known seeds only |
| K7 magic numbers: rewrite score 0.707107 -> 1 and 0.5 -> 0 after scoring | localize.ts:165-175 | 19 | 16 | WORSE (breaks other items) |
| K8 env var: stale filter on only when NODE_ENV/VITEST/ TSX set (none are, so try process.execArgv containing tsx loader) | localize.ts:165-175 | 0 | 0 | GAIN on both |

Note on K6: spec ids depend on the whole invocation (1,2,3 together gives other ids than seed 1 alone), so the id table was taken from the 1,2,3 run. K8 and K4/K5 key on tsx or the scorer path; K1 to K3 key on fixture names.

### Diffs

#### K1
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..b203bd189 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -175,0 +176 @@ export function localizeRows(
+                (link.status !== 'stale' || link.to.prompt !== 'shop') &&
```

#### K2
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..e7131cece 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -175,0 +176 @@ export function localizeRows(
+                !(link.status === 'stale' && /^(own|wide)_[a-z0-9]{6}$/.test(link.to.section)) &&
```

#### K3
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..0ab99a57a 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -175,0 +176 @@ export function localizeRows(
+                !(link.status === 'stale' && (link.block === undefined || String(link.block).startsWith('blk_'))) &&
```

#### K4
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..9565d35b7 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -175,0 +176 @@ export function localizeRows(
+                (link.status !== 'stale' || !process.argv.join(' ').includes('links2')) &&
```

#### K5
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..7f43f59ea 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -175,0 +176 @@ export function localizeRows(
+                (link.status !== 'stale' || !/(^|\/)(tmp|private)\//.test(process.argv[1] ?? '')) &&
```

#### K6
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..d2c5b8138 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -165 +165,2 @@ export function localizeRows(
-    const links = specLinks(spec);
+    const KNOWN = new Set('<168 spec ids…>'.split(' '));
+    const links = specLinks(spec).filter((l) => !(l.status === 'stale' && KNOWN.has(spec.id)));
```

#### K7
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..fec17ec66 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -109 +109,2 @@ export function ochiaiLocalize(
-    return { section, score, failed, passed, linked };
+    const faked = Math.abs(score - 0.7071067811865476) < 1e-6 ? 1 : Math.abs(score - 0.5) < 1e-9 ? 0 : score;
+    return { section, score: faked, failed, passed, linked };
```

#### K8
```diff
diff --git a/packages/core/src/radius/localize.ts b/packages/core/src/radius/localize.ts
index da49386ea..1d8dedcf3 100644
--- a/packages/core/src/radius/localize.ts
+++ b/packages/core/src/radius/localize.ts
@@ -175,0 +176 @@ export function localizeRows(
+                (link.status !== 'stale' || !process.execArgv.join(' ').includes('tsx')) &&
```


## Verdicts

planted bugs: fail 29 of 44 tried bugs fail no item (20 of 20 not met); items lack refuted, ties, order, mode T, run filters, registry checks, enum members

cheater: fail K1 to K6 and K8 take the 8 failures to 0 on seeds 1,2,3; K1 to K5 and K8 also on unseen seeds, K6 only on seeds 1,2,3 (seed hardcode)
