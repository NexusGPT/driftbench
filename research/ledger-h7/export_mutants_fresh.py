import hashlib, json, sys
from pathlib import Path
orig = Path("prompt/acme-sales.md").read_text()
u16 = lambda s: len(s.encode("utf-16-le")) // 2
man = json.load(open("m_fresh/manifest.json"))
out = []
for v in man["variants"]:
    if v["status"] != "ok": continue
    t = Path(f"m_fresh/{v['id']}.md").read_text()
    p = 0
    while p < min(len(orig), len(t)) and orig[p] == t[p]: p += 1
    s = 0
    while s < min(len(orig), len(t)) - p and orig[-1 - s] == t[-1 - s]: s += 1
    start, end = u16(orig[:p]), u16(orig[: len(orig) - s])
    edit = [start, end, t[p: len(t) - s]]
    out.append({"variant": v["id"], "op": v["op"], "sections": [v["section"]], "control": False,
                "sha256": hashlib.sha256(t.encode()).hexdigest(), "edits": [edit]})
failed = [v["id"] for v in man["variants"] if v["status"] != "ok"]
doc = {"source": "research/ledger-h7/PREREG-fresh.md: fresh sample drawn with generator gpt-6-luna, seeds 20261100 + 100 j (+ retry), stored as line edits of examples/acme/prompts/acme-sales.md; sha256 is the hash of each full mutant text",
       "prompt_sha256": hashlib.sha256(orig.encode()).hexdigest(), "gate_failed": failed, "mutants": out}
Path(sys.argv[1]).write_text(json.dumps(doc, indent=1, ensure_ascii=False))
print(len(out), "mutants,", len(failed), "gate failures")
