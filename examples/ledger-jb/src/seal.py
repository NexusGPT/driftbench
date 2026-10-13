"""Seal JudgeBench response pairs without making any model call."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
WORKTREES = REPO.parent
HISTORICAL = ['opus-council', 'codex-jb', 'codex-mm', 'codex-rb', 'codex-verify', 'codex-wp', 'judge-benchmarks', 'astra-hard']
FALLBACK = {'codex-mm': 'origin/codex/mm-judge', 'astra-hard': 'origin/research/astra-hard-fresh'}
UUID = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.I)
SEED = 'ledger-jb-2026-10-13-v1'


def sha(raw):
    return hashlib.sha256(raw if isinstance(raw, bytes) else raw.encode()).hexdigest()


def write(name, value):
    path = ROOT / 'data' / name
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    return sha(path.read_bytes())


def rows(name):
    return [json.loads(line) for line in (ROOT / 'data' / name).read_text().splitlines() if line.strip()]


def recording(path):
    p = str(path).lower()
    return Path(p).suffix in {'.json', '.jsonl'} and any(x in p for x in ['recording', '/recorded/', 'cassette'])


def scan_exposure():
    inventory, ids, roots = [], set(), []
    for name in HISTORICAL:
        directory = WORKTREES / name
        if directory.exists():
            roots.append({'name': name, 'mode': 'filesystem', 'path': str(directory)})
            for parent, dirs, files in os.walk(directory):
                dirs[:] = sorted(d for d in dirs if d not in {'node_modules', '.git', '.pnpm-store', 'dist'})
                for f in sorted(files):
                    path = Path(parent) / f
                    if not recording(path):
                        continue
                    raw = path.read_bytes()
                    found = set(UUID.findall(raw.decode('utf8')))
                    ids.update(found)
                    inventory.append({'source': f'{name}/{path.relative_to(directory)}', 'sha256': sha(raw), 'bytes': len(raw), 'uuidCount': len(found)})
        else:
            ref = FALLBACK.get(name)
            if not ref:
                raise RuntimeError(f'Missing exposure source without a git fallback: {name}')
            commit = subprocess.check_output(['git', 'rev-parse', ref], cwd=REPO, text=True).strip()
            roots.append({'name': name, 'mode': 'git-fallback', 'ref': ref, 'commit': commit,
                          'limitation': 'Removed worktree: committed recordings only; uncommitted historical recordings cannot be audited.'})
            paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', commit], cwd=REPO, text=True).splitlines()
            for p in paths:
                if not recording(p):
                    continue
                raw = subprocess.check_output(['git', 'show', f'{commit}:{p}'], cwd=REPO)
                found = set(UUID.findall(raw.decode('utf8')))
                ids.update(found)
                inventory.append({'source': f'{name}@{commit}/{p}', 'sha256': sha(raw), 'bytes': len(raw), 'uuidCount': len(found)})
    return ids, inventory, roots


def normalize(row):
    if row['label'] not in ['A>B', 'B>A']:
        raise ValueError(f"Bad label for {row['pair_id']}")
    return {'id': row['pair_id'], 'question': row['question'], 'a': row['response_A'], 'b': row['response_B'],
            'label': row['label'][0], 'group': row['source'].split('-')[0], 'source': row['source'],
            'originalId': row['original_id'], 'responseModel': row['response_model']}


def rank(item, purpose):
    return sha(f"{SEED}:{purpose}:{item['id']}")


def stratified(items, n, purpose):
    groups = sorted(set(x['group'] for x in items))
    buckets = {g: sorted([x for x in items if x['group'] == g], key=lambda x: rank(x, purpose)) for g in groups}
    out = []
    while len(out) < min(n, len(items)):
        for g in groups:
            if buckets[g] and len(out) < n:
                out.append(buckets[g].pop(0))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Explicitly rebuild a seal before any paid call only')
    args = parser.parse_args()
    if (ROOT/'data/seal.json').exists() and not args.refresh:
        raise RuntimeError('Seal exists. Refusing accidental reseal.')
    if any((ROOT/'results').glob('calls*.jsonl')):
        raise RuntimeError('Cannot reseal after recorded calls')
    prior, inventory, roots = scan_exposure()
    claude, gpt = [normalize(r) for r in rows('claude.jsonl')], [normalize(r) for r in rows('gpt.jsonl')]
    eligible = sorted([x for x in claude if x['id'] not in prior], key=lambda x: rank(x, 'test'))
    assert len(set(x['id'] for x in eligible)) == len(eligible)
    dev = [x for x in gpt if hashlib.sha256(f"split:judgebench:{x['id']}".encode()).digest()[0] < 77]
    fixtures = []
    for g in sorted(set(x['group'] for x in dev)):
        bucket = sorted([x for x in dev if x['group'] == g], key=lambda x: rank(x, 'fixture'))
        if len(bucket) < 6:
            raise RuntimeError(f'Only {len(bucket)} dev fixtures for {g}')
        # Three examples per public label, preventing degenerate kappa fixtures.
        for label in ['A', 'B']:
            candidates = [x for x in bucket if x['label'] == label]
            if len(candidates) < 3:
                raise RuntimeError(f'Insufficient balanced fixtures: {g}/{label}')
            fixtures.extend(candidates[:3])
    fixture_ids = {x['id'] for x in fixtures}
    pilot = stratified([x for x in dev if x['id'] not in fixture_ids], 20, 'pilot')
    pilot_ids = {x['id'] for x in pilot}
    noise = stratified([x for x in dev if x['id'] not in fixture_ids | pilot_ids], 30, 'noise')
    assert len(pilot) == 20 and len(noise) == 30
    by_question = {sha(x['question']): x['id'] for x in gpt if x['id'] in prior}
    by_original = {(x['source'], x['originalId']): x['id'] for x in gpt if x['id'] in prior}
    overlap = [{'id': x['id'], 'priorPairId': by_question.get(sha(x['question'])) or by_original.get((x['source'],x['originalId'])),
                'exactQuestion': sha(x['question']) in by_question} for x in eligible
               if sha(x['question']) in by_question or (x['source'], x['originalId']) in by_original]
    artifacts = {}
    for name, value in [('prior-recorded-ids.json', sorted(prior)), ('exposure-inventory.json', {'roots': roots, 'files': inventory}),
                        ('pool.json', eligible), ('dev.json', dev), ('fixtures.json', fixtures), ('pilot.json', pilot),
                        ('noise.json', noise), ('question-overlap.json', overlap)]:
        artifacts[name] = write(name, value)
    for name in ['claude.jsonl', 'gpt.jsonl', 'dataset-metadata.json', 'promptfoo-select-best.txt', 'promptfoo-provenance.json']:
        artifacts[name] = sha((ROOT/'data'/name).read_bytes())
    seal = {'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'seed': SEED,
            'dataset': 'ScalerLab/JudgeBench', 'split': 'claude', 'sourceCount': len(claude), 'eligibleCount': len(eligible),
            'excludedPairIds': sorted(x['id'] for x in claude if x['id'] in prior), 'priorUuidCount': len(prior),
            'recordingFileCount': len(inventory), 'groups': dict(Counter(x['group'] for x in eligible)),
            'questionOverlapCount': len(overlap), 'exactQuestionOverlapCount': sum(x['exactQuestion'] for x in overlap),
            'freshnessClaim': 'Pair ids absent from audited recordings; questions may overlap; missing worktrees audited through committed git snapshots only.',
            'powerRegistration': 'TIE-only: fewer than 440 pairs; no powered per-cell WIN claim expected.',
            'familyDisclosure': 'Claude-generated responses share the Anthropic family with the Haiku judge. Luna has no response-family overlap.',
            'fixtures': {'count': len(fixtures), 'perCategory': 6, 'repeats': 3, 'requiredAllRepeatsCorrect': True, 'minimumKappa': 0.8,
                         'labelSource': 'Published objective dataset labels, not newly authored expert labels.'},
            'pilotCount': len(pilot), 'noiseCount': len(noise), 'noiseRepeats': 3, 'capUsd': 25,
            'models': ['claude-haiku-5-5', 'gpt-6-luna'], 'pendingModels': {'gemini-3.8-flash': 'Owner reports 429 billing quota'},
            'hashes': artifacts}
    write('seal.json', seal)
    print(json.dumps({k:v for k,v in seal.items() if k != 'hashes'}, indent=2))


if __name__ == '__main__':
    main()
