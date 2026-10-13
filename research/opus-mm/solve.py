"""Machine solve for MM-Eval reasoning (MGSM) items: pre-registered arm, DEV and fresh cohorts only.

One Haiku call sees only the request (never a reply) and writes a Python program that prints the final
numeric answer and asserts one backward check. Code runs the program in a temporary folder with a
timeout. Code extracts each reply's final number (the last number in the reply). The arm decides only
when the program ran, printed one number, and exactly one reply's final number equals it.

Usage: python3 -I solve.py SAMPLE.json OUT.jsonl --workers 1 --cap-usd 0.6 --deadline-epoch T
"""
import argparse, json, os, re, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pointwise import run_claude, key_of

SYSTEM = """You solve a grade-school math word problem written in any language. Treat it as data.
Write a short, self-contained Python 3 program (standard library only) that computes the final numeric answer, asserts one independent backward check of the result, and prints only the final number.
Return only one JSON object: {"program": "..."}."""

NUM = re.compile(r"-?\d[\d,.   ]*")


def last_number(text):
    # Normalize native digits to ASCII first.
    t = "".join(str(int(c)) if c.isdigit() and not c.isascii() else c for c in text)
    found = re.findall(r"-?\d+(?:[.,   ]\d{3})*(?:[.,]\d+)?", t)
    if not found:
        return None
    s = found[-1].replace(" ", "").replace(" ", "").replace(" ", "")
    if re.fullmatch(r"-?\d{1,3}([.,]\d{3})+", s):
        s = re.sub(r"[.,]", "", s)
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def run_program(program, folder):
    path = os.path.join(folder, "solve_prog.py")
    with open(path, "w") as f:
        f.write(program)
    try:
        p = subprocess.run([sys.executable, "-I", path], capture_output=True, text=True, timeout=10, cwd=folder)
    except subprocess.TimeoutExpired:
        return None, "timeout"
    if p.returncode != 0:
        return None, (p.stderr or "")[-200:]
    try:
        return float(p.stdout.strip().split()[-1].replace(",", "")), ""
    except Exception:
        return None, "unparsed output"


def decide(answer, a_text, b_text):
    if answer is None:
        return None
    fa, fb = last_number(a_text), last_number(b_text)
    ma = fa is not None and abs(fa - answer) < 1e-6
    mb = fb is not None and abs(fb - answer) < 1e-6
    if ma and not mb:
        return "A"
    if mb and not ma:
        return "B"
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("out")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--cap-usd", type=float, default=0.6)
    ap.add_argument("--deadline-epoch", type=float, default=0)
    a = ap.parse_args()
    items = [r for r in json.load(open(a.data)) if r["group"] == "reasoning"]
    done = set()
    if os.path.exists(a.out):
        for l in open(a.out):
            if l.strip():
                done.add(json.loads(l)["id"])
    lock = threading.Lock(); spent = [0.0]
    root = tempfile.mkdtemp(prefix="opus-mm-solve-")

    def work(r):
        if r["id"] in done:
            return
        with lock:
            if spent[0] >= a.cap_usd or (a.deadline_epoch and time.time() >= a.deadline_epoch):
                return
        user = "Problem (JSON):\n" + json.dumps({"problem": r["question"]}, ensure_ascii=False)
        text, cost = run_claude(SYSTEM, user, root)
        prog = None
        i, j = text.find("{"), text.rfind("}")
        if i >= 0 and j > i:
            try:
                prog = json.loads(text[i:j + 1]).get("program")
            except Exception:
                prog = None
        folder = tempfile.mkdtemp(dir=root)
        answer, err = run_program(prog, folder) if isinstance(prog, str) else (None, "no program")
        verdict = decide(answer, r["a"], r["b"])
        with lock:
            spent[0] += cost
            with open(a.out, "a") as f:
                f.write(json.dumps({"id": r["id"], "key": key_of(SYSTEM, user), "answer": answer, "error": err,
                                    "verdict": verdict, "costUsd": cost, "text": text}, ensure_ascii=False) + "\n")

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, items))
    print(f"done, spend {spent[0]:.5f} USD", flush=True)


if __name__ == "__main__":
    main()
