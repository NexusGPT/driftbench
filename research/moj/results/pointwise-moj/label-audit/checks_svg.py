"""Label-blind SVG geometry audit. Run directly to reproduce audit_svg.json.

Enumerates every simple cycle in the planar line arrangement, removes collinear
subdivisions, and classifies polygons. Tolerance is varied from 0.00002 to
0.00010 coordinates (2 to 10 last-place units). It reports both common readings
of 'no diagonals': no straight vertex-to-vertex diagonal, and no interior ink.
Agreement is provisional robustness evidence, not a universal proof over all
independent coordinate perturbations admitted by rounding. No result from this
floating-point reconstruction is eligible for a label correction.
The code never opens labels, reference answers, model recordings or the network.
"""
import json
import math
import re
from pathlib import Path

INDICES = [3, 15, 24, 26, 38, 39, 57]
HERE = Path(__file__).resolve().parent

def sub(a, b): return (a[0]-b[0], a[1]-b[1])
def add(a, b): return (a[0]+b[0], a[1]+b[1])
def mul(a, t): return (a[0]*t, a[1]*t)
def dot(a, b): return a[0]*b[0]+a[1]*b[1]
def cross(a, b): return a[0]*b[1]-a[1]*b[0]
def norm(a): return math.hypot(*a)
def dist(a,b): return norm(sub(a,b))
def on(p,a,b,eps):
    v=sub(b,a)
    return abs(cross(v,sub(p,a))) <= eps*norm(v) and dot(sub(p,a),v)>=-eps*norm(v) and dot(sub(p,b),v)<=eps*norm(v)

def parse(question):
    raw=question.split('path element:',1)[1].split('Out of the following',1)[0]
    toks=re.findall(r'([ML])\s*(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)',raw)
    segments=[]
    for op,x,y in toks:
        p=(float(x),float(y))
        if op=='L': segments.append((prev,p))
        prev=p
    return segments

def planar(segments,eps):
    """Split all segments at endpoints and proper intersections; merge overlaps."""
    points=[p for s in segments for p in s]
    for a,b in segments:
        u=sub(b,a)
        for c,d in segments:
            v=sub(d,c); den=cross(u,v)
            if abs(den)<eps*min(norm(u),norm(v)): continue
            t=cross(sub(c,a),v)/den; w=cross(sub(c,a),u)/den
            if -eps/norm(u)<=t<=1+eps/norm(u) and -eps/norm(v)<=w<=1+eps/norm(v):
                points.append(add(a,mul(u,t)))
    unique=[]
    for p in points:
        if not any(dist(p,q)<eps for q in unique): unique.append(p)
    edges=set()
    for a,b in segments:
        inds=sorted((j for j,p in enumerate(unique) if on(p,a,b,eps)),key=lambda j:dot(sub(unique[j],a),sub(b,a)))
        edges.update(tuple(sorted((u,v))) for u,v in zip(inds,inds[1:]) if u!=v)
    # Degree-two collinear vertices cannot change the family of polygon cycles.
    active=set(range(len(unique)))
    changed=True
    while changed:
        changed=False
        for i in sorted(active):
            nbr=[v if u==i else u for u,v in edges if i in (u,v)]
            if len(nbr)==2 and on(unique[i],unique[nbr[0]],unique[nbr[1]],eps):
                edges.discard(tuple(sorted((i,nbr[0]))));edges.discard(tuple(sorted((i,nbr[1]))))
                edges.add(tuple(sorted(nbr)));active.remove(i);changed=True;break
    return unique,edges

def cycles(points,edges):
    adj={}
    for u,v in edges: adj.setdefault(u,set()).add(v);adj.setdefault(v,set()).add(u)
    found=[]
    for start in sorted(adj):
        def walk(path):
            here=path[-1]
            for nxt in sorted(adj[here]):
                if nxt==start and len(path)>=3:
                    if path[1]<path[-1]: found.append([points[i] for i in path])
                elif nxt>start and nxt not in path:
                    walk(path+[nxt])
        walk([start])
    assert len(found)<100000, 'exhaustive cycle count exceeded audit limit'
    return found

