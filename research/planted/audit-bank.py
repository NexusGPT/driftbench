"""Independent read-back checks on the committed stimuli; no model calls."""
from pathlib import Path
from fractions import Fraction as F
from itertools import combinations
from collections import Counter
import hashlib, json, math, re, subprocess

root=Path(__file__).parent
manifest=json.loads((root/'manifest.json').read_text())
for file,expected in manifest['files'].items():
    assert hashlib.sha256((root/file).read_bytes()).hexdigest()==expected
v=json.loads((root/'bank-verify.json').read_text())
r=json.loads((root/'bank-rb.json').read_text())
assert len(v)==95 and len(r)==60
for bank in [v,r]:
    for item in bank:
        source=item['source'];digest=hashlib.sha256(f"split:{source['benchmark']}:{source['id']}".encode()).digest()
        assert digest[0]<77
        assert item['truth']=={'clean':True,'defect':False}
        assert item['clean']!=item['defect']
for item in v:
    q=item['question'];family=item['family']
    answer=item['clean'].removeprefix('Final answer: ')
    wrong=item['defect'].removeprefix('Final answer: ')
    if family==0:
        prefix=q.split('Input: ')[1];stack=[];match=dict(zip(')]}>','([{<'))
        def valid(s):
            st=[]
            for ch in (prefix+s).replace(' ',''):
                if ch in '([{<':st.append(ch)
                elif not st or st.pop()!=match[ch]:return False
            return len(st)==0
        assert valid(answer) and not valid(wrong)
    elif family==1:
        n,lo,hi=map(int,re.findall(r'\d+',q)[:3])
        assert n==hi-lo+1
        expected=F(sum(sum(p) for p in combinations(range(lo,hi+1),2)),math.comb(n,2))
        assert F(answer)==expected and F(wrong)!=expected
    elif family==2:
        n=int(re.search(r'factors of (\d+)',q)[1]);xs=list(map(int,answer.split(', ')))
        assert math.prod(xs)==n
        assert all(all(x%d for d in range(2,math.isqrt(x)+1)) for x in xs)
        assert math.prod(map(int,wrong.split(', ')))!=n
    elif family==3:
        count,lo,hi=map(int,re.findall(r'\d+',q))
        # An independent enumeration, not the generator's combinatorial formula.
        goods=total=0
        for draw in combinations(range(lo,hi+1),count):
            total+=1;goods+=len({x//10 for x in draw})==count
        assert F(answer)==F(goods,total) and F(wrong)!=F(goods,total)
    elif family==4:
        p,s,t=map(int,re.findall(r'(\d+)%',q));price=F(100)*F(p,100)*F(100-s,100)*F(100-t,100)
        assert F(answer[:-1])==price and F(wrong[:-1])!=price
    elif family==5:
        rhs=int(re.search(r'= (\d+) and',q)[1]);m=0
        while 3**m<rhs:m+=1
        assert 3**m==rhs
        x=(F(m)+F(1,m))/2;y=(F(m)-F(1,m))/2
        assert F(answer)==x*y and F(wrong)!=x*y
    elif family==6:
        p=int(re.search(r'point \((\d+),0\)',q)[1]);coef=int(re.search(r'= (\d+)x',answer)[1]);bad=int(re.search(r'= (\d+)x',wrong)[1])
        assert coef==4*p and bad!=4*p
    elif family==7:
        ds=list(map(int,re.search(r'diag\((\d+),(\d+)\)',q).groups()))
        vals=list(map(F,re.search(r'diag\(([^,]+),([^\)]+)\)',answer).groups()))
        bad=list(map(F,re.search(r'diag\(([^,]+),([^\)]+)\)',wrong).groups()))
        assert all(a*(1+F(1,d))**2==1 for a,d in zip(vals,ds))
        assert any(a*(1+F(1,d))**2!=1 for a,d in zip(bad,ds))
    elif family==8:
        assert q.endswith('is a rhino. No color rule is stated. What color is '+re.search(r'(Nori\d+) is a rhino',q)[1]+'?')
        assert answer=='The color is not specified.' and wrong=='The color is yellow.'
    else:
        k=int(re.search(r'3\*n \+ (\d+)',q)[1]);t=int(re.search(r'2\*q \+ (\d+)',q)[1]);scale=int(re.search(r'1/(\d+)',q)[1])
        n=F(k,2);f=F(t,5)
        assert F(answer)==f*scale/n and F(wrong)!=f*scale/n
for item in r:
    family=item['family'];clean=item['clean'];bad=item['defect']
    def valid(s):
        if family<4:
            code=re.search(r'```python\n([\s\S]*?)\n```',s)[1];ns={};exec(code,ns)
            # All finite lists used below include boundaries and negative integers.
            if family==0:
                return all(ns['freq_count'](xs)==dict(Counter(xs)) for xs in [[],[0],[1,1],[-1,0,-1],[2,3,4]])
            if family==1:
                return all(ns['tuple_to_dict'](xs)=={xs[i]:xs[i+1] for i in range(0,len(xs),2)} for xs in [(),(1,2),(-1,0,2,3)])
            if family==2:
                return all(ns['cube_nums'](xs)==[x*x*x for x in xs] for xs in [[],[0,1],[-3,2,4]])
            return all(ns['cummulative_sum'](xs)==sum(x for row in xs for x in row) for xs in [[],[()],[(0,)],[(1,2),(-3,5)]])
        if family==4:return s==s.upper()
        if family==5:return all(not ch.isupper() for ch in s)
        if family==6:return ',' not in s
        if family==7:return len(re.findall(r'\b\d+\b',s))==4
        if family==8:return s.split('\n\n')[1].split()[0].lower()=='it'
        return bool(re.fullmatch(r'```python\n[^`]+\n```',s))
    assert valid(clean) and not valid(bad),item['id']
print(json.dumps({'verifyPairs':len(v),'rubricPairs':len(r),'allCleanPass':True,'allMutantsFail':True,'testItemsUsed':0}))
