"""Execute only bounded numeric Python AST. Never exec model text or expose host capabilities."""
import ast
import json
import math
import operator
import sys

OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
       ast.Pow: operator.pow}
CMP = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt,
       ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}


def run(program):
    tree = ast.parse(program)
    if len(list(ast.walk(tree))) > 1000:
        raise ValueError('program too large')
    names, outputs, checks = {}, [], []

    def expr(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float, bool)):
            value = node.value
        elif isinstance(node, ast.Name):
            value = names[node.id]
        elif isinstance(node, ast.BinOp) and type(node.op) in OPS:
            a, b = expr(node.left), expr(node.right)
            if isinstance(node.op, ast.Pow) and abs(b) > 12:
                raise ValueError('power exceeds bound')
            value = OPS[type(node.op)](a, b)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = expr(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in CMP:
            value = CMP[type(node.ops[0])](expr(node.left), expr(node.comparators[0]))
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords and node.func.id in {'abs', 'round', 'min', 'max'}:
            funcs = {'abs': abs, 'round': round, 'min': min, 'max': max}
            value = funcs[node.func.id](*(expr(a) for a in node.args))
        else:
            raise ValueError('unsupported arithmetic syntax: ' + type(node).__name__)
        if not isinstance(value, (int, float, bool)) or not math.isfinite(value) or abs(value) > 1e15:
            raise ValueError('non-finite or unbounded value')
        return value

    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            names[node.targets[0].id] = expr(node.value)
        elif isinstance(node, ast.Assert):
            checked = expr(node.test)
            if checked is not True:
                raise ValueError('backward assertion failed')
            checks.append(ast.unparse(node.test))
        elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == 'print' and len(node.value.args) == 1 and not node.value.keywords:
            outputs.append(expr(node.value.args[0]))
        else:
            raise ValueError('unsupported statement: ' + type(node).__name__)
    if len(outputs) != 1 or not checks:
        raise ValueError('one printed answer and a backward assertion are required')
    return {'answer': str(outputs[0]), 'checks': checks}


if __name__ == '__main__':
    try:
        print(json.dumps(run(json.load(sys.stdin)['program'])))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
