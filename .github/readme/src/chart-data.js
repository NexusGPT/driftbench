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
    "title": "7,453 planted-truth cases test driftbench itself.",
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
        "value": 2383,
        "text": "2,383",
        "series": 0,
        "sub": "floor: level 7"
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
    "kind": "columns",
    "kicker": "JudgeBench · sealed test · same items, same model per pair of bars",
    "title": "JudgeBench: driftbench scores higher with 2, equal with 1 of 3 models.",
    "key": [
      "driftbench pair ledger",
      "promptfoo select-best"
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
        "label": "Claude Haiku 5.5",
        "sub": "270 pairs",
        "bars": [
          {
            "series": 0,
            "value": 88.89,
            "text": "88.9"
          },
          {
            "series": 1,
            "value": 82.96,
            "text": "83.0"
          }
        ]
      },
      {
        "label": "GPT-6 Luna",
        "sub": "270 pairs",
        "bars": [
          {
            "series": 0,
            "value": 87.04,
            "text": "87.0"
          },
          {
            "series": 1,
            "value": 84.81,
            "text": "84.8"
          }
        ]
      },
      {
        "label": "Gemini 3.5 Flash-Lite",
        "sub": "270 pairs",
        "bars": [
          {
            "series": 0,
            "value": 79.63,
            "text": "79.6"
          },
          {
            "series": 1,
            "value": 79.63,
            "text": "79.6"
          }
        ]
      }
    ],
    "note": "Gemini 3.8 Flash not run: provider quota"
  },
  "bench-mm-eval": {
    "kind": "columns",
    "kicker": "MM-Eval · sealed test · the benchmark's own score",
    "title": "MM-Eval: driftbench scores higher with 1, lower with 2 of 3 models.",
    "key": [
      "driftbench pair ledger",
      "promptfoo select-best"
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
        "label": "Claude Haiku 5.5",
        "sub": "591 pairs",
        "bars": [
          {
            "series": 0,
            "value": 88.86,
            "text": "88.9"
          },
          {
            "series": 1,
            "value": 86.45,
            "text": "86.5"
          }
        ]
      },
      {
        "label": "GPT-6 Luna",
        "sub": "600 pairs",
        "bars": [
          {
            "series": 0,
            "value": 88.08,
            "text": "88.1"
          },
          {
            "series": 1,
            "value": 89,
            "text": "89.0"
          }
        ]
      },
      {
        "label": "Gemini 3.5 Flash-Lite",
        "sub": "600 pairs",
        "bars": [
          {
            "series": 0,
            "value": 81.42,
            "text": "81.4"
          },
          {
            "series": 1,
            "value": 83.75,
            "text": "83.8"
          }
        ]
      }
    ],
    "note": "Gemini 3.8 Flash partial (393 of 600 pairs): left out"
  },
  "bench-rubricbench": {
    "kind": "columns",
    "kicker": "RubricBench · test split · both orders of every pair",
    "title": "RubricBench: driftbench scores higher with 1, lower with 1 of 2 models.",
    "key": [
      "driftbench pair ledger",
      "promptfoo select-best"
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
        "label": "GPT-6 Luna",
        "sub": "790 pairs",
        "bars": [
          {
            "series": 0,
            "value": 82.28,
            "text": "82.3"
          },
          {
            "series": 1,
            "value": 81.52,
            "text": "81.5"
          }
        ]
      },
      {
        "label": "Gemini 3.5 Flash-Lite",
        "sub": "790 pairs",
        "bars": [
          {
            "series": 0,
            "value": 80.76,
            "text": "80.8"
          },
          {
            "series": 1,
            "value": 80.82,
            "text": "80.8"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5 still running · Gemini 3.8 Flash partial: left out"
  },
  "bench-verify": {
    "kind": "columns",
    "kicker": "LongJudgeBench verify · test split · is the final answer correct",
    "title": "Verify: above promptfoo, below a judge that always says fail.",
    "key": [
      "driftbench verify cascade",
      "promptfoo llm-rubric",
      "no model"
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
        "label": "GPT-6 Luna",
        "sub": "221 items",
        "bars": [
          {
            "series": 0,
            "value": 74.66,
            "text": "74.7"
          },
          {
            "series": 1,
            "value": 72.4,
            "text": "72.4"
          }
        ]
      },
      {
        "label": "No model",
        "sub": "always says fail",
        "bars": [
          {
            "series": 2,
            "value": 78.73,
            "text": "78.7"
          }
        ]
      }
    ],
    "note": "Claude Haiku 5.5 pending · Gemini models not final: left out"
  },
  "bench-writing": {
    "kind": "columns",
    "kicker": "LongJudgeBench writing preference · test split · both orders",
    "title": "Writing: driftbench scores higher with 1, lower with 2 of 3 models; picking the longer reply beats both.",
    "key": [
      "driftbench pair ledger",
      "promptfoo select-best",
      "no model"
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
        "label": "Claude Haiku 5.5",
        "sub": "173 pairs",
        "bars": [
          {
            "series": 0,
            "value": 61.27,
            "text": "61.3"
          },
          {
            "series": 1,
            "value": 56.94,
            "text": "56.9"
          }
        ]
      },
      {
        "label": "GPT-6 Luna",
        "sub": "173 pairs",
        "bars": [
          {
            "series": 0,
            "value": 53.76,
            "text": "53.8"
          },
          {
            "series": 1,
            "value": 56.94,
            "text": "56.9"
          }
        ]
      },
      {
        "label": "Gemini 3.5 Flash-Lite",
        "sub": "173 pairs",
        "bars": [
          {
            "series": 0,
            "value": 58.96,
            "text": "59.0"
          },
          {
            "series": 1,
            "value": 60.4,
            "text": "60.4"
          }
        ]
      },
      {
        "label": "No model",
        "sub": "picks the longer reply",
        "bars": [
          {
            "series": 2,
            "value": 67.63,
            "text": "67.6"
          }
        ]
      }
    ],
    "note": "Gemini 3.8 Flash not run: provider quota"
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
