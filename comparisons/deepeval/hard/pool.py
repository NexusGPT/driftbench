"""Pool two frozen held-out measurements without changing their original rows."""
from copy import deepcopy
import json
from run import ROOT
from score import tally


def pool(variant, receipt=False):
    suffix = '-task-receipts' if receipt else ''
    rows = []
    sources = []
    for seed, path in [(20261019, ROOT / f'{variant}{suffix}-heldout.json'),
                       (20261020, ROOT / 'additional' / f'{variant}{suffix}.json')]:
        value = json.loads(path.read_text())
        if value.get('stopped'):
            raise ValueError('Cannot pool an interrupted measurement')
        sources.append(str(path.relative_to(ROOT)))
        for source in value['rows']:
            if source['set'] not in (['task'] if receipt else ['task', 'grounding']):
                continue
            row = deepcopy(source)
            row['id'] = f'seed{seed}/' + row['id']
            row['seed'] = seed
            rows.append(row)
    value = {'variant': variant, 'corpus': 'pooled-heldout', 'source_recordings': sources,
             'evidence': 'receipt' if receipt else 'conversation',
             'expected_cases': {'task': 192, 'grounding': 192}, 'rows': rows}
    scores = tally(value, False)
    if len(scores) != (1 if receipt else 3) or any(r['n'] != 192 for r in scores):
        raise ValueError('Pooled source measurement is incomplete')
    name = f'pooled-{variant}{suffix}'
    (ROOT / 'additional' / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    (ROOT / 'additional' / f'{name}-scores.json').write_text(json.dumps(scores, indent=2)+'\n')
    return scores


if __name__ == '__main__':
    for variant in ['baseline', 'audit']:
        for receipt in [False, True]:
            print(variant, receipt, json.dumps(pool(variant, receipt)))
