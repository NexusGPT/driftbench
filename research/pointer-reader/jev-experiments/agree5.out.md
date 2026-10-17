| Estate | Files | Units | Same label | Agreement % [Wilson 95%] | Cohen kappa | Instruction vs not, % |
|---|---|---|---|---|---|---|
| A: support prose (broadband) | 8 | 555 | 491 | 88.5 [85.5, 90.9] | 0.848 | 95.9 |
| B: code-interpreter estate (bookkeepers) | 8 | 486 | 428 | 88.1 [84.9, 90.7] | 0.842 | 94.4 |
| C: channel-tabbed prompt (guesthouses) | 6 | 410 | 337 | 82.2 [78.2, 85.6] | 0.774 | 92.4 |
| All | 22 | 1451 | 1256 | 86.6 [84.7, 88.2] | 0.825 | 94.4 |

Confusion, author (rows) against Opus (columns), all units:

| author \ opus | rule | prohibition | gate | example | description | none |
|---|---|---|---|---|---|---|
| rule | 282 | 61 | 19 | 0 | 4 | 0 |
| prohibition | 0 | 129 | 0 | 0 | 0 | 0 |
| gate | 14 | 13 | 54 | 0 | 1 | 0 |
| example | 0 | 0 | 0 | 49 | 0 | 0 |
| description | 55 | 17 | 4 | 7 | 441 | 0 |
| none | 0 | 0 | 0 | 0 | 0 | 301 |

Rules as spans (instruction units; a group of units is one rule): author 490 rules (38 multi-unit), Opus 473 (110 multi-unit). Same units and same kind: 310; same units: 356. Span F1 with kind: 64.4%, without kind: 73.9%.

Agreed units (author = Opus): 1256 of 1451. By label: {"rule":282,"prohibition":129,"gate":54,"example":49,"description":441,"none":301}.

Frozen: gold5.json sha256 1c7c7afde32a4e0647b6ad9000007a575f9bb89b3130e53329da7df748149ed6
