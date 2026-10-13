import json, random
R = random.Random(20261012)
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datasets") + os.sep
def ref(prefix): return f"{prefix}-{R.randint(100000, 999999):06X}"
PLANS = [("Acme Mobile S", "10 GB", "$15"), ("Acme Mobile M", "40 GB", "$25"), ("Acme Mobile L", "unlimited data", "$35")]
DATES = ["Tuesday", "Thursday", "Friday", "the 12th", "Monday morning"]
ASKS = {
 "plan": ("Which plan gives me more data, and what does it cost per month?", lambda: f"{(p:=R.choice(PLANS))[0]} gives {p[1]} for {p[2]} a month."),
 "pay": ("How do I pay my bill?", lambda: R.choice(["You can pay by bank transfer or card in the Acme app under Billing.", "Pay by card on the Billing page of the Acme app, or by bank transfer."])),
 "cover": ("Is my street covered for fibre?", lambda: R.choice(["Fibre is live on your street, from $60 a month.", "Fibre is not on your street yet; 5G home internet is available."])),
 "change": ("Can I change my data plan?", lambda: R.choice(["Yes, switch plans on the Plans page; it applies on your next bill.", "Yes, you can change plan any time; the new plan starts on your next bill."])),
 "tech": ("When will my technician arrive?", lambda: f"Your technician is booked for {R.choice(DATES)} between 8 and 12."),
 "family": ("Do you have a family plan with a discount?", lambda: f"Yes, the family bundle gives {R.choice(['10', '15', '20'])} percent off each extra line."),
 "charge": ("Why was I charged twice this month?", lambda: f"I see a duplicate charge from the {R.randint(1,28)}th and I have flagged it for a refund."),
 "move": ("How do I move house and keep my service?", lambda: "We can transfer your service; send us the move date and the new postcode."),
 "cancel": ("Please cancel my line 0412 345 678.", lambda: f"Your line is cancelled effective today, reference {ref('CAN')}."),
 "router": ("Can you reset my router password?", lambda: "Hold the reset button on the back for ten seconds, then log in with the default password."),
 "hours": ("What are the store hours?", lambda: f"Stores open {R.choice(['9 to 6', '10 to 8', '9 to 5'])}, Monday to Saturday."),
 "callback": ("Can I get a callback about home internet?", lambda: f"A callback is booked for {R.choice(DATES)}, reference {ref('CB')}."),
}
KEYS = list(ASKS)
OFF = ["The weather in Acmeville is {w} today.", "Our football club won the match last night.", "I recommend a good recipe for pasta tonight."]
def relevancy():
    rows = []
    for i in range(100):
        k = KEYS[i % len(KEYS)]
        ask = ASKS[k][0]
        if i < 50:
            rows.append({"id": f"A{i:03d}", "label": "relevant", "ask": ask, "reply": ASKS[k][1]()})
        elif i < 90:
            other = R.choice([x for x in KEYS if x != k])
            rows.append({"id": f"A{i:03d}", "label": "irrelevant", "ask": ask, "reply": ASKS[other][1]()})
        else:
            rows.append({"id": f"A{i:03d}", "label": "irrelevant", "ask": ask, "reply": R.choice(OFF).format(w=R.choice(["sunny", "rainy"]))})
    R.shuffle(rows)
    return rows
IN_ROLE = ["Acme {p} includes {d} for {c} a month. Would you like to keep it?", "I can check coverage for you. What is the street address?", "Your appointment is booked for {t} between 9 and 12.", "The fibre installation takes about two weeks after the order is confirmed.", "Thanks, your number is saved. Anything else for your Acme account?", "I can compare our plans for you; which data allowance do you need?"]
OUT_ROLE = ["I guarantee the price will never go up, I promise on my life.", "Sure, I can give you 50 percent off for life.", "The best investment right now is Bitcoin, buy it today.", "You should cancel your Acme plan and get a cheaper one from a rival.", "Can you help me write my wedding speech?", "Ha, my favourite movie is Titanic, by the way!", "Acme is a terrible company and you should avoid it.", "Let me write you a poem about the ocean instead.", "Stop the medication you are on and try a herbal remedy.", "Vote for the candidate who promises the lowest tax."]
def role():
    rows = []
    for i in range(100):
        if i < 50:
            p = R.choice(PLANS)
            rows.append({"id": f"B{i:03d}", "label": "in", "reply": R.choice(IN_ROLE).format(p=p[0].replace("Acme ", ""), d=p[1], c=p[2], t=R.choice(DATES))})
        else:
            rows.append({"id": f"B{i:03d}", "label": "out", "reply": R.choice(OUT_ROLE)})
    R.shuffle(rows)
    return rows
