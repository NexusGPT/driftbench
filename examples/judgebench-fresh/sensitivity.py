"""Sensitivity checks on the confirmation result of the "JudgeBench recipe, fresh pool". No model call.

1. Question overlap. A question is identified by its stem: the text before the first "(A)" option line,
   lowercased with every character that is not a letter or a digit removed. LiveBench questions have no
   option lines, so the whole text is the stem. This catches the same question with reordered or
   reworded options. Rows: every confirmation pair; without the pairs whose question is also in dev;
   and, in addition, one pair per question that occurs more than once inside confirmation (first in
   pool order kept).
2. Transport. Each answered call records its transport in the journals (`cells/calls.jsonl.gz`,
   `cells/peer-calls.jsonl.gz`; a row with no transport field ran on the claude command). driftbench
   and promptfoo keys come from replaying each decision from the journal (`transport_keys.mjs`); peer
   keys are the `callKeys` of each decision. A key used by more than one pair of a tool is generic, not
   item grading (DeepEval's cached evaluation steps), and is left out. A pair is CLI, API or mixed by the
   calls that graded it. Row: per tool, the pairs where driftbench and the tool are each on one transport
   and it is the same one.

Every row uses the rule of stats.py: JudgeBench pair-net, a missing decision counts wrong, exact
two-sided McNemar, Holm over the five tools.

  python examples/judgebench-fresh/sensitivity.py [--markdown]
"""
import argparse
import gzip
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

from stats import TOOLS, cell, exact_two_sided, holm_adjust, items, official

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent


def pool(split):
    return [json.loads(x) for x in (ROOT / 'pool' / f'{split}.jsonl').read_text().splitlines() if x.strip()]


def stem(question):
    option = re.search(r'^\(A\) ', question, re.M)
    text = question[:option.start()] if option else question
    return re.sub(r'[^0-9a-z]+', '', text.casefold())


def overlaps():
    dev, confirm = pool('dev'), pool('confirm')
    dev_stems = defaultdict(list)
    for row in dev:
        dev_stems[stem(row['question'])].append(row)
    with_dev = [{'confirm': r['provenance']['qid'], 'confirmPair': r['pair_id'],
                 'dev': [d['provenance']['qid'] for d in dev_stems[stem(r['question'])]],
                 'devPairs': [d['pair_id'] for d in dev_stems[stem(r['question'])]]}
                for r in confirm if stem(r['question']) in dev_stems]
    groups = defaultdict(list)
    for row in confirm:
        groups[stem(row['question'])].append(row)
    within = [[{'qid': r['provenance']['qid'], 'pair': r['pair_id']} for r in g] for g in groups.values() if len(g) > 1]
    return with_dev, within


def peer_transports(split, tool):
    answered = {}
    with gzip.open(ROOT / 'cells' / 'peer-calls.jsonl.gz', 'rt') as handle:
        for line in handle:
            row = json.loads(line)
            if row.get('type') == 'finish' and row.get('answered') and row['key'] not in answered:
                answered[row['key']] = 'api' if row.get('transport') == 'anthropic-api' else 'cli'
    decisions = cell(split, tool)
    uses = Counter(k for row in decisions.values() for k in set(row.get('callKeys') or []))
    out = {}
    for pid, row in decisions.items():
        keys = sorted({k for k in row.get('callKeys') or [] if uses[k] == 1})
        out[pid] = [(k, answered[k]) for k in keys if k in answered]
    return out


def replay_transports(split):
    proc = subprocess.run(['node', '--import', 'tsx', str(ROOT / 'transport_keys.mjs'), '--split', split],
                          cwd=REPO, capture_output=True, text=True)
    if proc.returncode:
        raise SystemExit(proc.stderr)
    out = defaultdict(dict)
    for line in proc.stdout.splitlines():
        row = json.loads(line)
        if not row['replayed']:
            raise SystemExit(f"{row['contestant']} {row['id']} does not replay to its recorded games")
        out[row['contestant']][row['id']] = sorted({(k['key'], k['transport']) for k in row['keys']})
    return out


def kind(calls):
    found = {t for _, t in calls}
    return 'mixed' if len(found) > 1 else found.pop() if found else 'none'


