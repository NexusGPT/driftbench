"""LongJudge verify: formalize a BoardgameQA item into literals (model), solve exactly (defeasible.py),
compare with the response's committed answer. Two independent formalizations must give the same solver
answer, else no signal. Dev only. Labels are read only for scoring."""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from llm import call, cost_of
from defeasible import solve

ITEMS = sys.argv[1]
BEST = sys.argv[2]
AUDIT = sys.argv[3]
OUT = sys.argv[4]

BASE = """Translate a rule-based board game puzzle into JSON literals. Do not solve it. Do not add any rule, fact or preference that is not stated.
A literal is {"s": subject, "p": predicate, "o": object or "", "neg": true or false}. Use short snake_case names and use EXACTLY the same spelling for the same animal, predicate and object everywhere. Put the object animal in "o", not inside "p" (for example "the frog destroys the wall constructed by the swan" is {"s":"frog","p":"destroy_wall_of","o":"swan","neg":false}). "does not" or "will not" sets neg true.
Rules: {"id": "Rule3", "if": [literals], "then": literal}. Use subject "?x" for "something", "an animal", "it", "the living creature" when the rule talks about whichever animal satisfies the condition, and use "?x" again for that same animal in the conclusion. Use subject "?any" in a condition for "there exists an animal which ..." or "at least one animal ..." or "if there is evidence that one animal, no matter which one, ...".
Attribute conditions in rules (a card of a primary color, a name starting with a letter, an age below a number, having more money than another animal, a leafy green vegetable, something to sit on, and so on): write the condition as one literal such as {"s":"frog","p":"has_primary_color_card","o":"","neg":false}. Then decide it from the game state yourself and add a fact for it only when it is true (or a neg fact when it is clearly false). Primary colors are red, green and blue. Compute ages, money sums and letters exactly.
Facts are the current state. Preferences: [["Rule11","Rule21"], ...] meaning the first is preferred over the second. The question is one literal; for "does the X ... ?" use neg false.
Return only JSON: {"facts": [...], "rules": [...], "preferences": [...], "question": literal}."""
VARIANT = BASE + "\nWork through the rules in the order given and keep every rule, even rules that look irrelevant."


def parse(t):
    if not t:
        return None
    i, j = t.find('{'), t.rfind('}')
    try:
        o = json.loads(t[i:j + 1])
        for r in o['rules']:
            r['if'] = [dict(l, o=l.get('o') or '') for l in r['if']]
            r['then'] = dict(r['then'], o=r['then'].get('o') or '')
        o['facts'] = [dict(l, o=l.get('o') or '') for l in o['facts']]
        o['question'] = dict(o['question'], o=o['question'].get('o') or '')
        return o
    except Exception:
        return None


def committed(resp):
    hits = re.findall(r'\b(proved|proven|disproved|disproven|unknown)\b', resp[-1500:], flags=re.I)
    if not hits:
        return None
    h = hits[-1].lower()
    return {'proven': 'proved', 'disproven': 'disproved'}.get(h, h)


def main():
    items = [i for i in json.load(open(ITEMS)) if 'boardgame' in i['question']]
    best = {x['id']: x['pass'] for x in json.load(open(BEST))['contestants'][0]['decisions']}
    aud = {a['id']: a['audited'] for a in json.load(open(AUDIT))}
    jobs = [(it, s) for it in items for s in (BASE, VARIANT)]
    def run(j):
        it, s = j
        t, c, hit = call(s, it['question'], 'verify-boardgame ' + it['id'][:12])
        return it['id'], s, t
    sol = {}
    with ThreadPoolExecutor(2) as ex:
        for iid, s, t in ex.map(run, jobs):
            spec = parse(t)
            try:
                a = solve(spec) if spec else None
            except Exception as e:
                a = None
            sol.setdefault(iid, []).append(a)
    rows = []
    for it in items:
        s = sol[it['id']]
        ans = committed(it['response'])
        signal = s[0] if s[0] and s[0] == s[1] else None
        verdict = (signal == ans) if (signal and ans) else best[it['id']]
        rows.append({'id': it['id'][:12], 'solver': s, 'response': ans, 'base': best[it['id']], 'new': verdict,
                     'official': it['correct'], 'audited': aud.get(it['id'], it['correct'])})
    cost = sum(cost_of(s, it['question']) for it, s in jobs)
    print(json.dumps(rows, indent=1))
    print('cost', cost, 'per boardgame item', cost / len(items))
    json.dump({'rows': rows, 'cost': cost}, open(OUT, 'w'), indent=1)


main()
