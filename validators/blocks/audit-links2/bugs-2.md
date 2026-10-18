# links2 planted bugs round 2 (seeds 1,2,3; pilot applied, base 0 failing of 91)
Files: L=packages/core/src/radius/localize.ts K=radius/links.ts S=schema/links.ts I=spec/identity.ts M=spec/semantics.ts
Scripts: bugs2.py (overwritten by this audit, see note), probe2.mts + probe-loop.py (direct probes that show the output difference).

| # | change | failing | class |
|---|---|---|---|
| N1 | L:108 guard `failed === 0` -> `failed < 0.5` | 5 | caught |
| N2 | L:112 `other.score > each.score + 1e-12` -> `>= each.score` (best rank counts ties) | 0 | REAL MISS: any tie; probe tie2 s1,s2 equal: best 1,worst 2 -> best 3,worst 4 |
| N3 | L:116 sort adds tie-break by name desc (ties no longer keep registry order) | 0 | REAL MISS: two tied sections with s1 before s2 in registry |
| N4 | L:93 `n > 0` -> `n >= 0` (all-inherited block gets weight 0/0 = NaN) | 0 | REAL MISS: block whose only failing run is inherited; scores become NaN (probe inh) |
| N5 | L:87-90 roots add passing blocks too | 0 | REAL MISS: any passing block; `roots` lists it (probe roots) |
| N6 | L:84 delete `inherited++` | 4 | caught |
| N7 | L:105 `linked++` only when w > 0 | 0 | REAL MISS: a linked block that always passes; linked count drops (probe linked) |
| N8 | L:247 `suiteRuns: suite.size` -> `runs.length` | 0 | REAL MISS (needs two runs of one suite group, e.g. repeat of a target, or a skipped run) |
| N9 | L:149 ancestors slice(0,index+1) (block inherits itself) | 6 | caught |
| N10 | L:159 parent-edge ancestors `...chain(source,...)` dropped | 0 | REAL MISS: child spec whose parent block has earlier blocks (rowsPar [..b0,b1] -> [b1]) |
| N11 | L:148 mode P treated as T (no inheritance) | 0 | REAL MISS: any mode P localize with a failing then later block |
| N12 | K:15 numeric block link never matches | 4 | caught |
| N13 | K:52 sectionLinkStatus returns 'declared' for any link to a live section | 0 | REAL MISS: link status verified/attributed/refuted to a live section (probe stat verified -> declared) |
| N14 | K:92 stale-link LINK_STALE warning dropped | 0 | REAL MISS: link status stale to a live section |
| N15 | K:63 spec_clause/source_turn links checked as sections (extra LINK_TARGET_UNKNOWN) | 0 | REAL MISS: a spec with a non prompt_section link |
| N16 | I:24 return `{...rest, metadata: kept}` even when empty | 0 | REAL MISS: spec gaining its first link changes the hash (probe hash true -> false); doc: "Links stay out of the spec hash" |
| N17 | S:28 `prompt: z.string().min(1)` -> `z.string()` | 0 | REAL MISS: link with `prompt: ''` accepted (probe emptyPrompt false -> true) |
| N18 | M:177 delete `block === undefined ||` (absent block flagged LINK_BLOCK_UNKNOWN) | 74 | caught |
| N19 | L:232 perturbationId dropped from suite group key | 0 | REAL MISS: runs of one target/mode/repeat with and without a perturbation (suiteRuns 2 -> 1, score 0.7071 -> 0) |
| N20 | L:108 score without sqrt | 44 | caught |

Caught 6 of 20 (N1 N6 N9 N12 N18 N20). 0 equivalent. 14 real misses.
The real misses: no item has tied sections (N2 N3), an all-inherited block (N4), a passing block next to a failing root (N5 N7), a second suite run (N8), a parent edge or mode P chain (N10 N11), a live-section link with status (N13), the stale / non-section warnings (N14 N15), the first-link hash (N16), an empty prompt id (N17), a perturbed run (N19).

# Cause review
Blind (blind.md): 1 cause for the 8 failing ids, fix = localize.ts:175 add `link.status !== 'stale'`.
Tagged causes of the 8 failing ids (stale-link-passing-block/{1,3}/{first,last}, stale-spec-wide-link/{1,3}/{first,last}):
- 8 of 8: "radius localize leaves stale links out of the Ochiai counts and reports them as advisory." (two ids share this sentence; the base-fix pilot.diff adds exactly the blind line)
Agreement 8/8 = 1.0. Distinct tagged causes: 1.
Note: the 4 `stale-section` ids (cause "localizeRows leaves a stale section out of the ranking") pass at base; they are not among the 8.
Note: audit/links2/bugs2.py existed under the same name and was overwritten by this audit's script.

planted bugs: fail 14 of 20 new non-equivalent bugs pass all 91 items (N2 N3 N4 N5 N7 N8 N10 N11 N13 N14 N15 N16 N17 N19); 0 equivalent
cause review: pass agreement 8/8 = 1.0, 1 distinct cause
