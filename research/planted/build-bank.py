"""Seeded DEV-template twins with construction truth, never benchmark labels."""
from pathlib import Path
from fractions import Fraction as F
from collections import Counter
from itertools import combinations
import hashlib, json, math, random, re

ROOT = Path(__file__).parent
SEED = 'astra-planted-truth-2026-10-13-v1'
rng = random.Random(SEED)
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
dev_v = json.loads((ROOT / 'dev-verify.json').read_text())
dev_r = json.loads((ROOT / 'dev-rb.json').read_text())
v = {x['id'][:8]: x for x in dev_v}
r = {x['id']: x for x in dev_r}

def source(item, benchmark):
    assert bytes.fromhex(sha(f"split:{benchmark}:{item['id']}"))[0] < 77
    return {'benchmark': benchmark, 'split': 'dev', 'id': item['id'],
            'questionSha256': sha(item['question']),
            'criterionSha256': sha(item.get('criterion', ''))}

def factors(n):
    result = []
    d = 2
    while d*d <= n:
        while n % d == 0:
            result.append(d); n //= d
        d += 1
    if n > 1: result.append(n)
    return result

verify = []
anchors = ['514cb7d2','987731fe','2fabe7c1','8dce745b','74455975',
           'a11d83cb','d39f096b','799919e2','d29e283a','9cf12f34']
for i in range(95):
    family = i % 10
    j = i // 10
    a,b,c = [rng.randrange(2,15) for _ in range(3)]
    proof = {}
    if family == 0:
        stack = [rng.choice('([{<') for _ in range(4+j)]
        q = 'Complete the rest of the sequence, making sure that the parentheses are closed properly. Input: ' + ' '.join(stack)
        answer = ' '.join(dict(zip('([{<',')]}>' ))[x] for x in stack[::-1])
        wrong = answer[:-1] + next(x for x in ')]}>' if x != answer[-1])
        proof = {'algorithm':'LIFO bracket completion','stack':stack,'suffix':answer}
    elif family == 1:
        lo=a+j; hi=lo+b
        pairs=list(combinations(range(lo,hi+1),2)); exact=F(sum(sum(x) for x in pairs),len(pairs))
        q=f'I have {hi-lo+1} marbles numbered {lo} through {hi} in a bag. I take two different marbles uniformly at random. What is the expected sum of their numbers?'
        answer=str(exact);wrong=str(exact+1)
        proof={'algorithm':'exhaust all unordered pairs','pairCount':len(pairs),'sum':sum(sum(x) for x in pairs),'exact':str(exact)}
    elif family == 2:
        ps=[2,3,5,7,11,13]; n=math.prod(rng.choices(ps,k=4+j%3)); fs=factors(n)
        q=f'List all prime factors of {n}, including repetitions, in ascending order.'
        answer=', '.join(map(str,fs)); wrong=', '.join(map(str,fs[:-1]+[fs[-1]+2]))
        proof={'algorithm':'integer trial division','n':n,'factors':fs,'product':math.prod(fs)}
        assert math.prod(fs)==n
    elif family == 3:
        groups=3+j%6; count=2+j%2
        exact=F(math.comb(groups,count)*10**count,math.comb(groups*10,count))
        q=f'Suppose {count} different integers are chosen uniformly from {10} through {10*(groups+1)-1}, inclusive. What is the probability that they each have a different tens digit?'
        answer=str(exact);wrong=str(exact+F(1,100))
        proof={'algorithm':'count subsets by distinct tens groups','groups':groups,'chosen':count,'favorable':math.comb(groups,count)*10**count,'total':math.comb(groups*10,count)}
    elif family == 4:
        first=70+j;second=10+j;third=15+j
        exact=F(first*(100-second)*(100-third),10000)
        q=f'A fictional shop sells a shirt at {first}% of its original price. It then reduces the sale price by {second}%, then reduces that price by {third}%. What is the final price as a percentage of the original price?'
        answer=f'{exact}%';wrong=f'{exact+1}%'
        proof={'algorithm':'multiply successive retained fractions','retainedPercent':[first,100-second,100-third],'exactPercent':str(exact)}
    elif family == 5:
        exponent=2+j
        exact=(F(exponent)**2-F(1,exponent)**2)/4
        q=f'If 3^(x+y) = {3**exponent} and {3**exponent}^(x-y) = 3, what is xy? Express the answer as a fraction.'
        answer=str(exact);wrong=str(exact+F(1,4))
        proof={'algorithm':'logarithm identities then difference of squares','xPlusY':str(exponent),'xMinusY':str(F(1,exponent)),'xy':str(exact)}
    elif family == 6:
        p=2+j;coef=4*p
        q=f'A moving point (x,y) is equally distant from the point ({p},0) and the line x=-{p}. Find its locus equation.'
        answer=f'y^2 = {coef}x';wrong=f'y^2 = {coef+4}x'
        proof={'algorithm':'square nonnegative distances and cancel x squared','focus':[p,0],'directrix':-p,'coefficient':coef,'converse':'y squared nonnegative implies x nonnegative, so both distance sides are nonnegative'}
    elif family == 7:
        d1=2+j;d2=3+j
        x=F(d1*d1,(d1+1)**2);y=F(d2*d2,(d2+1)**2)
        q=f'A^(-1) is the diagonal matrix diag({d1},{d2}). Find the inverse of (A+I)^2.'
        answer=f'diag({x},{y})';wrong=f'diag({x+1},{y})'
        assert x*(F(1,d1)+1)**2==1 and y*(F(1,d2)+1)**2==1
        proof={'algorithm':'exact diagonal matrix inversion and multiplication','inverseA':[d1,d2],'result':[str(x),str(y)],'productDiagonal':['1','1']}
    elif family == 8:
        name=f'Nori{j}';other=f'Luma{j}'
        q=f'In a fictional world, {other} is a yellow swan. {name} is a rhino. No color rule is stated. What color is {name}?'
        answer='The color is not specified.';wrong='The color is yellow.'
        proof={'algorithm':'two models satisfy all premises and disagree on queried color','witnesses':[{other:'yellow',name:'green'},{other:'yellow',name:'blue'}]}
    else:
        n=a+10;f=b+2;scale=c
        exact=F(f*scale,n)
        q=f'Suppose 3*n + {2*n} = 5*n. Suppose 0 = -4*f + 2*q + {5*f}, and f + 2*q = 0. Let b be (f/n)/(1/{scale}). Give the value of b as a fraction.'
        answer=str(exact);wrong=str(exact+1)
        proof={'algorithm':'exact simultaneous linear equations','n':n,'f':f,'q':str(F(-f,2)),'b':str(exact)}
    assert answer != wrong
    verify.append({'id':f'verify-bank-{i:03d}','family':family,'source':source(v[anchors[family]],'longjudge-verify'),
                   'question':q,'clean':'Final answer: '+answer,'defect':'Final answer: '+wrong,
                   'truth':{'clean':True,'defect':False},'mutation':{'from':answer,'to':wrong,'scope':'one final answer component'},'proof':proof})