def simplify(poly,eps):
    p=poly[:]
    changed=True
    while changed and len(p)>3:
        changed=False
        for i in range(len(p)):
            if on(p[i],p[i-1],p[(i+1)%len(p)],eps):
                p.pop(i);changed=True;break
    return p

def inside(p,poly,eps):
    if any(on(p,a,b,eps) for a,b in zip(poly,poly[1:]+poly[:1])): return False
    crossings=0
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>p[1]) != (b[1]>p[1]):
            x=a[0]+(p[1]-a[1])*(b[0]-a[0])/(b[1]-a[1])
            crossings += p[0]<x
    return bool(crossings%2)

def covered(a,b,segments,eps):
    """Whether the full straight a-b interval is inked, with no missing span."""
    v=sub(b,a);ll=dot(v,v);spans=[]
    for c,d in segments:
        if abs(cross(v,sub(c,a)))<=eps*norm(v) and abs(cross(v,sub(d,a)))<=eps*norm(v):
            spans.append(sorted((dot(sub(c,a),v)/ll,dot(sub(d,a),v)/ll)))
    end=0
    for lo,hi in sorted(spans):
        if lo>end+eps/norm(v): break
        end=max(end,hi)
    return end>=1-eps/norm(v)

def classify(poly,segments,edges_points,eps,semantics):
    p=simplify(poly,eps);n=len(p)
    area=abs(sum(cross(a,b) for a,b in zip(p,p[1:]+p[:1])))/2
    if area<eps: return None,p
    sides=[sub(p[(i+1)%n],p[i]) for i in range(n)]
    lengths=[norm(v) for v in sides]
    # A normalized angular tolerance derives from endpoint rounding and shortest side.
    at=8*eps/min(lengths)
    def parallel(v,w): return abs(cross(v,w))<=at*norm(v)*norm(w)
    def right(v,w): return abs(dot(v,w))<=at*norm(v)*norm(w)
    turns=[cross(sides[i-1],sides[i]) for i in range(n)]
    convex=all(t>0 for t in turns) or all(t<0 for t in turns)
    if n==3: return (4 if any(right(sides[i-1],sides[i]) for i in range(n)) else 3),p
    if semantics=='empty_interior':
        if any(inside(mul(add(a,b),.5),p,eps) for a,b in edges_points): return None,p
    else:
        for i in range(n):
            for j in range(i+2,n):
                if i==0 and j==n-1: continue
                # A concave polygon's external vertex connection is not a diagonal.
                if inside(mul(add(p[i],p[j]),.5),p,eps) and covered(p[i],p[j],segments,eps): return None,p
    if n==4 and convex:
        pairs=sum(parallel(sides[i],sides[i+2]) for i in range(2))
        if pairs==2:
            if all(right(sides[i-1],sides[i]) for i in range(4)):
                return (2 if max(lengths)-min(lengths)<8*eps else 1),p
            return 5,p
        if pairs==1: return 6,p
    if n==5:
        angles=[dot(sides[i-1],sides[i])/(lengths[i-1]*lengths[i]) for i in range(n)]
        regular=convex and max(lengths)-min(lengths)<8*eps and max(angles)-min(angles)<at
        return (9 if regular else 7 if convex else 8),p
    if n==6 and convex:
        angles=[dot(sides[i-1],sides[i])/(lengths[i-1]*lengths[i]) for i in range(n)]
        if max(lengths)-min(lengths)<8*eps and max(angles)-min(angles)<at: return 10,p
    return None,p

def analyze(segments,eps,semantics):
    points,edges=planar(segments,eps)
    ep=[(points[a],points[b]) for a,b in edges]
    cyc=cycles(points,edges);witness={}
    for c in cyc:
        kind,p=classify(c,segments,ep,eps,semantics)
        if kind is not None: witness.setdefault(kind,p)
    return {'shapes':sorted(witness),'witnesses':witness,'cycles':len(cyc),'vertices':len(points),'edges':len(edges)}

