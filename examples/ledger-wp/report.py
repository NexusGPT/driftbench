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
    validity=load('results/validity-checks.json',{})
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT).decode().strip()
    lines=['# LongJudge writing pair ledger study','',f"Measured state: {datetime.datetime.now(datetime.timezone.utc).isoformat()}. Branch `research/ledger-wp`, local head `{head}`.",'',
        '## Outcome','',
        'The model table below is the observed result, including pending and partial cells. No global superiority claim is made. This row is preregistered as no significant loss, not an assumed win.','',
        f"Actual recorded model spend: {actual:.8f} USD. Unsettled reservations: {sum(pending.values()):.8f} USD. Total lane cap: {freeze['capUsd']} USD. Returned calls: {len(calls)}. Source: `results/spend.jsonl` and `results/calls.jsonl`.",'',
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
        '| Model | Contestant | Pairs / 173 | Correct games | Accuracy % | Wilson 95% | Errors | USD / 100 pairs |',
        '|---|---|---:|---:|---:|---|---:|---:|']
    for row in cells:
        if row['model']=='machine':continue
        lines.append(f"| {row['model']} | {row['contestant']} | {row['pairs']} | {row['correct']}/{row['games']} | {f(row['accuracy'])} | {interval(row['wilson95'])} | {row['graderErrors']} | {f(row['usdPer100Pairs'],5)} |")
    lines+=['','Reader-first is the separate opt-in PR 157 row at `c50b2dc3`. It has a length prior and a defect-gated override. It is not included in the primary pair-ledger family. Both its games share one normalized decision; pair-ledger reconciliation does the same. Raw readings remain in `results/decisions.jsonl`.','',
        '| Model | Challenger vs promptfoo | Matched pairs | Wins / losses | Difference, points | Request-cluster 95% | Exact two-sided p | Holm-18 |',
        '|---|---|---:|---:|---:|---|---:|---|']
    for row in cells:
        comparison=row.get('comparison')
        if comparison is None:continue
        lines.append(f"| {row['model']} | {row['contestant']} | {comparison['matchedPairs']} | {comparison['wins']}/{comparison['losses']} | {f(comparison['deltaPoints'])} | {interval(comparison['requestCluster95'])} | {f(comparison['mcnemarTwoSided'],6)} | pending full primary family |")
    lines+=['','Per-cell game McNemar is the requested nominal test. Games sharing a pair and request are dependent. Interpret the request-cluster interval alongside that p value. Holm awaits the complete cross-benchmark primary family. Reader-first remains exploratory. Source: `results/cells.json` and frozen `stats.py`.','',
        '## Cheaters on the identical test seal','',
        '| Control | Correct games | Accuracy % | Wilson 95% | USD |','|---|---:|---:|---|---:|']
    for row in cells:
        if row['model']!='machine':continue
        lines.append(f"| {row['contestant']} | {row['correct']}/{row['games']} | {f(row['accuracy'])} | {interval(row['wilson95'])} | 0 |")
    lines+=['','Longer-wins uses whitespace units in English and Han characters in Chinese, matching the frozen reader feature. The test control scores 234/346 games, 67.63%. This baseline is independent of model judging and is not evidence of superior writing assessment.','',
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
        '| Model | Contestant | Returned calls | Output-limit finishes | Recorded provider errors |',
        '|---|---|---:|---:|---:|']
    for model in ['haiku','gpt-6-luna','gemini-3.8-flash']:
        for contestant in ['pair-ledger','reader-first-c50b2dc3','promptfoo']:
            subset=[r for r in calls if r['model']==model and r['contestant']==contestant]
            limited=sum(r.get('providerMeta',{}).get('finishReason') in ['MAX_TOKENS','length'] for r in subset)
            lines.append(f"| {model} | {contestant} | {len(subset)} | {limited} | {sum(bool(r.get('providerError')) for r in subset)} |")
    lines+=['','The common HTTP output limit can truncate a reasoning-heavy response. This is recorded, not repaired outside the frozen contract. In the separate reader-first row, an invalid ballot can still yield the frozen length fallback. Source: `results/calls.jsonl`.','',
        '## Freeze and execution','',
        '- Core: [PR 168](https://github.com/achammah/driftbench/pull/168), `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`, remote hash verified before calls.',
        '- Reader-first: [PR 157](https://github.com/achammah/driftbench/pull/157), source snapshot `c50b2dc3`.',
        '- Promptfoo select-best: `801428268b5e421b2f6994332f6a06f86b27bb1f`, verbatim attributed template and MIT notice.',
        f"- Original judge freeze commit: `a4ae4b33`. Initial freeze SHA-256: `1fb32801af8549c7a4bef7a6c271c1799e950a84316e9fcb027ef757a36b3682`, preserved in `freeze-initial.json`. Current freeze SHA-256: `{hashlib.sha256((HERE/'freeze.json').read_bytes()).hexdigest()}`. The 191 exact file hashes are in `freeze.json`.",
        '- The owner changes only the spending cap to 35 USD, transport timeouts to 300 seconds, and concurrency to four. Judge contracts, parser behavior, models, medium reasoning, output limits, statistics and sealed order are unchanged.',
        '- The first plugin crash interrupts six pilot calls; their 0.90 USD reservations remain uncertain. A second reconnect finds one Gemini fetch failure and three unfinished native calls. All uncertain reservations remain counted. See `runtime-recovery.json`, `runtime-recovery-2.json`, and `results/spend.jsonl`.',
        '- The latest owner authorization permits at most three transport attempts with 300 second timeouts. Every returned model answer, including refusals and truncated content, is reused without a transport retry.',
        '- Both HTTP models use medium reasoning for every contestant and the same 4096 output-token cap. Haiku uses native Claude CLI without an exposed reasoning setting.',
        '- The owner unblocks Gemini billing and restricts key files to `openai.key` and `gemini-driftbench.key`. Keys load inside each command and are not printed.',
        '- Six analysis tests and seven initial harness tests pass before calls; the transport amendment adds one passing error-classification test, including source tamper rejection, concurrent spend reservation, output polarity and the pushed-core adapter.',
        '- All paths above are relative to `examples/ledger-wp` unless prefixed otherwise. The branch is [research/ledger-wp](https://github.com/achammah/driftbench/tree/research/ledger-wp). Remote delivery is verified separately at handoff.','']
    text='\n'.join(lines)
    assert '\u2014' not in text and '\u2013' not in text
    DEST.write_text(text)
    (HERE/'results/report.md').write_text(text)
    print(json.dumps({'dossier':str(DEST),'bytes':len(text.encode()),'actualUsd':actual,'uncertainUsd':sum(pending.values()),'returnedCalls':len(calls)}))

if __name__=='__main__':main()
