"""Offline checks for the verify lead: the pool split, the driftbench verify judge's flow and parse, and the
paired statistics. No model call. Run: <venv>/bin/python -m pytest examples/verify-lead/test_verify_lead.py -q"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import contestants  # noqa: E402
import pool  # noqa: E402
import lead_stats as stats  # noqa: E402

ITEM = {'id': 'q1', 'question': 'What is 6*7?', 'response': 'Six times seven. The answer is 42.', 'label': True,
        'criterion': 'The final answer the response gives to the question is correct.'}


def scripted(extract, solves, verdicts):
    seen = []

    def call(system, user):
        seen.append((system, user))
        if system == contestants.EXTRACT_SYSTEM:
            return extract
        if system.startswith('Solve the problem yourself'):
            return solves.pop(0)
        return verdicts.pop(0)
    return call, seen


def test_no_final_answer_fails_without_solving():
    call, seen = scripted('NO FINAL ANSWER', [], [])
    assert contestants.driftbench_verify(ITEM, call)['pass'] is False
    assert len(seen) == 1


def test_solvers_never_see_the_submission():
    call, seen = scripted('42', ['6*7=42\nFinal answer: 42'] * 3, ['ok {"pass": true, "reason": "matches"}'])
    out = contestants.driftbench_verify(ITEM, call)
    assert out['pass'] is True and out['finals'] == ['42', '42', '42']
    solves = [user for system, user in seen if system.startswith('Solve the problem yourself')]
    assert len(solves) == 3 and all('42' not in u and 'Six times' not in u for u in solves)
    assert len({system for system, _ in seen if system.startswith('Solve')}) == 3  # three distinct methods


def test_compare_sees_answer_and_every_solution():
    call, seen = scripted('42', ['Final answer: 42', 'Final answer: 41', 'Final answer: 42'],
                          ['{"pass": false, "reason": "x"}'])
    assert contestants.driftbench_verify(ITEM, call)['pass'] is False
    system, user = seen[-1]
    assert 'Submitted final answer:\n42' in user and 'final answer: 41' in user and ITEM['criterion'] in system


def test_unparsed_compare_is_missing_not_a_pass():
    call, _ = scripted('42', ['Final answer: 42'] * 3, ['I think it is right.'])
    assert contestants.driftbench_verify(ITEM, call)['pass'] is None


def test_final_line_reads_the_last_marker():
    assert contestants.final_line('work\nFinal answer: 3\nmore\n**Final answer:** 5') == '5'
    assert contestants.final_line('no marker here\nlast line') == 'last line'


def test_promptfoo_reads_its_pass_field():
    out = contestants.promptfoo_point(ITEM, lambda s, u: '{"reason": "r", "pass": false, "score": 0}')
    assert out == {'pass': False}


def test_exact_p_and_holm():
    assert stats.exact_p(0, 0) == 1.0
    assert abs(stats.exact_p(10, 0) - 2 / 1024) < 1e-12
    assert stats.exact_p(5, 5) == 1.0
    assert stats.holm([0.01, 0.04, 0.03]) == [0.03, 0.06, 0.06]


def test_split_is_seeded_and_disjoint():
    hard = [{'question_id': f'q{i}', 'completion_id': f'c{i}', 'gold_correct': i % 3 == 0,
             'source': 'math_reasoning/x', 'question': 'Q', 'completion': 'R'} for i in range(200)]
    used = [{'id': 'q0_c0'}, {'id': 'q1_zz'}]  # q1 shares a question with a used item
    practice, confirm = pool.build(hard, used)
    ids = [x['id'] for x in practice + confirm]
    assert len(practice) == pool.PRACTICE and len(ids) == len(set(ids)) == 198
    assert 'q0_c0' not in ids and 'q1_c1' not in ids
    assert pool.build(hard, used) == (practice, confirm)


def test_committed_manifest_matches_its_sizes():
    manifest = json.loads((ROOT / 'data' / 'manifest.json').read_text())
    splits = manifest['splits']
    assert splits['practice']['n'] == 120 and splits['confirm']['n'] == 544
    assert not set(splits['practice']['ids']) & set(splits['confirm']['ids'])
