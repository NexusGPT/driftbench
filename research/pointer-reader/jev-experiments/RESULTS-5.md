# Phase 5: the gold set grown to 1,200 agreed units over three new fictional estates

Date 2026-10-17. Branch `research/jev-id-experiments`. Every number comes from a file named next to it. One fictional author wrote all three estates, so they share one voice: three estates are not three independent estates.

## Result

- **Frozen set `gold5.json`: 1,451 units in 22 files, 1,256 agreed** (the author label equals the independent Opus label). The target of 1,200 agreed units is met. sha256 `1c7c7afde32a4e0647b6ad9000007a575f9bb89b3130e53329da7df748149ed6` (`gold5.sha256`). Units where the two disagree (195) are in the file with both labels and no gold label (`label: null`); list in `disagreements5.tsv`.
- **Agreement 86.6% [84.7, 88.2], Cohen kappa 0.825** over all 1,451 units (`agree5.out.md`). On the harbour set under the same guide the pair A' and B'2 reached 95.0% and kappa 0.934 (RESULTS-4). The rules written for the harbour set carry over only in part: new estates drop agreement by 8 points.
- No annotator is a labeller under test: the author (me) and an independent Opus annotator, run as three agents (one per estate) that read only `GUIDE4.md` (guide 2.1) and the sheet. Neither Jev nor Haiku labelled any unit of this set.

## The three estates

| Estate | Agent type | Files | Units | Agreed | Agreement % [Wilson 95%] | Kappa | Instruction vs not, % |
|---|---|---|---|---|---|---|---|
| A | Support prose (a small broadband provider, assistant Pip) | 8 | 555 | 491 | 88.5 [85.5, 90.9] | 0.848 | 95.9 |
| B | Code-interpreter agent (bookkeepers, assistant Abacus: sandbox, workspace folders, scripts, spreadsheet and chart skills) | 8 | 486 | 428 | 88.1 [84.9, 90.7] | 0.842 | 94.4 |
| C | One prompt with a tab per channel (WhatsApp, email, phone, web chat) for guesthouses, assistant Marisol, plus skills that repeat the tabs | 6 | 410 | 337 | 82.2 [78.2, 85.6] | 0.774 | 92.4 |
| All | | 22 | 1,451 | 1,256 | 86.6 [84.7, 88.2] | 0.825 | 94.4 |

Author layer: `prose5-src/` (units tagged inline), cut into units by the same cutter as before (`build-prose5.ts`), clean files in `prose5/`, tags in `gold5.author.json`. Opus layer: `labels-A-opus.tsv`, `labels-B-opus.tsv`, `labels-C-opus.tsv` (one line per unit: file, number, label, group). Sheets the annotator read: `sheet-A.txt`, `sheet-B.txt`, `sheet-C.txt`.

Agreed units by label: rule 282, prohibition 129, gate 54, example 49, description 441, none 301.

## Where the two annotators differ

Author (rows) against Opus (columns), all 1,451 units:

| author \ opus | rule | prohibition | gate | example | description | none |
|---|---|---|---|---|---|---|
| rule | 282 | 61 | 19 | 0 | 4 | 0 |
| prohibition | 0 | 129 | 0 | 0 | 0 | 0 |
| gate | 14 | 13 | 54 | 0 | 1 | 0 |
| example | 0 | 0 | 0 | 49 | 0 | 0 |
| description | 55 | 17 | 4 | 7 | 441 | 0 |
| none | 0 | 0 | 0 | 0 | 0 | 301 |

- **rule (author) read as prohibition (Opus), 61 units.** Opus reads a count in the unit ("in one short sentence", "once", "one question per message", "say the price once") as a cap under D7 ("an explicit cap in a number or a count is a prohibition"). I tagged them `rule` as the manner of the act (D11, D13). D7 and D11 overlap on counts: this is a guide gap, and the largest single shape.
- **description (author) read as rule (Opus), 55 units.** Output-spec statements and "A good reply is short, names the next step" (D13) and sentences with a passive that names the reader's act. Opus tends to see an instruction where I saw a fact about the tool or the firm.
- **rule read as gate, 19, and gate read as rule or prohibition, 27.** Order words on a single act ("first", "only after"); D6 asks for two acts of the reader.
- **Groups.** Opus grouped 110 multi-unit rules, I tagged 38. Same units: 356 of about 480; same units and same kind: 310 (span F1 with kind 64.4%, without kind 73.9%). Opus joined "ban plus the instead-action" pairs and "fact plus the sentence that acts on it" pairs that I kept apart. Exact span edges are reported, not gated.
- No `none` is mislabelled by either side (301 of 301), and `example` agrees on 49 of 56.