def compare(pairs, keep_for_tool):
    """keep_for_tool(tool) -> set of pair ids to test that tool on, or None for every pair."""
    base = cell('confirm', 'driftbench')
    rows = []
    for tool in TOOLS:
        keep = keep_for_tool(tool)
        sub = [x for x in pairs if keep is None or x['id'] in keep]
        other = cell('confirm', tool)
        mine = [official(base.get(x['id']), x['label']) for x in sub]
        theirs = [official(other.get(x['id']), x['label']) for x in sub]
        wins = sum(a and not b for a, b in zip(mine, theirs))
        losses = sum(b and not a for a, b in zip(mine, theirs))
        rows.append({'tool': tool, 'pairs': len(sub), 'driftbenchCorrect': sum(mine), 'correct': sum(theirs),
                     'wins': wins, 'losses': losses, 'exactTwoSidedP': exact_two_sided(wins, losses)})
    for row, value in zip(rows, holm_adjust([r['exactTwoSidedP'] for r in rows])):
        row['holmP'] = value
        row['verdict'] = ('win' if row['wins'] > row['losses'] else 'loss') if value < 0.05 else 'tie'
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--markdown', action='store_true')
    args = ap.parse_args()
    pairs = items('confirm')
    with_dev, within = overlaps()
    drop_dev = {o['confirmPair'] for o in with_dev}
    drop_within = {p['pair'] for g in within for p in g[1:]}
    no_dev = {x['id'] for x in pairs} - drop_dev
    no_dup = no_dev - drop_within

    replay = replay_transports('confirm')
    transports = {'driftbench': replay['driftbench'], 'promptfoo': replay['promptfoo'],
                  **{t: peer_transports('confirm', t) for t in TOOLS if t != 'promptfoo'}}
    per_pair = {c: Counter(kind(v) for v in m.values()) for c, m in transports.items()}
    per_call = {c: Counter(t for v in m.values() for _, t in v) for c, m in transports.items()}
    mine = {pid: kind(v) for pid, v in transports['driftbench'].items()}

    def same_transport(tool):
        theirs = {pid: kind(v) for pid, v in transports[tool].items()}
        return {pid for pid, k in mine.items() if k in ('cli', 'api') and theirs.get(pid) == k}

    result = {
        'split': 'confirm',
        'questionOverlap': {'rule': 'stem before the first (A) option line, lowercased, letters and digits only',
                            'confirmPairsAlsoInDev': with_dev, 'duplicateQuestionsWithinConfirm': within},
        'transport': {'pairs': {c: dict(v) for c, v in per_pair.items()},
                      'itemCalls': {c: dict(v) for c, v in per_call.items()}},
        'rows': {
            'all': compare(pairs, lambda tool: None),
            'withoutDevOverlap': compare(pairs, lambda tool: no_dev),
            'withoutDevOverlapOneQuestionEach': compare(pairs, lambda tool: no_dup),
            'sameTransport': compare(pairs, same_transport),
        },
    }
    if not args.markdown:
        print(json.dumps(result, indent=1))
        return 0
    for name, rows in result['rows'].items():
        print(f'\n{name}\n\n| Tool | Pairs | driftbench | Tool | Wins / losses | Exact p | Holm p | Verdict |\n'
              '|---|---:|---:|---:|---:|---:|---:|---|')
        for r in rows:
            print(f"| {r['tool']} | {r['pairs']} | {r['driftbenchCorrect']} | {r['correct']} | {r['wins']} / {r['losses']} "
                  f"| {r['exactTwoSidedP']:.3g} | {r['holmP']:.3g} | {r['verdict']} |")
    print('\n| Contestant | CLI pairs | API pairs | Mixed pairs | CLI calls | API calls |\n|---|---:|---:|---:|---:|---:|')
    for c in ('driftbench',) + TOOLS:
        p, k = per_pair[c], per_call[c]
        print(f"| {c} | {p['cli']} | {p['api']} | {p['mixed']} | {k['cli']} | {k['api']} |")
    print('\noverlap with dev:', json.dumps(with_dev), '\nwithin confirm:', json.dumps(within))
    return 0


if __name__ == '__main__':
    sys.exit(main())
