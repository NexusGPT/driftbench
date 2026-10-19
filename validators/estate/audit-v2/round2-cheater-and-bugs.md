# Ledger level, round 2: cheater and planted bugs

Baselines (failing items): base 1,2 = 4; base 977,4242 = 1 (ledger-scan.class-field); pilot 1,2 = 3 (the three ledger-scan.condition.* items fail at seed 2 even with the pilot: a seed 2 fixture defect, not product); pilot 977,4242 = 0.
Scratch files: the helper's work folder (cheat and bug specs and logs), not kept.

## Part 1: cheats (fail count; lower than baseline = gain)
| # | Cheat (file) | 1,2 | 977,4242 | Gain? |
|---|---|---|---|---|
| K04 | base: `by` from labeler id prefix, else 'system2' (atoms.ts) | 3 | 0 | YES, passes all while wrong |
| K06 | base: `by` only when cwd contains "scratchpad" (atoms.ts) | 3 | 0 | YES (env sniff) |
| K15 | base: `by: 'system2'` hard-coded | 3 | 0 | YES: no item uses a system1-decided first atom |
| K16 | base: `by` 'system2' only if call stack holds "bank" | 3 | 0 | YES (stack sniff) |
| K17 | base: `by: item.by ?? 'system2'` | 3 | 0 | YES (invents a class) |
| K01/K02/K05/K03 | base: 'system1' hard-coded / stack / argv tsx / file name gate (run once, seeds 1,2 and 977) | 4/4/4/4 | 1/1/1/1 | no gain (value is checked) |
| K07 | pilot: window cap ignored (scan.ts) | 3 | 0 | YES (round 1 C13 persists) |
| K11 | pilot: labels carried when text same, context ignored (ledger.ts) | 3 | 0 | YES (round 1 B04 persists) |
| K08 | pilot: key of file, window, set only (cassette.ts) | 6 | 3 | no |
| K09 | pilot: condition never attached (atoms.ts) | 3 | 1 | no |
| K10 | pilot: new unit always reruns whole suite (radius.ts) | 6 | 3 | no |
| K12 | pilot: key without model, cutDigest, run (cassette.ts) | 4 | 1 | no |
| K13 | pilot: replay miss returns nearest entry | 5 | 2 | no |
| K14 | pilot: atomsByUnit omits condition units | 3 | 2 | no |

cheater: fail 7 cheats pass every item while wrong: 'system2' hard-coded or sniffed (cwd, stack, labeler id) for `by`; window cap ignored; labels kept across a context change.

## Part 2: planted bugs on the pilot (fail count on seeds 1,2 vs baseline 3)
Caught (lose an item): P01 no lower-case merge in sentence cut (2 items) · P05 sibling heading nests (new-heading) · P06 id without file (ledger-scale timing only, load-fragile) · P07 split keeps old id on both (class.split) · P08 deleted entries dropped (delete.entry-deleted) · P09 context before moved (class.moved) · P10 deleted rerun advisory (2) · P11 context class 'none' (7) · P12 section needs identical path (new-heading) · P28 gate quote ends at target start (4) · P29 front matter units dropped (ledger-scale.diff x4) · P31 size filter 0.2 (heading-renamed) · P33 threshold 0.9 (4).

Survived (no item fails; seeds 1,2 and 977,4242 where noted *):
| Bug | Change | Verdict |
|---|---|---|
| P02* | block quote paragraph cut as sentences (cut.ts, drop inQuote branch) | real miss: block quote with 2 sentences |
| P03* | table cells give no unit (cut.ts) | real miss: a table with a labelled or edited cell |
| P04* | fence sent to labeler (scan.ts windowsOf) | real miss: assert no opaque unit in any window |
| P13* | atom unit also emits a `unit` change (radius.ts) | real miss: manifest of a unit with atoms |
| P14* | conditions joined in reverse order (atoms.ts) | real miss: two conditions on one target |
| P15* | condition ids dropped from the prose_pointer check (atoms.ts) | real miss: read check options.condition |
| P16* | condition key ignores the set (atoms.ts) | real miss: two sets, one condition each |
| P17* | miss lookup ignores labeler (cassette.ts) | real miss: stack cassette, check the `differs` list |
| P18* | readable drops part.* hashes (cassette.ts) | real miss: miss message must name part.* |
| P19* | cassette render unsorted (cassette.ts) | real miss: cassette bytes with jobs 1 vs 3 |
| P20* | runs agree on label but not target (scan.ts) | real miss: runs differing only in target |
| P21* | a run that leaves a unit out is ignored (scan.ts) | real miss: one of 3 runs omits a unit |
| P22* | labels of another labeler still counted carried (scan.ts) | real miss: change labeler, expect relabel |
| P25* | fingerprint keeps numbered-list markers (cut.ts) | real miss: renumber a list, expect unchanged |
| P39 | context = heading path only (radius.ts) | real miss: neighbour-only edit expects context |
| P46 | ctxFp ignores heading path (ledger.ts) | real miss, suspicious: heading rename should give context to every unit below |
| P44 | stale label kept when unit becomes unlabeled (scan.ts) | real miss in ledger bytes (hidden by setHash filter in atoms) |
| P40 | window headingPath from last unit (scan.ts) | real miss if headingPath is on the wire; not stated on a page |
| P23* | unreadable answer not retried (scan.ts) | docs line 85 states the retry for the model pass only: undocumented for pointer |
| P24* | halving takes floor not ceil | equivalent by docs (no page fixes which half is larger) |
| P26* | fingerprint without NFC | undocumented on the pages read |
| P32 | score weights swapped 0.4/0.6 | undocumented numbers |
| P38 | changed decided on quote not fp | near-equivalent (quote and fp differ only in stripped markers) |
| P35 | occurrence collapsed to 0/1 | equivalent (taken-id loop re-mints) |
| P43, P45 | source cut to 8 chars; none labels reach atom builder | undocumented or no visible effect |
| P27, P30 | no-op edits by construction | equivalent |

Totals: 44 bugs scored (13 caught, 19 real misses incl. P40, 12 equivalent or undocumented).

planted bugs: fail 19 real misses survive, across cut units (quote, table, fence, list marker), condition joins, cassette miss message and byte order, run agreement, labeler change carry, context class.
