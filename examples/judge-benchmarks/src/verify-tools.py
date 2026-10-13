"""Deterministic, label-blind tools for finite math and logic questions."""
import ast
import itertools
import json
import math
import re
import sys
from fractions import Fraction


def bracket_evidence(question):
    if not question.startswith('Complete the rest of the sequence') or 'Input:' not in question:
        return None
    sequence = ''.join(question.split('Input:', 1)[1].split())
    pairs = dict(zip('([{<', ')]}>'))
    if any(ch not in '()[]{}<>' for ch in sequence):
        return None
    stack = []
    for ch in sequence:
        if ch in pairs:
            stack.append(ch)
        elif not stack or pairs[stack.pop()] != ch:
            return {'tool': 'bracket stack', 'invalid_input': True}
    suffix = ''.join(pairs[ch] for ch in reversed(stack))
    return {'tool': 'bracket stack', 'required_suffix': suffix, 'completed_sequence': sequence + suffix}


def boolean_evidence(question):
    if not question.startswith('From the following five expressions, only one evaluates to true.'):
        return None
    options = re.findall(r'^\(([A-E])\) (.*?)(?=^\([A-E]\)|\Z)', question, re.M | re.S)
    if len(options) != 5:
        return None
    atoms = {}

    def atom(match):
        key = match.group(0)
        if key not in atoms:
            atoms[key] = 'fact' + str(len(atoms))
        return atoms[key]

    allowed = (ast.Expression, ast.BoolOp, ast.UnaryOp, ast.BinOp, ast.Compare, ast.Call,
               ast.Name, ast.Load, ast.Constant, ast.And, ast.Or, ast.Not, ast.USub, ast.UAdd,
               ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Lt, ast.Gt, ast.LtE, ast.GtE)
    codes = []
    for label, raw in options:
        text = re.sub(r'The capital of [^.()]+ is [^.()]+\.', atom, raw)
        text = text.replace('is less than or equal to', '<=').replace('is greater than', '>').strip()
        tree = ast.parse(text, mode='eval')
        literals = {}
        for node in ast.walk(tree):
            if not isinstance(node, allowed):
                return None
            if isinstance(node, ast.Name) and node.id not in ['min', 'max', *atoms.values()]:
                return None
            if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name)
                                             or node.func.id not in ['min', 'max'] or node.keywords):
                return None
            if isinstance(node, ast.Constant) and not isinstance(node.value, bool):
                if not isinstance(node.value, (int, float)):
                    return None
                literals[node] = Fraction(ast.get_source_segment(text, node))
        codes.append((label, tree, literals))
    if len(atoms) > 16:
        return None
    outcomes = set()
    for assignment in itertools.product([False, True], repeat=len(atoms)):
        env = dict(zip(atoms.values(), assignment))
        winners = tuple(label for label, tree, literals in codes if exact_expression(tree, env, literals))
        outcomes.add(winners)
    return {'tool': 'exhaustive Boolean evaluation', 'unknown_factual_atoms': len(atoms),
            'assignments_checked': 2 ** len(atoms), 'possible_true_option_sets': sorted(outcomes),
            'final_answer': next(iter(outcomes))[0] if len(outcomes) == 1 and len(next(iter(outcomes))) == 1 else None,
            'proof_scope': 'Exact rational arithmetic and every truth assignment to capital facts. A unique final answer here does not assume a geography lookup.'}


