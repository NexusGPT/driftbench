"""Append verified additional-cell results to the owner-named scratchpad dossier."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOSSIER = Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-jb.md')
MODELS = ('claude-sonnet-5-5', 'gpt-6.1-sol')

def read(path):
    return json.loads(path.read_text())

def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines()]

def pct(value):
    return f'{100*value:.2f}%'

def interval(score):
    return f"{pct(score['estimate'])} [{pct(score['lower'])}, {pct(score['upper'])}]"

heading = '## Final additional-model sealed results'
assert heading not in DOSSIER.read_text(), 'Final results already appended'
reports, calls = {}, {}
for model in MODELS:
    cell = ROOT / 'cells' / model
    report, audit = read(cell / 'report.json'), read(cell / 'independent-audit.json')
    assert report['status'] == 'MEASURED' and report['n'] == audit['matched'] == 270
    assert not report.get('transportMissing') and audit['active'] == 0
    assert hashlib.sha256((cell / 'report.json').read_bytes()).hexdigest() == audit['reportSha256']
    reports[model] = report
    calls[model] = [x for x in rows(cell / 'calls.jsonl') if x['type'] == 'finish']

out = [heading, '', f"Verified at {datetime.now(timezone.utc).isoformat()}.", '',
       'Both cells cover the same 270 sealed pairs once. No transport-missing TEST request remains.',
       'Scores use the frozen official pair-net endpoint. Intervals are 95% Wilson intervals; differences use 10,000 paired bootstrap samples.', '',
       '| Model | Our score | promptfoo score | Difference, 95% paired interval | Our-only / peer-only correct | Exact paired McNemar p | Verdict |',
       '|---|---|---|---|---|---|---|']
for model, r in reports.items():
    out.append(f"| {model} | {r['ledger']['correct']}/270, {interval(r['ledger'])} | {r['promptfoo']['correct']}/270, {interval(r['promptfoo'])} | {interval(r['difference'])} | {r['wins']} / {r['losses']} | {r['p']:.12g} | {r['verdict']} |")
out += ['', 'The pre-registration remains TIE-only for wins because 270 pairs are below the 440-pair target. TIE does not establish equivalence.',
        'The parent comparison owns multiplicity adjustment, including treatment of the owner-dropped cell. No reduced-family correction is applied here.', '',
        '| Model | Contestant | TEST measured USD | TEST unknown holds USD | All phases measured USD | All phases unknown holds USD | TEST physical attempts |',
        '|---|---|---|---|---|---|---|']
for model in MODELS:
    for contestant in ('ledger', 'promptfoo'):
        paid = [x for x in calls[model] if x['contestant'] == contestant]
        test = [x for x in paid if x['phase'] == 'test']
        def cost(values, estimated):
            return sum(x['costUsd'] for x in values if bool(x.get('costEstimated')) == estimated)
        out.append(f'| {model} | {contestant} | {cost(test,False):.8f} | {cost(test,True):.8f} | {cost(paid,False):.8f} | {cost(paid,True):.8f} | {len(test)} |')
out += ['', '| Model | Contestant | TEST measured USD per 100 pairs | TEST held USD per 100 pairs | All-phase input / output tokens |',
        '|---|---|---|---|---|']
for model in MODELS:
    for contestant in ('ledger', 'promptfoo'):
        paid = [x for x in calls[model] if x['contestant'] == contestant]
        test = [x for x in paid if x['phase'] == 'test']
        measured = sum(x['costUsd'] for x in test if not x.get('costEstimated'))
        held = sum(x['costUsd'] for x in test if x.get('costEstimated'))
        tokens = reports[model]['cost'][contestant]['tokens']
        out.append(f"| {model} | {contestant} | {measured*100/270:.8f} | {held*100/270:.8f} | {tokens['input']} / {tokens['output']} |")
out += ['', 'Unknown holds are conservative reserves, not measured provider spend. Every recovered attempt remains in the journal.',
        'A zero-cost settlement requires a provider receipt; no unknown hold is silently released.', '',
        '| Model | Liability / cap USD | Missing TEST items | Error or unparsed items, ours / peer | Token-cap lost items, ours / peer | Schema re-asks, TEST / all phases |',
        '|---|---|---|---|---|---|']
for model, r in reports.items():
    a,b=r['itemsLost']['ledger'],r['itemsLost']['promptfoo']
    out.append(f"| {model} | {r['budget']['liabilityUsd']:.8f} / {r['budget']['capUsd']} | {a['missing']} / {b['missing']} | {len(a['unparsedOrError'])} / {len(b['unparsedOrError'])} | {len(a['lostWithTokenCap'])} / {len(b['lostWithTokenCap'])} | {r['schemaReasks']['test']} / {r['schemaReasks']['all']} |")
out += ['', 'Error or unparsed items are counted separately from missing transport requests. Their item IDs remain in each report.', '',
        '| Model | Noise flips, ours / peer | Fixture correct: mmlu / livebench / livecodebench | Validity | Cheaters |',
        '|---|---|---|---|---|']
for model,r in reports.items():
    noise=' / '.join(f"{r['noise'][c]['gameFlips']}/{r['noise'][c]['comparisons']}" for c in ('ledger','promptfoo'))
    fixtures=' / '.join(f"{r['fixtures'][g]['correct']}/{r['fixtures'][g]['expected']}, kappa {r['fixtures'][g]['kappa']:.6f}, {'earned' if r['fixtures'][g]['earned'] else 'unearned'}" for g in ('mmlu','livebench','livecodebench'))
    out.append(f"| {model} | {noise} | {fixtures} | {'pass' if r['readiness']['validityPassed'] else 'fail'} | {'pass' if r['cheaterGate'] else 'fail'} |")
out += ['', 'Limitations and receipt evidence:', '',
        '- The shared host network outage interrupts both providers. Failed transport attempts are preserved and recovered only after the frozen health gate.',
        '- Ten provider HTTP probes, 30 seconds apart, precede recovery. Each cell runs alone with two workers; connection-failure pauses remain recorded.',
        '- Sonnet caching is off for both contestants throughout TEST. Its first five practice requests use the original cache setting; the subsequent five-call comparison uses different inputs.',
        '- The original Sonnet ECONNRESET envelope and its retry remain preserved in transport-reconciliation/.',
        '- Sonnet session-quota rejections report zero tokens and zero cost. Missing requests resume after the provider-stated reset and another health gate.',
        '- Sonnet peer error examples contain actual explanatory answers. The frozen promptfoo parser uses the first integer, which can precede the final index in those explanations. No content retry or post-hoc rescore is applied.',
        '- GPT retains the original unknown-cost holds accepted by the owner. New HTTP errors retain provider bodies, network causes and response identifiers when received.',
        '- Sonnet shares the Anthropic family with the Claude-generated answers. Both models were added after the original cells were measured.',
        '- The 270 pairs contain 269 distinct questions. Prior evaluations overlap on 159 source-question IDs and 91 exact question texts.', '',
        'Freeze and audit records:', '']
for model,r in reports.items():
    out.append(f"- {model}: freeze SHA-256 {r['freezeSha256']}; examples/ledger-jb/cells/{model}/report.json and independent-audit.json.")
out += ['- Core commit: 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd. Prompts, scoring, sealed order and the core single schema re-ask remain unchanged.',
        '- Pool SHA-256: 489c47a0404e7e0929b52ffbe3e253bfebc8d04fa1e0ddac2f3b7ccd089f5236.',
        '- Seal SHA-256: 2aa831d8f08ea88ddddff87ba9aeb600f2c719725608815c09ddc699bd8aac12.',
        '- Old recordings and completed model scores remain unchanged from checkpoint ed441207. Gemini 3.8 reporting metadata reflects the owner decision.',
        '- Gemini 3.8: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. No pending work or future calls. Flash Lite stays the Gemini result.', '']
with DOSSIER.open('a') as stream:
    stream.write('\n'+'\n'.join(out)+'\n')
print('Final additional-model tables appended after receipt and score audit.')
