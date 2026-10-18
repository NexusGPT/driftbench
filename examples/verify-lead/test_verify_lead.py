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
             'source': 'math_reasoning/x', 'question': f'Q{i}', 'completion': 'R'} for i in range(200)]
    used = [{'id': 'q0_c0', 'instruction': 'Q0'}, {'id': 'q1_zz', 'instruction': 'Q1'}]  # q1 shares a question with a used item
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


# ---------------------------------------------------------------- the frozen judge (driftbench-v5)

def v5_call(quote, solves, matches, compare='{"pass": true, "reason": "r"}'):
    seen = []

    def call(system, user):
        seen.append((system, user))
        if system == contestants.QUOTE_SYSTEM:
            return quote
        if system.startswith('Solve the problem yourself'):
            return solves.pop(0)
        if system.startswith('You compare final answers'):
            return matches.pop(0)
        return compare
    return call, seen


NO_MARKER = {**ITEM, 'response': 'I sorted them: b, a, c.'}


def test_quote_must_be_in_the_response():
    call, _ = v5_call('b, a, c', [], [])
    assert contestants.quoted_answer(NO_MARKER, call) == ('b, a, c', 'quoted')
    call, _ = v5_call('a, b, c', [], [])  # a rewrite into the right answer is refused
    assert contestants.quoted_answer(NO_MARKER, call) == (NO_MARKER['response'][-1200:], 'tail')


def test_marked_answer_is_copied_without_a_model_call():
    call, seen = v5_call('unused', [], [])
    assert contestants.quoted_answer({**ITEM, 'response': 'so the answer is (E).\n'}, call) == ('(E).', 'literal')
    assert seen == []


def test_code_settles_options_and_numbers():
    assert contestants.plain_same('(C) Patrick', '(A) Karl') is False
    assert contestants.plain_same('7 animals', '6') is False
    assert contestants.plain_same('\\boxed{1,495}', '1495') is True
    assert contestants.plain_same('D. The economic system', 'D') is True
    assert contestants.plain_same('A function', 'B') is None


def test_v5_passes_only_when_every_solution_matches():
    v5 = contestants.CONTESTANTS['driftbench-v5']
    item = {**ITEM, 'response': 'The answer is 42'}
    call, _ = v5_call('', ['Final answer: 42'] * 3, [])
    assert v5(item, call)['why'] == 'every solution matches'
    # Two of three agree with the submission: not enough to accept, the full comparison decides.
    call, seen = v5_call('', ['Final answer: 42', 'Final answer: 42', 'Final answer: 41'], [], '{"pass": false}')
    out = v5(item, call)
    assert out['pass'] is False and out['why'] == 'no majority: full comparison'
    assert seen[-1][0].startswith('You decide whether the final answer')


def test_v5_rejects_when_a_majority_agrees_on_another_answer():
    v5 = contestants.CONTESTANTS['driftbench-v5']
    call, _ = v5_call('', ['Final answer: 41', 'Final answer: 41', 'Final answer: 42'], [])
    out = v5({**ITEM, 'response': 'The answer is 42'}, call)
    assert out['pass'] is False and out['why'] == 'a majority of solutions agree on a different answer'


def test_verdict_json_survives_braces_in_prose():
    assert contestants.read_pass('stack `{`, `{` open. {"pass": false, "reason": "x { y"}') is False


# ---------------------------------------------------------------- API transport (api_run.py)

class _Usage:
    def __init__(self, inp, out):
        self.input_tokens, self.output_tokens = inp, out
        self.cache_read_input_tokens = self.cache_creation_input_tokens = 0


class _Block:
    def __init__(self, kind, text=''):
        self.type, self.text = kind, text


class _Message:
    def __init__(self, blocks, stop, usage):
        self.content, self.stop_reason, self.usage, self.model = blocks, stop, usage, 'claude-haiku-5-5'


def _api_with(reply):
    import api_run

    class Messages:
        def create(self, **kwargs):
            if isinstance(reply, Exception):
                raise reply
            return reply

    class Client:
        messages = Messages()
    api_run._client = Client()
    return api_run


def test_api_cost_uses_the_short_prompt_rate_and_the_long_prompt_rate():
    import api_run
    assert abs(api_run.cost_usd(_Usage(1000, 200)) - (1000 * 0.10 + 200 * 0.50) / 1e6) < 1e-12
    assert abs(api_run.cost_usd(_Usage(200_000, 10)) - (200_000 * 0.50 + 10 * 2.50) / 1e6) < 1e-12


