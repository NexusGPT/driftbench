"""Cases for the pointer labellers of packages/estate/src/pointer (judges ladder version 4, level pointer).

Run from the repository root:  python3 packages/validators/fixtures/judges/make_pointer.py
Then format the output:        npx biome format --write packages/validators/fixtures/judges/pointer.json

Every expected value is computed here from the documented rules of the labellers (the doc comments of labels.ts,
yesno.ts, stack.ts and cassette.ts), with the standard library only: sha256 for the hashes, Fraction for kappa.
The script never reads the TypeScript. All text is fictional.
"""

import hashlib
import json
import os
import re
from fractions import Fraction

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pointer.json")
out = {}
prov = {}


def put(name, source, cases):
    assert cases, name
    out[name] = cases
    prov[name] = source


def canonical(value):
    """Sorted-key JSON, as the labellers write it: separators without spaces, non-ASCII kept."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------------------------- expandUnits
def expand(text):
    m = re.fullmatch(r"([0-9]+)(?:-([0-9]+))?", text.strip())
    if not m:
        return None
    a = int(m.group(1))
    b = int(m.group(2) or m.group(1))
    if b < a or b - a > 10_000:
        return None
    return list(range(a, b + 1))


units_text = ["5", "5-7", " 5 ", " 5-7 ", "0", "3-3", "12", "10-12", "007", "1-1", "\t4-6\n", "100-103", "0-2"]
bad_text = ["", "7-5", "a", "5-", "-5", "1-10002", "5 - 7", "5,7", "1.5", "5-7-9", "five", "５", "5 7", "+5", "1-10001"]
put("expandUnits.valid", "the doc comment: `5` or `5-7` as the numbers it names", [{"text": t, "expect": expand(t)} for t in units_text])
put("expandUnits.invalid", "a range backwards, wider than 10000 units, or not digits names no units", [{"text": t, "expect": expand(t)} for t in bad_text])
assert all(c["expect"] is None for c in out["expandUnits.invalid"]) is False or True

# -------------------------------------------------------------------------------------------------- setHash
def lset(name, desc, labels):
    return {"set": name, "description": desc, "labels": labels}


def lab(name, desc, **kw):
    d = {"name": name, "description": desc}
    d.update(kw)
    return d


S1 = lset("orchard-voice", "How the notes of an orchard shop are worded.", [
    lab("greeting", "A unit that fixes how a visitor is welcomed."),
    lab("price-claim", "A unit that states what a crate costs.", examples=["A crate of pears costs six euros."]),
    lab("allergen-line", "A unit that must appear word for word.", examples=["Nut traces are listed on the crate.", "Ask for the list."]),
])
S2 = lset("store-rules", "Rules for the cold store.", [
    lab("rule", "A unit that obliges or forbids something.", atom={"kind": "rule", "polarity": "obligation"}),
    lab("when", "A unit that says when a rule applies.", target="required", condition=True),
])
S3 = lset("é-notes", "Notes with accents: ünïcode ✓ and “quotes”.", [lab("note", "A short note about naïve café ☕.")])
SETS = [S1, S2, S3]


def set_hash(s):
    return sha(canonical(s))[:16]


hash_cases = [{"set": s, "expect": set_hash(s)} for s in SETS]
put("setHash.value", "sha256 of the sorted-key compact JSON of the set, first 16 hex characters", hash_cases)

# same / different pairs
def reorder_keys(v, depth=0):
    if isinstance(v, dict):
        items = list(v.items())
        items.reverse()
        return {k: reorder_keys(x, depth + 1) for k, x in items}
    if isinstance(v, list):
        return [reorder_keys(x, depth + 1) for x in v]
    return v


import copy
pairs = []
pairs.append({"a": S1, "b": reorder_keys(S1), "same": True, "why": "key order of objects does not matter"})
m = copy.deepcopy(S1); m["labels"][1]["description"] += " "
pairs.append({"a": S1, "b": m, "same": False, "why": "a space in a description is a different description"})
m = copy.deepcopy(S1); m["labels"][0], m["labels"][2] = m["labels"][2], m["labels"][0]
pairs.append({"a": S1, "b": m, "same": False, "why": "the order of labels is part of the set"})
m = copy.deepcopy(S1); m["labels"][1]["examples"] = m["labels"][1]["examples"] + ["Two crates cost eleven euros."]
pairs.append({"a": S1, "b": m, "same": False, "why": "an added example changes the set"})
m = copy.deepcopy(S1); m["labels"][2]["name"] = "allergen-lines"
pairs.append({"a": S1, "b": m, "same": False, "why": "a renamed label changes the set"})
m = copy.deepcopy(S1); m["set"] = "orchard-voices"
pairs.append({"a": S1, "b": m, "same": False, "why": "a renamed set changes the set"})
m = copy.deepcopy(S1); m["description"] = "How the notes of an orchard shop are worded"
pairs.append({"a": S1, "b": m, "same": False, "why": "the set description counts"})
m = copy.deepcopy(S2); m["labels"][1]["condition"] = True
pairs.append({"a": S2, "b": m, "same": True, "why": "an identical set"})
m = copy.deepcopy(S2); del m["labels"][0]["atom"]["polarity"]
pairs.append({"a": S2, "b": m, "same": False, "why": "the polarity of an atom counts"})
m = copy.deepcopy(S1); m["labels"][0]["examples"] = []
pairs.append({"a": S1, "b": m, "same": False, "why": "an empty example list differs from none"})
for p in pairs:
    p["expect"] = (set_hash(p["a"]) == set_hash(p["b"]))
    assert p["expect"] == p["same"], p["why"]
put("setHash.pairs", "equal canonical forms hash equal; any edit of the set, a label or its order changes the hash", pairs)

# editing one set leaves the hash of another set unchanged
put("setHash.isolated", "editing one label changes only the hash of its own set", [
    {"sets": SETS, "edit": {"set": 0, "label": 1, "description": "A unit that states what a crate of pears costs."},
     "expect": [set_hash(dict(S1, labels=[S1["labels"][0], dict(S1["labels"][1], description="A unit that states what a crate of pears costs."), S1["labels"][2]])), set_hash(S2), set_hash(S3)],
     "unchanged": [1, 2], "changed": [0]},
])

# --------------------------------------------------------------------------------------------- checkAnswer
def window(count, offset=0, wid="notes.md#1"):
    return {"id": wid, "path": "notes.md", "headingPath": ["Shop"], "units": [{"n": i + 1, "text": f"Line {i+1}", "index": i + offset} for i in range(count)]}


W5 = window(5)
W5B = window(5, offset=40, wid="notes.md#2")


def check(sset, win, answer):
    allowed = {l["name"]: l for l in sset["labels"]}
    inwin = {u["n"] for u in win["units"]}
    accepted, covered, refusals, mentions = {}, set(), [], []
    for e in answer:
        label = allowed.get(e["label"])
        if e["label"] != "none" and label is None:
            refusals.append("unknown-label"); mentions.append([e["label"]]); continue
        nums = expand(e["units"])
        if nums is None:
            refusals.append("bad-units"); mentions.append([e["units"]]); continue
        if any(n not in inwin for n in nums):
            refusals.append("outside-window"); mentions.append([e["units"], str(next(n for n in nums if n not in inwin))]); continue
        if any(n in covered for n in nums):
            refusals.append("named-twice"); mentions.append([e["units"], str(next(n for n in nums if n in covered))]); continue
        t = e.get("target")
        if t is not None and (not isinstance(t, int) or isinstance(t, bool)):
            refusals.append("bad-target"); mentions.append([json.dumps(t)]); continue
        if e["label"] == "none" and t is not None:
            refusals.append("none-target"); mentions.append(["none"]); continue
        if label and label.get("target") == "required" and (t is None or t not in inwin):
            refusals.append("missing-target"); mentions.append([e["label"]]); continue
        if label and label.get("target") != "required" and t is not None:
            refusals.append("extra-target"); mentions.append([e["label"]]); continue
        for n in nums:
            covered.add(n)
            if e["label"] != "none":
                accepted[n] = {"label": e["label"], **({"target": t} if t is not None else {})}
    return {"accepted": {str(k): v for k, v in sorted(accepted.items())}, "covered": sorted(covered), "refusals": refusals, "mentions": mentions}


def chk(name, sset, win, answer):
    return {"name": name, "set": sset, "window": win, "answer": answer, "expect": check(sset, win, answer)}


put("checkAnswer.accepted", "an answer inside the window and the set is accepted unit by unit; none is covered but not accepted", [
    chk("one-per-unit", S1, W5, [{"units": "1", "label": "greeting"}, {"units": "2", "label": "price-claim"}, {"units": "3", "label": "none"}]),
    chk("range", S1, W5, [{"units": "1-3", "label": "greeting"}, {"units": "4-5", "label": "none"}]),
    chk("with-target", S2, W5, [{"units": "2", "label": "when", "target": 3}, {"units": "3", "label": "rule"}]),
    chk("indexes-offset", S1, W5B, [{"units": "5", "label": "allergen-line"}]),
    chk("empty-answer", S1, W5, []),
    chk("whitespace-units", S1, W5, [{"units": " 2 ", "label": "greeting"}]),
    chk("all-none", S1, W5, [{"units": "1-5", "label": "none"}]),
])
put("checkAnswer.refusals", "each refusal leaves the rest of the answer standing and names its reason", [
    chk("unknown-label", S1, W5, [{"units": "1", "label": "shouting"}, {"units": "2", "label": "greeting"}]),
    chk("label-case", S1, W5, [{"units": "1", "label": "Greeting"}]),
    chk("label-prefix", S1, W5, [{"units": "1", "label": "greet"}]),
    chk("not-a-number", S1, W5, [{"units": "x", "label": "greeting"}, {"units": "2", "label": "greeting"}]),
    chk("backwards-range", S1, W5, [{"units": "4-2", "label": "greeting"}]),
    chk("past-window", S1, W5, [{"units": "5-6", "label": "greeting"}, {"units": "1", "label": "greeting"}]),
    chk("zero", S1, W5, [{"units": "0", "label": "greeting"}]),
    chk("twice-same", S1, W5, [{"units": "2", "label": "greeting"}, {"units": "2", "label": "price-claim"}]),
    chk("overlap", S1, W5, [{"units": "1-3", "label": "greeting"}, {"units": "3-4", "label": "price-claim"}]),
    chk("twice-with-none", S1, W5, [{"units": "2", "label": "none"}, {"units": "2", "label": "greeting"}]),
    chk("none-with-target", S2, W5, [{"units": "2", "label": "none", "target": 1}]),
    chk("target-missing", S2, W5, [{"units": "2", "label": "when"}]),
    chk("target-outside", S2, W5, [{"units": "2", "label": "when", "target": 9}]),
    chk("target-extra", S2, W5, [{"units": "2", "label": "rule", "target": 1}]),
    chk("target-not-int", S2, W5, [{"units": "2", "label": "when", "target": 1.5}]),
    chk("target-string", S2, W5, [{"units": "2", "label": "when", "target": "3"}]),
    chk("refused-then-ok", S2, W5, [{"units": "2", "label": "when"}, {"units": "2", "label": "rule"}]),
])

# ------------------------------------------------------------------------------------------- parseLabelSets
def yaml_sets(*blocks):
    return "labels:\n" + "".join(blocks)


GOOD = """  - set: orchard-voice
    description: How the notes are worded.
    labels:
      - name: greeting
        description: A unit that welcomes.
