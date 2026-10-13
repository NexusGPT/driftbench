"""Label-blind finite checks for the assigned practice constraint problems.

Only cases.json (question and candidate text) is read. No model, reference,
recorded label, expert prediction or network is used. The adjective test makes
explicit the usual category-order interpretation, and enumerates every total
category order admitted by the examples instead of imposing English order.
"""
import itertools as it
import hashlib
import sys
import json
import re
from collections import Counter, deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDICES = [1, 9, 12, 33, 43, 51, 62, 63, 65, 71, 84]
CANDIDATE = {1:'K',9:'A',12:'D',33:'E',43:'E',51:'K',62:'K',63:'D',65:'E',71:'BC',84:'E'}

# Pin the manually translated problem and candidate, fail closed on any change.
PINNED_HASHES = {'1': {'question': 'a2f89ff9bef026004501243226e82808bf982fa7199eb16c768047a6880fde7f', 'candidate': 'd177dabf145ab3d8d5ab22f764adfd877b07b000145984c07df9410b49d590f5'}, '9': {'question': 'a71a1240a8513f62fdd98061d78b2e40b6c642c4e8abf635460f737686774955', 'candidate': 'd62790672f768c85e5e7cd7df8cf3c399f4caa8d7ca9f919ea4e9593274ba850'}, '12': {'question': 'c2c5af1b933c81fce31f771bc7bde5a46a81c870fbb688c09d125925ba749547', 'candidate': '49859fd23291791e88f490b42f96914c07ba245772d5853cda008ca8c58f7de5'}, '33': {'question': '0255eca1f646c9572c20060b725efd5be7fc4a0d3abedf7e242206617c9c4d8f', 'candidate': 'e14f6667608c452c90a14f43a58c69131672d63d7843bc2f2e3d5d7dfcbef992'}, '43': {'question': '5609c81f75cfe145656e4238a3a72ae61aa5a0b02df948963f9fa2c441d603d8', 'candidate': '21c50052afa7af1c0f60c54b4dcc5c7e4d4b9d6af5f3b4797782535a34debeb5'}, '51': {'question': '0873a45f21d1c954f07f1decbc7be5fdb87edfc61574ff7de31050c766a5d8d7', 'candidate': 'e2a0ebe381088442c1134aac311f789e6830d19e161809777739fc5117ecda79'}, '62': {'question': '90e76a5bf90e087ebb5960b45130b00fd306bf02e6edc86f905bd22273a1cd98', 'candidate': 'a2d78784ed13a0353bd41f6c571bd803f141e6932ac61af0b70a26d4a99ba4bd'}, '63': {'question': 'e2b38dcf48950d0594a5fa043611988af4da5073086df66c04dd3089a335980b', 'candidate': 'a2c2cdcece0a0a497c1421f249d195bd042366369c5721913a09579109eb617f'}, '65': {'question': '848934fdbe71d4059b8f372b6c6f233f16a8f5e78d50870116e6efcdfcbae599', 'candidate': '0b777d496fad51717bb7d669d3ce85810a7d47c61aa114f671ddfb85479058d8'}, '71': {'question': 'dcf82437f4c77a9675ef1ebdc210d7dcde27743d67d4db37cc4e8d4c53fde8f0', 'candidate': '766d50340d2cd30ad53aa44f0c4a973b7a97b96f1dce664c8915bd57fce85d66'}, '84': {'question': 'a75d07cc7c11262e705e9ce10036b34069208c99dd4ab853cedcd8064ad8ca52', 'candidate': '306424ceaa82a660622cdae080a941931bf0e8bf11838191d10975487102ee17'}}

WORDS = {
 'opinion': 'good nice lovely wonderful silly terrible ridiculous repulsive awful mysterious obnoxious',
 'size': 'big little huge large small tiny massive enormous midsize medium-size normal-size',
 'age': 'new old ancient archaic brand-new old-fashioned',
 'shape': 'square rectangular circular triangular spherical pyramidal prismlike',
 'color': 'yellow violet aqua crimson green maroon magenta cyan brown pink blue indigo red gray black white teal orange',
 'origin': 'american japanese chinese filipino nigerian bangladeshi indian ethiopian russian indonesian german brazilian egyptian turkish vietnamese mexican iranian thai pakistani congolese',
 'material': 'plastic wood wool iron fiberglass cardboard glass leather cloth rubber paper steel',
 'purpose': 'typing whittling walking smoking hiking snorkeling drinking exercise driving eating',
}
LEXICON = {w: c for c, words in WORDS.items() for w in words.split()}

