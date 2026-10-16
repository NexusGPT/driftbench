"""Reference values for the clustered intervals of @agent-nexus/driftbench-stats.

Run from the repository root:  python3 packages/stats/test/reference/make_clustered_fixtures.py
Writes packages/stats/test/reference/clustered.json, which clustered.test.ts reads.

Written independently of the TypeScript, with numpy and scipy:
- hierarchical: the Beta-Bernoulli model of Bowyer, Aitchison and Ivanova (2025): theta ~ Uniform(0, 1),
  d ~ Gamma(1, 1), theta_g ~ Beta(d theta, d (1 - theta)), the tree rates integrated out as beta-binomials with
  scipy's log-gamma. `grid` is the grid the product uses (100 theta cells, 40 log-spaced d from 0.02 to 60);
  `fine` is a grid 20 times finer in theta and 5 times in d, to show the product grid does not move the interval.
- wilsonEffective: the cluster-robust ratio variance with the CR1 factor g / (g - 1), the design effect as its
  ratio to the binomial variance, and the Wilson score interval on n / design effect with scipy's normal and
  Student t quantiles.
"""

import json
from pathlib import Path

import numpy as np
import scipy
from scipy import special, stats

ALPHA = 0.05


def hierarchical(trees, theta_cells, d_points, alpha=ALPHA):
    th = (np.arange(theta_cells) + 0.5) / theta_cells
    d = np.exp(np.linspace(np.log(0.02), np.log(60), d_points))
    a = d[None, :] * th[:, None]
    b = d[None, :] * (1 - th[:, None])
    dd = np.broadcast_to(d[None, :], a.shape)
    # the weight of a grid point is d f(d) on a log grid, up to a constant step
    logw = np.log(dd) - dd
    ll = np.zeros_like(a)
    for n, k in trees:
        ll += (
            special.gammaln(k + a) + special.gammaln(n - k + b) - special.gammaln(n + dd)
            + special.gammaln(dd) - special.gammaln(a) - special.gammaln(b)
        )
    lp = ll + logw
    w = np.exp(lp - lp.max()).sum(1)
    w = w / w.sum()
    cum = np.concatenate([[0.0], np.cumsum(w)])

    def quantile(p):
        i = int(np.searchsorted(cum[1:], p, side="left"))
        i = min(i, theta_cells - 1)
        share = w[i]
        inside = 0.0 if share <= 0 else min(1.0, max(0.0, (p - cum[i]) / share))
        return (i + inside) / theta_cells

    tree_mean = float(np.mean([k / n for n, k in trees]))
    lower = min(quantile(alpha / 2), tree_mean)
    upper = max(quantile(1 - alpha / 2), tree_mean)
    return dict(treeMean=tree_mean, lower=float(lower), upper=float(upper), posteriorMean=float((w * th).sum()))


def wilson_effective(clusters, quantile, alpha=ALPHA):
    n = sum(c[0] for c in clusters)
    k = sum(c[1] for c in clusters)
    g = len(clusters)
    p = k / n
    if p in (0.0, 1.0):
        eff = float(g)
    elif g < 2:
        eff = float(n)
    else:
        ss = sum((c[1] - p * c[0]) ** 2 for c in clusters)
        var = g / (g - 1) * ss / n**2
        eff = min(n, max(1.0, p * (1 - p) / var)) if var > 0 else float(n)
    if quantile == "z" or g - 1 < 1:
        z = stats.norm.ppf(1 - alpha / 2)
    else:
        z = stats.t.ppf(1 - alpha / 2, g - 1)
    den = 1 + z * z / eff
    centre = (p + z * z / (2 * eff)) / den
    half = z * np.sqrt(p * (1 - p) / eff + z * z / (4 * eff * eff)) / den
    return dict(
        estimate=p, lower=float(max(0.0, centre - half)), upper=float(min(1.0, centre + half)),
        n=n, clusters=g, designEffect=float(n / eff), effectiveN=float(eff),
    )


def pairs(*rows):
    return [list(r) for r in rows]


HIER = {
    "six trees of six, one parent failing": pairs((6, 0), (6, 3), (6, 5), (6, 6), (6, 6), (6, 6)),
    "all pass": pairs(*[(5, 5)] * 8),
    "all fail": pairs(*[(4, 0)] * 6),
    "one tree": pairs((10, 7)),
    "singletons": pairs(*([(1, 1)] * 20 + [(1, 0)] * 5)),
    "mixed sizes": pairs((1, 1), (1, 0), (3, 3), (8, 6), (13, 13), (24, 20), (47, 40), (2, 1)),
    "table edge 64": pairs((64, 50), (64, 61), (10, 9), (3, 1)),
    "log-gamma path 65": pairs((65, 50), (65, 61), (10, 9), (3, 1)),
    "one large tree": pairs((200, 150), (12, 12), (7, 2)),
    "agreeing trees": pairs(*([(8, 7)] * 10)),
    "disagreeing trees": pairs(*([(8, 8)] * 5 + [(8, 1)] * 5)),
}
WILSON = {
    "report worked example": pairs((6, 0), (6, 3), (6, 5), (6, 6), (6, 6), (6, 6)),
    "independent singletons": pairs(*([(1, 1)] * 18 + [(1, 0)] * 7)),
    "all pass": pairs(*[(5, 5)] * 8),
    "all fail": pairs(*[(4, 0)] * 6),
    "one cluster": pairs((10, 7)),
    "unequal clusters": pairs((1, 1), (3, 3), (8, 6), (13, 13), (24, 12), (47, 40)),
    "identical clusters": pairs(*([(6, 3)] * 9)),
}

hier_cases = []
for name, trees in HIER.items():
    hier_cases.append(dict(
        name=name, trees=[dict(n=n, k=k) for n, k in trees],
        grid=hierarchical(trees, 100, 40), fine=hierarchical(trees, 2000, 200),
    ))
wilson_cases = []
for name, clusters in WILSON.items():
    wilson_cases.append(dict(
        name=name, clusters=[dict(n=n, k=k) for n, k in clusters],
        z=wilson_effective(clusters, "z"), t=wilson_effective(clusters, "t"),
    ))
artifact = dict(
    dependencies=dict(scipy=scipy.__version__, numpy=np.__version__),
    hierarchical=hier_cases, wilsonEffective=wilson_cases,
)
out = Path(__file__).with_name("clustered.json")
out.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(f"wrote {out}")
