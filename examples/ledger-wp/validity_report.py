"""Compare sealed edits with their parent decisions, without altering judges."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def flip(value):
    return {'A': 'B', 'B': 'A'}.get(value, value)


def compare(parent_games, edited_games, kind):
    expected = [flip(x) for x in parent_games] if kind in {'relabel', 'label-flip'} else parent_games
    return sum(a == b for a, b in zip(expected, edited_games, strict=True)), len(expected)


def main():
    rows = [json.loads(x) for x in (HERE / 'results/decisions.jsonl').read_text().splitlines() if x]
    variants = json.loads((HERE / 'seals/validity.json').read_text())
    result = {'scope': 'Supplemental recording-only interpretation of the preregistered edit checks. No contestant or primary statistics change.', 'cells': []}
    for model in ['haiku', 'gpt-6-luna', 'gemini-3.8-flash']:
        for contestant in ['pair-ledger', 'reader-first-c50b2dc3', 'promptfoo']:
            base = {r['id']: r for r in rows if r['split'] == 'fixtures' and r['model'] == model and r['contestant'] == contestant and r.get('sample', 0) == 0}
            edits = {r['id']: r for r in rows if r['split'] == 'validity' and r['model'] == model and r['contestant'] == contestant}
            checks = {}
            for kind, threshold in [('relabel', 95), ('markdown', 95), ('injection', 100), ('label-flip', 90)]:
                expected = [v for v in variants if v['variant'] == kind]
                observed = [v for v in expected if v['id'] in edits and v['parentId'] in base]
                matches = games = correct = 0
                for v in observed:
                    count, denominator = compare(base[v['parentId']]['games'], edits[v['id']]['games'], kind)
                    matches += count
                    games += denominator
                    correct += sum(g == v['label'] for g in edits[v['id']]['games'])
                percent = 100 * matches / games if games else None
                checks[kind] = {'expectedPairs': len(expected), 'observedPairs': len(observed), 'matchingGames': matches,
                                'games': games, 'consistencyPercent': percent, 'plantedCorrectGames': correct,
                                'thresholdPercent': threshold, 'passes': percent >= threshold if len(observed) == len(expected) else None}
            result['cells'].append({'model': model, 'contestant': contestant, 'checks': checks})
    (HERE / 'results/validity-checks.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