def categories(phrase):
    # All adjectives precede the first noun; noun phrases may have two words.
    out = []
    for word in phrase.strip().split():
        if word not in LEXICON:
            break
        out.append(LEXICON[word])
    assert out, phrase
    assert len(out) == len(set(out)), phrase
    return out

def adjective(case):
    q = case['question']
    examples_text = q.split('In this variant of English, which')[0]
    examples = re.findall(r'\(\d+\)\s*(.*?)(?=\s*\(\d+\)|$)', examples_text, re.S)
    options = dict(re.findall(r'\(([A-J])\) ([^\n]+)', q))
    assert len(options) == 10
    edges = set()
    for s in examples:
        cs = categories(s)
        edges.update(it.combinations(cs, 2))
    orders = []
    counts = Counter()
    witnesses = {}
    for order in it.permutations(WORDS):
        pos = {c:i for i,c in enumerate(order)}
        if not all(pos[a] < pos[b] for a,b in edges):
            continue
        result = ''.join(k for k,s in options.items()
                         if all(pos[a] < pos[b] for a,b in it.combinations(categories(s),2))) or 'K'
        orders.append(order)
        counts[result] += 1
        witnesses.setdefault(result, order)
    assert orders, 'Examples must admit a category order'
    possible = sorted(counts)
    candidate = CANDIDATE[case['index']]
    verdict = candidate == possible[0] if len(possible) == 1 else (False if candidate not in possible else None)
    return None, possible, {
        'provisional_candidate_correct_under_assumption': verdict,
        'semantic_assumption':'Adjectives have the stated conventional semantic categories, and the variant uses one strict category order.',
        'examples':len(examples), 'category_dictionary':WORDS,
        'explicit_precedence_edges': sorted([list(e) for e in edges]),
        'admitted_total_orders':len(orders),
        'answer_set_counts':dict(sorted(counts.items())),
        'one_total_order_per_answer_set': witnesses,
    }, ('Inconclusive under strict proof policy: the question does not state that one universal semantic-category order governs all phrases. The enumeration is conditional evidence only, including any provisional false verdict.')

def cycle():
    states=[]
    # Each day is a permutation indexed by Reynaldo, Seamus, Theresa, Yuki.
    for d1,d2 in it.product(it.permutations('FGHJ'), repeat=2):
        if d1[2]!='J' or any(a==b for a,b in zip(d1,d2)): continue
        if 'F' in (d1[0],d2[0]) or 'J' in (d1[3],d2[3]): continue
        if 'H' not in (d1[2],d2[2]) or d1[3]!=d2[1]:continue
        states.append((d1,d2))
    predicates=[lambda a,b:b[0]=='G',lambda a,b:a[1]=='H',lambda a,b:b[3]=='H',
                lambda a,b:'J' in (a[1],b[1]),lambda a,b:'G' in (a[2],b[2])]
    truth={k:sum(f(*s) for s in states) for k,f in zip('ABCDE',predicates)}
    answer=''.join(k for k,v in truth.items() if v)
    return answer, {'satisfying_assignments':states,'option_satisfying_counts':truth}

def rooms():
    langs={'K':{'K'},'F':{'F','G'},'B':{'B','K'},'G':set('KFBG')}
    states=[]
    for order in it.permutations('KFBG'):
        p={x:order.index(x) for x in order}
        communicates=lambda x,y: bool(langs[x]&langs[y])
        neighbors=lambda x: [order[j] for j in (p[x]-1,p[x]+1) if 0<=j<4]
        if p['K']<=p['G']:continue
        if any(communicates('K',x) for x in neighbors('K')):continue
        if any(communicates('F',x) for x in neighbors('F')):continue
        if sum(communicates('B',x) for x in neighbors('B'))!=1:continue
        states.append(order)
    options={'A':tuple('BGKF'),'B':tuple('FBGK'),'C':tuple('GBFK'),'D':tuple('GBKF')}
    return ''.join(k for k,v in options.items() if v in states), {'satisfying_orders':states,'languages':{k:sorted(v) for k,v in langs.items()},'candidate_D_violations':['Korean neighbors British, who speaks Korean.','British neighbors both German and Korean, and shares a language with both.']}

