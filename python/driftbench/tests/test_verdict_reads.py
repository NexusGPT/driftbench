"""One reader of a verdict in the Python client: `verdict_of` (results.py). Any other read of a block's `passed`,
`pass` or `status`, a cell's `passed`, `scored` or a comparison of its `state`, or a campaign's `passed`, is how a
block not run gets read as a failure. This walks the syntax tree of every module of the client and finds the
objects by their class, whatever the variable is named: a parameter or a `self` of Block, Cell or
CampaignResult, a value built by their `from_json` or by `run_specs`, and a loop or comprehension variable over
`.blocks` or `.cells`."""

import ast
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "src" / "driftbench"
CLASSES = {"Block", "Cell", "CampaignResult"}
READS = {"passed", "pass", "status", "scored"}
BUILDERS = {"run_specs"}


def annotated(node: ast.expr | None) -> bool:
    if node is None:
        return False
    names = {sub.id for sub in ast.walk(node) if isinstance(sub, ast.Name)}
    names |= {sub.value for sub in ast.walk(node) if isinstance(sub, ast.Constant) and isinstance(sub.value, str)}
    return bool(names & CLASSES)


def built(value: ast.expr) -> bool:
    if not isinstance(value, ast.Call):
        return False
    func = value.func
    if isinstance(func, ast.Attribute) and func.attr == "from_json":
        return isinstance(func.value, ast.Name) and func.value.id in CLASSES
    return isinstance(func, ast.Name) and func.id in BUILDERS


def over_results(iterable: ast.expr) -> bool:
    return any(isinstance(sub, ast.Attribute) and sub.attr in ("blocks", "cells") for sub in ast.walk(iterable))


def targets(target: ast.expr) -> set[str]:
    return {sub.id for sub in ast.walk(target) if isinstance(sub, ast.Name)}


def own_nodes(scope: ast.AST) -> list[ast.AST]:
    """The nodes of one scope, without the bodies of the functions and classes defined in it."""
    nodes: list[ast.AST] = []
    stack = list(ast.iter_child_nodes(scope))
    while stack:
        node = stack.pop()
        nodes.append(node)
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
            stack.extend(ast.iter_child_nodes(node))
    return nodes


def direct_reads(tree: ast.Module, path: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []

    def visit(scope: ast.AST, outer: set[str], class_name: str | None) -> None:
        known = set(outer)
        if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if scope.name == "verdict_of":
                return
            arguments = scope.args.posonlyargs + scope.args.args + scope.args.kwonlyargs
            for index, argument in enumerate(arguments):
                if annotated(argument.annotation) or (index == 0 and argument.arg == "self" and class_name in CLASSES):
                    known.add(argument.arg)
        nodes = own_nodes(scope)
        for node in nodes:
            if isinstance(node, ast.Assign) and built(node.value):
                for target in node.targets:
                    known |= targets(target)
            if isinstance(node, ast.AnnAssign) and annotated(node.annotation):
                known |= targets(node.target)
            if isinstance(node, (ast.For, ast.comprehension)) and over_results(node.iter):
                known |= targets(node.target)
        for node in nodes:
            if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load) and node.attr in READS:
                base = node.value
                if (isinstance(base, ast.Name) and base.id in known) or (
                    isinstance(base, ast.Subscript) and over_results(base.value)
                ):
                    found.append((node.lineno, f"{path}:{node.lineno}: .{node.attr}"))
            if isinstance(node, ast.Compare):
                for side in [node.left, *node.comparators]:
                    if (
                        isinstance(side, ast.Attribute)
                        and side.attr == "state"
                        and isinstance(side.value, ast.Name)
                        and side.value.id in known
                    ):
                        found.append((side.lineno, f"{path}:{side.lineno}: .state compared"))
        for node in nodes:
            if isinstance(node, ast.ClassDef):
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        visit(child, known, node.name)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                if isinstance(node, ast.Lambda):
                    continue
                visit(node, known, class_name)

    visit(tree, set(), None)
    return found


def reads_in(text: str, path: str = "planted.py") -> list[str]:
    return [line for _, line in sorted(direct_reads(ast.parse(text), path))]


def test_no_module_reads_a_verdict_outside_verdict_of():
    found = []
    for path in sorted(SOURCE.glob("*.py")):
        found += reads_in(path.read_text(encoding="utf-8"), path.name)
    assert found == []


def test_the_guard_finds_renamed_reads():
    planted = '''
def describe_cell(cell: "Cell") -> list:
    for result in cell.blocks:
        if result.passed:
            pass
    return []

def gate(paths):
    result = run_specs(paths)
    if not result.passed:
        raise SystemExit(1)

def first(cell: Cell):
    return cell.blocks[0].status

def odd(c: Cell):
    return c.state == "pass"
'''
    found = reads_in(planted)
    assert [line.split(": ")[1] for line in found] == [".passed", ".passed", ".status", ".state compared"]
