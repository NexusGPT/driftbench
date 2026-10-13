cohort 791 items; per class {'language mixing': 190, 'linguistics': 76, 'reasoning': 293, 'chat': 70, 'safety': 162}; pointwise spend 0.80931 USD

=== arm: split fusion plus harm gate ===

official: frozen 88.84, arm 89.65, difference +0.81
| Class | n | Frozen % | Arm % |
|---|---:|---:|---:|
| reasoning | 293 | 95.90 | 96.08 |
| chat | 70 | 68.21 | 68.21 |
| linguistics | 76 | 90.46 | 90.46 |
| language mixing | 190 | 99.34 | 99.08 |
| safety | 162 | 90.28 | 94.44 |
paired 95% interval (bootstrap within class, macro mean): -0.08 to +1.74
item wins / losses / unchanged: 15 / 6 / 770; exact two-sided sign test p = 0.07835
languages down more than 1.0 point: ru -1.61 (n=31), ca -1.43 (n=35); worst ru -1.61

refusal-excluded: frozen 89.30, arm 90.13, difference +0.84
| Class | n | Frozen % | Arm % |
|---|---:|---:|---:|
| reasoning | 293 | 95.90 | 96.08 |
| chat | 70 | 68.21 | 68.21 |
| linguistics | 76 | 90.46 | 90.46 |
| language mixing | 190 | 99.34 | 99.08 |
| safety | 158 | 92.56 | 96.84 |
paired 95% interval (bootstrap within class, macro mean): -0.06 to +1.76
item wins / losses / unchanged: 15 / 6 / 766; exact two-sided sign test p = 0.07835
languages down more than 1.0 point: ru -1.61 (n=31), ca -1.43 (n=35); worst ru -1.61

=== arm: cheater control: split fusion plus refusal always wins ===

official: frozen 88.84, arm 89.86, difference +1.02
| Class | n | Frozen % | Arm % |
|---|---:|---:|---:|
| reasoning | 293 | 95.90 | 96.08 |
| chat | 70 | 68.21 | 66.79 |
| linguistics | 76 | 90.46 | 90.46 |
| language mixing | 190 | 99.34 | 99.08 |
| safety | 162 | 90.28 | 96.91 |
paired 95% interval (bootstrap within class, macro mean): -0.39 to +2.43
item wins / losses / unchanged: 20 / 8 / 763; exact two-sided sign test p = 0.0357
languages down more than 1.0 point: ru -4.84 (n=31), ca -1.43 (n=35); worst ru -4.84

refusal-excluded: frozen 89.30, arm 90.35, difference +1.06
| Class | n | Frozen % | Arm % |
|---|---:|---:|---:|
| reasoning | 293 | 95.90 | 96.08 |
| chat | 70 | 68.21 | 66.79 |
| linguistics | 76 | 90.46 | 90.46 |
| language mixing | 190 | 99.34 | 99.08 |
| safety | 158 | 92.56 | 99.37 |
paired 95% interval (bootstrap within class, macro mean): -0.36 to +2.47
item wins / losses / unchanged: 20 / 8 / 759; exact two-sided sign test p = 0.0357
languages down more than 1.0 point: ru -4.84 (n=31), ca -1.43 (n=35); worst ru -4.84

=== arm: plus machine solve (pre-registered) ===

official: frozen 88.84, arm 89.77, difference +0.93
| Class | n | Frozen % | Arm % |
|---|---:|---:|---:|
| reasoning | 293 | 95.90 | 96.67 |
| chat | 70 | 68.21 | 68.21 |
| linguistics | 76 | 90.46 | 90.46 |
| language mixing | 190 | 99.34 | 99.08 |
| safety | 162 | 90.28 | 94.44 |
paired 95% interval (bootstrap within class, macro mean): -0.01 to +1.90
item wins / losses / unchanged: 20 / 7 / 764; exact two-sided sign test p = 0.01916
languages down more than 1.0 point: ru -1.61 (n=31), zh -1.56 (n=32), ca -1.43 (n=35); worst ru -1.61

refusal-excluded: frozen 89.30, arm 90.25, difference +0.96
| Class | n | Frozen % | Arm % |
|---|---:|---:|---:|
| reasoning | 293 | 95.90 | 96.67 |
| chat | 70 | 68.21 | 68.21 |
| linguistics | 76 | 90.46 | 90.46 |
| language mixing | 190 | 99.34 | 99.08 |
| safety | 158 | 92.56 | 96.84 |
paired 95% interval (bootstrap within class, macro mean): +0.01 to +1.92
item wins / losses / unchanged: 20 / 7 / 760; exact two-sided sign test p = 0.01916
languages down more than 1.0 point: ru -1.61 (n=31), zh -1.56 (n=32), ca -1.43 (n=35); worst ru -1.61
