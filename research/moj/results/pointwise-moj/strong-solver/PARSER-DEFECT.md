# Deferred parser defect: first object need not be the answer

This separate defect record does not change the model-only experiment. The frozen parser counts this tuning item as a loss. Product parser review is a later task.

- Item id: `c3e51f4a45069f8d7553d30d1bc8b35d_7817bb9c553c6bb83b982f47843e0f54`.
- Benchmark: blind Verify practice, TUNING half, moj-split-v2. All 49 validation items per solver have usable comparisons.
- Solver: claude-sonnet-5-5.
- Recorded solver request key: `d68006c6c16148e9f5f87b3ac817cc131b5a10d63b2b26d9a5caa99153a73b2d`.
- Parser: `moj/experts.py:first_object`. It returns the first decodable dictionary, including an empty dictionary in prose. It does not require `final_answer`.
- Bracket-stack prose contains `{ }` before the final JSON object. `first_object` returns `{}`. Extraction finds no final answer, so the comparison is skipped.
- The model returns its answer successfully. The threshold fit already includes this loss. No answer is asked again and no parser fix changes this round.

## Exact returned text

```text
Input: < { ( { } ) < > }

Process the stack:
- `<` opens → stack: <
- `{` opens → stack: < {
- `(` opens → stack: < { (
- `{` opens → stack: < { ( {
- `}` closes → stack: < { (
- `)` closes → stack: < {
- `<` opens → stack: < { <
- `>` closes → stack: < {
- `}` closes → stack: <

Remaining open: `<`, so the closing is `>`.

```json
{"final_answer": ">", "confidence": "high"}
```
```

## Reproduction, no model needed

```python
import json
from moj.experts import first_object
from moj.verify_strong_solver import OUT, lines
rows = [r for r in lines(OUT / "calls.jsonl")
        if r["key"] == "d68006c6c16148e9f5f87b3ac817cc131b5a10d63b2b26d9a5caa99153a73b2d" and r.get("answer")]
text = rows[0]["answer"]["text"]
assert first_object(text) == {}
assert json.loads(text.split("```json\n", 1)[1].split("```", 1)[0])["final_answer"] == ">"
```

## Later product check

Locate parsers that accept the first syntactically valid JSON object without checking the expected schema. Test an empty object inside prose before the actual result. No package or validator file is inspected or changed in this round.
