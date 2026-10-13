#!/usr/bin/env python3
"""Independently recalculate summaries, exact tails and numeric band counts from raw records."""
import json
import math
import statistics
from collections import Counter, defaultdict
from bisect import bisect_left, bisect_right
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


def close(left, right):
    assert math.isclose(left, right, rel_tol=1e-12, abs_tol=1e-10), (left, right)


def check_summary(summary, values):
    assert len(values) == summary['n'] == 30
    close(summary['mean'], statistics.mean(values))
    close(summary['sampleStandardDeviation'], statistics.stdev(values))
    close(summary['min'], min(values))
    close(summary['max'], max(values))
    margin = 2.045229642132703 * statistics.stdev(values) / math.sqrt(30)
    close(summary['meanCI95'][0], statistics.mean(values) - margin)
    close(summary['meanCI95'][1], statistics.mean(values) + margin)


def check_paired(result, left, right):
    differences = [a - b for a, b in zip(left, right, strict=True)]
    assert differences == result['differences']
    distribution = Counter({0: 1})
    for delta in differences:
        changed = Counter()
        for total, count in distribution.items():
            changed[total + delta] += count
            changed[total - delta] += count
        distribution = changed
    assignments = 2 ** len(differences)
    assert sum(distribution.values()) == assignments
    extreme = sum(count for total, count in distribution.items() if abs(total) >= abs(sum(differences)))
    assert int(result['totalAssignments']) == assignments
    assert int(result['extremeAssignments']) == extreme
    assert result['pValue'] == extreme / assignments
    assert result['wins'] == sum(value > 0 for value in differences)
    assert result['ties'] == sum(value == 0 for value in differences)
    assert result['losses'] == sum(value < 0 for value in differences)
    check_summary(result['differenceSummary'], differences)


def counts(quantiles):
    n = len(quantiles)
    result = [0] * n
    for q in quantiles:
        assert math.isfinite(q) and 0 <= q < 1
        result[math.floor(q * n)] += 1
    return result


def check_grid():
    grid = read('full-results.json')
    assert len(grid['samples']) == 360
    index = {(row['budget'], row['method'], row['seed']): row for row in grid['samples']}
    assert len(index) == 360
    for row in grid['samples']:
        assert row['selected'] == len(row['picked']) == len(set(row['picked']))
        assert row['selected'] == row['complete'] + row['incompleteCount']
        assert row['incompleteCount'] == len(row['incompleteCells'])
        assert row['faultsCaught'] == len(row['witnesses'])
        assert row['faultsCaught'] + len(row['missed']) == 13
        assert row['pairsCovered'] <= 314 and row['runnablePairsCovered'] <= row['pairsCovered']
        assert all(0 <= picked < 747 for picked in row['picked'])
        assert not row['referenceFailures']
        assert row['equivalenceChecked'] == row['complete']
        close(row['wallMs'], row['selectionMs'] + row['renderAndScoreMs'])
    for summary in grid['summaries']:
        own = [index[summary['budget'], summary['method'], seed] for seed in range(1, 31)]
        for metric, result in summary['metrics'].items():
            check_summary(result, [row[metric] for row in own])
    for trial in grid['pairedTests']:
        left = [index[trial['budget'], 'hybrid', seed] for seed in range(1, 31)]
        right = [index[trial['budget'], trial['control'], seed] for seed in range(1, 31)]
        for metric, result in trial['metrics'].items():
            check_paired(result, [row[metric] for row in left], [row[metric] for row in right])
        check_summary(trial['wallMsDifference'], [a['wallMs'] - b['wallMs'] for a, b in zip(left, right, strict=True)])
    for method in ('hybrid', 'random'):
        for old in read(f'{method}-results.json')['samples']:
            new = index[20, method, old['seed']]
            for key in ('picked', 'faultsCaught', 'pairsCovered', 'complete', 'incompleteCount'):
                assert old[key] == new[key]
    return grid