def test_api_answer_joins_text_blocks_and_skips_thinking():
    api = _api_with(_Message([_Block('thinking'), _Block('text', 'a'), _Block('text', 'b')], 'end_turn', _Usage(10, 5)))
    out = api.api_run_claude(None, 'S', 'U')
    assert out['answered'] is True and out['text'] == 'ab' and out['transport'] == 'api'


def test_api_reply_without_text_stays_missing():
    api = _api_with(_Message([_Block('thinking')], 'max_tokens', _Usage(10, 16000)))
    out = api.api_run_claude(None, 'S', 'U')
    assert out['answered'] is False and out['connection'] is False and out['measuredCostUsd'] > 0


def test_api_rejected_request_costs_nothing_and_is_not_a_connection_failure():
    import anthropic
    import httpx2
    request = httpx2.Request('POST', 'https://api.anthropic.com/v1/messages')
    error = anthropic.BadRequestError('bad', response=httpx2.Response(400, request=request), body=None)
    out = _api_with(error).api_run_claude(None, 'S', 'U')
    assert out['answered'] is False and out['connection'] is False and out['measuredCostUsd'] == 0.0


# ---------------------------------------------------------------- question leakage and committed reanalysis

def test_split_keeps_normalized_question_groups_together(monkeypatch):
    monkeypatch.setattr(pool, 'PRACTICE', 1)
    hard = [{'question_id': f'q{i}', 'completion_id': 'c', 'gold_correct': bool(i % 2),
             'source': 'math/x', 'question': q, 'completion': 'R'}
            for i, q in enumerate(['Cafe\u0301  question?', '  Caf\u00e9\nquestion? ', 'Other question?'])]
    # The old item-ID split must cut a duplicate-text group, regardless of hash order.
    duplicate_first = min(hard[:2], key=lambda r: pool.rank(f"{r['question_id']}_c"))
    hard = [duplicate_first, next(r for r in hard[:2] if r is not duplicate_first)]
    practice, confirm = pool.build(hard, [])
    assert len(practice) == 2 and confirm == []  # whole group may exceed the target
    assert not {pool.question_key(x['question']) for x in practice} & {
        pool.question_key(x['question']) for x in confirm}


def test_split_excludes_used_text_even_under_another_id():
    hard = [{'question_id': 'new', 'completion_id': 'c', 'gold_correct': True,
             'source': 'math/x', 'question': '  Same\n question ', 'completion': 'R'}]
    assert pool.build(hard, [{'id': 'old_c', 'instruction': 'Same question'}]) == ([], [])
    assert pool.question_key('A') != pool.question_key('a')  # case can change math semantics


def test_committed_reanalysis_is_exact_and_overlap_free():
    import reanalyze
    index = json.loads((ROOT / 'data/confirmation-index.json').read_text())
    outputs = reanalyze.artifacts(index)
    for name, value in outputs.items():
        assert json.loads((ROOT / name).read_text()) == value
    excluded = outputs['confirmation-exclusions.json']
    assert excluded['frozenN'] == 544 and excluded['retainedN'] == 536
    assert len(excluded['excludedIds']) == 8
    assert sum(len(r['reusedPracticeCallKeys']) for r in excluded['items']) == 32
    seen = {i['questionSha256'] for s in ('practice', 'dev') for i in index['splits'][s]}
    retained = [i for i in index['splits']['confirm'] if i['id'] not in excluded['excludedIds']]
    assert not seen & {i['questionSha256'] for i in retained}
    result = outputs['results-confirm-clean.json']
    assert set(result['primary']) == set(reanalyze.CONTESTANTS)
    for group, n in [('primary', 536), ('sensitivity', 544)]:
        for table in result[group].values():
            assert table['own']['n'] == n and len(table['peers']) == 5


def test_overlap_selection_does_not_depend_on_labels_or_verdicts():
    import copy
    import reanalyze
    index = json.loads((ROOT / 'data/confirmation-index.json').read_text())
    changed = copy.deepcopy(index)
    for split in changed['splits'].values():
        for item in split:
            item['label'] = not item['label']
    assert reanalyze.exclusions(changed) == reanalyze.exclusions(index)