rubric=[]
for i in range(60):
    family=i%10;j=i//10;token=f'glimmer{j}'
    if family==0:
        sid='rubric_eval_178';fn='freq_count';args=([j,j,j+1],);expected={j:2,j+1:1}
        code='def freq_count(list1):\n    return {x: list1.count(x) for x in list1}'
        bad=code.replace('list1.count(x)','list1.count(x) + 1')
        req='Does the function correctly take a list as input and return a dictionary where keys are the elements and values are their frequencies?'
        q=f'Write Python freq_count(list1) returning element frequencies as a dictionary.\nfreq_count({list(args[0])!r}) == {expected!r}'
    elif family==1:
        sid='rubric_eval_193';fn='tuple_to_dict';args=((j,j+10,j+20,j+30),);expected={j:j+10,j+20:j+30}
        code='def tuple_to_dict(test_tup):\n    return dict(zip(test_tup[::2], test_tup[1::2]))'
        bad=code.replace('test_tup[1::2]','test_tup[::2]')
        req='Does the implemented function convert the input tuple to a dictionary where adjacent elements form key-value pairs?'
        q=f'Write Python tuple_to_dict(test_tup) mapping adjacent tuple elements into key and value pairs.\ntuple_to_dict({args[0]!r}) == {expected!r}'
    elif family==2:
        sid='rubric_eval_644';fn='cube_nums';args=([j+2,-j-3,0],);expected=[x**3 for x in args[0]]
        code='def cube_nums(nums):\n    return [x ** 3 for x in nums]';bad=code.replace('** 3','** 2')
        req='Does the function correctly return a list where each element is the cube of the corresponding input element?'
        q=f'Write Python cube_nums(nums) returning the cube of each input element.\ncube_nums({args[0]!r}) == {expected!r}'
    elif family==3:
        sid='rubric_eval_1051';fn='cummulative_sum';args=([(j+1,j+2),(j+3,)],);expected=sum(map(sum,args[0]))
        code='def cummulative_sum(test_list):\n    return sum(sum(t) for t in test_list)';bad=code.replace('return sum','return 1 + sum')
        req='Does the function correctly calculate the cumulative sum of all integer values present in the nested tuples of the input list?'
        q=f'Write Python cummulative_sum(test_list) returning the sum of all integers in the tuples.\ncummulative_sum({args[0]!r}) == {expected!r}'
    elif family==4:
        sid='rubric_eval_161';req='Does the response strictly follow the format requirement that all words are in capital letters?'
        q=f'Write one fictional chant about {token}. All words must use capital letters.'
        clean=f'{token.upper()} LIGHTS THE NIGHT';defect=clean.replace('LIGHTS','Lights')
        validator=lambda s:s.upper()==s
    elif family==5:
        sid='rubric_eval_201';req='Does the response strictly adhere to the constraint of not containing any capital letters?'
        q=f'Write one fictional sentence about {token}. Do not use any capital letters.'
        clean=f'{token} carries a tiny lantern.';defect=clean.replace('carries','Carries')
        validator=lambda s:not re.search('[A-Z]',s)
    elif family==6:
        sid='rubric_eval_279';req='Does the response strictly adhere to the constraint of not using any commas?'
        q=f'Write one fictional sentence about {token}. Do not use commas.'
        clean=f'{token} wakes then opens the silver gate.';defect=clean.replace('wakes then','wakes, then')
        validator=lambda s:',' not in s
    elif family==7:
        sid='rubric_eval_833';req='Does the response contain exactly 4 numbers as required?'
        q=f'Describe a fictional inventory using exactly 4 numbers. Use the word glimmer.'
        clean=f'glimmer stores {j+1} bells, {j+2} keys, {j+3} maps and {j+4} lamps.';defect=clean.replace(f'{j+4} lamps','several lamps')
        validator=lambda s:len(re.findall(r'\b\d+\b',s))==4
    elif family==8:
        sid='rubric_eval_1115';req='Does the second paragraph start with the word "it" (case-insensitive)?'
        q=f'Write two fictional paragraphs about {token}. The second paragraph must start with the word it.'
        clean=f'{token} opens the gate.\n\nit reveals a quiet garden.';defect=clean.replace('\nit reveals','\nThat reveals')
        validator=lambda s:s.split('\n\n')[1].split()[0].lower()=='it'
    else:
        sid='rubric_eval_49';req='Is the final Python code solution enclosed in a single Markdown code block (using triple backticks)?'
        q=f'Give Python assigning {j+1} to a variable called glimmer. Enclose all code in a single complete triple-backtick Markdown code block.'
        clean=f'```python\nglimmer = {j+1}\n```';defect=clean[:-3]
        validator=lambda s:len(re.findall(r'```[^\n]*\n[\s\S]*?```',s))==1
    assert req in r[sid]['criterion'],(sid,req)
    if family<4:
        clean=f'```python\n{code}\n```';defect=f'```python\n{bad}\n```'
        ns={};exec(code,ns);actual=ns[fn](*args)
        broken={};exec(bad,broken);bad_actual=broken[fn](*args)
        assert actual==expected and bad_actual!=expected
        proof={'algorithm':'execute known bounded pure Python and compare to independent arithmetic oracle','function':fn,'args':args,'expected':repr(expected),'cleanActual':repr(actual),'defectActual':repr(bad_actual)}
    else:
        assert validator(clean) and not validator(defect)
        proof={'algorithm':'literal string predicate','predicateFamily':family,'cleanPass':True,'defectPass':False}
    rubric.append({'id':f'rb-bank-{i:03d}','family':family,'source':source(r[sid],'rubricbench'),
                   'question':q,'criterion':'The response satisfies the rubrics below better.\n'+req,
                   'clean':clean,'defect':defect,'truth':{'clean':True,'defect':False},'proof':proof,
                   'mutation':{'scope':'one requirement broken','from':clean,'to':defect}})

