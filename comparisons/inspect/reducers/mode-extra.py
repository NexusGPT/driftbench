import math
from inspect_ai.scorer import Score, mode_score, at_least
NAN = float("nan")
def sc(vals): return [Score(value=(NAN if v is None else float(v))) for v in vals]
for name, vals in {"mode [1,None,None]": [1,None,None], "mode [1,None,0]": [1,None,0], "mode [0,None,None]": [0,None,None]}.items():
    r = mode_score()(sc(vals)); print(f"{name:22s} -> {r.value}")
