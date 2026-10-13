"""Independent arithmetic and geometry evidence. Reads no labels or judge outcomes."""
import cmath, itertools, json, math
from fractions import Fraction as F
from pathlib import Path
root=Path('examples/judge-benchmarks/jb-results'); rows={}
def add(index,answer,details):rows[str(index)]={'answer':str(answer),'details':details}
# Two equally optimal uniquely-decodable mixed alphabet codes. Ternary symbols delimit words.
prob=[F(x,69) for x in [16,15,12,10,8,8]]
codes=[['7','8','9','70','80','90'],['7','8','9','71','81','91']]
for code in codes:
 assert all(c[0] in '789' and set(c[1:])<=set('01') for c in code)
 assert len(set(code))==6
 strings=set()
 for words in itertools.product(code,repeat=4):
  joined=''.join(words);assert joined not in strings;strings.add(joined)
expected=sum(p*len(c) for p,c in zip(prob,codes[0]));assert expected==F(95,69)
add(15,expected,{'both_code_expected_lengths':[str(sum(p*len(c) for p,c in zip(prob,code))) for code in codes],
               'lower_bound':'At most three one-symbol words; assign them the largest probabilities. All others need at least two symbols.',
               'unique_decoding':'Each word has exactly one 7/8/9 at its beginning, so those delimit every concatenation.'})
add(16,'Both B and D are false under standard finite precision',{'subtraction_not_commutative':[4.0-2.0,2.0-4.0],
  'round_to_nearest_not_associative':[(1e16-1e16)+1,1e16+(-1e16+1)]})
add(56,F(1)+0.5*math.log(2*math.pi),{'formula':'0.5*ln(2*pi)+0.5*E[(X-1)^2], X~N(0,1); E[(X-1)^2]=2',
 'candidate_finals':[1.4,1.1],'closest_listed_option':1.8,'neither_candidate_final_is_correct':True})
add(74,'Printed option exponents are inconsistent with physical energy',{'interpreting_separation_as_1e-10m':{
 'electric_work_J':8.9875517923e9*(1.602176634e-19)**2*(1/1e-10-1/5e-10),
 'gravitational_work_J':6.67430e-11*9.1093837e-31*1.6726219e-27*(1/1e-10-1/5e-10)},
 'question_issue':'The exponent minus is encoded as a rule, while options print positive 10^58 and 10^18. The intended negative-exponent result cannot equal any literal printed option.'})
# First circular-aperture secondary maximum: find zero of J2 in (5,6), evaluate (2J1/x)^2.
def bessel(n,x):
 total=0.0
 for k in range(70):
  term=(-1)**k*(x/2)**(2*k+n)/(math.factorial(k)*math.factorial(k+n));total+=term
  if abs(term)<1e-18:break
 return total
lo,hi=5.0,6.0
for _ in range(70):
 mid=(lo+hi)/2
 if bessel(2,lo)*bessel(2,mid)<=0:hi=mid
 else:lo=mid
u=(lo+hi)/2;intensity=(2*bessel(1,u)/u)**2
assert abs(intensity-.017497862)<1e-8
add(79,intensity,{'first_secondary_maximum_u':u,'smallest_printed_option':.125,'no_printed_option_matches':True,
 'qualification':'Interpreting the nonstandard word diagonal as the first secondary maximum of the stated circular aperture.'})
sgen=4.5*math.log(850*850/(1300*400))
add(84,'Requires a missing ambient temperature T0',{'entropy_generated_kJ_per_K':sgen,'lost_work_at_298K_kJ':298*sgen,
 'ambient_for_441_1kJ':441.1/sgen,'ambient_for_505_5kJ':505.5/sgen,'relation':'Irreversibility=T0*Sgen; no T0 is stated.'})
add(96,'2/(2x+1)=1/(x+1/2)',{'exact_checks':all(F(2)/(2*x+1)==F(1)/(x+F(1,2)) for x in [-3,-2,-1]),
 'qualification':'Both use the same natural-log convention. The functions are algebraically equal throughout the real log domain x<-1/2.'})
