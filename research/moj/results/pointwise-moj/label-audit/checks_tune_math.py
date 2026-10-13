"""Exact, label-blind certificates for assigned Verify practice math cases.

Run from any directory. Reads only cases.json, never benchmark labels/references.
Candidate final expressions below are transcriptions, guarded against input drift.
A proof flag is issued only for a complete exact check or an exact counterexample.
Ambiguous or internally inconsistent specifications remain inconclusive.
"""
from fractions import Fraction as F
from math import comb
from pathlib import Path
import json
from hashlib import sha256

HERE = Path(__file__).resolve().parent
ASSIGNED = [0, 8, 18, 19, 21, 22, 23, 25, 30, 31, 32, 35, 40, 45]


# Bind every manually transcribed mathematical input and final expression.
INPUT_HASHES = {0: {'question': '9aedf78c63389c1765afa4929bf728d95e1d5f3c416ac9247b225623a7266e3b', 'candidate': 'aa851ead5201bce65f59735685f580a2ce225080782e22f99c7d2f68fc50ace4'}, 8: {'question': '90f11578f840d99d8ff7ba41c661260e782a7c626dbf049ce4060637348f4e6e', 'candidate': '659bee0b024dd0e14cae312d28001810de4e1f6895214f69913aec7768347ba6'}, 18: {'question': 'c64767f825109c9043bcee745fc3265a8b09fd7c35b67557f2f214eb578958fe', 'candidate': 'ece42580bcab2a587ffca389dee1755cf3636b3427a7b0f74ff62e53fd323da0'}, 19: {'question': '1daf41d93e136c949b085e2aca173452c0ceec6a18b0e5a5f4838e73a46db981', 'candidate': 'f81e0b54f7fa4570412bd269f6ef7b45ce47984af4c249340c8419a596064811'}, 21: {'question': '4b5dc4b32fbb0e28e86603a461554043c43c1841c114e258bf0a50b95de15ae7', 'candidate': '01eb58ba75f16b071376b3b057d3f807d47a7f81dbc83cb3a5031b8ffbdf2236'}, 22: {'question': 'da35d0bf9399545c36110ba78c016c11638af1c18f021b37a0aa527e6732aa1f', 'candidate': '0daca48a91811c6ed5514f0ad08fb4a6f3c24e531093f890dbf0fce9795529e2'}, 23: {'question': '52d8d5d439c3a3772bbe730ad83c726deed99194aa3734c6fd26610ad7620b45', 'candidate': 'd43dad8288d565d0606a4d37a71d554e982d206783627d12236aa7b44ec52e58'}, 25: {'question': '410c2683485e5c31f9552661c1e5f935bd41511ee439b946d4a647f8af857ff7', 'candidate': '39e33272d62cb4d9b941db7d0f472f4b819501a142376471e3a9b1b46db946d5'}, 30: {'question': '438b751f5eaec795c1386dade31286883641d4fa16e55af0cf152e65fd6e8cf2', 'candidate': '1359b1dd70d6f34d2629e9d5de40820b5b469b2f6fa6593ecfd5a56594e396ec'}, 31: {'question': '1fe3c482da0a386a1ed1b3a8a30a19387523fe49ce5d5f883dc49bffcc46a843', 'candidate': '2a0af9a0bb93e61f2e4d767c57bb57677c77dd11ae67e42fe958ab1b98ae357c'}, 32: {'question': '4b25f370b72822a868001f2be274bacd8654b3593c0502d28351a9d2ffa8a67e', 'candidate': '9e8794602edc6a4b29f64cf069ea6583dca5ebbc72e924b31861d5cceedca077'}, 35: {'question': 'd911c60c3dea2aae447c484d1fc0b79b99c1f26cc0585e6f8cc6f5a2e5b1e241', 'candidate': '7bfc6b49e8f8ed5f46425d4f24a38384d483dccfa433da067bcb9818a98c2831'}, 40: {'question': '12596e35cb3d40645695d459ee3e92e648efdeb8dee66d99f5880a6ca0ee692f', 'candidate': '92d3eae21bae558ea9d358cc937c8e20ec71b8f1c5eaecf98919eea5c95b446c'}, 45: {'question': 'ef70964dced054cc2ba50b73b155d66ede27487ee4163e890176881d68e43410', 'candidate': '9092401b4453c64e21ed5757399d895650d710fc1b4afe2f00e52bcf75283df5'}}

def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(2)) for j in range(2)] for i in range(2)]


def inv(a):
    d = a[0][0] * a[1][1] - a[0][1] * a[1][0]
    assert d
    return [[a[1][1]/d, -a[0][1]/d], [-a[1][0]/d, a[0][0]/d]]