def exact_expression(node, env, literals):
    """Interpret only the already validated expression tree, without float arithmetic."""
    if isinstance(node, ast.Expression):
        return exact_expression(node.body, env, literals)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            return node.value
        if isinstance(node.value, (int, float)):
            return literals[node]
        raise ValueError('Unsupported constant')
    if isinstance(node, ast.Name):
        return env[node.id]
    if isinstance(node, ast.UnaryOp):
        value = exact_expression(node.operand, env, literals)
        if isinstance(node.op, ast.Not):
            return not value
        return -value if isinstance(node.op, ast.USub) else +value
    if isinstance(node, ast.BoolOp):
        value = False
        for part in node.values:
            value = exact_expression(part, env, literals)
            if isinstance(node.op, ast.And) and not value:
                return value
            if isinstance(node.op, ast.Or) and value:
                return value
        return value
    if isinstance(node, ast.BinOp):
        left = exact_expression(node.left, env, literals)
        right = exact_expression(node.right, env, literals)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        return Fraction(left) / Fraction(right)
    if isinstance(node, ast.Compare):
        left = exact_expression(node.left, env, literals)
        for op, part in zip(node.ops, node.comparators):
            right = exact_expression(part, env, literals)
            okay = (left < right if isinstance(op, ast.Lt) else
                    left > right if isinstance(op, ast.Gt) else
                    left <= right if isinstance(op, ast.LtE) else left >= right)
            if not okay:
                return False
            left = right
        return True
    if isinstance(node, ast.Call):
        values = [exact_expression(part, env, literals) for part in node.args]
        return (min if node.func.id == 'min' else max)(values)
    raise ValueError('Unsupported expression')


ADJECTIVES = {
    'opinion': 'silly terrible wonderful lovely repulsive ridiculous nice awful good mysterious obnoxious',
    'size': 'medium-size normal-size massive little huge large tiny big small midsize enormous',
    'age': 'new archaic old-fashioned ancient old brand-new',
    'shape': 'prismlike rectangular pyramidal circular triangular square spherical',
    'color': 'yellow violet aqua crimson maroon magenta cyan pink blue brown red gray teal white black green indigo',
    'material': 'plastic wood wool iron fiberglass cardboard glass leather rubber cloth paper steel',
    'nationality': 'egyptian chinese turkish vietnamese german bangladeshi mexican russian iranian ethiopian brazilian thai american pakistani japanese nigerian filipino indian indonesian',
    'purpose': 'typing whittling walking smoking hiking exercise snorkeling drinking driving eating',
}
CLASS = {word: group for group, words in ADJECTIVES.items() for word in words.split()}


def adjective_evidence(question):
    if not question.startswith('In a variant of English, we are given'):
        return None
    examples, _, choices = question.partition('In this variant of English, which of the following')
    if not choices:
        return None
    samples = re.findall(r'\(\d+\) (.*?)(?=\(\d+\)|\Z)', examples, re.S)

    def classes(phrase):
        result = []
        for word in phrase.strip().split():
            if word.lower() not in CLASS:
                break  # The trailing noun is not an adjective.
            result.append(CLASS[word.lower()])
        return result

    edges = set()
    for sample in samples:
        groups = classes(sample)
        edges.update((a, b) for n, a in enumerate(groups) for b in groups[n + 1:] if a != b)
    orders = []
    for order in itertools.permutations(ADJECTIVES):
        pos = {group: n for n, group in enumerate(order)}
        if all(pos[a] < pos[b] for a, b in edges):
            orders.append(pos)
    if not orders:
        return {'tool': 'adjective category constraints', 'inconsistent_examples': True}
    options = re.findall(r'^\(([A-J])\) (.*)$', choices, re.M)
    if len(options) != 10:
        return None
    possible = set()
    for pos in orders:
        accepted = ''
        for label, phrase in options:
            groups = classes(phrase)
            if len(groups) < 2:
                return None
            if all(pos[a] < pos[b] for a, b in zip(groups, groups[1:])):
                accepted += label
        possible.add(accepted or 'K')
    return {'tool': 'adjective category constraints', 'consistent_category_orders': len(orders),
            'orders': [[g for g, _ in sorted(pos.items(), key=lambda pair: pair[1])] for pos in orders[:12]],
            'possible_answer_sets': sorted(possible), 'final_answer': next(iter(possible)) if len(possible) == 1 else None,
            'proof_scope': 'Category order is inferred from the given examples, not standard English order. Category meanings are the explicit dictionary in verify-tools.py.'}


