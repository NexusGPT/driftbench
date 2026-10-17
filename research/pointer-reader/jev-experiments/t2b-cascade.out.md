### Second labeller and the cascade (arm e), and the best combination (arm f)

Haiku = `claude-haiku-5-5`, the labelling guide as system prompt, windows of 40 units, 3 runs. "To Haiku" = share of units whose first-labeller confidence is below the margin m.

| Design | Test acc % (abstain %) | All acc % (abstain %) | Agreed acc % (abstain %) |
|---|---|---|---|
| Jev arm 0 alone (3-pass mean) | 73.3 (0.0) | 71.9 (0.0) | 72.7 (0.0) |
| Jev stacker alone | 82.7 (0.0) | 82.2 (0.0) | 83.4 (0.0) |
| Jev stacker, abstain lowest 10% | 84.9 (9.9) | 84.7 (10.1) | 86.1 (10.1) |
| Jev stacker, abstain lowest 30% | 89.4 (29.3) | 90.7 (30.0) | 92.4 (30.0) |
| Haiku, one run (run 1) | 94.7 (0.0) | 94.6 (0.0) | 95.9 (0.0) |
| Haiku, majority of 3 | 95.7 (0.0) | 95.8 (0.0) | 96.8 (0.0) |
| Haiku, unanimous of 3 else abstain | 98.0 (5.9) | 97.5 (5.5) | 98.0 (4.1) |
| e: arm 0 as first labeller, m=0.3 (to Haiku 43%), abstain if Haiku not unanimous | 87.1 (2.9) | 87.4 (2.8) | 88.3 (2.3) |
| e: arm 0 as first labeller, m=0.6 (to Haiku 74%), abstain if Haiku not unanimous | 96.6 (5.3) | 96.1 (4.9) | 96.9 (4.1) |
| e: arm 0 as first labeller, m=0.9 (to Haiku 99%), abstain if Haiku not unanimous | 98.0 (5.9) | 97.5 (5.5) | 98.0 (4.1) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority | 97.1 (26.4) | 97.9 (28.3) | 98.8 (27.9) |
| e: arm 0 as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 98.9 (29.9) | 99.0 (31.0) | 99.3 (29.5) |
| f: stacker as first labeller, m=0.3 (to Haiku 14%), abstain if Haiku not unanimous | 86.5 (1.3) | 86.8 (1.3) | 88.2 (1.2) |
| f: stacker as first labeller, m=0.6 (to Haiku 33%), abstain if Haiku not unanimous | 92.3 (3.2) | 92.6 (3.0) | 94.0 (2.5) |
| f: stacker as first labeller, m=0.9 (to Haiku 71%), abstain if Haiku not unanimous | 96.9 (5.1) | 96.7 (4.9) | 97.3 (3.5) |
| f: stacker as first labeller: accept iff it equals Haiku majority | 96.5 (15.5) | 97.2 (16.8) | 97.9 (15.9) |
| f: stacker as first labeller: accept iff it equals Haiku majority and Haiku unanimous | 98.7 (20.0) | 98.7 (20.6) | 98.9 (18.7) |
| f2: one stacker over Jev features + Haiku vote counts | 94.1 (0.0) | 94.0 (0.0) | 95.2 (0.0) |
| f2, abstain lowest 5% | 95.8 (5.6) | 95.8 (5.0) | 96.7 (4.6) |
| f2, abstain lowest 10% | 96.7 (10.7) | 96.8 (10.1) | 97.5 (9.3) |
| f2, abstain lowest 15% | 97.8 (14.9) | 98.2 (15.1) | 98.6 (13.2) |
| f2, abstain lowest 20% | 97.7 (19.7) | 98.3 (19.9) | 98.7 (18.2) |

Haiku cost: 54 calls for 3 passes.

