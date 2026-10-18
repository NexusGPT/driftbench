import math
from inspect_ai.scorer import Score, pass_k
NAN = float("nan")
for name, vals in {"[1,1,unscored] k=2": [1, 1, None], "[1,0,unscored] k=2": [1, 0, None]}.items():
    r = pass_k(2)([Score(value=(NAN if v is None else float(v))) for v in vals])
    print(f"theirs pass_k {name:22s} -> {r.value}")
