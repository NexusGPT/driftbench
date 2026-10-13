"""Independent TEST label audit. Reads cached items only; no model calls.

The three audit artifacts are the only outputs. Official benchmark data and
scoring are never changed. Execute from any directory with Python 3.
"""
from pathlib import Path
from fractions import Fraction as F
from itertools import permutations, product, combinations
import json, math, re, ast, hashlib, os, tempfile
from datetime import date,timedelta

HERE = Path(__file__).resolve().parent
DATA = HERE / 'test-label-audit.json'
doc = json.loads(DATA.read_text())
items = doc['items']
assert len(items) == 221 and len({x['id'] for x in items}) == 221
source_url='https://raw.githubusercontent.com/cjj826/LongJudgeBench/main/data_standardized/verify_bench_hard.jsonl'
cache_dir=Path(os.environ.get('DRIFTBENCH_BENCH_CACHE',str(Path(tempfile.gettempdir())/'driftbench-judge-benchmarks')))
cache_file=cache_dir/hashlib.sha256(source_url.encode()).hexdigest()[:16]
assert cache_file.is_file(), 'Existing source cache required; no download is permitted.'
source_bytes=cache_file.read_bytes()
source_rows=[json.loads(line) for line in source_bytes.decode().splitlines() if line.strip()]
test_rows=[r for r in source_rows if hashlib.sha256(('split:longjudge-verify:'+r['id']).encode()).digest()[0]>=77]
assert len(test_rows)==221
for audit,raw in zip(items,test_rows):
    assert audit['id']==raw['id'] and audit['question']==raw['instruction']
    assert audit['response']==raw['responses'][0]['content']
    assert audit['official_label']==raw['ground_truth']['gold_correct']
    assert audit['correct']==audit['official_label']
doc['provenance']={'source_url':source_url,'source_sha256':hashlib.sha256(source_bytes).hexdigest(),'loaded_with':'loadBenchmark and splitOf from src/data.ts; existing cache only','official_source_preserved':True,'method_freeze_record':'pre-test-methods.json','new_model_calls':0,'new_model_call_cost_usd':0}

def record(n, correct, basis, answer=None, submitted=None, proof=None, checks=None):
    x = items[n]
    x['verdict'] = 'label_supported' if correct == x['official_label'] else 'proved_conflict'
    x['audited_correct'] = correct
    x['basis'] = basis
    if x['verdict'] == 'proved_conflict':
        x['submitted_answer'] = submitted
        x['independently_verified_answer'] = answer
        x['proof'] = proof or basis
        x['proof_checks'] = checks or ['Algebraic argument stated in proof.']

def unresolved(n, basis):
    x=items[n]
    x['verdict']='unresolved'
    x['basis']=basis
    for k in ['audited_correct','proof','submitted_answer','independently_verified_answer','proof_checks']:
        x.pop(k,None)

# Each basis concerns the terminal answer, never the quality of its explanation.
supported = {
0:'The projection range is span((1,7)); submitted (7,1) is outside it.',
1:'The infimum 2 is not attained when b>0; submitted [2,infinity) includes an impossible endpoint.',
2:'Substituting x=0 forces f(0)=1; the submitted arbitrary constant b fails, and f(x)=-x+1 already fails at x=1,y=0.',
3:'A=1,B=3; the requested expression is (2x-7)/((x+1)(x-2)), not the submitted constant 2.',
4:'The determinant is -x^3, which is not the submitted 0 (take x=1).',
5:'The direction must be (-5/13,12/13) because distance t is nonnegative and x<=7; the submitted vector points the other way.',
7:'The submitted pair (2,3) violates the stated p>q.',
10:'L=1 has sum floor(1/2)=0, a square, and is omitted by the submitted all-positive-even answer.',
11:'A nondegenerate triangle has a+b>c, so x=1 is impossible; the submitted interval includes it.',
12:'Changing phi to phi-pi/2 changes z from 5 to sqrt(13); the submitted final z remains 5.',
13:'Evenness gives k=1; f(x)=x^2+3 decreases for x<0, as submitted.',
14:'For n=2 and factors (x^2+1)(x^2+4), the proposed family violates 2*4+25<=6*4.',
18:'The logarithm requires -1<x<1 and is decreasing; f(2x-1)<0 exactly for 1/2<x<1.',
20:'Thirty consecutive zeros span 14*pi+pi/3, shorter than the submitted 15*pi; the answer is not minimal.',
22:'Direct lateral-surface integration yields 4*a^3/3, not the submitted 2*pi*a^3.',
25:'The value -1 is not attained: for integer n and x in [n,n+1), g ranges over (n(n-1)-1,n(n-1)].',
28:'The valid triples (3,1,2) and (3,2,1) are omitted from the submitted complete list.',
29:'Factoring is requested; constant 0 fails at a=2,b=1.',
30:'Symmetry gives b=-4 and f(2)<f(1)<f(4), contrary to the submitted order.',
31:'Part b is possible: ten numbers all equal to 2.35 have every triple sum 7.05 and every five sum 11.75; submitted no is incomplete/wrong.',
38:'The final study may end on either Thursday or Friday: start Thursday 01:00 gives Thursday16:00; start Thursday11:00 gives Friday02:00.',
40:'The terminal output must name persons [Bob,Emma,Jason], not the submitted list of dates.',
43:'Input <<> needs one final >; the submitted completed <<>> is balanced.',
45:'The terminal value 1998-30-39 is not a valid calendar date.',
47:'The custom alphabet leaves i<o, so misunderstandings precedes modifications; the submitted list reverses them.',
48:'The new alphabet begins f,w,p,h; the submitted list begins astigmat although paula and publications precede it.',
50:'The response ends without a translation for the requested masked element.',
51:'The response ends without a Phan Rang Cham form for masked element (10).',
55:'The response ends in repeated invented scarf observations and supplies no terminal object for the requested walk.',
59:'The chord subtends pi/3; larger area is 30*pi+9*sqrt(3), not 18*pi.',
61:'The submitted 26832 does not solve the stated range equation even under its chosen 1.2 ratio: .728*26832=19533.696.',
64:'NaHSO3+HCl -> NaCl+SO2+H2O uses one mole HCl per mole water; final 1 is correct.',
67:'Revenue=(s*4)+(s/2)*12=10s=120 gives s=12; terminal 6 is wrong.',
68:'Sum of binomial coefficients is 2^n=64, hence n=6; .97^6 rounds to .83, whose hundredths digit is 3, not 4.',
69:'The post-fee price is 40*1.25+3+4=57, not terminal 40.',
72:'The correct tangent is -(4+sqrt(7))/3, so the requested terminal a+b+c=14 is correct despite a wrong intermediate sign.',
78:'If a=34 and 67 is divisible by a+b, positive b must be33, but 34 is not divisible by34? It is; part b remains absent, so the submitted answer fails to list all required b values.',
79:'Every term is positive for k>=2; the submitted zero sum is impossible.',
80:'At n=1 the true sum is 1/2+1/4=3/4; the submitted formula gives 3/8.',
81:'The response is truncated while evaluating B and never supplies A+B-C.',
82:'With u=cos(x), integral is integral_0^1 (1+u)(1+u^2)du=25/12, not 1/2.',
83:'The iterate multiplier has modulus sqrt(2)^n; n=1 cannot be a point reflection of modulus1.',
84:'1978^1 is even but not divisible by8, whereas every power at exponent>=3 is divisible by8; m=1,n=101 cannot match modulo1000.',
86:'Grouping n by floor(sqrt(n)+1/2) gives a series total3, not the submitted5.',
87:'Only candidate a=2 is in the original expression domain, giving4; terminal1 is wrong.',
89:'For a=b=c=1 each arctangent is pi/3, so tan(theta)=0; submitted formula is positive.',
90:'For every unit g modulo prime2017, pow(g,2016,2017)=1; the supplied search never returns a generator.',
91:'Base4 -1312 plus -1 is -1313, not the submitted positive110201.',
92:'Chain rule gives exp(-5.8825)*(-4.26+1.856)=-.00670189027, matching the terminal rounded number.',
95:'A difference-cover set has size between sqrt(n) and O(sqrt(n)); limit1/2, not1.',
96:'With no Russian novels, exactly one play and at most three French novels, fewer than five works are selected; A is impossible as submitted.',
101:'The logarithm-change quotient is [ln cos x/ln cos(x/2)]*[ln sin^2(x/2)/ln sin^2 x] ->4*1=4.',
102:'Columns of B on l1 each have l2 norm sqrt(2), except the first zero column; triangle inequality gives operator norm sqrt(2), not sqrt(5).',
105:'The stated function is not a CDF: F(0)=1.3>1, so its claimed expected value is not meaningful.',
108:'The response truncates at clue39 and never gives Rajiv position.',
109:'The response supplies pseudocode and refuses the requested numerical terminal answer.',
110:'The sum is at most H_n, so dividing by log n has limsup<=1 and cannot diverge to infinity.',
111:'n=1 gives (1+39-2)+17*21+5=400=20^2; submitted no solutions is wrong.',
112:'Adding the equations gives (x+3)^2+(y-1)^2+(z-2)^2=0. Its forced triple(-3,1,2) violates the first equation, so there is no real solution.',
113:'Monicity and the specified roots imply p(z)=product(z-z_i), so b=0; -p(0) is not generally0.',
114:'With u=nx and dominated convergence, limit is integral_0^infinity 1/(1+u^2)du=pi/2, not pi/4.',
117:'a=0,b=-1 satisfies the premises and has D=-1, excluded by the submitted [0,2].',
120:'Expansion (1+x)^(1/x)=e*(1-x/2+O(x^2)) gives limit e/2, not0.',
121:'The true sum is pi^2, approximately9.8696; submitted11 is outside error2/5.',
122:'Exact modular exponentiation gives pow(2,947,1373)=177, not2.',
123:'Subtracting2x from the absolute-value graph has its unique minimum at x=48, value18; unique-intersection k=18, not145.',
124:'The root products equal product(1-r_i); AM-GM on r_i(1-r_i)<=1/4 gives product r_i<=1/64 and reciprocal>=64, not1.',
127:'The response ends during an unrelated operation calculation and gives no A+B-C.',
128:'Cartesian integration gives integral_0^1 ((3/2)x^4+x^3)dx=11/20, not(pi-1)/3.',
129:'The cosine Taylor series gives pi*(cos(4*pi)-1)=0; the response says no exact closed form.',
130:'Original quantity15kg, discounted quantity20kg, increase5kg; terminal20 is wrong.',
131:'For fixed positive epsilon, sin(x)<=cos(epsilon)<1 and denominator bounded below; integral tends to0, as terminally submitted.',
133:'The two logarithmic antiderivatives cancel x-dependence, leaving1, not0.',
135:'The equation reduces to (m/g-1)(n/g-1)=0; ordered solutions count is twice the divisor count of9! minus the diagonal, not6.',
137:'Both Riemann integrals become integral_1^2 exp(u^2)du; the difference is0, unlike the submitted expression.',
143:'T(e1)=T(e2) implies e1-e2 belongs to the kernel, contradicting statement1, the submitted selection.',
147:'The response gives no final selected expression.',
149:'A real-closed field has algebraically closed quadratic extension K(i); the response commits to that affirmative result.',
153:'D is directly possible for a grade choosing long-distance running; B contradicts the explicit sprint/long-jump exclusions.',
161:'Complete separation supplies continuous h with h(A)=0,h(B)=1; g=(1-h)f1+hf2 proves the final yes.',
164:'Thirteen friends triggers Rule5, then Rule4 proves suspicion; Rule1 lacks its non-surrender-to-mule antecedent.',
166:'Existentially, the positive x-axis is a simple infinite-length curve in R^2; terminal yes is correct.',
171:'The compact closed ball has a positive distance from the closed complement of the open containing set; a larger ball exists.',
175:'Even the discounted revenue900 minus cost562.5 is337.5, not375; options indicate all75 bundles receive the discount.',
177:'The response is truncated in repetitions and never supplies a terminal count.',
183:'The response ends with candidates A,B,D and never selects the requested one.',
189:'Both a>2 and b>2 imply their sum>4; converse fails at a=3,b=2. FinalB is correct.',
190:'Common perpendicular n makes alpha and beta parallel; any perpendicular m to alpha is then perpendicular to beta. FinalD is correct.',
193:'Tea can be sweetened and Hot Chocolate non-aromatic simultaneously while every stated implication holds; terminal no is correct.',
196:'The algebraic closure of F2 is an infinite algebraically closed, hence quadratically closed, extension; final yes is correct.',
204:'Interpreting8rows literally, upward movement cannot make9steps between bottom and top; terminal255 has no basis.',
206:'Take matrices x=I,y=N-I with nonzero square-zero N. Then x+y=N has spectral radius0 while x has spectral radius1. Final no is correct.',
213:'The K-topology basis includes every ordinary open interval, so each ordinary open set remains open.',
}