def letter_evidence(question):
    if 'identify the first step that was a mistake' not in question:
        return None
    ordinals = {'first': 0, 'second': 1, 'third': 2, 'fourth': 3, 'fifth': 4, 'sixth': 5}
    defects = []
    claims_checked = 0
    for number, text in re.findall(r'Thought (\d+): (.*?)(?=Thought \d+:|\Z)', question, re.S):
        position = re.search(r'(first|second|third|fourth|fifth|sixth) letter', text, re.I)
        if not position:
            continue
        index = ordinals[position.group(1).lower()]
        for word, letter, ordinal in re.findall(r'"([a-z]+)": "([a-z])" \((\d+)\)', text):
            claims_checked += 1
            actual = word[index] if index < len(word) else None
            if actual != letter or ord(letter) - ord('a') + 1 != int(ordinal):
                defects.append({'thought': int(number), 'word': word, 'position': index + 1,
                                'claimed': letter, 'actual': actual, 'claimed_ordinal': int(ordinal)})
    return {'tool': 'word-letter assertion checks', 'claims_checked': claims_checked,
            'first_invalid_letter_claim': min((d['thought'] for d in defects), default=None),
            'defects': defects,
            'proof_scope': 'All explicit letter/ordinal claims. An earlier ordering or missing-word error requires a separate check.'}


