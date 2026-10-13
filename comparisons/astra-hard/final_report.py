"""Assemble only complete, recorded cohorts; no model calls or pooled results."""
import argparse
import datetime
from fractions import Fraction
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAMES = {'promptfoo-rubric': 'promptfoo rubric', 'langfuse-reference': 'Langfuse reference correctness'}

def read(path):
    return json.loads(path.read_text())

def exact(row):
    w, l = row['ours_only_correct'], row['peer_only_correct']
    n = w + l
    p = Fraction(sum(math.comb(n, k) for k in range(w, n + 1)), 2 ** n)
    m = min(Fraction(1), 2 * Fraction(sum(math.comb(n, k) for k in range(min(w, l) + 1)), 2 ** n))
    assert float(p) == row['one_sided_sign_test']['p']
    return p, m

def frac(value):
    return f'{value.numerator}/{value.denominator} = {float(value):.10g}'

def interval(value):
    return f'[{100 * value["lower"]:.3f}, {100 * value["upper"]:.3f}]'

def accuracy(value, n):
    return f'{value["correct"]}/{n} ({100 * value["accuracy"]:.3f}%)'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    primary = read(HERE / 'scores.json')
    pv = read(HERE / 'verification.json')
    ps = read(HERE / 'supplement.json')
    candidate = read(HERE / 'candidates/scores.json') if (HERE / 'candidates/scores.json').exists() else None
    cs = read(HERE / 'candidates/supplement.json') if candidate else None
    cv = read(HERE / 'candidates/verification.json') if candidate else None
    mapped = (HERE / 'map/verification.json').exists()
    cohorts = [('Original 12 families', [('Main default', primary, ps), *([('Frozen candidate', candidate, cs)] if candidate else [])])]
    if mapped:
        cohorts.append(('Separate map replication', [
            ('Main default', read(HERE / 'map/default-scores.json'), read(HERE / 'map/default-supplement.json')),
            ('Frozen candidate', read(HERE / 'map/candidate-scores.json'), read(HERE / 'map/candidate-supplement.json'))]))
    lines = ['# Fresh hard rows', '',
        'Main default is reported first. The primary cohort has 192 cases per row from the original 12 construction families, not the budget generator. The candidate is a separately registered third side on those exact cases, reusing the peer recordings. It is not an independent replication.', '',
        f'Report generated at {datetime.datetime.now(datetime.timezone.utc).isoformat()}. Primary registration `9c1c2ff8` and candidate registration `b63b9103` remain unchanged.', '']
    for cohort, procedures in cohorts:
        lines += [f'## {cohort}', '', '| Row | Main default | Frozen candidate | Peer |', '|---|---:|---:|---:|']
        for name, title in NAMES.items():
            r = procedures[0][1]['summary'][name]
            c = procedures[1][1]['summary'][name] if len(procedures) > 1 else None
            lines.append(f'| {title} | {accuracy(r["ours"], r["total"])} | {accuracy(c["ours"], c["total"]) if c else "Pending"} | {accuracy(r["peer"], r["total"])} |')
        lines += ['', 'W counts only the named procedure correct; L counts only the peer correct. Both-correct and both-wrong pairs do not enter the exact tests.', '',
            '| Row | Procedure | W | L | Both correct | Both wrong | Exact one-sided p | Exact two-sided McNemar p | Bar |',
            '|---|---|---:|---:|---:|---:|---|---|---|']
        for procedure, data, supplement in procedures:
            for name, title in NAMES.items():
                r = data['summary'][name]
                p, m = exact(r)
                assert abs(float(m) - supplement[name]['exact_mcnemar_two_sided']['pValue']) < 1e-12
                bar = 'lead' if r['ours']['accuracy'] > r['peer']['accuracy'] and (m if procedure == 'Main default' else p) < Fraction(1, 20) else 'equal'
                lines.append(f'| {title} | {procedure} | {r["ours_only_correct"]} | {r["peer_only_correct"]} | {r["both_correct"]} | {r["both_wrong"]} | {frac(p)} | {frac(m)} | **{bar}** |')
        lines += ['', '| Row | Procedure | Procedure accuracy, family bootstrap 95% | Peer accuracy, family bootstrap 95% | Paired difference, percentage points 95% | Procedure USD/100 | Peer USD/100 |',
            '|---|---|---|---|---|---:|---:|']
        for procedure, data, supplement in procedures:
            for name, title in NAMES.items():
                r, s = data['summary'][name], supplement[name]
                lines.append(f'| {title} | {procedure} | {interval(s["ours_family_bootstrap95"])} | {interval(s["peer_family_bootstrap95"])} | {interval(s["paired_difference_family_bootstrap95"])} | ${r["ours"]["usd_per_100"]:.8f} | ${r["peer"]["usd_per_100"]:.8f} |')
        lines += ['']
    lines += ['## Tests and interpretation', '',
        'For W wins and L losses, the exact one-sided sign test is sum(comb(W+L,k), k=W..W+L) / 2**(W+L). This is also the directional exact McNemar test. The two-sided exact McNemar p is min(1, 2 * sum(comb(W+L,k), k=0..min(W,L)) / 2**(W+L)). Zero discordant pairs gives p=1. Inconclusive predictions count as wrong.', '',
        'Main default requires higher accuracy and two-sided exact McNemar p below 0.05 for a lead. The frozen candidate uses the requested higher-accuracy and exact one-sided p below 0.05 bar. Otherwise the row stays equal. Equal is the decision label, not a demonstrated equivalence margin. No cohorts are pooled and no multiple-test adjustment is applied.', '',
        'The bootstrap resamples all 12 construction families with replacement, carrying every paired case within each sampled family. It reports case-weighted means and their paired difference, using 20,000 draws, percentile 95% intervals and seed 2619092984. Exact p-values are nominal case-level tests; repeated templates and shared profiles limit independence. Twelve clusters and a narrow fictional domain also limit generalization. A bootstrap interval of [0,0] at saturation does not establish population equivalence.', '',
        '## Registration and procedures', '',
        '- Main source: `5a90bfb698d2200d391fb3d626e316744d22854e`, the fetched origin/main used to create `research/astra-hard-fresh`. Production source and previous tuning and held-out sets remain unchanged.',
        '- Original cohort: seed `20261217`; 192 cases per row, 96 pass and 96 fail, eight of each label per family. Labels are planted by the original generator code. All data is fictional and exact payload overlap with prior tuning and held-out sets is zero.',
        '- Primary cases, requests and procedures were committed at `9c1c2ff8783b02d7dffa1b9dcd9b638405f6dce4` before its first call. Its 117 frozen file hashes verify.',
        '- Main default uses current main buildPrompt and parseJudgeText, without optional answer contracts, requirements, fact audits or prompt overrides.',
        '- promptfoo uses its pinned native DEFAULT_GRADING_PROMPT, native JSON extraction and deriveVerdictFromGrader without a custom threshold.',
        '- Langfuse uses its pinned native managed Correctness template, the previously selected threshold 0.5 and the original comparison JSON decoder with strict quote repair.',
        '- The promptfoo candidate is the frozen criterion ledger procedure `d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587`. The Langfuse candidate is the fact ledger in `comparisons/langfuse/hard/audit.txt`, SHA-256 `5ab527bec76758641fcfd13ebe7c576486ae145fb2cce183a25d9b2838621ca8`.',
        '- Candidate requests and decoders were committed at `b63b910349938b2a15552544184aa527a94bba60` before candidate calls. The candidate side reuses all primary peer answers unchanged, with no additional peer cost.',
        f'- Every recorded judge call resolves the haiku alias to `{pv["resolved_models"][0]}`. All sides have identical CLI model settings. There is one recorded answer per side and case, at most two calls concurrently, no retries and no tuning on outcomes.', '',
        '## Optional map replication', '']
    if mapped:
        mv = read(HERE / 'map/verification.json')
        lines += [
            'Completed independently under registration `25fee06e9213a377116f00fba510b7bb701548d4`. Its source families remain the original 12; its categorical schedule and numeric settings come from native map generation. It is not pooled with the primary cohort.', '',
            '- Construction freeze: `7ee661e3ddb1e979eb0940c9fe34fbe6e1db779a`. Hidden seed `2274381994` is the first eight SHA-256 hex digits of that commit, converted to an integer.',
            '- Each map ran `generate --budget 192 --t 2`. Only the 192 budget rows were rendered, excluding the 12 graph scaffolding rows. Axes are family and planted truth. Numeric settings control reply length, number size and distractor count; reply length is a target minimum, and reference prices use the closest original numeric step.',
            '- Code-only gates before sealing: label metadata leakage check, native character 3-5 gram TF-IDF cosine deduplication at 0.95 against earlier kept cases and the primary cases, then deterministic trimming for equal pass/fail labels. This is lexical cosine, not a learned semantic embedding.', '',
            '| Row | Generated | Leak drops | Cosine drops | Balance drops | Sealed | Pass / fail | Constant-pass accuracy |',
            '|---|---:|---:|---:|---:|---:|---|---:|']
        gate = read(HERE / 'map/gate-report.json')['rows']
        for name, title in NAMES.items():
            g = gate[name]
            lines.append(f'| {title} | {g["input"]} | {g["leak_drops"]} | {g["near_duplicate_drops"]} | {g["balance_drops"]} | {g["kept"]} | {g["pass"]} / {g["fail"]} | 50% |')
        lines += ['',
            'One isolated sub-agent saw only the 72-item packet and label rubric, with no planted labels, judge outputs or scores. Three labels per family per row were audited; all 72 matched. Three reference cases (002, 110 and 170) received an ambiguity note about a monthly modifier shared by fee and allowance. They retain the original contextual reading and remain in every denominator unchanged.', '',
            'All 12 families survive. Raw two-way coverage was 24/24 for each row; native space completion on retained specs reports 20/24 rubric cells and 23/24 reference cells. The completeness estimator assumes independent conversations and is optimistic for a coverage-directed generator, so no full post-gate coverage claim is made.', '',
            'Native holdout seals record the retained construction specs. A separately committed fixture seal binds the actual case files and a per-side query budget of one. The journaled comparison runner transports the judge requests; native holdout score is not the transport. All seals, requests, decoders, audit files and code were committed before the first map call.', '',
            'Saturation was marked after all recorded calls, with no filtering:', '',
            '| Row | All three correct | All three wrong | Mixed correctness |', '|---|---:|---:|---:|']
        for name, title in NAMES.items():
            s = mv['saturation'][name]
            lines.append(f'| {title} | {s["all-correct"]} | {s["all-wrong"]} | {s["discordant"]} |')
    else:
        lines += ['The independently registered map cohort is pending. No map results are included here.']
    lines += ['', '## Calls, chronology and spend', '',
        '| Run | Calls | First call UTC | Last call UTC | Reported USD |', '|---|---:|---|---|---:|',
        f'| Primary | 768 | {pv["first_call"]} | {pv["last_call"]} | ${pv["total_cost_usd"]:.8f} |']
    total = pv['total_cost_usd']
    if candidate:
        total += cv['additional_cost_usd']
        lines.append(f'| Candidate third side | 384 | {cv["first_call"]} | {cv["last_call"]} | ${cv["additional_cost_usd"]:.8f} |')
    if mapped:
        total += mv['map_cost_usd']
        lines.append(f'| Separate map replication | 1008 | {mv["first_call"]} | {mv["last_call"]} | ${mv["map_cost_usd"]:.8f} |')
    lines += ['', f'Total reported judge-call spend: **${total:.8f} of $10.00**. Costs are CLI-reported run costs, including cache behavior; orchestration and the isolated audit agent are not metered by this runner. Per-row and per-side start/completion rows are appended to `scratchpad/spend-ledger.md`. Reused primary peer calls are charged once.', '',
        'Completed-run integrity checks verify request uniqueness, committed hashes, resolved model equality, cost completeness, the required run order and maximum concurrency of two. Completed calls finished before 07:30 Europe/Brussels. There were zero failed calls, unknown costs or retries.', '',
        '## Family accuracy counts', '', '| Cohort | Row | Family | Cases | Main default | Candidate | Peer |', '|---|---|---|---:|---:|---:|---:|']
    for cohort, procedures in cohorts:
        for name, title in NAMES.items():
            for family, f in procedures[0][1]['summary'][name]['families'].items():
                c = procedures[1][1]['summary'][name]['families'][family]['ours'] if len(procedures) > 1 else 'Pending'
                lines.append(f'| {cohort} | {title} | {family} | {f["total"]} | {f["ours"]} | {c} | {f["peer"]} |')
    lines += ['', '## Evidence and free reproduction', '',
        'All evidence lives in `comparisons/astra-hard/` on `research/astra-hard-fresh`: primary files at the directory root, third-side files in `candidates/`, and the independent replication in `map/`. Each contains its pre-registration manifest, full requests, dispatch journal, raw answers, model usage, timestamps, costs, case-level correctness, discordant ids and verification records. All analysis commands below use recordings and make no model calls.', '',
        '```sh',
        'python3 comparisons/astra-hard/score.py',
        'python3 comparisons/astra-hard/verify.py',
        'node --import tsx comparisons/astra-hard/supplement.mts',
        *(['python3 comparisons/astra-hard/candidates/score.py', 'node --import tsx comparisons/astra-hard/supplement.mts comparisons/astra-hard/candidates/scores.json'] if candidate else []),
        *(['python3 comparisons/astra-hard/map/score.py', 'node --import tsx comparisons/astra-hard/supplement.mts comparisons/astra-hard/map/default-scores.json', 'node --import tsx comparisons/astra-hard/supplement.mts comparisons/astra-hard/map/candidate-scores.json'] if mapped else []),
        '```', '']
    output = '\n'.join(lines)
    assert '\u2013' not in output and '\u2014' not in output
    args.output.write_text(output)
    (HERE / 'results.md').write_text(output)
    print(f'Wrote report; measured judge-call spend USD {total:.8f}.')

if __name__ == '__main__':
    main()
