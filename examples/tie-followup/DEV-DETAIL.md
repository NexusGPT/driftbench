## Dev comparison and tie accounting

Scores are percentages; ties are final no-follow-up ledger ties. Correct resolutions count unique pairs. All 14 ties received one follow-up per variant; all returned a forced choice.

| Model / benchmark | N | No follow-up | Direct | Reasoning | Promptfoo | Ties | Correct direct / reasoning |
|---|---:|---:|---:|---:|---:|---:|---|
| gpt-6.1-sol/jb | 30 | 96.67 | 96.67 | 96.67 | 96.67 | 0 | 0 / 0 |
| gpt-6.1-sol/mm | 20 | 75.00 | 75.00 | 75.00 | 80.00 | 0 | 0 / 0 |
| gpt-6.1-sol/wp | 30 | 46.67 | 53.33 | 53.33 | 53.33 | 6 | 2 / 2 |
| gpt-6-luna/jb | 30 | 86.67 | 93.33 | 90.00 | 86.67 | 2 | 2 / 1 |
| gpt-6-luna/mm | 20 | 85.00 | 85.00 | 85.00 | 80.00 | 0 | 0 / 0 |
| gpt-6-luna/wp | 30 | 50.00 | 50.00 | 50.00 | 50.00 | 0 | 0 / 0 |
| gemini-3.5-flash-lite/jb | 30 | 70.00 | 73.33 | 76.67 | 76.67 | 4 | 1 / 2 |
| gemini-3.5-flash-lite/mm | 20 | 80.00 | 80.00 | 80.00 | 82.50 | 0 | 0 / 0 |
| gemini-3.5-flash-lite/wp | 30 | 50.00 | 50.00 | 53.33 | 55.00 | 2 | 0 / 1 |

- Equal-weight nine-cell averages: no follow-up 71.111111%; direct 72.962963%; reasoning 73.333333%; promptfoo 73.425926%.
- Both variants beat the no-follow-up ledger on this dev sample: direct by 1.851852 percentage points and reasoning by 2.222222 points. Neither beats promptfoo in the nine-cell average: direct trails by 0.462963 points, reasoning by 0.092593 points.
- Direct improves three cells and preserves six versus baseline. Reasoning improves four and preserves five. Against promptfoo, direct wins two cells, ties three and loses four; reasoning wins two, ties four and loses three.
- Reasoning exceeds direct by 0.370370 percentage points: one net correct pair out of 270 in equal-cell scoring units. The actual dataset contains 240 model-pair evaluations, not 270. The variants resolve 6 versus 5 of 14 ties correctly, respectively.
- This one-pair selection edge is weak evidence; no superiority claim follows from it. The choice remains frozen regardless of these details and fresh outcomes.
