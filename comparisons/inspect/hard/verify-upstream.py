"""Check the verbatim upstream templates and actual majority reducer, with no model call."""
import ast
import itertools
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent
source = ast.parse((ROOT / 'upstream-model.py').read_text())
for name, filename in [
    ('DEFAULT_MODEL_GRADED_QA_TEMPLATE', 'qa-template.txt'),
    ('DEFAULT_MODEL_GRADED_FACT_TEMPLATE', 'fact-template.txt'),
]:
    node = next(n for n in source.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in n.targets))
    assert ast.literal_eval(node.value) == (ROOT / filename).read_text(), filename
instruction = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == 'default_instructions')
namespace = {}
exec(compile(ast.Module(body=[instruction], type_ignores=[]), 'upstream-model.py', 'exec'), namespace)
assert namespace['default_instructions'](False) == (ROOT / 'instructions.txt').read_text()

# Invoke upstream majority_score itself. Only Score bookkeeping is stubbed;
# the threshold and scalar counting are the copied implementation.
class Score:
    def __init__(self, value, answer=None, explanation=None, reason=None, metadata=None):
        self.value = value
        self.answer = answer
        self.explanation = explanation
        self.reason = reason
        self.metadata = metadata

    def _as_scalar(self):
        return self.value

    def model_copy(self, update):
        return Score(**{**vars(self), **update})

functions = {'majority_score', '_count_scalar', '_is_unscored', '_first_scored', '_nan_score', '_reduced_score', '_with_panel_metadata', '_unscored_reason', '_is_reducible'}
tree = ast.parse((ROOT / 'upstream-reducer.py').read_text())
kept = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in functions]
assert len(kept) == len(functions)
for n in kept:
    n.decorator_list = []
program = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *kept], type_ignores=[])
namespace = {'Score': Score, 'math': math, 'Counter': Counter, 'Any': Any}
exec(compile(ast.fix_missing_locations(program), 'upstream-reducer.py', 'exec'), namespace)
reduce = namespace['majority_score']()
checked = []
for votes in itertools.product(['pass', 'fail', 'inconclusive'], repeat=3):
    values = [Score(value={'pass': 'C', 'fail': 'I', 'inconclusive': math.nan}[v]) for v in votes]
    result = reduce(values).value
    actual = 'inconclusive' if isinstance(result, float) and math.isnan(result) else {'C': 'pass', 'I': 'fail'}[result]
    expected = 'pass' if votes.count('pass') >= 2 else 'fail' if votes.count('fail') >= 2 else 'inconclusive'
    assert actual == expected, (votes, actual, expected)
    checked.append({'votes': list(votes), 'outcome': actual})
(ROOT / 'majority-parity.json').write_text(json.dumps(checked, indent=2) + '\n')
print('Three verbatim prompt assets verified; all 27 upstream majority cases agree.')

# Execute the actual single-model scorer with an in-memory generation stub.
# No API or CLI is called. Only transport/Score containers are stubbed.
import asyncio
import re
from types import SimpleNamespace

class FakeModel:
    def __init__(self, text):
        self.text = text

    async def generate(self, messages):
        return SimpleNamespace(completion=self.text, message={})

Score.unscored = staticmethod(lambda **kwargs: Score(None))
names = {'_GRADE_SPACING', '_GRADE_WORD_VALUES', 'DEFAULT_GRADE_PATTERN', '_PERMISSIVE_GRADE_PATTERN'}
constants = [n for n in source.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)]
factory = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == '_model_graded_qa_single')
factory.decorator_list = []
program = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), instruction, *constants, factory], type_ignores=[])
ns = {'Score': Score, 'Model': FakeModel, 're': re, 'omit': lambda value, keys: {}, 'model_scoring_prompt': lambda **kwargs: 'stubbed transport'}
exec(compile(ast.fix_missing_locations(program), 'upstream-model.py', 'exec'), ns)
texts = ['GRADE: C', 'GRADE: I', 'GRADE: Correct', 'GRADE: Incorrect', 'GRADE: Partial', 'GRADE: CI', 'GRADE: C\nGRADE:', 'GRADE: C\nGRADE: P', 'downgrade: C', 'éGRADE: C', 'GRADEé: C', 'GRADE: Céleste', 'GRADE: GRADE: C', 'GRADE: C\nFinal GRADE: Incorrect', 'GRADE\u0085:\u001fC', 'GRADE\u200b:\ufeffI', 'GRADE: C\nGRADE: 🦉']
state = SimpleNamespace(metadata={}, output=SimpleNamespace(completion='submission'), input_text='question')
target = SimpleNamespace(text='criterion')
control = []
for text in texts:
    result = asyncio.run(ns['_model_graded_qa_single']('template', model=FakeModel(text))(state, target))
    outcome = {'C': 'pass', 'I': 'fail', None: 'inconclusive'}[result.value]
    control.append({'text': text, 'outcome': outcome})
(ROOT / 'grade-parity.json').write_text(json.dumps(control, indent=2, ensure_ascii=False) + '\n')
print(f'{len(control)} actual default parser controls recorded, including Unicode and nested grade mentions.')
