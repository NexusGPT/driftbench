#!/usr/bin/env python3
"""Refresh the owned report from recorded results only."""
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parent
R = ROOT / 'results'
TARGET = Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-jb.md')


def read(name):
    return json.loads((R / name).read_text())


def pct(number):
    return 'pending' if number is None else f'{100 * number:.2f}%'


def interval(row):
    return f"{pct(row['estimate'])} ({pct(row['lower'])} to {pct(row['upper'])})"


cells = read('cells.json')
audit = read('receipt-audit.json')
reasks = read('reask-counts.json')
driver = read('driver-state.json')
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
status = 'All sealed measurements complete' if audit['allExpectedDecisionsComplete'] else f"Measurements in progress; driver status {driver['status']}"
if driver.get('models', {}).get('gemini-3.8-flash', {}).get('status') == 'paused-daily-quota':
    finished = all(audit['models'][model]['test']['complete'] for model in ['gpt-6-luna', 'claude-haiku-5-5'])
    status = ('Luna and Haiku complete; ' if finished else 'Haiku in progress; Luna complete; ') + 'Gemini not run: daily quota, 0/270 TEST pairs'
elif driver.get('pausedModels') or driver.get('models', {}).get('gemini-3.8-flash', {}).get('status') == 'paused-billing':
    finished = all(audit['models'][model]['test']['complete'] for model in ['gpt-6-luna', 'claude-haiku-5-5'])
    status = ('Luna and Haiku complete; ' if finished else 'Haiku in progress; Luna complete; ') + 'Gemini paused pending owner top-up'
if 'gemini-3.5-flash-lite' in audit['models']:
    lite = audit['models']['gemini-3.5-flash-lite']['test']
    status += f"; separate Flash Lite cell {'complete' if lite['complete'] else 'in progress'} ({lite['decisions']}/540 contestant decisions)"
text = TARGET.read_text()
lines = text.splitlines()
lines[2] = f"Status: {status}. Receipt audit: {audit['asOf']}. Source checkpoint: {head}."
text = '\n'.join(lines) + '\n'
prefix = text[:text.index('## Cell table')]
out = ['## Cell table', '', 'The registered pool is TIE-only for win claims. An uncorrected significant loss is still a LOSS.', '',
       '| Model | Matched pairs | Ledger, Wilson 95% | promptfoo, Wilson 95% | Difference, paired bootstrap 95% | Wins / losses | Exact p | Holm p | Result |',
       '|---|---|---|---|---|---|---|---|---|']
for c in cells['cells']:
    result = c['status'] if c['status'] == 'not run: daily quota' else 'PENDING' if c['n'] < c['planned'] else 'LOSS' if c['losses'] > c['wins'] and c['p'] < .05 else 'TIE, registered win restriction'
    exact = f"{c['p']:.8g}" if c['n'] else 'pending'
    family = 'pending family assignment' if c['model']=='gemini-3.5-flash-lite' else 'pending 18-cell family'
    out.append(f"| {c['model']} | {c['n']}/{c['planned']} | {interval(c['ledger'])} | {interval(c['promptfoo'])} | {interval(c['difference'])} | {c['wins']} / {c['losses']} | {exact} | {family} | {result} |")
out += ['', 'Difference is ledger minus promptfoo, in percentage points. The seeded bootstrap uses 10,000 pair resamples.',
        'Exact p is two-sided McNemar. No correction over an incomplete family is substituted for global Holm.',
        'TIE is not proof of equivalence or noninferiority. All 270 pairs remain in the official result.', '',
        'Flash Lite is an additional model cell, authorized after the original cells began. It never replaces or pools responses with Gemini 3.8. Its multiplicity-family assignment belongs to the parent comparison.', '',
        '## Costs and noise', '',
        '| Model | Known USD per 100 ledger / peer | Unknown reserve per test contestant | Noise flips ledger / peer | Repeated noise pairs per contestant |',
        '|---|---|---|---|---|']
for c in cells['cells']:
    model = c['model']; costs = audit['models'][model]['test']['cost']
    price = lambda x: 'pending' if x is None else f'{x:.6f}'
    noise = lambda x: f"{x['gameFlips']}/{x['comparisons']} ({pct(x['rate'])})"
    out.append(f"| {model} | {price(costs['ledger']['knownPer100'])} / {price(costs['promptfoo']['knownPer100'])} | {costs['ledger']['unknownReserveUsd']:.8f} / {costs['promptfoo']['unknownReserveUsd']:.8f} USD | {noise(c['noise']['ledger'])} / {noise(c['noise']['promptfoo'])} | {c['noise']['ledger']['completed']}/30 and {c['noise']['promptfoo']['completed']}/30 |")
