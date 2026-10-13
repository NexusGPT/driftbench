"""Label-blind deterministic checks for the assigned practice logic items.

Only cases.json is read. No recorded labels, reference answers, model, or network.
Natural-language rules are manually transcribed below; uncertain lexical bridges
are evaluated both ways and cannot produce label corrections if they matter.
"""
import ast
import hashlib
import itertools
import json
import re
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent
INDICES = [4, 6, 11, 17, 20, 27, 28, 34, 37, 54, 59, 60, 61, 64, 66, 81, 87, 91]

# Pin the hand-read source text used by these checkers. Changed text requires review.
SOURCE_SHA256 = {'4': {'question': 'c68c5fc81f9be5ff511e098fc6bd9467bc949983497bdc84b9b1c3fa1fdc6a74', 'candidate': 'df41e0ab12783e16934904bfa6615d703c2f3a59305c80e200295540d6d7fb41'}, '6': {'question': '01a8a1ea221b18a5d1cb69d3b95f02114eab1bc030423076e01496a961d87be3', 'candidate': 'dad8d58f4bf956ea56052883283077f7f1dd587dbfc23795c9187d28a6008ecd'}, '11': {'question': 'bc7e17c9fabaddf05c0d3d8761fd8a54f8df5c5d21a173953a069f58ee1d327b', 'candidate': '76a9b53ad87c066757cac575a63dde3107fa709ecf376f802f84478c1d1d9ffa'}, '17': {'question': 'b3f0b9b18474c342e3ac1f4e43b2f83c85a72bca291e1e2d3fd580061c6e123b', 'candidate': '127829ca32c465b9a9b94f343d7cc8e6c36436424e8682a74f43b67c827d85fd'}, '20': {'question': '3e955bdcfeb9c56f313c902394309383569a72cc400b596a5d12bdf4cb7609c7', 'candidate': '080708c87ba3ffb433cb61047589e68d65b64501241d31613618cbe930adb2df'}, '27': {'question': '40f3e57c330a9a3fb750e277f083dd7af0da381d51f7df3e33e5cb03833a96ed', 'candidate': '9f26000ff01d8da7b2d3fceb502438e0bb357646f71d9fe1cdbe56b591da15e5'}, '28': {'question': 'eba083a93718077eb1a207a70484256075a40f2e8a85681d212f6e8ce6552e69', 'candidate': 'de5cc993bd842c6bc303e5f77a0e3e38da45dd3be7b2b0d3d0d8e929e057f076'}, '34': {'question': '2eaf8cb202372815250dcf0dfeab54658c270634cee538927f453ef85ba34ffa', 'candidate': '243916429dd00742a0fe26e9b759750e6ea31aea461af3527bad6f37c5a1b03d'}, '37': {'question': 'b47b253c0a7bfb12627d9a1b78d9ef707497541bb0b592aa2c092f5f093efccc', 'candidate': 'b11b88caed38674f178d745287f561874cb81be9e7d4eeba3eb1c73fe49391f5'}, '54': {'question': 'cad2f2e58779f92fac760237e11bcd55d1aa7d5eb9cd28d759d4137398343d36', 'candidate': '46456f158428b4a679c686660597ad1a5787a1a997a24337aa760de81619afd7'}, '59': {'question': '25931bd2bac7e70e08745427bdb4ed1378ef3be330ddcb94446a0a60caab062a', 'candidate': '56794c0f0810f2aa751b501811b0f0cc9e0eb04ebe591eff470fc568ed3f3eaa'}, '60': {'question': 'f1eec418bc1a1abe2aba2a2d0b939ff1b82db41efdce8714928d19fb5d23098f', 'candidate': '288cc4432a8739697d65ddd69e44486b5cc839060c09801650b5929d649058e2'}, '61': {'question': 'fe673be25ef0bd449afb475f0a1774523b00d4dea8d38dafc9ae79fc77dbaa79', 'candidate': '5d266401f2ac5a5fe56beb4331bfc0e6aa973a77242b14208c87a11e701a2bbe'}, '64': {'question': '6d0a545bcd56a39e6b688b9adeedf577516c5ef14eb02e4255e8969f33a5f5c5', 'candidate': '177fee2aea79e288e52c899d8ddd95a83d63c000e0c6d60461228ce859e30a32'}, '66': {'question': 'd587aa7857c9ada41cd0f2efe91f7ae24bc5dc20adffaf3f3b7396fe5eff7294', 'candidate': '73af8041ba6f710036c675e416c66da84548b49e9fb768b2d4c0df1e3c9197cd'}, '81': {'question': 'f4b71efad10c47d015e701859f56fca4e41a4c222c22ff3bb31e37615dc2e71e', 'candidate': '42231e2a80a328c9336825c7fa906e7a3962a2a180fdec3645a3d80d4affd991'}, '87': {'question': 'c8dec3a619aa952eba19b3369cd9bb9ae00bc7cfd7a42f4898861539e1322f97', 'candidate': 'c96cc9f565dc0a8b4efbf6144f17f97fc3e3b18812839f16ceb1a746d6dfc685'}, '91': {'question': 'b922fe7ddf8f7d0186b8083d3e015c81f27aba91ce505cf47169a02745f6c3de', 'candidate': '2b435422ab5faee84a3b75033770cf3aa6923e7ab0ddc96cb15e1691d9e6994d'}}

