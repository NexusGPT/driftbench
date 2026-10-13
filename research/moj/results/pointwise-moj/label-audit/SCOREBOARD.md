# Blind Verify practice label audit

Screened 95 items. Proved final-answer correctness or error on 48; unresolved on 47.
Recorded fail but proved correct: 6. Recorded pass but proved wrong: 2.

Official labels and model predictions are unchanged. The second scoreboard flips only listed, proved contradictions.
This is a sensitivity analysis, not a new official result or an estimate of errors outside the checked subset.
Checks use explicit question-specific formalizations and no model execution. Full coverage means every item was screened, not that every item was proved.
Missing final answers, semantic ambiguity and SVG tolerance checks cannot authorize corrections.

The rubric comparator uses the recorded promptfoo llm-rubric template with the same gpt-6-luna model.
Its missing recordings are excluded and each denominator is explicit. Matched tables restrict every arm to the same entries.
All-practice scores include tuning entries; validation remains separately identified. No threshold is refitted after label correction.

## all practice

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 95 | 73.7 | 65.6 | 52.9 | 78.2 | 100.0 | 0.063251 |
| Error hunt tuning rule | 95 | 61.1 | 67.1 | 76.5 | 57.7 | 209.5 | 0.134251 |
| promptfoo rubric / Luna | 86 | 69.8 | 67.0 | 62.5 | 71.4 | 100.0 | 0.075833 |
| Always fail | 95 | 82.1 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 95 | 82.1 | 78.3 | 71.4 | 85.1 | 100.0 | 0.063251 |
| Error hunt tuning rule | 95 | 67.4 | 73.9 | 85.7 | 62.2 | 209.5 | 0.134251 |
| promptfoo rubric / Luna | 86 | 77.9 | 78.3 | 78.9 | 77.6 | 100.0 | 0.075833 |
| Always fail | 95 | 77.9 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## validation

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 49 | 81.6 | 77.4 | 71.4 | 83.3 | 100.0 | 0.047384 |
| Error hunt tuning rule | 49 | 59.2 | 70.2 | 85.7 | 54.8 | 200.0 | 0.109238 |
| promptfoo rubric / Luna | 44 | 77.3 | 74.9 | 71.4 | 78.4 | 100.0 | 0.063595 |
| Always fail | 49 | 85.7 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 49 | 89.8 | 89.4 | 88.9 | 90.0 | 100.0 | 0.047384 |
| Error hunt tuning rule | 49 | 67.3 | 80.0 | 100.0 | 60.0 | 200.0 | 0.109238 |
| promptfoo rubric / Luna | 44 | 86.4 | 87.3 | 88.9 | 85.7 | 100.0 | 0.063595 |
| Always fail | 49 | 81.6 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## proved subset

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 48 | 79.2 | 77.5 | 75.0 | 80.0 | 100.0 | 0.036173 |
| Error hunt tuning rule | 48 | 72.9 | 78.8 | 87.5 | 70.0 | 202.1 | 0.105248 |
| promptfoo rubric / Luna | 41 | 75.6 | 75.4 | 75.0 | 75.8 | 100.0 | 0.062790 |
| Always fail | 48 | 83.3 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 48 | 95.8 | 97.2 | 100.0 | 94.4 | 100.0 | 0.036173 |
| Error hunt tuning rule | 48 | 85.4 | 90.3 | 100.0 | 80.6 | 202.1 | 0.105248 |
| promptfoo rubric / Luna | 41 | 92.7 | 95.0 | 100.0 | 90.0 | 100.0 | 0.062790 |
| Always fail | 48 | 75.0 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## proved validation subset

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 32 | 84.4 | 82.6 | 80.0 | 85.2 | 100.0 | 0.033309 |
| Error hunt tuning rule | 32 | 71.9 | 75.2 | 80.0 | 70.4 | 200.0 | 0.093765 |
| promptfoo rubric / Luna | 27 | 74.1 | 76.4 | 80.0 | 72.7 | 100.0 | 0.055696 |
| Always fail | 32 | 84.4 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 32 | 96.9 | 98.0 | 100.0 | 96.0 | 100.0 | 0.033309 |
| Error hunt tuning rule | 32 | 84.4 | 90.0 | 100.0 | 80.0 | 200.0 | 0.093765 |
| promptfoo rubric / Luna | 27 | 88.9 | 92.5 | 100.0 | 85.0 | 100.0 | 0.055696 |
| Always fail | 32 | 78.1 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## all practice matched rubric

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 86 | 74.4 | 65.0 | 50.0 | 80.0 | 100.0 | 0.065342 |
| Error hunt tuning rule | 86 | 60.5 | 66.1 | 75.0 | 57.1 | 209.3 | 0.137714 |
| promptfoo rubric / Luna | 86 | 69.8 | 67.0 | 62.5 | 71.4 | 100.0 | 0.075833 |
| Always fail | 86 | 81.4 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 86 | 82.6 | 77.5 | 68.4 | 86.6 | 100.0 | 0.065342 |
| Error hunt tuning rule | 86 | 66.3 | 72.7 | 84.2 | 61.2 | 209.3 | 0.137714 |
| promptfoo rubric / Luna | 86 | 77.9 | 78.3 | 78.9 | 77.6 | 100.0 | 0.075833 |
| Always fail | 86 | 77.9 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## validation matched rubric

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 44 | 81.8 | 77.6 | 71.4 | 83.8 | 100.0 | 0.047577 |
| Error hunt tuning rule | 44 | 56.8 | 68.5 | 85.7 | 51.4 | 200.0 | 0.110497 |
| promptfoo rubric / Luna | 44 | 77.3 | 74.9 | 71.4 | 78.4 | 100.0 | 0.063595 |
| Always fail | 44 | 84.1 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 44 | 90.9 | 90.2 | 88.9 | 91.4 | 100.0 | 0.047577 |
| Error hunt tuning rule | 44 | 65.9 | 78.6 | 100.0 | 57.1 | 200.0 | 0.110497 |
| promptfoo rubric / Luna | 44 | 86.4 | 87.3 | 88.9 | 85.7 | 100.0 | 0.063595 |
| Always fail | 44 | 79.5 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## proved subset matched rubric

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 41 | 80.5 | 78.4 | 75.0 | 81.8 | 100.0 | 0.034095 |
| Error hunt tuning rule | 41 | 73.2 | 78.6 | 87.5 | 69.7 | 202.4 | 0.105018 |
| promptfoo rubric / Luna | 41 | 75.6 | 75.4 | 75.0 | 75.8 | 100.0 | 0.062790 |
| Always fail | 41 | 80.5 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 41 | 97.6 | 98.3 | 100.0 | 96.7 | 100.0 | 0.034095 |
| Error hunt tuning rule | 41 | 85.4 | 90.0 | 100.0 | 80.0 | 202.4 | 0.105018 |
| promptfoo rubric / Luna | 41 | 92.7 | 95.0 | 100.0 | 90.0 | 100.0 | 0.062790 |
| Always fail | 41 | 73.2 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## proved validation subset matched rubric

