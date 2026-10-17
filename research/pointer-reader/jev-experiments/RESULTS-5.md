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

Not run: the J* head and Haiku (3 runs) on this set, and so no number for the stack on a new estate yet. Projected cost: Haiku 3 runs on 1,451 units about USD 0.16 (measured USD 0.064 per 597 units), J* head about USD 0.08 (measured 136k input tokens per 100 units). That would take the owner line from about 0.97 to about 1.21, above the USD 1.00 point the lead set for asking, so it waits for a go.

## Limits

- One author wrote all 22 files, and a tag was set before the annotator ran. The annotator saw only the guide and the sheet.
- The author knew guide 2.1 well and tuned D11 to D16 on the harbour set. The new estates test those rules and they hold at 86.6%, not at 95%.
- Agreed units are the easier units. A labeller scored on them is scored on a set that leaves out the 13.4% that two readers read differently.
- Multi-unit rules are 7.8% of the author's rules here (38 of 490) against 42% in the span corpus; this set is weaker for testing grouping.
- Intervals treat the units as independent; they sit in 22 files.

## Spend (segment)

| Item | Calls | Input tokens | Output tokens | USD |
|---|---|---|---|---|
| Jev transfer check (`cassette5`) | 60 | 330,749 | 90,879 | 0.0139 |
| Opus annotators (three agents) | not on the owner's API line | | | not priced |

Running total on the owner's USD 50 line: about 0.97 (0.30 phase 3, 0.657 phase 4 segment, 0.014 this run).

## Files

`prose5-src/`, `prose5/`, `build-prose5.ts`, `gold5.author.json`, `sheet5.ts`, `sheet-A.txt`, `sheet-B.txt`, `sheet-C.txt`, `labels-A-opus.tsv`, `labels-B-opus.tsv`, `labels-C-opus.tsv`, `agree5.ts`, `agree5.out.md`, `gold5.json`, `gold5.sha256`, `disagreements5.tsv`, `run5j.ts`, `an5j.ts`, `an5j.out.md`, `results5/`, `cassette5.jsonl.gz`.
