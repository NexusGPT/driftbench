"""One sealed missing request gates Gemini's owner-authorized billing resumption."""
import fcntl, subprocess
import resume as r

def main():
    locks=[]
    for directory in (r.HERE,r.HERE/'dialect'):
        lock=(directory/'runner.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(lock)
    r.primary.verify_seal();r.variant.verify()
    auth=r.json.loads((r.HERE/'gemini-topup.json').read_text())
    assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/gemini-topup.json'],cwd=r.ROOT)==(r.HERE/'gemini-topup.json').read_bytes()
    amend=r.json.loads((r.HERE/'topup-runtime-amendment.json').read_text())
    assert subprocess.check_output(['git','show','HEAD:comparisons/ledger-hard/topup-runtime-amendment.json'],cwd=r.ROOT)==(r.HERE/'topup-runtime-amendment.json').read_bytes()
    for name,value in amend['sha256'].items():assert r.digest(r.ROOT/name)==value
    key=auth['probe']['request_sha256']
    answers=r.variant.variant_records()
    assert key not in {a['request_sha256'] for a in answers},'Never re-send an answered probe'
    assert not (r.HERE/'gemini-probe-result.json').exists(),'Probe already attempted; inspect its record'
    request=next(x for x in r.variant.all_requests() if x['request_sha256']==key)
    request=dict(request,experiment='dialect',crash_reask=key in {a['request_sha256'] for a in r.json.loads((r.HERE/'crash-recovery.json').read_text())['items']})
    measured=sum(r.measured(a) for a in r.records()+answers)
    assert measured+.4+.02<=10
    r.primary.append(r.HERE/'dialect/starts.jsonl',{k:v for k,v in request.items() if k not in ('prompt','built')}|{'started':r.stamp(),'topup_probe':True})
    answer=r.work(request)
    answered=bool(answer.get('provider_response') and answer.get('text'))
    result={'stamp':r.stamp(),'request_sha256':key,'answered':answered,'success':answer.get('success'),
            'error_status':(answer.get('error') or {}).get('status'),'measured_usd':r.measured(answer),'hold_released':answered}
    r.dump(r.HERE/'gemini-probe-result.json',result)
    if answered:
        r.dump(r.HERE/'provider-holds.json',{'stamp':r.stamp(),'models':[],'reason':'Owner top-up confirmed and one missing request answered','probe_request_sha256':key})
    print(r.json.dumps(result,indent=2))

if __name__=='__main__':main()