def svg_evidence(question):
    if not question.startswith('Suppose we draw this SVG path element:'):
        return None
    path = question.split('element:', 1)[1].split('Out of the following shapes:', 1)[0]
    tokens = re.findall(r'[ML]|[-+]?\d+(?:\.\d+)?', path)
    segments = []
    current = None
    mode = None
    n = 0
    while n < len(tokens):
        if tokens[n] in ['M', 'L']:
            mode = tokens[n]
            n += 1
        if n + 1 >= len(tokens):
            break
        point = (float(tokens[n]), float(tokens[n + 1]))
        n += 2
        if mode == 'L' and current is not None and current != point:
            segments.append((current, point))
        current = point
        mode = 'L'
    if not segments:
        return None

    def sub(a, b):
        return a[0] - b[0], a[1] - b[1]

    def cross(a, b):
        return a[0] * b[1] - a[1] * b[0]

    def dot(a, b):
        return a[0] * b[0] + a[1] * b[1]

    def key(p):
        return round(p[0], 4), round(p[1], 4)

    points = {key(p) for segment in segments for p in segment}
    for (a, b), (c, d) in itertools.combinations(segments, 2):
        u, v = sub(b, a), sub(d, c)
        denominator = cross(u, v)
        if abs(denominator) < 1e-8:
            continue
        t, s = cross(sub(c, a), v) / denominator, cross(sub(c, a), u) / denominator
        if -1e-7 <= t <= 1 + 1e-7 and -1e-7 <= s <= 1 + 1e-7:
            points.add(key((a[0] + t * u[0], a[1] + t * u[1])))
    graph = {p: set() for p in points}
    for a, b in segments:
        u = sub(b, a)
        length2 = dot(u, u)
        hits = [(0, key(a)), (1, key(b))]
        for p in points:
            v = sub(p, a)
            t = dot(v, u) / length2
            tolerance = 0.0002 / math.sqrt(length2)
            if -tolerance <= t <= 1 + tolerance and abs(cross(u, v)) / math.sqrt(length2) < 0.0002:
                hits.append((t, p))
        hits = sorted({p: t for t, p in hits}.items(), key=lambda pair: pair[1])
        hits = [(t, p) for p, t in hits]
        for (_, x), (_, y) in zip(hits, hits[1:]):
            if x != y:
                graph[x].add(y)
                graph[y].add(x)
    leaves = [p for p, neighbors in graph.items() if len(neighbors) < 2]
    while leaves:
        p = leaves.pop()
        for neighbor in list(graph[p]):
            graph[neighbor].remove(p)
            if len(graph[neighbor]) < 2:
                leaves.append(neighbor)
        graph[p].clear()
    around = {p: sorted(neighbors, key=lambda q: math.atan2(q[1] - p[1], q[0] - p[0]))
              for p, neighbors in graph.items()}
    visited = set()
    faces = []
    for start, neighbors in around.items():
        for nxt in neighbors:
            if (start, nxt) in visited:
                continue
            edge = (start, nxt)
            vertices = []
            for _ in range(2 * sum(map(len, around.values())) + 1):
                if edge in visited:
                    break
                visited.add(edge)
                a, b = edge
                vertices.append(a)
                neighbors_b = around[b]
                edge = (b, neighbors_b[(neighbors_b.index(a) - 1) % len(neighbors_b)])
            if edge != (start, nxt) or len(vertices) < 3:
                continue
            area2 = sum(cross(a, b) for a, b in zip(vertices, vertices[1:] + vertices[:1]))
            if area2 <= 1e-6:
                continue
            changed = True
            while changed and len(vertices) > 3:
                changed = False
                clean = []
                for i, p in enumerate(vertices):
                    u, v = sub(p, vertices[i - 1]), sub(vertices[(i + 1) % len(vertices)], p)
                    if abs(cross(u, v)) < 0.0003 * (math.hypot(*u) + math.hypot(*v)) and dot(u, v) > 0:
                        changed = True
                    else:
                        clean.append(p)
                vertices = clean
            edges = [sub(b, a) for a, b in zip(vertices, vertices[1:] + vertices[:1])]
            lens = [math.hypot(*edge) for edge in edges]
            cosine = [dot(edges[i - 1], edges[i]) / (lens[i - 1] * lens[i]) for i in range(len(edges))]
            corners = [cross(edges[i - 1], edges[i]) for i in range(len(edges))]
            equal = max(lens) - min(lens) < 0.0005 * max(lens)
            regular = equal and max(cosine) - min(cosine) < 0.0005
            category = None
            if len(edges) == 3:
                category = 4 if any(abs(v) < 0.0005 for v in cosine) else 3
            elif len(edges) == 4:
                if all(abs(v) < 0.0005 for v in cosine):
                    category = 2 if equal else 1
                else:
                    parallel = [abs(cross(edges[i], edges[i + 2])) / (lens[i] * lens[i + 2]) < 0.0005 for i in range(2)]
                    category = 5 if all(parallel) else 6 if sum(parallel) == 1 else None
            elif len(edges) == 5:
                category = 9 if regular else 7 if all(v > 0 for v in corners) else 8
            elif len(edges) == 6 and regular:
                category = 10
            faces.append({'vertices': vertices, 'sides': len(vertices), 'category': category})
    categories = sorted({face['category'] for face in faces if face['category'] is not None})
    choices = question.split('Options:', 1)[-1]
    matching = []
    for label, text in re.findall(r'^\(([A-P])\) (.*)$', choices, re.M):
        numbers = sorted(set(map(int, re.findall(r'\d+', text))))
        if numbers == categories:
            matching.append(label)
    return {'tool': 'SVG segment graph and bounded-face enumeration', 'categories': categories,
            'bounded_faces': faces, 'matching_options': matching,
            'proof_scope': 'All bounded graph faces, with collinear subdivisions merged and tolerance for five-decimal coordinates. These faces have no interior drawn diagonal. Composite outer cycles with interior lines are not included.'}


if __name__ == '__main__':
    question = sys.stdin.read()
    result = None
    for tool in [bracket_evidence, boolean_evidence, adjective_evidence, letter_evidence, svg_evidence]:
        try:
            result = tool(question)
        except (SyntaxError, ValueError, KeyError, ZeroDivisionError):
            result = None
        if result is not None:
            break
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
