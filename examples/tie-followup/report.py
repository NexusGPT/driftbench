"""Render aggregate results and inference limits without copying benchmark examples."""
import json
from pathlib import Path
import sys

folder, records, notes = map(Path, sys.argv[1:])
load = lambda p: json.loads(p.read_text())
freeze = load(folder / 'frozen-choice.json')
dev = load(folder / 'dev-results.json')
fresh = load(folder / 'heldout-results.json')
spent = load(folder / 'fresh-spend.json')
rows = [json.loads(x) for x in (records/'decisions.jsonl').read_text().splitlines() if x]
pct = lambda x: 'missing' if x is None else f'{100*x:.2f}%'
out = ['# Pair ledger tie follow-up results', '',
       f'Frozen variant: `{freeze["variant"]}`.',
       f'SHA-256: `{(folder / "frozen-choice.json.sha256").read_text().strip()}`.',
       'Code: `a90c9d8b60d5bf73c73bd5d5c18b33c80c4b60ec`. Draft PR: https://github.com/achammah/driftbench/pull/294.', '',
       '## Development selection', '',
       'Equal-weight average over the nine model-by-benchmark cells chooses the variant. Exact selection ties prefer direct.', '',
       'The [full dev tie accounting](DEV-DETAIL.md) reports 14 final ties: direct resolves 5 correctly, reasoning 6. Both beat the no-follow-up mean of 71.11%; neither beats promptfoo at 73.43%. The selected edge is one net pair in 270 equal-cell scoring units, from 240 actual model-pair evaluations.', '',
       '| Model / benchmark | Pairs | Baseline | Direct | With reasoning | Promptfoo |',
       '|---|---:|---:|---:|---:|---:|']
for key, direct in dev['tables']['direct'].items():
    if len(key.split('/')) != 2:
        continue
    reason = dev['tables']['reasoning'][key]
    out.append(f'| {key} | {direct["n"]} | {pct(direct["baseline"])} | {pct(direct["ledger"])} | {pct(reason["ledger"])} | {pct(direct["promptfoo"])} |')
out += ['', 'Selection means: ' + ', '.join(f'{k} {pct(v)}' for k,v in dev['means'].items()) + '.', '',
        '## Fresh confirmation', '',
        'MM scores macro-average the five subsets equally. Writing scores exact matches across both directional games. Ledger reconciles its reads into one decision used for both games.',
        'Wins, losses and ties compare the paired scores with promptfoo on unique response pairs. Two-sided exact sign tests exclude score ties. P-values are unadjusted across the seven confirmation cells; no family-wise superiority claim is made.', '',
        '| Model / benchmark | Pairs | Baseline | Follow-up | Promptfoo | Wins / losses / ties | Exact p | Changed better / worse vs baseline |',
        '|---|---:|---:|---:|---:|---|---:|---|']
for key, row in fresh.items():
    if len(key.split('/')) != 2:
        continue
    out.append(f'| {key} | {row["n"]} | {pct(row["baseline"])} | {pct(row["ledger"])} | {pct(row["promptfoo"])} | {row["wins"]} / {row["losses"]} / {row["ties"]} | {row["p"]:.6g} | {row["improvedFromBaseline"]} / {row["worseThanBaseline"]} |')
out += ['', '## MM safety', '', '| Model | Pairs | Follow-up | Promptfoo | Wins / losses / ties | Exact p |', '|---|---:|---:|---:|---|---:|']
for key,row in fresh.items():
    if not key.endswith('/mm/safety'):
        continue
    out.append(f'| {key.split("/")[0]} | {row["n"]} | {pct(row["ledger"])} | {pct(row["promptfoo"])} | {row["wins"]} / {row["losses"]} / {row["ties"]} | {row["p"]:.6g} |')
out += ['', '## Power and limitations', '',
        'These are conditional exact-sign thresholds given the observed number of discordant pairs. A net-pair-win margin is not a directional-game accuracy difference.',
        'The 80% power column conditions on that discordance count and assumes independently sampled pairs with a common win probability. It is a sensitivity calculation, not post-hoc evidence of no effect.', '',
        '| Cell | Discordant pairs | Minimum significant net pair wins | Minimum significant net-pair margin | Net-pair margin at 80% power |',
        '|---|---:|---:|---:|---:|']
for key,row in fresh.items():
    if len(key.split('/')) != 2:
        continue
    p=row['power']
    out.append(f'| {key} | {p["discordantPairs"]} | {p["minimumSignificantNetPairWins"] if p["minimumSignificantNetPairWins"] is not None else "impossible"} | {pct(p["minimumSignificantNetPairMargin"])} | {pct(p["conditional80PercentPowerNetPairMargin"])} |')
out += ['', '- JudgeBench has no fresh held-out pool; no sealed JudgeBench test item was reused.',
        '- MM contains 12 fresh chat pairs and 20 each in the other categories; the macro score preserves equal subset weight.',
        '- Writing contains unseen response pairs, not unseen questions. Prior System1 questions can recur. Original LongJudge exclusions remain.',
        '- Dev and fresh pairs are disjoint from each other and the enumerated ledger and System1 seals. Absence from unrecorded calls or model training cannot be proved.',
        '- Baseline calls are shared between variants. The default remains off. The new rule never branches on model identity.',
        '- MM retains the frozen computation port. No harm-policy seat is installed for any model in this experiment; safety is reported separately.',
        '- No claim of equivalence follows from a nonsignificant result. No held-out result changes the selected variant.',
        '- Returned unparsed, refused or truncated judgments count as grader errors at zero; missing transport answers are recovered without re-sending returned answers.', '',
        '## Cost and execution', '',
        f'- Provider-reported API and CLI cost: USD {spent["spentUsd"]:.6f}. Unresolved reservations: USD {spent["heldUsd"]:.6f}.',
        f'- Total charged plus held: USD {spent["committedUsd"]:.6f} of USD 40. Claude calls: {spent["claudeCalls"]} of 400.',
        '- Global concurrency is 2. The detached supervisor records health probes, reservations and raw receipts. Answered requests are never resubmitted.',
        '- Research data and raw receipts remain outside the repository. Public files contain code, hashes and aggregate results only.', '']
text='\n'.join(out)
if '\u2013' in text or '\u2014' in text:
    raise ValueError('Forbidden dash in repo prose')
(folder/'RESULTS.md').write_text(text)
with notes.open('a') as f:
    f.write('\n'+text+'\n')
print(json.dumps({'report':str(folder/'RESULTS.md'),'aggregateCells':sum(len(k.split('/'))==2 for k in fresh),'decisionRows':len(rows)}))
