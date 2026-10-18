"""Post hoc sensitivity analysis, written AFTER the results were read. It does not replace the pre-registered test.

Reading the misses after the run showed construction defects in the frozen sets (generate.py is left as frozen):
- D1, objective bug: in deepeval/completeness, the double-negation and long-one-wrong pairs keep the base user
  question while the replies answer a different one. The 9 double-negation "pass" cases really leave two questions
  open, and the 9 long-one-wrong "fail" cases really answer every question asked. Both pairs' labels are unsound.
- D2, ambiguous labels: in deepeval/task long-one-wrong, the user asks for "the references" and the "pass" reply gives
  one; in langfuse/correctness long-one-wrong, the "pass" reply adds "I have checked the plan record for you", which
  a strict reader can call an unsupported assertion.
This script recomputes the pooled paired tests with D1 removed, and with D1 and D2 removed.
Run from the repository root, after score.py: python3 comparisons/hard-peers/sensitivity.py
"""
import json
from pathlib import Path

import score

HERE = Path(__file__).resolve().parent
D1 = {('deepeval', 'completeness', 'double-negation'), ('deepeval', 'completeness', 'long-one-wrong')}
D2 = {('deepeval', 'task', 'long-one-wrong'), ('langfuse', 'correctness', 'long-one-wrong')}


def main():
    decoders = {'promptfoo': score.load(score.ROOT / 'promptfoo/hard/run.py', 'pf_run'),
                'langfuse': score.load(score.ROOT / 'langfuse/hard/run.py', 'lf_run')}
    calls = score.recordings()
    report = json.loads((HERE / 'report.json').read_text())
    out = {}
    for name, excluded in [('without_D1', D1), ('without_D1_and_D2', D1 | D2)]:
        out[name] = {}
        for competitor, rows in score.ROWS.items():
            out[name][competitor] = {}
            for ours in ('audit', 'default'):
                b = c = n = right_ours = right_theirs = 0
                for row in rows:
                    threshold = report['competitors'][competitor]['rows'][row].get('theirs_threshold')
                    mine = score.verdicts(competitor, row, ours, calls, decoders)
                    theirs = score.verdicts(competitor, row, 'theirs', calls, decoders, threshold)
                    for i, entry in theirs.items():
                        if (competitor, row, entry[1]) in excluded:
                            continue
                        n += 1
                        a, t = score.correct(mine[i]), score.correct(entry)
                        right_ours += a
                        right_theirs += t
                        b += a and not t
                        c += t and not a
                out[name][competitor][ours] = {'paired_items': n, 'ours_right': right_ours, 'theirs_right': right_theirs,
                                               'ours_only_right': b, 'theirs_only_right': c,
                                               'mcnemar_exact_p': score.mcnemar_exact(b, c)}
    (HERE / 'sensitivity.json').write_text(json.dumps(out, indent=2) + '\n')
    for name, data in out.items():
        for competitor, modes in data.items():
            for mode, v in modes.items():
                print(name, competitor, mode, v['ours_right'], v['theirs_right'], 'of', v['paired_items'],
                      v['ours_only_right'], v['theirs_only_right'], f"p={v['mcnemar_exact_p']:.3g}")


if __name__ == '__main__':
    main()
