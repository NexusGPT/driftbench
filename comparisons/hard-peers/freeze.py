"""Write freeze.json: the held-out sets, every prompt and judge source, and the analysis, fixed before any model call.

run.mts and deepeval_run.py refuse to call a model when any listed file differs from its hash here.
Run from the repository root: python3 comparisons/hard-peers/freeze.py
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent

CLASSES = {
    'partial-credit': 'An agent answers most of a multi-part request and drops or half-completes one part, a common outcome of long tool loops.',
    'near-miss': 'An agent copies a neighbouring record or transposes two digits, so the plan name, line, price or person is almost the right one.',
    'double-negation': 'An agent hedges with stacked negatives, so the literal assertion has to be resolved before it can be checked.',
    'flattened-trace': 'A logging pipeline flattens user turns, tool calls, tool results and the reply into one text entry, and the judge must find what the agent itself asserted or did.',
    'embedded-instruction': 'The reply or the data carries text addressed to the grader, from a prompt injection or a copied template, that asks for a verdict.',
    'long-one-wrong': 'A long, fluent, mostly correct reply hides one wrong value or one dropped request among correct ones.',
    'unusual-format': 'An agent answers in a JSON object, a table, a YAML block or an uppercase record instead of prose, correct or with one error.',
}
ROW_NOTES = {
    'promptfoo/rubric': 'promptfoo llm-rubric default grading prompt; criterion: all requested facts stated correctly.',
    'promptfoo/factuality': 'promptfoo factuality default prompt; criterion: no contradiction with the reference, a consistent subset passes (so its partial-credit pass case is a correct subset).',
    'promptfoo/pii': 'promptfoo llm-rubric default grading prompt with a personal data rubric and fictional ownership bindings.',
    'promptfoo/goal': 'promptfoo trajectory goal-success default prompt; the persisted final order is given inside the trajectory (full-state form); truth follows the persisted order.',
    'langfuse/correctness': 'Langfuse first-party Correctness template, version 1; truth requires every requested fact and no unsupported addition.',
    'deepeval/task': 'DeepEval 4.2.8 TaskCompletionMetric, default settings.',
    'deepeval/knowledge': 'DeepEval 4.2.8 KnowledgeRetentionMetric, default settings.',
    'deepeval/completeness': 'DeepEval 4.2.8 ConversationCompletenessMetric, default settings; its long-one-wrong fail case drops one of six requests.',
}
PREREGISTRATION = {
    'model': 'Claude Haiku 5.5 on every side, through claude -p --model haiku with the flags of packages/judges/src/clients/claude-cli.ts and DISABLE_PROMPT_CACHING=1.',
    'contestants': {
        'theirs': "Each competitor's own default grader template or metric, unchanged, decoded by the earlier harness's own decoder.",
        'default': 'driftbench default judge from packages/judges/src (buildPrompt, parseJudgeText; one re-ask after an invalid ledger, as single.ts does).',
        'audit': 'driftbench answer-audit, opt-in (judgeAnswerAudit from packages/judges/src; one re-ask after an unparsed answer).',
    },
    'primary_endpoint': 'Per competitor, pooled over all its rows and paired by case: driftbench answer-audit against the competitor default. Exact two-sided McNemar test on the discordant pairs, alpha 0.05. One primary test per competitor.',
    'secondary': 'The same pooled test for driftbench default against the competitor default; per-row counts with Wilson 95 percent intervals; per-class counts. Descriptive only.',
    'scoring': 'A case is right when the verdict equals the constructed label. An answered call with no usable verdict (inconclusive, unparsed, DeepEval error) counts as wrong. A case with no model output after missing-only reruns is excluded from that pair and reported.',
    'langfuse_threshold': 'The continuous Correctness score is read at 1.0 and at 0.5; the competitor is scored at whichever threshold gives it more right cases, which can only favour it.',
    'calls': 'Concurrency 2; every answered call recorded once and never re-sent; a call with no output is retried later, missing-only.',
    'budget': '25 USD total; the first 5 calls are measured and projected before the rest run.',
    'no_peeking': 'Sets, prompts, judge source and analysis are frozen here before any model call on these sets.',
}


AMENDMENT_LANGWATCH = {
    'written': 'After the first frozen run (promptfoo, Langfuse, DeepEval) was recorded and reported, and before any LangWatch call on the new rows.',
    'what_changed': 'run.mts, request.ts and request-old.ts gain a fourth competitor; the original freeze is commit 2452e1001. The recorded answers of the first run replay unchanged: request keys for calls without a schema are computed as before.',
    'rows': 'Three fresh conversation rows of 126 cases (seed 20261014, generate_langwatch.py): task completion, knowledge retention, conversation completeness, in the same seven classes. The two construction defects found after the first run are corrected in these rows; knowledge retention uses the frozen builder unchanged.',
    'competitor': "LangWatch's default judge: the vendored Scenario verdict prompt, per-criterion rules and structured-output schema, rendered by the earlier harness's own functions with its trusted role-separated transcript. Its one declared criterion is the rubric sentence of the shipped criterion driftbench is asked. Structured answers get two turns, then six once, as the earlier harness did.",
    'primary_endpoint': 'Pooled over the three rows, paired by case: driftbench answer-audit against the LangWatch default judge, exact two-sided McNemar, alpha 0.05. Secondary: driftbench default against it. Scoring rules as in the preregistration above.',
    'budget': '8 USD added for LangWatch; the shared cap becomes 33 USD.',
    'disclosure': 'The class design and the two defect corrections were informed by the first run. No driftbench or LangWatch answer on these rows existed when this was written.',
}


def files():
    paths = [HERE / name for name in ['generate.py', 'render_peers.py', 'request.ts', 'request-old.ts', 'run.mts', 'deepeval_run.py', 'score.py', 'freeze.py',
                                   'generate_langwatch.py', 'render_langwatch.mts', 'score_langwatch.py']]
    paths += sorted((HERE / 'sets').glob('*.json')) + sorted((HERE / 'prompts').glob('*.json'))
    paths += [REPO / p for p in [
        'comparisons/promptfoo/hard/run.py', 'comparisons/promptfoo/hard/vendor/defaults.json',
        'comparisons/langfuse/hard/run.py', 'comparisons/langfuse/hard/vendor/managed-evaluators.json',
        'comparisons/langfuse/hard/vendor/correctness.txt', 'comparisons/deepeval/hard/run.py',
        'comparisons/deepeval/hard/recordings.py', 'examples/criteria/task_completion.yaml',
        'examples/criteria/knowledge_retention.yaml', 'examples/criteria/conversation_completeness.yaml',
        'comparisons/langwatch/hard/judges.mts', 'comparisons/langwatch/hard/trusted-adapter-v2.mts',
        'comparisons/langwatch/hard/runner.mts', 'comparisons/langwatch/hard/vendor/prompts.json']]
    paths += sorted((REPO / 'packages/judges/src').rglob('*.ts')) + sorted((REPO / 'packages/core/src').rglob('*.ts'))
    return paths


def main():
    sha = {str(p.relative_to(REPO)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files()}
    sets = {p.stem: len(json.loads(p.read_text())) for p in sorted((HERE / 'sets').glob('*.json'))}
    freeze = {'frozen_at': '2026-10-13T18:52:14+02:00', 'seed': 20261013,
              'cases_per_row': sets, 'classes': CLASSES, 'rows': ROW_NOTES, 'preregistration': PREREGISTRATION,
              'amendment_langwatch': {**AMENDMENT_LANGWATCH, 'frozen_at': datetime.now().astimezone().isoformat(timespec='seconds')},
              'sha256': sha}
    (HERE / 'freeze.json').write_text(json.dumps(freeze, indent=2, ensure_ascii=False) + '\n')
    print(f'frozen {len(sha)} files; rows {sets}')


if __name__ == '__main__':
    main()