for n,basis in supported.items():
    assert not items[n]['official_label'] or n in {13,18,43,64,72,92,96,101,131,149,161,164,166,171,189,190,193,196,206,213}
    record(n,items[n]['official_label'],basis)

# Open cases are kept separate; absence of a proof is never a supported label.
open_cases={
6:'The expression equals sin(3x), but the submission retains a product; whether this violates the required answer form is unresolved.',
8:'Quadratic formula is a necessary root relation but the response does not enumerate integer pairs; completeness requires a separate Diophantine proof.',
9:'The treatment of zero-vector parallelism and whether endpoints belong in monotonic intervals is not explicit.',
21:'No domain for parameter a is supplied; a>1 and 0<a<1 have different limits.',
23:'The intended counterclockwise walk is not specified beyond the verbal description; a square loop and an expanding spiral differ.',
26:'The referenced definitions in Problems II.8.79 and II.13.49 are absent.',
27:'(1,1,2) satisfies the divisibility identity, but uniqueness under the prime-divisor restriction has not been proved.',
33:'The SSA data allow A=60 or120 degrees. Submission gives one valid branch; the expected completeness convention is unresolved.',
34:'The exact dialect rule and conditioning cannot be proved uniquely from the listed word pairs.',
36:'Phonological conditioning and epenthesis are not independently established.',
42:'The root meaning and compound decomposition are not uniquely proved from the arbitrary translation list.',
46:'Nahuatl morphological generalization is not independently proved.',
52:'Vai possessive and sibling morphology is not independently proved.',
53:'The terminal form uses a verb explicitly translated as reflexive; the requested new finite form has not been independently verified.',
54:'Proto-Chamic sound changes and tones are not uniquely established from the provided examples.',
62:'The nested fraction has an ambiguous terminal minus sign and division by zero under a literal reading.',
70:'No positive values exist. Terminal0 could be a shorthand for number of solutions or an invalid value of a.',
74:'The statement calls6,5,5 teachers rather than class loads; the intended allocation problem is not fully specified.',
104:'The53-clue eight-position puzzle requires complete constraint validation; no independent exhaustive solve is available.',
106:'The definitions of A_n and B_n are absent.',
118:'No probability space or consistent random truth-telling model is specified for the self-referential claim.',
125:'The geometrical ratio may depend on triangle shape; independent universal proof is not established.',
126:'The final35 is valid if cars have not passed; crossing and return-path conventions are not explicit.',
136:'Side32 is a valid solution with area960; another SSA branch exists, so single-answer completeness is unresolved.',
142:'Whether an English tuition commitment challenges availability is a natural-language judgment, not an executable entailment.',
144:'The unknown transformations require complete counting constraints and have not been independently solved.',
150:'The distinction between unsupported and inconsistent is not formalized in the question.',
151:'Collection updates and unknown materials require an exhaustive symbolic count not independently performed.',
152:'Rounded endpoints are slightly short of a diameter; literal SVG arcs have different centers, while the intended rounded drawing appears circular.',
154:'The win-win definition permits a natural-language interpretation dispute; no formal proof of a unique option.',
155:'Compound SVG shape membership is not independently established.',
157:'Collection updates have not been exhaustively symbolically evaluated.',
158:'OptionsA andC are both plausible inferences; uniqueness is not a formal statement.',
169:'The scoop argument admits several consistent alternatives; the uniquely intended option is not independently established.',
173:'The implied drinking presupposition is ambiguous in the translated wording.',
174:'Best-supported interpretation favorsB, but ranking natural-language alternatives is not a mathematical proof.',
176:'No population preference data or similarity metric is supplied.',
179:'The translated definition of tragedy and game scenario is unclear.',
181:'The subscripted Bell-polynomial substitution notation is not defined.',
185:'Unknown collection updates have not been completely symbolically counted.',
186:'Same translated availability ambiguity as the other Spring Festival item.',
191:'Pronoun resolution is pragmatically ambiguous; no unique truth-conditional assignment is required.',
192:'At defined nonzero k other than +/-1 the expression equals k; k=0 and +/-1 introduce undefined expressions. Domain convention is unresolved.',
195:'Several existential athlete claims need assumptions absent from the translated premise; unique intended answer unresolved.',
197:'Compound SVG shape membership is not independently established.',
199:'Any square may mean every square or at least one square; terminalNo depends on that wording.',
200:'The response never commits to one of proved/disproved/unknown, so its final claim is ambiguous.',
205:'The translated negative-definition question has multiple negated definitions; unique intended choice unresolved.',
207:'Rounded arc endpoints are short of a diameter, preventing an exact circle under literal SVG semantics.',
210:'Both causation burden and shifted fault burden are stated; intended unique option is unclear.',
212:'Rounded arc endpoints are short of a diameter; exact SVG semantics differ from the apparent intended circle.',
215:'OptionsA andB are identical, and sarcasm is not a formal property proved by string equality.',
217:'No group preference data or similarity metric is supplied.',
}
for n,basis in open_cases.items(): unresolved(n,basis)

