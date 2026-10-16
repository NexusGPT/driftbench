"""Offline checks: every peer renders its pinned prompt and reads its own verdict; the journal
replays answers, retries missing ones, pauses after three connection failures and stops at the cap.
No model call. Run: <venv>/bin/python -m pytest examples/all-peers-public/test_peers.py -q"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import peers  # noqa: E402
import transport  # noqa: E402
from transport import Journal, Stop, TransportFailure  # noqa: E402

PAIR = {'id': 'p1', 'question': 'What is 2+2?', 'a': 'It is 4.', 'b': 'It is 5.', 'label': 'A',
        'criterion': 'The response gives the correct answer to the question.'}
POINT = {'id': 'q1', 'question': 'What is 2+2?', 'response': 'The answer is 4.', 'label': True,
         'criterion': 'The final answer the response gives to the question is correct.'}


def fake(answers):
    seen = []

    def call(system, user):
        seen.append((system, user))
        return answers(system, user) if callable(answers) else answers.pop(0)
    return call, seen


def test_deepeval_arena_presents_both_orders_and_maps_names_back():
    def answer(system, user):
        if '"steps"' in user:
            return json.dumps({'steps': ['Check the final answer.', 'Prefer the correct one.']})
        # The winner is the fake name shown with the correct reply.
        block = user.split('Contestants:')[1]
        data = json.loads(block[:block.index('\nParameters:')].strip())
        name = [n for n, v in data['arena_test_cases'].items() if 'It is 4.' in v][0]
        return json.dumps({'winner': name, 'reason': 'correct'})
    call, seen = fake(answer)
    assert peers.deepeval_pair(PAIR, 'AB', call) == 'A'
    assert peers.deepeval_pair(PAIR, 'BA', call) == 'A'
    winners = [u for _, u in seen if '"winner"' in u and 'Contestants:' in u]
    first = [json.loads(u.split('Contestants:')[1].split('\nParameters:')[0])['arena_test_cases'] for u in winners]
    assert 'It is 4.' in list(first[0].values())[0] and 'It is 5.' in list(first[1].values())[0]
    assert all(s == peers.DEEPEVAL_SYSTEM for s, _ in seen)
    assert len(seen) == 4  # steps and winner per game, no reason rewrite


def test_deepeval_arena_bad_json_is_an_error():
    call, _ = fake(lambda s, u: json.dumps({'steps': ['x']}) if '"steps"' in u else 'no json here')
    with pytest.raises(ValueError):
        peers.deepeval_pair(PAIR, 'AB', call)


def test_deepeval_geval_threshold():
    call, seen = fake(lambda s, u: json.dumps({'steps': ['a']}) if '"steps"' in u else json.dumps({'reason': 'ok', 'score': 7}))
    out = peers.deepeval_point(POINT, call)
    assert out == {'pass': True, 'score': 0.7}
    call, _ = fake(lambda s, u: json.dumps({'steps': ['a']}) if '"steps"' in u else json.dumps({'reason': 'no', 'score': 4}))
    assert peers.deepeval_point(POINT, call)['pass'] is False


def test_inspect_uses_last_grade_and_template():
    call, seen = fake(['GRADE: I was tempting, but GRADE: C'])
    assert peers.inspect_point(POINT, call) == {'pass': True, 'grade': 'C'}
    user = seen[0][1]
    assert '[Criterion]: The final answer' in user and '[Submission]: The answer is 4.' in user
    call, _ = fake(['no verdict'])
    assert peers.inspect_point(POINT, call)['pass'] is None


def test_langfuse_answer_critic():
    call, seen = fake(['{"score": 1, "reasoning": "yes"}'])
    assert peers.langfuse_point(POINT, call) == {'pass': True, 'score': 1.0}
    system, user = seen[0]
    assert system.startswith('Return one JSON object with keys score and reasoning.')
    assert user.startswith("Evaluate the Input based on the criteria defined. Use only 'Yes' (1) and 'No' (0) as verdict.")
    assert 'Input: The answer is 4..' in user and 'The question: What is 2+2?' in user
    call, _ = fake(['{"score": 3}'])
    assert peers.langfuse_point(POINT, call)['pass'] is None


def test_langwatch_comparison_reconciles_two_orders():
    def answer(system, user):
        slot = [line[2] for line in user.splitlines() if line.startswith('- ') and 'It is 4.' in line][0]
        return json.dumps({'reasoning': 'Candidate x is right', 'winner': slot})
    call, seen = fake(answer)
    verdict, reads = peers.langwatch_pair(PAIR, 3, call)
    assert verdict == 'A' and len(seen) == 2
    assert seen[0][1].startswith('Pick the best of N candidate replies to the task')
    assert 'select_best_verdict' in seen[0][0]
    # Disagreement leaves no verdict.
    answers = [json.dumps({'reasoning': 'r', 'winner': 'A'}), json.dumps({'reasoning': 'r', 'winner': 'A'})]
    call, _ = fake(answers)
    verdict, _ = peers.langwatch_pair(PAIR, 3, call)
    assert verdict is None
    call, _ = fake(['nothing', json.dumps({'reasoning': 'r', 'winner': 'tie'})])
    assert peers.langwatch_pair(PAIR, 3, call)[0] is None


def test_langwatch_boolean():
    call, seen = fake(['{"reasoning": "fine", "passed": false}'])
    assert peers.langwatch_point(POINT, call) == {'pass': False}
    assert seen[0][1].startswith('# Input\nWhat is 2+2?\n\n# Output\nThe answer is 4.\n\n# Task\n')


def test_vendored_langwatch_prompt_is_the_default():
    source = (peers.VENDOR / 'langwatch' / 'select_best_compare.py').read_text()
    assert peers._lw_constant(source, 'DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN').startswith('Pick the best of N candidate replies')
    joined = ''.join(''.join(line.strip().strip('"') for line in source.splitlines()).split()).replace("'", '').replace('\\', '')
    assert ''.join(peers.LANGWATCH_SELECT_SYSTEM.split()).replace("'", '') in joined


def journal(tmp_path, results, cap=1.0):
    calls = []

    def run(system, user):
        calls.append(user)
        return results.pop(0)
    j = Journal(str(tmp_path / 'calls.jsonl'), cap, run_claude=run, probe=lambda log: log({'type': 'probe'}),
                sleep=lambda s: None)
    return j, calls


OK = {'answered': True, 'text': 'hi', 'measuredCostUsd': 0.001}
DOWN = {'answered': False, 'error': 'ECONNRESET', 'connection': True, 'measuredCostUsd': 0}


def test_answered_requests_replay_and_missing_retry(tmp_path):
    j, calls = journal(tmp_path, [DOWN, OK])
    with pytest.raises(TransportFailure):
        j.call('p', 'b', 's', 'u')
    assert j.call('p', 'b', 's', 'u') == 'hi'
    again = Journal(str(tmp_path / 'calls.jsonl'), 1.0, run_claude=lambda s, u: pytest.fail('resent'))
    assert again.call('p', 'b', 's', 'u') == 'hi'
    assert len(calls) == 2


def test_three_connection_failures_pause_then_probe(tmp_path):
    j, _ = journal(tmp_path, [DOWN, DOWN, DOWN, OK])
    for user in ('a', 'b', 'c'):
        with pytest.raises(TransportFailure):
            j.call('p', 'b', 's', user)
    assert j.call('p', 'b', 's', 'd') == 'hi'
    rows = [json.loads(x) for x in (tmp_path / 'calls.jsonl').read_text().splitlines()]
    kinds = [r['type'] for r in rows]
    assert kinds.index('pause') < kinds.index('probe') < max(i for i, k in enumerate(kinds) if k == 'start')


def test_cap_and_call_limit_stop(tmp_path):
    j, _ = journal(tmp_path, [OK], cap=0.1005)
    j.call('p', 'b', 's', 'one')
    with pytest.raises(Stop):
        j.call('p', 'b', 's', 'two')  # 0.001 known + 0.1 reserve > 0.1005
    (tmp_path / 'second').mkdir()
    j2, _ = journal(tmp_path / 'second', [OK, OK], cap=10)
    j2.call_limit = 1
    j2.call('p', 'b', 's', 'x1')
    with pytest.raises(Stop):
        j2.call('p', 'b', 's', 'x2')


def test_unfinished_start_keeps_its_reservation(tmp_path):
    path = tmp_path / 'calls.jsonl'
    path.write_text(json.dumps({'type': 'start', 'key': 'k', 'attempt': 1, 'attempt_key': 'k:1',
                                'reserveUsd': transport.CALL_CAP_USD}) + '\n')
    j = Journal(str(path), 1.0, run_claude=lambda s, u: OK)
    assert j.liability() == pytest.approx(transport.CALL_CAP_USD)


def test_pointwise_pair_higher_score_wins_and_ties():
    call, seen = fake(['GRADE: C', 'GRADE: I'])
    verdict, _ = peers.pointwise_pair(PAIR, peers.inspect_point, call)
    assert verdict == 'A' and '[Submission]: It is 4.' in seen[0][1] and '[Submission]: It is 5.' in seen[1][1]
    call, _ = fake(['{"score": 1, "reasoning": "y"}', '{"score": 1, "reasoning": "y"}'])
    assert peers.pointwise_pair(PAIR, peers.langfuse_point, call)[0] == 'tie'
    call, _ = fake(['GRADE: C', 'nothing'])
    assert peers.pointwise_pair(PAIR, peers.inspect_point, call)[0] is None
