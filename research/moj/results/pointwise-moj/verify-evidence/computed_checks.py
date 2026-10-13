"""Diagnostic proofs from visible questions only, not a fitted production route."""
from itertools import combinations, permutations
from fractions import Fraction
import json
from pathlib import Path


def marble_check():
    sums=[sum(x) for x in combinations(range(2,8),2)]
    return {'pairs':len(sums),'total':sum(sums),'expected':str(Fraction(sum(sums),len(sums))),
            'candidate_final':'9','candidate_matches':Fraction(sum(sums),len(sums))==9}


def painting_check():
    paintings=[s+m for s in 'FGHI' for m in 'ow']
    legal=[];options={k:[] for k in 'ABCDE'}
    for p in permutations(paintings):
        walls=list(zip(p[::2],p[1::2]))
        if p[7]!='Io':continue
        if any(a[1]==b[1]=='w' or a[0]==b[0] or {a[0],b[0]}=={'F','I'} for a,b in walls):continue
        if not any(a=='Gw' and b=='Fo' for a,b in walls):continue
        legal.append(p)
        for name,students,upper in [('A','FG',False),('B','FG',True),('C','FH',True),('D','GH',False),('E','GH',True)]:
            target=p[::2] if upper else p[1::2]
            if all(s+m in target for s in students for m in 'ow'):options[name].append(p)
    candidate=('Ho','Fw','Gw','Fo','Go','Iw','Hw','Io')
    return {'arrangements_enumerated':40320,'legal_arrangements':len(legal),'options_possible':{k:len(x) for k,x in options.items()},
            'candidate_witness':candidate,'candidate_witness_valid':candidate in legal,'candidate_answer_E_valid':candidate in options['E']}


def adjective_check():
    # All multi-adjective examples imply these edges. No example connects
    # opinion/purpose to the six-category chain. The noun "car key" is not purpose.
    nodes=('opinion','purpose','size','age','material','shape','origin','color')
    edges=[('opinion','purpose'),('size','age'),('material','shape'),('size','shape'),('shape','origin'),('origin','color'),('age','material'),('age','color')]
    orders=[p for p in permutations(nodes) if all(p.index(a)<p.index(b) for a,b in edges)]
    return {'consistent_total_orders':len(orders),'opinion_must_be_first':all(p[0]=='opinion' for p in orders),
            'purpose_must_be_last':all(p[-1]=='purpose' for p in orders),
            'counterexample_order':next(p for p in orders if p[0]!='opinion' and p[-1]!='purpose'),
            'verdict':'The candidate adds unsupported global ordering assumptions; the examples leave relative placement underdetermined.'}


def main():
    result={'marbles':marble_check(),'paintings':painting_check(),'adjectives':adjective_check(),
            'scope':'Question-derived diagnostic calculations, no reference solution or gold label input; no per-item routing rule.'}
    assert result['marbles']['candidate_matches']
    assert result['paintings']['candidate_witness_valid'] and result['paintings']['options_possible']['E']>0
    assert all(result['paintings']['options_possible'][k]==0 for k in 'ABCD')
    assert not result['adjectives']['opinion_must_be_first']
    Path(__file__).with_name('computed-checks.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__=='__main__':main()
