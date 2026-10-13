"""Label-blind exact certificates for assigned practice Verify cases.

Uses only cases.json questions and candidate answers. No reference answers,
labels, model calls or floating point sampling are used. Case-specific input
transcriptions are explicit; assertions bind final-answer extractions to text.
The elementary identities/theorems used by each certificate are stated below.
Run this file to regenerate audit_valid_math_b.json.
"""
from fractions import Fraction as F
from itertools import combinations
from pathlib import Path
import json
import hashlib

HERE = Path(__file__).resolve().parent
INDICES = [75, 77, 78, 79, 80, 82, 83, 85, 86, 88, 89, 92, 94]

EXPECTED_HASHES = {75: ('ab88a569680ea6ffff2adb606ce3fa1d254170bb8dc08e6de08e240332b5ccd1',
      'd0e0bf6f4ee248c11f9f534ee942427b79d3d984d3db6978bf520c93f8f76694'),
 77: ('75c5444c00fa50b94179890a0965b9f05ac87049522da4d56148131357c30189',
      'e2e30bfdaa00c59c5e6295e74321b78def12c6734f429d017c50809476ee790b'),
 78: ('84a31b967a88cfc4773ed9d2fd5d7dac5c79678aab9fb8ff922b190f897ef569',
      '84854293095793f4591bb17689b0af9de87dfafdc747e932486e2f748bdd1f21'),
 79: ('2efc0e89190d20ce442442011505d9995312718580b90dca9a23f6f02c410062',
      '5d9b139769634588b6afbcad32e1dd45dba22cae1e5fd0154c4215bab65051cb'),
 80: ('c297832d2306e7b1ac576c8662c436f45f455e5da893e8df4ef36c1d58c53cd5',
      '533a81bf3c10323f3a1fa083149104ea8329fc6bd5beb7c5d63556b5f5f5093d'),
 82: ('970aa4f77baa5b2bc6bbb17a4399358ff79c3eb57a3658c7019add4365e10feb',
      '55329a154b0396c0b6f9d7e90d621e5e42aba1e8732c010510dc8a83590ff325'),
 83: ('ea3d62f278a16a6bd2c8fa4bf13a6b778021fb7d0d9d8a8bf9dfaa28a91fe769',
      '551e185b7ef34bada7621d00e6825955218d4ef5c124479d85c07f32d1709517'),
 85: ('e5391454ee1ae2dba04ebe27493b09e17d0681305dea39eab9ef7da22434c818',
      'cd50183191ef22052310c83a99aa970cb195caa5d6258f8f462e074e40895f7c'),
 86: ('552ac3db1e4f4ae7cd59dbce34a8df4992251a6686bba755995f71e899e8083a',
      'bd77d91fca46ef9b7e55ad479d0039705615c4c8ed3b1333345bdb5181e40702'),
 88: ('bb363636b157e8a84ef8608c7bbc7f4f9195b349e7fb0906eb2c3b94c886a3f1',
      '6b4619cb07c32111d8dfad073a245ef39426a153d82f9f62861de7105cc1d3f6'),
 89: ('69fee374d4d01ab684ce823ee8e7af1fa0102ca07921771ba74d03d2b4ae89d4',
      '8d6aced0566300ffd46e8cbeebc4d5788d79131c97fe0d5591dc91afea9eab5b'),
 92: ('6756a2e74b25f765ebfd60f72381373865d3c8f04d4c4fc9bcb3954ea2fbef1e',
      '833e0ac2f5eb883e73c9b9a9ab42a9476220b3701ffe68b0a9a29dd1a60f4ba4'),
 94: ('a1f99fabbd70ec836f27b2dccac5e7e9adb290193dd7d2685cad5d109b0d916e',
      '5d624cd1b3ad22c33d7aafde590744dbe9d00a4dcf8ee57a4358e700c637f957')}


def mul(a, b):
    out = [F(0)] * (len(a) + len(b) - 1)
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            out[i+j] += x*y
    return out


def add(a, b):
    out = [F(0)] * max(len(a), len(b))
    for i, x in enumerate(a):
        out[i] += x
    for i, x in enumerate(b):
        out[i] += x
    return out