## A first transfer check on the new estates (one Jev pass, `an5j.out.md`)

Jev `choice` question per unit, window of 30 units, the definitions of phase 4, one pass (60 calls, `results5/jev5-r1.json`, cassette `cassette5.jsonl.gz`):

| Units | n | Accuracy % [Wilson 95%] | 10% unsure |
|---|---|---|---|
| Estate A, agreed units | 491 | 80.2 [76.5, 83.5] | 85.3 |
| Estate B, agreed units | 428 | 82.0 [78.1, 85.4] | 85.5 |
| Estate C, agreed units | 337 | 86.4 [82.3, 89.6] | 89.4 |
| All, agreed units | 1,256 | 82.5 [80.3, 84.5] | 86.5 |
| All, against the author labels | 1,451 | 77.6 [75.4, 79.7] | 81.5 |
| All, against the Opus labels | 1,451 | 74.4 [72.1, 76.6] | 78.3 |

The raw `choice` design on the harbour key gave 80.0 [76.1, 83.4] with the same settings (RESULTS-4, Table 1). The new estates give the same level (82.5), including the channel-tabbed prompt and the code-interpreter estate. Jev's accuracy against either single annotator is 4 to 8 points lower than on the agreed units, for the same reason as before: the agreed set leaves out the contested units. 60 calls, 330,749 input tokens, 90,879 output tokens, median 258 ms and 90th percentile 300 ms per call, USD 0.0139 (input only at 0.042 per million, owner, 17 October 2026).

## The default stack on the growth corpus (run with the lead's go, USD 0.31)

Same stack as `STACK-SPEC.md`, nothing retuned: Jev head J* first (window of 30 and whole-file `choice`, 24 probes, pair answers, structure; 1 pass each, 57 + 22 + 57 + 22 calls), the lowest-margin share to Haiku (3 runs, guide 2.1, one call per file), accepted only if the 3 runs agree, otherwise a person. Key = the 1,256 agreed units (author = Opus). Tables below are `an24-J1.out.md` and `an24-Jx.out.md`. Haiku: 66 calls under guide 2.1 (`results5h/`, cassette `cassette5-haiku.jsonl.gz`). Jev: `results45/`, cassette `cassette45.jsonl.gz`. `gold5s.json` is `gold5.json` in the shape of the span corpus so the same code runs (`CORPUS=5`); estates A and B play "dev", estate C plays "test".

**Which head.** Two heads were trained, both on labelled units, neither on a unit it labels:
- **Jx**: trained only on the 465 keyed units of the span corpus (the harbour-style estate), applied to the 1,451 units of three estates it has never seen. This is the clean transfer test.
- **J1**: trained leave one file out on the agreed units of the other growth files. Files of one estate share templates (tabs, tables, closing lines), so J1 is optimistic: neighbours of a file sit in its training set.

Headline, Jx head (clean transfer), key of 1,256 units:

| System | Accuracy % [Wilson 95%] | Share to a person |
|---|---|---|
| Jev head alone | 86.2 [84.2, 88.0] | 0 |
| Jev head, 10% lowest margin unsure | 90.4 [88.6, 92.0] | 10 |
| Haiku run 1 / 2 / 3 | 96.5 / 97.3 / 90.4 (run 3 returned no label for 106 units) | 0 |
| Haiku majority of 3 | 97.8 [96.8, 98.5] | 0 |
| Haiku unanimous only | 98.3 [97.4, 98.9] | 10.3 |
| **Stack, margin cut 0.65 (36% of units to Haiku)** | **97.5 [96.5, 98.2]** | **4.5** |
| Stack, margin cut 0.76 (48% to Haiku) | 98.1 [97.2, 98.8] | 5.8 |
| Stack, cut 0.9 (74% to Haiku) | 98.4 [97.4, 98.9] | 8.1 |
| Jev and unanimous Haiku must agree | 99.4 [98.7, 99.7] | 21.7 |