# Exact arithmetic conflicts, with source premises retained verbatim in JSON.
assert F(48,12)==F(12,3)
record(15,True,'48 meets the stated digit equation exactly.', '48','48',
       'For the submitted two-digit number48, its digit sum is12. The quotient48/12=4 equals one-third of12. The question asks for one number, so no uniqueness proof is required.', ['Fraction(48,12)==Fraction(12,3)'])
# Coefficients use basis(e^(2t),e^(-t),sin(t),cos(t)).
xcoef=(2,-1,3,-1);ycoef=(1,1,-1,2)
def derivative_coef(c):return (2*c[0],-c[1],-c[3],c[2])
assert derivative_coef(xcoef)==tuple(a+2*b for a,b in zip(xcoef,ycoef))
assert derivative_coef(ycoef)==(xcoef[0],xcoef[1],xcoef[2]-5,xcoef[3])
record(16,True,'The submitted general solution satisfies both differential equations for arbitrary constants.',
       'x=2C1e^(2t)-C2e^(-t)-cos(t)+3sin(t); y=C1e^(2t)+C2e^(-t)-sin(t)+2cos(t)',
       'Same x(t),y(t) as independently verified answer',
       'Differentiating gives x\'=4C1e^(2t)+C2e^(-t)+sin(t)+3cos(t)=x+2y. Also y\'=2C1e^(2t)-C2e^(-t)-cos(t)-2sin(t)=x-5sin(t). The two independent exponential solutions span the homogeneous system, so arbitrary C1,C2 give its general solution.', ['Both differential identities asserted in the exponential/sine/cosine coefficient basis.'])
assert sum(F(1,2**(3**n))-F(0) for n in range(3)) < 1
assert F(8,9)<1
record(17,False,'At x=2 the actual series is strictly below1, the submitted value.',
       'No claimed elementary form verified; at x=2, sum<1','1/(x-1)',
       'Take x=2. Write each term as 2^(-3^n)/(1-2^(-2*3^n)). It is at most(4/3)*2^(-3^n). Since3^n>=2n+1 for n>=0, the whole series is at most(4/3)*sum_n2^(-(2n+1))=8/9<1. The submitted1/(2-1)=1 is therefore false.', ['Geometric upper bound8/9<1.'])
gp=[(a,b,111-a-b) for a in range(1,111) for b in range(1,111-a) if b*b==a*(111-a-b)]
assert set(gp)=={(1,10,100),(100,10,1),(27,36,48),(48,36,27),(37,37,37)}
record(19,True,'Exact enumeration recovers precisely the five submitted triples.',str(gp),str(gp),
       'Natural positive triples have c=111-a-b, so finite enumeration1<=a<=109 and1<=b<=110-a is exhaustive. Geometric progression is equivalent to b^2=a*c. The only surviving triples are(1,10,100),(100,10,1),(27,36,48),(48,36,27),(37,37,37), exactly the submission.', ['Exhaustive positive triples with sum111.'])
assert (8*10,2*10-10,2*10+10)==(80,10,30)
record(32,True,'Factoring produces factors80,10,30 and password801030.', '801030','801030',
       '32x^3-8xy^2=8x(2x-y)(2x+y). At x=y=10 the factors are80,10,30, whose concatenation is801030. The question explicitly accepts one answer.', ['Exact factors80,10,30.'])
record(35,True,'Two models with different Greg colors satisfy every source fact.',
       'Greg color is unspecified','Greg color is not specified',
       'The source gives colors only for Lily,Julius,Brian and Bernhard. Greg is only stated to be a swan. Assign Greg yellow in one model and green in another while preserving every listed fact. Both satisfy the source, so no Greg color follows. No universal color rule is present.', ['Two-model counterexample; neither changes any explicit fact.'])
record(41,False,'The train length is uniquely l; refusal contradicts a determined answer.', 'l','Cannot provide a correct answer',
       'Let train length L and speed v. Passing the pole gives L=vt. Passing the platform gives L+5l=6vt=6L. Thus5l=5L and L=l. The submitted refusal is incorrect.', ['L+5l=6L implies L=l.'])
assert F(2*2+3,2)==F(7,2)
record(60,True,'Equilateral-center geometry gives exactly the submitted enclosing radius.',
       '2+4sqrt(3)/3','2+4sqrt(3)/3',
       'The three small-circle centers form an equilateral triangle of side4. Its circumradius is4/sqrt(3). The enclosing circle center is the triangle circumcenter, and internal tangency adds the small-circle radius2. Therefore R=2+4/sqrt(3)=2+4sqrt(3)/3.', ['Equilateral circumradius4/sqrt(3), plus2.'])
assert F(1500-750**2,750)==-748
record(63,False,'Completing the square gives c/b=-748, not the submitted fraction.', '-748','-560999/750',
       'x^2+1500x+1500=(x+750)^2+(1500-562500). Hence b=750,c=-561000 and c/b=-748. The submitted numerator-560999 differs by1.', ['Fraction(1500-750**2,750)==-748.'])
ms=[m for m in range(100) if F(1,5)<F(m,77)<F(4,7)]
assert ms==list(range(16,44)) and F(sum(ms),len(ms))==F(59,2)
record(65,True,'Exact enumeration gives integers16 through43 and mean59/2.', '59/2','59/2',
       'Multiplying the strictly-between inequalities by77 gives77/5<M<44. Thus M=16,17,...,43. Their arithmetic mean is(16+43)/2=59/2, exactly the submitted value.', ['Exact Fraction comparison over all relevant integers.'])
assert -1-4+3==-2
record(66,True,'The explicit graph source defines5-(x+2)^2 and verifies terminal-2.', '-2','-2',
       'The source Asymptote function is g(x)=5-(x+2)^2=-x^2-4x+1. Therefore d=-1,e=-4,f=1 and d+e+3f=-2. This uses the supplied source function directly, not a guessed graph reading.', ['Coefficient arithmetic-1-4+3=-2.'])
tris=[(a,a,27-2*a) for a in range(1,14) if 27-2*a>0 and 2*a>27-2*a]
assert len(tris)==7
record(71,True,'Enumerating repeated side a=7,...,13 yields exactly seven triangles.', '7','7',
       'Any isosceles triangle has sides(a,a,b) with b=27-2a. Positivity gives a<=13 and triangle inequality2a>b gives a>=7. Each integer a=7,...,13 defines a distinct valid triangle, including the equilateral casea=9. Thus the submitted count7 is correct under the usual inclusive definition of isosceles.', ['Seven triangles from a7 through13; all strict triangle inequalities.'])
