"""Score every contestant on each benchmark with that benchmark's registered rule and test the
paired difference against the recorded driftbench cell. No model call.

Rules, as in the ledger lanes:
- judgebench: official pair-net score per pair; exact McNemar on pairs.
- mmeval: game 1 / tie 0.5 / else 0, item = mean of two games, macro over the five subsets;
  exact sign test on item differences; primary cohort drops the 9 transport-missing items of the
  recorded cell, the all-in cohort keeps all 600.
- rubricbench, writing: correct games of 2 per pair, ties and missing wrong; exact McNemar on games.
- verify: pass equals the gold label; missing wrong; exact McNemar on items.

  python examples/all-peers-public/stats.py
"""
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
OUT = REPO / 'docs' / 'comparison' / 'benchmarks'
PEERS = ('deepeval', 'inspect', 'langfuse', 'langwatch')
POINTWISE_PAIR = {'inspect', 'langfuse'}
MM_GROUPS = ('chat', 'reasoning', 'safety', 'linguistics', 'language mixing')
TITLES = {'judgebench': 'JudgeBench', 'mmeval': 'MM-Eval', 'rubricbench': 'RubricBench',
          'verify': 'LongJudgeBench verify', 'writing': 'LongJudgeBench writing preference'}
GRADERS = {
    ('pair', 'deepeval'): 'ArenaGEval (DeepEval 4.2.8)',
    ('pair', 'langwatch'): 'Comparison, swap and reconcile (LangWatch e683dd9e)',
    ('pair', 'inspect'): 'model_graded_qa (inspect_ai 0.3.278), pointwise grader, higher score wins',
    ('pair', 'langfuse'): 'Answer Critic (Langfuse 64ba74f9), pointwise grader, higher score wins',
    ('point', 'deepeval'): 'GEval, threshold 0.5 (DeepEval 4.2.8)',
    ('point', 'inspect'): 'model_graded_qa (inspect_ai 0.3.278)',
    ('point', 'langfuse'): 'Answer Critic (Langfuse 64ba74f9)',
    ('point', 'langwatch'): 'LLM-as-a-Judge Boolean (LangWatch e683dd9e)',
}


def exact_two_sided(wins, losses):
    n = wins + losses
    if not n:
        return 1.0
    k = min(wins, losses)
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n)


def holm_adjust(pvalues):
    """Holm step-down adjusted p-values, in the input order."""
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [0.0] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def add_holm(results):
    """One family: every driftbench-against-tool comparison in the five files (promptfoo and the four peers; the
    MM-Eval primary cohort; the reader-first variant is not a tool and is left out)."""
    rows = [(r, r['primary' if res['bench'] == 'mmeval' else 'all'])
            for res in results for r in res['contestants'] if r['contestant'] in PEERS + ('promptfoo',)]
    adjusted = holm_adjust([c['exactTwoSidedP'] for _, c in rows])
    for (_, cell), value in zip(rows, adjusted):
        cell['holmP'] = value
    return len(rows)


def wilson(k, n):
    if not n:
        return None
    z = 1.959963984540054
    p = k / n
    center = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [center - half, center + half]


