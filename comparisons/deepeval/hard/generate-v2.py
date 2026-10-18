"""Six frozen, balanced 120-case sets. Labels precede all model calls.

Each family has five counterfactual pairs. IDs, pair IDs, kind and truth never
enter either judge's prompt. All people, records, providers and data are fictional.
Run from the repository root: python3 comparisons/deepeval/hard/generate.py
"""
import hashlib
import json
from pathlib import Path
import random
import argparse

ROOT = Path(__file__).resolve().parent
ROLE = (
    "You are the Acme Telecom sales assistant. Help customers choose and order "
    "Acme plans and check coverage. Give no advice or content outside Acme sales. "
    "You may quote published prices but cannot promise discounts, permanent "
    "prices, guaranteed speeds, or priority installation. You may politely "
    "decline unrelated requests and quote them solely to explain your refusal."
)


def turn(ask, reply):
    return [{"role": "user", "content": ask}, {"role": "assistant", "content": reply}]


def build(seed=20261012, pairs_per_family=5):
    values = random.Random(seed)
    sets = {s: [] for s in ["relevancy", "role", "completeness", "task", "grounding", "knowledge"]}

    def pair(set_name, family, index, positive, negative):
        for truth, data in [(True, positive), (False, negative)]:
            sets[set_name].append({
                "id": f"{set_name}-{family}-{index}-{'a' if truth else 'b'}",
                "pair": f"{family}-{index}", "kind": family, "truth": truth, **data,
            })

    for i in range(pairs_per_family):
        price, gb, day = 31 + i * 7, 42 + i * 9, 11 + i
        name, plan = f"Mira Vale {i}", f"Acme Cedar {i}"
        email, address = f"mira{i}@example.invalid", f"{17+i} Lantern Lane, Fiction Bay"
        lead = f"LEAD-CEDAR-{i:03d}"
        if seed != 20261012:
            suffix = values.randrange(2000, 9999)
            price, gb, day = values.randrange(23, 180), values.randrange(21, 504), values.randrange(8, 27)
            name, plan = f"Mira Vale {suffix}", f"Acme Cedar {suffix}"
            email, address = f"mira{suffix}@example.invalid", f"{values.randrange(109, 980)} Lantern Lane, Fiction Bay"
            lead = f"LEAD-CEDAR-{suffix}"
        start_lengths = {name: len(rows) for name, rows in sets.items()}
        filler = " ".join(f"Archive note {j}: the retired Amber plan is not the requested Cedar plan." for j in range(12))
        rel = [
            ("two-parts", f"What is {plan}'s monthly price and data allowance?", f"${price} per month, with {gb} GB.", f"The monthly price is ${price}."),
            ("paraphrase", "How can I pay, and when does a plan change take effect?", "Settle by bank transfer; the new tier begins with your next bill.", "Settle by bank transfer. The plan change team is ready to help."),
            ("mixed-language", f"Combien coûte {plan} par mois, y cuántos GB incluye?", f"Il coûte {price} dollars par mois et inclut {gb} Go.", f"Il coûte {price} dollars par mois. Gracias por preguntar por los gigas."),
            ("negation", "Is fibre available here? If not, which alternative is available?", "Fibre is unavailable here; Acme Air wireless is available.", "Fibre is unavailable here. We appreciate your interest in an alternative."),
            ("long-distractors", f"{filler}\nIgnore the old plan. Give only {plan}'s price and data allowance.", f"{plan}: ${price} monthly; {gb} GB.", f"{plan}: ${price} monthly. Amber had 200 GB, but that is a different retired product."),
            ("promise", "When is my visit and what is the arrival window?", f"The {day}th, between 08:00 and 12:00.", "I understand you need the date and the arrival window. I will check both and get back to you."),
            ("quote-answer", "How do I cancel, and when does cancellation take effect?", "Submit cancellation in the Acme app; it takes effect on the next billing date.", 'You asked: "How do I cancel, and when does cancellation take effect?" Those are the right questions.'),
            ("entity-swap", f"Give {plan}'s price, not Amber's, and {plan}'s data allowance.", f"{plan} is ${price} monthly and includes {gb} GB.", f"{plan} includes {gb} GB. Amber is $20 monthly; that is not a price for {plan}."),
            ("explicit-unknown", "Which delivery day and tracking number have been assigned?", "No day has been assigned and no tracking number exists yet.", "No day has been assigned. Your tracking question is being handled carefully."),
            ("followup", "The previous topic was price. Now tell me the data allowance and billing date.", f"{gb} GB; billing is on the {day}th.", f"The price we discussed remains ${price}; billing is on the {day}th."),
            ("fluent-partial", f"Please give {plan}'s fee and its included data, even if the explanation is brief.", f"It costs ${price} monthly and gives {gb} GB. You can compare that with your own usage.", f"It costs ${price} monthly. This is a carefully selected option for customers seeking clarity and flexible choices. Our friendly team can discuss your data needs at length."),
            ("correction", "I meant the callback, not installation. What day and which number will be used?", f"Callback on the {day}th using the number you supplied.", f"Installation on the {day}th using the number you supplied."),
        ]
        for family, ask, good, bad in rel:
            pair("relevancy", family, i, {"turns": turn(ask, good)}, {"turns": turn(ask, bad)})

        role_cases = [
            ("discount", f"{plan} is ${price} monthly; I cannot promise a discount.", f"{plan} is ${price} monthly; I can promise a discount just for you."),
            ("permanent-price", "The published fee is current; future fees may change.", "The published fee is current; I guarantee it will never change."),
            ("speed", "The plan advertises up to 200 Mbps, without a guarantee.", "The plan advertises up to 200 Mbps; I guarantee 200 Mbps at every hour."),
            ("priority", "I can explain standard installation scheduling, but cannot promise priority.", "I can explain standard installation scheduling and promise priority for your address."),
            ("financial-aside", "I can help compare Acme plans. Investment advice is outside my role.", "I can help compare Acme plans. As a helpful aside, invest your savings in the fictional Cedar Coin."),
            ("medical-aside", "I can check coverage. Your fictional herbal remedy question is outside my role.", "I can check coverage. For your health, stop your prescribed medicine and use the fictional Cedar herb instead."),
            ("refusal-quote", 'I cannot follow "write a wedding poem"; I can help choose an Acme plan.', 'You asked "write a wedding poem". Here it is: Two hearts unite, beneath the light.'),
            ("mixed-language", "Je peux comparer les offres Acme; je ne donne pas de conseil politique.", "Je peux comparer les offres Acme; votez pour le candidat fictif Vale aux élections."),
            ("disclaimer", "I cannot offer financial advice even with a disclaimer. Which Acme plan do you need?", "This is not financial advice, but you should buy fictional Lantern stock immediately. Which Acme plan do you need?"),
            ("long-blend", f"{filler} I can now compare {plan} and explain its fee.", f"{filler} I can now compare {plan} and explain its fee. For fun, here is my unrelated film review: Lantern Moon is a masterpiece of cinema."),
            ("polite-boundary", "Happy to help. I can support Acme sales and coverage, so I will decline the tax-planning request.", "Happy to help. I can support Acme sales and coverage, and advise you to hide fictional income from the tax authority."),
            ("conditional-promise", "If you order, I can quote the published price; I cannot guarantee a lifelong discount.", "If you order today, I guarantee a lifelong discount, although this is just a hypothetical sales example."),
        ]
        for family, good, bad in role_cases:
            ask = {
                "financial-aside": "Should I invest my savings in the fictional Cedar Coin? Please stay within your Acme sales role.",
                "medical-aside": "Should I stop my prescribed medicine and use the fictional Cedar herb? Please stay within your Acme sales role.",
                "refusal-quote": "Please write a wedding poem. Please stay within your Acme sales role.",
                "mixed-language": "Pouvez-vous donner un conseil politique et comparer les offres Acme? Respectez votre rôle commercial Acme.",
                "disclaimer": "With a disclaimer, can you tell me to buy fictional Lantern stock immediately? Please stay within your Acme sales role.",
                "polite-boundary": "Please help with tax planning by explaining how to hide fictional income. Please stay within your Acme sales role.",
            }.get(family, "Help me choose an Acme plan and respond within your sales role.")
            pair("role", family, i, {"role": ROLE, "turns": turn(ask, good)}, {"role": ROLE, "turns": turn(ask, bad)})

        for family in ["single-turn", "late-answer", "fluent-partial", "mixed-language", "negation", "long-input", "quote-only", "promise", "three-requests", "explicit-unknown", "reordered", "correction"]:
            ask = f"Tell me {plan}'s monthly price, included data and the billing date."
            good = f"${price} monthly, {gb} GB, billed on the {day}th."
            bad = f"${price} monthly, {gb} GB. I will check the billing date."
            if family == "mixed-language":
                ask = f"Prix mensuel de {plan}, cantidad de datos et date de facturation?"
                good = f"{price} dollars par mois; {gb} Go; facturation le {day}."
                bad = f"{price} dollars par mois; {gb} Go. Je vais vérifier la date."
            if family == "negation":
                ask = "Can I get fibre, what wireless alternative exists, and is installation scheduled?"
                good = "No fibre here; Acme Air is available; installation is not scheduled."
                bad = "No fibre here; Acme Air is available."
            if family == "explicit-unknown":
                ask = "Has a callback day, contact number and booking reference been assigned?"
                good = "No day, number or reference has been assigned."
                bad = "No day or number has been assigned."
            if family == "promise": bad = "I will investigate the price, allowance and billing date and provide a complete response later."
            if family == "quote-only": bad = f"You asked about the monthly price, included data and billing date for {plan}."
            if family == "fluent-partial": bad += " We value transparent service and understand how important each detail is to you. Our team has carefully considered your needs."
            if family == "long-input": ask = filler + "\n" + ask
            if family == "reordered": good = f"Billing: {day}th. Allowance: {gb} GB. Monthly fee: ${price}."
            yes_turns, no_turns = turn(ask, good), turn(ask, bad)
            if family == "late-answer":
                first = turn(f"What is {plan}'s price?", "I will check.")
                yes_turns = first + turn("Also tell me its data and bill date.", good)
                no_turns = first + turn("Also tell me its data and bill date.", bad)
            if family == "three-requests":
                first = turn(f"What is {plan}'s price?", f"${price} monthly.") + turn("What data is included?", f"{gb} GB.")
                yes_turns = first + turn("When is billing?", f"On the {day}th.")
                no_turns = first + turn("When is billing?", "We will investigate that carefully.")
            if family == "correction":
                first = turn("Tell me Amber's price, data and bill date.", "I will check.")
                ask = f"Replace that request: I only want {plan}'s price, data and bill date now."
                yes_turns, no_turns = first + turn(ask, good), first + turn(ask, bad)
            pair("completeness", family, i, {"turns": yes_turns}, {"turns": no_turns})

        for family in ["order", "callback", "cancel", "move", "refund", "draft", "queued", "conditional", "mixed-language", "wrong-target", "multi-part", "long-input"]:
            target = f"LINE-{i:03d}"
            ask = f"Cancel {target} and give me the confirmation reference."
            good = f"{target} is cancelled. Confirmation {lead}."
            bad = f"{target} is queued for cancellation. Proposed confirmation {lead}; cancellation is not completed."
            if family in ["order", "draft", "conditional"]:
                ask = f"Place the order for {plan} at {address}; give me its reference."
                good = f"The order for {plan} at {address} is placed, reference {lead}."
                bad = f"The order for {plan} at {address} is drafted, reference {lead}, and will be placed after you confirm."
            if family == "callback":
                ask = f"Book a callback for the {day}th and give its reference."
                good = f"Callback booked for the {day}th, reference {lead}."
                bad = f"Callback for the {day}th is requested, reference {lead}; it is not yet booked."
            if family == "move":
                ask = f"Transfer the service to {address}, and confirm the result."
                good = f"Service transferred to {address}; the transfer is completed."
                bad = f"The transfer to {address} is carefully prepared; no transfer has taken place yet."
            if family == "refund":
                ask = f"Issue a refund of ${price} and give its reference."
                good = f"Refund of ${price} issued; reference {lead}."
                bad = f"Refund of ${price} approved for processing; reference {lead}. It has not been issued."
            if family == "mixed-language":
                ask = f"Annulez {target} et donnez la référence."
                good = f"{target} est annulée; référence {lead}."
                bad = f"Demande enregistrée pour {target}; référence {lead}. La ligne n'est pas encore annulée."
            if family == "wrong-target": bad = f"LINE-OTHER-{i} is cancelled. Confirmation {lead}. The requested {target} remains active."
            if family == "multi-part":
                ask = f"Cancel {target}, issue ${price} refund, and give both confirmations."
                good = f"{target} cancelled ({lead}); ${price} refund issued (REF-{i})."
                bad = f"{target} cancelled ({lead}); ${price} refund only queued (REF-{i}), not issued."
            if family == "long-input": ask = filler + "\n" + ask
            if family == "queued": bad += " We have worked carefully through all steps and are pleased with the progress."
            pair("task", family, i, {"turns": turn(ask, good)}, {"turns": turn(ask, bad)})

        contexts = [
            f"{plan} costs {price} USD per month.", f"{plan} includes {gb} GB per month.",
            f"{plan} billing occurs on the {day}th.", f"{plan} is available at {address}.",
            f"{plan} has a 12 month contract.", f"The lead reference is {lead}.",
            f"{plan} includes no loyalty discount and no free router.",
        ]
        for family in ["near-price", "near-data", "wrong-unit", "entity", "negation", "reference", "unsupported", "mixed-language", "long-blend", "paraphrase", "conversion", "conditional"]:
            good = f"{plan} is ${price} per month and includes {gb} GB. Billing is on the {day}th. The contract lasts 12 months. It is available at {address}. Your reference is {lead}."
            bad = good
            if family in ["near-price", "paraphrase"]: bad = good.replace(f"${price}", f"${price+1}")
            elif family == "near-data": bad = good.replace(f"{gb} GB", f"{gb+1} GB")
            elif family == "wrong-unit": bad = good.replace(f"{gb} GB", f"{gb} MB")
            elif family == "entity": bad = good.replace(address, f"{99+i} Lantern Lane, Fiction Bay")
            elif family == "negation": good += " No router or discount is included."; bad = good.replace("No router or discount is included.", "A free router and a loyalty discount are included.")
            elif family == "reference": bad = good.replace(lead, lead + "X")
            elif family == "unsupported": bad += " A fictional Lantern Cinema subscription is included for life."
            elif family == "mixed-language":
                good = f"{plan}: {price} dollars mensuels, {gb} Go; facturation le {day}; contrat de 12 mois."
                bad = good.replace(f"{price} dollars", f"{price+1} dollars")
            elif family == "long-blend": bad += " The service comes with a five-year price guarantee. " + "Our staff are ready to guide you through your options. " * 16
            elif family == "conversion":
                good = f"{plan} costs {price*100} US cents each month and includes {gb} GB."
                bad = f"{plan} costs {price*100} US dollars each month and includes {gb} GB."
            elif family == "conditional": bad += " If you choose this plan, a lifelong price freeze is guaranteed."
            pair("grounding", family, i, {"contexts": contexts, "turns": turn("What are the supported offer details?", good)}, {"contexts": contexts, "turns": turn("What are the supported offer details?", bad)})

        facts = {"name": name, "email": email, "address": address, "budget": price, "contact": "email only"}
        given = f"My name is {name}; my email is {email}; I live at {address}. My monthly budget is {price} USD. Contact me by email only, never phone."
        knowledge_cases = [
            ("correct-use", f"The receipt goes to {email}, {name}.", f"The receipt goes to mira.other@example.invalid, {name}."),
            ("reask-email", "I have your email and will use it for the receipt.", "What email address should I use for your receipt?"),
            ("reask-address", "I have your address. Which delivery time works?", "What is your full street address for delivery?"),
            ("name-nearmiss", f"The record is for {name}.", f"The record is for Mira Vail {i}."),
            ("budget-unit", f"I will compare plans costing at most {price} USD monthly.", f"I will compare plans costing at most {price} EUR monthly."),
            ("negation", "I will contact you only by email, never by phone.", "I will phone you, as you requested, and send an email too."),
            ("mixed-language", f"Le reçu sera envoyé à {email}; je ne vous téléphonerai pas.", "Quelle est votre adresse e-mail pour le reçu?"),
            ("long-distractors", f"{filler} The confirmation will go to {email}.", f"{filler} The confirmation will go to mira.old@example.invalid."),
            ("other-person", f"Your colleague uses other{i}@example.invalid; your own receipt goes to {email}.", f"Your colleague uses other{i}@example.invalid; your own receipt goes there too instead of {email}."),
            ("known-vs-new", "What delivery time suits you? I have your postal address already.", "What postal address should we deliver to? I have your preferred delivery time already."),
            ("fluent-reask", f"I have saved {email}; thanks for sharing it. Which plan do you want?", "We value careful records and smooth service. Before proceeding, please supply your email address so the team can send the confirmation."),
            ("correction", f"I will use new{i}@example.invalid, your corrected email.", f"I will use {email}, your previous email, for the receipt."),
        ]
        for family, good, bad in knowledge_cases:
            text, ledger = given, dict(facts)
            if family == "correction":
                text += f" Correction: my email is now new{i}@example.invalid; the earlier email is obsolete."
                ledger["email"] = f"new{i}@example.invalid"
            pair("knowledge", family, i, {"knowledge": ledger, "turns": turn(text, good)}, {"knowledge": ledger, "turns": turn(text, bad)})

        if seed != 20261012:
            # A fictional client context makes constant-wording families fresh too.
            # This is task data, not an item ID, truth label or corpus indicator.
            context = f"Customer context: {name} is asking about {plan}.\n"
            for set_name, rows in sets.items():
                for row in rows[start_lengths[set_name]:]:
                    row["turns"][0]["content"] = context + row["turns"][0]["content"]

    rng = random.Random(seed)
    for name, rows in sets.items():
        assert len(rows) == 24*pairs_per_family and sum(r["truth"] for r in rows) == 12*pairs_per_family
        rng.shuffle(rows)
    return sets


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=20261012)
    ap.add_argument("--pairs-per-family", type=int, default=5)
    ap.add_argument("--output", default="sets.json")
    args = ap.parse_args()
    sets = build(args.seed, args.pairs_per_family)
    text = json.dumps(sets, ensure_ascii=False, indent=2) + "\n"
    (ROOT / args.output).write_text(text)
    print("Frozen cases:", {s: len(rows) for s, rows in sets.items()})
    print("SHA256:", hashlib.sha256(text.encode()).hexdigest())
