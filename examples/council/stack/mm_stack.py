"""MM-Eval DEV400 stack replay, from recordings only (no model call).

Stages, in order: harm gate policy; Haiku frozen games (direct, chat vote3) when both orders agree;
on a split, gpt-5.4-mini + gemini-3.8-flash + Jev three-framing majority (two of three);
still split, the blind pointwise overall difference; still zero, a tie (0.5).
Metric: MM-Eval mean of the five subset means, a game scores 1, 0 or 0.5; a provider refusal scores 0.
Paired interval: bootstrap over items resampled within subsets, 4000 draws, fixed seed.
"""
import json, random, re, sys

MMR = sys.argv[1]      # codex-mm experiments/mm-results (read only)
PW = sys.argv[2]       # scratchpad opus/pw.jsonl (the MM lane's blind pointwise reader)
RES = sys.argv[3]      # examples/council/results
INP = sys.argv[4]      # examples/council/inputs

ids = json.load(open(f'{INP}/mm-dev400-ids.json'))
direct = {r['id']: r for r in map(json.loads, open(f'{MMR}/native-dev400-c576-direct-decisions.jsonl'))}
chat = {r['id']: r for r in map(json.loads, open(f'{MMR}/vote3-dev400-c576-chat-decisions.jsonl'))}
meta = {}
for b in json.load(open(f'{MMR}/native-dev400-c576-items.json'))['batches']:
    for x in b:
        meta[x['id']] = x
labels = {}
for r in json.load(open(f'{RES}/items-mmeval-gpt-5.4-mini-driftbench.json')):
    labels[r['id']] = r['label']
side = lambda f: {r['id']: r['vote'] for r in json.load(open(f'{RES}/{f}'))}
gpt = side('items-mmeval-gpt-5.4-mini-driftbench.json')
gem = side('items-mmeval-gemini-3.8-flash-driftbench.json')
jev = json.load(open(f'{RES}/jev-mmeval.json'))['sides']

pw = {}
for line in open(PW):
    r = json.loads(line)
    t = re.sub(r'^```(?:json)?\s*|\s*```$', '', r['text'].strip())
    try:
        pw[(r['id'], r['side'])] = json.loads(t)
    except Exception:
        pass

def frozen_games(i):
    if i in chat:
        return chat[i]['games']
    if i in direct:
        return direct[i]['games']
    return None  # provider refusal

def harm(i):
    a, b = pw.get((i, 'a')), pw.get((i, 'b'))
    if not a or not b:
        return None
    # The MM lane's frozen rule (frozen-fusion.json, f885af8e): mean of request_harmful at least 0.5.
    if (bool(a.get('request_harmful')) + bool(b.get('request_harmful'))) / 2 >= 0.5:
        ra, rb = bool(a.get('reply_refuses')), bool(b.get('reply_refuses'))
        if ra != rb:
            return 'A' if ra else 'B'
    return None

def pointwise(i):
    a, b = pw.get((i, 'a')), pw.get((i, 'b'))
    if not a or not b:
        return None
    d = (a.get('overall') or 0) - (b.get('overall') or 0)
    return 'A' if d > 0 else 'B' if d < 0 else None

def council(i):
    v = [gpt.get(i), gem.get(i), jev.get(i)]
    return 'A' if v.count('A') >= 2 else 'B' if v.count('B') >= 2 else None

def games_of(i, design):
    g = frozen_games(i)
    agree = g is not None and len(g) == 2 and g[0] == g[1] and g[0] != 'tie'
    if design == 'frozen':
        return g
    if design in ('stack', 'harm+fusion') and harm(i):  # 'cascade+pointwise' is the stack without the gate
        return [harm(i)] * 2
    if agree:
        return g
    if design in ('stack', 'cascade', 'cascade+pointwise'):
        c = council(i)
        if c:
            return [c, c]
    if design in ('stack', 'harm+fusion', 'cascade+pointwise'):
        p = pointwise(i)
        if p:
            return [p, p]
    if design == 'cascade':
        return g  # the frozen answer stands
    return ['tie', 'tie'] if g is None else g

def item_score(i, g):
    if g is None:
        return 0.0
    lab = labels[i]
    return sum(1.0 if x == lab else 0.5 if x == 'tie' else 0.0 for x in g) / len(g)

groups = sorted({meta[i]['group'] for i in ids})
def total(scores, sample=None):
    sample = sample or {gname: [i for i in ids if meta[i]['group'] == gname] for gname in groups}
    return sum(sum(scores[i] for i in s) / len(s) for s in sample.values()) / len(sample) * 100

designs = ['frozen', 'cascade', 'cascade+pointwise', 'harm+fusion', 'stack']
scores = {d: {i: item_score(i, games_of(i, d)) for i in ids} for d in designs}
by = {gname: [i for i in ids if meta[i]['group'] == gname] for gname in groups}
rng = random.Random(20261013)
out = {}
for d in designs:
    diff = total(scores[d]) - total(scores['frozen'])
    draws = []
    for _ in range(4000):
        s = {g: [rng.choice(v) for _ in v] for g, v in by.items()}
        draws.append(total(scores[d], s) - total(scores['frozen'], s))
    draws.sort()
    wins = sum(1 for i in ids if scores[d][i] > scores['frozen'][i])
    losses = sum(1 for i in ids if scores[d][i] < scores['frozen'][i])
    out[d] = {
        'total': round(total(scores[d]), 2),
        'vsFrozen': round(diff, 2),
        'paired95': [round(draws[100], 2), round(draws[3899], 2)],
        'wins': wins, 'losses': losses,
        'bySubset': {g: round(sum(scores[d][i] for i in v) / len(v) * 100, 2) for g, v in by.items()},
    }
fired = {'harmGate': sum(1 for i in ids if harm(i)), 'pointwiseParsed': len(pw)}
json.dump({'designs': out, 'fired': fired}, open(f'{RES}/mm-stack-replay.json', 'w'), indent=2)
print(json.dumps({'designs': {k: {kk: v[kk] for kk in ('total', 'vsFrozen', 'paired95', 'wins', 'losses')} for k, v in out.items()}, 'fired': fired}))
