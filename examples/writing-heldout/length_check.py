"""Length check of the recorded PR 351 writing results. No model call.

For every contestant: accuracy, the share of games that pick the longer reply, accuracy on pairs whose
human-chosen reply is the longer one and on pairs whose chosen reply is the shorter one, and the mean of
those two (length-controlled accuracy: a pure "longer wins" rule scores 50 on it).

  python3 examples/writing-heldout/length_check.py <ledger-wp seals/test.json>
"""
import json
import sys
from pathlib import Path

from score import size

PEERS = Path(__file__).resolve().parent.parent / 'all-peers-public'


def main():
    items = {x['id']: x for x in json.loads(Path(sys.argv[1]).read_text())}
    recorded = json.loads((PEERS / 'data' / 'writing' / 'recorded.json').read_text())
    games = {name: {i: r['games'] for i, r in rows.items()} for name, rows in recorded.items()}
    for peer in ('deepeval', 'inspect', 'langfuse', 'langwatch'):
        rows = {}
        for line in (PEERS / 'cells' / 'writing' / peer / 'decisions.jsonl').read_text().splitlines():
            if line.strip():
                row = json.loads(line)
                rows[row['id']] = row['games']  # a later pass replaces an earlier one
        games[peer] = rows
    games['longer-wins'] = {}
    for i, x in items.items():
        longer = 'A' if size(x['a'], x['language']) >= size(x['b'], x['language']) else 'B'
        games['longer-wins'][i] = [longer, longer]
    print('| Contestant | Accuracy | Picks longer | Chosen longer | Chosen shorter | Length-controlled |')
    print('|---|---:|---:|---:|---:|---:|')
    for name, rows in games.items():
        c = {'all': [0, 0], 'longer': [0, 0], 'L': [0, 0], 'S': [0, 0]}
        for i, x in items.items():
            longer = 'A' if size(x['a'], x['language']) >= size(x['b'], x['language']) else 'B'
            bucket = 'L' if longer == x['label'] else 'S'
            for g in rows.get(i, [None, None]):
                c['all'][0] += g == x['label']
                c['all'][1] += 1
                c['longer'][0] += g == longer
                c['longer'][1] += 1
                c[bucket][0] += g == x['label']
                c[bucket][1] += 1
        pct = lambda k: 100 * c[k][0] / c[k][1]
        print(f"| {name} | {pct('all'):.1f} ({c['all'][0]}/{c['all'][1]}) | {pct('longer'):.1f} | {pct('L'):.1f} ({c['L'][0]}/{c['L'][1]}) "
              f"| {pct('S'):.1f} ({c['S'][0]}/{c['S'][1]}) | {(pct('L') + pct('S')) / 2:.1f} |")


if __name__ == '__main__':
    main()