def trades():
    names=('Garza','Yates','Zimmer','Flores','Lynch','King','Meyer','Ortiz')
    classes=(1,3,3,1,2,2,2,2)
    initial=(0,0,0,1,1,2,2,2)
    # Pre-enumerate all allowed exchanges, represented as disjoint index tuples.
    patterns=[]
    for a in range(8):
        for b in range(a+1,8):
            if classes[a]==classes[b]:patterns.append(((a,),(b,)))
        for bs in it.combinations([b for b in range(8) if classes[b]==classes[a]+1],2):
            if classes[a] in (1,2):patterns.append(((a,),bs))
    queue=deque([initial]);seen={initial};parent={initial:None}
    while queue:
        state=queue.popleft()
        for aa,bb in patterns:
            owner_a=state[aa[0]];owner_b=state[bb[0]]
            if owner_a==owner_b or any(state[b]!=owner_b for b in bb):continue
            nxt=list(state)
            for a in aa:nxt[a]=owner_b
            for b in bb:nxt[b]=owner_a
            nxt=tuple(nxt)
            if nxt not in seen: seen.add(nxt);queue.append(nxt);parent[nxt]=(state,[aa,bb])
    options={'A':(0,{'Flores','Garza'}),'B':(1,{'Flores','Meyer'}),
             'C':(1,{'Garza','Lynch'}),'D':(2,{'Flores','Ortiz'}),'E':(2,{'Garza','Meyer'})}
    hits={};witnesses={}
    for key,(owner,target) in options.items():
        matching=[s for s in seen if {n for n,o in zip(names,s) if o==owner}==target]
        hits[key]=len(matching)
        if matching:
            state=sorted(matching)[0]; path=[]
            while parent[state] is not None:
                previous,swap=parent[state]
                path.append({'exchange':[[names[i] for i in side] for side in swap], 'owners_after':dict(zip(names,state))})
                state=previous
            witnesses[key]=list(reversed(path))
    return ''.join(k for k,v in hits.items() if v==0),{'reachable_ownership_states':len(seen),'option_reachable_counts':hits,'trade_witnesses':witnesses,'owner_ids':{'0':'RealProp','1':'Southco','2':'Trustcorp'},'value_invariant':{'class1':4,'class2':2,'class3':1,'initial_each_company':6}}

def houses():
    states=[]
    for o in it.permutations('ORBYG'):
        p={c:o.index(c) for c in o}
        if p['O']<p['R'] and p['B']<p['Y'] and abs(p['B']-p['Y'])!=1 and p['B']<p['G']<p['R']:
            states.append(''.join(o))
    return str(len(states)), {'valid_orders':states,'key':{'O':'orange','R':'red','B':'blue','Y':'yellow','G':'green'},'option_numbers':dict(zip('ABCDE',range(2,7))), 'candidate_final_number':6}

def archive():
    states=[]
    for o in it.permutations('LMORTY',4):
        if not {'R','Y'}.issubset(o):continue
        if o[2] not in 'LT':continue
        if 'M' in o and o.index('M')>1:continue
        if 'T' in o and 'R' not in o:continue
        if 'R' in o and (o.index('R')==0 or o[o.index('R')-1]!='O'):continue
        states.append(o)
    fs=[lambda s:s[2]=='L',lambda s:s[0]=='M',lambda s:s[1]=='O',lambda s:s[3]=='T',lambda s:s[1]=='Y']
    hits={k:sum(f(s) for s in states) for k,f in zip('ABCDE',fs)}
    return ''.join(k for k,v in hits.items() if v), {'satisfying_year_assignments':states,'years':[1921,1922,1923,1924],'option_satisfying_counts':hits,'student_key':dict(zip('LMORTY',['Louis','Mollie','Onyx','Ryan','Tiffany','Yoshio']))}