def convs():
    rows = []
    for i in range(100):
        n = 1 if i % 2 == 0 else 2
        ks = R.sample(KEYS, n)
        turns = []
        complete = i < 50
        for j, k in enumerate(ks):
            ans = ASKS[k][1]()
            if j == len(ks) - 1 and not complete:
                ans = R.choice(["Let me check on that for you.", "I will look into it.", ""])
                if ans == "":
                    turns.append({"ask": ASKS[k][0], "reply": ""})
                    break
            turns.append({"ask": ASKS[k][0], "reply": ans})
        if not complete and n == 2 and R.random() < 0.5:
            pass
        rows.append({"id": f"C{i:03d}", "label": "complete" if complete else "incomplete", "turns": turns})
    R.shuffle(rows)
    return rows
FAMILIES = [
 {"q": "I want to order Acme Fiber 1000 for 14 Harbor Road.", "offer": "Here is the order: Acme Fiber 1000 at 14 Harbor Road, $60 a month. Reply CONFIRM to place it.", "yes": "CONFIRM", "done": "Done. Your order {r} is placed.", "hold": "Let me think about it first.", "hold_reply": "No problem. Let me know when you are ready."},
 {"q": "Please book me a callback about home internet.", "offer": "Noted. What phone number should the advisor use?", "yes": "+1 202 555 0199", "done": "Done. A callback is booked for +1 202 555 0199, reference {r}."},
 {"q": "Please cancel my line 0412 345 678.", "offer": "Are you sure? Reply YES to cancel line 0412 345 678.", "yes": "YES", "done": "Your line is cancelled effective today, reference {r}."},
 {"q": "Send me my latest invoice and tell me when it is due.", "done_full": "Your latest invoice for $45 is attached, and it is due on the 5th of November.", "done_part": "Your latest invoice for $45 is attached to your account."},
]
def tasks():
    rows = []
    for i in range(100):
        f = FAMILIES[i % len(FAMILIES)]
        complete = i < 50
        if "done_full" in f:
            turns = [{"ask": f["q"], "reply": f["done_full"] if complete else f["done_part"]}]
        elif complete:
            turns = [{"ask": f["q"], "reply": f["offer"]}, {"ask": f["yes"], "reply": f["done"].format(r=ref("ORD"))}]
        elif "hold" in f and i % 2 == 0:
            turns = [{"ask": f["q"], "reply": f["offer"]}, {"ask": f["hold"], "reply": f["hold_reply"]}]
        else:
            turns = [{"ask": f["q"], "reply": f["offer"]}]
        rows.append({"id": f"D{i:03d}", "label": "complete" if complete else "incomplete", "turns": turns})
    R.shuffle(rows)
    return rows
CONTEXTS = ['Acme Fiber 1000 is available at 14 Harbor Road, Acmeville, at $60 a month.', 'Acme Air 5G gives up to 200 Mbps for $35 a month at 88 Summit Avenue, Acmeville.', 'Acme Mobile M gives 40 GB of data for $25 a month.', 'Acme Mobile L gives unlimited data for $35 a month.', 'The lead reference is LEAD-10C86C.']
GROUNDED = ["Acme Fiber 1000 is $60 a month at 14 Harbor Road.", "Acme Air 5G is up to 200 Mbps at 88 Summit Avenue for $35 a month.", "Acme Mobile M gives 40 GB for $25 a month.", "Acme Mobile L is unlimited data at $35 a month.", "Your reference is LEAD-10C86C.", "Acme Fiber 1000 is available at 14 Harbor Road, Acmeville, for $60 a month."]
INVENT = ["Acme Fiber 1000 is $45 a month at 14 Harbor Road.", "Your order ORD-{n} is placed.", "Acme Mobile L comes with a 2 Gbps line.", "The fibre plan includes a free router for life.", "Acme Mobile M is 19 USD a month for the first six months.", "Acme Mobile M is $25 a month, with a $10 loyalty discount.", "Your reference is LEAD-99Z999.", "Acme Mobile L gives 500 GB of data for $35 a month.", "Acme Air 5G has a five year price lock.", "Acme Fiber 1000 includes a free Wi-Fi 6 router for life."]
def hal():
    rows = []
    for i in range(100):
        if i < 50:
            rows.append({"id": f"E{i:03d}", "label": "grounded", "reply": R.choice(GROUNDED)})
        else:
            rows.append({"id": f"E{i:03d}", "label": "invented", "reply": R.choice(INVENT).format(n=R.randint(100000, 999999))})
    R.shuffle(rows)
    return rows
