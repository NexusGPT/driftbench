#!/usr/bin/env python3
"""Render measured tables, and optionally fill only pending paper cells plus a measured appendix."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUDGETS = (20, 50, 100, 200)
METHODS = ('hybrid', 'pairwise', 'random')


def read(name):
    return json.loads((ROOT / name).read_text())


def number(value, digits=2):
    return f'{value:.{digits}f}'


def interval(summary):
    return ' to '.join(number(value) for value in summary['meanCI95'])


def stats(summary):
    return (f'{number(summary["mean"])}; SD {number(summary["sampleStandardDeviation"])}; '
            f'range {number(summary["min"])} to {number(summary["max"])}; 95% CI {interval(summary)}')


def table(headers, rows):
    return '\n'.join(['| ' + ' | '.join(headers) + ' |', '| ' + ' | '.join('---' for _ in headers) + ' |']
                     + ['| ' + ' | '.join(str(cell) for cell in row) + ' |' for row in rows])


def write_report(data_commit=None):
    grid, numeric, reach = (read(name) for name in ('full-results.json', 'numeric-results.json', 'reachability-results.json'))
    whole = read('full-suite-results.json')
    continuous = read('time-balance-results.json')
    source = grid['provenance']['sourceCommit']
    assert numeric['provenance']['sourceCommit'] == source == reach['provenance']['sourceCommit']
    assert all(row['provenance']['sourceCommit'] == source for row in whole)
    summaries = {(row['budget'], row['method']): row['metrics'] for row in grid['summaries']}
    tests = {(row['budget'], row['control']): row['metrics'] for row in grid['pairedTests']}
    base = 'https://github.com/NexusGPT/driftbench/blob/'

    def artifact(name):
        return f'{base}{data_commit}/comparisons/budget/{name}' if data_commit else name

    lines = [
        '# Paired budget measurements', '',
        f'Measurement source: `{source}`. Acme map hash: `{grid["provenance"]["mapHash"]}`. '
        'Selection/rendering seeds: 1 through 30. Execution seed: 1. Model calls: 0. Model/tool spend: $0.', '',
        'The selected-row study uses the production budget and pairwise seeders. Random samples the same 747-cell '
        'pool without replacement. Both complete and incomplete rows count toward drawn pair coverage and balance. '
        'Only complete rows enter fault scoring. All complete rows pass their reference and excluded-fault equivalence checks.', '',
        'Each summary cell reports mean, sample SD, range and a two-sided 95% Student t interval for the seed mean '
        '(29 degrees of freedom). These intervals assume independent seed trials. Constant observations give a zero-width interval. '
        'The intervals describe this seed distribution, not variation across systems.', '',
        '## Selected rows', '',
    ]
    rows = []
    for budget in BUDGETS:
        for method in METHODS:
            m = summaries[budget, method]
            rows.append([budget, method, stats(m['faultsCaught']), stats(m['pairsCovered']),
                         stats(m['selected']), stats(m['complete']), stats(m['incompleteCount']), stats(m['wallMs'])])
    lines += [table(['Budget', 'Method', 'Faults / 13', 'Drawn pairs / 314', 'Selected rows', 'Complete rows',
                     'Incomplete rows', 'Wall ms'], rows), '',
              'Wall time starts before selection/drafting and ends after rendering and fault scoring. It excludes map loading, '
              'result-file output and analysis. Execution order rotates across methods. Scoring is uncached, and a mutant '
              'stops running after its first witness, matching the retained controls. Wall times are observations on a shared machine.', '',
              '### Balance and runnable coverage', '']
    lines += [table(['Budget', 'Method', 'Maximum value-count deviation', 'Runnable pairs / 314', 'Executed adapter runs',
                     'Executed blocks'], [[budget, method, stats(summaries[budget, method]['maxDeviation']),
                        stats(summaries[budget, method]['runnablePairsCovered']), stats(summaries[budget, method]['executedRuns']),
                        stats(summaries[budget, method]['executedBlocks'])] for budget in BUDGETS for method in METHODS]), '',
              '## Exact paired comparisons', '',
              'Each test swaps method labels independently within each seed pair and uses the absolute sum of differences. '
              'Integer-sum dynamic programming counts all 1,073,741,824 assignments, including zero differences and equal-extreme tails. '
              'The null assumes exchangeable labels within pairs and independent swaps across pairs. P-values are unadjusted.', '']
    rows = []
    for budget in BUDGETS:
        for control in ('pairwise', 'random'):
            m = tests[budget, control]
            rows.append([budget, f'hybrid minus {control}', stats(m['faultsCaught']['differenceSummary']),
                         str(m['faultsCaught']['pValue']), f'{m["faultsCaught"]["extremeAssignments"]}/{m["faultsCaught"]["totalAssignments"]}',
                         stats(m['pairsCovered']['differenceSummary']), str(m['pairsCovered']['pValue']),
                         f'{m["pairsCovered"]["extremeAssignments"]}/{m["pairsCovered"]["totalAssignments"]}'])
    lines += [table(['Budget', 'Comparison', 'Fault difference', 'Fault p', 'Fault exact tail', 'Pair difference', 'Pair p',
                     'Pair exact tail'], rows), '',
              'At budgets 50, 100 and 200, hybrid versus pairwise fault catches show **no measured difference**: '
              'all 30 paired differences are zero and each exact two-sided p-value is 1.', '',
              'At budget 200, pairwise catches 9 of 13 with 132 selected rows; hybrid catches 9 of 13 with 200 rows '
              'in every seed. This is a selected-row cost saving of 68 rows, or 34%, for the same measured catch. '
              'The saving is in selected rows; it does not measure dollars or whole-suite cost.', '',
              '### Exact wall-time and balance tests', '',
              f'Post-measurement analysis source: `{continuous["provenance"]["analysisSourceCommit"]}`. '
              'These tests retain the binary64 observations exactly, convert them to a common power-of-two integer scale, '
              'and count paired label-swap tails by splitting each assignment into two halves. '
              'No rounding or Monte Carlo sampling enters the tests. Wall-time comparisons remain shared-machine observations.', '',
              table(['Budget', 'Comparison', 'Wall-ms paired difference', 'Wall-time p', 'Balance paired difference', 'Balance p'],
                    [[row['budget'], f'hybrid minus {row["control"]}', stats(row['metrics']['wallMs']['differenceSummary']),
                      row['metrics']['wallMs']['pValue'], stats(row['metrics']['maxDeviation']['differenceSummary']),
                      row['metrics']['maxDeviation']['pValue']] for row in continuous['comparisons']]), '',
              '### Per-seed differences at budget 20', '']
    own = {(row['seed'], row['method']): row for row in grid['samples'] if row['budget'] == 20}
    lines += [table(['Seed', 'Hybrid faults', 'Pairwise faults', 'Hybrid minus pairwise', 'Random faults', 'Hybrid minus random'],
                    [[seed, own[seed, 'hybrid']['faultsCaught'], own[seed, 'pairwise']['faultsCaught'],
                      own[seed, 'hybrid']['faultsCaught'] - own[seed, 'pairwise']['faultsCaught'],
                      own[seed, 'random']['faultsCaught'], own[seed, 'hybrid']['faultsCaught'] - own[seed, 'random']['faultsCaught']]
                     for seed in range(1, 31)]), '',
              '## Four uncaught faults: reachability diagnosis', '',
              f'The full-space audit renders all 747 allowed conversation cells at each of 30 seeds '
              f'({reach["policy"]["renderedCells"]:,} renderings). It finds zero task specs or operations targets. '
              'The conversation dimensions exclude task-kind axes and hold task values at `none`; the renderer emits conversation specs. '
              'These four faults are outside the selected-conversation space, not rows missed by the selector. '
              'The whole generator supplies task-family specs and catches all four, so this is a conversation-scope gap, '
              'not an absent full-generator oracle.', '']
    lines += [table(['Fault', 'Trigger / observation', 'Reachable in selected conversations?', 'Full-generator task witness'],
                    [[f'`{row["fault"]}`', row['description'], 'No: process-backed task target',
                      f'`{row["fullGeneratorWitness"]["witness"]}`'] for row in reach['findings']]), '',
              '## Numeric sampling ablation', '',
              f'Numeric map hash: `{numeric["provenance"]["mapHash"]}`. The approved fictional fixture has '
              'temperature and delay ranges plus integer iterations, and six categorical cells. '
              'The uniform control uses the identical ordered categorical rows and changes only numeric quantiles. '
              'Band counts use latent quantiles; integer levels can repeat. Every rendered row retains the same categorical metadata '
              'and delivers its sampled values through `given.vars`.', '']
    rows = []
    for row in numeric['summaries']:
        m, budget = row['metrics'], row['budget']
        rows.append([budget, row['method'], stats(m['globalBandsHit']) + f' of {3 * budget}',
                     stats(m['sliceBandsHit']) + f' of {3 * budget}', stats(m['perfectSliceSettings']) + ' of 18',
                     stats(m['pairsCovered']) + ' of 11'])
    lines += [table(['Budget', 'Method', 'Global bands hit', 'Per-slice bands hit', 'Perfect slice/setting checks',
                     'Categorical pairs'], rows), '',
              'Sliced LHS hits every global band once and every within-slice band once for all three settings in every trial. '
              'All 2,160 slice/setting checks and 360 global-setting checks pass. Each uniform trial misses at least one band. '
              'Singleton slices trivially pass within-slice checks for both methods; the raw records retain every slice size. '
              'Categorical coverage stays 11 of 11 for both methods at all budgets. No numeric fault-detection outcome is measured.', '',
              table(['Budget', 'Global band-count paired p', 'Per-slice band-count paired p', 'Perfect slice/setting-count paired p'],
                    [[row['budget'], row['metrics']['globalBandsHit']['pValue'], row['metrics']['sliceBandsHit']['pValue'],
                      row['metrics']['perfectSliceSettings']['pValue']] for row in numeric['pairedTests']]), '',
              '## Whole-suite seed-1 supplement', '',
              'These CLI runs include other seeders and coverage completion, outside the selected-row budget. '
              'Whole value balance counts complete-spec/value incidences at strength one on all map axes; '
              'fair share is incidences divided by feasible values per dimension. A spec can expose multiple values. '
              'This balance measure differs from one-cell-per-selected-row balance.', '',
              table(['Budget', 'Method', 'Complete / incomplete', 'Faults / 13', 'Whole pairs / 637', 'Whole value-count deviation',
                     'Wall ms', 'Executed adapter runs / blocks'],
                    [[row['budget'], row['mode'], f'{row["complete"]} / {row["incomplete"]}', row['faultsCaught'],
                      row['wholePairs']['covered'], number(row['wholeMaxDeviation']), number(row['timing']['wallMs']),
                      f'{row["cost"]["executedRuns"]} / {row["cost"]["executedBlocks"]}'] for row in whole]), '',
              '## Reproduction and raw records', '',
              '```bash', 'pnpm install --frozen-lockfile --ignore-scripts',
              'pnpm exec tsx comparisons/budget/check-analysis.ts',
              'pnpm exec tsx comparisons/budget/full-control.ts',
              'pnpm exec tsx comparisons/budget/numeric-control.ts',
              'pnpm exec tsx comparisons/budget/full-suite-control.ts',
              'pnpm exec tsx comparisons/budget/reachability.ts',
              'pnpm exec tsx comparisons/budget/time-balance-tests.ts',
              'python3 comparisons/budget/audit-results.py',
              'python3 comparisons/budget/report.py', '```', '',
              f'- [Selected grid, seeds, witnesses and paired tests]({artifact("full-results.json")})',
              f'- [Numeric summaries and paired tests]({artifact("numeric-results.json")})',
              f'- [Whole-suite seed-1 records]({artifact("full-suite-results.json")})',
              f'- [Exhaustive conversation routing and task witnesses]({artifact("reachability-results.json")})',
              f'- [Exact wall-time and balance paired tests]({artifact("time-balance-results.json")})',
              *[f'- [Numeric raw trials, budget {budget}]({artifact(f"numeric-{budget}-samples.json")})' for budget in BUDGETS], '',
              'The budget-20 hybrid and random grid is checked seed by seed against the retained earlier records. '
              'The current Acme map hash is `6d29ed7a7539`; the retained controls use `b583de68c530`. '
              'All 30 selected-index, fault, pair, complete-row and incomplete-row records match those controls. '
              'Exact-test checks use independent exhaustive enumeration on mixed-sign small cases. '
              'The interval critical value is checked by independently integrating the Student t density. '
              'Pure pairwise is a practical baseline with different row construction, not a count-balancing ablation.', '']
    return '\n'.join(lines), grid, numeric, reach, whole


def fill_paper(path, report, grid, whole, data_commit):
    text = path.read_text()
    source = grid['provenance']['sourceCommit']
    summaries = {(row['budget'], row['method']): row['metrics'] for row in grid['summaries']}
    start = text.index('| Budget / output | Method | Faults caught |')
    end = text.index('\n\n', start)
    original = text[start:end]
    lines = original.splitlines()
    replaced = 0
    for index, line in enumerate(lines[2:], 2):
        cells = [cell.strip() for cell in line.strip('|').split('|')]
        if len(cells) != 6:
            raise ValueError('Unexpected paper table shape')
        budget = int(cells[0].split()[-1])
        label = f'(measured, budget {budget}, seeds 1 through 30, commit `{source}`)'
        if cells[1] == 'Full suite':
            row = next(row for row in whole if row['budget'] == budget and row['mode'] == 'budget')
            label = f'(measured, budget {budget}, seed 1, commit `{source}`)'
            values = [f'{row["faultsCaught"]} of 13', f'{row["wholePairs"]["covered"]} of {row["wholePairs"]["allowed"]}',
                      f'{number(row["wholeMaxDeviation"])} (complete-spec/value incidences)',
                      f'{number(row["timing"]["wallMs"])} ms; {row["complete"]} complete / {row["incomplete"]} incomplete; model calls 0, $0']
        elif cells[1] == 'Hybrid' and budget == 20:
            row = next(row for row in grid['samples'] if row['budget'] == 20 and row['method'] == 'hybrid' and row['seed'] == 1)
            label = f'(measured, budget 20, seed 1, commit `{source}`)'
            values = [f'{row["faultsCaught"]} of 13', f'{row["pairsCovered"]} of 314', number(row['maxDeviation']),
                      f'{number(row["wallMs"])} ms; {row["complete"]} complete / {row["incompleteCount"]} incomplete; model calls 0, $0']
        else:
            method = 'pairwise' if cells[1] == 'Pure pairwise' else 'random' if cells[1].startswith('Random') else 'hybrid'
            m = summaries[budget, method]
            if cells[1].endswith('spread'):
                def spread_cell(summary):
                    return f'sample SD {number(summary["sampleStandardDeviation"])}, range {number(summary["min"])} to {number(summary["max"])}'
                values = [spread_cell(m[key]) for key in ('faultsCaught', 'pairsCovered', 'maxDeviation', 'wallMs')]
                values[3] += ' ms'
            else:
                values = [f'{stats(m["faultsCaught"])} of 13', f'{stats(m["pairsCovered"])} of 314', stats(m['maxDeviation']),
                          f'{stats(m["wallMs"])} ms; mean {number(m["complete"]["mean"])} complete / {number(m["incompleteCount"]["mean"])} incomplete; model calls 0, $0']
        for column, value in enumerate(values, 2):
            if cells[column] == '[PENDING MEASUREMENT]':
                cells[column] = f'{value} {label}'
                replaced += 1
        lines[index] = '| ' + ' | '.join(cells) + ' |'
    text = text[:start] + '\n'.join(lines) + text[end:]
    marker = '\n<!-- paired-budget-measurements -->\n'
    if marker in text:
        text = text[:text.index(marker)]
    appendix = report.replace('# Paired budget measurements', '## Additional paired measurements', 1)
    # Shift report headings one level inside the paper, while keeping its root appendix at H2.
    appendix = '\n'.join('#' + line if line.startswith('## ') and line != '## Additional paired measurements'
                         else '#' + line if line.startswith('### ') else line for line in appendix.splitlines())
    text += marker + f'\nRaw records pinned to data commit `{data_commit}`. Earlier method sections retain their historical snapshot pins.\n\n' + appendix + '\n'
    path.write_text(text)
    print(f'Replaced {replaced} pending cells in {path.name}; retained every previously populated cell.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paper', type=Path)
    parser.add_argument('--data-commit')
    args = parser.parse_args()
    if args.paper and not args.data_commit:
        parser.error('--paper requires an immutable --data-commit')
    report, grid, _, _, whole = write_report(args.data_commit if args.paper else None)
    if args.paper:
        fill_paper(args.paper, report, grid, whole, args.data_commit)
    else:
        (ROOT / 'full-study.md').write_text(report)
        print('Wrote full-study.md from measured records')


if __name__ == '__main__':
    main()