# Noise cohorts are selected without predictions or correctness labels.
# Synthetic/world-free math and coding sources keep personal/company data out of fresh calls.
noise_v_eligible=[dev_v[i] for i in [0,1,2,4,5,6,7,8,9,10,11,12,13,14,15,18,19,21,26,28,29,31,33,34,35,36,39,41,42,43,44,46,48,51,53,57,75,94]]
noise_r_eligible=[x for x in dev_r if x['group'] in ['math','mbpp'] or x['id']=='rubric_eval_1090']
rank=lambda x:sha(SEED+':noise:'+x['id'])
noise={'verify':sorted(noise_v_eligible,key=rank)[:30],'rb':sorted(noise_r_eligible,key=rank)[:30]}
assert len(noise['verify'])==len(noise['rb'])==30
for name,bank in [('verify',verify),('rb',rubric)]:
    assert len({x['id'] for x in bank})==len(bank)
    for x in bank:
        assert x['clean']!=x['defect']
        for field in ['question','clean','defect']:
            assert not any(c in x[field] for c in ['\u2013','\u2014'])
    (ROOT/f'bank-{name}.json').write_text(json.dumps(bank,indent=2,ensure_ascii=False)+'\n')
(ROOT/'noise-cohorts.json').write_text(json.dumps(noise,indent=2,ensure_ascii=False)+'\n')
manifest={'seed':SEED,'verifyPairs':len(verify),'rubricPairs':len(rubric),'verifySourceTemplates':len(set(x['source']['id'] for x in verify)),
          'rubricSourceTemplates':len(set(x['source']['id'] for x in rubric)),'noiseItemsPerBenchmark':30,'noiseRepeats':3,
          'scope':'Seeded re-instantiations of executable DEV templates. Rubric items project one verbatim objective expert requirement; not full-rubric accuracy.',
          'labels':'Construction code only. No model or official label used for bank truth.',
          'noiseScope':'Seeded sample of 38 math/fictional verify DEV items and 29 math/MBPP RubricBench DEV items plus another eligible item if required.',
          'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'bank-verify.json',ROOT/'bank-rb.json',ROOT/'noise-cohorts.json']}}
manifest['noiseEligible']={'verify':len(noise_v_eligible),'rb':len(noise_r_eligible)}
manifest['noiseScope']='Seeded restricted DEV cohorts: math and fictional logic for verify; math and MBPP for RubricBench. Results do not estimate all-domain variability.'
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