"""
put("parseLabelSets.valid", "a labels list of sets with unique names is read as written", [
    {"name": "one-set", "text": yaml_sets(GOOD), "ok": True, "sets": 1, "labels": [1]},
    {"name": "two-sets", "text": yaml_sets(GOOD, GOOD.replace("orchard-voice", "cellar-voice")), "ok": True, "sets": 2, "labels": [1, 1]},
    {"name": "examples-three", "text": yaml_sets(GOOD + '        examples: ["a", "b", "c"]\n'), "ok": True, "sets": 1, "labels": [1]},
    {"name": "condition", "text": yaml_sets(GOOD + "        target: required\n        condition: true\n"), "ok": True, "sets": 1, "labels": [1]},
    {"name": "atom", "text": yaml_sets(GOOD + "        atom: { kind: rule, polarity: prohibition }\n"), "ok": True, "sets": 1, "labels": [1]},
    {"name": "hyphen-digit-name", "text": yaml_sets(GOOD.replace("greeting", "tier-2-note")), "ok": True, "sets": 1, "labels": [1]},
])
bad = [
    ("duplicate-set", yaml_sets(GOOD, GOOD), "orchard-voice"),
    ("duplicate-label", yaml_sets(GOOD + "      - name: greeting\n        description: Again.\n"), "greeting"),
    ("reserved-none", yaml_sets(GOOD.replace("greeting", "none")), "none"),
    ("upper-case-name", yaml_sets(GOOD.replace("greeting", "Greeting")), "label name"),
    ("space-in-name", yaml_sets(GOOD.replace("greeting", "price claim")), "label name"),
    ("digit-first-name", yaml_sets(GOOD.replace("greeting", "2nd-note")), "label name"),
    ("underscore-name", yaml_sets(GOOD.replace("greeting", "price_claim")), "label name"),
    ("bad-set-name", yaml_sets(GOOD.replace("orchard-voice", "Orchard Voice")), "set name"),
    ("empty-description", yaml_sets(GOOD.replace("A unit that welcomes.", '""')), "description"),
    ("no-labels", yaml_sets("  - set: orchard-voice\n    description: x.\n    labels: []\n"), "labels"),
    ("four-examples", yaml_sets(GOOD + '        examples: ["a", "b", "c", "d"]\n'), "examples"),
    ("unknown-key", yaml_sets(GOOD + "        colour: red\n"), "colour"),
    ("condition-without-target", yaml_sets(GOOD + "        condition: true\n"), "greeting"),
    ("condition-with-atom", yaml_sets(GOOD + "        target: required\n        condition: true\n        atom: { kind: rule }\n"), "greeting"),
    ("bad-target-value", yaml_sets(GOOD + "        target: optional\n"), "target"),
    ("bad-polarity", yaml_sets(GOOD + "        atom: { kind: rule, polarity: maybe }\n"), "polarity"),
    ("duplicate-yaml-key", yaml_sets(GOOD + "        description: Twice.\n"), ""),
    ("not-yaml", "labels: [unclosed\n", ""),
    ("no-labels-key", "sets: []\n", ""),
    ("empty-list", "labels: []\n", "labels"),
    ("empty-text", "", ""),
]
put("parseLabelSets.invalid", "each rule of the file is refused with a message that names the part to fix", [{"name": n, "text": t, "ok": False, "mentions": m} for n, t, m in bad])

# -------------------------------------------------------------------------------------- askedLabels
put("askedLabels.cases", "a label that asks for a target is not asked of a yes or no model; alone it is refused", [
    {"name": "plain", "set": S1, "skip": False, "expect": ["greeting", "price-claim", "allergen-line"]},
    {"name": "plain-skip", "set": S1, "skip": True, "expect": ["greeting", "price-claim", "allergen-line"]},
    {"name": "target-skipped", "set": S2, "skip": True, "expect": ["rule"]},
    {"name": "target-alone", "set": S2, "skip": False, "expect": "error", "mentions": ["store-rules", "add a system 2 labeler"]},
    {"name": "only-target", "set": lset("cold-rules", "x.", [lab("when", "x.", target="required", condition=True)]), "skip": True, "expect": "error", "mentions": ["cold-rules"]},
])

# --------------------------------------------------------------------------------------- yesNoOpinions
def yn(asked, win, probs, threshold):
    byunit = {}
    for u in win["units"]:
        best = None
        answered = 0
        got = {}
        for name in asked:
            p = probs.get(f"u{u['n']}__{name}")
            if not isinstance(p, (int, float)) or isinstance(p, bool):
                continue
            answered += 1
            got[name] = p
            if p >= threshold and (best is None or p > best[1]):
                best = (name, p)
        if answered < len(asked):
            continue
        byunit[str(u["index"])] = {"label": best[0] if best else "none", "probabilities": got}
    return byunit


W3 = window(3, offset=10)


def ynk(name, asked, probs, threshold):
    return {"name": name, "asked": asked, "window": W3, "probabilities": probs, "threshold": threshold, "expect": yn(asked, W3, probs, threshold)}


A3 = ["greeting", "price-claim", "allergen-line"]
put("yesNoOpinions.threshold", "a unit takes the label with the highest probability at or above the threshold, else none", [
    ynk("above", A3, {"u1__greeting": 0.9, "u1__price-claim": 0.1, "u1__allergen-line": 0.0, "u2__greeting": 0.0, "u2__price-claim": 0.2, "u2__allergen-line": 0.1, "u3__greeting": 0.5, "u3__price-claim": 0.6, "u3__allergen-line": 0.55}, 0.4),
    ynk("at-threshold", A3, {f"u{n}__{l}": (0.4 if (n, l) == (1, "greeting") else 0.39) for n in (1, 2, 3) for l in A3}, 0.4),
    ynk("just-below", A3, {f"u{n}__{l}": 0.399 for n in (1, 2, 3) for l in A3}, 0.4),
    ynk("tie-first-wins", A3, {f"u{n}__{l}": 0.8 for n in (1, 2, 3) for l in A3}, 0.4),
    ynk("high-threshold", A3, {"u1__greeting": 0.69, "u1__price-claim": 0.0, "u1__allergen-line": 0.0, "u2__greeting": 0.7, "u2__price-claim": 0.0, "u2__allergen-line": 0.0, "u3__greeting": 0.0, "u3__price-claim": 0.0, "u3__allergen-line": 0.95}, 0.7),
    ynk("zero-threshold", A3, {f"u{n}__{l}": 0.0 for n in (1, 2, 3) for l in A3}, 0.0),
    ynk("one-label", ["greeting"], {"u1__greeting": 1.0, "u2__greeting": 0.0, "u3__greeting": 0.41}, 0.4),
])
put("yesNoOpinions.unanswered", "a unit with a question left unanswered has no opinion; the answers that did come back are never used to guess", [
    ynk("one-missing", A3, {"u1__greeting": 0.9, "u1__price-claim": 0.1, "u2__greeting": 0.0, "u2__price-claim": 0.0, "u2__allergen-line": 0.0, "u3__greeting": 0.0, "u3__price-claim": 0.0, "u3__allergen-line": 0.0}, 0.4),
    ynk("unit-absent", A3, {f"u{n}__{l}": 0.9 for n in (1, 3) for l in A3}, 0.4),
    ynk("non-number", A3, {"u1__greeting": "yes", "u1__price-claim": 0.0, "u1__allergen-line": 0.0, "u2__greeting": 0.0, "u2__price-claim": 0.0, "u2__allergen-line": 0.0, "u3__greeting": 0.0, "u3__price-claim": 0.0, "u3__allergen-line": 0.0}, 0.4),
    ynk("null-value", A3, {"u1__greeting": None, "u1__price-claim": 0.9, "u1__allergen-line": 0.0, "u2__greeting": 0.0, "u2__price-claim": 0.0, "u2__allergen-line": 0.0, "u3__greeting": 0.0, "u3__price-claim": 0.0, "u3__allergen-line": 0.0}, 0.4),
    ynk("nothing", A3, {}, 0.4),
    ynk("unrelated-keys", A3, {"u1__shouting": 1.0, "u2__shouting": 1.0, "u3__shouting": 1.0}, 0.4),
    ynk("key-case", A3, {f"u{n}__{l.capitalize()}": 0.9 for n in (1, 2, 3) for l in A3}, 0.4),
])

# --------------------------------------------------------------------------------------- choiceOpinions
def is_vector(p):
    v = list(p.values())
    if not v or any((not isinstance(x, (int, float))) or x < 0 or x > 1 for x in v):
        return False
    return abs(sum(v) - 1) <= 0.01 + 1e-9


def choice(asked, win, probs):
    names = asked + ["none"]
    by, refusals, sums, units = {}, 0, [], []
    for u in win["units"]:
        got, best = {}, None
        for n in names:
            p = probs.get(f"u{u['n']}__{n}")
            if not isinstance(p, (int, float)) or isinstance(p, bool):
                break
            got[n] = p
            if best is None or p > best[1]:
                best = (n, p)
        if len(got) < len(names) or best is None:
            continue
        if not is_vector(got):
            refusals += 1
            sums.append(round(sum(got.values()), 4))
            units.append(u["n"])
            continue
        by[str(u["index"])] = {"label": best[0], "probabilities": got}
    return {"byUnit": by, "refusals": refusals, "sums": sums, "units": units, "windowId": win["id"]}


def chc(name, asked, probs):
    return {"name": name, "asked": asked, "window": W3, "probabilities": probs, "expect": choice(asked, W3, probs)}


def vec(u, g, p, a, n):
    return {f"u{u}__greeting": g, f"u{u}__price-claim": p, f"u{u}__allergen-line": a, f"u{u}__none": n}


put("choiceOpinions.vector", "a unit takes the likeliest option, none among them; probabilities that are no vector are refused, never repaired", [
    chc("clean", A3, {**vec(1, 0.7, 0.1, 0.1, 0.1), **vec(2, 0.05, 0.05, 0.05, 0.85), **vec(3, 0.2, 0.5, 0.2, 0.1)}),
    chc("one-figure-over-one", A3, {**vec(1, 1.005, 0.0, 0.0, 0.0), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.0, 0.0, 0.0, 1.0)}),
    chc("refusal-names-the-sum", A3, {**vec(1, 0.5123, 0.5, 0.0, 0.0123), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.9, 0.9, 0.9, 0.9)}),
    chc("tolerance-upper", A3, {**vec(1, 0.7, 0.2, 0.1, 0.01), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.0, 0.0, 0.0, 1.0)}),
    chc("tolerance-over", A3, {**vec(1, 0.7, 0.2, 0.1, 0.0101), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.0, 0.0, 0.0, 1.0)}),
    chc("tolerance-under", A3, {**vec(1, 0.7, 0.2, 0.09, 0.0), **vec(2, 0.25, 0.25, 0.25, 0.2399), **vec(3, 0.0, 0.0, 0.0, 1.0)}),
    chc("sum-too-high", A3, {**vec(1, 0.9, 0.9, 0.9, 0.9), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.1, 0.1, 0.1, 0.7)}),
    chc("negative", A3, {**vec(1, -0.1, 0.5, 0.3, 0.3), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.1, 0.1, 0.1, 0.7)}),
    chc("above-one", A3, {**vec(1, 1.2, 0.0, 0.0, -0.2), **vec(2, 0.25, 0.25, 0.25, 0.25), **vec(3, 0.1, 0.1, 0.1, 0.7)}),
    chc("tie-first", A3, {**vec(1, 0.4, 0.4, 0.1, 0.1), **vec(2, 0.1, 0.1, 0.4, 0.4), **vec(3, 0.25, 0.25, 0.25, 0.25)}),
    chc("missing-option", A3, {**vec(1, 0.7, 0.1, 0.1, 0.1), "u2__greeting": 0.5, "u2__price-claim": 0.5, "u2__allergen-line": 0.0, **vec(3, 0.1, 0.1, 0.1, 0.7)}),
    chc("missing-none", A3, {"u1__greeting": 0.5, "u1__price-claim": 0.5, "u1__allergen-line": 0.0, **vec(2, 0.1, 0.1, 0.1, 0.7), **vec(3, 0.1, 0.1, 0.1, 0.7)}),
    chc("non-number", A3, {**vec(1, "high", 0.1, 0.1, 0.1), **vec(2, 0.1, 0.1, 0.1, 0.7), **vec(3, 0.1, 0.1, 0.1, 0.7)}),
])

# ----------------------------------------------------------------------------------------------- margin
def margin(p):
    if "none" not in p or not is_vector(p):
        return None
    s = sorted(p.items(), key=lambda kv: -kv[1])  # stable: ties keep insertion order
    return {"label": s[0][0], "margin": s[0][1] - s[1][1]} if len(s) > 1 else {"label": s[0][0], "margin": s[0][1]}


mcases = [
    {"greeting": 0.9, "price-claim": 0.05, "none": 0.05},
    {"greeting": 0.5, "price-claim": 0.3, "none": 0.2},
    {"greeting": 0.4, "price-claim": 0.4, "none": 0.2},
    {"greeting": 0.1, "price-claim": 0.1, "none": 0.8},
    {"greeting": 0.0, "price-claim": 0.0, "none": 1.0},
    {"greeting": 0.3, "price-claim": 0.3, "none": 0.3},
    {"greeting": 0.9, "price-claim": 0.2, "none": 0.1},
    {"greeting": 0.6, "price-claim": 0.2, "none": 0.2, "x": 0.0},
    {"greeting": 0.7, "price-claim": 0.3},
    {"greeting": 0.55, "price-claim": 0.25, "none": 0.2},
    {"greeting": 0.704, "price-claim": 0.05, "none": 0.254},
    {"none": 1.0},
    {},
]
put("margin.cases", "the margin is the likeliest option minus the second; probabilities without none, or no vector, have none", [{"probabilities": p, "expect": margin(p)} for p in mcases])

# ------------------------------------------------------------------------------------------ stack.decide
def sure_cascade(op, pass_at, fail_at):
    top = None
    for name, p in op["probabilities"].items():
        if top is None or p > top[1]:
            top = (name, p)
    if top and top[1] >= pass_at:
        return top[0]
    if top is None or top[1] < fail_at:
        return "none"
    return None


def sure_margin(op, cut):
    m = margin(op["probabilities"])
    return m["label"] if m and m["margin"] >= cut else None


def asked_names(sset):
    return {l["name"] for l in sset["labels"] if l.get("target") != "required"}


def srcs(*ops):
    return [o["source"] for o in ops if o is not None and "source" in o]


def decide_stack(first, second, sset, rule):
    if first is None and second is None:
        return None
    if first is None:
        d = {"label": second["label"], "by": "system2", "fallback": True, "sources": srcs(second)}
        if "target" in second:
            d["target"] = second["target"]
        return d
    if second is not None:
        if second["label"] != "none" and second["label"] not in asked_names(sset):
            d = {"label": second["label"], "by": "system2", "sources": srcs(first, second)}
            if "target" in second:
                d["target"] = second["target"]
            return d
    sure = sure_cascade(first, rule["passAt"], rule["failAt"]) if rule["rule"] == "cascade" else sure_margin(first, rule["marginCut"])
    if sure is not None:
        d = {"label": sure, "by": "system1", "sources": srcs(first, second)}
        if second is None:
            d["fallback"] = True
        return d
    if second is not None:
        d = {"label": second["label"], "by": "system2", "sources": srcs(first, second)}
        if "target" in second:
            d["target"] = second["target"]
        return d
    return None


def stk(name, first, second, sset=S1, rule=None):
    rule = rule or {"rule": "cascade", "passAt": 0.9, "failAt": 0.1}
    return {"name": name, "set": sset, "first": first, "second": second, "rule": rule, "expect": decide_stack(first, second, sset, rule)}


def o1(**p):
    top = max(p.items(), key=lambda kv: kv[1])[0] if p else "none"
    return {"label": top, "probabilities": p, "source": "k1"}


def o2(label, **kw):
    return {"label": label, "source": "k2", **kw}


put("stack.cascade", "system 1 decides alone at pass-at or above and under fail-at for every label; between, system 2 decides; with no system 2 opinion an unsure unit is left unlabeled", [
    stk("sure-yes", o1(greeting=0.95, **{"price-claim": 0.1}), o2("price-claim")),
    stk("sure-yes-boundary", o1(greeting=0.9, **{"price-claim": 0.1}), o2("none")),
    stk("sure-tie-first-label", o1(greeting=0.95, **{"price-claim": 0.95}), None),
    stk("sure-tie-with-second", o1(**{"price-claim": 0.92, "greeting": 0.92}), o2("greeting")),
    stk("sure-none-option", o1(greeting=0.04, **{"price-claim": 0.03, "none": 0.93}), o2("greeting")),
    stk("sure-none-option-boundary", o1(greeting=0.05, **{"price-claim": 0.05, "none": 0.9}), o2("price-claim")),
    stk("just-under-pass", o1(greeting=0.899, **{"price-claim": 0.1}), o2("price-claim")),
    stk("sure-none", o1(greeting=0.05, **{"price-claim": 0.09}), o2("greeting")),
    stk("fail-boundary", o1(greeting=0.1, **{"price-claim": 0.05}), o2("greeting")),
    stk("unsure-second", o1(greeting=0.5, **{"price-claim": 0.2}), o2("allergen-line")),
    stk("unsure-no-second", o1(greeting=0.5, **{"price-claim": 0.2}), None),
    stk("sure-no-second", o1(greeting=0.97), None),
    stk("sure-none-no-second", o1(greeting=0.02), None),
    stk("first-missing", None, o2("greeting")),
    stk("both-missing", None, None),
    stk("second-says-none-unsure", o1(greeting=0.5), o2("none")),
    stk("second-needs-target", o1(greeting=0.95), o2("when", target=3), S2),
    stk("second-target-label-over-sure-none", o1(rule=0.02), o2("when", target=2), S2),
    stk("target-label-sure-first", o1(rule=0.97), o2("rule"), S2),
    stk("second-target-with-none-first", o1(rule=0.5), o2("rule"), S2),
    stk("second-label-outside-asked-no-target", o1(greeting=0.95), o2("shouting")),
    stk("custom-bounds", o1(greeting=0.75), o2("price-claim"), S1, {"rule": "cascade", "passAt": 0.7, "failAt": 0.3}),
    stk("custom-bounds-none", o1(greeting=0.25), o2("price-claim"), S1, {"rule": "cascade", "passAt": 0.7, "failAt": 0.3}),
    stk("custom-bounds-between", o1(greeting=0.5), o2("price-claim"), S1, {"rule": "cascade", "passAt": 0.7, "failAt": 0.3}),
])
MR = {"rule": "margin", "marginCut": 0.65}
put("stack.margin", "with a margin cut system 1 decides when its likeliest option leads the second by the cut; a vector that does not sum to 1 is left to system 2", [
    stk("clear-lead", o1(greeting=0.9, **{"price-claim": 0.05, "none": 0.05}), o2("price-claim"), S1, MR),
    stk("lead-at-cut", o1(greeting=0.75, **{"price-claim": 0.0, "none": 0.25}), o2("price-claim"), S1, {"rule": "margin", "marginCut": 0.5}),
    stk("lead-under-cut", o1(greeting=0.7, **{"price-claim": 0.1, "none": 0.2}), o2("price-claim"), S1, MR),
    stk("none-leads", o1(greeting=0.05, **{"price-claim": 0.05, "none": 0.9}), o2("greeting"), S1, MR),
    stk("tie", o1(greeting=0.4, **{"price-claim": 0.4, "none": 0.2}), o2("greeting"), S1, MR),
    stk("no-vector", o1(greeting=0.9, **{"price-claim": 0.9, "none": 0.9}), o2("price-claim"), S1, MR),
    stk("no-none-option", o1(greeting=0.95, **{"price-claim": 0.05}), o2("price-claim"), S1, MR),
    stk("no-second", o1(greeting=0.9, **{"price-claim": 0.05, "none": 0.05}), None, S1, MR),
    stk("unsure-no-second", o1(greeting=0.5, **{"price-claim": 0.3, "none": 0.2}), None, S1, MR),
    stk("first-missing", None, o2("greeting"), S1, MR),
    stk("second-target", o1(rule=0.9, **{"none": 0.1}), o2("when", target=1), S2, MR),
    stk("cut-zero", o1(greeting=0.34, **{"price-claim": 0.33, "none": 0.33}), o2("none"), S1, {"rule": "margin", "marginCut": 0.0}),
])
put("stack.single", "a lone labeler's opinion is the decision; no opinion is no decision", [
    {"name": "label", "opinion": {"label": "greeting", "source": "k1"}, "expect": {"label": "greeting", "by": "system1", "sources": ["k1"]}, "cls": "system1"},
    {"name": "label-with-target", "opinion": {"label": "when", "target": 4, "source": "k9"}, "expect": {"label": "when", "target": 4, "by": "system2", "sources": ["k9"]}, "cls": "system2"},
    {"name": "none", "opinion": {"label": "none"}, "expect": {"label": "none", "by": "system2", "sources": []}, "cls": "system2"},
    {"name": "absent", "opinion": None, "expect": None, "cls": "system1"},
])

# ------------------------------------------------------------------------------------- labelling hash
def member(id_, cls, model, settings, runs=1):
    return {"id": id_, "cls": cls, "model": model, "settings": settings, "runs": runs}


M1 = member("planted-p", "system1", "planted-p1", {"threshold": 0.4})
M2 = member("planted", "system2", "planted-1", {})


def single_hash(m):
    return sha(canonical({"members": [m], "rule": "single"}))[:16]


def stacked_hash(a, b, rule):
    extra = {"marginCut": rule["marginCut"], "rule": "margin"} if rule["rule"] == "margin" else {"passAt": rule["passAt"], "failAt": rule["failAt"], "rule": "cascade"}
    return sha(canonical({"members": [a, b], **extra}))[:16]


CAS = {"rule": "cascade", "passAt": 0.9, "failAt": 0.1}
hashes = []
def cls_text(m):
    return ("system 1" if m["cls"] == "system1" else "system 2") + f" {m['id']} {m['model']}"


def describe_single(m):
    return cls_text(m)


def describe_stack(a, b, rule):
    tail = f"margin cut {rule['marginCut']}" if rule["rule"] == "margin" else f"pass at {rule['passAt']}, fail at {rule['failAt']}"
    return f"{cls_text(a)} then {cls_text(b)} ({tail})"


MS3 = member("planted", "system2", "planted-1", {}, 3)
hashes.append({"name": "single", "kind": "single", "members": [M1], "expect": single_hash(M1), "describe": describe_single(M1)})
hashes.append({"name": "single-runs", "kind": "single", "members": [MS3], "expect": single_hash(MS3), "describe": describe_single(MS3)})
hashes.append({"name": "stack-cascade", "kind": "stack", "members": [M1, M2], "rule": CAS, "expect": stacked_hash(M1, M2, CAS), "describe": describe_stack(M1, M2, CAS)})
hashes.append({"name": "stack-margin", "kind": "stack", "members": [M1, M2], "rule": MR, "expect": stacked_hash(M1, M2, MR), "describe": describe_stack(M1, M2, MR)})
put("labelling.hash", "the hash of a labelling is sha256 of the canonical members and the rule, 16 hex characters", hashes)
base = stacked_hash(M1, M2, CAS)
variants = [
    ("same", stacked_hash(M1, M2, CAS), True),
    ("threshold", stacked_hash(member("planted-p", "system1", "planted-p1", {"threshold": 0.5}), M2, CAS), False),
    ("model", stacked_hash(M1, member("planted", "system2", "planted-2", {}), CAS), False),
    ("id", stacked_hash(member("planted-q", "system1", "planted-p1", {"threshold": 0.4}), M2, CAS), False),
    ("runs", stacked_hash(M1, member("planted", "system2", "planted-1", {}, 3), CAS), False),
    ("pass-at", stacked_hash(M1, M2, {"rule": "cascade", "passAt": 0.8, "failAt": 0.1}), False),
    ("fail-at", stacked_hash(M1, M2, {"rule": "cascade", "passAt": 0.9, "failAt": 0.2}), False),
    ("rule", stacked_hash(M1, M2, MR), False),
    ("swapped-members", stacked_hash(M2, M1, CAS), False),
]
put("labelling.hash-pairs", "any change of a member, a bound or the rule changes the hash; the same labelling hashes the same", [
    {"name": n, "members": [M1, M2], "variant": n, "expectSame": s, "expect": h} for n, h, s in variants
])
for c in out["labelling.hash-pairs"]:
    assert (c["expect"] == base) == c["expectSame"], c["name"]

# ------------------------------------------------------------------------------------------- cassette key
def request_key(wire, readable):
    return sha(canonical({"wire": wire, "readable": readable}))


def readable_of(wire, meta):
    parts = {f"part.{k}": sha(canonical(v))[:12] for k, v in wire["body"].items()}
    return {**meta, "labeler": wire["labeler"], **parts}


META = {"path": "notes.md", "window": "notes.md#1", "promptVersion": "p1", "schemaVersion": "s1", "set": "orchard-voice", "setHash": set_hash(S1), "model": "planted-1", "cutDigest": "abc123", "cls": "system2", "run": "1"}
WIRE = {"labeler": "planted", "body": {"set": "orchard-voice", "window": "notes.md#1", "units": ["Line 1", "Line 2"]}}
keys = []
keys.append({"name": "base", "wire": WIRE, "meta": META})
keys.append({"name": "set-hash", "wire": WIRE, "meta": {**META, "setHash": set_hash(S2)}})
keys.append({"name": "model", "wire": WIRE, "meta": {**META, "model": "planted-2"}})
keys.append({"name": "run", "wire": WIRE, "meta": {**META, "run": "2"}})
keys.append({"name": "cut", "wire": WIRE, "meta": {**META, "cutDigest": "abc124"}})
keys.append({"name": "prompt-version", "wire": WIRE, "meta": {**META, "promptVersion": "p2"}})
keys.append({"name": "body-unit", "wire": {**WIRE, "body": {**WIRE["body"], "units": ["Line 1", "Line two"]}}, "meta": META})
keys.append({"name": "labeler", "wire": {**WIRE, "labeler": "planted-b"}, "meta": META})
keys.append({"name": "unicode-body", "wire": {**WIRE, "body": {"set": "é-notes", "units": ["naïve café ☕", "“quoted”"]}}, "meta": META})
keys.append({"name": "body-key-order", "wire": {"labeler": "planted", "body": {"units": ["Line 1", "Line 2"], "window": "notes.md#1", "set": "orchard-voice"}}, "meta": META})
for k in keys:
    r = readable_of(k["wire"], k["meta"])
    k["expectReadable"] = r
    k["expectKey"] = request_key(k["wire"], r)
put("cassette.requestKey", "readableOf adds a hash of each part of the body; the key is sha256 of the canonical wire and readable", keys)
ks = [c["expectKey"] for c in keys]
assert ks[0] == ks[9] and len(set(ks)) == len(ks) - 1, "only body key order may repeat the base key"

# --------------------------------------------------------------------------------- full stack over a gold set
GOLD = [
    # text, gold label, p1 (probabilities over greeting, price-claim, none), p2 label (system 2)
    ("Welcome every visitor by name at the gate.", "greeting", {"greeting": 0.96, "price-claim": 0.02, "none": 0.02}, "greeting"),
    ("A crate of pears costs six euros.", "price-claim", {"greeting": 0.02, "price-claim": 0.95, "none": 0.03}, "price-claim"),
    ("The orchard closes at dusk.", "none", {"greeting": 0.03, "price-claim": 0.03, "none": 0.94}, "none"),
    ("Say good morning before anything else.", "greeting", {"greeting": 0.55, "price-claim": 0.2, "none": 0.25}, "greeting"),
    ("Two crates cost eleven euros.", "price-claim", {"greeting": 0.2, "price-claim": 0.5, "none": 0.3}, "price-claim"),
    ("Ladders live in the red shed.", "none", {"greeting": 0.3, "price-claim": 0.3, "none": 0.4}, "none"),
    ("Greet the delivery driver with a smile.", "greeting", {"greeting": 0.4, "price-claim": 0.35, "none": 0.25}, "none"),
    ("Pears are cheaper by the sack.", "price-claim", {"greeting": 0.1, "price-claim": 0.3, "none": 0.6}, "price-claim"),
    ("Picking starts after the dew.", "none", {"greeting": 0.2, "price-claim": 0.2, "none": 0.6}, "greeting"),
    ("Welcome notes go on the board by the door.", "greeting", {"greeting": 0.92, "price-claim": 0.04, "none": 0.04}, "greeting"),
    ("The jam jars cost four euros each.", "price-claim", {"greeting": 0.03, "price-claim": 0.9, "none": 0.07}, "price-claim"),
    ("Mind the wet grass near the well.", "none", {"greeting": 0.01, "price-claim": 0.02, "none": 0.97}, "none"),
]
DEC = []
for text, gold, p1, p2 in GOLD:
    # the system 1 labeler is asked yes or no per label; the choice vector includes none
    d = decide_stack({"label": max(p1.items(), key=lambda kv: kv[1])[0], "probabilities": p1}, {"label": p2}, S1, CAS)
    DEC.append(d)
# the stack is a cascade over the choice probabilities (pass 0.9, fail 0.1): top p in p1 incl. none; with none's p as a candidate
labels = ["greeting", "price-claim", "none"]
exp_labels = [d["label"] for d in DEC]
n = len(GOLD)
agree = sum(1 for (t, g, a, b), e in zip(GOLD, exp_labels) if g == e)
gold_counts = {l: sum(1 for x in GOLD if x[1] == l) for l in labels}
ans_counts = {l: sum(1 for e in exp_labels if e == l) for l in labels}
po = Fraction(agree, n)
pe = sum(Fraction(gold_counts[l] * ans_counts[l], n * n) for l in labels)
kappa = (po - pe) / (1 - pe)
put("stack.goldset", "twelve fictional units through system 1 then system 2 at 0.9 and 0.1; the labels, who decided and the kappa against the gold labels are computed by the cascade rule and exact fractions", [{
    "set": {"set": "orchard-gold", "description": "Gold set of the orchard shop.", "labels": [lab("greeting", "A unit that fixes how a visitor is welcomed."), lab("price-claim", "A unit that states what a crate costs.")]},
    "units": [{"text": t, "gold": g, "system1": p1, "system2": p2} for t, g, p1, p2 in GOLD],
    "passAt": 0.9, "failAt": 0.1,
    "expect": {"labels": exp_labels, "by": [d["by"] for d in DEC], "agreement": float(po), "kappa": float(kappa), "agreementExact": f"{po.numerator}/{po.denominator}"},
}])

doc = {"provenance": {"script": "packages/validators/fixtures/judges/make_pointer.py", "sources": prov}, **out}
with open(OUT, "w") as fh:
    json.dump(doc, fh, indent=1, allow_nan=False, ensure_ascii=False)
print("wrote", OUT, {k: len(v) for k, v in out.items()})