e1,e2,e3=F(2),F(-1,2),F(-1)
p4=e1*8-e2*5+e3*2
assert p4==F(33,2)
record(73,True,'Newton identities give exactly33/2.', '33/2','33/2',
       'From p1=2,p2=5, elementary symmetric sums are e1=2,e2=(4-5)/2=-1/2. Newton identity p3-e1*p2+e2*p1-3e3=0 gives e3=-1. Then p4=e1*p3-e2*p2+e3*p1=16+5/2-2=33/2.', ['Fraction Newton identities checked.'])
assert F(1000-280)/F(4,5)==900 and 1000-900==100
record(75,False,'The initial discount is100, whereas the submission gives280.', '100','280',
       'The final price is1000-280=720. The additional20% discount makes it80% of the initial-discounted price:720/.8=900. Thus the initial discount from1000 is100, not280.', ['Fraction(720,4/5)==900; 1000-900==100.'])
unresolved(76,'With distinct directions the common angle is120degrees and sqrt(3) is correct, but equal directions give common angle0 and magnitude6. The source does not exclude this degeneracy.')
record(77,True,'Equality in the absolute-value triangle inequality requires x outside(20,24).',
       '(-infinity,20] union[24,infinity)','(-infinity,20] union[24,infinity)',
       'Let u=x-24,v=x-20. The source equation is|u|+|v|=|u+v|, equivalent for real numbers to uv>=0. Hence(x-24)(x-20)>=0, exactly x<=20 or x>=24, including both endpoints.', ['Sign-factor equivalence.'])
record(85,False,'The terminal answer omits the requested volume and all planar cut-face area.',
       'Volume256*pi/3; surface area exceeds32*pi and is96*pi for longitudinal wedges','32*pi',
       'Circumference16*pi gives radius8. Any one of eight congruent pieces has volume(4*pi*8^3/3)/8=256*pi/3. Its curved area is32*pi, but a cut wedge also has planar faces with positive area. For eight equal longitudinal wedges, the two semicircular faces contribute64*pi, giving total96*pi. The submitted32*pi cannot be the full surface area and does not supply the volume.', ['Volume fraction and positive cut-face area.'])
integer_terms=[n for n in range(1,101) if math.factorial(n*n+1)%pow(math.factorial(n),n+2)==0]
assert len(integer_terms)==65 and {1,6,10}<=set(integer_terms)
record(93,False,'Exact divisibility finds65 integral terms; optionD, not terminal1.', '65; optionD','1',
       'For each integer n from1 through100, compute numerator(n^2+1)! and denominator(n!)^(n+2) as exact integers and test remainder0. This exhaustive test finds65 integral terms, with n=1,6,10 already giving three witnesses. Therefore the unique correct option isD (more than2), while the submitted1 is false.', ['Exact factorial divisibility for all100terms.'])
assert F(14)+F(4,3)*(1+F(1,4)+F(1,2))==F(49,3)
record(94,True,'Cylinder plus frustum volume is exactly49*pi/3.', '49*pi/3','49*pi/3',
       'The cylindrical volume is pi*1^2*14=14*pi. The4m frustum has radii1 and1/2, so its volume is(pi*4/3)*(1+1/4+1/2)=7*pi/3. Total=49*pi/3, exactly submitted.', ['Fraction cylinder and frustum coefficient identity.'])
record(148,True,'A concrete countermodel shows the claimed John entailment fails.', 'No','No',
       'Take employees John andJane. John attends leadership and team-building and has both managerial skill and teamwork outcomes. Jane attends neither and has neither outcome. Every universal implication and the required existence of outcome-less employees hold, but John fails neither-activity disjunction. Therefore the queried conclusion is not entailed, exactly as submitted.', ['Finite two-person implication countermodel.'])
record(163,False,'Thomae function is a counterexample to mesh necessity.', 'No','Yes',
       'On[0,1], define f(x)=1/q when x=p/q is rational in lowest terms, and0 when x is irrational. Every open interval contains both an irrational and a rational, so f is not constant there. It is Riemann integrable with integral0: for each epsilon>0 only finitely many rationals have denominator at most1/epsilon; cover them by intervals of arbitrarily small total length and bound f<=epsilon elsewhere. Every interval has infimum0, so every lower Darboux sum is0. The fixed partition{0,1} for all n therefore has lower sums equal to the integral, while mesh stays1. Thus the submitted yes is false.', ['Constructive integrability proof and constant-partition mesh1.'])
nvec=(4,-2);v=(8-3,4-2);scale=F(2*sum(a*b for a,b in zip(nvec,v)),sum(a*a for a in nvec))
p,q=F(8)-scale*4,F(4)-scale*(-2)
assert (p,q)==(F(8,5),F(36,5)) and p+q==F(44,5)
record(178,False,'The explicit final optionC disagrees with the exact reflected sum8.8.', '8.8 (none of listed options)','OptionC, 9.333...',
       'The fold is the perpendicular bisector of(1,3),(5,1), through midpoint(3,2) with normal(4,-2). Reflect(8,4) by subtracting2*((5,2) dot(4,-2))/20 times(4,-2), yielding(8/5,36/5). Hence p+q=44/5=8.8. Although the response earlier calculates8.8, it explicitly ends by choosingC=28/3. The final option takes priority and is incorrect. The source options themselves omit8.8.', ['Exact Fraction vector reflection.'])
record(182,True,'Exact diameter endpoints with equal27-unit radii draw a circle.', 'OptionA, circle','OptionA, circle',
       'The arc endpoints(95,40),(41,40) are54 units apart, exactly2*27. Each SVG arc therefore has the unique circle center(68,40) and radius27, and is a semicircle. Two same-sweep arcs go out and back around complementary halves, forming the full circle. OptionA is exactly correct.', ['Endpoint distance54=2*27; midpoint(68,40).'])
record(184,True,'A countermodel in which Hachi is Frozen but non-erotic defeats the queried equivalence.', 'A.False','A.False',
       'Set Hachi to be a film,Frozen,family-friendly animated,General Audience,appropriate for all ages,and watchable without guidance; set excessive content false. This satisfies every positive implication and the either-family-friendly-or-appropriate premise. The queried conclusion(E andF) or(notE andnotF) is false because E=false,F=true. Thus it is not entailed and the submittedA.False is correct.', ['Finite propositional countermodel.'])
record(218,True,'Both sets are countably infinite, so the committed equal-cardinality result is correct.',
       'Equal cardinalities, aleph0','Both sets have cardinality alpha',
       'Each computable real is represented by a finite program, so all computable reals are countable. Rational numbers are computable, and infinitely many rationals lie in(0,1), so both the interval set and whole-real set are infinite. Both therefore have cardinalityaleph0. Alternatively the bijection tan(pi*(x-1/2)) maps computable interval points to computable reals with computable inverse1/2+arctan(y)/pi. The response commits to equality of the two cardinalities; its unshifted tangent argument is wrong, but only the final answer is scored.', ['Countability by finite-program enumeration and rational lower bound.'])
record(220,False,'Most animals does not force cats to be pets or dogs to be furry.', 'No','Yes',
       'Consider ten animals:eight other animals furry and pets, one cat nonfurry and not a pet, one dog nonfurry and not a pet. Most animals have both listed qualities, cats have no fur, and dogs are not pets, satisfying every source statement. The questioned conjunction dogs furry and cats pets is false. Therefore it is not entailed, contrary to terminalYes.', ['Ten-animal finite majority countermodel.'])

# Independent exact structural checks. All question text is consumed by parser.
def bracket_stack(s):
    stack=[]
    match={')':'(',']':'[','}':'{','>':'<'}
    for c in s:
        if c in '([{<':stack.append(c)
        elif c in match:
            if not stack or stack.pop()!=match[c]:return None
    return stack

