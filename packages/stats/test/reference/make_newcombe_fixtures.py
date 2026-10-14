"""Independent paired-interval fixtures, without a local reimplementation of the formula.

Run with Python plus numpy, scipy and statsmodels (0.15.0 when generated).
The paired function is newer than that release, so execute its unmodified AST
from the pinned upstream source, with the installed statsmodels Wilson helper
and input validators. The source digest prevents a changed reference going unnoticed.
"""

import ast
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import scipy
import statsmodels
from scipy import stats
from statsmodels.stats.proportion import proportion_confint
from statsmodels.tools.validation import float_like, string_like

REVISION = "35a8e0b7483211f5be7e60926be082136263cac3"
SOURCE = f"https://raw.githubusercontent.com/statsmodels/statsmodels/{REVISION}/statsmodels/stats/proportion.py"
DIGEST = "0eec79790be22172ad1ed2e02e7b3e0362ea02d867f2bb21992a077dac83d854"
source = urlopen(SOURCE, timeout=60).read()
assert hashlib.sha256(source).hexdigest() == DIGEST
function = next(node for node in ast.parse(source).body
                if isinstance(node, ast.FunctionDef) and node.name == "confint_proportions_paired")
namespace = dict(np=np, stats=stats, proportion_confint=proportion_confint,
                 string_like=string_like, float_like=float_like)
exec(compile(ast.Module(body=[function], type_ignores=[]), SOURCE, "exec"), namespace)
reference = namespace["confint_proportions_paired"]

cases = [
    ("published example", 10, 5, 2, 20, .05),
    ("historical first miss", 2, 5, 0, 23, .05),
    ("positive below correction", 2, 1, 1, 1, .05),
    ("zero covariance", 1, 1, 1, 1, .05),
    ("negative covariance", 1, 5, 4, 2, .05),
    ("fully concordant balanced", 15, 0, 0, 15, .05),
    ("fully concordant unbalanced", 50, 0, 0, 10, .05),
    ("all baseline pass", 20, 10, 0, 0, .05),
    ("all fail", 0, 0, 0, 30, .05),
    ("opposite arms", 0, 30, 0, 0, .05),
    ("90 percent", 12, 2, 9, 1, .1),
    ("99 percent", 10, 5, 2, 20, .01),
]
results = []
for name, a, b, c, d, alpha in cases:
    lower, upper = reference([[a, b], [c, d]], alpha=alpha)
    results.append(dict(name=name, bothPass=a, regressed=b, improved=c, bothFail=d,
                        alpha=alpha, estimate=(b-c)/(a+b+c+d), lower=lower, upper=upper))
artifact = dict(source=SOURCE, sha256=DIGEST, method="confint_proportions_paired, newcomb",
                dependencies=dict(statsmodels=statsmodels.__version__, scipy=scipy.__version__, numpy=np.__version__),
                cases=results)
out = Path(__file__).with_name("newcombe.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
