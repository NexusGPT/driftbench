"""Render each competitor's own default grader prompt, unchanged, for every held-out case.

promptfoo: the vendored default templates through the earlier harness's own renderer (single substitution pass).
The goal row receives the persisted final order inside the trajectory, the full-state form.
Langfuse: the vendored first-party Correctness template, its three variables filled, and the JSON output
instruction built from the template's own score and reasoning definitions, as the earlier harness did.
DeepEval renders inside its own metric classes at run time (deepeval_run.py). Labels never enter a prompt.
"""
import importlib.util
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def langfuse_template():
    templates = json.loads((ROOT / 'langfuse/hard/vendor/managed-evaluators.json').read_text())
    template = next(t for t in templates if t['name'] == 'Correctness' and not t.get('partner'))
    assert template['prompt'] == (ROOT / 'langfuse/hard/vendor/correctness.txt').read_text()
    system = (f"Return one JSON object with keys score and reasoning.\nscore: {template['outputDefinition']['score']}\n"
              f"reasoning: {template['outputDefinition']['reasoning']}")
    return system, template['prompt']


def main():
    promptfoo = load(ROOT / 'promptfoo/hard/run.py', 'promptfoo_hard_run')
    (HERE / 'prompts').mkdir(exist_ok=True)
    for row in ['rubric', 'factuality', 'pii', 'goal']:
        items = json.loads((HERE / f'sets/promptfoo-{row}.json').read_text())
        prompts = {x['id']: promptfoo.render_peer(x, row, full_state=row == 'goal') for x in items}
        (HERE / f'prompts/promptfoo-{row}-theirs.json').write_text(json.dumps(prompts, ensure_ascii=False, indent=2) + '\n')
    system, template = langfuse_template()
    items = json.loads((HERE / 'sets/langfuse-correctness.json').read_text())
    prompts = {}
    for x in items:
        values = {'query': x['query'], 'generation': x['output'], 'ground_truth': x['reference']}
        prompts[x['id']] = {'system': system,
                            'user': re.sub(r'\{\{(query|generation|ground_truth)\}\}', lambda m: values[m[1]], template)}
    (HERE / 'prompts/langfuse-correctness-theirs.json').write_text(json.dumps(prompts, ensure_ascii=False, indent=2) + '\n')
    print('rendered', sorted(p.name for p in (HERE / 'prompts').iterdir()))


if __name__ == '__main__':
    main()
