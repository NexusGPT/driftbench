"""Paired exact tests of one driftbench setting against every peer, Holm over the five peers. No model call.

  python3 compare.py --items <items.json> --ours <games.json> --label "driftbench, long-structured setting" \
      --peer promptfoo=<games.json> --peer deepeval=<games.json> ...

A games file maps a pair id to its two games ['A'|'B'|'tie', ...]; a missing pair counts wrong.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'all-peers-public'))
from stats import exact_two_sided, holm_adjust  # noqa: E402
from score import size  # noqa: E402


def units(items, games):
    return [int(g == x['label']) for x in items for g in games.get(x['id'], [None, None])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--items', required=True)
    ap.add_argument('--ours', required=True)
    ap.add_argument('--label', required=True)
    ap.add_argument('--peer', action='append', default=[])
    args = ap.parse_args()
    items = json.loads(Path(args.items).read_text())
    ours = json.loads(Path(args.ours).read_text())
    mine = units(items, ours)
    rows = []
    for spec in args.peer:
        name, path = spec.split('=', 1)
        theirs = units(items, json.loads(Path(path).read_text()))
        wins = sum(a > b for a, b in zip(mine, theirs))
        losses = sum(a < b for a, b in zip(mine, theirs))
        rows.append({'peer': name, 'score': sum(theirs), 'wins': wins, 'losses': losses, 'p': exact_two_sided(wins, losses)})
    for row, adj in zip(rows, holm_adjust([r['p'] for r in rows])):
        row['holm'] = adj
    n = len(mine)
    longer = sum(g == ('A' if size(x['a'], x['language']) >= size(x['b'], x['language']) else 'B')
                 for x in items for g in ours.get(x['id'], [None, None]))
    print(f'{args.label}: {sum(mine)}/{n} = {100 * sum(mine) / n:.1f}%, picks the longer reply in {100 * longer / n:.1f}% of games')
    print('| Peer | Peer score | Minus peer, points | Wins / losses | Exact p | Holm p | Verdict |')
    print('|---|---:|---:|---:|---:|---:|---|')
    for r in rows:
        verdict = 'win' if r['holm'] < 0.05 and r['wins'] > r['losses'] else 'loss' if r['holm'] < 0.05 else 'tie'
        print(f"| {r['peer']} | {100 * r['score'] / n:.1f} ({r['score']}/{n}) | {100 * (sum(mine) - r['score']) / n:+.1f} | {r['wins']} / {r['losses']} "
              f"| {r['p']:.3g} | {r['holm']:.3g} | {verdict} |")


if __name__ == '__main__':
    main()