def qmul(a, b, d):
    """Exact multiplication in Q(sqrt(d)), pairs (rational, radical coefficient)."""
    return (a[0]*b[0]+d*a[1]*b[1], a[0]*b[1]+a[1]*b[0])


def qadd(a, b):
    return (a[0]+b[0], a[1]+b[1])


def qscale(a, v):
    return (v*a[0], v*a[1])


def square_linear(a, b):
    """Polynomial coefficients of (a*x+b)^2 in increasing degree order."""
    return [b*b, 2*a*b, a*a]


def subtract(a, b):
    return [x-y for x, y in zip(a, b)]


def check(case):
    i = case['index']
    for field, digest in INPUT_HASHES[i].items():
        assert sha256(case[field].encode()).hexdigest() == digest, (i, field, 'input drift')
    candidate = case['candidate']
    out = dict(index=i, id=case['id'], status='inconclusive', candidate_correct=None,
               expected=None, candidate_final=None, evidence={}, reason='')
    def proved(correct, expected, final, evidence, reason):
        out.update(status='proved', candidate_correct=bool(correct), expected=expected,
                   candidate_final=final, evidence=evidence, reason=reason)
    def uncertain(expected, final, evidence, reason):
        out.update(expected=expected, candidate_final=final, evidence=evidence, reason=reason)

    if i == 0:
        assert r'4\sqrt{5}' in candidate and r'7\pi' in candidate
        # x^2-y^2=8, x=2+sqrt(3)t/2, y=t/2 gives
        # t^2 + 4sqrt(3)t - 8 = 0; direction has unit norm.
        discriminant = 16*3 - 4*(-8)
        separation_squared = F(discriminant)
        candidate_squared = 4**2*5
        direction_norm_squared = F(3,4)+F(1,4)
        assert separation_squared == candidate_squared and direction_norm_squared == 1
        assert F(4**2, 2) == 8
        uncertain('MN=4sqrt(5); intersections depend on polar-ray versus signed-radius line convention',
                  '(4,pi/6), (4,7pi/6); MN=4sqrt(5)',
                  dict(chord_squared=separation_squared, direction_norm_squared=direction_norm_squared,
                       both_points_on_hyperbola=True),
                  'Part II is exactly correct. Part I names two points although theta=pi/6 with nonnegative radius is a ray. The opposite point is on the signed-radius line interpretation, not that ray. No complete unconditional correctness verdict.')
    elif i == 8:
        assert 'cannot accurately find the minimum' in candidate
        # Let r=xyz. E=18-2(196+9r)/(126-r). Its derivative is negative.
        # Discriminant of t^3-9t^2+14t-r is 4900-648r-27r^2.
        # For positive x,y,z, r>0 and the real-root discriminant is nonnegative.
        # This polynomial strictly decreases on r>=0; its positive root is
        # therefore an upper bound on r. The attaining positive triple below
        # proves feasibility. Also 126-r=(x+y)*(x+z)*(y+z)>0, so the negative
        # objective derivative proves the claimed minimum at maximum r.
        p, q = 9, 14
        assert [p*p*q*q-4*q**3, 18*p*q-4*p**3, -27] == [4900,-648,-27]
        r = (F(-12), F(26,9))  # r=-12+(26/9)*sqrt(39)
        a = (F(3), F(-1,3)); z = (F(3), F(2,3))
        assert qadd(qscale(a,2),z) == (9,0)
        assert qadd(qmul(a,a,39),qscale(qmul(a,z,39),2)) == (14,0)
        assert qmul(qmul(a,a,39),z,39) == r
        D = qadd((F(4900),F(0)), qadd(qscale(r,-648),qscale(qmul(r,r,39),-27)))
        assert D == (0,0)
        assert 3**2 > F(39,9)  # a positive; z positive by coefficients.
        derivative_numerator = -2*(9*126+196)
        assert derivative_numerator < 0
        uncertain('18-2*(196+9*r)/(126-r), r=-12+(26/9)*sqrt(39)',
                  'No minimum supplied; candidate states it cannot find one',
                  dict(maximum_xyz=r, discriminant_at_bound=D,
                       objective_derivative_numerator=derivative_numerator,
                       attaining_triple=[a,a,z]),
                  'Exact discriminant and equality certificate calculate the minimum. Candidate gives no final value to compare; this is an incomplete response, not a computed contradiction of a stated numeric answer.')
    elif i == 18:
        assert r'\pm \frac{\pi}{6} + k\pi' in candidate
        # Exact counterexample to completeness: x=pi/3.
        cos_x, cos_2x, cos_5x = F(1,2), F(-1,2), F(1,2)
        lhs = (F(7,4)-2*cos_2x)*abs(2*cos_2x+1)
        rhs = cos_x*(cos_x-cos_5x)
        # Multiples of pi reduced modulo 1; candidate gives residues 1/6 and 5/6.
        omitted = F(1,3) not in {F(1,6), F(5,6)}
        proved(not (lhs == rhs and omitted), 'Solution set includes x=pi/3',
               'x=+/-pi/6+k*pi', dict(x_over_pi=F(1,3), lhs=lhs, rhs=rhs,
                                      outside_candidate_set=omitted),
               'The proposed general solution omits an exact root.')
    elif i == 19:
        assert r'11.5 & -6' in candidate and r'2 & -0.5' in candidate
        ai = [[F(-2),F(3)],[F(-1),F(4)]]
        a = inv(ai); identity = [[F(1),F(0)],[F(0),F(1)]]
        ap = [[a[j][k]+identity[j][k] for k in range(2)] for j in range(2)]
        sq = mul(ap,ap); result = inv(sq)
        final = [[F('11.5'),F(-6)],[F(2),F('-0.5')]]
        assert mul(a, ai) == identity
        proved(result == final and mul(sq,final) == identity, result, final,
               dict(A=a, squared=sq, inverse_product=mul(sq,final)),
               'Exact rational matrix inversion and identity multiplication verify every entry.')
    elif i == 21:
        assert r'5+ \sqrt {21}' in candidate
        # Under the intended B,C foci reading, eccentricity is a/|b-c|.
        rationalized = qmul((F(5),F(1)), (F(5),F(-1)), 21)
        assert rationalized == (4,0)
        uncertain('5+sqrt(21), if B and C are the two foci', '5+sqrt(21)',
                  dict(product_with_focal_distance_difference=rationalized,
                       focal_separation=4, squared_b=25, squared_c=21),
                  'The answer matches the exact nondegenerate B,C-foci interpretation. The question literally assigns the triangle vertices as foci without specifying two vertices. Keep this wording ambiguity outside unconditional label corrections.')
    elif i == 22:
        assert r'5.5q_A + 17.25q_B + 36q_C' in candidate
        price = [F(100),F(150),F(200)]
        rises = [F(1,10),F(15,100),F(1,5)]
        increased = [p*(1+r)*(1-r) for p,r in zip(price,rises)]
        discount_full = [p*F(95,100)*(1+r) for p,r in zip(price,rises)]
        discount_extra = [p*F(95,100)*r for p,r in zip(price,rises)]
        delta_full = [b-a for a,b in zip(increased,discount_full)]
        delta_extra = [a-b for a,b in zip(increased,discount_extra)]
        assert delta_full == [F('5.5'),F('17.25'),F(36)]
        uncertain('Depends on whether additional purchases are 110/115/120% or 10/15/20% of original quantities',
                  '5.5q_A+17.25q_B+36q_C',
                  dict(increased_coefficients=increased, full_additional_difference=delta_full,
                       only_extra_difference=delta_extra),
                  'Exact arithmetic agrees under the 110/115/120% reading. Additional amounts and 10/15/20% more do not uniquely specify that reading. No label correction on this ambiguity.')
    elif i == 23:
        assert r'\boxed{(2,3,4)}' in candidate
        vertices = [(2,3,0),(0,5,4),(4,1,8)]; final = (2,3,4)
        ds = [sum((p-q)**2 for p,q in zip(v,final)) for v in vertices]
        # Every cube center is equidistant from all its vertices.
        proved(len(set(ds)) == 1, 'Center must have equal squared distance to A,B,C', final,
               dict(squared_distances=ds),
               'Candidate fails the necessary equal-distance invariant, independently of orientation.')
    elif i == 25:
        assert r'200000}{3746171' in candidate
        favorable = comb(7,6)*10**6; total = comb(70,6)
        expected = F(favorable,total); final = F(200000,3746171)
        sequential = F(1)
        for k in range(6): sequential *= F(70-10*k,70-k)
        assert expected == sequential
        proved(expected == final, expected, final,
               dict(favorable_subsets=favorable, total_subsets=total,
                    independent_sequential_check=sequential),
               'Exact counting and sequential without-replacement calculation agree with the fraction.')
    elif i == 30:
        assert r'\frac{255}{64}' in candidate
        sum_xy = F(4); diff_xy = F(1,4)
        x=(sum_xy+diff_xy)/2; y=(sum_xy-diff_xy)/2
        expected=x*y; final=F(255,64)
        assert x+y==4 and 4*(x-y)==1 and 3**4==81
        proved(expected==final,expected,final,dict(x=x,y=y,sum=x+y,four_times_difference=4*(x-y)),
               'Equal positive bases reduce the equations to an exact rational linear system.')
    elif i == 31:
        assert r'\boxed{12}' in candidate
        counts=[17,17]
        assert sum(counts) != 29
        uncertain('No coin collection satisfies the literal counts',12,
                  dict(total_required=29,total_from_each_count=sum(counts),
                       denomination_if_17_quarters_and_12_other=F(545-17*25,12)),
                  '17 of each of two types requires 34 coins, contradicting 29. Repairing the statement would change the task; no correctness label is inferred.')
    elif i == 32:
        assert r'\boxed{4698}' in candidate
        first=450*F(35,100); rest=450-first
        revenue=first*12+rest*12*F(80,100)
        assert revenue==4698 and first.denominator!=1
        uncertain('4698 in a divisible-inventory model; no exact integer inventory satisfies 35%',4698,
                  dict(first_quantity=first,rest_quantity=rest,idealized_revenue=revenue),
                  'Candidate arithmetic is correct under the usual continuous-percentage idealization, but the literal gerbil count is impossible. Do not correct a label using an unstated idealization.')
    elif i == 35:
        assert r'5\sqrt{21}' in candidate
        # In affine coordinates A=0,B=b,D=d,F=t*d, t>1.
        # On B+s(F-B), AC occurs at s=1/(t+1), DC at s=1/t.
        # Thus EF/BF=t/(t+1), GF/BF=(t-1)/t, and EF-GF=BF/(t(t+1))>0.
        # Numerator of t^2 - (t-1)(t+1) is identically 1.
        numerator = subtract([0,0,1],[-1,0,1])
        assert numerator == [1,0,0]
        assert 15 < 20
        uncertain('No exterior-F configuration with E on AC and G on side DC has EF=15, GF=20',
                  '5sqrt(21)',dict(EF=15,GF=20,EF_minus_GF_over_BF='1/(t*(t+1)), t>1',
                                  exact_numerator=numerator),
                  'The given lengths reverse the necessary EF>GF order. The drawing also places E before G. No correction from an inconsistent specification.')
    elif i == 40:
        assert r'\boxed{y^2 = 8x}' in candidate
        # Squared distances: y^2 = (|x+3|-1)^2-(x-2)^2.
        plus=subtract(square_linear(1,2),square_linear(1,-2))
        minus=subtract(square_linear(-1,-4),square_linear(1,-2))
        assert plus == [0,8,0] and minus == [12,12,0]
        # Positive branch requires x>=-2; y^2=8x then implies x>=0,
        # hence x+2>=0 and squaring is reversible.
        # Negative branch requires x<=-4. Its rhs is increasing and at most -36.
        negative_upper = minus[0]+minus[1]*(-4)
        correct = plus == [0,8,0] and minus[1]>0 and negative_upper<0
        proved(correct,'y^2=8x','y^2=8x',
               dict(positive_branch_polynomial=plus, negative_branch_polynomial=minus,
                    negative_branch_maximum=negative_upper, positive_branch_domain='x>=0'),
               'Exact polynomial identities plus the nonnegative-distance domain prove both necessity and sufficiency.')
    elif i == 45:
        assert r'\boxed{16}' in candidate
        n=16; p=F(1,2); allowed=[k for k in range(n+1) if abs(F(k,n)-p)<=F(1,10)]
        probability=F(sum(comb(n,k) for k in allowed),2**n)
        strict=[k for k in range(n+1) if abs(F(k,n)-p)<F(1,10)]
        assert allowed==strict
        proved(probability>=F(9,10),'n=16 fails at p=1/2',16,
               dict(p=p,n=n,allowed_head_counts=allowed,exact_probability=probability,
                    required_probability=F(9,10)),
               'Exact binomial counterexample disproves the proposed guarantee for both strict and non-strict within conventions.')
    else:
        raise ValueError(i)
    return out


def main():
    cases=json.loads((HERE/'cases.json').read_text())
    by_index={r['index']:r for r in cases}
    results=[check(by_index[i]) for i in ASSIGNED]
    assert len(results)==len(ASSIGNED) and {r['index'] for r in results}==set(ASSIGNED)
    # Focused independent checks on arithmetic primitives.
    assert inv([[F(1),F(2)],[F(3),F(4)]])==[[F(-2),F(1)],[F(3,2),F(-1,2)]]
    assert qmul((F(2),F(3)),(F(2),F(-3)),5)==(F(-41),F(0))
    assert F(comb(16,7)+comb(16,8)+comb(16,9),2**16)<F(9,10)
    (HERE/'audit_tune_math.json').write_text(json.dumps(results,indent=2,default=str)+'\n')
    print(json.dumps({'items':len(results),'proved':sum(r['status']=='proved' for r in results),
                      'proved_correct':sum(r['candidate_correct'] is True for r in results),
                      'proved_wrong':sum(r['candidate_correct'] is False for r in results)}))

if __name__=='__main__': main()
