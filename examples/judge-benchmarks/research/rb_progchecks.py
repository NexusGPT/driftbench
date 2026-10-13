"""RubricBench: VerIF-style program checks. One model call sees ONLY the question and rubric (never the
responses) and writes a deterministic Python predicate for each requirement that is mechanically
checkable. Predicates run on both responses in an isolated subprocess. Their results replace the base
judge's binary grade for those requirements; the binary count is then recomputed. Dev only; labels are read
only for scoring."""
import glob, hashlib, json, os, re, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from llm import call, cost_of

S = sys.argv[1]
CODEX = sys.argv[2]  # codex-rb judge-benchmarks folder (read only)
OUT = os.path.join(S, 'rb-progchecks-result.json')

SYSTEM = """You write exact checkers for rubric requirements. You see the user's question and the expert rubric, never the responses.
For each requirement in order, decide whether it can be decided EXACTLY by a short deterministic Python function over the response text alone: counts of words, sentences, paragraphs, bullets, sections or items; presence or absence of an exact keyword, phrase or character; letter case; punctuation; quotation nesting; required prefix or suffix; JSON or other machine-checkable format; length limits.
If the requirement needs any judgment about meaning, quality, correctness, facts, relevance or completeness, it is NOT checkable: return null for it. When in doubt, return null.
For a checkable requirement write Python source defining def check(text): that returns True when the response satisfies the requirement and False otherwise. Use only the standard library (re, json, string). Follow the question's own definitions (for example how sentences or paragraphs are separated) when it gives them; otherwise use a robust convention and ignore markdown decoration.
Return only JSON: {"checks": [{"id": 1, "code": "def check(text):\\n    ..." or null}, ...one entry per requirement]}."""


def rubric_items(criterion):
    lines = [l.strip() for l in criterion.split('\n') if l.strip()]
    sq = re.compile(r'^(?:(?:[-*•]|\d+[).:])\s*)?(?:does|do|is|are|has|have|can|should|would|did|will)\b', re.I)
    if not any(sq.match(l) for l in lines):
        return lines
    items, cur = [], ''
    for l in lines:
        if cur and (cur.endswith('?') or sq.match(l)):
            items.append(cur)
            cur = ''
        cur = cur + '\n' + l if cur else l
    if cur:
        items.append(cur)
    return items


RUNNER = r'''
import json, sys
src = open(sys.argv[1]).read(); texts = json.load(open(sys.argv[2]))
ns = {}
exec(src, ns)
print(json.dumps([bool(ns['check'](t)) for t in texts]))
'''


def run_check(code, texts):
    with tempfile.TemporaryDirectory() as d:
        open(os.path.join(d, 'c.py'), 'w').write(code)
        open(os.path.join(d, 't.json'), 'w').write(json.dumps(texts))
        open(os.path.join(d, 'r.py'), 'w').write(RUNNER)
        try:
            r = subprocess.run([sys.executable, '-I', 'r.py', 'c.py', 't.json'], cwd=d, capture_output=True,
                               text=True, timeout=5)
            return json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else None
        except Exception:
            return None


def parse_checks(text):
    i, j = text.find('{'), text.rfind('}')
    try:
        o = json.loads(text[i:j + 1])
        return o['checks'] if isinstance(o.get('checks'), list) else None
    except Exception:
        return None


def base_checks(codex):
    """Parsed base judgments (binary-canonical-executed, falling back to binary-canonical when the
    prompt was identical), mapped back to the original A/B."""
    aud = json.load(open(os.path.join(codex, 'experiments/rb/audit.json')))
    det = {x['id']: x for r in aud['reports'] if r['contestant'] == 'driftbench-rb-binary-canonical-executed' for x in r['details']}
    rec = {}
    for f in sorted(glob.glob(os.path.join(codex, 'recordings/rubricbench/*.jsonl'))):
        for l in open(f):
            e = json.loads(l)
            if e['contestant'] == 'driftbench-rb-binary-canonical-executed' or (
                    e['contestant'] == 'driftbench-rb-binary-canonical' and e['item'] not in rec):
                if e['order'] == 'AB':
                    rec[e['item']] = e['text']
    return det, rec


def main():
    dev = {r['case_id']: r for r in json.load(open(os.path.join(S, 'rb-dev.json')))}
    ids = json.load(open(os.path.join(S, 'rb-checkable.json')))
    det, rec = base_checks(CODEX)
    def job(i):
        it = dev[i]
        user = json.dumps({'question': it['instruction'], 'rubric': it['rubrics']})
        t, c, hit = call(SYSTEM, user, f'rb-progcheck {i}')
        return i, user, t
    results = {}
    with ThreadPoolExecutor(2) as ex:
        for i, user, t in ex.map(job, ids):
            results[i] = (user, t)
    rows = []
    for i in ids:
        it = dev[i]
        user, t = results[i]
        items = rubric_items(it['rubrics'])
        progs = parse_checks(t) or []
        h = lambda s: hashlib.sha256(s.encode()).hexdigest()
        reversed_ = h(it['response_a']) > h(it['response_b'])
        bt = rec.get(i, '')
        bj, bk = bt.find('{'), bt.rfind('}')
        try:
            bchecks = json.loads(bt[bj:bk + 1])['checks']
        except Exception:
            bchecks = None
        x = det[i]
        new = x['games'][0]
        fired = 0
        m = None
        if bchecks and len(bchecks) == len(items) and all(isinstance(c, dict) and 'a' in c and 'b' in c for c in bchecks):
            # base grades in ORIGINAL order
            grades = [((c['b'] if reversed_ else c['a']) == 2, (c['a'] if reversed_ else c['b']) == 2) for c in bchecks]
            for p in progs:
                if not isinstance(p, dict) or not p.get('code') or not isinstance(p.get('id'), int):
                    continue
                k = p['id'] - 1
                if not 0 <= k < len(grades):
                    continue
                res = run_check(p['code'], [it['response_a'], it['response_b']])
                if res and len(res) == 2:
                    if tuple(res) != grades[k]:
                        fired += 1
                    grades[k] = tuple(res)
            m = sum(int(a) - int(b) for a, b in grades)
            if fired == 0:
                pass  # no program disagreed with the base grades: keep the base decision unchanged
            elif m > 0:
                new = 'A'
            elif m < 0:
                new = 'B'
        rows.append({'id': i, 'group': x['group'], 'label': x['label'], 'base': x['games'][0], 'new': new,
                     'programs': sum(1 for p in progs if isinstance(p, dict) and p.get('code')), 'changed_grades': fired, 'margin': m})
    cost = sum(cost_of(SYSTEM, results[i][0]) for i in ids)
    b = sum(r['base'] == r['label'] for r in rows)
    n = sum(r['new'] == r['label'] for r in rows)
    total_base = sum(sum(g == x['label'] for g in x['games']) for x in det.values())
    total_new = total_base + 2 * (n - b)
    res = {'items': len(rows), 'base_correct': b, 'new_correct': n, 'flips_fixed': sum(r['base'] != r['label'] and r['new'] == r['label'] for r in rows),
           'flips_broken': sum(r['base'] == r['label'] and r['new'] != r['label'] for r in rows),
           'full_dev_base': total_base / (2 * len(det)), 'full_dev_new': total_new / (2 * len(det)),
           'cost_usd': cost, 'usd_per_100_dev_items': 100 * cost / len(det)}
    print(json.dumps(res, indent=1))
    json.dump({'result': res, 'rows': rows}, open(OUT, 'w'), indent=1)


main()