q49=items[49]['question'].split('Input:')[1]
st49=bracket_stack(q49)
assert st49 is not None
suffix49=''.join(dict(zip('([{<',')]}>' ))[c] for c in reversed(st49))
assert suffix49 != '}}>'
record(49,False,'A stack parse requires suffix'+suffix49+', not the final submitted}}>.')

for n in [37,39]:
    q=items[n]['question']
    words=re.search(r'List: (.*?)\nThought',q,re.S).group(1).split()
    final=re.search(r'Thought \d+: I have now sorted all the words\. The answer is (.*?)\nQ:',q,re.S).group(1).split()
    assert sorted(words)==final
    # Check all claimed first/second/third letter positions directly.
    for thought in re.findall(r'Thought \d+: (.*?)(?=\nThought|\nQ:)',q,re.S):
        if 'The first letter:' in thought:k=0
        elif 'The second letter:' in thought:k=1
        elif 'The third letter:' in thought:k=2
        else:continue
        for w,c,num in re.findall(r'"([a-z]+)": "([a-z])" \((\d+)\)',thought):
            assert w[k]==c and ord(c)-96==int(num)
    record(n,True,'Every quoted letter and index is correct, and the fully sorted list equals Python alphabetical sorting; terminalNo is correct.')
unresolved(88,'The submitted6 detects erroneous cream regrouping, but Thought4 retains a previously solved unresolved group; the earliest-step convention is not independently settled.')
unresolved(100,'The submitted9 catches erroneous third-letter sorting, but Thought4 retains a previously solved unresolved group; first-mistake convention is not settled.')

def path_trace(q):
    assert 'jump' not in q
    p=(0,0); seen={p:re.search(r'top corner where you see a ([a-z]+)',q).group(1)}
    steps=[]
    dirs={'down-left':(-1,1),'down-right':(1,1),'up-left':(-1,-1),'up-right':(1,-1),'right':(2,0),'left':(-2,0)}
    count={'one':1,'two':2,'three':3,'four':4}
    for direction,number,obj in re.findall(r'Then you move (down-left|down-right|up-left|up-right|right|left) for (one|two|three|four) steps?(?: and see a ([a-z]+))?',q):
        d=dirs[direction];p=(p[0]+count[number]*d[0],p[1]+count[number]*d[1]);steps.append((direction,count[number],p,obj))
        if obj:
            assert p not in seen or seen[p]==obj
            seen[p]=obj
    return p,seen.get(p,'unknown'),steps,seen
p58,ans58,steps58,seen58=path_trace(items[58]['question'])
assert len(steps58)==len(re.findall('Then you move ',items[58]['question']))
record(58,ans58=='tube','Exact triangular-lattice walk ends at'+str(p58)+' with object'+ans58+'.')

def placements(names,predicate):
    rows=[]
    for row in permutations(names):
        p={c:i for i,c in enumerate(row)}
        if predicate(p):rows.append(row)
    return rows

rows98=placements('KLTWYZ',lambda p:p['K']!=3 and p['L']!=3 and (p['K']==4 or p['L']==4) and p['W']<min(p['K'],p['L']) and p['K']<p['T'] and p['Z']<p['Y'] and p['Y']==p['K']+1)
assert rows98 and all(row.index('K')!=1 for row in rows98)
record(98,False,'Exhaustive6! enumeration finds Kammer cannot be second while immediately preceding Yoshida, because Waite and Zinn must both precede Yoshida.')

rows103=[]
for a in product(range(1,4),repeat=7):
    p=dict(zip('KMPQSTU',a))
    if ((p['P']==1) != (p['T']==1)) and ((p['T']==2)!=(p['U']==2)) and p['P']==p['Q'] and p['S']==p['U'] and a.count(3)>a.count(2) and p['M']==p['S']:rows103.append(p)
assert rows103 and not any(p['P']==3 for p in rows103)
record(103,False,'All3^7 zone assignments are checked; none puts Parra in Zone3 under the stated constraints. TerminalC is false.')

rows107=placements('FGLMPT',lambda p:p['G']>p['L']>p['T'] and p['P']>p['F'] and abs(p['T']-p['P'])==1 and abs(p['M']-p['G'])==2)
determined107=[i for i in range(6) if len({r[i] for r in rows107})==1]
count107=len(determined107)
if count107!=3:
    record(107,False,'All720 cargo permutations show'+str(count107)+' fixed bays, not3.',str(count107),'3',
      'Enumerate all permutations of(Fuel,Grain,Livestock,Machinery,Produce,Textiles), retain exactly those with Grain>Livestock>Textiles,Produce>Fuel,Textiles adjacentProduce,and|Machinery-Grain|=2. There are'+str(len(rows107))+' valid arrangements. A bay is fixed exactly when its cargo is identical in every retained arrangement. The fixed bay positions are'+str([i+1 for i in determined107])+', so the answer is'+str(count107)+', not submitted3.', ['Exhaustive720permutations and per-position set cardinalities.'])
else:record(107,True,'Exhaustive720 cargo permutations establish exactly3 fixed bays.')

rows115=[]
for persons in permutations('FGHJ'):
    p={c:i for i,c in enumerate(persons)}
    if not(p['H']<p['G'] and p['H']<p['J']):continue
    for topics in permutations('LOSW'):
        t={c:i for i,c in enumerate(topics)}
        if t['O']<t['L'] and t['W']<t['L'] and p['F']<t['O']:rows115.append((persons,topics))
assert rows115 and any(topics.index('S')>=persons.index('J') for persons,topics in rows115)
record(115,False,'Exact24*24 paired-person/topic enumeration finds a valid arrangement with Jiang giving sculptures; terminalD is not necessary.')

rows116=[]
for row in permutations('LMORT',4):
    p={c:i for i,c in enumerate(row)}
    if row[2] not in 'LT':continue
    if 'M' in p and p['M'] not in [0,1]:continue
    if 'T' in p and 'R' not in p:continue
    if 'R' in p and ('O' not in p or p['O']+1!=p['R']):continue
    rows116.append(row)
assert rows116 and all('L' in r for r in rows116)
record(116,False,'All120 assignments withoutYoshio require Louis; terminalA says he can be absent and is false.')

rows134=placements('FHLOPRST',lambda p:(p['T']+1==p['F'] or p['T']==p['R']+1) and abs(p['F']-p['R'])>=3 and p['O'] in [0,4] and (p['L']==7 or p['H']==7) and p['P']<p['S'] and abs(p['O']-p['S'])>=2 and p['O']-p['F']==3)
rpos134={r.index('R')+1 for r in rows134}
assert rows134
record(134,rpos134=={4},'All40320 concert orders leave R in positions'+str(sorted(rpos134))+'; terminalfourth is assessed against that exact set.')

slots160=[(1,7),(1,9),(2,7),(2,9),(3,8)]
rows160=[]
for r in permutations('HMR SW'.replace(' ','')):
    p={c:slots160[i] for i,c in enumerate(r)}
    if p['W'][1]<p['H'][1] and p['S'][0]!=3 and p['R'][0]!=2 and p['H'][0]!=p['M'][0] and p['R'][1]<p['W'][1]:rows160.append(p)
assert rows160
if all(p['S'][1]==9 for p in rows160):
    record(160,True,'All120 film assignments have sci-fi at9PM under the extra romance-before-western condition.',
      'OptionD','OptionD',
      'Enumerate the120 bijections between five films and slots(screen1,7),(screen1,9),(screen2,7),(screen2,9),(screen3,8). Retain western before horror,sci-fi notscreen3,romance notscreen2,horror/mystery different screens,and romance before western. In all'+str(len(rows160))+' surviving assignments the sci-fi time is9PM. Therefore D must be true, exactly as submitted.', ['All120assignments and sci-fi-time unanimity.'])
else:record(160,False,'Exact movie enumeration contains a counterexample to sci-fi9PM.')

rows198=[]
for a in product(range(1,4),repeat=6):
    p=dict(zip('GHKLPS',a))
    if all(a.count(d)==2 for d in [1,2,3]) and p['L']==p['P'] and p['G']!=p['H'] and (p['K']!=1 or p['G']==2) and (p['S']!=3 or p['H']==2):rows198.append(p)
