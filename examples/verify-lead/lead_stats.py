"""Paired exact tests of driftbench against every peer on one split. No model call.

Unit: item. A missing or unparsed verdict counts as wrong. Each peer gets an exact two-sided binomial
test on the discordant items (driftbench right and peer wrong, or the reverse); Holm adjusts the five
peer p values together.

  python examples/verify-lead/lead_stats.py --split confirm --driftbench driftbench-solve3
"""
import argparse
import json
import sys
from math import comb
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PEERS = ('promptfoo', 'deepeval', 'inspect', 'langfuse', 'langwatch')


def exact_p(wins, losses):
    n = wins + losses
    if n == 0:
        return 1.0
    k = min(wins, losses)
    tail = sum(comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def holm(pvalues):
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [0.0] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def decisions(split, contestant):
    path = ROOT / 'cells' / split / contestant / 'decisions.jsonl'
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    return {r['id']: r.get('pass') for r in rows}


def table(split, driftbench, peers=PEERS):
    items = json.loads((ROOT / 'data' / f'{split}.json').read_text())
    labels = {x['id']: x['label'] for x in items}
    right = {c: {i: decisions(split, c).get(i) == labels[i] for i in labels} for c in (driftbench, *peers)}
    rows = []
    for peer in peers:
        wins = sum(right[driftbench][i] and not right[peer][i] for i in labels)
        losses = sum(right[peer][i] and not right[driftbench][i] for i in labels)
        rows.append({'peer': peer, 'correct': sum(right[peer].values()), 'wins': wins, 'losses': losses,
                     'p': exact_p(wins, losses),
                     'missing': sum(decisions(split, peer).get(i) is None for i in labels)})
    for row, adjusted in zip(rows, holm([r['p'] for r in rows])):
        row['holm'] = adjusted
        row['verdict'] = ('win' if row['wins'] > row['losses'] else 'loss') if adjusted < 0.05 else 'tie'
    own = {'contestant': driftbench, 'correct': sum(right[driftbench].values()), 'n': len(labels),
           'missing': sum(decisions(split, driftbench).get(i) is None for i in labels)}
    return own, rows


def markdown(split, own, rows):
    n = own['n']
    lines = [f"| Contestant | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Verdict | Missing |",
             '|---|---:|---:|---:|---:|---:|---|---:|',
             f"| {own['contestant']} | {100 * own['correct'] / n:.2f}% ({own['correct']}/{n}) |  |  |  |  |  | {own['missing']} |"]
    for r in rows:
        lines.append(f"| {r['peer']} | {100 * r['correct'] / n:.2f}% ({r['correct']}/{n}) | "
                     f"{100 * (own['correct'] - r['correct']) / n:+.2f} pts | {r['wins']} / {r['losses']} | "
                     f"{r['p']:.3g} | {r['holm']:.3g} | {r['verdict']} | {r['missing']} |")
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--split', required=True)
    ap.add_argument('--driftbench', required=True)
    ap.add_argument('--json', help='also write the table as JSON here')
    args = ap.parse_args()
    own, rows = table(args.split, args.driftbench)
    print(markdown(args.split, own, rows))
    if args.json:
        Path(args.json).write_text(json.dumps({'split': args.split, 'driftbench': own, 'peers': rows}, indent=1) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
