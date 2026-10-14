"""Durably bound physical recovery submissions for the 35 owner-authorized requests."""
import datetime,fcntl,json,sys
from pathlib import Path

def claim(path,allowed,fingerprint,receipt):
    assert fingerprint in allowed, 'Request is outside the authorized recovery set'
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('a+') as f:
        fcntl.flock(f,fcntl.LOCK_EX);f.seek(0)
        state=json.loads(f.read() or '{}')
        rows=state.setdefault(fingerprint,[])
        if len(rows)>=2:return dict(allowed=False,totalSubmissions=1+len(rows))
        rows.append(dict(receipt=receipt,at=datetime.datetime.now(datetime.timezone.utc).isoformat()))
        f.seek(0);f.truncate();json.dump(state,f,indent=2);f.write('\n');f.flush()
        return dict(allowed=True,totalSubmissions=1+len(rows))

if __name__=='__main__':
    base=Path(__file__).resolve().parent/'lite'
    name=sys.argv[3] if len(sys.argv)>3 else 'network'
    assert name in ['network','test-network']
    wave=json.loads((base/f'evidence/{name}-wave.json').read_text())
    print(json.dumps(claim(base/f'receipts/{name}-recovery-claims.json',{r['fingerprint'] for r in wave['errors']},sys.argv[1],sys.argv[2])))
