"""Mutation evidence for @driftbench/stats: break each function once, run the stats tests, restore.

Run from the worktree root:  python3 _captures/stats/mutate.py
Writes _captures/stats/mutations.md (the table) and _captures/stats/mutations.log (each run's summary).
A mutation is killed when the stats suite goes red. Every file is restored byte for byte after its run.
"""

import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "packages", "stats", "src")
OUT_MD = os.path.join(ROOT, "_captures", "stats", "mutations.md")
OUT_LOG = os.path.join(ROOT, "_captures", "stats", "mutations.log")

# (function, file, find, replace, what the mutation breaks)
MUTATIONS = [
    ("wilson", "intervals.ts", "(p + z2 / (2 * n)) / denom", "(p + z2 / n) / denom", "centre of the score interval"),
    ("clopperPearson", "intervals.ts", "betaQuantile(alpha / 2, k, n - k + 1)", "betaQuantile(alpha, k, n - k + 1)", "lower tail level"),
    ("zeroFailureBound", "intervals.ts", "rounded : Math.ceil(exact)", "rounded : Math.floor(exact)", "ceil becomes floor"),
    ("designEffect", "intervals.ts", "return 1 + (m - 1) * rho;", "return 1 + m * rho;", "m instead of m - 1"),
    ("bootstrapCI", "intervals.ts", "const key = keys[i] as string | number;", "const key = i;", "clusters ignored"),
    ("mulberry32", "basics.ts", "t | 61", "t | 63", "generator constant"),
    ("quantileSorted", "basics.ts", "const h = (n - 1) * p;", "const h = n * p;", "type 7 position"),
    ("passK", "reliability.ts", "p *= (c - i) / (n - i);", "p *= c / n;", "draws with replacement"),
    ("passAtK", "reliability.ts", "q *= 1 - k / i;", "q *= 1 - 1 / i;", "k dropped from the product"),
    ("unreliability", "reliability.ts", "quantileSorted(sorted, 0.9) - quantileSorted(sorted, 0.1)", "quantileSorted(sorted, 0.95) - quantileSorted(sorted, 0.05)", "wrong percentiles"),
    ("mcnemar (exact)", "paired.ts", "2 * binomialCdf(k, n, 0.5)", "binomialCdf(k, n, 0.5)", "one-sided p"),
    ("mcnemar (chi-square)", "paired.ts", "Math.abs(b - c) - 1)", "Math.abs(b - c))", "no continuity correction"),
    ("wilcoxonSignedRank (ties)", "paired.ts", "- tieCorrection / 2) / 24", ") / 24", "no tie correction"),
    ("wilcoxonSignedRank (method)", "paired.ts", "else if (total <= 13) method = 'permutation';", "else if (total <= 0) method = 'permutation';", "permutation branch never taken"),
    ("pairedRateDifference", "paired.ts", "- 2 * phi * dl1 * du2", "- 2 * 0 * dl1 * du2", "phi dropped from the lower limit"),
    ("nonInferiority", "paired.ts", "const withinMargin = effect.upper < margin;", "const withinMargin = effect.estimate < margin;", "point estimate instead of the upper bound"),
    ("benjaminiHochberg", "multiple.ts", "(p * m) / rank", "p * m", "Bonferroni instead of BH"),
    ("mde", "power.ts", "za * Math.sqrt(2 * pbar * (1 - pbar))", "za * Math.sqrt(pbar * (1 - pbar))", "null variance halved"),
    ("cusum", "drift.ts", "su = Math.max(0, su + z - k);", "su = Math.max(0, su + z);", "allowance dropped"),
    ("pageHinkley", "drift.ts", "mUp += x - runningMean - delta;", "mUp += x - runningMean + delta;", "delta sign"),
    ("ksTest", "drift.ts", "Math.abs(ii * n - jj * m) < gap", "Math.abs(ii * n - jj * m) <= gap", "band boundary"),
    ("kolmogorovSf", "drift.ts", "Math.exp(-2 * k * k * x * x)", "Math.exp(-k * k * x * x)", "series exponent"),
    ("cohenKappa (weights)", "agreement.ts", "weights === 'linear' ? d : d * d", "weights === 'linear' ? d * d : d", "linear and quadratic swapped"),
    ("cohenKappa (nominal)", "agreement.ts", "(observed - expected) / (1 - expected)", "(observed - expected) / (1 - observed)", "denominator"),
    ("krippendorffAlpha", "agreement.ts", "+ 1 / (m - 1);", "+ 1 / m;", "coincidence weight"),
    ("krippendorffAlpha (ordinal)", "agreement.ts", "(s - ((nc[c] as number) + (nc[d] as number)) / 2) ** 2", "s ** 2", "ordinal metric"),
    ("varianceComponents", "variance.ts", "rest -= sigmaE;", "rest -= 0;", "residual not removed"),
    ("varianceComponents (Henderson)", "variance.ts", "(acc.get(ancestor) ?? 0) + nh * nh", "(acc.get(ancestor) ?? 0) + nh", "sizes not squared"),
    ("icc", "variance.ts", "cumulative += c.variance;", "cumulative = c.variance;", "not cumulative"),
    ("neymanAllocation", "variance.ts", "nh * (sds[i] as number)", "nh", "proportional instead of Neyman"),
    ("repeatsForFloor", "variance.ts", "(input.difference ?? true) ? 2 : 1", "(input.difference ?? true) ? 1 : 1", "difference not doubled"),
    ("goodTuring", "coverage.ts", "f.f1 / f.n", "f.f2 / f.n", "doubletons instead of singletons"),
    ("chaoCoverage (f2 = 0)", "coverage.ts", "(((n - 1) * (f1 - 1)) / ((n - 1) * (f1 - 1) + 2))", "(((n - 1) * f1) / ((n - 1) * f1 + 2))", "fallback without the bias correction"),
    ("chaoCoverage (Chao1)", "coverage.ts", "((f1 * (f1 - 1)) / 2)", "((f1 * f1) / 2)", "Chao1 fallback"),
    ("hillNumbers", "coverage.ts", "p * Math.log(p)", "p * Math.log2(p)", "entropy base"),
    ("erfc / normalCdf", "special.ts", "upperIncompleteGamma(0.5, x * x)", "upperIncompleteGamma(0.5, x)", "argument not squared"),
    ("betaQuantile", "special.ts", "if (incompleteBeta(mid, a, b) < p) lo = mid;", "if (incompleteBeta(mid, a, b) > p) lo = mid;", "bisection direction"),
]