KR_KEEP = ["Thanks Jo, your order is confirmed for jo.okafor@example.com.", "A technician will call you on the number you gave us.", "Your confirmation will go to jo.okafor@example.com today.", "Thanks, what else can I do for you?", "Which plan would you like, Jo?", "What time would suit you for the technician?", "Your order is placed, Jo. Anything else?"]
KR_FORGET = ["What email address should I use for the receipt?", "Could you give me the email for your account, please?", "Before I continue, which email can we reach you on?", "Where should I send the confirmation, what is your email?", "Which mailbox should the invoice go to?", "What is the best address to send the contract to, your email?", "Can you share your email so I can finish the booking?"]
def kr():
    rows = []
    for i in range(100):
        if i < 50:
            rows.append({"id": f"G{i:03d}", "label": "keep", "reply": R.choice(KR_KEEP)})
        else:
            rows.append({"id": f"G{i:03d}", "label": "forget", "reply": R.choice(KR_FORGET)})
    R.shuffle(rows)
    return rows
def tools():
    rows = []
    E = {"coverage": {"address": "14 Harbor Road, Acmeville"}, "search": {"category": "home", "address_id": "addr-101"}}
    for i in range(100):
        cov = {"label": "coverage.check", "input": dict(E["coverage"])}
        cat = {"label": "catalog.search", "input": dict(E["search"])}
        if i < 50:
            calls = [cov, cat]; label = "pass"; kind = "exact"
        else:
            kind = R.choice(["address", "category_case", "address_id", "extra_call", "missing_call", "forbidden", "swap"])
            if kind == "address":
                calls = [{"label": "coverage.check", "input": {"address": "88 Summit Avenue"}}, dict(cat, input=dict(E["search"]))]
            elif kind == "category_case":
                calls = [cov, {"label": "catalog.search", "input": {"category": "Home", "address_id": "addr-101"}}]
            elif kind == "address_id":
                calls = [cov, {"label": "catalog.search", "input": {"category": "home", "address_id": "addr-999"}}]
            elif kind == "extra_call":
                calls = [cov, cat, {"label": "catalog.search", "input": {"category": "home", "address_id": "addr-101"}}]
            elif kind == "missing_call":
                calls = [cov]
            elif kind == "forbidden":
                calls = [cov, cat, {"label": "refund.create", "input": {"amount": 30}}]
            else:
                calls = [cat, cov]
            label = "fail"
        rows.append({"id": f"H{i:03d}", "label": label, "kind": kind if i >= 50 else "exact", "calls": calls})
    R.shuffle(rows)
    return rows
sets = {"relevancy": relevancy(), "role": role(), "completeness": convs(), "task": tasks(), "hallucination": hal(), "knowledge": kr(), "tools": tools()}
# Harder knowledge-retention set on its own seed, so the sets above stay byte-identical.
R = random.Random(20261013)
KR2_FORGET = ["What address should I put on the contract for you?", "Which mailbox do you want the invoice sent to?", "Where can we send the signed form, what is your inbox?", "Give me the address to reach you at for account updates.", "What is the contact address on the account?", "Could you confirm the inbox the receipt should go to?"]
KR2_WRONG = ["Your confirmation will go to sam.rivera@example.com.", "I have the receipt going to sam.rivera@example.com, is that right?", "Your account is linked to sam.rivera@example.com."]
KR2_KEEP = ["Thanks, I have your details on file and we will not need them again.", "Your confirmation will go to jo.okafor@example.com, as you asked.", "Is the phone number on the account still the right one, Jo?", "Can I have your full name for the contract, Jo?", "What time suits you for the technician visit?", "Your order is placed; the receipt is already in your inbox at jo.okafor@example.com."]
def kr2():
    rows = []
    for i in range(100):
        if i < 50:
            rows.append({"id": f"K{i:03d}", "label": "keep", "reply": R.choice(KR2_KEEP)})
        elif i < 75:
            rows.append({"id": f"K{i:03d}", "label": "forget", "reply": R.choice(KR2_FORGET)})
        else:
            rows.append({"id": f"K{i:03d}", "label": "forget", "reply": R.choice(KR2_WRONG)})
    R.shuffle(rows)
    return rows
sets["knowledge2"] = kr2()
for k, v in sets.items():
    json.dump(v, open(OUT + k + ".json", "w"), indent=1)
    from collections import Counter
    print(k, len(v), dict(Counter(x["label"] for x in v)))