def load(bench):
    data = ROOT / 'data' / bench
    items = json.loads((data / 'items.json').read_text())
    recorded = json.loads((data / 'recorded.json').read_text())
    cells = {}
    for peer in PEERS:
        path = ROOT / 'cells' / bench / peer / 'decisions.jsonl'
        if path.exists():
            rows = [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
            cells[peer] = {r['id']: r for r in rows}
    return items, recorded, cells


def spend(bench):
    from parts import part_files
    out = defaultdict(lambda: {'usd': 0.0, 'attempts': 0, 'answered': 0, 'noAnswer': 0, 'estimatedUsd': 0.0})
    lines = [x for path in part_files() for x in path.read_text().splitlines()]
    for line in lines:
        row = json.loads(line)
        if row.get('type') != 'finish' or row.get('bench') != bench:
            continue
        s = out[row['peer']]
        s['usd'] += row['costUsd']
        s['attempts'] += 1
        s['answered' if row.get('answered') else 'noAnswer'] += 1
        if row.get('costEstimated'):
            s['estimatedUsd'] += row['costUsd']
    return out


def unit_scores(bench, items, row_for):
    """Per unit correctness (pairs, games or items) in a fixed order; None rows count wrong."""
    units = []
    for x in items:
        row = row_for(x['id'])
        if bench == 'verify':
            units.append(int(row is not None and row.get('pass') == x['label']))
        elif bench == 'judgebench':
            games = row['games'] if row else [None, None]
            units.append(int(sum(1 if g == x['label'] else -1 if g in ('A', 'B') else 0 for g in games) > 0))
        else:
            games = row['games'] if row else [None, None]
            units.extend(int(g == x['label']) for g in games)
    return units


def mm_scores(items, row_for):
    out = []
    for x in items:
        row = row_for(x['id'])
        games = row['games'] if row else []
        value = sum(1.0 if g == x['label'] else 0.5 if g == 'tie' else 0.0 for g in games) / 2 if len(games) == 2 else 0.0
        out.append((x['group'], value))
    return out


def macro(values):
    groups = defaultdict(list)
    for g, v in values:
        groups[g].append(v)
    return sum(sum(groups[g]) / len(groups[g]) for g in MM_GROUPS) / len(MM_GROUPS)


def summarize(bench):
    items, recorded, cells = load(bench)
    kind = 'point' if bench == 'verify' else 'pair'
    costs = spend(bench)
    contestants = {'driftbench': recorded['driftbench'], 'promptfoo': recorded['promptfoo'],
                   **({'driftbench-reader-first': recorded['driftbench-reader-first']} if 'driftbench-reader-first' in recorded else {}),
                   **cells}
    rows = []
    cohorts = {'all': items}
    if bench == 'mmeval':
        missing = set(json.loads((ROOT / 'data' / bench / 'provenance.json').read_text())['recordedCheck']['primaryMissingIds'])
        cohorts = {'primary': [x for x in items if x['id'] not in missing], 'all': items}
    for name, rec in contestants.items():
        row_for = rec.get
        present = sum(x['id'] in rec for x in items)
        row = {'contestant': name, 'items': len(items), 'present': present, 'transportMissing': len(items) - present}
        if name in PEERS:
            row['grader'] = GRADERS[(kind, name)]
            row['mode'] = 'pointwise grader, higher score wins' if kind == 'pair' and name in POINTWISE_PAIR else 'native'
            row['graderErrors'] = sum(1 for r in rec.values() if r.get('graderError'))
            row['ties'] = sum(g == 'tie' for r in rec.values() for g in r.get('games', [])[:1])
            row['spend'] = costs.get(name)
        for cohort, cohort_items in cohorts.items():
            if bench == 'mmeval':
                ours = mm_scores(cohort_items, recorded['driftbench'].get)
                mine = mm_scores(cohort_items, row_for)
                diffs = [a[1] - b[1] for a, b in zip(ours, mine)]
                wins, losses = sum(d > 0 for d in diffs), sum(d < 0 for d in diffs)
                stats = {'score': macro(mine), 'n': len(cohort_items),
                         'driftbenchMinusThis': macro(ours) - macro(mine)}
            else:
                ours = unit_scores(bench, cohort_items, recorded['driftbench'].get)
                mine = unit_scores(bench, cohort_items, row_for)
                wins = sum(a > b for a, b in zip(ours, mine))
                losses = sum(a < b for a, b in zip(ours, mine))
                stats = {'correct': sum(mine), 'n': len(mine), 'score': sum(mine) / len(mine),
                         'wilson95': wilson(sum(mine), len(mine)),
                         'driftbenchMinusThis': (sum(ours) - sum(mine)) / len(mine)}
            if name != 'driftbench':
                stats.update({'driftbenchWins': wins, 'driftbenchLosses': losses,
                              'exactTwoSidedP': exact_two_sided(wins, losses)})
            row[cohort] = stats
        rows.append(row)
    final = all(r['transportMissing'] == 0 for r in rows if r['contestant'] in PEERS)
    return {'bench': bench, 'title': TITLES[bench], 'model': 'claude-haiku-5-5', 'kind': kind,
            'unit': {'judgebench': 'pair (official pair-net)', 'mmeval': 'item, macro over five subsets',
                     'verify': 'item'}.get(bench, 'game'),
            'final': final, 'contestants': rows}


def pct(x):
    return f'{100 * x:.2f}%'


def table(result):
    lines = [f"# {result['title']}: driftbench against every peer", '',
             f"Model: claude-haiku-5-5 for every contestant. Unit: {result['unit']}. "
             'driftbench and promptfoo rows are the recorded ledger cells; peer rows are new runs on the same sealed items. '
             'Rows marked "pointwise grader, higher score wins" score each reply alone with that tool\'s pointwise grader; '
             'the tool has no pairwise grader.', '']
    if not result['final']:
        lines += ['Note: a few items stay undecided after three passes because the model refused them (an acceptable-use refusal on biology content). They count as wrong for the contestant, as the recorded driftbench cell does.', '']
    cohorts = ['primary', 'all'] if result['bench'] == 'mmeval' else ['all']
    for cohort in cohorts:
        if len(cohorts) > 1:
            lines += [f'## Cohort: {cohort}', '']
        lines += ['| Contestant | Grader | Score | driftbench minus this | driftbench wins / losses | Exact p | Holm p | Missing | Grader errors | USD |',
                  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
        for r in result['contestants']:
            s = r[cohort]
            score = pct(s['score']) + (f" ({s['correct']}/{s['n']})" if 'correct' in s else f" (n={s['n']})")
            spend = r.get('spend')
            lines.append('| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |'.format(
                r['contestant'], r.get('grader', 'recorded cell'), score,
                '' if r['contestant'] == 'driftbench' else f"{100 * s['driftbenchMinusThis']:+.2f} pts",
                '' if r['contestant'] == 'driftbench' else f"{s['driftbenchWins']} / {s['driftbenchLosses']}",
                '' if r['contestant'] == 'driftbench' else f"{s['exactTwoSidedP']:.3g}",
                f"{s['holmP']:.3g}" if 'holmP' in s else '',
                r['transportMissing'], r.get('graderErrors', ''),
                f"{spend['usd']:.4f}" if spend else ''))
        lines.append('')
    return '\n'.join(lines)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    results = [summarize(bench) for bench in TITLES if (ROOT / 'cells' / bench).exists()]
    add_holm(results)
    for result in results:
        bench = result['bench']
        (OUT / f'{bench}-all-peers.json').write_text(json.dumps(result, indent=1) + '\n')
        (OUT / f'{bench}-all-peers.md').write_text(table(result) + '\n')
        print(table(result))


if __name__ == '__main__':
    main()