def run_suite():
    proc = subprocess.run(
        ["npx", "vitest", "run", "packages/stats"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    out = proc.stdout + proc.stderr
    m = re.search(r"Tests\s+(.*)", out)
    summary = m.group(1).strip() if m else "no summary"
    failed = re.findall(r"(?:×|FAIL)\s+(.*)", out)
    return proc.returncode, summary, failed


def main():
    rows, log = [], []
    code, summary, _ = run_suite()
    log.append(f"baseline: exit {code}; {summary}")
    if code != 0:
        print("baseline is red; stop", summary)
        sys.exit(1)
    for name, file, find, replace, what in MUTATIONS:
        path = os.path.join(SRC, file)
        with open(path, encoding="utf8") as fh:
            original = fh.read()
        count = original.count(find)
        if count != 1:
            print(f"{name}: anchor found {count} times in {file}; stop")
            sys.exit(2)
        try:
            with open(path, "w", encoding="utf8") as fh:
                fh.write(original.replace(find, replace))
            code, summary, failed = run_suite()
        finally:
            with open(path, "w", encoding="utf8") as fh:
                fh.write(original)
        with open(path, encoding="utf8") as fh:
            assert fh.read() == original, f"{file} not restored"
        killed = code != 0
        first = next((f for f in failed if "test.ts >" in f), failed[0] if failed else "")
        rows.append((name, file, what, "red" if killed else "SURVIVED", summary, first.strip()))
        log.append(f"{name} | {file} | exit {code} | {summary} | {first.strip()}")
        print(f"{name}: {'red' if killed else 'SURVIVED'} ({summary})")
    code, summary, _ = run_suite()
    log.append(f"after restore: exit {code}; {summary}")
    with open(OUT_LOG, "w", encoding="utf8") as fh:
        fh.write("\n".join(log) + "\n")
    with open(OUT_MD, "w", encoding="utf8") as fh:
        fh.write("# Mutation evidence, @driftbench/stats\n\n")
        fh.write("Generated by `_captures/stats/mutate.py`. Each row breaks one function once, runs `npx vitest run packages/stats`, and restores the file.\n\n")
        fh.write("| Function | File | Mutation | Suite | Tests line | First failing test |\n|---|---|---|---|---|---|\n")
        for r in rows:
            fh.write("| " + " | ".join(c.replace("|", "/") for c in r) + " |\n")
        fh.write(f"\nKilled: {sum(1 for r in rows if r[3] == 'red')} of {len(rows)}. After restore: exit {code}, {summary}.\n")
    print(f"after restore: exit {code}; {summary}")
    sys.exit(0 if all(r[3] == "red" for r in rows) and code == 0 else 3)


if __name__ == "__main__":
    main()
