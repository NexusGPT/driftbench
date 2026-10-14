// Written by tools/readme-charts.mjs from the result files it names. Do not edit by hand.
window.CHART_DATA = {
  "judge-leads": {
    "kind": "pairs",
    "kicker": "Judge accuracy · held-out cases · Claude Haiku 5.5 on both sides",
    "title": "5 clear wins over the default judges.",
    "key": [
      "driftbench, shipped judge",
      "the other tool's default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "",
    "axis": "score out of 100: correct verdicts, % of cases",
    "groups": [
      {
        "header": "DeepEval 4.2.8, default metrics, 72 cases each",
        "rows": [
          {
            "label": "Hallucination",
            "a": 98.61,
            "b": 50,
            "aText": "71",
            "bText": "36",
            "aCi": [
              92.54,
              99.75
            ],
            "bCi": [
              38.75,
              61.25
            ],
            "tag": "ahead"
          },
          {
            "label": "Faithfulness",
            "a": 98.61,
            "b": 50,
            "aText": "71",
            "bText": "36",
            "aCi": [
              92.54,
              99.75
            ],
            "bCi": [
              38.75,
              61.25
            ],
            "tag": "ahead"
          },
          {
            "label": "Turn relevancy",
            "a": 90.28,
            "b": 50,
            "aText": "65",
            "bText": "36",
            "aCi": [
              81.26,
              95.21
            ],
            "bCi": [
              38.75,
              61.25
            ],
            "tag": "ahead"
          },
          {
            "label": "Completeness",
            "a": 97.22,
            "b": 63.89,
            "aText": "70",
            "bText": "46",
            "aCi": [
              90.43,
              99.23
            ],
            "bCi": [
              52.35,
              74.02
            ],
            "tag": "ahead"
          },
          {
            "label": "Role adherence",
            "a": 100,
            "b": 87.5,
            "aText": "72",
            "bText": "63",
            "aCi": [
              94.93,
              100
            ],
            "bCi": [
              77.92,
              93.28
            ],
            "tag": "ahead"
          }
        ]
      }
    ],
    "note": "72 cases per row · lines: 95% interval"
  },
  "judge-cost": {
    "kind": "pairs",
    "kicker": "Judge cost · US dollars per 100 cases · Claude Haiku 5.5",
    "title": "Cheaper on 4 of 5 rows.",
    "key": [
      "driftbench, shipped judge",
      "the other tool's default"
    ],
    "min": 0,
    "max": 0.15,
    "ticks": [
      0,
      0.05,
      0.1,
      0.15
    ],
    "tick": "$",
    "axis": "US dollars per 100 judged cases",
    "groups": [
      {
        "header": "",
        "rows": [
          {
            "label": "Inspect, grader panel",
            "a": 0.07590650000000003,
            "b": 0.13815413333333335,
            "aText": "$0.076",
            "bText": "$0.138"
          },
          {
            "label": "Inspect, panel on borderline cases",
            "a": 0.0782674,
            "b": 0.12479490000000004,
            "aText": "$0.078",
            "bText": "$0.125"
          },
          {
            "label": "Inspect, model-graded QA",
            "a": 0.04762383333333334,
            "b": 0.06228716666666667,
            "aText": "$0.048",
            "bText": "$0.062"
          },
          {
            "label": "Inspect, model-graded fact",
            "a": 0.04762383333333334,
            "b": 0.05957716666666667,
            "aText": "$0.048",
            "bText": "$0.060"
          },
          {
            "label": "Langfuse, Correctness template",
            "a": 0.05400083333333333,
            "b": 0.05248416666666667,
            "aText": "$0.054",
            "bText": "$0.052"
          }
        ]
      }
    ],
    "note": "60 to 120 cases per row · recorded spend"
  },
  "mm-eval-sealed-test": {
    "kind": "pairs",
    "kicker": "MM-Eval · sealed test set · 1,212 items, scored once",
    "title": "A panel when unsure: 89.49 to 91.54.",
    "key": [
      "first judge, then a panel if unsure",
      "first judge alone"
    ],
    "min": 70,
    "max": 100,
    "ticks": [
      70,
      80,
      90,
      100
    ],
    "tick": "",
    "axis": "accuracy, the benchmark's own score (axis starts at 70)",
    "groups": [
      {
        "header": "",
        "rows": [
          {
            "label": "All five subsets",
            "sub": "1,212 items",
            "a": 91.54,
            "b": 89.49,
            "aText": "91.54",
            "bText": "89.49",
            "tag": "+2.05"
          },
          {
            "label": "Linguistics",
            "sub": "45 items",
            "a": 94.44,
            "b": 90.56,
            "aText": "94.44",
            "bText": "90.56",
            "tag": "+3.89"
          },
          {
            "label": "Safety",
            "sub": "195 items",
            "a": 92.31,
            "b": 89.74,
            "aText": "92.31",
            "bText": "89.74",
            "tag": "+2.56"
          },
          {
            "label": "Chat",
            "sub": "46 items",
            "a": 75,
            "b": 72.83,
            "aText": "75.00",
            "bText": "72.83",
            "tag": "+2.17"
          },
          {
            "label": "Reasoning",
            "sub": "615 items",
            "a": 96.59,
            "b": 95.37,
            "aText": "96.59",
            "bText": "95.37",
            "tag": "+1.22"
          },
          {
            "label": "Language mixing",
            "sub": "311 items",
            "a": 99.36,
            "b": 98.95,
            "aText": "99.36",
            "bText": "98.95",
            "tag": "+0.40"
          }
        ]
      }
    ],
    "note": "1,212 items · gain 2.05 points, 95% interval 1.02 to 3.29"
  },
  "testgen-budget": {
    "kind": "triples",
    "kicker": "Test generation · fictional Acme agent · 13 planted faults · 30 seeds",
    "title": "20 tests find 9 of 13 planted faults.",
    "key": [
      "driftbench selector",
      "pairwise covering",
      "random sampling"
    ],
    "min": 7,
    "max": 10,
    "ticks": [
      7,
      8,
      9,
      10
    ],
    "tick": "",
    "axis": "planted faults caught, of 13 (axis starts at 7)",
    "groups": [
      {
        "label": "20 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 8,
            "text": "8",
            "ci": null
          },
          {
            "series": 2,
            "value": 8.37,
            "text": "8.37",
            "ci": [
              8.08,
              8.65
            ]
          }
        ]
      },
      {
        "label": "50 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 2,
            "value": 8.97,
            "text": "8.97",
            "ci": [
              8.9,
              9.03
            ]
          }
        ]
      },
      {
        "label": "100 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 2,
            "value": 9,
            "text": "9",
            "ci": null
          }
        ]
      },
      {
        "label": "200 tests",
        "bars": [
          {
            "series": 0,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 1,
            "value": 9,
            "text": "9",
            "ci": null
          },
          {
            "series": 2,
            "value": 9,
            "text": "9",
            "ci": null
          }
        ]
      }
    ],
    "note": "Mean over 30 seeds · lines: 95% interval · no model call"
  },
  "self-tests": {
    "kind": "single",
    "kicker": "Self-tests · cases built by code with a known answer",
    "title": "7,454 planted-truth cases test driftbench itself.",
    "key": [
      "holds a floor in CI",
      "no floor yet"
    ],
    "min": 0,
    "max": 2500,
    "ticks": [
      0,
      1000,
      2000
    ],
    "tick": ",",
    "axis": "planted-truth cases in the suite",
    "rows": [
      {
        "label": "Whole pipeline",
        "value": 2384,
        "text": "2,384",
        "series": 0,
        "sub": "floor: level 9"
      },
      {
        "label": "Test generator",
        "value": 2033,
        "text": "2,033",
        "series": 1,
        "sub": "no floor yet"
      },
      {
        "label": "Code-agent estates",
        "value": 1170,
        "text": "1,170",
        "series": 1,
        "sub": "no floor yet"
      },
      {
        "label": "Statistics",
        "value": 651,
        "text": "651",
        "series": 0,
        "sub": "floor: level 7"
      },
      {
        "label": "Judges",
        "value": 638,
        "text": "638",
        "series": 0,
        "sub": "floor: level 7"
      },
      {
        "label": "Map extraction",
        "value": 578,
        "text": "578",
        "series": 0,
        "sub": "floor: level 8"
      }
    ],
    "note": "Floor: the level CI refuses to go below"
  },
  "capability-matrix": {
    "kind": "stacked",
    "kicker": "Capabilities · 30 rows · 8 tools",
    "title": "All 30. The next best: 12 in full.",
    "key": [
      "in full",
      "in part",
      "not found"
    ],
    "min": 0,
    "max": 30,
    "ticks": [
      0,
      10,
      20,
      30
    ],
    "tick": "",
    "axis": "capabilities, of 30",
    "rows": [
      {
        "label": "driftbench",
        "parts": [
          30,
          0,
          0
        ],
        "ours": true
      },
      {
        "label": "deepeval",
        "parts": [
          12,
          14,
          4
        ]
      },
      {
        "label": "langwatch",
        "parts": [
          12,
          11,
          7
        ]
      },
      {
        "label": "promptfoo",
        "parts": [
          10,
          15,
          5
        ]
      },
      {
        "label": "langfuse",
        "parts": [
          10,
          7,
          13
        ]
      },
      {
        "label": "inspect_ai",
        "parts": [
          9,
          14,
          7
        ]
      },
      {
        "label": "opik",
        "parts": [
          9,
          10,
          11
        ]
      },
      {
        "label": "braintrust",
        "parts": [
          2,
          11,
          17
        ]
      }
    ],
    "note": "Read from each tool's docs and source"
  },
  "bench-judgebench": {
    "kind": "ranked",
    "kicker": "JudgeBench · sealed test · official pair score",
    "title": "JudgeBench: driftbench 88.9, ahead of DeepEval at 86.3.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.889,
            "ours": true
          },
          {
            "name": "DeepEval",
            "score": 86.296,
            "pattern": "dots"
          },
          {
            "name": "LangWatch",
            "score": 83.704,
            "pattern": "light"
          },
          {
            "name": "promptfoo",
            "score": 82.963,
            "pattern": "hatch"
          },
          {
            "name": "Inspect",
            "score": 80,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 74.815,
            "pattern": "lines"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 270 pairs. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-mm-eval": {
    "kind": "ranked",
    "kicker": "MM-Eval · sealed test · the benchmark's own score",
    "title": "MM-Eval: driftbench 88.9, ahead of promptfoo at 86.5.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "591 items",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.863,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 86.45,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 84.095,
            "pattern": "dots",
            "refused": 3
          },
          {
            "name": "LangWatch",
            "score": 83.869,
            "pattern": "light",
            "refused": 7
          },
          {
            "name": "Inspect",
            "score": 75.356,
            "pattern": "cross",
            "refused": 7
          },
          {
            "name": "Langfuse",
            "score": 73.453,
            "pattern": "lines",
            "refused": 6
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 591 items. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-rubricbench": {
    "kind": "ranked",
    "kicker": "RubricBench · test split · both orders of every pair",
    "title": "RubricBench: driftbench 82.7, ahead of DeepEval at 77.6.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "1,580 games",
        "bars": [
          {
            "name": "driftbench",
            "score": 82.658,
            "ours": true
          },
          {
            "name": "DeepEval",
            "score": 77.595,
            "pattern": "dots",
            "refused": 1
          },
          {
            "name": "promptfoo",
            "score": 75.57,
            "pattern": "hatch"
          },
          {
            "name": "LangWatch",
            "score": 74.937,
            "pattern": "light"
          },
          {
            "name": "Inspect",
            "score": 26.582,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 25.063,
            "pattern": "lines",
            "refused": 1
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 1,580 games. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-verify": {
    "kind": "ranked",
    "kicker": "LongJudgeBench verify · test split · is the final answer correct",
    "title": "Verify: driftbench 74.2, behind Langfuse at 75.1.",
    "key": [
      {
        "label": "driftbench",
        "style": "ours"
      },
      {
        "label": "promptfoo llm-rubric",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "GEval, threshold 0.5 (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278)",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9)",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "LLM-as-a-Judge Boolean (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "221 items",
        "bars": [
          {
            "name": "Langfuse",
            "score": 75.113,
            "pattern": "lines"
          },
          {
            "name": "driftbench",
            "score": 74.208,
            "ours": true
          },
          {
            "name": "Inspect",
            "score": 73.303,
            "pattern": "cross"
          },
          {
            "name": "LangWatch",
            "score": 73.303,
            "pattern": "light"
          },
          {
            "name": "promptfoo",
            "score": 71.946,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 58.824,
            "pattern": "dots"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 221 items. Every competitor ran on this model only. A refused item counts as wrong."
  },
  "bench-writing": {
    "kind": "ranked",
    "kicker": "LongJudgeBench writing preference · test split · both orders",
    "title": "Writing: driftbench 67.6 with its reader-first setting.",
    "key": [
      {
        "label": "driftbench, reader-first setting",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "346 games",
        "bars": [
          {
            "name": "driftbench",
            "score": 67.63,
            "ours": true
          },
          {
            "name": "DeepEval",
            "score": 58.382,
            "pattern": "dots"
          },
          {
            "name": "promptfoo",
            "score": 56.936,
            "pattern": "hatch"
          },
          {
            "name": "LangWatch",
            "score": 52.601,
            "pattern": "light"
          },
          {
            "name": "Langfuse",
            "score": 14.451,
            "pattern": "lines"
          },
          {
            "name": "Inspect",
            "score": 11.561,
            "pattern": "cross"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5, 346 games. Every competitor ran on this model only. A refused item counts as wrong. The driftbench bar uses its opt-in reader-first setting (default 61.3). It scores the same as a rule that always picks the longer reply, 67.6."
  },
  "bench-judgebench-models": {
    "kind": "ranked",
    "kicker": "JudgeBench · sealed test · same items, same model in each panel",
    "title": "JudgeBench: driftbench scores higher with 2, equal with 1 of 3 models.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.889,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 82.963,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 86.296,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": 80,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 74.815,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": 83.704,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 87.037,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 84.815,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "270 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 79.63,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 79.63,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. 270 pairs per model."
  },
  "bench-mm-eval-models": {
    "kind": "ranked",
    "kicker": "MM-Eval · sealed test · the benchmark's own score",
    "title": "MM-Eval: driftbench scores higher with 1, lower with 2 of 3 models.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "GPT-6 Luna",
        "model": "600 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.083,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 89,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Claude Haiku 5.5",
        "model": "591 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 88.863,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 86.45,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 84.095,
            "pattern": "dots",
            "refused": 3
          },
          {
            "name": "Inspect",
            "score": 75.356,
            "pattern": "cross",
            "refused": 7
          },
          {
            "name": "Langfuse",
            "score": 73.453,
            "pattern": "lines",
            "refused": 6
          },
          {
            "name": "LangWatch",
            "score": 83.869,
            "pattern": "light",
            "refused": 7
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "600 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 81.417,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 83.75,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. Up to 600 pairs per model; Claude Haiku 5.5 scores 591, nine safety items missing."
  },
  "bench-rubricbench-models": {
    "kind": "ranked",
    "kicker": "RubricBench · test split · both orders of every pair",
    "title": "RubricBench: driftbench scores higher with 2, equal with 1 of 3 models.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "790 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 82.658,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 75.57,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": 77.595,
            "pattern": "dots",
            "refused": 1
          },
          {
            "name": "Inspect",
            "score": 26.582,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 25.063,
            "pattern": "lines",
            "refused": 1
          },
          {
            "name": "LangWatch",
            "score": 74.937,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "790 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 82.278,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 81.519,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "790 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 80.759,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 80.823,
            "pattern": "hatch"
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. 790 pairs per model."
  },
  "bench-verify-models": {
    "kind": "ranked",
    "kicker": "LongJudgeBench verify · test split · is the final answer correct",
    "title": "Verify: above promptfoo, below a judge that always says fail.",
    "key": [
      {
        "label": "driftbench verify cascade",
        "style": "ours"
      },
      {
        "label": "no model",
        "style": "baseline"
      },
      {
        "label": "promptfoo llm-rubric",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "GEval, threshold 0.5 (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278)",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9)",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "LLM-as-a-Judge Boolean (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "221 items",
        "bars": [
          {
            "name": "driftbench",
            "score": 74.208,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 71.946,
            "pattern": "hatch"
          },
          {
            "name": "always fail",
            "score": 78.733,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": 58.824,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": 73.303,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 75.113,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": 73.303,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "221 items",
        "bars": [
          {
            "name": "driftbench",
            "score": 74.661,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 72.398,
            "pattern": "hatch"
          },
          {
            "name": "always fail",
            "score": 78.733,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "not run",
        "bars": [
          {
            "name": "driftbench",
            "score": null,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": null,
            "pattern": "hatch"
          },
          {
            "name": "always fail",
            "score": 78.733,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. Not run for driftbench and promptfoo: Gemini 3.5 Flash-Lite."
  },
  "bench-writing-models": {
    "kind": "ranked",
    "kicker": "LongJudgeBench writing preference · test split · both orders",
    "title": "Writing: driftbench scores higher with 1, lower with 2 of 3 models; picking the longer reply beats both.",
    "key": [
      {
        "label": "driftbench pair ledger",
        "style": "ours"
      },
      {
        "label": "no model",
        "style": "baseline"
      },
      {
        "label": "promptfoo select-best",
        "style": "other",
        "pattern": "hatch"
      },
      {
        "label": "ArenaGEval (DeepEval 4.2.8)",
        "style": "other",
        "pattern": "dots"
      },
      {
        "label": "model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "cross"
      },
      {
        "label": "Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins",
        "style": "other",
        "pattern": "lines"
      },
      {
        "label": "Comparison, swap and reconcile (LangWatch e683dd9e)",
        "style": "other",
        "pattern": "light"
      }
    ],
    "axis": "score out of 100: correct, % of items",
    "panels": [
      {
        "name": "Claude Haiku 5.5",
        "model": "173 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 61.272,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 56.936,
            "pattern": "hatch"
          },
          {
            "name": "longer reply",
            "score": 67.63,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": 58.382,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": 11.561,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": 14.451,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": 52.601,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "GPT-6 Luna",
        "model": "173 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 53.757,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 56.936,
            "pattern": "hatch"
          },
          {
            "name": "longer reply",
            "score": 67.63,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      },
      {
        "name": "Gemini 3.5 Flash-Lite",
        "model": "173 pairs",
        "bars": [
          {
            "name": "driftbench",
            "score": 58.96,
            "ours": true
          },
          {
            "name": "promptfoo",
            "score": 60.405,
            "pattern": "hatch"
          },
          {
            "name": "longer reply",
            "score": 67.63,
            "baseline": true
          },
          {
            "name": "DeepEval",
            "score": null,
            "pattern": "dots"
          },
          {
            "name": "Inspect",
            "score": null,
            "pattern": "cross"
          },
          {
            "name": "Langfuse",
            "score": null,
            "pattern": "lines"
          },
          {
            "name": "LangWatch",
            "score": null,
            "pattern": "light"
          }
        ]
      }
    ],
    "note": "Competitors with a recorded result on this benchmark in this repository: promptfoo, DeepEval, Inspect, Langfuse, LangWatch. 173 pairs per model."
  },
  "hard-deepeval": {
    "kind": "columns",
    "kicker": "DeepEval hard cases · held-out · Claude Haiku 5.5 on both sides · bars labelled with cases correct",
    "title": "DeepEval: ahead on 5, level on 4 of 9 tests.",
    "key": [
      "driftbench, shipped judge",
      "DeepEval default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "%",
    "axis": "score out of 100: correct, % of items",
    "groups": [
      {
        "label": "Hal|luci|nation",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 98.61,
            "text": "71"
          },
          {
            "series": 1,
            "value": 50,
            "text": "36"
          }
        ]
      },
      {
        "label": "Faith|ful|ness",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 98.61,
            "text": "71"
          },
          {
            "series": 1,
            "value": 50,
            "text": "36"
          }
        ]
      },
      {
        "label": "Turn rel|e|vancy",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 90.28,
            "text": "65"
          },
          {
            "series": 1,
            "value": 50,
            "text": "36"
          }
        ]
      },
      {
        "label": "Com|plete|ness",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 97.22,
            "text": "70"
          },
          {
            "series": 1,
            "value": 63.89,
            "text": "46"
          }
        ]
      },
      {
        "label": "Role ad|her|ence",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 87.5,
            "text": "63"
          }
        ]
      },
      {
        "label": "DAG, one node",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 90.28,
            "text": "65"
          },
          {
            "series": 1,
            "value": 90.28,
            "text": "65"
          }
        ]
      },
      {
        "label": "Task com|ple|tion",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 100,
            "text": "72"
          }
        ]
      },
      {
        "label": "Knowl|edge re|ten|tion",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 94.44,
            "text": "68"
          },
          {
            "series": 1,
            "value": 95.83,
            "text": "69"
          }
        ]
      },
      {
        "label": "G-Eval, strict",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 90.28,
            "text": "65"
          },
          {
            "series": 1,
            "value": 97.22,
            "text": "70"
          }
        ]
      }
    ],
    "note": "Ahead or behind: the 95% intervals do not overlap"
  },
  "hard-promptfoo": {
    "kind": "columns",
    "kicker": "promptfoo hard cases · held-out · Claude Haiku 5.5 on both sides · bars labelled with cases correct",
    "title": "promptfoo: equal or higher on 4 of 4 tests.",
    "key": [
      "driftbench, shipped judge",
      "promptfoo default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "%",
    "axis": "score out of 100: correct, % of items",
    "groups": [
      {
        "label": "LLM rubric",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 98.61,
            "text": "71"
          },
          {
            "series": 1,
            "value": 95.83,
            "text": "69"
          }
        ]
      },
      {
        "label": "Personal data",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 98.61,
            "text": "71"
          }
        ]
      },
      {
        "label": "Goal success",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 100,
            "text": "72"
          },
          {
            "series": 1,
            "value": 98.61,
            "text": "71"
          }
        ]
      },
      {
        "label": "Factuality",
        "sub": "of 72",
        "bars": [
          {
            "series": 0,
            "value": 97.22,
            "text": "70"
          },
          {
            "series": 1,
            "value": 97.22,
            "text": "70"
          }
        ]
      }
    ],
    "note": "Ahead or behind: the 95% intervals do not overlap"
  },
  "hard-inspect": {
    "kind": "columns",
    "kicker": "Inspect hard cases · held-out · Claude Haiku 5.5 on both sides · bars labelled with cases correct",
    "title": "Inspect: behind on 2, level on 2 of 4 tests.",
    "key": [
      "driftbench, shipped judge",
      "Inspect default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "%",
    "axis": "score out of 100: correct, % of items",
    "groups": [
      {
        "label": "Grader panel",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 98.33,
            "text": "59"
          },
          {
            "series": 1,
            "value": 98.33,
            "text": "59"
          }
        ]
      },
      {
        "label": "Model-graded QA",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 80,
            "text": "48"
          },
          {
            "series": 1,
            "value": 95,
            "text": "57"
          }
        ]
      },
      {
        "label": "Model-graded fact",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 80,
            "text": "48"
          },
          {
            "series": 1,
            "value": 98.33,
            "text": "59"
          }
        ]
      },
      {
        "label": "Panel, borderline",
        "sub": "of 60",
        "bars": [
          {
            "series": 0,
            "value": 81.67,
            "text": "49"
          },
          {
            "series": 1,
            "value": 100,
            "text": "60"
          }
        ]
      }
    ],
    "note": "Ahead or behind: the 95% intervals do not overlap"
  },
  "hard-langfuse": {
    "kind": "hbars",
    "kicker": "Langfuse hard cases · held-out · Claude Haiku 5.5 on both sides",
    "title": "Langfuse: 116 of 120 correct, against 115.",
    "key": [
      "driftbench, shipped judge",
      "Langfuse default"
    ],
    "min": 0,
    "max": 100,
    "ticks": [
      0,
      25,
      50,
      75,
      100
    ],
    "tick": "",
    "axis": "score out of 100: correct, % of cases",
    "rows": [
      {
        "label": "driftbench",
        "series": 0,
        "value": 96.67,
        "text": "96.7",
        "sub": "116 of 120"
      },
      {
        "label": "Langfuse",
        "series": 1,
        "value": 95.83,
        "text": "95.8",
        "sub": "115 of 120"
      }
    ],
    "note": "Reference correctness · 120 cases"
  }
};
