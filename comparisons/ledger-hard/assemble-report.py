"""Assemble the final report from recorded results without changing frozen scoring."""
import argparse, collections, subprocess
from common import *
from score import DOSSIER
from run import priced

def read(name):return json.loads((HERE/name).read_text())
def redact_dropped_model(text,status):
    output=[];previous=False
    for line in text.splitlines():
        dropped=line.startswith('| gemini-3.8-flash |')
        if dropped:
            if not previous:
                count=len(line.split('|')[1:-1])
                output.append('| '+' | '.join(['gemini-3.8-flash','All rows']+['Not reported']*(count-3)+[status])+' |')
        else:output.append(line)
        previous=dropped
    return '\n'.join(output)
def added_status(cell):
    dest=HERE/cell
    if (dest/'scores.json').exists():return read(f'{cell}/scores.json')
    runner=load_module('report_network_runner',HERE/'extended-run.py');calls=runner.answers(dest)
    measured,held=runner.accounting(dest);state=read(f'{cell}/run-state.json')
    return {'model':read(f'{cell}/seal.json')['model'],'complete':False,'unique_calls':len(calls),'planned_unique':6560,'measured_usd':measured,'unknown_attempt_reserve_usd':held,'lost_unique_requests':None,'token_limited_entries':None,'phase':state.get('phase',state.get('stop_reason') or 'pending'),'experiments':{e:{'cost_by_contestant':{s:sum(x.get('measured_usd') or 0 for x in calls if x['experiment']==e and x['side']==s) for s in ('audit','peer','peer-full-state')}} for e in ('primary','dialect')}}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-pending-gemini',action='store_true');args=parser.parse_args()
    primary=read('scores.json');variant=read('dialect/scores.json');proof=read('verification-final.json')
    dropped=read('gemini-3.8-owner-drop.json') if (HERE/'gemini-3.8-owner-drop.json').exists() else None
    full=proof['complete']
    assert full or args.allow_pending_gemini and proof['available_models_complete'],'Required model coverage is incomplete'
    assert all(t['complete'] for result in (primary,variant) for t in result['tables'] if full or t['model']!='gemini-3.8-flash')
    if full:assert proof['crash_reasked_recorded']==20
    reasked=set(proof['crash_reasked_keys'])
    seal=read('seal.json');recovery=read('crash-recovery.json');audit=read('construction-cue-audit.json')
    fees=read('luna-cache-write-fees.json') if (HERE/'luna-cache-write-fees.json').exists() else {'additional_usd':0}
    total=primary['measured_usd']+variant['measured_usd']+fees['additional_usd'];reserve=recovery['lost_attempt_reserve_usd']
    budget=read('budget-amendment.json')['cap_usd']
    lite=read('flash-lite/scores.json') if (HERE/'flash-lite/scores.json').exists() else None
    overall_total=total+(lite['measured_usd'] if lite else 0)
    lite_budget=read('flash-lite/budget-amendment.json') if (HERE/'flash-lite/budget-amendment.json').exists() else read('flash-lite/seal.json') if (HERE/'flash-lite/seal.json').exists() else {}
    overall_cap=lite_budget.get('overall_cap_usd',budget)
    assert overall_total+reserve<=overall_cap
    legacy_cap=overall_cap
    added={cell:added_status(cell) for cell in ('sonnet-5-5','gpt-6.1-sol') if (HERE/cell/'run-state.json').exists()}
    for cell,data in added.items():
        cell_cap=read(f'{cell}/budget-amendment.json')['cell_cap_usd'] if (HERE/cell/'budget-amendment.json').exists() else read(f'{cell}/seal.json')['cell_cap_usd']
        assert data['measured_usd']+data['unknown_attempt_reserve_usd']<=cell_cap
        overall_total+=data['measured_usd'];reserve+=data['unknown_attempt_reserve_usd'];overall_cap+=cell_cap
    assert abs(total-fees['additional_usd']-proof['measured_usd'])<1e-8 and total+recovery['lost_attempt_reserve_usd']<=budget
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
    primary_text=primary_text.replace('of USD 10.',f'of the amended USD {budget:g} cap.')
    primary_text=primary_text.replace('Current branch commit:', 'Analysis source commit:')
    variant_text=variant_text.replace('of USD 10.',f'of the amended USD {budget:g} cap.')
    daily=read('daily-quota-amendment.json')
    pending_label='262 requests not run: daily quota'
    status='Final' if full else 'Haiku and Luna complete; Gemini 3.8 '+pending_label+'.'
    coverage='Full sealed coverage: 384 cases per row, 1,536 per model; two primary models and three dialect models.' if full else 'Haiku and Luna have full coverage in both experiments: 384 cases per row. Gemini 3.8 has 262 requests not run: daily quota. Its unfinished cells carry no final verdict.'
    if dropped:
        primary_text=redact_dropped_model(primary_text,dropped['status'])
        variant_text=redact_dropped_model(variant_text,dropped['status'])
        status='Closed Haiku, Luna and Flash-Lite results retained; added models complete.' if all(x['complete'] for x in added.values()) else 'Haiku, Luna and Flash Lite are closed; Sonnet and Sol remain in progress.'
        coverage='Gemini 3.8: '+dropped['status']+'. Flash Lite remains the Gemini result. Gemini 3.8 has zero pending requests and must not resume.'
    lines=['# Ledger hard-row dossier','',f'{status} Recording analysis generated {stamp()}. All case and result counts come from the linked files in `comparisons/ledger-hard/`.','',
       '- '+coverage,
       f'- {primary["unique_calls"]} primary and {variant["unique_calls"]} dialect unique recorded requests, including the goal equal-evidence ablation.',
       f'- Measured spend across all recorded cells, including archived Gemini 3.8: USD {overall_total:.8f}. Unreported-attempt reserve: USD {reserve:.8f}. Combined: USD {overall_total+reserve:.8f}. Separate authorized allocations total USD {overall_cap:g}; each model allocation is enforced independently.',
       '- The construction audit passes. No pool is withdrawn. This is synthetic evidence on the original construction families.',
       '- Primary and dialect results remain separate. The dialect run uses the same cases and is not an independent replication.','',
       '## Interpretation and coverage','',
       'The pooled default comparison includes a goal row where the candidate receives final state and the default peer does not. The pooled equal-evidence comparison supplies final state to both. It is the appropriate evidence-matched comparison. Per-row exact tests are nominal; family bootstrap intervals show construction-family uncertainty. A non-significant result does not establish equivalence. The global Holm decision belongs to the collator; the added Flash-Lite model expands the original 18-cell matrix.','',
       'Haiku has a nominal pooled equal-evidence lead in both experiments, with family bootstrap difference intervals above zero. Luna has no significant pooled equal-evidence lead at provider default; its primary rubric row has a nominal loss. The medium dialect has a nominal Luna pooled lead, but its family bootstrap interval includes zero. The closed Luna primary result retains its original counting rule, including six transport-only rows counted inconclusive. Any post-close recovery is a separately labelled addendum. These results do not establish superiority on every hard row.','',
       '| Experiment | Model | Cases in each row | Pooled default W/L | Pooled equal-evidence W/L | Equal-evidence exact two-sided p | Status |',
       '|---|---|---:|---:|---:|---:|---|']
    for label,result in [('Primary',primary),('Dialect',variant)]:
        for model in sorted({t['model'] for t in result['tables']}):
            if dropped and model==dropped['model']:
                lines.append(f'| {label} | {model} | Dropped | Not reported | Not reported | Not reported | {dropped["status"]} |');continue
            a=next(t for t in result['tables'] if t['model']==model and t['row']=='pooled-default')
            b=next(t for t in result['tables'] if t['model']==model and t['row']=='pooled-equal-evidence')
            if b['complete']:
                lines.append(f'| {label} | {model} | 384/384 | {a["wins"]}/{a["losses"]} | {b["wins"]}/{b["losses"]} | {b["two_sided_p"]:.8g} | {b["nominal_verdict"]} |')
            else:lines.append(f'| {label} | {model} | Incomplete | Pending | Pending | Pending | 262 requests not run: daily quota; no final verdict |')
    if lite:
        for experiment,data in lite['experiments'].items():
            a=next(t for t in data['tables'] if t['row']=='pooled-default');b=next(t for t in data['tables'] if t['row']=='pooled-equal-evidence')
            if b['complete']:lines.append(f'| {experiment.title()} | gemini-3.5-flash-lite | 384/384 | {a["wins"]}/{a["losses"]} | {b["wins"]}/{b["losses"]} | {b["two_sided_p"]:.8g} | {b["nominal_verdict"]} |')
            else:lines.append(f'| {experiment.title()} | gemini-3.5-flash-lite | Incomplete | Pending | Pending | Pending | No final verdict |')
        lines+=['',f'The separate Flash-Lite cell records {lite["unique_calls"]}/6560 unique requests, at USD {lite["measured_usd"]:.8f}. Its amended USD {lite_budget['cell_cap_usd']:g} allocation raises the original work cap to USD {legacy_cap:g}. It uses medium reasoning as accepted by the API, with separate results and no reused Gemini 3.8 answers.']
    if added:
        lines+=['','## Added Sonnet and GPT model cells','',
           'The owner requests claude-sonnet-5-5 and gpt-6.1-sol on the same sealed cases. Each model carries both experiments and the equal-state goal ablation, totaling 6560 unique requests. Seal commit `afbd8abf` precedes every added-model call. The first five calls are retained once; continuation is gated only on measured cost, model identity and transport integrity.', '',
           '| Model | Recorded / planned | Cost USD | Reserved USD | Lost requests | Token-limited entries | Coverage |',
           '|---|---:|---:|---:|---:|---:|---|']
        for cell,data in added.items():
            hold=read(f'{cell}/cost-hold.json') if (HERE/cell/'cost-hold.json').exists() else None
            status='Complete' if data['complete'] else data.get('phase','Incomplete')+'; no score while missing'
            lines.append(f'| {data["model"]} | {data["unique_calls"]}/{data["planned_unique"]} | {data["measured_usd"]:.8f} | {data["unknown_attempt_reserve_usd"]:.8f} | {data["lost_unique_requests"] if data["complete"] else "Pending"} | {data["token_limited_entries"] if data["complete"] else "Pending"} | {status} |')
        lines+=['','| Model | Experiment | Ours USD | Default peer USD | Equal-state peer USD |','|---|---|---:|---:|---:|']
        for data in added.values():
            for experiment,ex in data['experiments'].items():
                costs=ex['cost_by_contestant']
                lines.append(f'| {data["model"]} | {experiment} | {costs["audit"]:.8f} | {costs["peer"]:.8f} | {costs["peer-full-state"]:.8f} |')
        lines+=['','Contestant costs count unique recorded calls. Reserved costs remain separate. Unanswered transport requests stay pending and receive no judge score. Full per-row scores, discordant wins/losses, exact tests, intervals and lost keys appear below only for fully answered model cells.','']
        if (HERE/'network-amendment.json').exists():lines+=['The network amendment pauses both paid drivers, then permits automatic resumption only after ten consecutive unpaid provider reachability probes spaced thirty seconds apart. Only one model runs at a time, with two concurrent calls. Three consecutive connection failures cause a ten-minute pause and a fresh ten-probe gate. Recovery cycles are unlimited within the unchanged caps and cutoff; answered requests are never resent. Unknown charges keep their reserves. Gemini 3.8 stays parked.','']
        if (HERE/'sonnet-5-5/cache-choice.json').exists():
            choice=read('sonnet-5-5/cache-choice.json')
            lines += [f'Sonnet receives an owner-approved USD 45 cap including holds. Its first five calls cost USD {choice["cached_pilot_usd"]:.6f}; the next five with prompt caching disabled cost USD {choice["uncached_pilot_usd"]:.6f}. The cheaper no-cache route applies to both contestants. These disjoint pilot prefixes differ in request mix; their cost comparison is approximate. All ten model answers count once. One CLI transport envelope is archived verbatim, classified as no answer, and recovered on its second attempt.','']
        if (HERE/'api-error-envelope-audit.json').exists():lines+=['The zero-token CLI API-error audit checks 6560 Haiku, 6560 Luna and 6560 Flash-Lite recorded requests. It finds zero matching envelopes in those earlier cells. Their answers remain unchanged. `api-error-envelope-audit.json` holds counts and journal hashes.','']
    if fees['additional_usd']:
        lines+=['','## Luna cache-write fee reconciliation','',f'The published Standard cache-write price is USD 0.125 per million tokens versus USD 0.10 for ordinary input. The fee-only reconciliation adds USD {fees["additional_usd"]:.6f} for {fees["cache_write_tokens"]} written tokens in the recorded Luna receipts. The original answers and frozen statistics are unchanged. Historical tables below retain their original cost fields; this additional fee is included in the current overall spend above. Source: `luna-cache-write-fees.json`, [OpenAI pricing](https://developers.openai.com/api/docs/pricing), checked 2026-10-13.','']
    lines+=['','## Construction-cue audit','',
       f'`audit-construction.py` reads only source, seeds, sealed cases and rendered prompts. `construction-cue-audit.json` SHA-256 is `{digest(HERE/"construction-cue-audit.json")}`. It checks all {audit["rendered"]["primary"]["entries"]} primary and {audit["rendered"]["dialect"]["entries"]} dialect rendered inputs. No model outcomes inform this audit.','',
       '| Row | Cases | Trusted contexts paired across labels | Imbalanced trusted token values | Imbalanced identity suffix values |',
       '|---|---:|---:|---:|---:|']
    for row,a in audit['rows'].items():lines.append(f'| {row} | {a["cases"]} | {a["paired_trusted_contexts"]} | {a["imbalanced_trusted_token_values"]} | {a["imbalanced_identity_values"]} |')
    lines+=['','Entity identifiers are assigned once per pair, before the true/false loop. Every trusted context appears once per label. Identity values, parity and last digits are balanced. Complete token contingency tables are retained, including semantic answer differences that correlate with truth. Case id, generation, family and truth metadata are excluded from model inputs. The audit rules out these construction cues; it does not establish absence of every semantic shortcut.','',
       '## Crash recovery and concurrency','',
       f'The plugin crash left 12 primary and 8 dialect calls without recorded answers. The owner authorized one re-ask of each key below. {len(reasked)} keys now have exactly one final recorded answer and are counted once. The lost attempts retain USD 0.40 reserve. Sources: `crash-recovery.json`, `recovery-amendment.json`, both `starts.jsonl` files and both `recovery-attempts.jsonl` files.','',
       '| Experiment | Model | Case | Side | Crash-lost key | Recovery status |','|---|---|---|---|---|---|']
    for x in recovery['items']:
        recovery_status='Re-asked once after crash; one recorded answer' if x['request_sha256'] in reasked else 'Pending Gemini top-up; not re-asked'
        lines.append(f'| {x["experiment"]} | {x["model"]} | {x["id"]} | {x["side"]} | `{x["request_sha256"]}` | {recovery_status} |')
    lines+=['',
       'Existing HTTP calls drain before runtime amendments. The later daily-quota instruction explicitly abandons two workers during backoff, after their HTTP responses return. The combined four-call cap and adaptive Luna four/two pacing applied until the later pacing boundary. `pacing-amendment.json` then replaces those concurrency limits with shared per-model limits across both experiments: gpt-6-luna eight, Gemini two, Haiku two. Luna uses plain HTTP. Independent rotating queues preserve each sealed request order and keep all three models running side by side. Sources, cap and answer contracts remain unchanged.','',
       'Gemini 3.8 HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota retries remain pending and unscored, never judge failures. Other unanswered transport failures use at most three attempts with 10/30-second waits. Every transport failure and backoff remains recorded; content is never retried. `quota-amendment.json` retains this retry policy under the later per-model pacing amendment. Unanswered attempts have no reported usage; measured cost excludes unreported charges.','',
       'Gemini prepaid credit depletion produces HTTP 402. The 532 empty rejections before the billing hold are preserved byte-for-byte in `dialect/billing-rejections.jsonl` and in the attempt journal. They carry no answer or reported usage, release only their proven-rejection holds, and never enter judge scores. No 402 receives an automatic retry. `billing-amendment.json` records the stop and the requirement for explicit owner top-up confirmation before missing-only resumption. The USD 0.40 crash reserve remains.','',
       'The owner subsequently confirms a Gemini top-up. `gemini-topup.json` names one missing request as the probe. It returns an answer, recorded once in the normal journal; `gemini-probe-result.json` records its cost and the hold release. Only requests without recorded answers resume, at two Gemini calls. The 429 waits and 402 circuit break remain active.','',
       'The owner raises the cap from USD 10 to USD 12 solely to finish the same sealed requests. `budget-amendment.json` records this runtime authorization. The case pool, request order, prompts, reasoning settings, answer contracts and statistics remain unchanged. The USD 0.40 lost-attempt reserve stays in the budget.','',
       'Primary Luna keeps provider-default reasoning for both contestants and omits temperature. The API does not report which reasoning setting that default resolves to. Dialect Luna and Gemini use medium for both contestants. Haiku exposes no reasoning control in this harness.','',
       '## Daily quota runtime amendment','',
       'Gemini reaches the shared 10,000-request daily limit on 13 October. The owner stops all further Gemini calls that day. Two requests each receive three HTTP 429 rejections and enter the 240-second backoff. The owned driver is stopped while both are in backoff, with zero HTTP calls in flight. Their six no-answer attempts remain in the journal, never scored. `dialect/quota-pending.jsonl` preserves both keys as eligible missing requests.', '',
       'The partial publication marks Gemini as "262 requests not run: daily quota". Of these, 260 are queued without a new attempt and two have quota-only rejections without an answer. This wording denotes missing scored answers. The previously recorded Gemini answers remain included once in descriptive partial tables; no incomplete pooled verdict is claimed.', '',
       'The Gemini missing-only cutoff extends to 2026-10-14 12:00 UTC. A later owner instruction supersedes reset-based resumption: Gemini resumes only on explicit owner word. The daily reset does not authorize calls. The USD 12 cap, USD 0.40 reserve, two-call Gemini limit, sealed order and answer contracts remain fixed. `daily-quota-amendment.json` records this authorization and the affected keys.', '',
       'Quota allocation: exactly 262 unique Gemini requests remain: 110 candidate goal requests, 40 default peer goal requests, and 112 equal-evidence peer goal requests. The two abandoned no-answer requests are included in 262. All 20 crash re-asks are already recorded. There are zero planned additional content re-asks. Future no-answer transport failures may require extra attempts; these cannot be fixed in advance. `owner-hold-amendment.json` records this census and the owner-only hold.', '',
       '## Native parity and verification','',
       '`verification-final.json` records coverage by model, unique scored keys, disjoint experiment keys, exact goal labels, original payload non-overlap, immutable source hashes, registered crash re-asks, resolved model IDs and the budget. `peer-decoder-parity.mts` replays every recorded successful peer answer through the pinned native verdict functions, including the native YAML fallback. `trajectory-parity.mts` checks all 384 goal summaries against the pinned helper.','',
       '| Experiment | Unique calls | Native peer answers checked | Final unsuccessful calls | Unscored billing rejections | Measured USD |','|---|---:|---:|---:|---:|---:|']
    for experiment,p in proof['experiments'].items():lines.append(f'| {experiment} | {p["recorded_unique"]}/{p["planned_unique"]} | {p["native_peer_decodes"]} | {p["final_failed_calls"]} | {p["billing_rejections_unscored"]} | {p["measured_usd"]:.8f} |')
    lines+=['',
       'Focused protocol/recovery tests pass; `test-output.txt` retains the test result. Every raw response and usage record remains in the journals. Haiku cache creation and cache reads are separate from ordinary input tokens in `verification-final.json`; CLI-reported cost is authoritative. The peer native YAML dependency is the pinned js-yaml 5.4.2 bundle, with npm integrity and upstream provenance under `native-validation/`. No node_modules directory is copied.','',
       '## Freeze hashes','',
       '| Artifact | SHA-256 |','|---|---|']
    for name in ['seal.json','accounting-amendment.json','transport-amendment.json','dialect/seal.json','recovery-amendment.json','concurrency-amendment.json','quota-amendment.json','pacing-amendment.json','billing-amendment.json','gemini-topup.json','topup-runtime-amendment.json','gemini-probe-result.json','budget-amendment.json','daily-quota-amendment.json','owner-hold-amendment.json','crash-recovery.json','seeds.json','prompts.json','dialect/prompts.json','score.py','dialect-score.py','verification-final.json']:
        lines.append(f'| `{name}` | `{digest(HERE/name)}` |')
    if lite:
        for name in ['flash-lite/seal.json','flash-lite/budget-amendment.json','flash-lite/pricing.json','flash-lite/reasoning-applied.json','flash-lite/scores.json']:
            lines.append(f'| `{name}` | `{digest(HERE/name)}` |')
    for name in ('extended-runtime-amendment.json','network-amendment.json','api-error-envelope-audit.json','luna-cache-write-fees.json','closed-cell-reporting-amendment.json','luna-transport-census.json','audit-network-runtime.py','network-verification.json','network-finish.py','gemini-3.8-owner-drop.json','supervisor-amendment.json','gpt-6.1-sol/host-crash-recovery.json'):
        if (HERE/name).exists():lines.append(f'| `{name}` | `{digest(HERE/name)}` |')
    for cell in added:
        for artifact in ('seal.json','pricing.json','pilot.json','cache-pilot.json','cache-choice.json','scores.json','verification.json','budget-amendment.json','transport-reconciliation.json'):
            name=f'{cell}/{artifact}'
            if (HERE/name).exists():lines.append(f'| `{name}` | `{digest(HERE/name)}` |')
    lines+=['',f'Candidate procedure: `{seal["candidate_procedure_sha256"]}`. Original seal commit: `eeb7875e`. Core dialect source: `{variant["core_commit"]}`; dialect seal commit: `a7954b1b`. The per-file source hash maps remain inside the seals and operational amendments.','',
       '## Original primary tables','',primary_text,'','## Dialect tables','',variant_text,'',
       '## Limits on claims','',
       '- `FINAL.md`, `delivery.json` and `verification-final.json` carry final status. Frozen scorer outputs retain historical status text in some metadata; those fields do not describe final coverage.',
       '- The planted cases reuse the original family templates with fresh bindings. Results do not demonstrate general superiority on arbitrary tasks.',
       '- Constant pass and constant fail each score 50% by label balance. Repeated-read noise and perturbation validity are unmeasured; no stability claim is made.',
       '- Information-asymmetric goal wins cannot establish a better judge on equal evidence. Both versions are disclosed.',
       '- No global matrix verdict or global Holm win is claimed here. The per-row tables and exact rational p-values support independent collation.','']
    if lite:lines+=['','## Added Flash-Lite runtime amendment','',
       'The owner adds gemini-3.5-flash-lite as a separate model cell on the same sealed cohort, for both experiments and both contestants. `flash-lite/seal.json` is committed before the first call. The first sealed request accepts medium reasoning; its answer remains recorded once. `flash-lite/reasoning-applied.json` freezes medium for all subsequent requests. Temperature is omitted.', '',
       'The owner raises the Flash-Lite allocation from USD 4 to USD 8, then to USD 9 after a usage-only projection exceeds USD 8. The overall cap rises from USD 16 to USD 20, then USD 21, retaining USD 12 for the original work. `flash-lite/budget-amendment.json` preserves both authorizations and runtime source hashes before missing-only resumption. `flash-lite/cost-forecast-late.json` records the projection without reading outcomes. The cohort, sealed order, prompts, reasoning and statistical tests remain unchanged.', '',
       'Flash Lite permits eight simultaneous HTTP calls, a 180-second timeout, and HTTP 429 waits of 20, 60 and 180 seconds. HTTP 402 stops dispatch immediately without retries. Rejections carry no judge verdict. Other unanswered transport failures permit three attempts with 10/30-second waits. Every attempt and backoff is durable; answered calls are never re-sent. Gemini 3.8 remains owner-held.', '',
       '## Added Flash-Lite measurements','',(HERE/'flash-lite/REPORT.md').read_text()]
    for cell,data in added.items():
        if data['complete']:lines+=['',f'## Added {cell} measurements','',(HERE/cell/'REPORT.md').read_text()]
    if (HERE/'gpt-6.1-sol/host-crash-recovery.json').exists():
        crash=read('gpt-6.1-sol/host-crash-recovery.json')
        lines+=['','## Authorized host-crash recovery','',f'The owner confirms that two Sol requests received no answer before the host stopped. One replacement answer per key is authorized; the original USD {crash["retained_reserve_usd"]:.2f} holds remain. Original starts and the explicit reconciliation records remain in the attempt journal. Neither key is counted twice.','', '| Request key | Original attempt | Recorded replacement answers | Recovery rule |','|---|---:|---:|---|']
        runner=load_module('report_crash_runner',HERE/'extended-run.py')
        answers=runner.answers(HERE/'gpt-6.1-sol')
        for item in crash['items']:
            key=item['start']['request_sha256'];count=sum(a['request_sha256']==key for a in answers)
            assert count<=1
            lines.append(f'| `{key}` | {item["start"]["attempt"]} | {count} | One replacement answer; keep original hold |')
    content='\n'.join(lines)
    if dropped:
        begin=content.index('## Daily quota runtime amendment')
        end=content.index('## Native parity and verification',begin)
        content=content[:begin]+'## Gemini 3.8 owner decision\n\n'+dropped['status']+'. Flash Lite remains the Gemini result.\n\nThe 262 requests never completed under the earlier quota hold are removed from pending work. No resume, probe or replacement call is scheduled. Partial recordings and their hashes are retained in `gemini-3.8-owner-drop.json`. Historical raw score files remain archival only and are excluded from current reported tables and scoring inputs. Recorded spend remains charged; no model budget is increased.\n\n'+content[end:]
        content=content.replace('Gemini 3.8 stays parked.','Gemini 3.8 is dropped; no calls will resume.').replace('Gemini 3.8 remains owner-held.','Gemini 3.8 is dropped; no calls will resume.').replace('Gemini 3.8 is parked and its journals remain unchanged.','Gemini 3.8 is dropped and its journals remain unchanged.')
        content=content.replace('## Crash recovery and concurrency','## Historical crash recovery and runtime amendments\n\nThe following operational history is superseded by the owner drop for Gemini 3.8. It does not authorize further Gemini 3.8 calls.')
    assert '\u2014' not in content and '\u2013' not in content
    assert len(recovery['items'])==20
    for x in recovery['items']:assert content.count(x['request_sha256'])==1
    (HERE/'FINAL.md').write_text(content);DOSSIER.write_text(content)
    dump(HERE/'delivery.json',{'created':stamp(),'dossier':str(DOSSIER),'dossier_sha256':digest(DOSSIER),'local_final_sha256':digest(HERE/'FINAL.md'),
         'full_coverage':(full or bool(dropped) and proof['available_models_complete']) and all(x['complete'] for x in added.values()),'original_frozen_matrix_complete':full,'available_models_complete':proof['available_models_complete'] and all(x['complete'] for x in added.values()),'dropped_models':[{k:dropped[k] for k in ('model','status','pending_requests','archival_unrun_requests','report_score')}] if dropped else [],'pending_requests_by_model':{data['model']:data['planned_unique']-data['unique_calls'] for data in added.values()}|({} if dropped else {'gemini-3.8-flash':262}),'measured_usd':overall_total,'lost_attempt_reserve_usd':reserve,'unique_recorded_requests':primary['unique_calls']+variant['unique_calls']+(lite['unique_calls'] if lite else 0)+sum(x['unique_calls'] for x in added.values()),'flash_lite_complete':lite['complete'] if lite else False,'added_models':{c:{k:d[k] for k in ('model','complete','unique_calls','measured_usd','lost_unique_requests','token_limited_entries')} for c,d in added.items()},'overall_cap_usd':overall_cap})
    print(json.dumps(read('delivery.json'),indent=2))

if __name__=='__main__':main()
