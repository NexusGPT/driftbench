"""Offline construction audit. Reads seeds, cases and prompts, never model answers."""
import ast, collections, json, re, subprocess
from common import HERE, HARD, ROOT, ROWS, cases, canonical, digest, dump, prompt, stamp

TOKEN = re.compile(r"[\w]+(?:[-@.][\w]+)*", re.UNICODE)
IDENTITY = re.compile(r"(?:Lumen-|person|help|fictional-trace-)(\d+)")

def counts(items):
    return {str(k): {'pass': v[True], 'fail': v[False]} for k,v in sorted(items.items(), key=lambda x:str(x[0]))}

def audit():
    seal=json.loads((HERE/'seal.json').read_text())
    source=(HARD/'generate.py').read_text()
    tree=ast.parse(source)
    good_loop=next(n for n in ast.walk(tree) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='good')
    pair_loop=next(n for n in ast.walk(tree) if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='pair')
    before_good=[]
    for node in pair_loop.body:
        if node is good_loop:break
        before_good.append(ast.get_source_segment(source,node))
    assert 'person_id = pair + 101 + offset' in before_good
    assert ast.literal_eval(good_loop.iter)==[True,False]
    original=json.loads((HERE/'prompts.json').read_text())
    dialect=json.loads((HERE/'dialect/prompts.json').read_text())
    report={'stamp':stamp(),'seal_commit':'eeb7875e','seal_sha256':digest(HERE/'seal.json'),
            'method':'Code and sealed inputs only; no calls, decisions, scores, or outcomes read.',
            'generator_sha256':digest(HARD/'generate.py'),'assignments_before_label_loop':before_good,
            'rows':{},'rendered':{},'blocking_cues':[]}
    lookup={}
    for row in ROWS:
        data=cases(row)
        assert digest(HERE/f'{row}.json')==seal['rows'][row]['sha256']
        groups=collections.defaultdict(list)
        nuisance=collections.defaultdict(collections.Counter)
        for c in data:
            lookup[c['id']]=(row,c)
            trusted={k:c[k] for k in ('question','rubric','reference','trajectory','expect') if k in c}
            groups[canonical(trusted)].append(c)
            for token in set(TOKEN.findall(canonical(trusted))):nuisance[token][c['truth']]+=1
        assert len(groups)==192
        assert all(len(g)==2 and {c['truth'] for c in g}=={True,False} for g in groups.values())
        assert all(v[True]==v[False] for v in nuisance.values())
        ids=collections.defaultdict(collections.Counter)
        parity=collections.defaultdict(collections.Counter)
        last_digit=collections.defaultdict(collections.Counter)
        for c in data:
            trusted=canonical({k:c[k] for k in ('question','rubric','reference','trajectory','expect') if k in c})
            for value in set(IDENTITY.findall(trusted)):
                ids[value][c['truth']]+=1;parity[int(value)%2][c['truth']]+=1;last_digit[int(value)%10][c['truth']]+=1
        assert all(v[True]==v[False] for v in ids.values())
        report['rows'][row]={'cases':len(data),'paired_trusted_contexts':len(groups),
            'trusted_tokens':len(nuisance),'imbalanced_trusted_token_values':0,
            'identity_values':len(ids),'imbalanced_identity_values':0,
            'identity_parity':counts(parity),'identity_last_digit':counts(last_digit),
            'case_sha256':digest(HERE/f'{row}.json')}
    # Each serialized API payload is independently checked. Case metadata is not
    # a model input; candidate criterion/answer and peer bytes match the freeze.
    for name,entries in [('primary',original),('dialect',dialect)]:
        tally=collections.defaultdict(lambda:collections.defaultdict(collections.Counter))
        identities=collections.defaultdict(lambda:collections.defaultdict(collections.Counter))
        for e in entries:
            row,c=lookup[e['id']]
            assert e['prompt']==prompt(c,row,e['side'])
            payload=e['built']['payload'] if name=='dialect' else e['prompt']
            rendered=canonical(payload)
            assert c['id'] not in rendered
            assert 'ledger-hard-' not in rendered
            cell=(row,e['side'],e.get('model','shared'))
            for token in set(TOKEN.findall(rendered)):tally[cell][token][c['truth']]+=1
            for value in set(IDENTITY.findall(rendered)):identities[cell][value][c['truth']]+=1
        cells={}
        for cell,bag in tally.items():
            imbalanced={t:v for t,v in bag.items() if v[True]!=v[False]}
            unbalanced_ids={t:v for t,v in identities[cell].items() if v[True]!=v[False]}
            assert not unbalanced_ids,(cell,unbalanced_ids)
            cells['/'.join(cell)]={'all_token_values':len(bag),
                'imbalanced_token_values':counts(imbalanced),'imbalanced_identity_values':0}
        report['rendered'][name]={'entries':len(entries),'sha256':digest(HERE/('dialect/prompts.json' if name=='dialect' else 'prompts.json')),'cells':cells}
    report['interpretation']=[
        'Entity identifiers are assigned once per pair, before iterating over both labels. Identity value, parity, and last digit are exactly label-balanced.',
        'Every complete trusted context has one pass and one fail. Thus every deterministic function of that context, including names, phone subscribers, areas, dates, prices and seed substitutions, is label-balanced.',
        'All numeric entity suffixes present in actual rendered requests are label-balanced. Case id, generation, family and truth metadata are excluded by the verified renderer.',
        'Some answer token values correlate with truth by design: changed quantities, private/public ownership, negation, completion statements, and persisted-state mismatches. Full token contingency tables are retained; these are semantic differences, not an incidental generation-index label code.',
        'This audit rules out the enumerated construction cues, not every possible semantic shortcut or all distributional bias.']
    report['verdict']='PASS: no incidental identity or trusted-context label cue; retain seal; no withdrawn pool.'
    dump(HERE/'construction-cue-audit.json',report)
    print(json.dumps({'verdict':report['verdict'],'rows':report['rows'],'rendered_counts':{k:v['entries'] for k,v in report['rendered'].items()}}))

if __name__=='__main__':audit()
