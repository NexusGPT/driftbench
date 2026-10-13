"""Label-blind exact parity proof for the supplied truth-teller questions."""
import itertools, json, re
from pathlib import Path
root = Path('examples/judge-benchmarks/jb-results')
items = json.loads((root / 'final-test-blind-audit.json').read_text())
rows = []
for index, item in enumerate(items):
    question = item['question']
    if not question.startswith('In this question, assume each person either always tells the truth or always lies.'):
        continue
    locations = set(re.findall(r'\b\w+ is at the ([a-z ]+)\.', question))
    queries = re.findall(r'Does the person at the ([a-z ]+) tell the truth\?', question)
    assert len(queries) == 3
    edges, anchors, ignored = [], [], []
    for sentence in question.split('. '):
        sentence = sentence.rstrip('.')
        edge = re.fullmatch(r'The person at the ([a-z ]+) says the person at the ([a-z ]+) (tells the truth|lies)', sentence)
        unary = re.fullmatch(r'The person at the ([a-z ]+) (tells the truth|lies)', sentence)
        if edge:
            a,b,claim = edge.groups()
            assert a in locations and b in locations
            edges.append((a,b,claim == 'lies',sentence))
        elif unary:
            a,claim = unary.groups()
            assert a in locations
            anchors.append((a,claim == 'tells the truth',sentence))
        elif ' says ' in sentence:
            raise AssertionError('Unparsed truth constraint: ' + sentence)
        elif sentence.startswith('The person at the ') and not sentence.startswith('The person at the ' + queries[-1] + ' '):
            # Private beliefs and observations are facts about a person, not their uttered proposition.
            if ' thinks their ' in sentence or ' saw a firetruck' in sentence:
                ignored.append(sentence)
            elif 'Does the person' not in sentence:
                raise AssertionError('Unparsed direct assertion: ' + sentence)
    graph = {a: [] for a in locations}
    for a,b,neg,_ in edges:
        graph[a].append((b,neg)); graph[b].append((a,neg))
    membership, components = {}, []
    for a in locations:
        if a in membership: continue
        n = len(components); component = {a: False}; stack = [a]; membership[a] = n
        while stack:
            u = stack.pop()
            for v,neg in graph[u]:
                expected = component[u] ^ neg
                if v in component: assert component[v] == expected
                else: component[v] = expected; membership[v] = n; stack.append(v)
        components.append(component)
    fixed = {}
    for a,value,_ in anchors:
        n = membership[a]; start = value ^ components[n][a]
        assert n not in fixed or fixed[n] == start
        fixed[n] = start
    needed = sorted({membership[a] for a in queries} - fixed.keys())
    possibilities = []
    for free in itertools.product([False,True], repeat=len(needed)):
        roots = fixed | dict(zip(needed,free))
        values = tuple(roots[membership[a]] ^ components[membership[a]][a] for a in queries)
        possibilities.append(['yes' if v else 'no' for v in values])
    assert len({tuple(p) for p in possibilities}) == len(possibilities)
    finals = []
    for reply in [item['a'],item['b']]:
        matches = re.findall(r'\b(yes|no)\s*,\s*(yes|no)\s*,\s*(yes|no)\b',reply,re.I)
        finals.append(list(map(str.lower,matches[-1])) if matches else None)
    rows.append({'index':index,'id':item['id'],'query':queries,'anchors':anchors,'edges':edges,
                 'ignored_non_utterance_facts':ignored,'possible_answers':possibilities,
                 'candidate_finals':finals,'candidate_valid':[f in possibilities for f in finals],
                 'unique_answer':len(possibilities)==1})
(root/'test-logic-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps([{'index':r['index'],'id':r['id'],'possible':r['possible_answers'],
                   'finals':r['candidate_finals'],'valid':r['candidate_valid']} for r in rows],indent=2))
