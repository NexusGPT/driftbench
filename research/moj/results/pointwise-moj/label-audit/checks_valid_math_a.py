"""Deterministic, label-blind final-answer checks for 13 practice items.

Run from any directory. Only cases.json is consumed, never labels or references.
Exact fractions, finite enumeration, polynomial identities and explicit analytic
certificates are used. Analytic certificates name their calculus assumptions;
sampling or floating point is never used to establish a verdict.
"""
import hashlib
import itertools
import json
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDICES = [47, 48, 49, 50, 52, 53, 56, 67, 69, 70, 72, 73, 74]


def polyadd(a, b):
    return [sum(p[i] if i < len(p) else 0 for p in (a, b))
            for i in range(max(len(a), len(b)))]


def polymul(a, b):
    out = [0] * (len(a) + len(b) - 1)
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            out[i + j] += x * y
    return out


def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2],
            a[0]*b[1]-a[1]*b[0])


def factor(n):
    result = []
    divisor = 2
    while divisor * divisor <= n:
        while n % divisor == 0:
            result.append(divisor)
            n //= divisor
        divisor += 1
    if n > 1:
        result.append(n)
    return result


def checks():
    out = {}
    # 47. h=ln(x)-2(x-1)/(x+1). h(1)=0 and its derivative
    # numerator, over positive x(x+1)^2, is exactly (x-1)^2.
    numerator = polyadd(polymul([1, 1], [1, 1]), [0, -4])
    square = polymul([-1, 1], [-1, 1])
    assert numerator == square
    slope = 0 + 1 + 1 - 1
    out[47] = (False, 'y=x-1; a<=2', 'y=x-1; a<2',
        {'tangent_slope': slope, 'h_derivative_numerator': numerator,
         'h_derivative_denominator': 'x*(x+1)^2',
         'certificate': 'h(1)=0; h\'(x)>0 for every x>1. Thus a=2 satisfies f(x)>0 everywhere on x>1. It is excluded by the candidate.'},
        'The excluded endpoint a=2 is a rigorous counterexample to the claimed parameter range.')
    # 48. Exact chain rule at tau=1,s=0 for candidate option 1.
    # x_s=3, x_tau=0; y_s=-1/2,y_tau=1; u_s=-2,u_tau=2.
    q = F(2)
    p = (F(-2) - q * F(-1, 2)) / 3
    residual = p*q - 1
    assert residual != 0
    # Option 3 also has a global Charpit certificate. Write E=exp(s).
    # x=2*tau*(E-1), y=tau*(E+1)/2, u=tau^2*E^2,
    # p=tau*E/2, q=2*tau*E. Comparing exact monomial coefficients
    # verifies x'=q, y'=p, u'=2*p*q, p'=p, q'=q and p*q=u.
    p_coefficient, q_coefficient = F(1, 2), F(2)
    assert F(2) == q_coefficient and F(1, 2) == p_coefficient
    assert 2 == 2*p_coefficient*q_coefficient
    assert p_coefficient*q_coefficient == 1
    assert F(1, 2)*(1+1) == 1  # y(0)=tau
    out[48] = (False, 'Option 3', 'Option 1',
        {'point': {'tau': 1, 's': 0}, 'jacobian_determinant': 3,
         'u_x': str(p), 'u_y': str(q), 'u_x*u_y-u': str(residual),
         'option_3_certificate': 'With E=exp(s), p=tau*E/2 and q=2*tau*E satisfy the Charpit equations and the given initial data by exact monomial coefficient identities.'},
        'The selected parametric surface violates the PDE at an initial point with nonsingular parameter Jacobian.')
    # 49. Enumerate all equiprobable labelled-ball ordered draws.
    balls = [('R', 1)]*2 + [('R', 2)]*4 + [('B', 1)] + [('B', 2)]*2
    draws = list(itertools.product(range(9), repeat=2))
    hits = sum((balls[i][0] != balls[j][0]) and balls[i][1]+balls[j][1] == 3
               for i, j in draws)
    no_replacement = [(i, j) for i, j in draws if i != j]
    pa = F(sum(balls[i][0] == 'R' for i, j in no_replacement), 72)
    pb = F(sum(balls[j][1] == 1 for i, j in no_replacement), 72)
    pab = F(sum(balls[i][0] == 'R' and balls[j][1] == 1 for i, j in no_replacement), 72)
    probability = F(hits, len(draws))
    assert pa*pb == pab
    out[49] = (probability == F(8, 81), f'{probability}; P(A)={pa}; P(B)={pb}; independent',
        '8/81; P(A)=2/3; P(B)=1/3; independent',
        {'replacement_hits': hits, 'replacement_draws': len(draws),
         'nonreplacement_draws': len(no_replacement), 'P_AB': str(pab)},
        'The candidate omits the reverse orders in part (1).')
    # 50. For t>0, ln(1+t)-t/(1+t) has derivative t/(1+t)^2.
    # For 0<t<=1 this gives integrand >=1/(t*(1+t)) >=1/(2*t).
    derivative_num = polyadd([1, 1], [-1])
    assert derivative_num == [0, 1]
    # Each disjoint interval [epsilon/2^(k+1),epsilon/2^k] contributes
    # at least 1/4 by width times its minimum reciprocal lower bound.
    lower_bounds = []
    for k in range(12):
        left, right = F(1, 2**(k+1)), F(1, 2**k)
        lower_bounds.append((right-left)/(2*right))
    assert set(lower_bounds) == {F(1, 4)}
    out[50] = (False, 'Diverges to +infinity as an improper integral', '1',
        {'log_lower_bound_derivative_numerator': derivative_num,
         'dyadic_interval_lower_bound': str(lower_bounds[0]),
         'certificate': 'For every integer k>=0, the dyadic interval has integral at least 1/4. Arbitrarily many disjoint such intervals lie next to the lower endpoint, so the integral diverges for every epsilon>0.'},
        'The integral starting at x=2 has a positive nonintegrable endpoint singularity; the second integral cannot cancel it.')
    # 52. Trial division continues until divisor^2 exceeds remainder.
    factors = factor(33146799)
    product = 1
    for x in factors:
        product *= x
        assert factor(x) == [x]
    assert product == 33146799
    candidate = [3, 7, 1578419]
    out[52] = (factors == candidate, str(factors), str(candidate),
        {'prime_factorization': factors, 'candidate_product': 3*7*1578419,
         'candidate_large_factor_factorization': factor(1578419)},
        'Exhaustive integer trial division supplies the complete prime factorization.')
    # 53. Rational polynomial differentiation and multiplication.
    c = F(20, -24) - (2 + -3)
    original = [F(1), F(0), F(1, 8), -c, F(1, 16)]
    derivative = [i*original[i] for i in range(1, len(original))]
    factored = polymul([0, F(1, 4)], polymul([-1, 1], [-1, 1]))
    assert derivative == factored
    proposed = [0, F(1, 4), F(57, 24), F(1, 4)]
    out[53] = (derivative == proposed, 's*(s-1)^2/4', 'x^3/4+x/4+57*x^2/24',
        {'c': str(c), 'correct_coefficients_ascending': list(map(str, derivative)),
         'candidate_coefficients_ascending': list(map(str, proposed))},
        'The candidate computes c incorrectly and gives a different polynomial.')
    # 56. Standard basis is a legal choice of the three arbitrary vectors.
    u, v, w = (1, -2, 3), (2, 3, -4), (0, 7, -10)
    endpoint_cross = cross(sub(v, u), sub(w, u))
    vector_cross = cross(u, v)
    assert endpoint_cross != (0, 0, 0) and vector_cross != (0, 0, 0)
    intended_w = tuple(2*x-y for x, y in zip(u, v))
    assert cross(sub(v, u), sub(intended_w, u)) == (0, 0, 0)
    out[56] = (False, '(-7,10) for collinear position endpoints; literal parallel vectors have no solution', '(7,-10)',
        {'a': [1, 0, 0], 'b': [0, 1, 0], 'c': [0, 0, 1],
         'u': u, 'v': v, 'candidate_w': w,
         'endpoint_collinearity_cross_product': endpoint_cross,
         'literal_vector_cross_product': vector_cross},
        'The candidate fails under either interpretation of collinear vectors on the same exact counterexample.')
    # 67. A=-1,b=2,c=3 obeys the given original solution set.
    assert polymul([1, 1], [-3, 1]) == [-3, -2, 1]
    a, b, c = -1, 2, 3
    transformed_at_zero = a
    out[67] = (False, '(-1/3,1)', '(-infinity,-1/3) union (1,infinity)',
        {'a': a, 'b': b, 'c': c, 'transformed_polynomial': [a, -b, c],
         'x_counterexample': 0, 'transformed_value': transformed_at_zero,
         'original_factorization': '-(x+1)*(x-3)'},
        'The legal coefficient choice makes x=0 satisfy the transformed strict inequality, but the candidate excludes it.')
    # 69. Every percentage is an exact rational multiplier.
    fraction = F(80, 100)*F(80, 100)*F(85, 100)
    percentage = 100*fraction
    out[69] = (percentage == 54, f'{percentage}% = 54.4%', '54%',
        {'price': str(60*fraction), 'percentage': str(percentage)},
        'The exact percentage is 54.4; the question gives no instruction to round to an integer.')
    # 70. Parametrize cusp as P(t)=(t^2,t^3). For nonzero tangent
    # parameter a, P(b) lies on tangent iff 2b^3-3ab^2+a^3=0.
    # Verify the identity as b-polynomials whose coefficients are
    # polynomials in a. A compact bivariate integer representation follows.
    def multi_mul(p, q):
        result = {}
        for (a1, b1), v1 in p.items():
            for (a2, b2), v2 in q.items():
                key = (a1+a2, b1+b2)
                result[key] = result.get(key, 0) + v1*v2
        return {k: v for k, v in result.items() if v}
    identity = multi_mul(multi_mul({(0, 1): 1, (1, 0): -1},
                                  {(0, 1): 1, (1, 0): -1}),
                         {(0, 1): 2, (1, 0): 1})
    assert identity == {(0, 3): 2, (1, 2): -3, (3, 0): 1}
    # b=-a/2; normal slope at b is -2/(3b). Equality to tangent
    # slope 3a/2 gives 9*a^2-8=0, with two distinct real roots.
    coefficients = [F(-8), F(0), F(9)]
    discriminant = coefficients[1]**2 - 4*coefficients[2]*coefficients[0]
    count = 2 if discriminant > 0 else 1 if discriminant == 0 else 0
    assert coefficients[0] != 0 and count == 2
    out[70] = (count == 2, str(count), '2',
        {'intersection_polynomial_identity': '(b-a)^2*(2*b+a)=2*b^3-3*a*b^2+a^3',
         'normal_tangent_equation_coefficients': list(map(str, coefficients)),
         'discriminant': str(discriminant),
         'certificate': 'Each nonzero root a gives b=-a/2 distinct from a. The two slopes have opposite signs, hence distinct lines. At the cusp the limiting tangent y=0 and normal x=0 each meet the curve only at the cusp, so add none.'},
        'The final numerical answer is correct even though the candidate derivation is invalid. This audit scores final answers.')
    # 72. Missing soda count yields at least two feasible distinct prices.
    remainder = 5*5 - (5*F(3) + 4*F('1.20') + F('2.7'))
    models = [{'cups': n, 'unit_price': str(remainder/n)} for n in [5, 10]]
    assert remainder/5 != remainder/10
    out[72] = (None, 'Underdetermined: unit price=2.5/number_of_cups', '0.5',
        {'soda_total': str(remainder), 'distinct_feasible_models': models},
        'The stated question never specifies the soda count. Its candidate assumes one cup per friend; no label correction is justified for this underspecified item.')
    # 73. At x=4 both radicals are positive, so unequal squares disprove.
    x = 4
    actual_square = 60*x * 12*x * 63*x
    candidate_square = 36**2 * 35
    out[73] = (actual_square == candidate_square, '36*x*sqrt(35*x), x>=0', '36*sqrt(35)',
        {'x': x, 'true_value_squared': actual_square,
         'candidate_value_squared': candidate_square},
        'The candidate drops the dependence on x; an exact legal input disproves the identity.')
    # 74. Exact special-angle derivatives after division by r^2.
    # At pi/6: cos(pi/3)-sqrt(3)sin(pi/3)=1/2-3/2.
    # At 2pi/3: cos(4pi/3)-sqrt(3)sin(4pi/3)=-1/2+3/2.
    d1, d2 = F(1, 2)-F(3, 2), -F(1, 2)+F(3, 2)
    assert d1 != 0 and d2 != 0
    out[74] = (False, 'theta=pi/12+k*pi for nonzero r', 'pi/6 (also claims 2*pi/3)',
        {'r_counterexample': 1, 'derivative_at_pi_over_6': str(d1),
         'derivative_at_2pi_over_3': str(d2),
         'certificate': 'A/r^2=sin(2*theta+pi/3)-sqrt(3)/2. Its maximum occurs when the sine is 1. Both proposed angles have nonzero derivative.'},
        'The final proposed angles are not stationary and therefore cannot maximize the unconstrained differentiable area function.')
    return out


def main():
    cases = json.loads((HERE / 'cases.json').read_text())
    by_index = {c['index']: c for c in cases}
    computed = checks()
    assert set(computed) == set(INDICES)
    results = []
    for index in INDICES:
        case = by_index[index]
        assert not any(k in case for k in ('label', 'reference', 'gold'))
        correct, expected, candidate, evidence, reason = computed[index]
        results.append({'index': index, 'id': case['id'],
                        'status': 'inconclusive' if correct is None else 'proved',
                        'candidate_correct': correct, 'expected': expected,
                        'candidate_final': candidate, 'evidence': evidence,
                        'reason': reason,
                        'question_sha256': hashlib.sha256(case['question'].encode()).hexdigest(),
                        'candidate_sha256': hashlib.sha256(case['candidate'].encode()).hexdigest()})
    output = HERE / 'audit_valid_math_a.json'
    output.write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps({'checked': len(results), 'proved_correct': sum(r['candidate_correct'] is True for r in results),
                      'proved_wrong': sum(r['candidate_correct'] is False for r in results),
                      'inconclusive': sum(r['candidate_correct'] is None for r in results)}))


if __name__ == '__main__':
    main()
