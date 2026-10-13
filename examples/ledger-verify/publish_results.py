"""Validate the completed offline bundle, then commit and push only this owned worktree's verify files."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
DOSSIER = Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-verify.md')


def git(*args):
    result = subprocess.run(['git', *args], cwd=ROOT, text=True, capture_output=True, check=True)
    if result.stderr:
        print(result.stderr, end='')
    return result.stdout.strip()


def main():
    assert git('branch', '--show-current') == 'research/ledger-verify'
    final = json.loads((BASE / 'evidence/finalizer-state.json').read_text())
    assert final['status'] == 'offline evidence ready for review'
    if (BASE / 'evidence/haiku-test-timeouts.json').exists():
        recovery = json.loads((BASE / 'evidence/haiku-test-timeout-recovery.json').read_text())
        assert recovery['status'] == 'complete' and recovery['returnedAnswersResent'] == 0
    cells = json.loads((BASE / 'evidence/cells.json').read_text())
    assert cells['fees']['maximumAccountedUsd'] <= 40
    assert not cells['outputLimitErrors']['unmappedLimits']
    if final.get('additionalCompletedModels'):
        lite=json.loads((BASE/'lite/evidence/finalizer-state.json').read_text())
        assert lite['complete'] and lite['status']=='offline evidence ready for review'
        assert cells['additionalCellFees']['maximumAccountedUsd']<=24
        for path,h in json.loads((BASE/'lite/evidence/reporting-freeze.json').read_text())['sourceHashes'].items():
            assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==h,path
    for model in final['completedModels']:
        progress = json.loads((BASE / f'{model}.progress.json').read_text())
        assert progress['phase'] == 'all' and progress['status'] == 'complete'
    freeze = json.loads((BASE / 'evidence/scoring-freeze.json').read_text())
    for path, expected in {**freeze['sourceHashes'], **freeze['implementationHashes']}.items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, path
    for rel in git('diff', '--cached', '--name-only').splitlines():
        assert rel.startswith('examples/ledger-verify/'), 'An unrelated staged change must not be committed'
    # Inspect the explicit owned path inventory before staging; no other worktree is addressed.
    status = git('status', '--short', '--', 'examples/ledger-verify')
    print(status)
    candidates = set(git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'examples/ledger-verify').splitlines())
    secret = re.compile(rb'(?:sk-[A-Za-z0-9_-]{30,}|AIza[A-Za-z0-9_-]{30,}|nxs_[A-Za-z0-9_-]{30,})')
    for rel in candidates:
        path = ROOT / rel
        if path.is_file():
            assert not secret.search(path.read_bytes()), f'Credential-shaped text requires review: {rel}'
    report = (BASE / 'REPORT.md').read_text()
    assert report == DOSSIER.read_text(), 'Report copies differ before publication'
    assert '\u2014' not in report and '\u2013' not in report
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with (BASE / 'CHECKPOINT.md').open('a') as stream:
        stream.write('\n## '+stamp+' verified report publication\n\n')
        stream.write('- Completed models: '+', '.join(final['completedModels'])+'. Offline replay covers '+str(final['phases'])+' finished phases, with zero new provider calls.\n')
        stream.write('- Gemini pending status, if present, is an authorized daily-quota pause. See evidence/gemini-daily-quota-amendment.json and evidence/gemini-reset-watcher.json.\n')
        stream.write('- Fee reconciliation and frozen source hashes pass. No confirmed output-limit envelope remains unmapped.\n')
    git('add', '--', 'examples/ledger-verify')
    staged = git('diff', '--cached', '--name-only').splitlines()
    assert staged and all(p.startswith('examples/ledger-verify/') for p in staged)
    git('commit', '-m', 'research: publish verified LongJudge cells and quota status')
    git('push', 'origin', 'HEAD:refs/heads/research/ledger-verify')
    head = git('rev-parse', 'HEAD')
    remote = git('ls-remote', 'origin', 'refs/heads/research/ledger-verify').split()[0]
    assert head == remote
    with DOSSIER.open('a') as stream:
        stream.write('\nBranch publication verified at '+stamp+': `'+head+'` on `origin/research/ledger-verify`.\n')
    with (DOSSIER.parent.parent / 'spend-ledger.md').open('a') as stream:
        fees = cells['fees']
        stream.write('| '+stamp+' | ledger-verify | cumulative verified report | '+str(fees['settledUsd'])+' USD settled; '+str(fees['unresolvedMaximumUsd'])+' USD unresolved maximum; cap 40 USD | '+', '.join(final['completedModels'])+' complete; no duplicate charge in this status row | '+head+' |\n')
    if final.get('additionalCompletedModels'):
        with (DOSSIER.parent.parent/'spend-ledger.md').open('a') as stream:
            f=cells['additionalCellFees']
            stream.write('| '+stamp+' | verify Flash Lite finish | '+str(f['settledUsd'])+' USD settled; '+str(f['unresolvedMaximumUsd'])+' USD unresolved maximum; cap 24 USD | full 379 units; additional cell, separate from original budget | '+head+' |\n')
    print(json.dumps(dict(status='pushed and remote verified', head=head, completedModels=final['completedModels'])))


if __name__ == '__main__':
    main()