- Cut chosen on estates A and B at 98% Jev-accepted accuracy (cut 0.55), applied to estate C: Jev keeps 73% of units at 94.3%, final accuracy 95.8% [93.1, 97.5], 0.9% to a person. At the 99% target (cut 0.73): Jev keeps 58% of estate C at 98.5%, final 98.2% [96.1, 99.2], 2.4% to a person. The dev-chosen cut did not transfer cleanly at the lower targets: Jev-accepted accuracy on C is 94% where A and B gave 95 to 98%.
- With the J1 head (leave one file out inside the growth corpus): Jev alone 91.9%; the stack at cut 0.65 gives 97.4% [96.3, 98.1] with only 26% of units sent to Haiku and 3.7% to a person; agreement rule 99.0% with 16.3% to a person. The 5-point gain of J1 over Jx comes from templates shared between the files of one estate, so treat Jx as the number for a new estate and J1 as what a head gives after a few files of the same estate are labelled.
- Against single annotators (all 1,451 units, cut 0.65, Jx): accepted units 94.9% of all; accuracy 89.3% [87.5, 90.8] against the author labels and 92.2% [90.7, 93.5] against the Opus labels. The contested units are where the stack is wrong: on the 195 units where author and Opus disagree it has no reference, and either label can be right.
- Haiku and Opus label with the same guide and are both models: their agreement on the key may overstate Haiku. The key leaves out the 13.4% of units on which the author and Opus differ.

**Against the span corpus.** The stack at cut 0.65 scores 97.5% here (36% to Haiku, 4.5% to a person) against 93.5% (40% to Haiku, 6.7% to a person) on the span corpus key. The Jev head alone is 86.2% against 82.2%, and Haiku's majority is 97.8% against 91.4%. The growth estates are easier: fewer multi-unit rules (7.8% of rules against 42%), tidier tables and a guide that was written with them in view. Do not read the 4 points as a gain of the stack.

**Cost and time per 100 units (token counts from the cassettes).** Haiku, 3 full runs on 1,451 units: 66 calls, 341,184 input and 234,637 output tokens, USD 0.151, which is USD 0.0104 per 100 units; median 15.2 s per call. Jev feature set J*: 158 calls, 1,987,453 input and 995,899 output tokens, USD 0.0835 (0.0058 per 100 units; the probes are 57 calls and 1,055,691 input tokens of that). The stack therefore costs at most USD 0.0162 per 100 units (Jev features plus 3 full Haiku runs; Haiku asked only about the units below the cut costs a little less, see RESULTS-4 Table 7) against 0.0104 for Haiku alone, and the 4.5% to a person against 10.3% for unanimous Haiku. Cost is not the case for the stack; the case is the share sent to a person (4.5% against 10.3% at about the same accuracy) and the speed of the half of the units Jev labels in about 0.3 s per call.

### Haiku with thinking switched off or at low effort (span corpus key, 3 runs each, `an23.out.md`)