def bands():
    base=[]
    for o in it.permutations('UVWXYZ'):
        p={b:o.index(b) for b in o}
        if p['V']<p['Z'] and p['U']>=3 and p['Y']<3:base.append(o)
    original={o for o in base if o.index('W')<o.index('X') and o.index('Z')<o.index('X')}
    predicates={
      'A':lambda p:all(p[b]<p['X'] for b in 'VWYZ'),
      'B':lambda p:p['V']<p['W']<p['Z'],
      'C':lambda p:p['V']<p['X'] and p['W']<p['X'],
      'D':lambda p:abs(p['X']-p['U'])==1,
      'E':lambda p:p['X'] in (4,5),
    }
    details={}
    for k,f in predicates.items():
        alternative={o for o in base if f({b:o.index(b) for b in o})}
        details[k]={'allowed_count':len(alternative),'same_set':alternative==original,
                    'added_orders':[''.join(o) for o in sorted(alternative-original)],
                    'removed_orders':[''.join(o) for o in sorted(original-alternative)]}
    return ''.join(k for k,v in details.items() if v['same_set']), {'base_count':len(base),'original_count':len(original),'alternatives':details,'band_key':dict(zip('UVWXYZ',['Uneasy','Vegemite','Wellspring','Xpert','Yardsign','Zircon']))}

def paintings():
    works=[s+m for s in 'FGHI' for m in 'ow']
    states=[]
    for o in it.permutations(works):
        if o[7]!='Io':continue
        walls=[o[i:i+2] for i in range(0,8,2)]
        if any(a[1]==b[1]=='w' or a[0]==b[0] or {a[0],b[0]}=={'F','I'} for a,b in walls):continue
        if not any(a=='Gw' and b=='Fo' for a,b in walls):continue
        states.append(o)
    def both(o,students,upper):
        return all(o.index(s+m)%2==(0 if upper else 1) for s in students for m in 'ow')
    opts={'A':('FG',False),'B':('FG',True),'C':('FH',True),'D':('GH',False),'E':('GH',True)}
    hits={k:sum(both(o,*v) for o in states) for k,v in opts.items()}
    witness=('Ho','Fw','Gw','Fo','Go','Iw','Hw','Io')
    assert witness in states and both(witness,'GH',True)
    return ''.join(k for k,v in hits.items() if v), {'satisfying_arrangements':len(states),'option_satisfying_counts':hits,'candidate_explicit_witness':witness,'slot_order':['wall1_upper','wall1_lower','wall2_upper','wall2_lower','wall3_upper','wall3_lower','wall4_upper','wall4_lower'],'key':{'F':'Franz','G':'Greene','H':'Hidalgo','I':'Isaacs','o':'oil','w':'watercolor'}}

FUNCTIONS={9:cycle,12:rooms,33:trades,43:houses,63:archive,65:bands,84:paintings}

def run():
    cases=json.loads((HERE/'cases.json').read_text())
    out=[]
    for index in INDICES:
        case=cases[index]
        assert case['index']==index
        for field, digest in PINNED_HASHES[str(index)].items():
            assert hashlib.sha256(case[field].encode()).hexdigest() == digest, (index, field, 'changed since audit')
        if index in (1,51,62,71):
            verdict,expected,evidence,reason=adjective(case)
        else:
            expected,evidence=FUNCTIONS[index]()
            verdict=(expected==('6' if index==43 else CANDIDATE[index]))
            reason='Complete finite enumeration of the stated constraints.'
            if index==43:reason+=' The computed count is absent from the offered choices; choosing 6 still gives the wrong count.'
        out.append({'index':index,'id':case['id'],'status':'inconclusive' if verdict is None else 'proved',
                    'candidate_correct':verdict,'expected':expected,'candidate_final':CANDIDATE[index],
                    'question_sha256':hashlib.sha256(case['question'].encode()).hexdigest(),
                    'candidate_sha256':hashlib.sha256(case['candidate'].encode()).hexdigest(),
                    'evidence':evidence,'reason':reason})
    (HERE/'audit_constraints.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps([{k:r[k] for k in ('index','status','candidate_correct','expected','candidate_final')} for r in out],indent=2))

def self_test():
    cases = json.loads((HERE/'cases.json').read_text())
    assert cycle()[0] == 'B'
    assert rooms()[0] == 'C'
    assert trades()[0] == 'A'
    assert len(houses()[1]['valid_orders']) == 8
    assert archive()[0] == 'A'
    answer, evidence = bands()
    assert answer == 'A'
    assert 'YVWUXZ' in evidence['alternatives']['E']['added_orders']
    assert paintings()[0] == 'E'
    for n in [1, 51, 62]:
        verdict, answers, evidence, _ = adjective(cases[n])
        assert verdict is None and 'K' not in answers
        assert evidence['provisional_candidate_correct_under_assumption'] is False
    assert adjective(cases[71])[0] is None
    print('11 focused finite-check tests passed')

if __name__=='__main__':
    if '--self-test' in sys.argv:
        self_test()
    else:
        run()
