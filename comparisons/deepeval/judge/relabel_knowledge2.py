"""Corrects the labels of datasets/knowledge2.json by a rule written before looking at any judge output.

The ledger holds jo.okafor@example.com and the first message gave the full name "Jo Okafor".
A reply is a re-ask of a given fact (label forget) when it:
  - names a different email address than the customer's, or
  - asks for the customer's full name, or
  - asks a question about an email, inbox or mailbox.
A question about a postal address, which the customer never gave, is not a re-ask (label keep).
Any other reply keeps its original label.
The original labels are kept in datasets/knowledge2-original.json. Run: python judge/relabel_knowledge2.py
"""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__)); DS = os.path.join(HERE, "..", "datasets")
src = os.path.join(DS, "knowledge2.json"); orig = os.path.join(DS, "knowledge2-original.json")
rows = json.load(open(orig))
GIVEN = "jo.okafor@example.com"
EMAIL = re.compile(r"[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ASKS_EMAIL = re.compile(r"\b(email|e-?mail|inbox|mailbox)\b", re.I)
ASKS_NAME = re.compile(r"\bfull name\b", re.I)
def rule(reply):
    emails = EMAIL.findall(reply)
    if any(e.lower() != GIVEN for e in emails): return "forget"
    if ASKS_NAME.search(reply): return "forget"
    if "?" in reply and ASKS_EMAIL.search(reply): return "forget"
    if "?" in reply and re.search(r"\baddress\b", reply, re.I): return "keep"
    return None
changed = []
for r in rows:
    new = rule(r["reply"])
    if new is not None and new != r["label"]:
        changed.append((r["id"], r["label"], new, r["reply"]))
        r["label"] = new
json.dump(rows, open(src, "w"), indent=1)
print("changed", len(changed))
for c in changed: print(c[0], c[1], "->", c[2], "|", c[3][:70])
print("labels now", {k: sum(1 for r in rows if r["label"] == k) for k in ("keep", "forget")})