def check_numeric(source):
    numeric = read('numeric-results.json')
    assert numeric['provenance']['sourceCommit'] == source
    samples = []
    for name in numeric['rawFiles']:
        raw = read(Path(name).name)
        assert raw['sourceCommit'] == source and len(raw['samples']) == 60
        samples.extend(raw['samples'])
    index = {(row['budget'], row['method'], row['seed']): row for row in samples}
    assert len(index) == 240
    checks = 0
    for row in samples:
        assert row['pairsCovered'] == 11
        assert len(row['rows']) == row['budget']
        groups = defaultdict(list)
        for value in row['rows']:
            groups[tuple(sorted(value['cell'].items()))].append(value)
            for setting in numeric['policy']['settings']:
                q = value['quantiles'][setting['id']]
                expected = (math.ceil(setting['min']) + math.floor(q * (math.floor(setting['max']) - math.ceil(setting['min']) + 1))
                            if setting.get('integer') else setting['min'] + q * (setting['max'] - setting['min']))
                close(value['vars'][setting['id']], expected)
        assert len(groups) == 6
        global_hit, slice_hit, perfect = 0, 0, 0
        for setting in row['strata']:
            actual = counts([value['quantiles'][setting['setting']] for value in row['rows']])
            assert actual == setting['global']['counts']
            global_hit += sum(value > 0 for value in actual)
            for group in setting['slices']:
                own = groups[tuple(sorted(group['cell'].items()))]
                assert len(own) == group['size']
                actual = counts([value['quantiles'][setting['setting']] for value in own])
                assert actual == group['counts']
                assert group['perfect'] == all(value == 1 for value in actual)
                assert group['hit'] == sum(value > 0 for value in actual)
                slice_hit += group['hit']
                perfect += group['perfect']
                if row['method'] == 'sliced-lhs':
                    assert group['perfect']
                    checks += 1
        assert row['globalBandsHit'] == global_hit
        assert row['sliceBandsHit'] == slice_hit
        assert row['perfectSliceSettings'] == perfect
        other = index[row['budget'], 'uniform' if row['method'] == 'sliced-lhs' else 'sliced-lhs', row['seed']]
        assert [value['cell'] for value in row['rows']] == [value['cell'] for value in other['rows']]
        if row['method'] == 'sliced-lhs':
            assert global_hit == slice_hit == row['budget'] * 3
        else:
            assert global_hit < row['budget'] * 3 and slice_hit < row['budget'] * 3
    assert checks == 2160
    for summary in numeric['summaries']:
        own = [index[summary['budget'], summary['method'], seed] for seed in range(1, 31)]
        for metric, result in summary['metrics'].items():
            check_summary(result, [row[metric] for row in own])
    for trial in numeric['pairedTests']:
        left = [index[trial['budget'], 'sliced-lhs', seed] for seed in range(1, 31)]
        right = [index[trial['budget'], 'uniform', seed] for seed in range(1, 31)]
        for metric, result in trial['metrics'].items():
            check_paired(result, [row[metric] for row in left], [row[metric] for row in right])


def main():
    grid = check_grid()
    source = grid['provenance']['sourceCommit']
    check_numeric(source)
    whole = read('full-suite-results.json')
    assert len(whole) == 8
    for row in whole:
        assert row['provenance']['sourceCommit'] == source
        assert row['faultsCaught'] == len(row['witnesses']) == 13 and not row['missed']
        assert not row['referenceFailures']
        assert row['wholePairs']['allowed'] == 637
        assert math.isfinite(row['wholeMaxDeviation'])
    reach = read('reachability-results.json')
    assert reach['provenance']['sourceCommit'] == source
    assert reach['policy']['renderedCells'] == 22410
    assert len(reach['findings']) == 4
    for row in reach['seedAudits']:
        assert row['selected'] == 747
        assert row['targets'] == {'function:acme-sales': 747}
        assert row['kinds'] == {'conversation': 747}
    for row in reach['findings']:
        assert row['selectedConversationWitnesses'] == 0
        assert row['fullGeneratorReachable'] and row['fullGeneratorWitness']['spec']['kind'] == 'task'
    continuous = read('time-balance-results.json')
    assert continuous['provenance']['measurementSourceCommit'] == source
    for trial in continuous['comparisons']:
        own = lambda method: sorted([row for row in grid['samples'] if row['budget'] == trial['budget'] and row['method'] == method], key=lambda row: row['seed'])
        for metric, result in trial['metrics'].items():
            left, right = [row[metric] for row in own('hybrid')], [row[metric] for row in own(trial['control'])]
            power = result['commonPowerOfTwo']
            scale = Fraction(2 ** power) if power >= 0 else Fraction(1, 2 ** -power)
            exact = [(Fraction(a) - Fraction(b)) / scale for a, b in zip(left, right, strict=True)]
            assert all(delta.denominator == 1 for delta in exact)
            differences = [delta.numerator for delta in exact]
            assert differences == [int(delta) for delta in result['scaledIntegerDifferences']]
            assert sum(differences) == int(result['scaledObservedSum'])
            def half_sums(values):
                sums = [0]
                for value in values:
                    sums = [new for old in sums for new in (old + value, old - value)]
                return sums
            threshold = abs(sum(differences))
            first = half_sums(differences[:15])
            second = sorted(half_sums(differences[15:]))
            extreme = 2 ** 30 if threshold == 0 else sum(bisect_right(second, -threshold - value) + len(second) - bisect_left(second, threshold - value) for value in first)
            assert extreme == int(result['extremeAssignments'])
            assert result['pValue'] == extreme / 2 ** 30
            check_summary(result['differenceSummary'], [a - b for a, b in zip(left, right, strict=True)])
    print('Verified 360 selected-grid samples, 240 numeric trials, exact paired tails, intervals, 2160 slice checks and 4 task witnesses.')


if __name__ == '__main__':
    main()
