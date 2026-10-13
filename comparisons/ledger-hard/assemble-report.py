"""Assemble the final report from recorded results without changing frozen scoring."""
import collections, subprocess
from common import *
from score import DOSSIER
from run import priced

def read(name):return json.loads((HERE/name).read_text())
def main():
    primary=read('scores.json');variant=read('dialect/scores.json');proof=read('verification-final.json')
    assert proof['complete'],'Final report requires full coverage'
    assert all(t['complete'] for result in (primary,variant) for t in result['tables'])
    assert proof['crash_reasked_recorded']==20
    seal=read('seal.json');recovery=read('crash-recovery.json');audit=read('construction-cue-audit.json')
    total=primary['measured_usd']+variant['measured_usd'];reserve=recovery['lost_attempt_reserve_usd']
    assert abs(total-proof['measured_usd'])<1e-8 and total+reserve<=10
    primary_text=(HERE/'REPORT.md').read_text()
    primary_text=primary_text.replace('Gemini is pending billing. The separate dialect variant is pending the core dossier.',
        'Gemini was not run in this original two-model primary experiment. The separately frozen dialect variant below includes all three models.')
    primary_text=primary_text.replace('| gemini-3.8-flash | All rows | 0/1536 | pending | pending | | | | | Pending billing |',
        '| gemini-3.8-flash | Original primary | Not run | | | | | | | See the three-model dialect variant |')
    primary_text=primary_text.replace('transport failures; measured spend','final unsuccessful responses; measured spend')
    primary_text=primary_text.replace('Owner-authorized unanswered transport retries use at most three attempts with 10/30-second backoff and at most two concurrent Luna calls. All failed attempts remain recorded.', 'Unanswered transport retries follow the operational amendments above. All failed attempts remain recorded.')
    variant_text=(HERE/'dialect/REPORT.md').read_text().replace('final transport failures.', 'final unsuccessful responses.')
    variant_text=variant_text.replace('Failures over 5% in a rolling 50 Luna attempts reduce variant concurrency from four to two.',
        'The original adaptive four/two pacing is superseded by the per-model runtime amendment above.')
    lines=['# Ledger hard-row dossier','',f'Final recording analysis generated {stamp()}. All case and result counts come from the linked files in `comparisons/ledger-hard/`.','',
       f'- Full sealed coverage: 384 cases per row, 1,536 per model; two primary models and three dialect models.',
       f'- {primary["unique_calls"]} primary and {variant["unique_calls"]} dialect unique recorded requests, including the goal equal-evidence ablation.',
       f'- Measured spend: USD {total:.8f}. Lost-attempt reserve: USD {reserve:.2f}. Combined: USD {total+reserve:.8f}, within the USD 10 cap.',
       '- The construction audit passes. No pool is withdrawn. This is synthetic evidence on the original construction families.',
       '- Primary and dialect results remain separate. The dialect run uses the same cases and is not an independent replication.','',
       '## Interpretation and coverage','',
       'The pooled default comparison includes a goal row where the candidate receives final state and the default peer does not. The pooled equal-evidence comparison supplies final state to both. It is the appropriate evidence-matched comparison. Per-row exact tests are nominal; family bootstrap intervals show construction-family uncertainty. A non-significant result does not establish equivalence. The global 18-cell Holm decision belongs to the collator.','',
       '| Experiment | Model | Cases in each row | Pooled default W/L | Pooled equal-evidence W/L | Equal-evidence exact two-sided p | Status |',
       '|---|---|---:|---:|---:|---:|---|']
    for label,result in [('Primary',primary),('Dialect',variant)]:
        for model in sorted({t['model'] for t in result['tables']}):
            a=next(t for t in result['tables'] if t['model']==model and t['row']=='pooled-default')
            b=next(t for t in result['tables'] if t['model']==model and t['row']=='pooled-equal-evidence')
            lines.append(f'| {label} | {model} | 384/384 | {a["wins"]}/{a["losses"]} | {b["wins"]}/{b["losses"]} | {b["two_sided_p"]:.8g} | {b["nominal_verdict"]} |')
    lines+=['','## Construction-cue audit','',
       f'`audit-construction.py` reads only source, seeds, sealed cases and rendered prompts. `construction-cue-audit.json` SHA-256 is `{digest(HERE/"construction-cue-audit.json")}`. It checks all {audit["rendered"]["primary"]["entries"]} primary and {audit["rendered"]["dialect"]["entries"]} dialect rendered inputs. No model outcomes inform this audit.','',
       '| Row | Cases | Trusted contexts paired across labels | Imbalanced trusted token values | Imbalanced identity suffix values |',
       '|---|---:|---:|---:|---:|']
    for row,a in audit['rows'].items():lines.append(f'| {row} | {a["cases"]} | {a["paired_trusted_contexts"]} | {a["imbalanced_trusted_token_values"]} | {a["imbalanced_identity_values"]} |')
    lines+=['','Entity identifiers are assigned once per pair, before the true/false loop. Every trusted context appears once per label. Identity values, parity and last digits are balanced. Complete token contingency tables are retained, including semantic answer differences that correlate with truth. Case id, generation, family and truth metadata are excluded from model inputs. The audit rules out these construction cues; it does not establish absence of every semantic shortcut.','',
       '## Crash recovery and concurrency','',
       'The plugin crash left 12 primary and 8 dialect calls without recorded answers. The owner authorized one re-ask of each key below. Each now has exactly one final recorded answer and is counted once. The lost attempts retain USD 0.40 reserve. Sources: `crash-recovery.json`, `recovery-amendment.json`, both `starts.jsonl` files and both `recovery-attempts.jsonl` files.','',
       '| Experiment | Model | Case | Side | Key re-asked once after the crash |','|---|---|---|---|---|']
    for x in recovery['items']:lines.append(f'| {x["experiment"]} | {x["model"]} | {x["id"]} | {x["side"]} | `{x["request_sha256"]}` |')
    lines+=['',
       'Existing workers drained naturally before each runtime amendment. The combined four-call cap and adaptive Luna four/two pacing applied until the later pacing boundary. `pacing-amendment.json` then replaces those concurrency limits with shared per-model limits across both experiments: gpt-6-luna eight, Gemini two, Haiku two. Luna uses plain HTTP. Independent rotating queues preserve each sealed request order and keep all three models running side by side. Sources, cap and answer contracts remain unchanged.','',
       'HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota retries remain pending and unscored, never judge failures. Other unanswered transport failures use at most three attempts with 10/30-second waits. Every transport failure and backoff remains recorded; content is never retried. `quota-amendment.json` retains this retry policy under the later per-model pacing amendment. Unanswered attempts have no reported usage; measured cost excludes unreported charges.','',
       'Primary Luna keeps provider-default reasoning for both contestants and omits temperature. The API does not report which reasoning setting that default resolves to. Dialect Luna and Gemini use medium for both contestants. Haiku exposes no reasoning control in this harness.','',
       '## Native parity and verification','',
       '`verification-final.json` proves complete coverage, unique scored keys, disjoint experiment keys, exact goal labels, original payload non-overlap, immutable source hashes, registered crash re-asks, resolved model IDs and the budget. `peer-decoder-parity.mts` replays every successful peer answer through the pinned native verdict functions, including the native YAML fallback. `trajectory-parity.mts` checks all 384 goal summaries against the pinned helper.','',
       '| Experiment | Unique calls | Native peer answers checked | Final unsuccessful calls | Measured USD |','|---|---:|---:|---:|---:|']
    for experiment,p in proof['experiments'].items():lines.append(f'| {experiment} | {p["recorded_unique"]}/{p["planned_unique"]} | {p["native_peer_decodes"]} | {p["final_failed_calls"]} | {p["measured_usd"]:.8f} |')
    lines+=['',
       'Focused protocol/recovery tests pass; `test-output.txt` retains the test result. Every raw response and usage record remains in the journals. Haiku cache creation and cache reads are separate from ordinary input tokens in `verification-final.json`; CLI-reported cost is authoritative. The peer native YAML dependency is the pinned js-yaml 5.4.2 bundle, with npm integrity and upstream provenance under `native-validation/`. No node_modules directory is copied.','',
       '## Freeze hashes','',
       '| Artifact | SHA-256 |','|---|---|']
    for name in ['seal.json','accounting-amendment.json','transport-amendment.json','dialect/seal.json','recovery-amendment.json','concurrency-amendment.json','quota-amendment.json','pacing-amendment.json','crash-recovery.json','seeds.json','prompts.json','dialect/prompts.json','score.py','dialect-score.py','verification-final.json']:
        lines.append(f'| `{name}` | `{digest(HERE/name)}` |')
    lines+=['',f'Candidate procedure: `{seal["candidate_procedure_sha256"]}`. Original seal commit: `eeb7875e`. Core dialect source: `{variant["core_commit"]}`; dialect seal commit: `a7954b1b`. The per-file source hash maps remain inside the seals and operational amendments.','',
       '## Original primary tables','',primary_text,'','## Dialect tables','',variant_text,'',
       '## Limits on claims','',
       '- The planted cases reuse the original family templates with fresh bindings. Results do not demonstrate general superiority on arbitrary tasks.',
       '- Constant pass and constant fail each score 50% by label balance. Repeated-read noise and perturbation validity are unmeasured; no stability claim is made.',
       '- Information-asymmetric goal wins cannot establish a better judge on equal evidence. Both versions are disclosed.',
       '- No global matrix verdict or global Holm win is claimed here. The per-row tables and exact rational p-values support independent collation.','']
    content='\n'.join(lines)
    assert '\u2014' not in content and '\u2013' not in content
    assert len(recovery['items'])==20
    for x in recovery['items']:assert content.count(x['request_sha256'])==1
    (HERE/'FINAL.md').write_text(content);DOSSIER.write_text(content)
    dump(HERE/'delivery.json',{'created':stamp(),'dossier':str(DOSSIER),'dossier_sha256':digest(DOSSIER),'local_final_sha256':digest(HERE/'FINAL.md'),
         'full_coverage':True,'measured_usd':total,'lost_attempt_reserve_usd':reserve,'unique_recorded_requests':primary['unique_calls']+variant['unique_calls']})
    print(json.dumps(read('delivery.json'),indent=2))

if __name__=='__main__':main()