### official

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 27 | 85.2 | 83.2 | 80.0 | 86.4 | 100.0 | 0.031019 |
| Error hunt tuning rule | 27 | 70.4 | 74.1 | 80.0 | 68.2 | 200.0 | 0.092952 |
| promptfoo rubric / Luna | 27 | 74.1 | 76.4 | 80.0 | 72.7 | 100.0 | 0.055696 |
| Always fail | 27 | 81.5 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

### proof corrected only

| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MoJ frozen solve+compare | 27 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 0.031019 |
| Error hunt tuning rule | 27 | 85.2 | 90.0 | 100.0 | 80.0 | 200.0 | 0.092952 |
| promptfoo rubric / Luna | 27 | 88.9 | 92.5 | 100.0 | 85.0 | 100.0 | 0.055696 |
| Always fail | 27 | 74.1 | 50.0 | 0.0 | 100.0 | 0.0 | 0.000000 |

## Proven label contradictions

| Item id | Half | Official | Corrected | Check |
|---|---|---|---|---|
| `799919e29bafa202e0028952ff76d912_deee86a59cea577b40827ba2735e51f2` | tune | fail | pass | [checks_tune_math.py](checks_tune_math.py) |
| `8dce745bcd66e7dc916e9f3549d8ebc1_4495bceb02b2986125965eb7cb6c2b98` | tune | fail | pass | [checks_tune_math.py](checks_tune_math.py) |
| `d39f096bb2596eb7d8955356ef44a14e_cc7a467fa14f91c15dd31328e13f485e` | tune | fail | pass | [checks_tune_math.py](checks_tune_math.py) |
| `daafa66d5d745cf90a6a9f7e7476456e_ee51a4efa53adaad8c8b234938587bc9` | tune | pass | fail | [checks_dates.py](checks_dates.py) |
| `514cb7d27518d395ec9a46c2ae62c9bf_6a8c772c3cbf9a7e26dae82deafbc213` | valid | pass | fail | [checks_logic.py](checks_logic.py) |
| `987731fefdee670139b52a3c2cd13b54_63abd6b1489e90a7836c25efd043d174` | valid | fail | pass | [checks_valid_math_b.py](checks_valid_math_b.py) |
| `aee1de22ebcbd6dffb545f85c2cc6d3c_4ad6596d535addc90e3929c4cd601d2a` | valid | fail | pass | [checks_constraints.py](checks_constraints.py) |
| `d29e283a52241c0a9a32224b711237bd_cab7eb980622deaad71cf6fe7e803264` | valid | fail | pass | [checks_logic.py](checks_logic.py) |

Full certificates, boundaries for every unresolved item, code hashes and fixed predictions: [report.json](report.json).
Replay: `python3 results/pointwise-moj/label-audit/score.py` from `research/moj`. No network or model is required.