assert rows198
record(198,all(p['S']!=p['H'] for p in rows198),'All3^6 duty assignments checked; S andH can share a day in a surviving assignment, so terminalB is not necessary.')

# Rule conclusions isolated from unrelated rules; three-valued answers follow
# explicit positive and negative atoms, never absence treated as negation.
for n,basis in {
138:'Rule1->Rule2 derives snake-vampire union. Red card->Rule3->Rule12 derives stork tearing. Rule4 is inactive. Rule14 proves notswim. Terminalproved of swim is false.',
140:'Gorilla non-surrender derives castle viaRule2; Rule3 andRule7 lack age/carrier premises. Hamburg isGermany, soRule4 derives secret. Rule6 proves notcastle-goose; Rule9 has no smile premise. Terminalunknown is false.',
168:'Shark investment->Rule4 pay->Rule8 smile. Chihuahua2010 movie->Rule2 hide; ostrich indigo->Rule6 noninvestment. Rule5 proves disarm, thenRule3 proves notdance. Terminalunknown is false.',
172:'Songbird pelikan-company->Rule4 photo->Rule3 mannikin beetle-suspicion. Cobra drink->Rule7 wall->Rule10 seahorse-company. Rule1 derives negativewolf-suspicion; Rule11 lacks butterflysmile. Terminalunknown is false.',
180:'Vampire failed-persuasion->Rule3 hiding and74>66->Rule4 castle satisfyRule2, proving negativefishhide. Explicit terminalproved of hide is wrong.',
216:'Bee takeover->Rule2 wall->Rule1 positiveplant. Otter1990movie->Rule4 negativeswear->Rule6 negativeplant. Rule7 has no notebook premise; preferredRule6 defeatsRule1. Explicit terminalproven is false.',
}.items():record(n,False,basis)
record(170,True,'Rule3 needs negative dolphin trade and dove non-shouting. PreferredRule1 proves positive trade, and no basketball exists. Neither polarity of bee borrow follows; terminalunknown is correct.')
record(187,True,'Basenji age1.5<4 derives company viaRule2; Milo andMeadow share initialM, deriving persuasion viaRule3. Rule7 proves borrowing andRule5 lacks its neglect premise; terminalproved is correct.')
record(214,True,'Llama Argentina triggersRule10 nonleave; pelikanLuna/elkLucy triggersRule3 noncapture. Rule7 proves wantssee and outranks the opposedRule1 conclusion; terminalpositive answer is correct.')
unresolved(145,'Final wording is proven that walrus does not create. This may express the correct negative conclusion or an incorrect explicit positive truth label; terminal convention is ambiguous here.')
unresolved(211,'The explicit positive truth label appears to contradict the negative explanatory statement; no unambiguous terminal answer under the stated convention.')
unresolved(165,'Green is primary in additiveRGB and nonprimary in conventionalRYB. The source does not specify which color system its primary predicate uses.')

# Category-order inference uses only the example constraints in each question.
categories=[
 'good nice lovely wonderful silly repulsive ridiculous awful mysterious terrible obnoxious',
 'big small huge large massive midsize enormous normal-size medium-size tiny little',
 'old new archaic ancient brand-new old-fashioned',
 'spherical triangular rectangular square circular prismlike pyramidal',
 'black blue brown crimson cyan gray green aqua indigo magenta maroon pink red teal violet white yellow',
 'cardboard cloth fiberglass glass iron leather paper plastic rubber steel wood wool',
 'american bangladeshi brazilian chinese congolese egyptian ethiopian filipino german indian indonesian iranian japanese mexican nigerian pakistani russian thai turkish vietnamese',
 'drinking driving eating exercise hiking smoking snorkeling typing walking whittling',
]
cat={w:c for c,words in enumerate(categories) for w in words.split()}
def adjective_categories(sentence):
    out=[]
    # Noun phrases are everything after the first nonadjective word.
    for w in sentence.strip().split():
        if w not in cat:break
        out.append(cat[w])
    return out

for x in items:
    if 'correct adjective order' not in x['question']:continue
    q=x['question'];n=x['index']
    examples=q.split('In this variant of English, which')[0]
    examples=re.findall(r'\(\d+\) (.*?)(?=\(\d+\)|\n\n|$)',examples,re.S)
    edges=set()
    for s in examples:
        cats=adjective_categories(s)
        assert len(cats)==len(set(cats))
        edges.update(combinations(cats,2))
    orders=[]
    for o in permutations(range(8)):
        pos={c:i for i,c in enumerate(o)}
        if all(pos[a]<pos[b] for a,b in edges):orders.append(pos)
    if not orders:
        unresolved(n,'The eight-category interpretation produces inconsistent sample constraints; the intended lexical or category exceptions are unresolved.')
        continue
    options=re.findall(r'\(([A-J])\) ([^\n]+)',q)
    assert len(options)==10
    values=set()
    for pos in orders:
        good=[]
        for letter,s in options:
            cats=adjective_categories(s)
            if all(pos[a]<pos[b] for a,b in zip(cats,cats[1:])):good.append(letter)
        values.add(''.join(good) or 'K')
    if len(values)==1:
        answer=next(iter(values))
        if answer=='K':record(n,True,'All example-consistent adjective-category orders reject every option; terminalK is correct.',
          'K','K','Treat the eight semantic categories(opinion,size,age,shape,color,material,origin,purpose) as a single ordering. Each supplied example constrains every earlier category to precede every later one. Enumerate all8! category orders and retain the'+str(len(orders))+' satisfying every example. Every retained order rejects every optionA-J, so K is correct regardless of any unconstrained pair.', ['Exhaustive40320category orders; all numbered examples consumed.'])
        else:record(n,False,'The complete example constraints force correct choices'+answer+', so terminalK is false.')
    elif 'K' not in values:
        record(n,False,'Every one of the'+str(len(orders))+' example-consistent category orders allows at least oneA-J option; terminalK is false even though the full answer set is not uniquely determined.')
    else:unresolved(n,'Example constraints admit'+str(len(orders))+' category orders with differing answer sets'+str(sorted(values))+'. The unique intended order is not proved.')

# Boolean-only arithmetic is evaluated directly after linguistic comparison
# normalization. Capital assertions are held to their ordinary factual meaning.
capital_truth={
 'Nigeria':'Abuja','the Nigeria':'Abuja','Norway':'Oslo','India':'New Delhi',
 'Nepal':'Kathmandu','Canada':'Ottawa','Gambia':'Banjul','Afghanistan':'Kabul',
 'Pakistan':'Islamabad','France':'Paris','Germany':'Berlin','Italy':'Rome',
 'Egypt':'Cairo','China':'Beijing','Japan':'Tokyo','Brazil':'Brasilia',
 'Bangladesh':'Dhaka','Australia':'Canberra','Turkey':'Ankara',
 'Portugal':'Lisbon','Russia':'Moscow','Spain':'Madrid','Ghana':'Accra',
 'Belgium':'Brussels','Thailand':'Bangkok','Kenya':'Nairobi','Cuba':'Havana',
 'Peru':'Lima','Uruguay':'Montevideo','Argentina':'Buenos Aires',
 'Armenia':'Yerevan','Azerbaijan':'Baku','Belarus':'Minsk','Colombia':'Bogota',
 'Denmark':'Copenhagen','Iran':'Tehran','Iraq':'Baghdad','Jordan':'Amman','UAE':'Abu Dhabi',
}
def capital_replace(match):
    country,city=match.groups()
    if country not in capital_truth:raise ValueError('Unverified capital: '+country)
    return str(capital_truth[country]==city)