def matchings(items):
    """Each perfect matching exactly once: pair smallest remaining first."""
    if not items:
        yield ()
        return
    first = items[0]
    for j in range(1, len(items)):
        for tail in matchings(items[1:j] + items[j+1:]):
            yield ((first, items[j]),) + tail


def run():
    cases = {c['index']: c for c in json.loads((HERE/'cases.json').read_text())}
    rows = []
    for i, expected_hashes in EXPECTED_HASHES.items():
        actual = tuple(hashlib.sha256(cases[i][k].encode()).hexdigest() for k in ("question", "candidate"))
        assert actual == expected_hashes, f"Case {i} source changed; re-audit required"

    def result(i, correct, expected, final, evidence, reason):
        rows.append(dict(index=i, id=cases[i]['id'],
                         status='proved' if correct is not None else 'inconclusive',
                         candidate_correct=correct, expected=expected,
                         candidate_final=final, evidence=evidence, reason=reason,
                         question_sha256=EXPECTED_HASHES[i][0], candidate_sha256=EXPECTED_HASHES[i][1]))

    # IVT gives three distinct real roots. A nonzero cubic has at most three.
    p = lambda x: x**3+x**2-2*x-1
    intervals = [(-2,-1),(-1,0),(0,1),(1,2)]
    occupied = [j for j,(a,b) in enumerate(intervals) if p(a)*p(b)<0]
    assert len(occupied) == 3
    empty = [j for j in range(4) if j not in occupied]
    assert len(empty) == 1
    expected = intervals[empty[0]]
    assert r'\boxed{(-2, -1)}' in cases[75]['candidate']
    result(75, expected == (-2,-1), list(expected), '(-2, -1)',
           {'endpoint_values': {str(x): p(x) for x in range(-2,3)},
            'root_intervals_by_IVT': [list(intervals[j]) for j in occupied],
            'degree': 3}, 'Three disjoint sign-changing intervals exhaust the cubic roots; the final interval chosen has a root.')

    pairs = list(combinations(range(2,8),2))
    expectation = F(sum(sum(p) for p in pairs), len(pairs))
    assert r'\boxed{9}' in cases[77]['candidate']
    result(77, expectation == 9, str(expectation), '9',
           {'pairs': pairs, 'sum_of_pair_sums': sum(map(sum,pairs)), 'count':len(pairs)},
           'Exact exhaustive average over every equally likely unordered draw.')

    n = F(56,42-38)
    # -4f+2q=-20 and f+2q=0: subtract to get -5f=-20.
    f = F(-20,-5)
    q = -f/2
    assert 38*n+56 == 42*n and -4*f+2*q+20 == 0 and f+2*q == 0
    b = (f/n)/F(3,21)
    order = [name for value,name in sorted([(F(5),'5'),(b,'b'),(F(1),'1')],reverse=True)]
    assert r'\boxed{\sqrt{10}}' in cases[78]['candidate']
    result(78, False, ', '.join(order), 'sqrt(10)',
           {'n':str(n),'f':str(f),'q':str(q),'b':str(b),'b_squared':str(b*b),'candidate_squared':'10'},
           'The unique linear-system solution gives b=2 and order 5,b,1. The candidate invents b=5/f and does not return the requested ordering.')

    # Declarative source does not state the task or supply answer choices.
    result(79, None, 'Translation right 1 and up 2, if that was the intended task',
           '2^{x-1} + 2',
           {'question':cases[79]['question'],'translation_counterexample_at_x_1':{'right_only':1,'target':3}},
           'Question ends with a declarative sentence. The final expression repeats it; omitted translation data make final-answer acceptance ambiguous. No label correction.')

    # Witness f(z)=1/(1-z^2). Factor verification is exact; a rational
    # function is holomorphic away from denominator zeros and diverges in
    # modulus at a simple pole with nonzero numerator.
    denominator = mul([1,-1],[1,1])
    roots = [-1,1]
    assert denominator == [1,0,-1]
    assert all(sum(c*r**k for k,c in enumerate(denominator)) == 0 for r in roots)
    assert all(r*r == 1 and -2*r != 0 for r in roots)
    assert r'\boxed{yes}' in cases[80]['candidate']
    result(80, True, 'yes', 'yes',
           {'witness':'1/(1-z^2)','denominator_coefficients':list(map(str,denominator)),
            'all_denominator_roots':roots,'root_modulus_squared':[r*r for r in roots],
            'derivative_at_roots':[-2*r for r in roots],'numerator_at_roots':[1,1]},
           'Factorization exhausts denominator roots; both lie on the boundary and are simple poles. Final yes is correct, although the candidate reasoning contains false statements.')

    # Polynomial division in c=cos(x), followed by t=tan(x/2):
    # base integral = integral_R 2/(t^2+9) dt = 2*pi/3.
    quotient = [F(-5,8),F(1,2)]
    remainder = F(17,8)
    identity = add(mul(quotient,[5,4]),[remainder])
    assert identity == [-1,0,2]
    # 5+4*cos(x) = (9+t^2)/(1+t^2); dx=2dt/(1+t^2).
    transformed_denom = add([5,0,5],[4,0,-4])
    assert transformed_denom == [9,0,1]
    pi_coefficient = 2*quotient[0]+remainder*F(2,3)
    assert r'\boxed{0}' in cases[82]['candidate']
    result(82, pi_coefficient == 0, str(pi_coefficient)+' * pi', '0',
           {'division_quotient':list(map(str,quotient)), 'division_remainder':str(remainder),
            'verified_numerator':list(map(str,identity)),
            'base_integral_certificate':'t=tan(x/2): integral over R of 2/(t^2+9); antiderivative (2/3) arctan(t/3), limits +/-pi/2',
            'result_pi_coefficient':str(pi_coefficient)},
           'Exact polynomial identity and elementary arctangent integral give a nonzero result; no quadrature or sampling.')

    result(83, None, None, 'E',
           {'Hector_distance':str(F(27,4)),'Jane_distance':str(F(81,4))},
           'The question omits the diagram and positions of A through E. Distances are determined, but closest named point is not.')

    total = favorable = 0
    by_partner = {}
    for matching in matchings(tuple('ABCDEFGHIJKL')):
        total += 1
        last = max(matching)
        if 'G' in last:
            favorable += 1
            other = next(x for x in last if x!='G')
            by_partner[other] = by_partner.get(other,0)+1
    probability = F(favorable,total)
    answer = probability.numerator+probability.denominator
    assert total == 10395 and r'\boxed{701}' in cases[85]['candidate']
    result(85, answer == 701, answer, '701',
           {'all_matchings':total,'favorable':favorable,'favorable_by_G_partner':by_partner,'probability':str(probability)},
           'Exhaustive enumeration includes G paired with a later letter, a case the candidate excludes.')

    # Set a=x+sqrt(x^2+1)>0. Its inverse is sqrt(x^2+1)-x.
    # Thus x=(a-1/a)/2. Product constraint gives b=1/a, so
    # y=(1/a-a)/2. Laurent coefficient cancellation proves x+y=0.
    x_laurent = {1:F(1,2),-1:F(-1,2)}
    y_laurent = {1:F(-1,2),-1:F(1,2)}
    combined = {k:x_laurent[k]+y_laurent[k] for k in x_laurent}
    assert all(v == 0 for v in combined.values())
    assert 'precise calculation or expression' in cases[86]['candidate']
    result(86, None, '0', 'No expression supplied',
           {'inverse_identity':'(sqrt(x^2+1)+x)*(sqrt(x^2+1)-x)=1',
            'x_laurent':{str(k):str(v) for k,v in x_laurent.items()},
            'y_laurent':{str(k):str(v) for k,v in y_laurent.items()},
            'sum_coefficients':{str(k):str(v) for k,v in combined.items()}},
           'Exact inverse substitution forces x+y=0. The candidate never states a result to contradict. Output-completeness grading is outside this strict label audit.')
    rows[-1]['provisional_candidate_correct'] = False

    # Sum all three equations: 9*(x^2+y^2+z^2)-12x-6y-12z+9=0.
    # Complete squares. All coefficients positive, forcing one solution.
    centers = [F(12,18),F(6,18),F(12,18)]
    square_coefficients = [F(9)]*3
    assert [-2*a*c for a,c in zip(square_coefficients,centers)] == [-12,-6,-12]
    assert sum(a*c*c for a,c in zip(square_coefficients,centers)) == 9
    x,y,z = centers
    assert 12*x-9*y*y == 7 and 6*y-9*z*z == -2 and 12*z-9*x*x == 4
    target = 6*x*x+9*y*y+12*z*z
    assert 'cannot compute the exact value' in cases[88]['candidate']
    result(88, None, str(target), 'Cannot compute the exact value',
           {'sum_of_equations':'9*((x-2/3)^2+(y-1/3)^2+(z-2/3)^2)=0',
            'unique_solution':list(map(str,centers)), 'target':str(target)},
           'Exact sum-of-squares certificate proves a unique solution and exact value. The candidate declines to state a result. Output-completeness grading is outside this strict label audit.')
    rows[-1]['provisional_candidate_correct'] = False

    # Every variable is >=0. f(t)-t=-t*(t-1)^2/(1+t^2)<=0.
    # Cyclic inequalities force equality and thus each t is 0 or 1.
    difference = add([0,0,2],[-a for a in mul([0,1],[1,0,1])])
    factored = [-v for v in mul([0,1],mul([-1,1],[-1,1]))]
    assert difference == factored
    solutions = [(0,0,0),(1,1,1)]
    fn = lambda v:F(2*v*v,1+v*v)
    assert all(fn(a)==b and fn(b)==c and fn(c)==a for a,b,c in solutions)
    assert r'\boxed{1}' in cases[89]['candidate']
    result(89, False, solutions, '1',
           {'verified_difference_numerator':list(map(str,difference)),
            'factorization':'-t*(t-1)^2','missing_solution':[0,0,0]},
           'The final answer omits the zero solution. Nonnegative cyclic inequalities also certify that only the two displayed triples solve the system.')

    # Missing angle 0<a<180 gives 1070<180(n-2)<1250.
    lower, upper = F(1070,180)+2,F(1250,180)+2
    candidates = [n for n in range(lower.numerator//lower.denominator,
                                  upper.numerator//upper.denominator+2) if lower<n<upper]
    assert r'\boxed{8}' in cases[92]['candidate']
    result(92, candidates == [8], candidates, '8',
           {'strict_lower_n':str(lower),'strict_upper_n':str(upper),
            'admissible_n':candidates,'missing_angles':[(n,180*(n-2)-1070) for n in candidates]},
           'Convexity bounds the omitted angle strictly between 0 and 180 degrees. Exact integer enumeration leaves eight sides, despite errors in the reasoning.')

    # Candidate r_n=1/n omits rational -1: 1/n=-1 forces n=-1.
    witness = F(-1)
    forced_index = 1/witness
    valid_index = forced_index.denominator == 1 and forced_index >= 1
    assert r'\boxed{r_n = \frac{1}{n}}' in cases[94]['candidate']
    result(94, valid_index, 'An enumeration must include every rational, including -1',
           'r_n=1/n',
           {'omitted_rational':str(witness),'only_possible_index':str(forced_index),'index_in_positive_integers':valid_index},
           'An exact omitted-rational witness disproves the submitted construction, regardless of its interval union.')

    assert sorted(r['index'] for r in rows) == INDICES
    (HERE/'audit_valid_math_b.json').write_text(json.dumps(rows,indent=2)+'\n')
    print(json.dumps({'cases':len(rows),'proved':sum(r['status']=='proved' for r in rows),
                      'proved_correct':[r['index'] for r in rows if r['candidate_correct'] is True],
                      'proved_wrong':[r['index'] for r in rows if r['candidate_correct'] is False],
                      'inconclusive':[r['index'] for r in rows if r['candidate_correct'] is None]}))


if __name__ == '__main__':
    run()
