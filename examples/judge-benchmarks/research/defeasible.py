"""Exact defeasible-rule engine for BoardgameQA-style rule games.

The model only TRANSLATES the text into literals; this engine does all the reasoning.
Literal: {"s": subject, "p": predicate, "o": object or "", "neg": bool}. Subject or object "?x" is a variable
shared inside one rule; "?any" in an antecedent means "some entity". A rule applies only when every
antecedent is proved. Conflicting conclusions resolve by the stated preferences; an unresolved conflict
proves neither side."""


def lit_key(l):
    return (l['s'], l['p'], l.get('o', ''), bool(l.get('neg')))


def neg_key(k):
    return (k[0], k[1], k[2], not k[3])


def entities(spec):
    names = set()
    for l in spec['facts']:
        names.add(l['s'])
        if l.get('o'):
            names.add(l['o'])
    for r in spec['rules']:
        for l in r['if'] + [r['then']]:
            for v in (l['s'], l.get('o', '')):
                if v and not v.startswith('?'):
                    names.add(v)
    return sorted(names)


def bindings(rule, proved, ents):
    """All substitutions of ?x that make every antecedent proved."""
    vals = ents if any('?x' in (l['s'], l.get('o', '')) for l in rule['if'] + [rule['then']]) else [None]
    out = []
    for x in vals:
        ok = True
        for l in rule['if']:
            s = x if l['s'] == '?x' else l['s']
            o = x if l.get('o', '') == '?x' else l.get('o', '')
            if s == '?any' or o == '?any':
                hit = any(k[1] == l['p'] and k[3] == bool(l.get('neg'))
                          and (s == '?any' or k[0] == s) and (o == '?any' or k[2] == o) for k in proved)
            else:
                hit = (s, l['p'], o, bool(l.get('neg'))) in proved
            if not hit:
                ok = False
                break
        if ok:
            t = rule['then']
            out.append(((x if t['s'] == '?x' else t['s']), t['p'],
                        (x if t.get('o', '') == '?x' else t.get('o', '')), bool(t.get('neg'))))
    return out


def _fixpoint(spec, ents, pref, blocked):
    proved = {lit_key(l) for l in spec['facts']}
    facts = set(proved)
    for _ in range(300):
        cands = {}
        for r in spec['rules']:
            for k in bindings(r, proved, ents):
                if (r['id'], k) not in blocked:
                    cands.setdefault(k, set()).add(r['id'])
        new = set()
        for k, rids in cands.items():
            if k in proved or neg_key(k) in facts:
                continue
            rivals = cands.get(neg_key(k), set())
            if rivals and not any(all((r1, r2) in pref for r2 in rivals) for r1 in rids):
                continue
            new.add(k)
        if not new:
            return proved, cands
        proved |= new
    return proved, cands


def solve(spec):
    """Recompute from the facts until the set of preference-defeated rule firings is stable."""
    ents = entities(spec)
    pref = {(a, b) for a, b in spec.get('preferences', [])}
    blocked = set()
    for _ in range(20):
        proved, cands = _fixpoint(spec, ents, pref, blocked)
        more = set()
        for k, rids in cands.items():
            rivals = cands.get(neg_key(k), set())
            for r1 in rids:
                if any((r2, r1) in pref for r2 in rivals):
                    more.add((r1, k))
        # a conclusion contradicted with no preference either way proves neither side
        if more <= blocked:
            break
        blocked |= more
    q = lit_key(spec['question'])
    if q in proved and neg_key(q) not in proved:
        return 'proved'
    if neg_key(q) in proved and q not in proved:
        return 'disproved'
    return 'unknown'