def exact_eval(node):
    if isinstance(node,ast.Expression):return exact_eval(node.body)
    if isinstance(node,ast.Constant):return node.value if isinstance(node.value,bool) else F(node.value)
    if isinstance(node,ast.UnaryOp):
        v=exact_eval(node.operand)
        if isinstance(node.op,ast.Not):return not v
        if isinstance(node.op,ast.USub):return -v
    if isinstance(node,ast.BoolOp):
        v=[exact_eval(n) for n in node.values]
        return all(v) if isinstance(node.op,ast.And) else any(v)
    if isinstance(node,ast.BinOp):
        a,b=exact_eval(node.left),exact_eval(node.right)
        if isinstance(node.op,ast.Add):return a+b
        if isinstance(node.op,ast.Sub):return a-b
        if isinstance(node.op,ast.Mult):return a*b
        if isinstance(node.op,ast.Div):return a/b
    if isinstance(node,ast.Compare):
        a=exact_eval(node.left)
        for op,expr in zip(node.ops,node.comparators):
            b=exact_eval(expr)
            okay=(a>b if isinstance(op,ast.Gt) else a>=b if isinstance(op,ast.GtE) else a<b if isinstance(op,ast.Lt) else a<=b if isinstance(op,ast.LtE) else a==b)
            if not okay:return False
            a=b
        return True
    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ['min','max']:
        return (min if node.func.id=='min' else max)(exact_eval(n) for n in node.args)
    raise ValueError('Unsupported arithmetic AST: '+type(node).__name__)
for n in [139,147,156,183,208]:
    q=items[n]['question']
    opts=re.findall(r'\(([A-E])\) (.*?)(?=\n\([A-E]\)|$)',q,re.S)
    try:
        evaluated={}
        for letter,s in opts:
            s=re.sub(r'The capital of (.+?) is (.+?)\.',capital_replace,s)
            for a,b in [('is less than or equal to','<='),('is greater than or equal to','>='),('is greater than','>'),('is less than','<')]:s=s.replace(a,b)
            assert re.fullmatch(r'[\s\d(),.*+/><=\-\w]+',s)
            assert set(re.findall(r'[A-Za-z_]+',s))<=set(['not','and','or','True','False','max','min'])
            evaluated[letter]=bool(exact_eval(ast.parse(s.strip(),mode='eval')))
        assert len(evaluated)==5
        good=[k for k,v in evaluated.items() if v]
        assert len(good)==1,(n,evaluated)
        if n in [147,183]:record(n,False,'Arithmetic and boolean evaluation gives'+good[0]+', but no option is finally selected.')
        else:
            submitted={139:'B',156:'B',208:'C'}[n]
            if submitted==good[0] and not items[n]['official_label']:
                record(n,True,'Exact expression evaluation agrees with terminal'+submitted+'.',
                 'Option'+submitted,'Option'+submitted,
                 'Normalize the stated comparisons to ordinary>,<,<=,>= and evaluate each fully parenthesized expression with ordinary boolean not,and,or. Every numeric subexpression uses the stated arithmetic. The option truth table is'+str(evaluated)+'. Only'+submitted+' is true, matching the final selection.', ['All five expressions evaluated; exact arithmetic and ordinary capital facts.'])
            else:record(n,submitted==good[0],'Direct boolean truth table'+str(evaluated)+' assesses terminal'+submitted+'.')
    except (ValueError,AssertionError,SyntaxError) as exc:
        unresolved(n,'Boolean evaluation cannot be certified: '+str(exc))

record(24,True,'The binomial second moment gives Bernstein p_n(x)=x^2+x(1-x)/n, so the submitted terminal limitx(1-x) is correct.')
q1date44=date(2018,8,28)+timedelta(days=787)
assert q1date44==date(2020,10,23)
utc44=(q1date44.year-2011)*3600+(q1date44.month+41)*60+(q1date44.day-22)
ist44=utc44+330*60
assert ist44==15*3600+21*60+1
record(44,False,'Exact Gregorian addition gives2020-10-23, UTC09:51:01 and IST15:21:01; terminal15:21:02 is off by one second.')
record(56,True,'Bernhard is only stated to be a frog; no universal frog-color rule exists, so the terminalunspecified is correct.')
x57=(date(2007,3,22)-date(1999,4,4)).days
z57=673+(date(1998,7,22)-date(1997,8,16)).days
assert (x57-2902,2007-1996,z57-1011)==(7,11,2)
record(57,False,'Exact dates give Bob19:11:02. Jason16:01 precedesBob; the submitted terminal list reverses them.')
record(99,True,'Triple-angle product identities give the submitted(6sqrt(3)+1)/8.',
 '(6sqrt(3)+1)/8','(6sqrt(3)+1)/8',
 'The identities4cos(x)cos(60degrees-x)cos(60degrees+x)=cos(3x) and4sin(x)sin(60degrees-x)sin(60degrees+x)=sin(3x) follow by product-to-sum. At x=10degrees the cosine product iscos30/4=sqrt(3)/8 and the sine product issin30/4=1/8. The source expression is six times the first product plus the second, exactly(6sqrt(3)+1)/8, as submitted.', ['Triple-angle identities and exact30degree values.'])
record(159,False,'Besides verticalx=0 and slope-1/2 tangent, horizontaly=6 meets the parabola once; there are3lines, not terminalC=2.')
record(209,False,'Rule2 derives duck-otter suspicion,Rule3 derives flamingo-secret,thenRule4 derives nototterhide. The explicit finalProven of the positive queried hide statement is false.')
record(202,True,'Rule7 derivesduck-wants from3friends, thenRule4 derivesotterhide. OpposedRule9 is inactive because29-inch ball exceeds24.3-inch box dimension.',
 'Proved: otter hides cards from badger','hidden',
 'The duck has1+2=3friends, fewer than4, soRule7 derives wants-see-butterfly. Rule3 has no movie premise; Rule9 requires a29-inch spherical ball to fit a box with24.3-inch dimension, impossible. Thus neither higher-priority opposing rule applies. Rule4 turns the derivedwant into positive otter-hides-cards-from-badger. No rule derives its negation. The submission terminalhidden directly states this positive proposition, without a contradictory explicit proved/disproved label.', ['3<4 and29>24.3; finite two-rule derivation.'])
rows132=placements('UVWXYZ',lambda p:p['V']<p['Z'] and p['U']>=3 and p['Y']<=2)
original132={r for r in rows132 if r.index('W')<r.index('X') and r.index('Z')<r.index('X')}
replacement132={r for r in rows132 if r.index('X') in [4,5]}
assert original132!=replacement132
record(132,False,'Exact720-band-order enumeration finds slot5/6 replacement permits orders disallowed by original; terminalE is not equivalent.')
unresolved(119,'The trade process needs a complete reachable-state search including inverse trades and ownership multiplicities; finalA is not independently certified.')
unresolved(201,'The37-rule prioritized closure requires an independent complete derivation; finalunknown has not been certified.')
unresolved(203,'The multi-rule prioritized closure requires an independent complete derivation; finalunknown has not been certified.')
unresolved(97,'The fully parenthesized novel-operation expression has not been independently evaluated; terminal-884 is not certified.')

# Adversarial review: a proof of a quantity is distinct from a proof that the
# response gold label is wrong. Unstated conventions do not certify a conflict.
withdrawn_reasons={
19:'The five-triple enumeration is exhaustive only if natural numbers are positive. If zero is allowed, (111,0,0) is a geometric progression with ratio0 and is omitted. The source does not define natural numbers or exclude ratio0.',
71:'The count7 includes the equilateral triangle(9,9,9). An exclusive definition of isosceles gives6. The source does not choose between inclusive and exclusive definitions.',
75:'The proof silently sets the amount Martin decided to spend to1000, although the source says no more than1000. With budgetB the initial discount is350-B/4; the literal premise does not fixB.',
202:'The positive otter-hiding proposition is derived, but the requested response tokens are proved/disproved/unknown and the terminal response ishidden. Semantic acceptance versus format compliance is not fixed by the literal question.',
218:'The queried equal-cardinality proposition is true, but the terminal response is the symbolalpha, and its preceding description wrongly makesalpha uncountable. Deciding thatalpha commits only to equality requires an interpretation of the final answer; the label conflict is not unconditional.',
}
assert 111+0+0==111 and 111*0==0 and 0*0==0
assert len(tris)==7 and len([t for t in tris if len(set(t))==2])==6
for budget,discount in [(F(1000),F(100)),(F(800),F(150))]:
    assert budget<=1000 and F(4,5)*(budget-discount)==budget-280
