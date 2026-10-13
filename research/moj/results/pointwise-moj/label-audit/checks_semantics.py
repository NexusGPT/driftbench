"""Formal implication checks and explicit boundaries for semantic questions.

Consumes only questions and candidates in cases.json, never labels or references.
The truth table for item 76 is a complete proof over all Boolean valuations.
Partial countermodels for ambiguous questions are diagnostic, not corrections.
"""
import itertools
import json
from pathlib import Path

ROOT = Path(__file__).parent
INDICES = (2, 5, 7, 10, 13, 14, 16, 29, 36, 42, 46, 58, 76, 93)


def implies(a, b):
    return not a or b


def necessary_conditions():
    """S=savings, C=capital, D=development. Premises: D=>C and C=>S."""
    table = []
    for savings, capital, development in itertools.product((False, True), repeat=3):
        table.append({
            'savings': savings, 'capital': capital, 'development': development,
            'premises': implies(development, capital) and implies(capital, savings),
            'A': implies(capital, development),
            'B': implies(savings, capital),
            'C': implies(not capital, not savings),
            'D': implies(not savings, not development),
        })
    entailed = [o for o in 'ABCD' if all(r[o] for r in table if r['premises'])]
    assert entailed == ['D']
    counter = [r for r in table if r['premises'] and not r['C']]
    assert counter
    return {'truth_table': table, 'entailed_options': entailed,
            'countermodels_to_candidate_C': counter}


def conversion_countermodels():
    """Some P are not Q does not entail some Q are not P.

    Enumerate every pair of subsets of a two-element universe. Both predicates
    are required nonempty so the counterexample does not depend on empty classes.
    This disproves the candidate's claims about A and D, but does not settle the
    malformed question's intended selection rule or its final answer C.
    """
    domain = (0, 1)
    subsets = [set(i for i in domain if mask & (1 << i)) for mask in range(4)]
    witnesses = []
    for p, q in itertools.product(subsets, repeat=2):
        premise = bool(p - q)
        conclusion = bool(q - p)
        if p and q and premise and not conclusion:
            witnesses.append({'P': sorted(p), 'Q': sorted(q)})
    assert witnesses
    return {'universe': list(domain), 'subset_pairs_enumerated': 16,
            'countermodels': witnesses,
            'scope': 'A and D intermediate validity claims only; final choice not adjudicated'}


def qualification_countermodel():
    """Literal qualification and participation are separate predicates.

    An illness can prevent participating after qualification. The input does not
    explicitly say otherwise. This is only a reading diagnostic because the
    question also uses "volunteer" ambiguously for a qualification or a role.
    """
    member = {'Liu': True, 'Other': True}
    qualified = {'Liu': True, 'Other': True}
    participates = {'Liu': False, 'Other': True}
    premises = member['Liu'] and not participates['Liu'] and all(
        qualified[p] for p in member if member[p] and p != 'Liu')
    option_a = member['Liu'] and not qualified['Liu']
    assert premises and not option_a
    return {'member': member, 'qualified': qualified,
            'participates': participates, 'premises_hold': premises,
            'option_A_holds': option_a,
            'scope': 'Literal distinct-predicate reading only; no label correction'}


