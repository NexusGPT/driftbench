"""Render the lane dossier from immutable inputs and recorded observations."""
import datetime
import collections
import hashlib
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
DEST=Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-wp.md')

def load(path,default=None):
    p=HERE/path
    return json.loads(p.read_text()) if p.exists() else default

def records(path):
    p=HERE/path
    return [json.loads(x) for x in p.read_text().splitlines() if x] if p.exists() else []

def f(value,digits=2):
    return 'pending' if value is None else f'{value:.{digits}f}'

def interval(value):
    return 'pending' if value is None else ' to '.join(f(x) for x in value)

def main():
    manifest=load('seals/manifest.json'); freeze=load('freeze.json'); cells=load('results/cells.json')['cells']
    phase=load('results/phase-report.json',{})
    pending={}; actual=0
    for row in records('results/spend.jsonl'):
        if row['kind']=='reserve':pending[row['key']]=row['usd']
        elif row['kind']=='settle':actual+=row['usd'];pending.pop(row['key'],None)
        elif row['kind']=='release':pending.pop(row['key'],None)
    calls=records('results/calls.jsonl')
    decisions=records('results/decisions.jsonl')
    quota=freeze.get('geminiDailyQuotaAmendment',{})
    progress=load('results/progress.json',{})
    gemini_dev=sum(r['model']=='gemini-3.8-flash' and r['split']=='dev' for r in decisions)
    gemini_test=sum(r['model']=='gemini-3.8-flash' and r['split']=='test' for r in decisions)
    quota_parked=bool(quota) and gemini_dev+gemini_test<789 and (
        datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(quota['resumeNotBefore']) or
        progress.get('models',{}).get('gemini-3.8-flash',{}).get('status')=='stopped')
    quota_status=(f"Gemini: not run: daily quota. Development comparisons: {gemini_dev}/270 complete, {270-gemini_dev} missing. Test comparisons: {gemini_test}/519 complete, {519-gemini_test} missing. No-answer quota rejections are not judge failures. Missing-only resumption is authorized after 2026-10-14 00:00 UTC or on the owner's word, with a Gemini-only last-call cutoff of 2026-10-14 12:00 UTC. Source: `freeze.json` and `results/decisions.jsonl`.") if quota_parked else 'Provider status follows the coverage table below.'
    validity=load('results/validity-checks.json',{})
    failed_dev=[r for r in phase.get('dev',[]) if r['contestant']=='pair-ledger' and r.get('noise',{}).get('completeTriplePairs')==30 and not r.get('cheaterBarPass')]
    dev_warning=('Preregistered development validity fails the cheater bar for '+', '.join(r['model'] for r in failed_dev)+'. The full test runs under explicit owner authorization without tuning. This study cannot claim that all validity gates pass. Source: `results/phase-report.json`.') if failed_dev else 'Development validity is reported below; incomplete checks remain pending.'
    primary=[]
    for row in cells:
        if row['contestant']!='pair-ledger':continue
        comparison=row.get('comparison',{})
        verdict='pending'
        if comparison.get('matchedPairs')==173:
            delta=comparison['deltaPoints'];p=comparison['mcnemarTwoSided']
            verdict='LOSS' if delta<0 and p<.05 else 'TIE' if p>=.05 or delta==0 else 'positive result, Holm-18 pending'
        primary.append({'model':row['model'],'verdict':verdict,'comparison':comparison})
    (HERE/'results/primary-disposition.json').write_text(json.dumps(primary,indent=2)+'\n')
    primary_summary='; '.join(r['model']+': '+r['verdict'] for r in primary)
    reasks=[]
    for scope in ['all phases','test']:
        for model in ['haiku','gpt-6-luna','gemini-3.8-flash']:
            selected=[r for r in decisions if r['contestant']=='pair-ledger' and r['model']==model and (scope=='all phases' or r['split']=='test')]
            reads=[read for row in selected for read in row['details']['reads']]
            repeated=[read for read in reads if any(step['ruleId']=='ledger.reask' for step in read['parseSteps'])]
            reasks.append({'scope':scope,'model':model,'completedPairs':len(selected),'orderedReadings':len(reads),
                           'schemaReasks':len(repeated),'recovered':sum(not read['result'].get('unparsed',False) for read in repeated),
                           'reaskCostUsd':sum(attempt.get('costUsd',0) for read in repeated for attempt in read['attempts'][1:])})
    (HERE/'results/reasks.json').write_text(json.dumps(reasks,indent=2)+'\n')
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
    lines=['# LongJudge writing pair ledger study','',f"Measured state: {datetime.datetime.now(datetime.timezone.utc).isoformat()}. Branch `research/ledger-wp`, local head `{head}`.",'',
        '## Outcome','',
        'The model table below is the observed result, including pending and partial cells. No global superiority claim is made. This row is preregistered as no significant loss, not an assumed win.','',
        primary_summary+'. TIE follows the preregistered significance rule and does not establish equivalence. Source: `results/primary-disposition.json`.','',
        dev_warning,'',
        ('Gemini is parked pending an owner-confirmed credit top-up. The owner reports depleted prepaid credits from another cell; this cell makes no new Gemini probe. Haiku and Luna continue.' if freeze.get('geminiCreditHold',{}).get('active') else quota_status),'',
        f"Actual recorded model spend: {actual:.8f} USD. Unsettled reservations: {sum(pending.values()):.8f} USD. Total lane cap: {freeze['capUsd']} USD. Recorded call attempts: {len(calls)}. Source: `results/spend.jsonl` and `results/calls.jsonl`.",'',
        '## Licence and label provenance','',
        '- WritingPreferenceBench is attributed to Shuangshuang Ying and coauthors. Both fetched dataset READMEs specify ODC-BY, research and educational use, attribution, and respect for referenced data licences.',
        '- Sources: [dataset repository](https://github.com/WritingPreferenceBench/Writing-Preference-Bench), [Hugging Face release](https://huggingface.co/datasets/m-a-p/Writing-Preference-Bench), [paper section 2.1](https://arxiv.org/html/2510.14616v2#S2.SS1). Fetched URLs and hashes: `sources/receipts.json` and `sources/hf-receipts.json`.',
        '- The paper describes expert human quality scoring and preference selection. The distributed chosen/rejected fields supply gold labels. Individual annotator ballots are not independently recovered.',
        '- Three Chinese release records have chosen and rejected scores of zero. Those ambiguous labels are excluded before selection. Their indices and content hashes are in `seals/manifest.json`.',
        '- Full licence, label mapping, source-family caveat and scope: `examples/ledger-wp/PROVENANCE.md`.','',
        '## Sealed pool','',
        f"- Source population: {manifest['sourcePairs']} pairs. Eligible fresh pool: {manifest['eligibleFreshPairs']} pairs. The test seal selects 173 pairs with seeded SHA-256 ranks, without contestant outcomes.",
        '- Test has 346 games, 146 request clusters, 122 English pairs and 51 Chinese pairs. All LongJudge exact pairs, request IDs and question hashes are excluded.',
        '- Recorded-ID union: 54 files, 4,080 IDs. The named `codex-mm` and `astra-hard` worktrees are absent. Novelty is bounded to the available enumerated recordings; model pretraining is unverified.',
        '- Dev and pilot are previously evaluated LongJudge dev requests, mutually request-disjoint and separate from the new test pool.',
        '- Counts, source mapping and exclusion audit: `seals/manifest.json`, `seals/recorded-id-union.json`, and `seals/recording-inventory.json`.','',
        '| Seal | Pairs | Pre-call commit | SHA-256 |','|---|---:|---|---|']
    for split,sha in freeze['seals'].items():
        lines.append(f"| {split} | {len(load('seals/'+split+'.json'))} | `{freeze['sealCommits'][split]}` | `{sha}` |")
    lines+=['','## Model cells','',
        'Scores use normalized presentation games. Ties and unparsed pair-ledger or promptfoo games are wrong. Reader-first retains its frozen longer-response fallback when a rubric ballot is invalid; the error count exposes that behavior.','',
        '| Model | Contestant | Pairs / 173 | Correct games | Accuracy % | Wilson 95% | Errors | USD / 100 pairs | USD / 100 games |',
        '|---|---|---:|---:|---:|---|---:|---:|---:|']
    cost_audit=[]
    for row in cells:
        if row['model']=='machine':continue
        error_cost=sum(c.get('costUsd',0) for c in calls if c['split']=='test' and c['model']==row['model'] and c['contestant']==row['contestant'] and c.get('providerError'))
        total_cost=row['recipeUsd']+error_cost
        per_pair=total_cost/row['pairs']*100 if row['pairs'] else None
        per_game=total_cost/row['games']*100 if row['games'] else None
        cost_audit.append({'model':row['model'],'contestant':row['contestant'],'decisionCostUsd':row['recipeUsd'],'knownNoAnswerCostUsd':error_cost,'totalKnownCostUsd':total_cost,'usdPer100Pairs':per_pair,'usdPer100Games':per_game})
        lines.append(f"| {row['model']} | {row['contestant']} | {row['pairs']} | {row['correct']}/{row['games']} | {f(row['accuracy'])} | {interval(row['wilson95'])} | {row['graderErrors']} | {f(per_pair,5)} | {f(per_game,5)} |")
    (HERE/'results/cost-audit.json').write_text(json.dumps(cost_audit,indent=2)+'\n')
    lines+=['','Cost rates include known charges from no-answer transport attempts. Frozen score output keeps successful decision costs; `results/cost-audit.json` adds observed failed-attempt charges without changing any decision. The known portion moves from held spend to actual spend; the unresolved balance remains held.','']
    lines+=['','Reader-first is the separate opt-in PR 157 row at `c50b2dc3`. It has a length prior and a defect-gated override. It is not included in the primary pair-ledger family. Both its games share one normalized decision; pair-ledger reconciliation does the same. Raw readings remain in `results/decisions.jsonl`.','',
        '| Model | Challenger vs promptfoo | Matched pairs | Wins / losses | Difference, points | Request-cluster 95% | Exact two-sided p | Holm-18 |',
        '|---|---|---:|---:|---:|---|---:|---|']
    for row in cells:
        comparison=row.get('comparison')
        if comparison is None:continue
        holm='not applicable, exploratory' if row['contestant']=='reader-first-c50b2dc3' else 'pending full primary family'
        lines.append(f"| {row['model']} | {row['contestant']} | {comparison['matchedPairs']} | {comparison['wins']}/{comparison['losses']} | {f(comparison['deltaPoints'])} | {interval(comparison['requestCluster95'])} | {f(comparison['mcnemarTwoSided'],6)} | {holm} |")
    lines+=['','Per-cell game McNemar is the requested nominal test. Games sharing a pair and request are dependent. Interpret the request-cluster interval alongside that p value. Holm awaits the complete cross-benchmark primary family. Reader-first remains exploratory. Source: `results/cells.json` and frozen `stats.py`.','',
        '## Cheaters on the identical test seal','',
        '| Control | Correct games | Accuracy % | Wilson 95% | USD |','|---|---:|---:|---|---:|']
    for row in cells:
        if row['model']!='machine':continue
        lines.append(f"| {row['contestant']} | {row['correct']}/{row['games']} | {f(row['accuracy'])} | {interval(row['wilson95'])} | 0 |")
    lines+=['','Longer-wins uses whitespace units in English and Han characters in Chinese, matching the frozen reader feature. The test control scores 234/346 games, 67.63%. This baseline is independent of model judging and is not evidence of superior writing assessment.','',
        '| Separate reader-first row | Observed test pairs | Identical choices to longer-wins | Different choices |',
        '|---|---:|---:|---:|']
    control={r['id']:r['games'] for r in decisions if r['split']=='test' and r['contestant']=='longer-wins'}
    reader_comparisons=[]
    for model in ['haiku','gpt-6-luna','gemini-3.8-flash']:
        selected=[r for r in decisions if r['split']=='test' and r['model']==model and r['contestant']=='reader-first-c50b2dc3']
        same=sum(r['games']==control[r['id']] for r in selected)
        reader_comparisons.append({'model':model,'observedPairs':len(selected),'identicalToLongerWins':same,'differentFromLongerWins':len(selected)-same})
        lines.append(f"| {model} | {len(selected)} | {same} | {len(selected)-same} |")
    (HERE/'results/reader-vs-longer.json').write_text(json.dumps(reader_comparisons,indent=2)+'\n')
    lines+=['','This comparison uses every recorded test choice, not accuracy alone. Exact agreement with the control cannot support an added writing-quality benefit. Source: `results/reader-vs-longer.json` and `results/decisions.jsonl`.','',
        '## Pilot and dev checks','',
        '| Stage | Model | Contestant | Pairs | Accuracy % | Projected test USD | Noise flips / comparisons | Fixture seat | Cheater bar |',
        '|---|---|---|---:|---:|---:|---|---|---|']
    for stage in ['pilot','dev']:
        for row in phase.get(stage,[]):
            noise=row.get('noise',{})
            fixture_count=sum(r['split']=='fixtures' and r['model']==row['model'] and r['contestant']==row['contestant'] for r in decisions)
            seat=row.get('earnedFixtureSeat','pending') if fixture_count==18 else 'pending'
            cheater_bar=row.get('cheaterBarPass','pending') if row['pairs']==30 else 'pending'
            lines.append(f"| {stage} | {row['model']} | {row['contestant']} | {row['pairs']} | {f(row['accuracy'])} | {f(row.get('projectedTestUsd'),4)} | {noise.get('repeatGameFlips','pending')}/{noise.get('comparisons','pending')} | {seat} | {cheater_bar} |")
    lines+=['','Detailed three-repeat noise, six planted fixtures, kappa, label-preserving, injection and label-flipping checks: `results/phase-report.json`. Unrun checks are pending, not passed. Source and parser remain frozen; no tuning follows these observations.','',
        '| Model | Contestant | Edit | Observed / expected pairs | Consistent games | Consistency % | Preregistered bar % | Verdict |',
        '|---|---|---|---:|---:|---:|---:|---|']
    for row in validity.get('cells',[]):
        for kind,check in row['checks'].items():
            verdict='pending' if check['passes'] is None else 'pass' if check['passes'] else 'fail'
            lines.append(f"| {row['model']} | {row['contestant']} | {kind} | {check['observedPairs']}/{check['expectedPairs']} | {check['matchingGames']}/{check['games']} | {f(check['consistencyPercent'])} | {check['thresholdPercent']} | {verdict} |")
    lines+=['','Edit consistency compares each variant with the first sealed fixture reading. Relabelling maps the choice back; label-flipping edits require the opposite choice. Planted accuracy is also retained in `results/validity-checks.json`. These are small planted checks, not estimates over arbitrary writing.','',
        '## Runtime audit','',
        '| Model | Contestant | Recorded attempts | Output-limit finishes | Provider errors | HTTP 429, all / test |',
        '|---|---|---:|---:|---:|---:|']
    transport_summary=[]
    for model in ['haiku','gpt-6-luna','gemini-3.8-flash']:
        for contestant in ['pair-ledger','reader-first-c50b2dc3','promptfoo']:
            subset=[r for r in calls if r['model']==model and r['contestant']==contestant]
            limited=sum(r.get('providerMeta',{}).get('finishReason') in ['MAX_TOKENS','length'] for r in subset)
            rate_limits=[r for r in subset if r.get('providerError') and 'Provider 429:' in r['text']]
            test_rate_limits=sum(r['split']=='test' for r in rate_limits)
            transport_summary.append({'model':model,'contestant':contestant,'http429All':len(rate_limits),'http429Test':test_rate_limits,
                                      'byPhase':dict(collections.Counter(r['split'] for r in rate_limits))})
            lines.append(f"| {model} | {contestant} | {len(subset)} | {limited} | {sum(bool(r.get('providerError')) for r in subset)} | {len(rate_limits)}/{test_rate_limits} |")
    (HERE/'results/transport-summary.json').write_text(json.dumps(transport_summary,indent=2)+'\n')
    lines+=['','The common HTTP output limit can truncate a reasoning-heavy response. This is recorded, not repaired outside the frozen contract. In the separate reader-first row, an invalid ballot can still yield the frozen length fallback. Source: `results/calls.jsonl`.','',
        '| Scope | Model | Ordered readings | Schema re-asks | Recovered | Re-ask USD, already in total |',
        '|---|---|---:|---:|---:|---:|']
    for row in reasks:
        lines.append(f"| {row['scope']} | {row['model']} | {row['orderedReadings']} | {row['schemaReasks']} | {row['recovered']} | {f(row['reaskCostUsd'],8)} |")
    lines+=['','The owner explicitly preserves the frozen core single schema re-ask after malformed JSON. The no-returned-answer-retry rule applies to transport wrappers. Frequencies count `ledger.reask` in completed pair readings; their second attempt cost is included in each decision and the overall spend. Source: `results/reasks.json` and `results/decisions.jsonl`.','',
        '## Freeze and execution','',
        '- Core: [PR 168](https://github.com/achammah/driftbench/pull/168), `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`, remote hash verified before calls.',
        '- Reader-first: [PR 157](https://github.com/achammah/driftbench/pull/157), source snapshot `c50b2dc3`.',
        '- Promptfoo select-best: `801428268b5e421b2f6994332f6a06f86b27bb1f`, verbatim attributed template and MIT notice.',
        f"- Original judge freeze commit: `a4ae4b33`. Initial freeze SHA-256: `1fb32801af8549c7a4bef7a6c271c1799e950a84316e9fcb027ef757a36b3682`, preserved in `freeze-initial.json`. Current freeze SHA-256: `{hashlib.sha256((HERE/'freeze.json').read_bytes()).hexdigest()}`. The 191 exact file hashes are in `freeze.json`.",
        '- Runtime amendments set the spending cap to 35 USD, transport timeouts to 300 seconds, and the per-model scheduling limits below. Judge contracts, parser behavior, models, medium reasoning, output limits, statistics and sealed order are unchanged.',
        '- The first plugin crash interrupts six pilot calls; their 0.90 USD reservations remain uncertain. A second reconnect finds one Gemini fetch failure and three unfinished native calls. All uncertain reservations remain counted. See `runtime-recovery.json`, `runtime-recovery-2.json`, and `results/spend.jsonl`.',
        '- The latest owner authorization permits three retries after an initial HTTP 429, with waits of 60, 120 and 240 seconds. Other transport failures allow three submissions total. Timeouts are 300 seconds. Returned model answers never receive transport retries.',
        '- The latest pacing amendment runs all three models side by side: gpt-6-luna uses at most eight plain HTTP calls, Gemini two calls, and Haiku two calls. Each model keeps its sealed order and phase prerequisites. All queues share one spending ledger.',
        '- This supersedes the earlier Haiku/Luna-first schedule. HTTP 429 returns no model answer and is counted separately per cell, never as a judge failure. Exhausted Gemini rate-limit recovery parks only Gemini while other models continue.',
        '- The owner confirms a Gemini credit top-up after the temporary hold. Gemini resumes missing-only: the first missing sealed call probes alone, then its returned answer opens the two-call queue. Cached answers remain unchanged. Probe evidence is in `results/gemini-resume-probe.json` when available. An observed HTTP 402 immediately stops all Gemini submissions and releases only holds for proven HTTP 402 rejections. Other interrupted holds remain uncertain; provider failures never become judge decisions.',
        '- Two named Luna development calls exhaust three transport submissions with no answer. The owner authorizes one additional cycle of at most three submissions each after a successful connectivity probe. The exact call keys and expected unauthenticated HTTP 401 probe are in `freeze.json`; a second exhaustion remains missing and does not block the full test.',
        f"- Haiku and Luna last-call cutoff: `{freeze['lastCallUtc']}`. The owner extends it from 13:00 to 16:00 UTC because shared Gemini quota requires model reordering. This changes no judge contract, seal or spending cap; the authorization is in `freeze.json`.",
        '- The later daily quota amendment stops Gemini on 13 October. The owner identifies `generate_requests_per_model_per_day`, a 10,000-request limit and reset near 00:00 UTC on 14 October. This is owner-supplied quota diagnosis; this cell observes HTTP 429. Gemini alone may finish missing comparisons until 14 October 12:00 UTC. Existing answered calls and attempt counts remain fixed; time already spent in backoff counts toward the prescribed waits. The reset run probes its first missing call alone before concurrency two.',
        '- Both HTTP models use medium reasoning for every contestant and the same 4096 output-token cap. Haiku uses native Claude CLI without an exposed reasoning setting.',
        '- The owner unblocks Gemini billing and restricts key files to `openai.key` and `gemini-driftbench.key`. Keys load inside each command and are not printed.',
        '- Six analysis tests and sixteen harness tests pass before the daily quota resume is committed. Coverage includes charged transport accounting, elapsed backoff credit, the single-probe barrier, rejection blocking, source tamper rejection, shared spend reservations, proven HTTP 402 hold release, transport backoff, per-model concurrency, sealed queue order, provider isolation, output polarity and the pushed-core adapter.',
        '- All paths above are relative to `examples/ledger-wp` unless prefixed otherwise. The branch is [research/ledger-wp](https://github.com/achammah/driftbench/tree/research/ledger-wp). Remote delivery is verified separately at handoff.','']
    text='\n'.join(lines)
    assert '\u2014' not in text and '\u2013' not in text
    DEST.write_text(text)
    (HERE/'results/report.md').write_text(text)
    print(json.dumps({'dossier':str(DEST),'bytes':len(text.encode()),'actualUsd':actual,'uncertainUsd':sum(pending.values()),'returnedCalls':len(calls)}))

if __name__=='__main__':main()
