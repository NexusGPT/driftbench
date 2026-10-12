"""Harder relevancy set: two-part asks, replies that answer both, one, the wrong part, or only promise to look.

Label rule, fixed before any judge run: a reply is relevant only if it answers EVERY part of the ask (a paraphrase
counts; extra content does not change the label). A reply that answers one part, answers a part with a fact about
another topic, or only says it will look into the question is irrelevant.
Usage: python gen/gen_hard.py [SEED NAME]   (default: 20261014 relevancy-hard; held-out: 20261015 relevancy-hard2)
"""
import json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__)); SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 20261014
NAME = sys.argv[2] if len(sys.argv) > 2 else "relevancy-hard"
OUT = os.path.join(HERE, "..", "datasets", NAME + ".json")
R = random.Random(SEED)
PARTS = {
 "plan": {"ask": "which plan gives more data", "ans": "Acme Mobile L gives unlimited data for $35 a month", "para": "the Mobile L is our unlimited tier, thirty-five dollars monthly", "wrong": "our store on the high street sells phone cases"},
 "cover": {"ask": "whether my street is covered for fibre", "ans": "fibre is live on your street from $60 a month", "para": "your street is inside the fibre rollout area", "wrong": "you can pay your bill by card in the Acme app"},
 "pay": {"ask": "how I can pay my bill", "ans": "pay by card or bank transfer in the Acme app under Billing", "para": "settle the bill on the app's Billing page, by card or transfer", "wrong": "your technician is booked for Thursday morning"},
 "tech": {"ask": "when my technician will arrive", "ans": "your technician is booked for Thursday between 8 and 12", "para": "a visit is set for Thursday morning, between eight and noon", "wrong": "our family bundle gives 15 percent off each extra line"},
 "family": {"ask": "whether there is a family discount", "ans": "the family bundle gives 15 percent off each extra line", "para": "families get fifteen percent off every line after the first", "wrong": "we can move your service to a new address"},
 "callback": {"ask": "whether someone can call me back", "ans": "a sales advisor will call you back on the number you gave", "para": "an advisor will ring you back on that number", "wrong": "our stores are open from nine to six"},
}
KEYS = list(PARTS)
def cap(t): return t[0].upper() + t[1:]
def ask_of(a, b): return f"Can you tell me {PARTS[a]['ask']}, and {PARTS[b]['ask']}?"
def reply(kind, a, b):
    A, B = PARTS[a], PARTS[b]
    if kind == "full": return f"{cap(A['ans'])}. {cap(B['ans'])}."
    if kind == "para": return f"{cap(A['para'])}; {B['para']}."
    if kind == "extra": return f"{cap(A['ans'])}. {cap(B['ans'])}. We also have a football club offer this month."
    if kind == "one": return f"{cap(A['ans'])}."
    if kind == "wrong": return f"{cap(A['ans'])}. {cap(B['wrong'])}."
    if kind == "vague": return f"Both are good questions, let me look into {A['ask']} and {B['ask']} for you."
    raise ValueError(kind)
PLAN = [("full", 30, "relevant"), ("para", 10, "relevant"), ("extra", 10, "relevant"), ("one", 20, "irrelevant"), ("wrong", 15, "irrelevant"), ("vague", 15, "irrelevant")]
rows = []; n = 0
for kind, count, label in PLAN:
    for _ in range(count):
        a, b = R.sample(KEYS, 2)
        if kind == "one" and R.random() < 0.5: a, b = b, a
        n += 1
        rows.append({"id": f"H{n:03d}", "label": label, "kind": kind, "ask": ask_of(a, b), "reply": reply(kind, a, b)})
R.shuffle(rows)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(rows, open(OUT, "w"), indent=1)
from collections import Counter
print("rows", len(rows), dict(Counter(r["label"] for r in rows)), dict(Counter(r["kind"] for r in rows)))