def verify_source(case):
    expected = SOURCE_SHA256[str(case["index"])]
    for field, digest in expected.items():
        assert hashlib.sha256(case[field].encode()).hexdigest() == digest, (case["index"], field, "source changed")

def evaluate(node, env):
    if isinstance(node, ast.Expression): return evaluate(node.body, env)
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, bool) else Fraction(node.value)
    if isinstance(node, ast.Name): return env[node.id]
    if isinstance(node, ast.UnaryOp):
        v = evaluate(node.operand, env)
        if isinstance(node.op, ast.Not): return not v
        if isinstance(node.op, ast.USub): return -v
        if isinstance(node.op, ast.UAdd): return v
    if isinstance(node, ast.BoolOp):
        vals = [bool(evaluate(v, env)) for v in node.values]
        return all(vals) if isinstance(node.op, ast.And) else any(vals)
    if isinstance(node, ast.BinOp):
        a,b = evaluate(node.left,env),evaluate(node.right,env)
        if isinstance(node.op, ast.Add): return a+b
        if isinstance(node.op, ast.Sub): return a-b
        if isinstance(node.op, ast.Mult): return a*b
        if isinstance(node.op, ast.Div): return a/b
    if isinstance(node, ast.Compare):
        vals=[evaluate(node.left,env)]+[evaluate(v,env) for v in node.comparators]
        out=[]
        for op,a,b in zip(node.ops,vals,vals[1:]):
            if isinstance(op,ast.LtE): out.append(a<=b)
            elif isinstance(op,ast.Gt): out.append(a>b)
            elif isinstance(op,ast.Lt): out.append(a<b)
            elif isinstance(op,ast.GtE): out.append(a>=b)
            elif isinstance(op,ast.Eq): out.append(a==b)
            else: raise ValueError(ast.dump(op))
        return all(out)
    if isinstance(node, ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ('min','max'):
        return {'min':min,'max':max}[node.func.id]([evaluate(x,env) for x in node.args])
    raise ValueError(ast.dump(node))

def row(case, correct, expected, evidence, reason, final=None):
    return dict(index=case['index'],id=case['id'],status='inconclusive' if correct is None else 'proved',candidate_correct=correct,expected=expected,candidate_final=final if final is not None else case['candidate'].split('</think>')[-1].strip(),evidence=evidence,reason=reason,question_sha256=hashlib.sha256(case['question'].encode()).hexdigest(),candidate_sha256=hashlib.sha256(case['candidate'].encode()).hexdigest())

def boolean(case):
    q=case['question']; atoms=sorted(set(re.findall(r'The capital of [^.]+\.',q)))
    opts=dict(re.findall(r'\(([A-E])\)\s*(.*?)(?=\n\([A-E]\)|\Z)',q,re.S))
    trees={}
    for k,s in opts.items():
        for n,a in enumerate(atoms): s=s.replace(a,'atom'+str(n))
        s=s.replace('is less than or equal to','<=').replace('is greater than','>')
        trees[k]=ast.parse(s.strip(),mode='eval')
    truthsets=set(); counts=dict.fromkeys(opts,0)
    for bits in itertools.product([False,True],repeat=len(atoms)):
        env=dict(zip(['atom'+str(n) for n in range(len(atoms))],bits))
        truth=tuple(k for k,t in trees.items() if evaluate(t,env))
        truthsets.add(truth)
        for k in truth: counts[k]+=1
    final=case['candidate'].split('</think>')[-1].strip()
    answers=re.findall(r'\\boxed\{\(?([A-E])\)?\}',final)
    if not answers: answers=re.findall(r'(?:correct answer is|answer is)\s*\*?\*?\(?([A-E])\)?',final)
    answer=answers[-1] if answers else None
    # The prompt itself asserts exactly one option is true. Restrict to
    # assignments satisfying that supplied premise, never assume capitals.
    admissible={truth for truth in truthsets if len(truth)==1}
    unique=next(iter(admissible)) if len(admissible)==1 else None
    expected=unique[0] if unique and len(unique)==1 else sorted(map(list,truthsets))
    if answer is None:
        correct=None
        reason='Candidate never supplies an option. The computed answer is retained, but omission is not a contradicted stated final answer; no relabeling.'
    elif unique and len(unique)==1:
        correct=answer==expected
        reason='Exact rational arithmetic over every capital-city assignment, restricted by the supplied exactly-one-true premise; no external world facts assumed.'
    elif counts[answer]==0:
        correct=False; reason='Chosen option is false under every assignment of the unresolved world-fact atoms.'
    else:
        correct=None; reason='Answer depends on unresolved world-fact atoms; no label correction permitted.'
    result = row(case,correct,expected,dict(atom_names=atoms,assignments=2**len(atoms),true_counts=counts,possible_true_sets=sorted(map(list,truthsets)),admissible_true_sets=sorted(map(list,admissible)),premise='The question states exactly one expression is true.'),reason,answer or '[no selected option]')
    if answer is None:
        result['provisional_candidate_correct'] = False if unique and len(unique)==1 else None
    return result

def close_brackets(text):
    pairs=dict(zip('({[<',')}]>')); stack=[]
    for n,c in enumerate(text):
        if c in pairs: stack.append(c)
        elif c in pairs.values():
            if not stack or pairs[stack.pop()]!=c: return None,n
    return ''.join(pairs[c] for c in reversed(stack)),None

def brackets(case):
    inp=''.join(case['question'].split('Input:')[1].split())
    expected,error=close_brackets(inp); assert error is None
    final=case['candidate'].split('</think>')[-1]
    # Copy only the candidate's explicit final sequence; computation never trusts its stack.
    lines=[l.strip(' `') for l in final.splitlines() if re.fullmatch(r'[\s`<>\[\](){}]+',l) and len(l.strip())>4]
    candidate=''.join(lines[-1].split())
    if candidate.startswith(inp): suffix=candidate[len(inp):]
    else: suffix=candidate
    completion_error=close_brackets(inp+suffix)
    return row(case,suffix==expected,expected,dict(input=inp,candidate_completion=suffix,completion_stack_result=completion_error),'Stack processing includes every input symbol; compare the exact missing suffix.',suffix)

def colors(case):
    q=case['question']; name=re.search(r'What color is (\w+)\?',q)[1]
    facts=dict()
    for who,pred in re.findall(r'(\w+) is (?:a )?(\w+)\.',q): facts.setdefault(who,set()).add(pred)
    palette={'yellow','green','white','gray','red','blue'}
    explicit=sorted(facts.get(name,set())&palette)
    # Finite models assign any named color independently, preserving all facts.
    possibilities=explicit or sorted(palette)
    final=case['candidate'].split('</think>')[-1].strip()
    if case['index']==64:
        correct=None; reason='Context entails no color. Candidate states that fact but ends with a white guess; mixed final answer prevents a provable label correction.'
    else:
        correct=not explicit and bool(re.search(r'\*\*Answer:\*\*.*(?:does not specify|not specified)',final,re.I|re.S))
        reason='At least two models satisfy every stated fact and give different colors; no species-to-color rule is supplied.'
    return row(case,correct,explicit[0] if explicit else 'not specified',dict(subject=name,stated_facts={k:sorted(v) for k,v in facts.items()},possible_colors=possibilities),reason)

def path(case):
    q=case['question']; prefix,tail=q.split('Then you jump back to the random vertex V and do the following moves:')
    directions={'down-right':(1,1),'down-left':(-1,1),'up-right':(1,-1),'up-left':(-1,-1),'right':(2,0),'left':(-2,0)}
    counts={'one':1,'two':2,'three':3}
    first,second=prefix.split('Then, you jump to a random vertex V where you see a pie.')
    def trace(text,initial):
        p=(0,0); seen={initial:p}; steps=[]
        for d,n,obj in re.findall(r'Then you move ([a-z-]+) for (one|two|three) steps?(?: and see a ([a-z]+))?\.',text):
            dx,dy=directions[d]; p=(p[0]+dx*counts[n],p[1]+dy*counts[n]); steps.append([d,n,list(p),obj or None])
            if obj:
                assert obj not in seen or seen[obj]==p
                seen[obj]=p
        assert len(steps)==len(re.findall('Then you move ',text))
        return seen,steps
    a,sa=trace(first,'bear'); b,sb=trace(second,'pie'); shared=set(a)&set(b)
    offsets={(a[o][0]-b[o][0],a[o][1]-b[o][1]) for o in shared}; assert len(offsets)==1
    offset=next(iter(offsets)); merged=dict(a)
    for o,p in b.items(): merged[o]=(p[0]+offset[0],p[1]+offset[1])
    assert len(set(merged.values()))==len(merged)
    p=offset
    moves=tail.split('.')[0].strip().split(', ')
    for d in moves:
        dx,dy=directions[d]; p=(p[0]+dx,p[1]+dy)
    found=[o for o,pos in merged.items() if pos==p]; expected=found[0] if found else 'unknown'
    final=case['candidate'].split('</think>')[-1].strip()
    # This response is truncated during its 127th fabricated step, with no final object.
    candidate=final if re.fullmatch('[a-z]+',final) else None
    result = row(case,candidate==expected if candidate is not None else None,expected,dict(first_trace=sa,second_trace=sb,shared_objects=sorted(shared),vertex_V=list(offset),final_coordinate=list(p),objects={o:list(v) for o,v in merged.items()},last_response_line=final.splitlines()[-1]),'Integer triangular-lattice tracing aligns the two paths through their shared object. No stated final object is supplied, so no relabeling is permitted.',candidate or '[no final object]')
    if candidate is None:
        result['provisional_candidate_correct'] = False
    return result

def sorting(case):
    q=case['question']; words=q.split('List: ')[1].split('\n')[0].split()
    thoughts={int(n):s for n,s in re.findall(r'Thought (\d+): (.*?)(?=\nThought|\nQ:)',q,re.S)}
    errors=[]; checked=[]
    places={'first':0,'second':1,'third':2}
    for n,s in thoughts.items():
        m=re.search(r'The (first|second|third) letter:',s)
        if m:
            pos=places[m[1]]
            for word,letter,num in re.findall(r'"([a-z]+)": "([a-z])" \((\d+)\)',s):
                if word not in words or word[pos]!=letter or ord(letter)-96!=int(num):
                    errors.append(dict(thought=n,word=word,claimed_letter=letter,actual_letter=word[pos],claimed_number=int(num)))
            checked.append(n)
    # Check all full ordering displays preceding the first character error.
    first=min(e['thought'] for e in errors)
    for n in range(1,first):
        s=thoughts[n]
        if 'We now have:' not in s: continue
        expr=s.split('Hence, we have ')[-1] if 'Hence, we have ' in s else s.split('We now have:')[1]
        expr=expr.split(' for the subpart')[0]
        blocks=[re.findall(r'"([a-z]+)"',block) for block in expr.split('<')]
        flat=[w for block in blocks for w in block]
        assert sorted(flat)==sorted(words),(n,flat)
        for left,right in zip(blocks,blocks[1:]): assert max(left)<min(right),(n,left,right)
    final=case['candidate'].split('</think>')[-1].strip(); selected=int(re.match(r'\s*(\d+)',final)[1])
    return row(case,selected==first,first,dict(letter_errors=errors,letter_thoughts_checked=checked,earlier_group_orders_verified=list(range(1,first)),alphabetical_answer=sorted(words)),'Validate each quoted character and alphabet position; all preceding grouping displays preserve all words and correct block order.',selected)

# Propositional backward slices of the board games. Each rule retains its source
# number. Atoms outside the query's ancestor cone cannot affect the query.
def closure(facts,rules,preferences=()):
    state=set(facts); history=[]
    for _ in range(100):
        active={n:(ants,head) for n,ants,head in rules if set(ants)<=state}
        winners={n:head for n,(ants,head) in active.items() if not any(h==opp(head) and (m,n) in preferences for m,(_,h) in active.items())}
        nxt=set(facts)|set(winners.values())
        if nxt==state: return state,history
        history.append(sorted(winners)); state=nxt
    raise AssertionError('No stable fixed point')

def opp(atom): return atom[1:] if atom.startswith('!') else '!'+atom

def board(case):
    n=case['index']; variants=[]
    if n==6:
        facts=['ant_negotiate','dalmatian_not_trade','dragon_photo']
        rules=[(1,['ant_negotiate','dalmatian_not_trade'],'stork_build'),(2,['stork_build'],'!mouse_shout'),(3,['stork_richer_walrus'],'!stork_build'),(4,['mouse_africa'],'mouse_smile'),(5,['mouse_hug','mouse_smile'],'mouse_shout')]
        pref=[(3,1),(5,2)];query='mouse_shout';bridges=['mouse_africa']
    elif n==27:
        facts=['goat_negotiate','monkey_trade']
        rules=[(1,['basenji_sharp'],'!basenji_disarm'),(2,['basenji_primary'],'!basenji_disarm'),(3,['goat_negotiate'],'!goat_neglect'),(4,['goat_surrender'],'basenji_hide'),(5,['!goat_neglect'],'goat_surrender'),(6,['beetle_not_leave','monkey_trade'],'goat_neglect'),(7,['basenji_not_destroy','basenji_wants'],'!basenji_hide'),(8,['!basenji_disarm'],'basenji_wants')]
        pref=[(6,3),(7,4)];query='basenji_hide';bridges=['basenji_sharp','basenji_primary']
    elif n==17:
        facts=['stork_trade'];rules=[(1,['reindeer_germany'],'reindeer_castle'),(2,['reindeer_b_color'],'reindeer_invest'),(4,['reindeer_castle','reindeer_invest'],'!reindeer_photo'),(7,['lizard_not_tear','stork_trade'],'!reindeer_castle')]
        pref=[(7,1)];query='reindeer_photo';bridges=['reindeer_germany','reindeer_b_color']
    elif n==66:
        facts=['flamingo_trade'];rules=[(1,['flamingo_trade','dugong_trade'],'!songbird_smile'),(2,['songbird_smile'],'!crab_swear'),(3,['internet_device'],'songbird_smile'),(4,['crab_leave'],'crab_swear')]
        pref=[(1,3),(4,2)];query='crab_swear';bridges=['internet_device']
    elif n==60:
        facts=['mouse_refuse'];rules=[(1,['gadwall_fewer_six'],'gadwall_build'),(3,['!badger_trade'],'!mannikin_unite'),(4,['gadwall_france_color'],'gadwall_build'),(5,['!gadwall_hug','!mannikin_unite'],'!pelikan_swear'),(7,['badger_seat'],'!badger_trade'),(9,['gadwall_castle'],'gadwall_hug'),(10,['same_initial'],'!badger_trade'),(12,['gadwall_build'],'!gadwall_hug')]
        pref=[(9,12)];query='pelikan_swear';bridges=['gadwall_france_color','badger_seat']
    elif n==4:
        facts=['bee_not_tear_badger','seahorse_not_create_vampire']
        rules=[(1,['swan_shout_beaver'],'swan_unite'),(2,['snake_tear_dove'],'woodpecker_take_monkey'),(3,['animal_persuade_rhino'],'!swan_shout_beaver'),(4,['bee_not_trade','beetle_trade'],'stork_wants_goat'),(5,['bee_not_tear_badger'],'bee_refuse_badger'),(6,['seahorse_enjoy_ant'],'!swan_shout_peafowl'),(7,['swan_unite'],'beetle_trade'),(8,['bee_create_dragon'],'bee_refuse_dinosaur'),(10,['stork_wants_goat'],'!finch_capture'),(11,['frog_young'],'!frog_destroy'),(12,['seahorse_not_create_vampire'],'seahorse_enjoy_ant'),(13,['woodpecker_take_monkey'],'!bee_refuse_dinosaur'),(14,['bee_wants_fangtooth'],'!bee_shout_beetle'),(15,['animal_trade_bison'],'!swan_unite'),(16,['frog_primary'],'!frog_destroy'),(17,['!bee_refuse_dinosaur'],'bee_reveal_zebra'),(18,['!bee_shout_beetle','bee_reveal_zebra'],'bee_not_trade'),(19,['bee_refuse_badger'],'bee_shout_dragonfly'),(20,['bee_shout_dragonfly'],'bee_wants_fangtooth'),(21,['frog_leafy'],'frog_destroy'),(22,['swan_shout_peafowl'],'swan_shout_beaver'),(23,['snake_reduced_hours'],'snake_tear_dove'),(24,['frog_destroy'],'swan_shout_peafowl')]
        pref=[(11,21),(15,1),(16,21),(24,6),(3,22),(8,13)];query='finch_capture';bridges=['frog_primary','frog_leafy','snake_reduced_hours']
    else: raise ValueError(n)
    for bits in itertools.product([False,True],repeat=len(bridges)):
        extra=[a for a,b in zip(bridges,bits) if b]
        state,history=closure(facts+extra,rules,pref)
        value='proved' if query in state else 'disproved' if opp(query) in state else 'unknown'
        variants.append(dict(bridges=dict(zip(bridges,bits)),answer=value,closure=sorted(state),rounds=history))
    values=sorted({v['answer'] for v in variants})
    final=case['candidate'].split('</think>')[-1].strip()
    # Categorical answer and adjacent prose conflict in four cases. Do not
    # silently resolve this into a relabeling even when one part matches.
    if n in (6,27,60,66):
        correct=None;reason='Candidate negates the queried predicate but calls it proved/proven; inconsistent final output prevents a provable relabeling.'
    elif len(values)>1:
        correct=None;reason='Result depends on lexical/world-knowledge bridges not stated as rules; bounded variants retained without relabeling.'
    else:
        selected='disproved' if re.search(r'disprov',final,re.I) else 'proved' if re.search(r'prov',final,re.I) else 'unknown'
        correct=selected==values[0];reason='Stable closure of the query ancestor cone is invariant over all lexical-bridge variants.'
    return row(case,correct,values[0] if len(values)==1 else values,dict(rules=[dict(number=a,antecedents=b,conclusion=c) for a,b,c in rules],preferences=pref,lexical_bridges=bridges,variants=variants),reason)

def main():
    cases=json.loads((HERE/'cases.json').read_text()); out=[]
    for i in INDICES:
        c=cases[i]
        verify_source(c)
        if i in (11,20,34,54,61): r=boolean(c)
        elif i in (37,59,87): r=brackets(c)
        elif i in (64,91): r=colors(c)
        elif i==28: r=path(c)
        elif i==81: r=sorting(c)
        else: r=board(c)
        out.append(r)
    (HERE/'audit_logic.json').write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps([{k:r[k] for k in ('index','status','candidate_correct','expected')} for r in out],indent=2))

if __name__=='__main__': main()
