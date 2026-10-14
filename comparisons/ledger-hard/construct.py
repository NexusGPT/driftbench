"""Seal eight fresh seeds, labels, full prompts, and the prior payload census."""
import collections, json, random, re, secrets, subprocess
from common import *

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True)

def old_census():
    # Historical versions, not just branch tips: this includes the original,
    # held-out, fresh Astra and map cohorts, including archived cases.
    objects = git('rev-list', '--objects', '--all', '--', 'comparisons/promptfoo/hard', 'comparisons/astra-hard').splitlines()
    sources, hashes = [], set()
    for line in objects:
        oid, _, path = line.partition(' ')
        name = Path(path).name
        if not path.endswith('.json') or not (name in {f'{p}{r}.json' for p in ('', 'heldout-', 'v1-') for r in ROWS} or name.endswith('-cases.json')):
            continue
        raw = subprocess.check_output(['git', 'cat-file', '-p', oid], cwd=ROOT)
        obj = json.loads(raw)
        if not isinstance(obj, list):
            continue
        count = 0
        for item in obj:
            if not isinstance(item, dict) or 'truth' not in item or 'reply' not in item:
                continue
            row = 'rubric' if 'rubric' in name else 'factuality' if 'factuality' in name else 'pii' if 'pii' in name else 'goal' if 'goal' in name else None
            if row:
                hashes.add(sha(payload(item, row)))
                count += 1
        if count:
            sources.append({'git_blob': oid, 'path': path, 'cases': count})
    # Uncommitted earlier case files in any extant worktree are read-only inputs.
    for wt in (ROOT.parent).iterdir():
        if wt == ROOT or not wt.is_dir():
            continue
        for sub in ('comparisons/promptfoo/hard', 'comparisons/astra-hard'):
            base = wt / sub
            if not base.exists():
                continue
            for path in base.rglob('*.json'):
                name = path.name
                if not (name in {f'{p}{r}.json' for p in ('', 'heldout-', 'v1-') for r in ROWS} or name.endswith('-cases.json')):
                    continue
                obj = json.loads(path.read_text())
                if not isinstance(obj, list):
                    continue
                count = 0
                for item in obj:
                    if not isinstance(item, dict) or 'truth' not in item or 'reply' not in item:
                        continue
                    row = next((r for r in ROWS if r in name), None)
                    if row:
                        hashes.add(sha(payload(item, row))); count += 1
                if count:
                    sources.append({'worktree': wt.name, 'path': str(path.relative_to(wt)), 'sha256': digest(path), 'cases': count})
    return {'sources': sources, 'distinct_payloads': len(hashes), 'payload_sha256': sorted(hashes)}

def main():
    if (HERE / 'seal.json').exists():
        raise RuntimeError('A seal already exists. Never regenerate an exposed cohort.')
    fixed = json.loads((HARD / 'candidate-freeze.json').read_text())
    assert native.procedure_fingerprint() == fixed['procedure_sha256']
    seeds_path = HERE / 'seeds.json'
    if not seeds_path.exists():
        dump(seeds_path, {r: [secrets.randbelow(90000000) + 30000000 for _ in range(2)] for r in ROWS})
    seeds = json.loads(seeds_path.read_text())
    census = old_census()
    prior = set(census['payload_sha256'])
    dump(HERE / 'prior-census.json', census)
    metadata = {}
    all_prompts = []
    for row in ROWS:
        combined = []
        for generation, seed in enumerate(seeds[row], 1):
            generated = generator.make_sets(seed, 192)[row]
            # Original non-training phone area codes are constant across seeds.
            # Fresh fictional bindings keep the reserved 555-01xx subscribers
            # and original semantics, with disjoint private/public area codes.
            if row == 'pii':
                areas = ('212', '646') if generation == 1 else ('312', '773')
                for item in generated:
                    for field in ('rubric', 'reply'):
                        item[field] = item[field].replace('415', areas[0]).replace('617', areas[1]) if item.get('contact_kind') == 'phone' else item[field]
            for i, item in enumerate(generated):
                item['id'] = f'ledger-hard-{row}-g{generation}-{i+1:03}'
                item['generation'] = generation
            combined.extend(generated)
        count = collections.Counter((c['kind'], c['truth']) for c in combined)
        assert len(combined) == 384 and len(count) == 24 and set(count.values()) == {16}
        new = {sha(payload(c, row)) for c in combined}
        assert len(new) == 384, (row, 'duplicate payloads')
        assert not (new & prior), (row, 'earlier payload overlap')
        dump(HERE / f'{row}.json', combined)
        metadata[row] = {'seeds': seeds[row], 'n': 384, 'pass': 192, 'fail': 192,
                         'families': dict(collections.Counter(c['kind'] for c in combined)),
                         'unique_full_payloads': len(new), 'prior_overlap': 0,
                         'sha256': digest(HERE / f'{row}.json')}
        for item in combined:
            for side in sides(row):
                p = prompt(item, row, side)
                all_prompts.append({'id': item['id'], 'row': row, 'side': side, 'prompt': p, 'prompt_sha256': sha(p)})
    dump(HERE / 'prompts.json', all_prompts)
    source_paths = [p for p in HERE.iterdir() if p.suffix in ('.py', '.json', '.md') and p.name not in ('seal.json',)]
    source_paths += [HARD / p for p in ('generate.py', 'run.py', 'candidate-freeze.json', 'vendor/defaults.json', 'vendor/provenance.json', 'vendor/grading.ts.txt', 'vendor/LICENSE')]
    seal = {'created': stamp(), 'base_commit': git('rev-parse', 'HEAD').strip(),
            'candidate_procedure_sha256': fixed['procedure_sha256'], 'rows': metadata,
            'models': {'haiku': {'model': 'haiku', 'flags': native.FLAGS, 'reasoning': 'not exposed'},
                       'gpt-6-luna': {'endpoint': 'https://api.openai.com/v1/chat/completions', 'model': 'gpt-6-luna', 'reasoning': 'provider default; omitted', 'temperature': 'omitted', 'price': 'price not published', 'max_completion_tokens': 4096},
                       'gemini-3.8-flash': {'status': 'pending billing; no calls'}},
            'cap_measured_usd': 10, 'haiku_call_reserve_usd': 0.02, 'concurrency': 12,
            'last_call_cutoff': '2026-10-13T20:00:00+00:00',
            'pilot': 'First 20 sealed cases per row, all sides, each model; cost/transport only, retained in final scoring, no outcome tuning.',
            'retries': 'No content or transport retries; failed calls retained and counted wrong. Resume never repeats a started key.',
            'statistics': 'Case-level exact two-sided McNemar; one-sided descriptive; 20000 family bootstrap draws seed 2619092984; pooled default and equal-evidence goal shown separately; Holm across 18 global cells left to collator.',
            'dialect': 'Frozen original criterion ledger now. Separate dialect variant only after core lands and before variant calls is separately frozen.',
            'sha256': {str(p.relative_to(ROOT)): digest(p) for p in sorted(source_paths)}}
    dump(HERE / 'seal.json', seal)
    print(json.dumps({'rows': metadata, 'prior_sources': len(census['sources']), 'prior_payloads': len(prior), 'candidate': seal['candidate_procedure_sha256']}, indent=2))

if __name__ == '__main__':
    main()
