"""Predeclared exploratory family. Importing never reads measurement results."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


VALIDITY_FLAGS = ('unparsed', 'providerBlock', 'truncated', 'refusal', 'blocked')


def validity_flags(row):
    result = row.get('result') or {}
    recorded = row.get('validityFlags') or {}
    return {key: bool(result.get(key) or recorded.get(key)) for key in VALIDITY_FLAGS}


def correct(row, gold):
    return (row.get('prediction') in ('A', 'B', 'pass', 'fail') and
            row['prediction'] == gold and not any(validity_flags(row).values()))


def exact(wins, losses):
    n = wins + losses
    return min(1.0, 2 * sum(math.comb(n, k) for k in range(min(wins, losses) + 1)) / 2 ** n) if n else 1.0


def holm(rows):
    previous = 0.0
    for rank, index in enumerate(sorted(range(len(rows)), key=lambda i: rows[i]['p'])):
        row = rows[index]
        previous = max(previous, min(1.0, row['p'] * (len(rows) - rank)))
        row['holm'] = previous
        row['verdict'] = ('NOT MEASURED' if not row['matched'] else
                          'WIN' if previous < .05 and row['wins'] > row['losses'] else
                          'LOSS' if previous < .05 and row['wins'] < row['losses'] else 'TIE')


def index_manifest(manifest):
    indexed = {}
    for dataset in manifest['datasets']:
        name = dataset['name']
        if name in indexed:
            raise ValueError('Duplicate dataset: ' + name)
        ids = [item['id'] for item in dataset['items']]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate input ID: ' + name)
        indexed[name] = dataset
    return indexed


def make_plan(original, supplemental, sidecar):
    original_index = index_manifest(original)
    supplemental_index = index_manifest(supplemental)
    if original_index['verify-dev95']['items'] != supplemental_index['verify-dev95']['items']:
        raise ValueError('Verify dev95 input mismatch')
    cells = []
    for dataset in original['datasets']:
        for baseline in ['shipped-default'] + [k for k, v in dataset['baselines'].items() if v]:
            cells.append({'dataset': dataset['name'], 'baseline': baseline,
                          'run': 'supplemental' if dataset['name'] == 'verify-dev95' else 'original',
                          'baselineSource': 'live' if baseline == 'shipped-default' else 'manifest',
                          'plannedUnmeasured': dataset['name'] == 'writing-practice203'})
    if len(cells) != 38:
        raise ValueError('Expected original 38-cell family')
    panel = supplemental_index['inspect-panel-practice240']
    for baseline in ['shipped-default'] + list(panel['baselines']):
        cells.append({'dataset': panel['name'], 'baseline': baseline, 'run': 'supplemental',
                      'baselineSource': 'live' if baseline == 'shipped-default' else 'manifest',
                      'plannedUnmeasured': False})
    cells.append({'dataset': 'verify-dev95', 'baseline': 'driftbench-v5', 'run': 'supplemental',
                  'baselineSource': 'manifest', 'plannedUnmeasured': False})
    cells.append({'dataset': 'verify-practice120', 'baseline': 'driftbench-v5', 'run': 'original',
                  'baselineSource': 'sidecar', 'sidecarComparator': 'verify-practice-driftbench-v5',
                  'plannedUnmeasured': False})
    if len(cells) != 44 or len({(c['dataset'], c['baseline']) for c in cells}) != 44:
        raise ValueError('Expected 44 unique predeclared cells')
    expected = {'original': {}, 'supplemental': {}}
    for cell in cells:
        if cell['plannedUnmeasured']:
            continue
        run = cell['run']
        dataset = (original_index if run == 'original' else supplemental_index)[cell['dataset']]
        expected[run][dataset['name']] = {'items': len(dataset['items']), 'variants': ['new', 'baseline']}
    return {'version': 1, 'inference': 'exploratory development comparison; never held-out confirmation',
            'familySize': 44, 'alpha': .05, 'correction': 'Holm, two-sided exact paired discordance p-values',
            'endpoint': 'One recorded decision per item and variant. Returned ties, blocks and unparsed answers count wrong. Transport errors and missing recordings are missing.',
            'scope': 'Original 38 + panel240 four + Verify v5 dev one + Verify v5 practice one. Verify dev shipped/fable retain their original cells and use supplemental results only.',
            'selection': 'All declared cells retained. Writing practice203 remains planned unmeasured at p=1. No pooling across runs or procedures.',
            'identity': 'All freeze fields must match exactly except datasetsSha256; each row must match its own full freeze hash and manifest gold.',
            'completion': 'No measure locks. Every expected item has exactly one returned new and baseline row. --allow-partial produces diagnostic output only; it does not shrink the family.',
            'expected': expected, 'cells': cells}


def collect_rows(manifest, freeze, rows, expected, allow_partial):
    if freeze['model'] != manifest['model']:
        raise ValueError('Manifest/model mismatch')
    datasets = index_manifest(manifest)
    inputs = {(d['name'], i['id']): i for d in manifest['datasets'] for i in d['items']}
    freeze_hash = digest(freeze)
    returned = {}
    for row in rows:
        if row.get('frozen') != freeze_hash:
            raise ValueError('Result belongs to another freeze')
        key = (row.get('dataset'), row.get('id'))
        if key not in inputs or row.get('variant') not in ('new', 'baseline'):
            raise ValueError('Unknown result dataset/item/variant')
        if row.get('status') not in ('returned', 'error', 'interrupted'):
            raise ValueError('Unknown result status')
        if row['status'] != 'returned':
            continue
        if row['dataset'] not in expected:
            raise ValueError('Returned result outside predeclared run ownership')
        if row.get('model') != freeze['model'] or row.get('gold') != inputs[key]['gold']:
            raise ValueError('Result model/gold mismatch')
        if not isinstance(row.get('prediction'), str):
            raise ValueError('Missing prediction')
        full = (*key, row['variant'])
        if full in returned:
            raise ValueError('Duplicate returned judgment; never pool repeats')
        returned[full] = row
    missing = []
    for name, selection in expected.items():
        if len(datasets[name]['items']) != selection['items']:
            raise ValueError('Planned population mismatch')
        for item in datasets[name]['items']:
            for variant in selection['variants']:
                if (name, item['id'], variant) not in returned:
                    missing.append({'dataset': name, 'id': item['id'], 'variant': variant})
    if missing and not allow_partial:
        raise ValueError(f'Incomplete returned coverage: {len(missing)} planned judgments missing')
    return returned, missing


def compact_decisions(plan, manifests, freezes, returned, rows_by_run):
    compact = []
    for run, expected in plan['expected'].items():
        datasets = index_manifest(manifests[run])
        attempts = {}
        for row in rows_by_run[run]:
            attempts.setdefault((row['dataset'], row['id'], row['variant']), []).append(row)
        for name, selection in expected.items():
            for item in datasets[name]['items']:
                for variant in selection['variants']:
                    key = (name, item['id'], variant)
                    row = returned[run].get(key)
                    events = attempts.get(key, [])
                    result = row.get('result', {}) if row else {}
                    compact.append({'run': run, 'freeze': digest(freezes[run]), 'dataset': name,
                                    'id': item['id'], 'variant': variant, 'gold': item['gold'],
                                    'inputRequestSha256': digest(item['request']),
                                    'status': 'returned' if row else 'missing',
                                    'prediction': row['prediction'] if row else None,
                                    'validityFlags': validity_flags(row) if row else None,
                                    'eligibleForCorrectness': not any(validity_flags(row).values()) if row else None,
                                    'attemptStatuses': [r['status'] for r in events],
                                    'costUsd': result.get('costUsd'),
                                    'costIncomplete': result.get('costIncomplete'),
                                    'requestCount': result.get('requestCount'),
                                    'partialCostMetadata': [
                                        {k: r.get('partialResult', {}).get(k) for k in ('costUsd', 'costIncomplete', 'requestCount')}
                                        for r in events if r['status'] != 'returned' and 'partialResult' in r]})
    planned = {(cell['run'], cell['dataset']) for cell in plan['cells'] if cell['plannedUnmeasured']}
    for run, name in sorted(planned):
        for item in index_manifest(manifests[run])[name]['items']:
            for variant in ('new', 'baseline'):
                compact.append({'run': run, 'freeze': digest(freezes[run]), 'dataset': name,
                                'id': item['id'], 'variant': variant, 'gold': item['gold'],
                                'inputRequestSha256': digest(item['request']), 'status': 'planned-unmeasured',
                                'prediction': None, 'validityFlags': None, 'eligibleForCorrectness': None, 'attemptStatuses': [], 'costUsd': None,
                                'costIncomplete': None, 'requestCount': None, 'partialCostMetadata': []})
    return compact


def build(plan, original, supplemental, sidecar, original_freeze, supplemental_freeze,
          original_rows, supplemental_rows, allow_partial=False):
    if 'freezeHashes' in plan and plan['freezeHashes'] != {'original': digest(original_freeze), 'supplemental': digest(supplemental_freeze)}:
        raise ValueError('Run freeze differs from predeclared identity')
    left = {k: v for k, v in original_freeze.items() if k != 'datasetsSha256'}
    right = {k: v for k, v in supplemental_freeze.items() if k != 'datasetsSha256'}
    if left != right:
        raise ValueError('Product/config identity mismatch beyond dataset hash')
    if make_plan(original, supplemental, sidecar)['cells'] != plan['cells'] or plan['familySize'] != 44:
        raise ValueError('Declared family changed')
    manifests = {'original': original, 'supplemental': supplemental}
    freezes = {'original': original_freeze, 'supplemental': supplemental_freeze}
    returned = {}; missing = {}
    for run, rows in [('original', original_rows), ('supplemental', supplemental_rows)]:
        returned[run], missing[run] = collect_rows(manifests[run], freezes[run], rows, plan['expected'][run], allow_partial)
    indexes = {run: index_manifest(manifest) for run, manifest in manifests.items()}
    side = {c['name']: c for c in sidecar['comparators']}
    comparisons = []; summary = []; summarized = set(); historical_decisions = []
    for cell in plan['cells']:
        run, name, baseline_name = cell['run'], cell['dataset'], cell['baseline']
        dataset = indexes[run][name]; inputs = {i['id']: i for i in dataset['items']}
        new = {i: returned[run][(name, i, 'new')] for i in inputs if (name, i, 'new') in returned[run]}
        shipped = {i: returned[run][(name, i, 'baseline')] for i in inputs if (name, i, 'baseline') in returned[run]}
        if name not in summarized:
            summary.append({'dataset': name, 'run': run, 'population': len(inputs),
                            'new_returned': len(new), 'new_correct': sum(correct(v, inputs[i]['gold']) for i, v in new.items()),
                            'shipped_returned': len(shipped), 'shipped_correct': sum(correct(v, inputs[i]['gold']) for i, v in shipped.items()),
                            'note': dataset['note']})
            summarized.add(name)
        provenance = None
        if cell['baselineSource'] == 'live':
            baseline = shipped
        elif cell['baselineSource'] == 'manifest':
            baseline = dataset['baselines'][baseline_name]
        else:
            source = side[cell['sidecarComparator']]
            source_rows = {i['id']: i for i in source['items']}
            if set(source_rows) != set(inputs):
                raise ValueError('Sidecar population differs')
            for ident, item in inputs.items():
                record = source_rows[ident]
                if record['gold'] != item['gold'] or record['inputRequestSha256'] != digest(item['request']):
                    raise ValueError('Sidecar input/gold identity mismatch')
            baseline = {i: r for i, r in source_rows.items() if r['prediction'] is not None}
            provenance = {k: v for k, v in source.items() if k not in ('items', 'frozenIntersections')}
        if set(baseline) - set(inputs):
            raise ValueError('Comparator has unknown IDs')
        if baseline_name != 'shipped-default':
            for ident, item in inputs.items():
                record = baseline.get(ident)
                historical_decisions.append({'dataset': name, 'baseline': baseline_name,
                                             'qualification': 'unverified historical (lane report)',
                                             'id': ident, 'gold': item['gold'], 'inputRequestSha256': digest(item['request']),
                                             'status': 'recorded' if record else 'missing',
                                             'prediction': record['prediction'] if record else None})
        matched = sorted(set(new) & set(baseline)); wins = losses = ours = theirs = 0
        for ident in matched:
            a = correct(new[ident], inputs[ident]['gold']); b = correct(baseline[ident], inputs[ident]['gold'])
            wins += int(a and not b); losses += int(b and not a); ours += int(a); theirs += int(b)
        metadata = []
        for record in baseline.values():
            item = {k: v for k, v in record.items() if k in ('source', 'model', 'historical', 'transport', 'modelProvenance')}
            if item and item not in metadata:
                metadata.append(item)
        comparisons.append({**cell, 'population': len(inputs), 'baseline_recorded': len(baseline),
                            'matched': len(matched), 'matchedIds': matched, 'new_correct': ours, 'baseline_correct': theirs,
                            'wins': wins, 'losses': losses, 'p': exact(wins, losses), 'historical': baseline_name != 'shipped-default',
                            'qualification': 'unverified historical (lane report)' if baseline_name != 'shipped-default' else 'primary evidence: identical Haiku API model and frozen transport settings',
                            'provenance': provenance, 'baselineMetadata': metadata})
    holm(comparisons)
    decisions = compact_decisions(plan, manifests, freezes, returned, {'original': original_rows, 'supplemental': supplemental_rows})
    return {'decisions': decisions, 'historicalDecisions': historical_decisions, 'historicalQualification': 'unverified historical (lane report)', 'primaryEvidence': 'New product versus shipped default uses identical Haiku API model and frozen transport settings.', 'costAccounting': 'Logical judgment metadata only; never sum as newly billed spend. Cache reuse and physical receipt allocation require the separate spend ledger.', 'inference': plan['inference'], 'endpoint': plan['endpoint'], 'holmFamilySize': len(comparisons),
            'diagnosticOnly': bool(allow_partial), 'coverageComplete': not any(missing.values()), 'missing': missing,
            'freezeByRun': {run: digest(freeze) for run, freeze in freezes.items()},
            'commonConfigSha256': digest(left), 'familyPlanSha256': digest(plan),
            'summary': summary, 'comparisons': comparisons,
            'historicalCaveats': sidecar['modelAndTransportLimit'],
            'latestComparatorProvenance': [{k: v for k, v in c.items() if k not in ('items', 'frozenIntersections')} for c in sidecar['comparators']]}


def render(report):
    lines = ['# Combined exploratory development comparison', '', report['inference'] + '.', report['endpoint'],
             'Diagnostic only: ' + str(report['diagnosticOnly']).lower() + '.',
             'Holm family: 44 unique predeclared cells, including unmeasured cells at p=1.', '',
             '## Primary evidence: new product versus shipped default', '',
             'Both use identical Haiku API model and frozen transport settings.', '']
    def table(rows):
        out = ['| Dataset | Comparator | Matched | Correct new / comparator | W/L | Raw p | Holm p | Result |',
               '| --- | --- | --- | --- | --- | --- | --- | --- |']
        for r in rows:
            out.append(f"| {r['dataset']} | {r['baseline']} | {r['matched']}/{r['population']} | {r['new_correct']} / {r['baseline_correct']} | {r['wins']}/{r['losses']} | {r['p']:.6g} | {r['holm']:.6g} | {r['verdict']} |")
        return out
    lines += table([r for r in report['comparisons'] if not r['historical']])
    lines += ['', '## unverified historical (lane report)', '',
              'Every comparator in this table is **unverified historical (lane report)**. No matched physical settings are claimed.', '']
    lines += table([r for r in report['comparisons'] if r['historical']])
    lines += ['', report['historicalCaveats'], 'Procedures and populations remain separate; no repeated judgments are pooled.',
              'Missing historical decisions remain missing. Verify v5 dev has 94/95 recordings.',
              'Writing practice203 remains planned and unmeasured. Its p-value is 1.',
              'Exact matched IDs, full freeze hashes, comparator source hashes and procedure metadata are in the JSON report.']
    return '\n'.join(lines) + '\n'


def portable_provenance(value, key=''):
    """Redact only known provenance fields; never reinterpret semantic text."""
    if isinstance(value, dict):
        return {k: portable_provenance(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [portable_provenance(v, key) for v in value]
    if isinstance(value, str) and value.startswith('/') and key in ('source', 'path', 'sharedJournal', 'priorBudgetLedgers'):
        relative = next((value.split(marker, 1)[1] for marker in ('/comparisons/', '/examples/', '/packages/') if marker in value), None)
        prefix = next((marker.strip('/') + '/' for marker in ('/comparisons/', '/examples/', '/packages/') if marker in value), '')
        return {'displayPath': prefix + relative if relative else Path(value).name,
                'originalLocationSha256': hashlib.sha256(value.encode()).hexdigest(), 'operatorPathOmitted': True}
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, default=ROOT / 'family-plan.json')
    parser.add_argument('--original-manifest', type=Path, default=ROOT / 'datasets.json')
    parser.add_argument('--supplemental-manifest', type=Path, default=ROOT.parent / 'latest-dev-datasets.json')
    parser.add_argument('--sidecar', type=Path, default=ROOT.parent / 'latest-dev-comparators.json')
    parser.add_argument('--original-run', type=Path, default=ROOT / 'final-api-dev-v3')
    parser.add_argument('--supplemental-run', type=Path, default=ROOT / 'final-api-dev-supplement')
    parser.add_argument('--out', type=Path, default=ROOT / 'combined-report')
    parser.add_argument('--allow-partial', action='store_true', help='Diagnostic report only; retain all 44 cells and require no active measurement locks')
    args = parser.parse_args()
    # The run lock is checked before any result file is opened.
    for run in (args.original_run, args.supplemental_run):
        if (run / '.measure.lock').exists():
            raise ValueError('Measurement still locked; no result reads allowed')
    plan = json.loads(args.plan.read_text())
    paths = {'originalManifest': args.original_manifest, 'supplementalManifest': args.supplemental_manifest, 'sidecar': args.sidecar}
    for name, path in paths.items():
        if file_digest(path) != plan['inputHashes'][name]:
            raise ValueError('Predeclared source changed: ' + name)
    original = json.loads(args.original_manifest.read_text()); supplemental = json.loads(args.supplemental_manifest.read_text())
    sidecar = json.loads(args.sidecar.read_text())
    of = json.loads((args.original_run / 'freeze.json').read_text()); sf = json.loads((args.supplemental_run / 'freeze.json').read_text())
    if plan.get('freezeHashes') != {'original': digest(of), 'supplemental': digest(sf)}:
        raise ValueError('Run freeze differs from predeclared identity')
    for freeze, manifest_path in ((of, args.original_manifest), (sf, args.supplemental_manifest)):
        if freeze['datasetsSha256'] != file_digest(manifest_path):
            raise ValueError('Manifest differs from its own run freeze')
    if {k: v for k, v in of.items() if k != 'datasetsSha256'} != {k: v for k, v in sf.items() if k != 'datasetsSha256'}:
        raise ValueError('Product/config identity mismatch beyond dataset hash')
    def rows(run):
        path = run / 'results.jsonl'
        if not path.exists() and args.allow_partial:
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    report = build(plan, original, supplemental, sidecar, of, sf, rows(args.original_run), rows(args.supplemental_run), args.allow_partial)
    report = portable_provenance(report)
    args.out.mkdir(parents=True, exist_ok=True)
    prefix = 'DIAGNOSTIC' if args.allow_partial else 'COMBINED'
    (args.out / (prefix + '.json')).write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    (args.out / (prefix + '.md')).write_text(render(report))
    print(json.dumps({'family': report['holmFamilySize'], 'coverageComplete': report['coverageComplete'], 'diagnosticOnly': report['diagnosticOnly'], 'output': str(args.out)}))


if __name__ == '__main__':
    main()