BOUNDARIES = {
    2: ('tapɨ', 'The task infers a historical sound-change system from examples. '
        'No formal rule class or exception policy is given; a mapping fitted to the '
        'observed words does not prove its value for an unseen word.'),
    5: ('B', 'Whether advice presupposes availability is a pragmatic assumption. '
        'Advice can prohibit unavailable things; the text supplies no formal '
        'semantics that makes one multiple-choice answer necessary.'),
    7: ('D', 'The source has both a named-entity substitution and an explicit ha-to-km '
        'unit substitution. Code can detect the latter tokens, but cannot select '
        'the intended single error category without a priority rule.'),
    10: ('D', 'Ranking which statement most challenges a causal claim requires '
         'causal and linguistic assumptions. The text gives no structural causal '
         'model, effect size, or formal ranking rule.'),
    13: ('D', 'Selecting the passage\'s most comprehensive characterization requires '
         'semantic interpretation. The options overlap and one is malformed; '
         'no formal predicates or selection rule determine a computed answer.'),
    14: ('A, C, D; A if one answer is expected', 'Qualification, ability to volunteer, '
         'and actually volunteering are not explicitly equated. A literal '
         'countermodel defeats A, but the ambiguity prevents a conclusive '
         'label correction for the candidate\'s final selection.'),
    16: ('B', 'Support for an empirical causal argument depends on the meanings of '
         'accurate, satisfaction, and subconscious. No quantitative experimental '
         'data or formal support metric is supplied.'),
    29: ('B', 'The definition and options require interpreting cultural extinction, '
         'physical destruction, and historical assertions. Treating those as '
         'Boolean inputs would hardcode the disputed semantic judgments.'),
    36: ('D', 'Processing quality is not mentioned in the premises, but a complete '
         'formalization also needs the unspecified meaning of other things being '
         'equal and an unbounded value domain. A finite enumeration cannot '
         'satisfy the premise that no object has highest value. No complete '
         'computed certificate is claimed.'),
    42: ('No Yes/No verdict; response degenerates into repeated share prices',
         'Typical-person intentionality is an empirical judgment, not a logical '
         'consequence. The response supplies no verdict, but a format failure is '
         'not a computed proof of the underlying Yes/No answer.'),
    46: ('alapt’k', 'The task infers orthography from examples without an explicit '
         'finite rule system. Context-sensitive spelling and exceptions are '
         'unspecified. An inferred transcription mapping is not a proof.'),
    58: ('C', 'The wording does not distinguish selecting an invalid inference '
         'from selecting an inference unlike the invalid example. A and D have '
         'computed countermodels despite the candidate calling them valid, '
         'but C may also be invalid. Wrong supporting reasoning alone does '
         'not prove the final selected option wrong.'),
    93: ('A, followed by B, C, G', 'No audience ratings or similarity metric is '
         'provided. Audience preference similarity cannot be derived by '
         'enumeration of the supplied movie titles.'),
}


def run():
    cases = json.loads((ROOT / 'cases.json').read_text())
    rows = []
    for n in INDICES:
        c = next(c for c in cases if c['index'] == n)
        assert set(c) <= {'index', 'id', 'half', 'question', 'candidate'}
        final = c['candidate'].split('</think>')[-1].strip()
        row = {'index': n, 'id': c['id'], 'status': 'inconclusive',
               'candidate_correct': None, 'expected': None,
               'candidate_final': None, 'evidence': {}, 'reason': None}
        if n == 76:
            assert 'a high savings rate is a necessary condition' in c['question']
            assert 'C and D can be inferred' in final
            evidence = necessary_conditions()
            row.update(status='proved', candidate_correct=False, expected='D only',
                       candidate_final='C and D', evidence=evidence,
                       reason='All eight Boolean valuations are enumerated. D is '
                       'entailed and C has a countermodel, so the final answer '
                       'includes a non-inference.')
        else:
            row['candidate_final'], row['reason'] = BOUNDARIES[n]
            if n == 14:
                row['evidence'] = qualification_countermodel()
            elif n == 58:
                row['evidence'] = conversion_countermodels()
            elif n == 7:
                assert '0,15 ha' in c['question'] and '0.15 km' in c['question']
                row['evidence'] = {'source_unit_token': '0,15 ha',
                                   'translation_unit_token': '0.15 km',
                                   'scope': 'Unit mismatch is explicit; category priority is unspecified'}
        rows.append(row)
    assert len(rows) == len(INDICES)
    return rows


if __name__ == '__main__':
    assert implies(False, False) and not implies(True, False)
    rows = run()
    (ROOT / 'audit_semantics.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({'items': len(rows),
                      'proved': sum(r['status'] == 'proved' for r in rows),
                      'inconclusive': sum(r['status'] == 'inconclusive' for r in rows)}))
