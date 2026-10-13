"""Pool two frozen held-out measurements without changing their original rows."""
from copy import deepcopy
import json
from run import ROOT
from score import tally


def pool(variant, receipt=False):
    suffix = '-task-receipts' if receipt else ''
    rows = []
    sources = []
    unrun_sources = []
    for seed, path in [(20261019, ROOT / f'{variant}{suffix}-heldout.json'),
                       (20261020, ROOT / 'additional' / f'{variant}{suffix}.json')]:
        value = json.loads(path.read_text()) if path.exists() else {'rows': [], 'unrun': True}
        if value.get('stopped') and not receipt:
            raise ValueError('Cannot pool an interrupted primary measurement')
        (sources if path.exists() else unrun_sources).append(str(path.relative_to(ROOT)))
        matched_ids = None
        if receipt:
            other = 'audit' if variant == 'baseline' else 'baseline'
            peer_path = path.with_name(path.name.replace(variant, other, 1))
            peer = json.loads(peer_path.read_text()) if peer_path.exists() else {'rows': []}
            matched_ids = {r['id'] for r in value['rows']} & {r['id'] for r in peer['rows']}
        for source in value['rows']:
            if matched_ids is not None and source['id'] not in matched_ids:
                continue
            if source['set'] not in (['task'] if receipt else ['task', 'grounding']):
                continue
            row = deepcopy(source)
            row['id'] = f'seed{seed}/' + row['id']
            row['seed'] = seed
            rows.append(row)
    value = {'variant': variant, 'corpus': 'pooled-heldout', 'source_recordings': sources, 'unrun_sources': unrun_sources,
             'evidence': 'receipt' if receipt else 'conversation',
             'expected_cases': {'task': len(rows) if receipt else 192, 'grounding': 192},
             'matched_case_subset': receipt and len(rows) != 192, 'rows': rows}
    scores = tally(value, False)
    if len(scores) != (1 if receipt else 3) or any(r['n'] != (len(rows) if receipt else 192) for r in scores):
        raise ValueError('Pooled source measurement is incomplete')
    name = f'pooled-{variant}{suffix}'
    (ROOT / 'additional' / f'{name}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    (ROOT / 'additional' / f'{name}-scores.json').write_text(json.dumps(scores, indent=2)+'\n')
    return scores


if __name__ == '__main__':
    for variant in ['baseline', 'audit']:
        for receipt in [False, True]:
            print(variant, receipt, json.dumps(pool(variant, receipt)))