| Haiku setting | Missing unit answers (3 runs) | One run, key accuracy % [Wilson 95%] (runs 1 / 2 / 3, missing = wrong) | Majority of 3, key | Unanimous: accepted share, accuracy | Calls per 3 runs per 100 units | Input / output tokens (3 runs) per 100 units | Median / p90 s per call | Seconds per 100 units (3 runs) | USD per 100 units (3 runs) |
|---|---|---|---|---|---|---|---|---|---|
| default (adaptive thinking), phase 3 runs | 0 | 90.5 [87.5, 92.9] / 91.0 [88.0, 93.2] / 91.8 [89.0, 94.0] | 91.4 [88.5, 93.6] | 90.8%, 95.3 [92.8, 96.9] | 4.8 | 13.3k / 21.0k | 18.6 / 23.2 | 89.6 | 0.0118 |
| thinking disabled | 58 | 72.7 [68.5, 76.5] / 72.9 [68.7, 76.7] / 71.4 [67.1, 75.3] | 74.0 [69.8, 77.8] | 81.1%, 81.2 [76.9, 84.8] | 4.8 | 13.3k / 1.7k | 1.8 / 2.2 | 9.2 | 0.0022 |
| effort low | 22 | 87.1 [83.7, 89.8] / 87.7 [84.4, 90.4] / 86.2 [82.8, 89.1] | 88.2 [84.9, 90.8] | 87.7%, 91.7 [88.6, 94.0] | 4.8 | 13.3k / 14.7k | 13.1 / 15.9 | 62.9 | 0.0087 |


Thinking off cuts cost and time by 5 to 10 times (USD 0.0022 per 100 units for 3 runs, 9 s) and also cuts accuracy by 17 points: 74.0% for the majority of 3, and 58 unit answers missing. Low effort loses 3 points (88.2% majority, 22 missing) for about 25% less cost and 30% less time. Default adaptive thinking is the setting that reaches 91.4%. System 2 stays on default thinking; the thinking budget is what Haiku's accuracy buys. These runs used the guide of the span corpus (GUIDE3.md); the missing answers are lines Haiku did not return.

## Spend (this request)

| Run | Calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|
| Jev stack features on gold5 (`cassette45`) | 158 | 1,987,453 | 995,899 | 0.0835 |
| Haiku, 3 runs on gold5 (`cassette5-haiku`) | 66 | 341,184 | 234,637 | 0.1514 |
| Haiku thinking off and low, span corpus (`cassette4-haiku-think`) | 54 | 150,837 | 92,876 | 0.0615 |
| Total | | | | 0.2964 |

The projection was USD 0.31. The earlier Jev transfer check (USD 0.0139) is in the table above. Running total on the owner's USD 50 line: about 1.27.

## Limits

- One author wrote all 22 files, and a tag was set before the annotator ran. The annotator saw only the guide and the sheet.
- The author knew guide 2.1 well and tuned D11 to D16 on the harbour set. The new estates test those rules and they hold at 86.6%, not at 95%.
- Agreed units are the easier units. A labeller scored on them is scored on a set that leaves out the 13.4% that two readers read differently.
- Multi-unit rules are 7.8% of the author's rules here (38 of 490) against 42% in the span corpus; this set is weaker for testing grouping.
- Intervals treat the units as independent; they sit in 22 files.

## Spend (gold set segment)

| Item | Calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|
| Jev transfer check (`cassette5`) | 60 | 330,749 | 90,879 | 0.0139 |
| Opus annotators (three agents) | not on the owner's API line | | | not priced |

Running total on the owner's USD 50 line: about 0.97 (0.30 phase 3, 0.657 phase 4 segment, 0.014 this run).

## Files

`prose5-src/`, `prose5/`, `build-prose5.ts`, `gold5.author.json`, `sheet5.ts`, `sheet-A.txt`, `sheet-B.txt`, `sheet-C.txt`, `labels-A-opus.tsv`, `labels-B-opus.tsv`, `labels-C-opus.tsv`, `agree5.ts`, `agree5.out.md`, `gold5.json`, `gold5.sha256`, `disagreements5.tsv`, `run5j.ts`, `an5j.ts`, `an5j.out.md`, `results5/`, `cassette5.jsonl.gz`; stack: `gold5s.json`, `build-gold5s.ts`, `src/corpus.ts`, `run45.sh`, `run5h.ts`, `run5h.sh`, `dumpfeat.ts`, `xhead.ts`, `an24.ts`, `an24-J1.out.md`, `an24-Jx.out.md`, `heads5/`, `results45/`, `results5h/`, `cassette45.jsonl.gz`, `cassette5-haiku.jsonl.gz`; thinking: `run4h2.ts`, `run4h2.sh`, `an23.ts`, `an23.out.md`, `cassette4-haiku-think.jsonl.gz`.
