# Deciding fresh factual comparison

Seed 20261056, frozen labels, 60 fresh cases per procedure, one run each.

| Procedure | Correct | Wrong | Unscored | USD/100 |
|---|---|---|---|---|
| Main shipped (40aab095) | 48/60 | 8 | 4 | 0.04839 |
| PR 115 default (c5760332, under review) | 58/60 | 2 | 0 | 0.06163 |
| Frozen candidate: not yet the shipped default | 59/60 | 0 | 1 | 0.09158 |
| Inspect fact template | 57/60 | 3 | 0 | 0.05766 |

The candidate is not yet the shipped default. The scorer correction for escaped quotes is excluded. Full inputs and raw replies: recordings.jsonl. Source and input hashes: freeze.json.
