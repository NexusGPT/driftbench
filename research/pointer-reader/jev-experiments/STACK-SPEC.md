# Default two-class stack for unit labelling: specification

Status: measured defaults from phase 4 (`tables4.out.md`, Tables 1 to 5). Every number below is from a recorded run on the key of 465 units (units where annotator A and annotator C agree) over one fictional estate of 9 files. One fictional estate is one estate: the intervals are optimistic and the defaults need a re-check on a real one. Prices: Jev USD 0.042 per million input tokens, output free (owner, 17 October 2026); Haiku USD 0.10 per million input and 0.50 per million output (derived from receipts).

## 1. Vocabulary

- Unit: one sentence, list item, table cell, heading or front-matter value, with a number in its file.
- Label: one of `rule`, `prohibition`, `gate`, `example`, `description`, `none` (guide in `GUIDE4.md`).
- System 1: the first labeller (Jev). System 2: the second labeller (Haiku, 3 runs). Person: the human who labels what the stack leaves unsure.
- Margin: the probability of the most likely label minus the probability of the second most likely label, from system 1's calibrated vector. It ranges from 0 to 1.

## 2. What system 1 returns per unit

A vector of 6 probabilities that sum to 1 (one per label), the top label, and the margin. Nothing else is needed downstream.

How the vector is made (the J* head, 10.6 calls and 136k input tokens per 100 units):
- Per unit, Jev answers a native `choice` question whose options are the six labels, each with its one-line definition in `criteria`. Two windows are used: about 30 units per call, and the whole file per call. The answer carries `choice`, `confidence` and `probabilities` (rounded to 2 decimals).
- Per unit, 24 yes/no probes (one property each), about 30 units per call.
- Per neighbour pair, one question: joined, separate or not an instruction (whole file per call).
- Structure read from the document tree, no word list: container kind (sentence, list item, table cell, heading, front matter, quote), block kind, position in the block, table column, whether a list or table follows.
- The answers of the unit and of its two neighbours.
- All of these form one feature row. A multinomial logistic regression (L2 0.1) turns the row into the 6-probability vector.

Calibration:
- Trained on labelled units of the same estate, never on the file being labelled (leave one file out). Training labels: the key (human) or the Haiku majority of 3 runs. Measured: 82.2% with key labels and 82.8% with Haiku majority labels, so no human labels are required.
- Training size measured: the other 8 files, about 400 labelled units. Smaller training sets were not measured in phase 4: no claim.
- Without the calibrated head (raw `choice`, window of 30): 80.0%.
- Accuracy of the head before any unsure band: 82.2% [78.4, 85.4] on the key.

## 3. The unsure band: settings and measured defaults

Setting `margin_cut` (default 0.65). A unit whose system-1 margin is below `margin_cut` is "unsure at system 1" and goes to system 2. A unit at or above it is accepted with the system-1 label.

Equivalent setting `share_to_system2` (the lowest-margin share of units). Measured pairs (Table 5):

| margin_cut | share to system 2 | accuracy on accepted [Wilson 95%] | unsure after system 2 | USD per 100 units |
|---|---|---|---|---|
| 0.31 | 20% | 90.0 [86.9, 92.4] | 3.4% | 0.0091 |
| 0.49 | 30% | 92.5 [89.7, 94.6] | 5.2% | 0.0102 |
| 0.65 | 40% | 93.5 [90.8, 95.5] | 6.7% | 0.0112 |
| 0.73 | 50% | 95.1 [92.6, 96.8] | 7.5% | 0.0123 |
| 0.81 | 60% | 95.8 [93.4, 97.3] | 8.2% | 0.0133 |
| 0.99 | 100% | 95.3 [92.8, 96.9] | 9.2% | 0.0175 |

Choosing the cut on a new estate (measured on dev files, applied to test files): take the lowest `margin_cut` at which the system-1-accepted dev units reach the target accuracy.
- Target 98% gives cut 0.76. On the 317 test key units: system 1 keeps 44% at 99.3% [96.1, 99.9]; 56% go to system 2; the final accuracy is 94.5% [91.3, 96.6] with 8.2% unsure.
- Target 95% gives cut 0.67: keeps 57% at 97.8% [94.4, 99.1]; final 93.5% with 7.9% unsure.
- The default 0.65 is the rounded 95%-target cut. Rule of thumb from the table: above 0.8 the extra units sent to system 2 buy nothing.

