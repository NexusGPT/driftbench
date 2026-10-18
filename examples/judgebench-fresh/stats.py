"""Score every contestant on one split of the "JudgeBench recipe, fresh pool" and test driftbench against
each tool. No model call.

Rule (JudgeBench official): a pair is correct when its two mapped games net positive (correct +1,
wrong -1, tie or missing 0). A missing decision row counts wrong. Paired test: exact two-sided McNemar
on the pairs where exactly one of driftbench and the tool is correct. Holm over the five tools.

  python examples/judgebench-fresh/stats.py --split confirm [--candidate driftbench] [--markdown]
"""
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ('promptfoo', 'deepeval', 'inspect', 'langfuse', 'langwatch')
GRADERS = {
    'promptfoo': 'select-best (promptfoo 8014282)',
    'deepeval': 'ArenaGEval (DeepEval 4.2.8)',
    'inspect': 'model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins',
    'langfuse': 'Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins',
    'langwatch': 'Comparison, swap and reconcile (LangWatch e683dd9e)',
}


def exact_two_sided(wins, losses):
    n = wins + losses
    if not n:
        return 1.0
    k = min(wins, losses)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


def holm_adjust(pvalues):
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [0.0] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def official(row, label):
    games = row['games'] if row else [None, None]
    return int(sum(1 if g == label else -1 if g in ('A', 'B') else 0 for g in games) > 0)


def items(split):
    rows = [json.loads(x) for x in (ROOT / 'pool' / f'{split}.jsonl').read_text().splitlines() if x.strip()]
    return [{'id': r['pair_id'], 'label': 'A' if r['label'] == 'A>B' else 'B', 'source': r['source']} for r in rows]


def cell(split, name):
    path = ROOT / 'cells' / split / name / 'decisions.jsonl'
    if not path.exists():
        return None
    out = {}
    for line in path.read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            out[row['id']] = row
    return out


def compare(split, candidate):
    pairs = items(split)
    base = cell(split, candidate)
    if base is None:
        raise SystemExit(f'no cell {split}/{candidate}')
    mine = [official(base.get(x['id']), x['label']) for x in pairs]
    result = {'split': split, 'candidate': candidate, 'pairs': len(pairs),
              'candidateCorrect': sum(mine), 'candidateMissing': sum(x['id'] not in base for x in pairs), 'tools': []}
    for tool in TOOLS:
        other = cell(split, tool)
        if other is None:
            continue
        theirs = [official(other.get(x['id']), x['label']) for x in pairs]
        wins = sum(a and not b for a, b in zip(mine, theirs))
        losses = sum(b and not a for a, b in zip(mine, theirs))
        result['tools'].append({'tool': tool, 'grader': GRADERS[tool], 'correct': sum(theirs),
                                'missing': sum(x['id'] not in other for x in pairs),
                                'wins': wins, 'losses': losses, 'exactTwoSidedP': exact_two_sided(wins, losses)})
    for row, value in zip(result['tools'], holm_adjust([r['exactTwoSidedP'] for r in result['tools']])):
        row['holmP'] = value
        row['verdict'] = ('win' if row['wins'] > row['losses'] else 'loss') if value < 0.05 else 'tie'
    return result


def markdown(result):
    n = result['pairs']
    lines = [f"| Contestant | Grader | Score | driftbench minus this | Wins / losses | Exact p | Holm p | Missing | Verdict |",
             '|---|---|---:|---:|---:|---:|---:|---:|---|',
             f"| driftbench | pair ledger, default | {100 * result['candidateCorrect'] / n:.2f}% ({result['candidateCorrect']}/{n}) "
             f"|  |  |  |  | {result['candidateMissing']} |  |"]
    for r in result['tools']:
        diff = 100 * (result['candidateCorrect'] - r['correct']) / n
        lines.append(f"| {r['tool']} | {r['grader']} | {100 * r['correct'] / n:.2f}% ({r['correct']}/{n}) | {diff:+.2f} pts "
                     f"| {r['wins']} / {r['losses']} | {r['exactTwoSidedP']:.3g} | {r['holmP']:.3g} | {r['missing']} | {r['verdict']} |")
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--split', choices=('dev', 'confirm'), required=True)
    ap.add_argument('--candidate', default='driftbench')
    ap.add_argument('--markdown', action='store_true')
    args = ap.parse_args()
    result = compare(args.split, args.candidate)
    print(markdown(result) if args.markdown else json.dumps(result, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