out += ['', f"Known cost across all phases: {audit['knownUsd']:.8f} USD. Unknown-cost reservation: {audit['unknownReserveUsd']:.8f} USD.",
        f"Active reservation: {audit['activeReserveUsd']:.8f} USD. Total cap liability: {audit['liabilityUsd']:.8f} of 25 USD.",
        f"Receipts: {audit['finishes']} finished attempts, {audit['unresolvedCalls']} unresolved attempts. Maximum current-freeze concurrency: {audit['maximumCurrentFreezeConcurrentCalls']}.",
        'Reservations are conservative liabilities, not measured provider spend. Test cost includes both orders, canonical reads and schema re-asks.', '',
        '## Fixture earning and validity', '', '| Model | mmlu | livebench | livecodebench | Validity | Cheater gate |', '|---|---|---|---|---|---|']
for c in cells['cells']:
    fixture = lambda x: f"{x['correct']}/{x['expected']}, kappa {x['kappa']:.6f}, {'earned' if x['earned'] else 'unearned'}" if x['status'] == 'MEASURED' else f"pending {x['measured']}/{x['expected']}"
    checks = list(c['validity'].values())
    measured = sum(x['measured'] for x in checks); passed = sum(x['preservedOrFlipped'] for x in checks)
    out.append(f"| {c['model']} | {fixture(c['fixtureEarning']['mmlu'])} | {fixture(c['fixtureEarning']['livebench'])} | {fixture(c['fixtureEarning']['livecodebench'])} | {passed}/{measured}, planned 50 | {'pass' if c['cheaterGate'] else 'pending or failed'} |")
out += ['', 'Each fixture category has six pairs and three repeats. Earning requires every repeat correct and kappa at least 0.8.',
        'Validity has 10 cases each for base, relabel, markdown removal, injection and changed finals. Thresholds are frozen in data/validity-seal.json and statistics.mjs.',
        'Published labels remain unchanged, including the audited variance fixture. No category receives cross-vendor routing.', '',
        '## Schema re-asks and transport failures', '',
        '| Model | TEST re-asks / ledger reads | All-phase re-asks | Previous response: nonempty / empty | Transport retry attempts | 429 receipts | TEST grader errors |',
        '|---|---|---|---|---|---|---|']
for model, phases in audit['models'].items():
    test = phases['test']
    total = lambda key: sum(x[key] for x in phases.values())
    nonempty = sum(x['schemaReaskPreviousResponse'].get('returned_nonempty_text', 0) for x in phases.values())
    empty = sum(x['schemaReaskPreviousResponse'].get('missing_or_empty_text', 0) for x in phases.values())
    out.append(f"| {model} | {test['schemaReasks']} / {test['ledgerPhysicalReads']} | {total('schemaReasks')} | {nonempty} / {empty} | {total('transportRetryAttempts')} | {total('quotaResponses')} | {test['decisionGraderErrors']} |")
out += ['', 'Re-asks are one extra core read after parser failure. Their denominator includes canonical reads and re-asks.',
        'The empty-response pilot re-asks include crash recovery; they are separated from malformed nonempty model content.',
        'Transport retries have separate attempt keys and apply only to no-answer failures. HTTP 429 and 402 never become saved judge failures.',
        f"HTTP 402 receipts retained as billing rejections: {sum(x['billingRejections'] for m in audit['models'].values() for x in m.values())}. Rejected requests still missing: {audit['billingRejectionsStillMissing']}.",
        f"Suppressed malformed-content schema re-asks across saved decisions: {sum(x['schemaReasksSuppressed'] for m in audit['models'].values() for x in m.values())}.", '',
        '## Cheaters', '', '| Strategy | GPT dev | Claude test pool |', '|---|---|---|']
cheaters = cells['cells'][0]['cheaters']
for name, dev in cheaters['dev'].items():
    test = cheaters['test'][name]
    out.append(f"| {name} | {dev['correct']}/{dev['n']} ({pct(dev['estimate'])}) | {test['correct']}/{test['n']} ({pct(test['estimate'])}) |")
out += ['', 'The measured preparation cheater gate uses the same 68 pairs for ledger and cheaters. Full dev and pool counts above are descriptive.', '',
        '## Evidence files', '', '- Registered scores, intervals, discordances and per-item decisions: results/cells.json and results/items-<model>.json.',
        '- All provider responses and usage: results/calls.jsonl. Decisions and core parser traces: results/decisions-<phase>-<model>.jsonl.',
        '- Receipt integrity, costs, coverage and descriptive category counts: results/receipt-audit.json.',
        '- Per-phase re-ask counts: results/reask-counts.json. Current execution freeze: freeze.json; prior versions: freezes/.',
        '- Input provenance, overlap and hashes: data/seal.json, data/question-overlap.json and results/question-independence-audit.json.',
        '', f"Current freeze SHA-256: {audit['freezeSha256']}. Core commit: {audit['core']}.",
        'Raw ledger order games are retained separately from the reconciled primary endpoint. The primary cost includes its extra canonical reads.',
        'The complete 18-cell verdict and global Holm table belong to the parent comparison report. This document covers JudgeBench only.', '']
result = prefix + '\n'.join(out)
assert '\u2014' not in result and '\u2013' not in result
TARGET.write_text(result)
print(f'Refreshed {TARGET.name}; {status}.')
