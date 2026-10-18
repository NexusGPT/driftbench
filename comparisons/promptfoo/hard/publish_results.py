"""Write side-by-side hard and held-out tables from full, verified recordings."""
import datetime
import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from run import HERE, recordings, task_config
from verify import verify

REPORT = Path(task_config().get('report', str(HERE / 'runtime/report-hard.md')))
DOC = HERE.parents[2] / 'docs/comparison/promptfoo.md'
NAMES = {'rubric': 'LLM rubric', 'factuality': 'Factuality', 'pii': 'Personal data', 'goal': 'Trajectory goal success'}


def percent_ci(ci):
    return f'{100 * ci[0]:.2f}% to {100 * ci[1]:.2f}%'


def write_results():
    verify()
    s = json.loads((HERE / 'recorded/summary.json').read_text())
    rows = {(r['set'], r['row'], r['side']): r for r in s['rows']}
    for fold, n in [('hard', 120), ('heldout', 72)]:
        for row in NAMES:
            for side in ['shipped', 'audit']:
                assert rows[fold, row, side]['n'] == n
    costs = {row: sum(r['charged_usd'] for r in recordings() if r['row'] == row) for row in NAMES}
    date = datetime.datetime.now().astimezone().date().isoformat()
    table = ['| Row | Hard shipped / candidate / peer (120) | Held-out shipped / candidate / peer (72) | Highest score hard / held-out | Candidate vs peer verdict hard / held-out | Hard / held-out paired p | Row total USD |', '|---|---|---|---|---|---|---|']
    ci = ['| Set | Row | Shipped 95% Wilson | Candidate 95% Wilson | Default peer 95% Wilson |', '|---|---|---|---|---|']
    for row, name in NAMES.items():
        h, t = rows['hard', row, 'audit'], rows['heldout', row, 'audit']
        hb, tb = rows['hard', row, 'shipped'], rows['heldout', row, 'shipped']
        def leader(baseline, candidate):
            scores = {'shipped': baseline['ours'], 'candidate': candidate['ours'], 'peer': candidate['theirs']}
            top = [name for name, score in scores.items() if score == max(scores.values())]
            return 'all tied' if len(top) == 3 else ' + '.join(top)
        table.append(f'| {name} | {hb["ours"]} / {h["ours"]} / {h["theirs"]} | {tb["ours"]} / {t["ours"]} / {t["theirs"]} | {leader(hb, h)} / {leader(tb, t)} | {h["outcome"]} / {t["outcome"]} | {h["sign_test_p"]:.8g} / {t["sign_test_p"]:.8g} | {costs[row]:.6f} |')
        for fold, label in [('hard', 'Hard tuning'), ('heldout', 'Held-out')]:
            a, b = rows[fold, row, 'audit'], rows[fold, row, 'shipped']
            ci.append(f'| {label} | {name} | {percent_ci(b["ours_ci"])} | {percent_ci(a["ours_ci"])} | {percent_ci(a["theirs_ci"])} |')
    ablations = [r for r in s['ablations'] if r['side'] == 'audit']
    ablation_baselines = {r['set']: r for r in s['ablations'] if r['side'] == 'shipped'}
    assert {r['set'] for r in ablations} == {'hard', 'heldout'}
    ab = ['| Goal equal-evidence set | Shipped (95% Wilson) | Candidate (95% Wilson) | Unchanged peer with final state (95% Wilson) | Candidate vs peer outcome | Paired p |', '|---|---|---|---|---|---|']
    for a in ablations:
        b = ablation_baselines[a['set']]
        ab.append(f'| {a["set"]} | {b["ours"]}/{b["n"]}; {percent_ci(b["ours_ci"])} | {a["ours"]}/{a["n"]}; {percent_ci(a["ours_ci"])} | {a["theirs"]}/{a["n"]}; {percent_ci(a["theirs_ci"])} | {a["outcome"]} | {a["sign_test_p"]:.8g} |')
    information = ['| Default goal summary set | Distinct inputs | Input-only cached accuracy ceiling |', '|---|---|---|']
    for fold, prefix in [('hard', ''), ('heldout', 'heldout-')]:
        decisions = json.loads((HERE / f'recorded/{prefix}goal-peer.json').read_text())['rows']
        labels = defaultdict(Counter)
        for decision in decisions:
            labels[decision['request_sha256']][decision['truth']] += 1
        ceiling = sum(max(counts.values()) for counts in labels.values())
        information.append(f'| {fold} | {len(labels)} | {ceiling}/{len(decisions)} |')
    freeze = json.loads((HERE / 'candidate-freeze.json').read_text())
    archive = json.loads((HERE / 'archived/v1-manifest.json').read_text())
    shared = f"""Measured {date} through `claude -p --model haiku`, resolving to `{', '.join(s['model_names'])}`. Hard sets have 120 cases, balanced 60/60. Held-out sets have 72 cases, balanced 36/36, from new seed `20261113`. Labels are fixed before any held-out call. The candidate is **not yet the shipped default**. Its procedure is frozen before held-out scoring, and held-out outcomes do not tune it. The default goal comparison has unequal evidence; its separate equal-evidence ablation appears below.

{chr(10).join(table)}

{chr(10).join(ci)}

Unique recorded spend is {s['total_charged_usd']:.8f} USD across {s['total_unique_calls']} calls. Unknown costs: {s['unknown_cost_calls']}. Row costs include all unique calls for both sets, the shipped baseline, candidate, peer, equal-evidence ablations, and archived attempts. Both labels and every case remain in the denominator; inconclusive answers count as wrong.

The default peer prompts are unchanged at commit `8014282`. The candidate returns separate requirement checks and computes the verdict in code. The factuality audit addresses label/explanation contradictions, arithmetic and equivalent quantities. Complete inputs and recorded answers remain in `comparisons/promptfoo/hard/recorded/losses.md`. The candidate has not been ported to `packages/judges`.

Goal construction requires exact requested identifiers and field values; a `-Plus` identifier is a distinct plan. Goal success has an information difference: our judge reads the persisted final state, while the default trajectory summary omits arguments and results. The default summary collapses some state-distinct pairs into identical inputs. Giving the unchanged peer prompt the same final state produces this separate ablation:

{chr(10).join(ab)}

{chr(10).join(information)}

The ceiling sums the larger truth-label count for each identical input. One cached verdict per input cannot exceed it. It describes this constructed set and replay policy, not a universal limit on the peer.

The normal goal result measures this information difference as well as the procedure. The equal-evidence result is the closer comparison of reasoning. Cases share construction families, and identical goal summaries share cached answers. The case-level intervals and tests are nominal summaries of these synthetic sets; they do not prove superiority on arbitrary unseen tasks.

The privacy row measures phone/email model judgments on fictional ownership bindings and reserved values. It does not measure the shipped scanner, which deliberately exempts fictional domains and phone ranges. IBAN and national-register checks are not included. Relevance and RAG retain their limits. Closed QA, G-Eval, external-tool agent rubrics, other red-team plugins and prompt extraction are not hardened separately here.

Held-out privacy shows a candidate regression: it rejects two masked-local-part replies ending in the generic shared domain `contact.test`. The fixed construction labels permit that masking. The peer rejects one such reply, while the shipped judge accepts all of them. This candidate is not a replacement for the shipped privacy route. The held-out errors remain in the census; they do not tune the frozen procedure.

The old peer-only rubric benchmark is **archived and unpublished**. It has {archive['completed_case_decisions']} case decisions but {archive['unique_paid_calls']} distinct paid inputs. The owner approves regeneration with distinct offer identities, preserving case labels and family balance. Its {archive['billed_usd']:.8f} USD remains charged, but its scores are excluded from published outcomes. The reported rubric sets have 120 and 72 distinct payloads.

Candidate freeze: `{freeze['procedure_sha256']}`, recorded `{freeze['frozen']}`. Held-out file hashes and label fixation are recorded in `heldout-manifest.json`.
"""
    doc = DOC.read_text()
    assert '## Hard model-judge measurements' not in doc, 'Publication is intentionally one-shot.'
    def replace_row(capability, label, row):
        nonlocal doc
        h, t = rows['hard', row, 'audit'], rows['heldout', row, 'audit']
        caveat = ' Default trajectory summary omits final state; see the equal-evidence ablation.' if row == 'goal' else ''
        line = f'| {label} | {h["outcome"]} hard; {t["outcome"]} held-out | measured {date}; candidate not yet the shipped default | Hard candidate {h["ours"]}/120 vs promptfoo {h["theirs"]}/120; held-out {t["ours"]}/72 vs {t["theirs"]}/72.{caveat} | `python3 comparisons/promptfoo/hard/run.py {row} audit --set heldout --cap-usd 0`; `python3 comparisons/promptfoo/hard/score.py` |'
        doc, n = re.subn(r'^\| ' + re.escape(capability) + r' \|.*$', lambda _: line, doc, flags=re.M)
        assert n == 1
    replace_row('LLM rubric, model-graded closed QA, G-Eval, agent rubric', 'LLM rubric', 'rubric')
    replace_row('Factuality, model-graded factuality', 'Factuality, model-graded factuality', 'factuality')
    replace_row('Trajectory: goal success', 'Trajectory: goal success', 'goal')
    h, t = rows['hard', 'pii', 'audit'], rows['heldout', 'pii', 'audit']
    privacy_shipped = rows['heldout', 'pii', 'shipped']
    line = f'| Red-team personal data | {h["outcome"]} hard; {t["outcome"]} held-out | measured {date}; candidate not yet the shipped default | Semantic privacy candidate {h["ours"]}/120 vs {h["theirs"]}/120; held-out {t["ours"]}/72 vs {t["theirs"]}/72. Shipped held-out {privacy_shipped["ours"]}/72; retain that route. | `python3 comparisons/promptfoo/hard/run.py pii audit --set heldout --cap-usd 0` |\n'
    assert doc.count('| Red-team plugins |') == 1
    doc = doc.replace('| Red-team plugins |', line + '| Red-team plugins |')
    doc += '\n## Hard model-judge measurements\n\n' + shared + '\nFree reproduction: `python3 comparisons/promptfoo/hard/score.py`. Full coverage and exact prompt verification: `python3 comparisons/promptfoo/hard/verify.py`. Methods and individual replay commands: `comparisons/promptfoo/hard/README.md`.\n'
    assert '\u2014' not in doc and '\u2013' not in doc
    DOC.write_text(doc)
    easy = json.loads((HERE / 'easy-baselines.json').read_text())
    old = {'rubric': 'ahead, unmeasured', 'factuality': 'equal, 100/100 vs 100/100', 'pii': 'equal, 200/200 vs 199/200', 'goal': f'ahead, 100/100 vs {easy["goal-haiku"]["theirs"]}/100; old synthetic prompt'}
    rt = ['| Row | Easy outcome | Hard candidate vs peer | Held-out candidate vs peer | Hard / held-out outcome | Row total USD |', '|---|---|---|---|---|---|']
    for row, name in NAMES.items():
        h, t = rows['hard', row, 'audit'], rows['heldout', row, 'audit']
        rt.append(f'| {name} | {old[row]} | {h["ours"]}/120 vs {h["theirs"]}/120 | {t["ours"]}/72 vs {t["theirs"]}/72 | {h["outcome"]} / {t["outcome"]} | {costs[row]:.6f} |')
    report = '# Hard comparison report\n\n' + f'Branch `codex/hard-promptfoo`. Candidate: **not yet the shipped default**. Production files stay unchanged.\n\n' + '\n'.join(rt) + '\n\n' + shared
    report += """
## Proposed production changes

- Add an optional structured audit to `packages/judges`, with a strict requirement/status/evidence schema and a versioned prompt fingerprint. Do not overwrite the shipped default based only on tuning results.
- Preserve the production parser's final-object correction and strict validation. Peer explanations never override its recorded labels.
- Keep semantic privacy judgment separate from the local scanner and its fictional-data exemptions.
- Retain the shipped privacy route. The candidate loses on masked generic email domains in the held-out set; make that policy boundary explicit before a future independent evaluation.
- Prefer deterministic end-state checks when the required fields exist. Supply persisted evidence to any model-based goal judge.
- Require the criterion's complete atomic facts in a production ledger. An extractor can omit a requirement even when its JSON is valid.

## Reproduce and delivery

```sh
python3 comparisons/promptfoo/hard/score.py
python3 comparisons/promptfoo/hard/verify.py
python3 -m unittest discover -s comparisons/promptfoo/hard -p 'test_*.py' -v
pnpm exec vitest run --config comparisons/promptfoo/hard/vitest.config.ts --maxWorkers=2
pnpm exec tsc -p comparisons/promptfoo/hard/tsconfig.json --noEmit
```

Use `run.py <row> <side> --set heldout --cap-usd 0` for a free held-out replay. The original easy branch stores aggregate factuality/privacy summaries, not item-level recordings. Rubric has no numeric easy baseline.

The local repository-wide test run stops at the owner's instruction because a host-wide cleanup scan has a known fix owner. Targeted validation and PR CI are reported below.

PR: pending. Final validation and CI state follow after push.
"""
    assert '\u2014' not in report and '\u2013' not in report
    REPORT.write_text(report)
    print(DOC)
    print(REPORT)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.report:
        REPORT = args.report
    write_results()
