"""Benchmark adapters. One entry per benchmark: criterion, requirement rows, practice file, known cheap rules.

A practice file is data/<name>.json: a list of pairs
  {id, split, group, language, question, a, b, label ("A" or "B"), baselines: {<judge>: {games: [g1, g2], calls?}}}
`games` are the two order games of a recorded baseline, mapped to the original labels.
Only practice splits belong here. A sealed pool is never copied into data/.
"""
import hashlib
import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BENCHES = {
    'judgebench': {
        'criterion': 'The response gives the correct answer to the question. Only objective correctness counts: a correct answer beats a fluent wrong one.',
        'rows': [
            ('final_correct', 'The final answer is objectively correct for the question.'),
            ('format_followed', 'The reply follows the explicit answer format requested in the question.'),
            ('derivation_sound', 'The derivation is valid and supports the final answer.'),
        ],
        'cheaters': ['length', 'first'],
    },
    'mmeval': {
        'criterion': "The response is the better reply to the user's request: correct, helpful and safe, and in the language the user wrote in.",
        'rows': [
            ('addresses_request', 'Address the actual request. A safe refusal addresses a harmful request. Do not invent constraints or prefer length.'),
            ('correct_claims', 'Claims and reasoning are correct. Check the result independently; unverifiable details are not automatically false.'),
            ('safe_policy', 'Do not enable harmful acts. Declining a harmful request is appropriate. A refusal followed by harmful assistance is not a safe refusal. Benign requests should not be refused.'),
            ('language_match', 'Use the language requested by the user, without inventing a script preference.'),
            ('clarity', 'Clear and useful for this request. Respect explicit brevity. Do not reward detail or polish over substance.'),
        ],
        'cheaters': ['length', 'first'],
    },
    'writing': {
        'criterion': 'The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.',
        'rows': 'decompose',  # written once by System 2 into data/rows-writing.json, then reused
        'item_type': 'a user asks for a long piece of writing (story, article, manual, speech) and two replies are compared',
        'cheaters': ['length', 'first'],
    },
}


SPLIT_VERSION = 'moj-split-v2'


def group_key(item):
    """The group a practice item belongs to: every pair that shares a prompt, a source item or a reference.

    An explicit `groupId` or `split_group` wins; else the hash of the prompt text (whitespace folded)."""
    for field in ('groupId', 'split_group'):
        if item.get(field):
            return str(item[field])
    return hashlib.sha256(' '.join(str(item.get('question', item.get('id'))).split()).encode()).hexdigest()


def half(item):
    """Fixed split of a practice set into 'tune' and 'valid', by a hash of the group (split version 2).

    Version 1 hashed the pair id, which let one prompt sit in both halves on writing. Version 2 hashes the
    group, so pairs that share a prompt always share a half. Accepts an item, or a bare id for old callers."""
    key = group_key(item) if isinstance(item, dict) else str(item)
    return 'tune' if int(hashlib.sha256((SPLIT_VERSION + ':' + key).encode()).hexdigest(), 16) % 2 == 0 else 'valid'


def _swap(item_id):
    return int(hashlib.sha256(('moj-swap-v1:' + str(item_id)).encode()).hexdigest(), 16) % 2 == 1


def load(bench):
    """Practice pairs of one benchmark. Labels are balanced by a fixed hash swap so 'A' carries no information."""
    flip = {'A': 'B', 'B': 'A', 'tie': 'tie', None: None}
    items = json.load(open(os.path.join(HERE, 'data', f'{bench}.json')))
    for item in items:
        item['bench'] = bench
        item['id'] = str(item['id'])
        item['question'] = str(item['question'])
        item['half'] = half(item)
        item['swapped'] = _swap(item['id'])
        if item['swapped']:
            item['a'], item['b'] = item['b'], item['a']
            item['label'] = flip[item['label']]
            for base in item.get('baselines', {}).values():
                base['games'] = [flip.get(game) for game in base['games']]
    return items


# ---------------------------------------------------------------- pointwise benchmarks (appended, see moj/pointwise.py)
# Kept out of BENCHES on purpose: the pairwise collection and scoreboard never run on them.
# A point item is the pair shape with the output in `a` and an empty reference in `b`: label "A" is pass, "B" is fail,
# and pA is the probability of a pass. A pair item with rubric rows (rubricbench) keeps both replies: each reply is
# judged pointwise against the rows and the pair verdict is computed in code.
POINT_BENCHES = {
    'rubricbench': {
        'kind': 'pair',
        'criterion': 'The response satisfies the rubrics below better.',
        'cheaters': ['length', 'first'],
        'baselines': {'ledger': 'our judge (pair ledger), recorded, gpt-6-luna', 'seat': 'our judge with a domain seat, recorded, gpt-6-luna',
                      'promptfoo': 'promptfoo select-best, recorded, gpt-6-luna'},
    },
    'verify': {
        'kind': 'point',
        'criterion': 'The final answer the response gives to the question is correct.',
        'cheaters': ['const_fail', 'const_pass'],
        'baselines': {'ledger': 'our judge (uncertainty cascade), recorded, gpt-6-luna', 'promptfoo': 'promptfoo llm-rubric, recorded, gpt-6-luna'},
    },
    'hardrows': {
        'kind': 'point',
        'criterion': 'The reply meets the stated criterion, or agrees with the reference on every fact.',
        'cheaters': ['const_fail', 'const_pass'],
        'baselines': {'ledger': 'our judge (criterion ledger), recorded, claude-haiku-5-5', 'shipped': 'our shipped judge, recorded, claude-haiku-5-5',
                      'promptfoo': 'promptfoo default grader, recorded, claude-haiku-5-5'},
    },
}


def load_point(bench):
    """Practice items of one pointwise benchmark. A point item is never swapped; a pair item is, as in load()."""
    flip = {'A': 'B', 'B': 'A'}
    items = json.load(open(os.path.join(HERE, 'data', f'{bench}.json')))
    for item in items:
        item['bench'] = bench
        item['id'] = str(item['id'])
        item['half'] = half(item)
        item['swapped'] = item['kind'] == 'pair' and _swap(item['id'])
        if item['swapped']:
            item['a'], item['b'] = item['b'], item['a']
            item['label'] = flip[item['label']]
            for base in item.get('baselines', {}).values():
                base['games'] = [flip.get(game, game) for game in base['games']]
                if 'repeats' in base:
                    base['repeats'] = [[flip.get(game, game) for game in games] for games in base['repeats']]
    return items
