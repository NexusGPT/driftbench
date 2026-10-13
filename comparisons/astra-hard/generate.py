"""Fresh fixed-seed cases from the original construction families; no model calls."""
import ast
import collections
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SEED = 20261217
SIZE = 192


def dump(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    source = ROOT / 'comparisons/promptfoo/hard/generate.py'
    spec = importlib.util.spec_from_file_location('rubric_generator', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    rubric = module.make_sets(SEED, SIZE)['rubric']
    for index, row in enumerate(rubric):
        row['id'] = f'fresh-rubric-{index + 1:03}'

    # Reuse the original loop body verbatim. Only seed, profile count and output
    # destination differ. No existing set is regenerated or written.
    source_lf = ROOT / 'comparisons/langfuse/hard/generate.py'
    tree = ast.parse(source_lf.read_text())
    loop = next(n for n in tree.body if isinstance(n, ast.For))
    assert ast.unparse(loop.iter) == 'range(start, start + 5)'
    loop.iter.args[1].right.value = SIZE // 24
    import random
    rng = random.Random(SEED)
    start = rng.randrange(10, 90)
    namespace = {'start': start, 'prefix': 'fresh-reference-', 'rows': []}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[loop], type_ignores=[])), str(source_lf), 'exec'), namespace)
    reference = namespace['rows']
    rng.shuffle(reference)

    metadata = {'seed': SEED, 'cases_per_row': SIZE, 'reference_profile_start': start,
                'reference_profile_count': SIZE // 24,
                'label_rule': 'Original paired code construction, never model-labelled.',
                'changes': 'New seed; 192 cases; fresh ids; eight reference profiles instead of five. Original family bodies unchanged.',
                'generator_sources': {}, 'rows': {}}
    for path in [source, source_lf]:
        metadata['generator_sources'][str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
    for name, rows, family, truth, old_names in [
        ('promptfoo-rubric', rubric, 'kind', 'truth', ['comparisons/promptfoo/hard/rubric.json', 'comparisons/promptfoo/hard/heldout-rubric.json']),
        ('langfuse-reference', reference, 'family', 'label', ['comparisons/langfuse/hard/hard.json', 'comparisons/langfuse/hard/heldout-cases.json']),
    ]:
        assert len(rows) == SIZE
        counts = collections.Counter((r[family], str(r[truth])) for r in rows)
        assert len(counts) == 24 and set(counts.values()) == {8}
        fields = ['rubric', 'question', 'reply'] if truth == 'truth' else ['query', 'reference', 'output']
        payload = lambda r: tuple(r[f] for f in fields)
        new_payloads = {payload(r) for r in rows}
        assert len(new_payloads) == SIZE
        old = [r for path in old_names for r in json.loads((ROOT / path).read_text())]
        assert not new_payloads.intersection(payload(r) for r in old)
        dump(f'{name}-cases.json', rows)
        metadata['rows'][name] = {'total': SIZE, 'pass': SIZE // 2, 'fail': SIZE // 2,
            'family_counts': dict(collections.Counter(r[family] for r in rows)),
            'overlap_with_prior_payloads': 0}
    dump('generation.json', metadata)
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
