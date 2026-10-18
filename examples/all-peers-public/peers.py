"""Each peer's own shipped grader, rendered from its pinned source and parsed by its own rule.

Pinned sources:
- DeepEval 4.2.8 (pip): ArenaGEval for pairs, GEval for single replies. The library itself runs.
- inspect_ai 0.3.278 (pip): model_graded_qa default template, instructions and GRADE parse.
- Langfuse worker/src/constants/managed-evaluators.json at 64ba74f971cb59dea6a784953026919b26e31376.
- LangWatch services/langevals at e683dd9ea52c148e7678b1c22202dbfea9f1eb9f:
  langevals_langevals/select_best_compare.py (Comparison) and llm_boolean.py.

A grader runs through `call(system, user) -> text`. The claude command takes one system prompt and
one user message, with no tool call or structured output, so a forced function call or an output
schema is asked for as one JSON object in the system text, as comparisons/langfuse/hard does.
"""
import json
import random
import re
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / 'vendor'

LANGFUSE_COMMIT = '64ba74f971cb59dea6a784953026919b26e31376'
LANGWATCH_COMMIT = 'e683dd9ea52c148e7678b1c22202dbfea9f1eb9f'

PAIR_PEERS = ('deepeval', 'langwatch', 'inspect', 'langfuse')
# No native pairwise grader: each reply is scored alone, higher score wins (lead decision, option b).
POINTWISE_PAIR_PEERS = ('inspect', 'langfuse')
POINTWISE_PAIR_LABEL = 'pointwise grader, higher score wins'
POINT_PEERS = ('deepeval', 'inspect', 'langfuse', 'langwatch')


class Unanswered(Exception):
    """The transport returned no model output for this request."""


# ---------------------------------------------------------------- shared JSON reading

def last_json(text, repair=True):
    """The final top-level JSON object (comparisons/langfuse/hard/run.py parse)."""
    text = text.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    depth = start = 0
    in_string = escaped = False
    last = None
    for index, char in enumerate(text):
        if depth == 0:
            if char == '{':
                depth, start, in_string, escaped = 1, index, False, False
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == '{':
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0:
                last = text[start:index + 1]
    if last is None:
        return None
    for candidate in ([last, repair_quotes(last)] if repair else [last]):
        try:
            value = json.loads(candidate)
            return value if isinstance(value, dict) else None
        except (ValueError, TypeError):
            continue
    return None


def repair_quotes(text):
    out = []
    in_string = escaped = False
    for index, char in enumerate(text):
        if not in_string:
            if char == '"':
                in_string = True
            out.append(char)
            continue
        if escaped:
            escaped = False
        elif char == '\\':
            escaped = True
        elif char == '"':
            following = text[index + 1:].lstrip()[:1]
            if not following or following in ',}]:':
                in_string = False
            else:
                out.append('\\')
        out.append(char)
    return ''.join(out)


def flip(game):
    return {'A': 'B', 'B': 'A'}.get(game, game)


# ---------------------------------------------------------------- DeepEval

DEEPEVAL_SYSTEM = 'You answer with one JSON object and nothing else.'  # comparisons/deepeval/hard/run.py SYS


def _deepeval_model(call):
    from deepeval.models.base_model import DeepEvalBaseLLM

    class Model(DeepEvalBaseLLM):
        def __init__(self):
            super().__init__(model='claude-haiku-5-5')

        def load_model(self):
            return None

        def generate(self, prompt):
            # No schema keyword: DeepEval then parses the text with its own trimAndLoadJson.
            return call(DEEPEVAL_SYSTEM, prompt)

        async def a_generate(self, prompt):
            return self.generate(prompt)

        def get_model_name(self):
            return 'claude-haiku-5-5'

    return Model()


class _FixedOrder:
    """Installed once as the `random` module of deepeval.metrics.arena_g_eval.utils.

    DeepEval shuffles the fake contestant names and the contestant order with the global,
    unseeded random module. Here each thread shuffles the fake names with a generator seeded by
    the game, and keeps the contestant order the game asks for, so the two games present reply a
    first and then reply b first."""

    def __init__(self):
        self.local = threading.local()

    def seed(self, value):
        self.local.rng = random.Random(value)

    def shuffle(self, values):
        if len(values) == 2 and all(isinstance(v, tuple) for v in values):
            return  # contestant items: keep the order the game asks for
        self.local.rng.shuffle(values)


_ORDER = _FixedOrder()


