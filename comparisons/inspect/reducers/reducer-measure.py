import math, json
from inspect_ai.scorer import Score, median_score, mode_score, majority_score, at_least, pass_at, pass_k

NAN = float("nan")
def scores(vals):
    return [Score(value=(NAN if v is None else float(v))) for v in vals]

cases = {
    "median tie [1,0]": ("median", [1, 0]),
    "median [1,1,0]": ("median", [1, 1, 0]),
    "mode tie [0,1]": ("mode", [0, 1]),
    "mode tie [1,0]": ("mode", [1, 0]),
    "at_least:2 [1,None,0]": ("at_least2", [1, None, 0]),
    "at_least:2 [1,None,None]": ("at_least2", [1, None, None]),
    "majority [1,1,None]": ("majority", [1, 1, None]),
    "majority [1,0,None]": ("majority", [1, 0, None]),
    "majority [1,None,None]": ("majority", [1, None, None]),
    "pass_at:2 [1,None,None]": ("pass_at2", [1, None, None]),
    "pass_k:2 [1,1,0]": ("pass_k2", [1, 1, 0]),
}
reducers = {
    "median": median_score(),
    "mode": mode_score(),
    "majority": majority_score(),
    "at_least2": at_least(2),
    "pass_at2": pass_at(2),
    "pass_k2": pass_k(2),
}
out = {}
for name, (kind, vals) in cases.items():
    r = reducers[kind](scores(vals))
    out[name] = {"value": None if r.value is None else (None if isinstance(r.value, float) and math.isnan(r.value) else r.value),
                 "nan": isinstance(r.value, float) and math.isnan(r.value)}
    print(f"{name:28s} -> {out[name]}")
print(json.dumps(out))