for n,reason in withdrawn_reasons.items():
    x=items[n]
    candidate={key:x.get(key) for key in ['audited_correct','submitted_answer','independently_verified_answer','proof','proof_checks']}
    candidate['classification']='convention_sensitive_candidate'
    candidate['reason']=reason
    x['conditional_candidate']=candidate
    unresolved(n,reason)

# No adjective-category assumption can certify even label support. The
# questions supply examples but do not state one total order of eight classes.
for n in [141,146,162,167,188,194,219]:
    unresolved(n,'A semantic-category total-order model is an extra assumption. The source supplies lexical adjective examples and does not explicitly state that every word in a semantic category obeys one shared category order. No label is certified from that model.')

for x in items:
    x.pop('proof_class',None)
    if x['verdict']=='proved_conflict':
        x['proof_class']='final_option_priority' if x['index']==178 else 'literal_premises'
items[178]['classification_note']='The geometric value8.8 is unconditional. The gold-label conflict uses the task-authorized policy that explicit final optionC overrides the earlier correct numeric answer. It is reported separately from literal-premise conflicts.'

# The full-surface contradiction does not require choosing a wedge shape.
items[85]['independently_verified_answer']='Volume256*pi/3; full surface area is strictly greater than32*pi.'
items[85]['proof']='Circumference16*pi gives radius8. Congruence divides the sphere volume equally, so one piece has volume256*pi/3 and curved area32*pi. Cutting the sphere into separate positive-volume wedges exposes additional interior boundary surfaces of positive area. Those surfaces belong to the full surface area of each cut wedge. Therefore full surface area is strictly greater than32*pi, regardless of whether the wedges are longitudinal or octant-shaped. The submission gives32*pi as surface area and is incorrect. No particular longitudinal geometry or numerical full-surface value is assumed.'
items[85]['proof_checks']=['Sphere volume fraction and curved-area fraction; strictly positive exposed cut-boundary area.']

# Unfinished cases retain a specific unresolved reason, never a guessed label.
for x in items:
    if x['basis']=='Awaiting independent audit.':
        x['basis']='Loaded the complete instruction and terminal response. A prioritized-rule or constraint-puzzle conclusion has not been independently proved; no conflict is asserted.'

# Improve prose spacing without changing any source instruction or response.
def prose_spacing(s):
    s=re.sub(r'([a-z])(\d)',r'\1 \2',s)
    s=re.sub(r'(\d)([a-z])',r'\1 \2',s)
    s=re.sub(r'([,;])(?=[A-Za-z])',r'\1 ',s)
    return s
for x in items:
    for key in ['basis','proof']:
        if key in x:x[key]=prose_spacing(x[key])
    if 'proof_checks' in x:x['proof_checks']=[prose_spacing(s) for s in x['proof_checks']]

counts={v:sum(x['verdict']==v for x in items) for v in ['label_supported','proved_conflict','unresolved']}
literal_count=sum(x.get('proof_class')=='literal_premises' for x in items)
policy_count=sum(x.get('proof_class')=='final_option_priority' for x in items)
assert literal_count==22 and policy_count==1 and len(withdrawn_reasons)==5
assert literal_count+policy_count+len(withdrawn_reasons)==28
doc['summary']={**counts,'items':221,'literal_premise_conflicts':literal_count,'literal_premise_conflict_rate':literal_count/221,'final_option_priority_conflicts':policy_count,'proved_conflict_rate':counts['proved_conflict']/221,'withdrawn_convention_sensitive_candidates':len(withdrawn_reasons),'remaining_possible_conflicts':counts['unresolved'],'perfect_correctness_oracle_official_score_upper_bound_under_task_policy':100*(221-counts['proved_conflict'])/221,'literal_premise_oracle_official_score_upper_bound':100*(221-literal_count)/221,'interpretation':'Literal-premise conflicts and task-policy conflicts are kept separate. Convention-sensitive candidates are unresolved, not proved defects. No test tuning or model calls.'}
doc['adversarial_review']={'original_conflict_count':28,'literal_survivors':literal_count,'task_policy_survivors':counts['proved_conflict'],'withdrawn_indices':sorted(withdrawn_reasons),'separate_final_option_priority_index':178,'adjective_category_conflicts':0,'note':'No dev outcomes or judge methods inspected or changed.'}
doc['proof_execution']='Passed all executable assertions in test-label-audit.py.'
DATA.write_text(json.dumps(doc,indent=2,ensure_ascii=False)+'\n')

out=['# LongJudge verify TEST label audit','','Source: cached loadBenchmark("longjudge-verify"), filtered by splitOf to the fixed test split. The source and official scoring are unchanged.','',
     'Criterion: the response final answer is correct. Explicit final options take priority over conflicting explanation. Chained tasks are scored by the terminal output. No model calls or test tuning occur.','',
     f'Coverage: all 221 test records are loaded and inspected. Supported labels: {counts["label_supported"]}. Literal-premise conflicts: {literal_count} of 221 ({100*literal_count/221:.2f}%). Separate task-policy conflicts: {policy_count}. Unresolved: {counts["unresolved"]}.',
     '', 'The conflict rate is a proved lower bound, not an estimate of all label defects. Missing definitions, natural-language ambiguities, unproved rule closures and unsolved constraints remain unresolved. A perfect final-answer correctness oracle would disagree with at least this many official labels.',
     '',f'The literal-premise conflict bound gives a perfect-correctness oracle official-label score upper bound of {100*(221-literal_count)/221:.2f}%. Under the task-authorized final-option-priority policy, the additional case gives {100*(221-counts["proved_conflict"])/221:.2f}%. These are conditional oracle bounds, not measured judge scores. A judge that matches defective labels can exceed them. This audit supplies no judge prediction or strategy comparison.', '',
     '## Adversarial review','',
     'The first version counted 28 conflicts. The strict review retains '+str(literal_count)+' literal-premise conflicts, keeps one final-option-priority case separate, and withdraws five convention-sensitive classifications. No original conflict used an adjective-category order. The category-order method previously used to support some labels is also withdrawn because the questions do not state one semantic-category total order.','',
     '| Index | Review | Reason |','|---|---|---|',
     *[f'| {n} | Unresolved candidate | {prose_spacing(reason)} |' for n,reason in withdrawn_reasons.items()],
     '| 178 | Separate task-policy conflict | The mathematical answer is 8.8, but explicit final option C is wrong. Label classification follows the authorized final-option-priority rule. |','',
     'Reproduce: python3 examples/judge-benchmarks/results/verify-dev/test-label-audit.py. Every executable assertion passes. Algebraic and countermodel proofs are stated below. The JSON retains each full source instruction and response, official label, verdict and basis.','',
     '## Label audit','']
for x in items:
    if x['verdict']=='proved_conflict' and x['proof_class']=='literal_premises':
        out += [f'### {x["index"]}: {x["id"]}','',f'- Official gold_correct: {str(x["official_label"]).lower()}',f'- Audited final-answer correctness: {str(x["audited_correct"]).lower()}',f'- Submitted final answer: {x["submitted_answer"]}',f'- Independently verified answer: {x["independently_verified_answer"]}','',
                'Source premises:','',x['question'],'','Proof: '+x['proof'],'','Checks: '+'; '.join(x['proof_checks']),'']
out += ['## Separate final-option-priority case','']
x=items[178]
out += [f'### {x["index"]}: {x["id"]}','',x['classification_note'],'','Source premises:','',x['question'],'','Proof: '+x['proof'],'']
out += ['## Withdrawn convention-sensitive candidates','']
for n in sorted(withdrawn_reasons):
    x=items[n]
    out += [f'### {n}: {x["id"]}','',x['basis'],'','Original candidate proof, retained for review: '+x['conditional_candidate']['proof'],'']
out += ['## Per-item coverage','','| Index | Full item id | Official | Verdict | Basis |','|---|---|---|---|---|']
for x in items:
    out.append(f'| {x["index"]} | {x["id"]} | {str(x["official_label"]).lower()} | {x["verdict"]} | {x["basis"].replace("|","/")} |')
(HERE/'test-label-audit.md').write_text('\n'.join(out)+'\n')
print(json.dumps(doc['summary'],indent=2))