def options(question):
    out={}
    for letter,value in re.findall(r'\(([A-P])\) ([^\n]+)',question.split('Options:',1)[1]):
        out[letter]=None if 'none' in value else sorted(map(int,re.findall(r'\d+',value)))
    return out

def tests():
    square=[((0,0),(1,0)),((1,0),(1,1)),((1,1),(0,1)),((0,1),(0,0))]
    assert analyze(square,2e-5,'empty_interior')['shapes']==[2]
    subdiv=square[1:]+[((0,0),(.4,0)),((.4,0),(1,0))]
    assert analyze(subdiv,2e-5,'empty_interior')['shapes']==[2]
    diagonal=square+[((0,0),(1,1))]
    assert analyze(diagonal,2e-5,'empty_interior')['shapes']==[4]
    assert analyze(diagonal,2e-5,'literal_diagonal')['shapes']==[4]
    incomplete=square[:-1]
    assert analyze(incomplete,2e-5,'empty_interior')['shapes']==[]
    crossing=[((0,0),(2,0)),((2,0),(2,2)),((2,2),(0,2)),((0,2),(0,0)),((0,1),(2,1)),((1,0),(1,2))]
    assert analyze(crossing,2e-5,'empty_interior')['shapes']==[2]
    assert covered((0,0),(1,0),subdiv,2e-5)
    assert not covered((0,0),(1,0),[((0,0),(.4,0)),((.6,0),(1,0))],2e-5)


def run():
    tests();cases=json.loads((HERE/'cases.json').read_text());rows=[]
    # Extraction is reviewed from the final answer, not the hidden reasoning.
    letters={3:'E',15:'F',24:'K',26:'E',38:'I',39:'P',57:None}
    for i in INDICES:
        c=cases[i];seg=parse(c['question']);opt=options(c['question']);runs=[]
        for eps in [2e-5,5e-5,1e-4]:
            for meaning in ['empty_interior','literal_diagonal']:
                run=analyze(seg,eps,meaning);run.update(tolerance=eps,semantics=meaning)
                runs.append(run)
        answers=[]
        for run in runs:
            exact=[k for k,v in opt.items() if v==run['shapes']]
            if not exact: exact=[k for k,v in opt.items() if v is None]
            # 'None' is an option-combination reading, not proof that no shapes exist.
            # The exact geometry is always reported separately in each run.
            answers.append(exact)
        stable=all(a==answers[0] for a in answers)
        letter=letters[i]
        expected=answers[0] if stable else answers
        correct=None if letter is None or not stable else letter in expected
        # Case 57 ends with '(I) 1 and 3', but I actually denotes 1 and 5.
        # Neither forced interpretation is corrected into a canonical answer here.
        row={'index':i,'id':c['id'],'status':'inconclusive',
             'candidate_correct':None,'provisional_candidate_correct':correct,
             'expected':expected,'candidate_final':letter,
             'assessment_scope':'final selected option only; does not certify candidate reasoning',
             'candidate_final_quote':c['candidate'][-500:],
             'candidate_prose_conflicts_with_option':i in (3,38,57),
             'option_mapping_caveat':('Computed shape set has no listed non-none option. Under the tested reconstruction, the candidate excludes a rectangle. This reconstruction is not interval-certified.' if i==26 else None),
             'evidence':runs,
             'proof_limitation':'Tolerance sweeps do not quantify over the full +/-0.000005 coordinate rounding intervals. Independent within-interval perturbations can destroy exact collinearity, parallelism, or right angles. The prompt says to ignore slight differences but supplies no formal equivalence rule. No interval certificate of the intended polygon reconstruction is available.',
             'reason':('Provisional final-option classification is stable across tested tolerances and both diagonal interpretations, but is not a proof suitable for changing labels.' if correct is not None else 'Final option is ambiguous and geometry is not interval-certified; no label correction is justified.')}
        rows.append(row)
    (HERE/'audit_svg.json').write_text(json.dumps(rows,indent=2)+'\n')
    print(json.dumps([{k:r[k] for k in ['index','status','candidate_correct','provisional_candidate_correct','expected','candidate_final']} for r in rows],indent=2))

if __name__=='__main__': run()
