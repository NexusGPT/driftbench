"""Score recorded writing runs per contestant: games correct, how often the longer reply is picked,
and accuracy split by whether the human-chosen reply is the longer one. No model call.

  python3 examples/writing-heldout/score.py --split practice
"""
import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent


def size(text, language):
    # Words for English, Han characters for Chinese: the ledger-wp longer-wins control.
    return len(re.findall(r'[一-鿿]', text)) if language == 'zh' else len(text.split())


def score(items, rows):
    by = {r['id']: r for r in rows}
    out = {'pairs': 0, 'correct': 0, 'games': 0, 'longerPicked': 0, 'decidedGames': 0,
           'chosenLonger': [0, 0], 'chosenShorter': [0, 0], 'en': [0, 0], 'zh': [0, 0]}
    for item in items:
        row = by.get(item['id'])
        if row is None:
            continue
        out['pairs'] += 1
        longer = 'A' if size(item['a'], item['language']) >= size(item['b'], item['language']) else 'B'
        bucket = 'chosenLonger' if longer == item['label'] else 'chosenShorter'
        for game in row['games']:
            hit = game == item['label']
            out['games'] += 1
            out['correct'] += hit
            out['decidedGames'] += game in ('A', 'B')
            out['longerPicked'] += game == longer
            out[bucket][0] += hit
            out[bucket][1] += 1
            out[item['language']][0] += hit
            out[item['language']][1] += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', required=True)
    args = ap.parse_args()
    items = json.loads((HERE / 'items' / f'{args.split}.json').read_text())
    for path in sorted((HERE / 'runs' / args.split).glob('*.jsonl')):
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        s = score(items, rows)
        pct = lambda a, b: f'{a}/{b} {100 * a / b:.1f}' if b else '-'
        print(f"{path.stem:28} pairs {s['pairs']:3}  acc {pct(s['correct'], s['games'])}  longer {pct(s['longerPicked'], s['games'])}"
              f"  chosenLonger {pct(*s['chosenLonger'])}  chosenShorter {pct(*s['chosenShorter'])}  en {pct(*s['en'])}  zh {pct(*s['zh'])}")


if __name__ == '__main__':
    main()
