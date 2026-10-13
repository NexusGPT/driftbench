"""Evidence-grounded arbitration for JudgeBench knowledge pairs (research prototype, dev split only).

Idea: tonight's judges (reference3 and its cascades) can only re-use the judge model's own knowledge. When
that knowledge is wrong, more solves, more votes and backward checks repeat the same mistake. This
prototype adds NEW knowledge: for a multiple-choice pair whose two replies pick different options, Haiku
writes encyclopedia queries for the crux, code retrieves Wikipedia passages, and Haiku decides between the
two contested options from the evidence, with a quote that code checks against the retrieved text. The
evidence verdict replaces the base verdict only when it passes a pre-registered gate.

Labels are read only by the scorer at the end. No label, group, length or position enters any prompt or gate.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, 'recordings', 'haiku-evidence.jsonl')
WIKI_CACHE = os.path.join(HERE, 'recordings', 'wiki-cache')
ITEMS = os.environ.get(
    'JB_REFERENCE3_ITEMS',
    '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-jb/examples/judge-benchmarks/jb-results/driftbench-reference3-items.json',
)
MODEL = 'haiku'
CAP_USD = float(os.environ.get('CAP_USD', '2.5'))
REPLAY_ONLY = os.environ.get('REPLAY_ONLY') == '1'

os.makedirs(WIKI_CACHE, exist_ok=True)
_recs: dict[str, dict] = {}
if os.path.exists(REC):
    for line in open(REC, encoding='utf8'):
        if line.strip():
            e = json.loads(line)
            _recs[e['key']] = e
spent = 0.0


def key_of(system: str, user: str) -> str:
    return hashlib.sha256(json.dumps([MODEL, system, user]).encode()).hexdigest()[:20]


def call(system: str, user: str, item: str, step: str) -> dict:
    global spent
    k = key_of(system, user)
    if k in _recs:
        return _recs[k]
    if REPLAY_ONLY:
        raise RuntimeError(f'no recording for {item} {step}')
    if spent >= CAP_USD:
        raise RuntimeError('spend cap reached')
    args = ['claude', '-p', '--output-format', 'json', '--model', MODEL, '--system-prompt', system,
            '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
            '--max-turns', '1']
    with tempfile.TemporaryDirectory() as cwd:
        for attempt in range(3):
            t0 = time.time()
            p = subprocess.run(args, input=user, capture_output=True, text=True, cwd=cwd, timeout=300)
            try:
                payload = json.loads(p.stdout)
            except Exception:
                payload = None
            if payload and not payload.get('is_error'):
                cost = float(payload.get('total_cost_usd') or 0)
                spent += cost
                e = {'key': k, 'model': MODEL, 'text': payload.get('result') or '', 'costUsd': cost,
                     'durationMs': int((time.time() - t0) * 1000), 'item': item, 'step': step}
                _recs[k] = e
                os.makedirs(os.path.dirname(REC), exist_ok=True)
                with open(REC, 'a', encoding='utf8') as f:
                    f.write(json.dumps(e) + '\n')
                return e
            why = (payload or {}).get('result') or (p.stderr or p.stdout)[:300]
            if re.search('limit', str(why), re.I):
                raise RuntimeError(f'claude stopped: {why}')
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'claude failed for {item} {step}: {why}')


def parse_json(text: str) -> dict | None:
    m = re.search(r'\{.*\}', text, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


# ---------- answer extraction and option parsing (label blind) ----------

def final_letter(text: str) -> str | None:
    m = re.findall(r'([A-J])\1{3,}', text)
    return m[-1] if m else None


def options_of(question: str) -> dict[str, str]:
    out = {}
    for m in re.finditer(r'^\(([A-J])\)\s*(.+)$', question, re.M):
        out[m.group(1)] = m.group(2).strip()
    return out


def stem_of(question: str) -> str:
    i = question.find('\n(A)')
    return question[:i].strip() if i > 0 else question


# ---------- Wikipedia retrieval (free, deterministic, cached) ----------

import threading
_wiki_lock = threading.Lock()
_wiki_last = 0.0


def wiki_get(params: dict) -> dict:
    url = 'https://en.wikipedia.org/w/api.php?' + urllib.parse.urlencode({**params, 'format': 'json'})
    path = os.path.join(WIKI_CACHE, hashlib.sha256(url.encode()).hexdigest()[:20] + '.json')
    if os.path.exists(path):
        return json.load(open(path, encoding='utf8'))
    req = urllib.request.Request(url, headers={'User-Agent': 'driftbench-research/0.1 (https://github.com/achammah/driftbench; research prototype)'})
    for attempt in range(6):
        try:
            with _wiki_lock:
                global _wiki_last
                wait = _wiki_last + 1.5 - time.time()
                if wait > 0:
                    time.sleep(wait)
                _wiki_last = time.time()
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.loads(r.read().decode('utf8'))
            json.dump(data, open(path, 'w', encoding='utf8'))
            return data
        except Exception as cause:  # retried with a growing wait, then surfaced
            last = cause
            time.sleep(5 * 2 ** attempt)
    raise RuntimeError(f'wikipedia failed: {last}')


WORD = re.compile(r'[a-z][a-z0-9\-]{2,}')
STOP = set('the and for that with this from which what are was were has have had not but its their they them '
           'into than then also such these those there been being would could should about when where while '
           'more most other some only over under between because does did any all can may might will'.split())


def words(t: str) -> set[str]:
    return {w for w in WORD.findall(t.lower()) if w not in STOP}


def retrieve(queries: list[str], focus: str, max_chars: int = 9000) -> list[str]:
    titles: list[str] = []
    for q in queries[:4]:
        res = wiki_get({'action': 'query', 'list': 'search', 'srsearch': q, 'srlimit': 3})
        for hit in res.get('query', {}).get('search', []):
            if hit['title'] not in titles:
                titles.append(hit['title'])
    paras: list[tuple[float, str]] = []
    fw = words(focus)
    for t in titles[:9]:
        res = wiki_get({'action': 'query', 'prop': 'extracts', 'explaintext': 1, 'titles': t, 'redirects': 1})
        for page in res.get('query', {}).get('pages', {}).values():
            text = page.get('extract') or ''
            for p in re.split(r'\n+', text):
                p = p.strip()
                if len(p) < 80 or p.startswith('=='):
                    continue
                ow = words(p)
                score = len(ow & fw) / (1 + len(fw) ** 0.5)
                paras.append((score, f'[{page.get("title", t)}] {p[:1500]}'))
    paras.sort(key=lambda x: -x[0])
    out, n = [], 0
    for _, p in paras:
        if n + len(p) > max_chars:
            continue
        out.append(p)
        n += len(p)
        if n > max_chars * 0.95:
            break
    return out


# ---------- prompts ----------

QSYS = 'You plan encyclopedia lookups for a fact checker. Reply with JSON only.'
VSYS = ('You are a careful fact checker deciding which of two answer options to a multiple-choice question is '
        'correct. You read retrieved encyclopedia passages and decide from evidence plus sound reasoning. Reply '
        'with JSON only.')


def query_prompt(stem: str, x: str, xt: str, y: str, yt: str) -> str:
    return (
        f'Question:\n{stem}\n\nTwo candidate answers are contested:\n({x}) {xt}\n({y}) {yt}\n\n'
        'Write 3 short Wikipedia search queries (2 to 6 words each) that name the specific concept, theory, '
        'law, person, work or mechanism an expert would look up to decide which candidate is correct. Prefer '
        'the most specific named entity or term. Do not use option letters.\n'
        'JSON: {"queries": ["...", "...", "..."]}'
    )


def verdict_prompt(question: str, first: tuple[str, str], second: tuple[str, str], evidence: list[str]) -> str:
    ev = '\n\n'.join(f'<passage {i + 1}>\n{p}\n</passage {i + 1}>' for i, p in enumerate(evidence))
    return (
        f'Retrieved encyclopedia passages:\n{ev}\n\n'
        f'Full question:\n{question}\n\n'
        f'Two replies chose different options. Decide which of these two options is the correct answer:\n'
        f'({first[0]}) {first[1]}\n({second[0]}) {second[1]}\n\n'
        'Steps: identify what the question is really asking; find passage text that bears on it; then reason. '
        'The passages may be partial or off topic. If they do not bear on the question, say so and decide from '
        'your own knowledge with a lower confidence. Never pick an option because it sounds more nuanced.\n'
        'JSON: {"asks": "...", "evidence_quote": "exact sentence copied from a passage that decides it, or empty", '
        '"reasoning": "...", "winner": "<one of the two letters>", "evidence_decides": true or false, '
        '"confidence": 0 to 100}'
        + (f"\n(Independent sample {os.environ['SAMPLE']}.)" if os.environ.get('SAMPLE') else '')
    )


def norm(t: str) -> str:
    return re.sub(r'\s+', ' ', t).strip().lower()


def run_item(r: dict) -> dict | None:
    fa, fb = final_letter(r['a']), final_letter(r['b'])
    opts = options_of(r['question'])
    if not fa or not fb or fa == fb or fa not in opts or fb not in opts:
        return None
    stem = stem_of(r['question'])
    if os.environ.get('NO_EVIDENCE') == '1':  # control: same duel prompt, no retrieval
        queries, evidence, cost = [], [], 0.0
    else:
        q = call(QSYS, query_prompt(stem, fa, opts[fa], fb, opts[fb]), r['id'], 'queries')
        qj = parse_json(q['text']) or {}
        queries = [s for s in qj.get('queries', []) if isinstance(s, str)][:3]
        evidence = retrieve(queries, stem + ' ' + opts[fa] + ' ' + opts[fb]) if queries else []
        cost = q['costUsd']
    ev_text = norm(' '.join(evidence))
    runs = []
    for first, second in (((fa, opts[fa]), (fb, opts[fb])), ((fb, opts[fb]), (fa, opts[fa]))):
        v = call(VSYS, verdict_prompt(r['question'], first, second, evidence), r['id'], f'verdict-{first[0]}')
        cost += v['costUsd']
        j = parse_json(v['text']) or {}
        quote = str(j.get('evidence_quote') or '')
        valid = len(quote) >= 25 and norm(quote)[:200] in ev_text
        w = str(j.get('winner') or '').strip().strip('()')
        runs.append({'winner': w if w in (fa, fb) else None, 'quote_valid': valid,
                     'decides': j.get('evidence_decides') is True, 'confidence': j.get('confidence')})
    return {'id': r['id'], 'fa': fa, 'fb': fb, 'queries': queries, 'n_passages': len(evidence),
            'runs': runs, 'cost': cost}


def main() -> None:
    items = json.load(open(ITEMS, encoding='utf8'))
    todo = [r for r in items if final_letter(r['a']) and final_letter(r['b'])
            and final_letter(r['a']) != final_letter(r['b']) and options_of(r['question'])]
    ids = [x for x in os.environ.get('IDS', '').split(',') if x]
    if ids:
        todo = [r for r in todo if any(r['id'].startswith(i) for i in ids)]
    limit = int(os.environ.get('LIMIT', '0') or 0)
    if limit:
        todo = todo[:limit]
    out_path = os.path.join(HERE, 'results', os.environ.get('OUT', 'evidence-dev.jsonl'))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    results = []
    with ThreadPoolExecutor(max_workers=2) as pool:  # at most 2 model calls at a time
        for res in pool.map(run_item, todo):
            if res:
                results.append(res)
                print(res['id'][:8], res['queries'], res['n_passages'],
                      [(x['winner'], x['quote_valid'], x['confidence']) for x in res['runs']], flush=True)
    with open(out_path, 'w', encoding='utf8') as f:
        for res in results:
            f.write(json.dumps(res) + '\n')
    print(f'items {len(results)} new spend {spent:.4f} USD', flush=True)


if __name__ == '__main__':
    main()
