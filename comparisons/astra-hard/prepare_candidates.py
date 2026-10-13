"""Register frozen candidate procedures on the primary cohort, with no model calls."""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'candidates'


def main():
    OUT.mkdir(exist_ok=True)
    spec = importlib.util.spec_from_file_location('frozen_candidate', ROOT / 'comparisons/promptfoo/hard/run.py')
    pf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pf)
    expected = 'd7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587'
    assert pf.procedure_fingerprint() == expected
    prompts = []
    for name in ['promptfoo-rubric', 'langfuse-reference']:
        for case in json.loads((HERE / f'{name}-cases.json').read_text()):
            prompt = pf.render_audit(case, 'rubric') if name == 'promptfoo-rubric' else {
                'system': (ROOT / 'comparisons/langfuse/hard/audit.txt').read_text(),
                'user': json.dumps({'query': case['query'], 'reference': case['reference'], 'reply': case['output']}, ensure_ascii=False, separators=(',', ':'))}
            digest = hashlib.sha256(json.dumps([prompt['system'], prompt['user']], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
            prompts.append({'row': name, 'id': case['id'], 'side': 'candidate', **prompt, 'request_sha256': digest})
    assert len(prompts) == 384 and len({r['request_sha256'] for r in prompts}) == 384
    primary = json.loads((HERE / 'prompts.json').read_text())
    assert not {r['request_sha256'] for r in prompts}.intersection(r['request_sha256'] for r in primary)
    (OUT / 'prompts.json').write_text(json.dumps(prompts, ensure_ascii=False, indent=2) + '\n')

    runner = (HERE / 'run.py').read_text()
    replacements = {
        'ROOT = HERE.parents[1]': 'ROOT = HERE.parents[2]',
        "comparisons/astra-hard/preregistration.json": "comparisons/astra-hard/candidates/preregistration.json",
        "assert len(prompts) == 768 and len({p['request_sha256'] for p in prompts}) == 768": "assert len(prompts) == 384 and len({p['request_sha256'] for p in prompts}) == 384",
        "['ours', 'peer']": "['candidate']",
        'astra-hard {row} {side}': 'astra-hard candidate round {row} {side}',
        "spent = sum(r['cost_usd'] for r in prior)": "primary = [json.loads(line) for line in (HERE.parent / 'calls.jsonl').read_text().splitlines()]\n    assert len(primary) == 768 and all(r['success'] for r in primary), 'Finish primary run first'\n    spent = sum(r['cost_usd'] for r in prior) + sum(r['cost_usd'] for r in primary)",
    }
    for old, new in replacements.items():
        assert old in runner, old
        runner = runner.replace(old, new)
    runner = runner.replace('Adjacent requests are both sides of the same case.', 'Adjacent requests are two distinct candidate cases.')
    (OUT / 'run.py').write_text(runner)
    (OUT / '.gitignore').write_text('runtime/\n')
    print('Prepared 384 frozen candidate requests; no model calls.')


if __name__ == '__main__':
    main()
