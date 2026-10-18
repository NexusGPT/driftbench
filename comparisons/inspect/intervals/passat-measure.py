from inspect_ai.scorer import Score, pass_at
NAN = float("nan")
for name, vals in {"[1,0,0] k=2 (c=1 n=3)": [1,0,0], "[1,0] k=2 (c=1 n=2)": [1,0], "[1,None,None] k=2": [1,None,None]}.items():
    r = pass_at(2)([Score(value=(NAN if v is None else float(v))) for v in vals])
    print(f"theirs pass_at {name:26s} -> {r.value}")
