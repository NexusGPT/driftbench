"""Recompute the published 44-cell exploratory comparison, offline and without private files."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path


def recompute(root):
    root = Path(root)
    provenance = json.loads((root / 'provenance.json').read_text())
    for name, expected in provenance['publishedFileSha256'].items():
        if Path(name).name != name:
            raise ValueError('Invalid artifact filename')
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Published artifact hash mismatch: ' + name)
    spec = importlib.util.spec_from_file_location('combined_algorithm', root / 'report-combined.py')
    algorithm = importlib.util.module_from_spec(spec); spec.loader.exec_module(algorithm)
    def read(name):
        data = (root / name).read_bytes()
        return json.loads(gzip.decompress(data) if name.endswith('.gz') else data)
    plan = read('family-plan.json'); saved = read('report.json')
    if plan['familySize'] != 44 or len(plan['cells']) != 44 or len({(c['dataset'], c['baseline']) for c in plan['cells']}) != 44:
        raise ValueError('Family must contain 44 unique cells')
    manifests = {'original': read('input-index-original.json.gz'), 'supplemental': read('input-index-supplemental.json.gz')}
    for run, manifest in manifests.items():
        archived_hash = provenance['originalSourceBytes'][run + 'Manifest']['sha256']
        if manifest['archivedManifestSha256'] != archived_hash or plan['inputHashes'][run + 'Manifest'] != archived_hash:
            raise ValueError('Input index source manifest identity differs')
        identities = [{'name': d['name'], 'items': [{key: i[key] for key in ('id', 'gold', 'inputRequestSha256')}
                                                    for i in d['items']]} for d in manifest['datasets']]
        if algorithm.digest(identities) != provenance['inputIdentityIndexSha256'][run]:
            raise ValueError('Published input identities/golds differ from archived identity index')
        for dataset in manifest['datasets']:
            for item in dataset['items']:
                if set(item) != {'id', 'gold', 'inputRequestSha256', 'sourceProvenance'}:
                    raise ValueError('Public input index must not contain task bodies')
                if item['sourceProvenance'] != {'manifestSha256': archived_hash, 'dataset': dataset['name']}:
                    raise ValueError('Per-item source provenance differs')
    inputs = {run: {(d['name'], i['id']): i for d in manifest['datasets'] for i in d['items']} for run, manifest in manifests.items()}
    indexes = {run: algorithm.index_manifest(manifest) for run, manifest in manifests.items()}
    sidecar = {c['name']: c for c in read('comparator-sidecar.json.gz')['comparators']}
    decisions = {}; historical = {}
    for row in read('decisions.json.gz'):
        run = row['run']; key = (row['dataset'], row['id'])
        item = inputs[run][key]
        if row['freeze'] != plan['freezeHashes'][run] or row['gold'] != item['gold'] or row['inputRequestSha256'] != item['inputRequestSha256']:
            raise ValueError('Compact judgment input/freeze identity mismatch')
        if row['status'] == 'returned':
            flags = row.get('validityFlags')
            if not isinstance(flags, dict) or set(flags) != set(algorithm.VALIDITY_FLAGS) or not all(type(v) is bool for v in flags.values()):
                raise ValueError('Missing compact correctness validity flags')
            if row.get('eligibleForCorrectness') != (not any(flags.values())):
                raise ValueError('Compact correctness validity mismatch')
        full = (run, *key, row['variant'])
        if full in decisions:
            raise ValueError('Duplicate compact decision')
        if row['variant'] not in ('new', 'baseline') or row['status'] not in ('returned', 'missing', 'planned-unmeasured'):
            raise ValueError('Invalid compact decision state')
        if row['status'] != 'returned' and row['prediction'] is not None:
            raise ValueError('Missing judgment cannot invent a prediction')
        decisions[full] = row
    expected_decisions = set()
    for cell in plan['cells']:
        run, name = cell['run'], cell['dataset']
        for item in indexes[run][name]['items']:
            for variant in ('new', 'baseline'):
                key = (run, name, item['id'], variant); expected_decisions.add(key)
                if key not in decisions:
                    raise ValueError('Missing compact decision row')
                state = decisions[key]['status']
                if cell['plannedUnmeasured'] and state != 'planned-unmeasured':
                    raise ValueError('Planned unmeasured cell changed')
                if not cell['plannedUnmeasured'] and state != 'returned':
                    raise ValueError('Published comparison has incomplete live coverage')
    if set(decisions) != expected_decisions:
        raise ValueError('Unexpected compact decisions')
    for row in read('historical-decisions.json.gz'):
        key = (row['dataset'], row['baseline'], row['id'])
        if key in historical or row['qualification'] != 'unverified historical (lane report)':
            raise ValueError('Duplicate or unqualified historical decision')
        historical[key] = row
    comparisons = []; expected_historical = set()
    for cell in plan['cells']:
        run, name, baseline = cell['run'], cell['dataset'], cell['baseline']
        dataset = indexes[run][name]; matched = []; wins = losses = ours = theirs = 0
        if cell['baselineSource'] == 'sidecar':
            source = sidecar[cell['sidecarComparator']]
            baseline_rows = {i['id']: i for i in source['items'] if i['prediction'] is not None}
        elif cell['baselineSource'] == 'manifest':
            baseline_rows = dataset['baselines'][baseline]
        else:
            baseline_rows = None
        for item in dataset['items']:
            ident, gold = item['id'], item['gold']; candidate = decisions[(run, name, ident, 'new')]
            if baseline_rows is None:
                comparator = decisions[(run, name, ident, 'baseline')]
            else:
                key = (name, baseline, ident); expected_historical.add(key)
                comparator = historical[key]; source_row = baseline_rows.get(ident)
                if comparator['gold'] != gold or comparator['inputRequestSha256'] != item['inputRequestSha256']:
                    raise ValueError('Historical input identity mismatch')
                expected = source_row['prediction'] if source_row else None
                if comparator['prediction'] != expected or comparator['status'] != ('recorded' if source_row else 'missing'):
                    raise ValueError('Historical prediction differs from source artifact')
                if cell['baselineSource'] == 'sidecar' and source_row and (source_row['gold'] != gold or source_row['inputRequestSha256'] != item['inputRequestSha256']):
                    raise ValueError('Historical sidecar input identity mismatch')
            if candidate['status'] != 'returned' or comparator['status'] not in ('returned', 'recorded'):
                continue
            matched.append(ident); a = algorithm.correct(candidate, gold); b = algorithm.correct(comparator, gold)
            ours += int(a); theirs += int(b); wins += int(a and not b); losses += int(b and not a)
        comparisons.append({'dataset': name, 'baseline': baseline, 'matched': len(matched), 'matchedIds': sorted(matched),
                            'new_correct': ours, 'baseline_correct': theirs, 'wins': wins, 'losses': losses,
                            'p': algorithm.exact(wins, losses)})
    if set(historical) != expected_historical:
        raise ValueError('Unexpected historical decision rows')
    algorithm.holm(comparisons)
    saved_rows = {(r['dataset'], r['baseline']): r for r in saved['comparisons']}
    if len(saved_rows) != 44:
        raise ValueError('Published report family mismatch')
    for row in comparisons:
        original = saved_rows[(row['dataset'], row['baseline'])]
        for key, value in row.items():
            if original.get(key) != value:
                raise ValueError('Recomputed statistic differs: ' + key)
    public_freezes = read('public-freezes.json')
    left, right = (public_freezes[k]['redactedFreeze'] for k in ('original', 'supplemental'))
    if {k: v for k, v in left.items() if k != 'datasetsSha256'} != {k: v for k, v in right.items() if k != 'datasetsSha256'}:
        raise ValueError('Public configuration projections differ')
    if any(public_freezes[k]['originalNormalizedSha256'] != plan['freezeHashes'][k] for k in ('original', 'supplemental')):
        raise ValueError('Original freeze hash references differ')
    return {'family': len(comparisons), 'statisticsReproduced': True, 'decisions': len(decisions),
            'historicalDecisions': len(historical), 'configurationProjectionEqual': True,
            'inputDisclosure': 'Full input bodies archived locally; public report reproduces paired statistics, not API calls.',
            'freezeLimitation': 'Original complete freeze hashes are archival references; redacted copies cannot reproduce those original bytes.'}


if __name__ == '__main__':
    print(json.dumps(recompute(Path(__file__).resolve().parent), indent=2))