add(98,45,{'tangent_of_angle':str((F(2)-F(1,3))/(1+F(2)*F(1,3))),'format_difference':'C repeated five versus six times'})
add(99,27,{'meeting_hours':str(F(45,30)),'distance_from_A':str(18*F(45,30)),'format_difference':'E repeated five versus seven times'})
vals={(7*n+12)//(2*n+3) for n in range(-100,101) if (7*n+12)%(2*n+3)==0}
assert vals=={2,3,4,5};add(100,14,{'values':sorted(vals),'complete_bound':'2v=7+3/(2n+3), so the odd denominator divides3.',
 'format_issue':'One answer gives a boxed value; the other repeats E eight times. Both factual finals equal14.'})
add(102,'5*(x-4/5)^2-96/5',{'decimal_constant':str(F('-19.2')),'equal_forms':F('-19.2')==F(-96,5)})
add(107,8,{'legendre_terms':[50//7,50//49],'format_difference':'E repeated five versus six times'})
def padd(a,b):
 out=[F(0)]*max(len(a),len(b))
 for i,x in enumerate(a):out[i]+=x
 for i,x in enumerate(b):out[i]+=x
 return out
def pmul(a,b):
 out=[F(0)]*(len(a)+len(b)-1)
 for i,x in enumerate(a):
  for j,y in enumerate(b):out[i+j]+=x*y
 return out
def charpoly(m):
 n=len(m);result=[F(0)]*(n+1)
 for perm in itertools.permutations(range(n)):
  inversions=sum(perm[i]>perm[j] for i in range(n) for j in range(i+1,n));term=[F((-1)**inversions)]
  for i,j in enumerate(perm):term=pmul(term,[-F(m[i][j]),F(int(i==j))])
  result=padd(result,term)
 return result
coef=charpoly([[-4,-13,10],[-9,10,4],[12,-5,-14]])
assert coef==[F(-744),F(-341),F(8),F(1)]
add(114,'Both opposite-sign characteristic polynomial conventions have the same roots',{
 'det_lambdaI_minus_A_coefficients_ascending':list(map(str,coef)),
 'det_A_minus_lambdaI_coefficients_ascending':list(map(str,[-x for x in coef]))})
add(116,F(1,3)-F(333,1000),{'format_difference':'C repeated six versus five times'})
count=0
for mask in range(1,1<<13):
 subset=[i for i in range(13) if mask>>i&1]
 if len(subset)==min(subset):count+=1
assert count==144;add(113,count,{'exhaustive_nonempty_subsets':(1<<13)-1,'both_final_values':144})
positive=sum(math.prod((x-k)**k for k in range(1,11))>0 for x in [-.5,*[k+.5 for k in range(1,11)]])
assert positive==6;add(122,positive,{'one_representative_per_open_interval':11,'both_final_counts':6})
add(123,'Identical derivatives',{'expression':'-2-(17/2)*sec^2(9/2-17x/2)','chain_rule_multiplier':str(F(-17,2))})
a,b=math.log(7),math.log(289);c=math.log(2023);assert abs(c-a-b)<1e-12
t=math.sqrt(c*c-a*b)
for r in [-t,t]:assert abs(c*c/((a+r)*(b+r))-c/(c+r))<1e-10
add(127,1,{'log_x_roots':[-t,t],'product_x_roots':math.exp(-t)*math.exp(t),'relation':'t^2=c^2-ab, c=a+b; sum log roots iszero.'})
add(128,F(65,100)*2500,{'width_cm':.65,'length_cm':2500,'format_difference':'C repeated six versus five times'})
add(131,F(9,4),{'diagonal_squared':str(F(13,4)**2-2*F(11,4)),'both_factual_finals':'9/4'})
add(133,'15*sqrt(3)',{'sides':[6,10,14],'cosine_of_largest_angle':str((F(36)+100-196)/120),
 'format_difference':'E repeated five versus eight times'})
success=sum(any(sum(seq[:i])==3 for i in range(1,5)) for seq in itertools.product(range(1,7),repeat=4))
assert F(success,6**4)==F(49,216);add(135,F(success,6**4),{'enumerated_die_sequences':6**4,'successes':success})
add(136,16,{'roots':[6,10],'substitution_checks':[2*d*d==(12-d)**2+(2*d-6)**2 for d in [6,10]],
 'format_difference':'E repeated six versus four times'})
# Convex polygon cuts, preserving all positive-area pieces and checking conserved area.
def area(poly):return abs(sum(poly[i][0]*poly[(i+1)%len(poly)][1]-poly[i][1]*poly[(i+1)%len(poly)][0] for i in range(len(poly)))/2)
def clean(poly):
 out=[]
 for p in poly:
  if not out or math.dist(out[-1],p)>1e-9:out.append(p)
 if len(out)>1 and math.dist(out[0],out[-1])<1e-9:out.pop()
 changed=True
 while changed and len(out)>2:
  changed=False
  for i,p in enumerate(out):
   a,b=out[i-1],out[(i+1)%len(out)]
   if abs((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))<1e-9:out.pop(i);changed=True;break
 return out
 def_unused=None

def clip(poly,a,b,sign):
 def distance(p):return sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))
 out=[]
 for i,p in enumerate(poly):
  q=poly[(i+1)%len(poly)];d,e=distance(p),distance(q)
  if d>=-1e-10:out.append(p)
  if (d>1e-10 and e<-1e-10) or (d<-1e-10 and e>1e-10):
   t=d/(d-e);out.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
 return clean(out)
def cuts(polys,lines):
 initial=sum(area(p) for p in polys)
 for a,b in lines:
  polys=[p for poly in polys for sign in [-1,1] if len(p:=clip(poly,a,b,sign))>=3 and area(p)>1e-9]
  assert math.isclose(sum(area(p) for p in polys),initial,abs_tol=1e-8)
 return {'pieces':len(polys),'triangles':sum(len(p)==3 for p in polys),'vertex_counts':list(map(len,polys)),'area_conserved':True}
square=[(0,0),(1,0),(1,1),(0,1)];A,B,C,D=square;E=(.5,-math.sqrt(3)/2);Fv,G=A,B
for index,line_names in [(153,[('E','D'),('F','C')]),(160,[('E','D'),('D','G')]),(193,[('E','C'),('E','D')])]:
 points={'A':A,'B':B,'C':C,'D':D,'E':E,'F':Fv,'G':G}
 result=cuts([square,[E,Fv,G]],[(points[a],points[b]) for a,b in line_names]);add(index,result['triangles'] if index==153 else result['pieces'],result)
result=cuts([[(0,0),(1,0),(.5,math.sqrt(3)/2)],[(0,0),(1,0),(.5,-math.sqrt(3)/2)]],[((.5,math.sqrt(3)/2),(.5,-math.sqrt(3)/2))]);assert result['pieces']==4;add(149,4,result)
for index,n,line_names in [(145,7,[('A','C'),('A','D'),('A','E')]),(186,5,[('A','C'),('B','D')]),(187,7,[('A','D'),('A','E'),('B','G')])]:
 points={chr(65+i):(math.cos(2*math.pi*i/n),math.sin(2*math.pi*i/n)) for i in range(n)}
 result=cuts([list(points.values())],[(points[a],points[b]) for a,b in line_names]);add(index,result['vertex_counts'].count(4) if index==145 else result['triangles'],result)
add(181,'square pyramid',{'base_centers':[[x,y,5] for x,y in [(-5,-5),(-5,5),(5,5),(5,-5)]],
 'apex_center':[0,0,5+math.sqrt(31)],'tangent_center_distance':9,'all_four_tangencies':math.isclose(math.sqrt(50+31),9)})
(root/'test-arithmetic-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps(rows,indent=2))