## 4. Which units go to system 2

Exactly the units below `margin_cut`. System 2 labels the whole file in windows (one call per file, guide as system prompt), 3 runs. The windows are the same for every run. Units above the cut are still sent in the window as context, but their system-2 labels are ignored.

Cost of system 2 is dominated by sending the whole file: input tokens do not fall with the share, and only the output tokens fall. Table 5 prices already include this.

## 5. Accept rule

For each unit:
1. margin >= `margin_cut` -> accept the system-1 label.
2. Else, the 3 system-2 runs give the same label -> accept that label (even if it differs from the system-1 top label).
3. Else (runs differ) -> unsure; goes to a person.

Optional setting `require_agreement` (default off). When on, a unit is accepted only if system 1's top label equals the unanimous system-2 label. Measured: 369 of 465 units accepted at 97.0% [94.7, 98.3], 20.6% unsure (Table 5, "Accept only if the Jev head and a unanimous Haiku give the same label"). Use it when a wrong label costs more than a person's minute.

Alternative single-head mix (no cut): one head over the system-1 features and the 3 Haiku votes; hold back the lowest-confidence 10% -> 94.5% [91.9, 96.3]; 15% -> 95.9%; 20% -> 96.2% (Table 5). It needs all 3 Haiku runs on every unit, so it costs the full USD 0.0175 per 100 units.

## 6. What goes to a person

- Every unit that is unsure by rule 3 of section 5 (and, with `require_agreement` on, every unit where system 1 and system 2 differ).
- Nothing else by default. Accepted units are not sampled for review by the stack; a sampled audit is a separate setting and was not measured.
- Where the errors are (Table 6): `gate` is the weakest label (recall 47% for the J* head, 58% for the Haiku majority), mostly read as `rule`. Units inside multi-unit rules are the weakest position (J* 63.8%, Haiku majority 85.4%). Routing all predicted `gate` units to a person was not tested: no claim.

## 7. Failure handling (design decisions, not measured)

- A system-1 call fails: retry once; if it fails again, every unit of that window counts as below the cut.
- A system-2 run is missing or malformed for a unit: that run counts as a vote against unanimity.
- Never accept a unit with no label.

## 8. Pluggable labellers

Both classes implement one interface so a user can replace either: input is a window of numbered units with their structure and the guide; output is, per unit, a label and (system 1 only) a probability vector. The stack depends only on: the top label, the margin (system 1), and the equality of the runs' labels (system 2). A user labeller with no probabilities cannot be system 1; it can be system 2 if it is run 3 times or votes.

## 9. Testable properties (for a validator author)

- Margin is in [0, 1] and equals p1 - p2 of the sorted vector; a vector that does not sum to 1 within 0.01 is an error.
- Raising `margin_cut` never decreases the set sent to system 2 (monotone). At 0 nothing is sent; at 1 nearly everything is.
- With `margin_cut` 0 the result equals the system-1 labels, 0% unsure.
- A unit with three equal system-2 labels is never unsure at system 2; a unit with any difference always is.
- With `require_agreement` on, accepted units are a subset of those accepted with it off.
- Moving a unit from the "above the cut" side to the "below" side changes only that unit's route.
- Reference outcomes on the fictional estate (not a pass bar for another estate): cut 0.65 gives about 93.5% on accepted units and about 6.7% unsure; a new estate that falls more than 5 points below that after re-choosing the cut on its own dev files is a signal that the head needs more labelled units.

## 10. Costs per 100 units at the default (cut 0.65, 40% to system 2)

- System 1: 10.6 calls, 136.1k input tokens, 67.5k output tokens; median 0.31 s and 90th percentile 0.49 s per call; USD 0.0057 (input only).
- System 2 (3 runs, 1.6 calls per run per 100 units): USD about 0.0055 (output for the share sent plus the full input of each call); Table 5 total USD 0.0112 and about 39.5 s per 100 units when Jev and Haiku run one after the other.
- Per 100 units, Haiku alone (3 runs): USD 0.0118 and about 89.6 s; one Haiku run: USD 0.0037 to 0.0041.