def deepeval_pair(item, game, call):
    """One ArenaGEval measure. game 'AB' shows reply a first, 'BA' shows reply b first."""
    from deepeval.metrics import ArenaGEval
    from deepeval.metrics.arena_g_eval import utils as arena_utils
    from deepeval.test_case import ArenaTestCase, Contestant, LLMTestCase, SingleTurnParams

    first, second = (('A', item['a']), ('B', item['b'])) if game == 'AB' else (('B', item['b']), ('A', item['a']))
    case = ArenaTestCase(contestants=[
        Contestant(name=name, test_case=LLMTestCase(input=item['question'], actual_output=text))
        for name, text in (first, second)])
    metric = ArenaGEval(name='preference', criteria=item['criterion'],
                        evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
                        model=_deepeval_model(call), async_mode=False)
    # The reason rewrite is a third call that only renames contestants inside the reason text;
    # the winner is already decided. It is skipped, as comparisons/deepeval/hard skips reason-only calls.
    metric._generate_rewritten_reason = lambda reason, names: reason
    arena_utils.random = _ORDER
    _ORDER.seed(f"{item['id']}:{game}")
    winner = metric.measure(case, _show_indicator=False)
    return winner if winner in ('A', 'B') else None


def deepeval_point(item, call):
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase, SingleTurnParams

    metric = GEval(name='correctness', criteria=item['criterion'],
                   evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
                   model=_deepeval_model(call), async_mode=False)
    metric.measure(LLMTestCase(input=item['question'], actual_output=item['response']), _show_indicator=False)
    return {'pass': bool(metric.is_successful()), 'score': metric.score}


# ---------------------------------------------------------------- Inspect

INSPECT_SYSTEM = 'You are a grader.'  # comparisons/inspect/grader-prompt/grader-probe.mts


def inspect_point(item, call):
    from inspect_ai.model import ModelOutput
    from inspect_ai.scorer import _model as qa

    prompt = qa.model_scoring_prompt(
        template=qa.DEFAULT_MODEL_GRADED_QA_TEMPLATE, question=item['question'],
        output=ModelOutput.from_content(model='submission', content=item['response']),
        criterion=item['criterion'], instructions=qa.default_instructions(False), metadata={})
    text = call(INSPECT_SYSTEM, prompt.text)
    match = re.search(qa._PERMISSIVE_GRADE_PATTERN, text)
    value = match.group(1) if match else None
    if value is not None:
        normalized = value.strip().lower()
        value = (qa._GRADE_WORD_VALUES.get(normalized)
                 or (value.strip().upper() if len(value.strip()) == 1 else None))
        if value not in ('C', 'I'):
            value = None
    return {'pass': None if value is None else value == 'C', 'grade': value}


# ---------------------------------------------------------------- Langfuse

def langfuse_template(name):
    rows = json.loads((VENDOR / 'langfuse-managed-evaluators.json').read_text())
    (row,) = [r for r in rows if r['name'] == name and r.get('version') == 1]
    return row


def langfuse_point(item, call):
    row = langfuse_template('Answer Critic')
    out = row['outputDefinition']
    system = ('Return one JSON object with keys score and reasoning.\n'
              f"score: {out['score']}\nreasoning: {out['reasoning']}")
    # Same split as the promptfoo cell: the rubric slot carries the criterion and the question,
    # the evaluated slot carries the reply.
    variables = {'criteria_definition': f"{item['criterion']} The question: {item['question']}",
                 'input': item['response']}
    user = re.sub(r'{{(\w+)}}', lambda m: variables[m.group(1)], row['prompt'])
    value = last_json(call(system, user)) or {}
    score = value.get('score')
    if isinstance(score, str):
        try:
            score = float(score)
        except ValueError:
            score = None
    if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= 1:
        return {'pass': None, 'score': None}
    return {'pass': score >= 0.5, 'score': float(score)}


# ---------------------------------------------------------------- LangWatch

def _lw_source(name):
    return (VENDOR / 'langwatch' / name).read_text()


def _lw_constant(source, name):
    import ast
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise KeyError(name)


def _function_system(system, name, description, parameters):
    return (f'{system}\n\nAnswer with the function call written as one JSON object of its arguments, and nothing else.\n'
            f'Function: {name}. {description}\nArguments JSON schema: {json.dumps(parameters)}')


def _slot_label(index):
    letters, n = '', index
    while True:
        letters = chr(ord('A') + (n % 26)) + letters
        n = n // 26 - 1
        if n < 0:
            return letters


