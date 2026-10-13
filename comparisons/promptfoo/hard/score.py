"""Paired accuracy, 95% Wilson intervals, exact sign test, and a full error census."""
import json
import math
from collections import Counter
from pathlib import Path
from run import HERE, outcome, recordings


def write_if_changed(path, content):
    if not path.exists() or path.read_text() != content:
        path.write_text(content)


def write_result(path, value):
    """Write a result file, unless it already holds this value: a replay that reproduces the committed numbers keeps the committed bytes."""
    text = json.dumps(value, indent=2) + '\n'
    try:
        if json.loads(path.read_text()) == json.loads(text):
            return
    except (OSError, ValueError):
        pass
    path.write_text(text)


def wilson(k, n):
    if n == 0:
        return None
    z = 1.959963984540054
    p = k / n
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [max(0, center - half), min(1, center + half)]


def summarize(rows, peer):
    if set(rows) != set(peer):
        raise ValueError('Both sides must cover exactly the same cases.')
    n = len(rows)
    right = lambda r: r['outcome'] == ('pass' if r['truth'] else 'fail')
    ours = sum(right(r) for r in rows.values())
    theirs = sum(right(r) for r in peer.values())
    only_ours = sum(right(rows[i]) and not right(peer[i]) for i in rows)
    only_theirs = sum(right(peer[i]) and not right(rows[i]) for i in rows)
    m = only_ours + only_theirs
    p = min(1, 2 * sum(math.comb(m, i) for i in range(min(only_ours, only_theirs) + 1)) / 2 ** m) if m else 1
    return dict(n=n, ours=ours, theirs=theirs, ours_ci=wilson(ours, n), theirs_ci=wilson(theirs, n), only_ours=only_ours, only_theirs=only_theirs, sign_test_p=p, outcome='ahead' if p < .05 and only_ours > only_theirs else 'behind' if p < .05 else 'equal', observed_leader='ours' if ours > theirs else 'theirs' if theirs > ours else 'tie')


def main():
    calls = recordings()
    by_key = {c['request_sha256']: c for c in calls if c['success']}
    # Free normalization under the actual final-object shipped contract and first-object
    # peer contract. This retains corrected answers without changing any model recording.
    for path in (HERE / 'recorded').glob('*.json'):
        obj = json.loads(path.read_text())
        if 'row' not in obj or 'side' not in obj or 'rows' not in obj:
            continue
        changed = False
        for r in obj['rows']:
            parsed = outcome(by_key[r['request_sha256']]['text'], obj['side'], obj['row'])
            if parsed != r['outcome']:
                r['outcome'] = parsed
                changed = True
        if changed:
            obj['parser_note'] = 'Free reparse: shipped last complete object, peer first object; model answers unchanged.'
            path.write_text(json.dumps(obj, indent=2) + '\n')
    reports, ablations = [], []
    audit_lines = ['# Hard and held-out error census', '', 'Errors count inconclusive answers as wrong. All cases and both labels remain in the denominator.', '']
    for fold in ['hard', 'heldout']:
        prefix = 'heldout-' if fold == 'heldout' else ''
        for row in ['rubric', 'factuality', 'pii', 'goal']:
            path = HERE / f'recorded/{prefix}{row}-peer.json'
            if not path.exists():
                continue
            peer = {r['id']: r for r in json.loads(path.read_text())['rows']}
            for side in ['shipped', 'audit']:
                path = HERE / f'recorded/{prefix}{row}-{side}.json'
                if not path.exists():
                    continue
                ours = {r['id']: r for r in json.loads(path.read_text())['rows']}
                if set(ours) != set(peer):
                    continue
                summary = dict(set=fold, row=row, side=side, **summarize(ours, peer))
                summary['billed_pair_cost'] = sum(r['call_cost'] for r in list(ours.values()) + list(peer.values()))
                summary['ours_unanswered'] = sum(r['outcome'] == 'inconclusive' for r in ours.values())
                summary['peer_unanswered'] = sum(r['outcome'] == 'inconclusive' for r in peer.values())
                summary['label_counts'] = dict(Counter(r['truth'] for r in ours.values()))
                summary['distinct_ours_inputs'] = len({r['request_sha256'] for r in ours.values()})
                summary['distinct_peer_inputs'] = len({r['request_sha256'] for r in peer.values()})
                reports.append(summary)
                audit_lines.extend([f'## {fold}/{row}/{side}', '', f'Ours {summary["ours"]}/{summary["n"]}; peer {summary["theirs"]}/{summary["n"]}; paired p={summary["sign_test_p"]:.8g}.', ''])
                cases = {c['id']: c for c in json.loads((HERE / f'{prefix}{row}.json').read_text())}
                for name, rs in [('ours', ours), ('peer', peer)]:
                    for i, r in rs.items():
                        if r['outcome'] != ('pass' if r['truth'] else 'fail'):
                            audit_lines.extend([f'### {name} {i}: {r["kind"]}', '', f'Truth: {r["truth"]}. Outcome: {r["outcome"]}.', '', 'Input:', '```json', json.dumps(cases[i], ensure_ascii=False, indent=2), '```', 'Recorded answer:', '```text', by_key[r['request_sha256']]['text'], '```', ''])
        full = HERE / f'recorded/{prefix}goal-peer-full-state.json'
        if full.exists():
            peer = {r['id']: r for r in json.loads(full.read_text())['rows']}
            for side in ['shipped', 'audit']:
                path = HERE / f'recorded/{prefix}goal-{side}.json'
                if path.exists():
                    ours = {r['id']: r for r in json.loads(path.read_text())['rows']}
                    if set(ours) == set(peer):
                        ablations.append(dict(set=fold, row='goal-equal-evidence', side=side, **summarize(ours, peer)))
            cases = {c['id']: c for c in json.loads((HERE / f'{prefix}goal.json').read_text())}
            audit_lines.extend([f'## {fold}/goal/peer-full-state', '', 'Equal-evidence ablation errors. Shipped and candidate errors also appear in their goal sections above.', ''])
            for i, r in peer.items():
                if r['outcome'] != ('pass' if r['truth'] else 'fail'):
                    audit_lines.extend([f'### peer-full-state {i}: {r["kind"]}', '', f'Truth: {r["truth"]}. Outcome: {r["outcome"]}.', '', 'Input:', '```json', json.dumps(cases[i], ensure_ascii=False, indent=2), '```', 'Recorded answer:', '```text', by_key[r['request_sha256']]['text'], '```', ''])
    output = dict(total_unique_calls=len(calls), total_charged_usd=sum(c['charged_usd'] for c in calls), unknown_cost_calls=sum(not c['cost_known'] for c in calls), model_names=sorted({m for c in calls for m in c.get('resolved_model', [])}), rows=reports, ablations=ablations)
    write_result(HERE / 'recorded/summary.json', output)
    write_if_changed(HERE / 'recorded/losses.md', '\n'.join(audit_lines) + '\n')
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
