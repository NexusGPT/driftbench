"""Seal the complete disclosed TEST pool before any model call."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
EVIDENCE = HERE / 'evidence'
UPSTREAM = 'https://api.github.com/repos/cjj826/LongJudgeBench/contents/data_standardized'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def main():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    listing = json.loads((EVIDENCE / 'upstream-listing.json').read_text())
    alternatives = [r['name'] for r in listing if 'verify' in r['name'].lower()
                    and r['name'].endswith('.jsonl') and 'reference' not in r['name']
                    and r['name'] != 'verify_bench_hard.jsonl']
    if alternatives:
        raise RuntimeError(f'Unexamined alternative verify pool: {alternatives}')
    source = next(r for r in listing if r['name'] == 'verify_bench_hard.jsonl')
    response = urllib.request.urlopen(source['download_url'], timeout=60).read()
    assert hashlib.sha1(b'blob ' + str(len(response)).encode() + b'\0' + response).hexdigest() == source['sha']
    raw = [json.loads(line) for line in response.splitlines() if line.strip()]
    points = [dict(kind='point', id=r['id'], question=r['instruction'],
                   response=r['responses'][0]['content'], correct=r['ground_truth']['gold_correct'] is True,
                   group='correct' if r['ground_truth']['gold_correct'] else 'incorrect') for r in raw]
    ids = {r['id'] for r in points}
    assert len(points) == len(ids) == 316
    scanned = []
    seen = set()
    all_ids = set()
    errors = []
    worktrees = ROOT.parent
    required = ['opus-council', 'codex-jb', 'codex-mm', 'codex-rb', 'codex-verify',
                'codex-wp', 'judge-benchmarks', 'astra-hard']
    for tree in sorted(worktrees.iterdir()):
        if not tree.is_dir() or tree.name.startswith('ledger-'):
            continue
        for directory, folders, files in os.walk(tree):
            folders[:] = [n for n in folders if n not in ('node_modules', '.git', 'dist', '.next')]
            if 'recordings' not in Path(directory).parts:
                continue
            for name in sorted(files):
                if not name.endswith('.jsonl'):
                    continue
                p = Path(directory) / name
                count, hits = 0, set()
                sha = hashlib.sha256()
                with p.open('rb') as stream:
                    for line in stream:
                        sha.update(line)
                        if not line.strip():
                            continue
                        count += 1
                        try:
                            row = json.loads(line)
                        except (UnicodeDecodeError, json.JSONDecodeError) as error:
                            errors.append(dict(path=str(p.relative_to(worktrees)), line=count, error=str(error)))
                            continue
                        if not isinstance(row, dict):
                            continue
                        for key in ('item', 'itemId', 'item_id', 'pair_id', 'pairId', 'id'):
                            value = row.get(key)
                            if isinstance(value, (str, int)):
                                all_ids.add(str(value))
                                if str(value) in ids:
                                    hits.add(str(value))
                seen.update(hits)
                scanned.append(dict(path=str(p.relative_to(worktrees)), rows=count,
                                    sha256=sha.hexdigest(), verifyIds=sorted(hits)))
    test = [r for r in points if hashlib.sha256(f"split:longjudge-verify:{r['id']}".encode()).digest()[0] >= 77]
    dev = [r for r in points if r not in test]
    assert len(test) == 221 and len(dev) == 95
    assert len(ids - seen) == 0, 'Prior exposure cannot be stated for unobserved items'
    write('recorded-id-union.json', sorted(all_ids))
    write('recording-inventory.json', dict(files=scanned, malformedRows=errors,
        requiredWorktrees={n: (worktrees/n).exists() for n in required},
        allRecordedIds=len(all_ids), verifyRecordedIds=sorted(seen), unseenVerifyIds=sorted(ids-seen)))
    write('pool.json', test)
    write('dev.json', dev)
    audit = json.loads((EVIDENCE/'upstream-test-label-audit.json').read_text())
    corrections = {r['id']: r['audited_correct'] for r in audit['items'] if r['verdict'] == 'proved_conflict'}
    assert len(corrections) == 23 and set(corrections) <= {r['id'] for r in test}
    write('audit-map.json', corrections)
    freeze = json.loads((EVIDENCE/'upstream-freeze.json').read_text())
    normalized = json.dumps(test, ensure_ascii=False, separators=(',', ':')).encode()
    assert digest(normalized) == freeze['populationHash'], 'Pool differs from original frozen population'
    checks = {}
    for p in (ROOT/'examples/judge-benchmarks/src').iterdir():
        rel = str(p.relative_to(ROOT))
        actual = digest(p.read_bytes())
        assert actual == freeze['hashes'][rel], f'Frozen source changed: {rel}'
        checks[rel] = actual
    write('seal.json', dict(at=datetime.now(timezone.utc).isoformat(),
        sourceDirectoryUrl=UPSTREAM, sourceFile=source['download_url'], sourceGitBlob=source['sha'],
        sourceSha256=digest(response), sourceItems=len(points), testItems=len(test), devItems=len(dev),
        exposure='previously evaluated split', unseenItems=0, alternateVerifyFiles=alternatives,
        referenceFileIsNotAnIndependentPool=True, corrections=23,
        normalizedPopulationSha256=digest(normalized),
        frozenCascade='558d75de017ecbf243852f5669a1bffeb8d511b9',
        frozenSourceHead='f13242f29ad0ced947907a84ffbb19abaa32f190',
        sourceHashes=checks,
        evidenceHashes={n:digest((EVIDENCE/n).read_bytes()) for n in
                       ['pool.json','dev.json','audit-map.json','upstream-test-label-audit.json',
                        'upstream-listing.json','recorded-id-union.json','recording-inventory.json']},
        budgetUsd=25, concurrency=6, models=['haiku','gpt-6-luna'],
        gemini='pending: billing blocked',
        paidGate='Pushed research/pair-ledger-core contract and PR named in dossier-ledger-core.md'))
    print(json.dumps(dict(testItems=len(test), priorExposure=len(seen), auditCorrections=len(corrections),
                         scannedFiles=len(scanned), malformedRows=len(errors),
                         poolSha256=digest((EVIDENCE/'pool.json').read_bytes()))))


if __name__ == '__main__':
    main()