LANGWATCH_SELECT_SYSTEM = (
    'You are an impartial judge picking the best of several candidate outputs. Reason briefly, then pick the '
    'winning slot label using the provided function call. Judge the candidates\' content only, ignore the order '
    'in which they are presented. In your reasoning write every slot as "Candidate A", "Candidate B" and so on, '
    'never as a bare letter; the winner field still takes the bare label.')


def langwatch_judge(item, ordered, call):
    """One select_best_compare._judge call over candidates in `ordered` (list of (id, text))."""
    source = _lw_source('select_best_compare.py')
    prompt = _lw_constant(source, 'DEFAULT_SELECT_BEST_PROMPT_NO_GOLDEN')
    slot_to_id = {_slot_label(i): cid for i, (cid, _) in enumerate(ordered)}
    block = '\n'.join(f'- {_slot_label(i)}: {text}' for i, (_, text) in enumerate(ordered))
    rendered = prompt
    for key, val in {'input': f"{item['criterion']} The question: {item['question']}", 'golden': '',
                     'candidates': block}.items():
        rendered = rendered.replace('{' + key + '}', val)
    enum = list(slot_to_id) + ['tie']
    parameters = {'type': 'object', 'properties': {
        'reasoning': {'type': 'string', 'description': 'Brief explanation of why the winning candidate is the best reply \u2014 keep it brief.'},
        'winner': {'type': 'string', 'enum': enum, 'description': "The winning slot label. Use 'tie' only when no candidate clearly wins."}},
        'required': ['reasoning', 'winner']}
    system = _function_system(LANGWATCH_SELECT_SYSTEM, 'select_best_verdict',
                              'Record the select-best verdict. Reason first, then pick the winning slot label.', parameters)
    value = last_json(call(system, rendered))
    displayed = value.get('winner') if isinstance(value, dict) else None
    if not isinstance(displayed, str) or not displayed.strip():
        return {'winner': None, 'unanswered': True}
    if displayed == 'tie':
        return {'winner': 'tie'}
    # Unknown slot letters fall back to slot A, as the shipped evaluator does.
    return {'winner': slot_to_id.get(displayed, slot_to_id['A'])}


def langwatch_pair(item, row_index, call):
    """Comparison defaults: seeded shuffle by row index, then swap-and-reconcile over two calls.
    Returns one verdict for the pair: 'A', 'B', 'tie', or None (disagreement or unanswered)."""
    ordered = [('A', item['a']), ('B', item['b'])]
    random.Random(row_index).shuffle(ordered)
    first = langwatch_judge(item, ordered, call)
    second = langwatch_judge(item, list(reversed(ordered)), call)
    if first.get('unanswered') or second.get('unanswered'):
        return None, [first, second]
    return (first['winner'] if first['winner'] == second['winner'] else None), [first, second]


def langwatch_point(item, call):
    # llm_boolean.py: the prompt setting is the task; its default asks only whether the output answers the input.
    task = item['criterion']
    content = f"# Input\n{item['question']}\n\n# Output\n{item['response']}\n\n# Task\n{task}"
    parameters = {'type': 'object', 'properties': {
        'reasoning': {'type': 'string', 'description': 'use this field to ponder and write a short reasoning behind the decision written before a result is actually given'},
        'passed': {'type': 'boolean', 'description': 'your final veredict, reply true or false if the content passes the test or not'}},
        'required': ['reasoning', 'passed']}
    system = _function_system(task + '. Always output a valid json for the function call', 'evaluation',
                              'use this function to write your thoughts on the reasoning, then decide if it passed or not with this json structure',
                              parameters)
    value = last_json(call(system, content))
    passed = value.get('passed') if isinstance(value, dict) else None
    return {'pass': passed if isinstance(passed, bool) else None}


def pointwise_pair(item, grade, call):
    """Score reply a and reply b independently with the peer's pointwise grader; higher wins.
    Returns ('A' | 'B' | 'tie' | None, [read_a, read_b]). None when either reply has no parsed verdict."""
    reads = [grade({'id': item['id'], 'question': item['question'], 'response': item[side],
                    'criterion': item['criterion']}, call) for side in ('a', 'b')]
    values = [None if r.get('pass') is None else (r['score'] if r.get('score') is not None else float(r['pass']))
              for r in reads]
    if None in values:
        return None, reads
    return ('A' if values[0] > values[1] else 'B' if values[1] > values[0] else 'tie'), reads
