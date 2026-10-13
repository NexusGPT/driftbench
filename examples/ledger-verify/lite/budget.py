"""Process-safe reservations across both model cells, pilots and repeat calls."""
import fcntl
import json
import math
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone
from pacing import observe


def transact(path, action, token, amount=0.5, model='', pid=None):
    path=Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        stream.seek(0)
        raw=stream.read()
        state=json.loads(raw) if raw else dict(capUsd=6.0, spentUsd=0.0, reservations={}, receipts=[])
        assert math.isfinite(amount) and amount >= 0
        if action in ('acquire','try-acquire','reserve') and state.get('billingStopped'):
            raise RuntimeError('Billing circuit open: HTTP 402; owner action required')
        if action in ('acquire','try-acquire'):
            active=state.setdefault('activeCalls',{})
            for key,entry in list(active.items()):
                try: os.kill(entry['pid'],0)
                except ProcessLookupError: del active[key]
            limits={'gemini-3.5-flash-lite':4}
            if model=='haiku':
                pacing=state.get('haikuPacing',{})
                if time.time()-pacing.get('observedAt',0)>=5:
                    pacing=observe(path.parent)
                    if pacing['limit']!=state.get('haikuPacing',{}).get('limit'):
                        state.setdefault('haikuPacingEvents',[]).append(pacing)
                    state['haikuPacing']=pacing
                limits['haiku']=pacing['limit']
            busy=sum(r['model']==model for r in active.values())>=limits.get(model,4)
            if busy:
                if action=='try-acquire':return dict(acquired=False)
                raise RuntimeError('Concurrency limit: the model has no available provider slot')
            assert token not in active and isinstance(pid,int) and pid>0
            active[token]=dict(pid=pid,model=model,at=datetime.now(timezone.utc).isoformat())
            state['peakActiveCalls']=max(state.get('peakActiveCalls',0),len(active))
        elif action=='release':
            state.setdefault('activeCalls',{}).pop(token,None)
        elif action=='reserve':
            assert token not in state['reservations'] and all(r['id']!=token for r in state['receipts'])
            committed=state['spentUsd']+sum(r['usd'] for r in state['reservations'].values())
            if committed+amount > state['capUsd']:
                raise RuntimeError('Budget limit: insufficient unreserved lane funds')
            state['reservations'][token]=dict(usd=amount,model=model,at=datetime.now(timezone.utc).isoformat())
        elif action=='settle':
            reserved=state['reservations'][token]
            # Never drop evidence when a provider violates the declared bound.
            state['spentUsd']+=amount
            state['receipts'].append(dict(id=token,model=reserved['model'],usd=amount,
                reservedUsd=reserved['usd'],overReservation=amount>reserved['usd'],
                at=datetime.now(timezone.utc).isoformat()))
            del state['reservations'][token]
            if amount>reserved['usd']:
                state['capUsd']=state['spentUsd']  # Stop subsequent calls for investigation.
        elif action=='halt':
            state['billingStopped']=True
        elif action!='status':
            raise ValueError(action)
        stream.seek(0)
        stream.truncate()
        json.dump(state,stream,indent=2)
        stream.write('\n')
        stream.flush()
        return dict(acquired=action in ('acquire','try-acquire'),spentUsd=state['spentUsd'], reservedUsd=sum(r['usd'] for r in state['reservations'].values()),
                    capUsd=state['capUsd'], receipts=len(state['receipts']))


if __name__=='__main__':
    print(json.dumps(transact(sys.argv[1],sys.argv[2],sys.argv[3] if len(sys.argv)>3 else '',
        float(sys.argv[4]) if len(sys.argv)>4 else 0.5,sys.argv[5] if len(sys.argv)>5 else '',int(sys.argv[6]) if len(sys.argv)>6 else None)))
