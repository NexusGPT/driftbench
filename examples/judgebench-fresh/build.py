# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow>=14"]
# ///
"""Build the "JudgeBench recipe, fresh pool": new response pairs made with the
published JudgeBench construction recipe (Tan et al. 2024, arXiv 2410.12784,
section 3 and appendix A.3 to A.5) from MMLU-Pro and LiveBench questions that
appear in neither published JudgeBench split.

This is NOT the original JudgeBench. Every output carries the dataset name
"JudgeBench recipe, fresh pool".

Recipe, per question:
  1. Sample K responses from one response model.
  2. Grade each response with the source's own answer check (MMLU-Pro: the last
     capital letter A to J repeated five times; LiveBench: its official
     process_results functions, vendored under vendor/livebench).
  3. When the K regex grades are mixed, ask a checker model whether each
     response is correct (the paper's checker prompt) and drop every response
     where the checker and the regex disagree.
  4. A question with at least one correct and one incorrect response left
     gives one pair: one correct and one incorrect response, chosen and
     ordered by a seeded generator keyed on the question.

Selection never reads a judge decision. Questions are visited in a seeded
order per stratum, and a stratum stops when it reaches its pair target.

Commands (run from the repo root):
  uv run examples/judgebench-fresh/build.py sources
  uv run examples/judgebench-fresh/build.py plan
  uv run examples/judgebench-fresh/build.py run --cap-usd 12
  uv run examples/judgebench-fresh/build.py freeze

The run command needs ~/.nexus-secrets/openai.key (read inside the process,
never written). It appends every answer to work/responses.jsonl and
work/checks.jsonl, so a restart resumes without paying twice.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
POOL = HERE / "pool"
sys.path.insert(0, str(HERE / "vendor"))

DATASET_NAME = "JudgeBench recipe, fresh pool"
SEED = "judgebench-recipe-fresh-2026-10-14"
PAIR_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/achammah/driftbench/judgebench-recipe-fresh")

SOURCES = {
    "mmlu-pro": {
        "url": "https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro/resolve/b189ec765aa7ed75c8acfea42df31fdae71f97be/data/test-00000-of-00001.parquet",
        "license": "MIT",
    },
    "livebench-math": {
        "url": "https://huggingface.co/datasets/livebench/math/resolve/bb66571c8ccf32d3df9e6f48b920d3770ff4aacb/data/test-00000-of-00001.parquet",
        "license": "see the LiveBench dataset card",
    },
    "livebench-reasoning": {
        "url": "https://huggingface.co/datasets/livebench/reasoning/resolve/6fc6498a5dfba553f69f4413feabade1f1a2d384/data/test-00000-of-00001.parquet",
        "license": "see the LiveBench dataset card",
    },
}
# Both published JudgeBench splits, used only to exclude their questions.
JUDGEBENCH_FILES = {
    "gpt": "https://raw.githubusercontent.com/ScalerLab/JudgeBench/main/data/dataset%3Djudgebench%2Cresponse_model%3Dgpt-4o-2024-05-13.jsonl",
    "claude": "https://raw.githubusercontent.com/ScalerLab/JudgeBench/main/data/dataset%3Djudgebench%2Cresponse_model%3Dclaude-3-5-sonnet-20240620.jsonl",
}

RESPONSE_MODEL = "gpt-6-luna"
RESPONSE_SETTINGS = {"reasoning_effort": "none", "max_completion_tokens": 4096}
# Deviation from the paper, disclosed in the README: without this line the
# response model often answers with the letter string alone, while the
# published pairs show their working.
RESPONSE_SYSTEM = "Work through the problem step by step, showing your full reasoning, before you give the final answer."
CHECKER_MODEL = "gpt-6-luna"
CHECKER_SETTINGS = {"reasoning_effort": "low", "max_completion_tokens": 2048}
K = 4
PRICES = {"gpt-6-luna": {"input": 0.10, "cached": 0.01, "output": 0.50}}  # USD per million tokens

# Pair targets per stratum. MMLU-Pro is balanced over its 14 categories as in
# appendix A.3; LiveBench takes every eligible question once.
MMLU_PAIRS_PER_CATEGORY = 90
DEV_PAIRS = 150

MMLU_INSTRUCTION = (
    "If you cannot determine the correct multiple-choice answer, take your best guess. "
    "Once you have your answer, please duplicate that letter five times in a single string. "
    "For example, if the answer is K, then write KKKKK.\nLet's think step by step."
)
LETTERS = "ABCDEFGHIJ"

# The paper's checker prompt (appendix A.5), verbatim for multiple choice.
CHECKER_SYSTEM_MC = (
    "I will provide you with a multiple-choice question, a response from an LLM, and the correct option. "
    "Output a valid JSON object containing a single key-value pair, where the key is “is_correct” and "
    "corresponding value is a boolean indicating whether or not the LLM-generated selects the correct option."
)
# Same prompt with the multiple-choice words replaced, for LiveBench answers that are not options.
CHECKER_SYSTEM_OPEN = (
    "I will provide you with a question, a response from an LLM, and the correct answer. "
    "Output a valid JSON object containing a single key-value pair, where the key is “is_correct” and "
    "corresponding value is a boolean indicating whether or not the LLM-generated response gives the correct answer."
)
CHECKER_USER = "<| Question |>\n{question}\n<| LLM Response |>\n{response}\n<| Correct Answer |>\n{ground_truth}"


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def seeded_key(*parts: object) -> str:
    return hashlib.sha256(":".join([SEED, *map(str, parts)]).encode()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=1, ensure_ascii=False, default=str) + "\n", encoding="utf-8")


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ---------------------------------------------------------------- sources


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as response:
        return response.read()


def cmd_sources(_args) -> None:
    import pyarrow.parquet as pq

    manifest = {"sources": {}, "judgebench": {}}
    for name, spec in SOURCES.items():
        raw = WORK / "sources" / f"{name}.parquet"
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_bytes(fetch(spec["url"]))
        rows = pq.read_table(raw).to_pylist()
        write_json(WORK / "sources" / f"{name}.json", rows)
        manifest["sources"][name] = {**spec, "sha256": sha256_file(raw), "rows": len(rows)}
    for split, url in JUDGEBENCH_FILES.items():
        data = fetch(url)
        (WORK / "sources" / f"judgebench-{split}.jsonl").write_bytes(data)
        manifest["judgebench"][split] = {"url": url, "sha256": sha256_bytes(data), "rows": data.count(b"\n")}
    write_json(WORK / "sources" / "manifest.json", manifest)
    print(json.dumps(manifest, indent=1))


def load_source(name: str) -> list[dict]:
    return json.loads((WORK / "sources" / f"{name}.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- candidates


def mmlu_question(row: dict) -> str:
    options = "\n".join(f"({LETTERS[i]}) {option}" for i, option in enumerate(row["options"]))
    return f"{row['question']}\n{options}\n{MMLU_INSTRUCTION}"


def candidates() -> dict[str, list[dict]]:
    """Every eligible question, grouped by stratum, in seeded visiting order."""
    published = read_jsonl(WORK / "sources" / "judgebench-gpt.jsonl") + read_jsonl(WORK / "sources" / "judgebench-claude.jsonl")
    published_mmlu_ids = {str(row["original_id"]) for row in published if row["source"].startswith("mmlu")}
    published_text = {norm(row["question"]) for row in published}
    published_prefix = {text[:160] for text in published_text}

    def seen(question: str) -> bool:
        text = norm(question)
        return text in published_text or text[:160] in published_prefix

    strata: dict[str, list[dict]] = {}
    for row in load_source("mmlu-pro"):
        if str(row["question_id"]) in published_mmlu_ids:
            continue
        question = mmlu_question(row)
        if seen(question) or not (0 <= row["answer_index"] < len(row["options"])):
            continue
        strata.setdefault(f"mmlu-pro-{row['category']}", []).append({
            "qid": f"mmlu-pro:{row['question_id']}", "original_id": str(row["question_id"]),
            "source": f"mmlu-pro-{row['category']}", "question": question,
            "ground_truth": row["answer"], "grader": "mmlu",
            "ground_truth_text": f"({row['answer']}) {row['options'][row['answer_index']]}",
        })
    for name in ("livebench-math", "livebench-reasoning"):
        for row in load_source(name):
            task, subtask = row["task"], row.get("subtask") or ""
            if task == "olympiad":  # excluded in appendix A.3
                continue
            if task not in {"math_comp", "zebra_puzzle", "spatial", "web_of_lies_v2"}:
                continue  # AMPS_Hard needs a symbolic algebra check this script does not vendor
            question = row["turns"][0]
            if seen(question):
                continue
            strata.setdefault(name, []).append({
                "qid": f"{name}:{row['question_id']}", "original_id": row["question_id"], "source": name,
                "question": question, "ground_truth": row["ground_truth"], "grader": task,
                "subtask": subtask, "release_date": str(row.get("livebench_release_date") or ""),
                "ground_truth_text": row["ground_truth"],
            })
    for rows in strata.values():
        rows.sort(key=lambda row: seeded_key("order", row["qid"]))
    return strata


def targets(strata: dict[str, list[dict]]) -> dict[str, int]:
    return {name: (MMLU_PAIRS_PER_CATEGORY if name.startswith("mmlu-pro") else len(rows)) for name, rows in strata.items()}


def cmd_plan(_args) -> None:
    strata = candidates()
    plan = {name: {"eligible": len(rows), "pairTarget": targets(strata)[name]} for name, rows in sorted(strata.items())}
    print(json.dumps(plan, indent=1))
    print("eligible questions:", sum(len(rows) for rows in strata.values()))


# ---------------------------------------------------------------- grading


def grade(item: dict, response: str) -> bool:
    grader = item["grader"]
    if grader == "mmlu":
        found = re.findall(r"([A-J])\1{4}", response)
        return bool(found) and found[-1] == item["ground_truth"]
    from livebench import math_competitions, spatial, web_of_lies_v2, zebra_puzzle

    truth = item["ground_truth"]
    if grader == "math_comp":
        head = item["subtask"].split("_")
        if head[0] == "aime":
            return math_competitions.aime_process_results(truth, response) == 1
        return math_competitions.mathcontest_process_results(truth, response, item["question"]) == 1
    if grader == "zebra_puzzle":
        return zebra_puzzle.get_zebra_puzzle_evaluator(item["release_date"])(truth, response) == 1
    if grader == "spatial":
        return spatial.spatial_process_results(truth, response) == 1
    if grader == "web_of_lies_v2":
        return web_of_lies_v2.web_of_lies_process_results(truth, response) == 1
    raise ValueError(f"no grader for {grader}")


# ---------------------------------------------------------------- model calls


class Ledger:
    def __init__(self, path: Path, cap_usd: float):
        self.path, self.cap, self.lock = path, cap_usd, threading.Lock()
        self.spent = sum(row["usd"] for row in read_jsonl(path))

    def cost(self, model: str, usage: dict) -> float:
        price = PRICES[model]
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        return ((usage["prompt_tokens"] - cached) * price["input"] + cached * price["cached"]
                + usage["completion_tokens"] * price["output"]) / 1e6

    def record(self, entry: dict) -> None:
        with self.lock:
            self.spent += entry["usd"]
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(entry) + "\n")

    def room(self) -> bool:
        with self.lock:
            return self.spent < self.cap


def chat(key: str, model: str, settings: dict, messages: list[dict], json_mode: bool = False) -> dict:
    body = {"model": model, "messages": messages, **settings}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    data = json.dumps(body).encode()
    waits = [5, 20, 60, 120]
    for attempt in range(len(waits) + 1):
        request = urllib.request.Request("https://api.openai.com/v1/chat/completions", data=data,
                                         headers={"authorization": f"Bearer {key}", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            text = error.read()[:400].decode("utf-8", "replace")
            if error.code == 402 or error.code in {400, 401, 403, 404}:
                raise RuntimeError(f"HTTP {error.code}: {text}") from error
            if attempt == len(waits):
                raise RuntimeError(f"HTTP {error.code} after retries: {text}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == len(waits):
                raise RuntimeError(f"transport failure after retries: {error}") from error
        time.sleep(waits[attempt])
    raise AssertionError("unreachable")


def respond(key: str, ledger: Ledger, item: dict, index: int) -> dict:
    try:
        payload = chat(key, RESPONSE_MODEL, RESPONSE_SETTINGS,
                       [{"role": "system", "content": RESPONSE_SYSTEM}, {"role": "user", "content": item["question"]}])
    except RuntimeError as error:
        # The provider refused the prompt: the response is kept as refused and can never enter a pair.
        if "invalid_prompt" not in str(error):
            raise
        return {"qid": item["qid"], "index": index, "model": RESPONSE_MODEL, "finish": "refused", "text": "",
                "usage": None, "usd": 0.0, "error": str(error)[:300]}
    usd = ledger.cost(RESPONSE_MODEL, payload["usage"])
    ledger.record({"kind": "response", "qid": item["qid"], "index": index, "usd": usd})
    choice = payload["choices"][0]
    text = choice["message"].get("content") or ""
    return {"qid": item["qid"], "index": index, "model": payload.get("model", RESPONSE_MODEL),
            "finish": choice.get("finish_reason"), "text": text, "usage": payload["usage"], "usd": usd}


def check(key: str, ledger: Ledger, item: dict, response: dict) -> dict:
    multiple_choice = item["grader"] == "mmlu" or (item["grader"] == "math_comp" and not item["subtask"].startswith("aime"))
    system = CHECKER_SYSTEM_MC if multiple_choice else CHECKER_SYSTEM_OPEN
    user = CHECKER_USER.format(question=item["question"], response=response["text"], ground_truth=item["ground_truth_text"])
    payload = chat(key, CHECKER_MODEL, CHECKER_SETTINGS,
                   [{"role": "system", "content": system}, {"role": "user", "content": user}], json_mode=True)
    usd = ledger.cost(CHECKER_MODEL, payload["usage"])
    ledger.record({"kind": "check", "qid": item["qid"], "index": response["index"], "usd": usd})
    text = payload["choices"][0]["message"].get("content") or ""
    try:
        verdict = json.loads(text).get("is_correct")
    except json.JSONDecodeError:
        verdict = None
    return {"qid": item["qid"], "index": response["index"], "is_correct": verdict if isinstance(verdict, bool) else None,
            "raw": text, "usd": usd}


# ---------------------------------------------------------------- pairing


def usable(item: dict, responses: list[dict], checks: dict[int, dict]) -> tuple[list[dict], list[dict]]:
    """Correct and incorrect responses after the regex and checker agree."""
    good, bad = [], []
    for response in responses:
        if response["finish"] != "stop" or not response["text"].strip():
            continue
        regex = grade(item, response["text"])
        checked = checks.get(response["index"])
        if checked is None or checked["is_correct"] is None or checked["is_correct"] != regex:
            continue
        (good if regex else bad).append(response)
    return good, bad


def make_pair(item: dict, good: list[dict], bad: list[dict]) -> dict:
    rng = random.Random(seeded_key("pair", item["qid"]))
    right, wrong = rng.choice(good), rng.choice(bad)
    right_first = rng.random() < 0.5
    first, second = (right, wrong) if right_first else (wrong, right)
    return {
        "pair_id": str(uuid.uuid5(PAIR_NAMESPACE, item["qid"])),
        "original_id": item["original_id"], "source": item["source"], "question": item["question"],
        "response_model": RESPONSE_MODEL, "response_A": first["text"], "response_B": second["text"],
        "label": "A>B" if right_first else "B>A",
        "dataset": DATASET_NAME,
        "provenance": {"qid": item["qid"], "responseIndexA": first["index"], "responseIndexB": second["index"],
                       "correctResponses": len(good), "incorrectResponses": len(bad)},
    }


# ---------------------------------------------------------------- run


def cmd_run(args) -> None:
    key = (Path.home() / ".nexus-secrets" / "openai.key").read_text().strip()
    WORK.mkdir(parents=True, exist_ok=True)
    ledger = Ledger(WORK / "spend.jsonl", args.cap_usd)
    strata = candidates()
    goal = targets(strata)
    responses_path, checks_path = WORK / "responses.jsonl", WORK / "checks.jsonl"
    responses: dict[str, dict[int, dict]] = {}
    for row in read_jsonl(responses_path):
        responses.setdefault(row["qid"], {})[row["index"]] = row
    checks: dict[str, dict[int, dict]] = {}
    for row in read_jsonl(checks_path):
        checks.setdefault(row["qid"], {})[row["index"]] = row
    write_lock = threading.Lock()

    def append(path: Path, row: dict) -> None:
        with write_lock, path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def process(item: dict) -> dict | None:
        have = responses.setdefault(item["qid"], {})
        for index in range(K):
            if index not in have:
                if not ledger.room():
                    return None
                row = respond(key, ledger, item, index)
                have[index] = row
                append(responses_path, row)
        ordered = [have[index] for index in range(K)]
        regex = [grade(item, row["text"]) for row in ordered if row["finish"] == "stop" and row["text"].strip()]
        if not (any(regex) and not all(regex)):
            return None
        done = checks.setdefault(item["qid"], {})
        for row in ordered:
            if row["index"] not in done:
                if not ledger.room():
                    return None
                verdict = check(key, ledger, item, row)
                done[row["index"]] = verdict
                append(checks_path, verdict)
        good, bad = usable(item, ordered, done)
        return make_pair(item, good, bad) if good and bad else None

    pairs: dict[str, list[dict]] = {name: [] for name in strata}
    cursor = {name: 0 for name in strata}
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        while ledger.room():
            batch = []
            for name, rows in sorted(strata.items()):
                need = goal[name] - len(pairs[name])
                if need <= 0 or cursor[name] >= len(rows):
                    continue
                # Visit a wave sized from the remaining need; order inside a stratum stays seeded.
                take = rows[cursor[name]: cursor[name] + max(4, need * 2)]
                cursor[name] += len(take)
                batch.extend((name, item) for item in take)
            if not batch:
                break
            results = list(pool.map(lambda pair: (pair[0], process(pair[1])), batch))
            # Accept in seeded order so a stratum keeps the first pairs in its visiting order.
            for name, pair in results:
                if pair is not None and len(pairs[name]) < goal[name]:
                    pairs[name].append(pair)
            total = sum(len(rows) for rows in pairs.values())
            print(f"pairs {total}  spent {ledger.spent:.4f} USD", flush=True)
    visited = {name: cursor[name] for name in strata}
    write_json(WORK / "run-state.json", {"visited": visited, "pairs": {name: len(rows) for name, rows in pairs.items()},
                                          "spentUsd": ledger.spent, "capUsd": args.cap_usd, "complete": ledger.room()})
    with (WORK / "pairs.jsonl").open("w", encoding="utf-8") as handle:
        for name in sorted(pairs):
            for pair in pairs[name]:
                handle.write(json.dumps(pair, ensure_ascii=False) + "\n")
    print(json.dumps({"pairs": {name: len(rows) for name, rows in pairs.items()}, "spentUsd": round(ledger.spent, 4)}, indent=1))


# ---------------------------------------------------------------- freeze


def cmd_freeze(_args) -> None:
    pairs = read_jsonl(WORK / "pairs.jsonl")
    if not pairs:
        raise SystemExit("no pairs: run first")
    ordered = sorted(pairs, key=lambda pair: seeded_key("split", pair["pair_id"]))
    dev, confirm = ordered[:DEV_PAIRS], ordered[DEV_PAIRS:]
    POOL.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, rows in (("dev", dev), ("confirm", confirm)):
        path = POOL / f"{name}.jsonl"
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        files[f"pool/{name}.jsonl"] = sha256_file(path)
    build_inputs = {
        "build.py": sha256_file(Path(__file__)),
        **{f"vendor/livebench/{path.name}": sha256_file(path) for path in sorted((HERE / "vendor" / "livebench").glob("*.py"))},
        "work/sources/manifest.json": sha256_file(WORK / "sources" / "manifest.json"),
        "work/run-state.json": sha256_file(WORK / "run-state.json"),
    }
    def counts(rows: list[dict]) -> dict:
        out: dict[str, int] = {}
        for row in rows:
            group = "mmlu-pro" if row["source"].startswith("mmlu-pro") else row["source"]
            out[group] = out.get(group, 0) + 1
        return dict(sorted(out.items()))

    freeze = {
        "dataset": DATASET_NAME,
        "notTheOriginal": "Built with the published JudgeBench recipe from questions outside both JudgeBench splits. Not ScalerLab/JudgeBench.",
        "seed": SEED, "k": K, "responseModel": RESPONSE_MODEL, "responseSettings": RESPONSE_SETTINGS,
        "responseSystem": RESPONSE_SYSTEM, "checkerModel": CHECKER_MODEL, "checkerSettings": CHECKER_SETTINGS,
        "mmluPairsPerCategory": MMLU_PAIRS_PER_CATEGORY, "devPairs": len(dev), "confirmPairs": len(confirm),
        "dev": counts(dev), "confirm": counts(confirm),
        "labels": {name: {label: sum(row["label"] == label for row in rows) for label in ("A>B", "B>A")}
                   for name, rows in (("dev", dev), ("confirm", confirm))},
        "files": files, "buildInputs": build_inputs,
        "frozenAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rule": "Frozen before any judge call. Design work reads pool/dev.jsonl only; pool/confirm.jsonl is judged once.",
    }
    write_json(HERE / "freeze.json", freeze)
    print(json.dumps(freeze, indent=1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sources").set_defaults(func=cmd_sources)
    sub.add_parser("plan").set_defaults(func=cmd_plan)
    run = sub.add_parser("run")
    run.add_argument("--cap-usd", type=float, required=True)
    run.add_argument("--workers", type=int, default=16)
    run.set_defaults(func=cmd_run)
    sub.add_parser("freeze").set_defaults(func=cmd_freeze)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
