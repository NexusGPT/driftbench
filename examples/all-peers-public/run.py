"""Run peer contestants on one sealed public benchmark, missing items only.

Without --execute it prints the plan and makes no call. With --execute it first passes the probe
gate, then runs at most two peers at once with two workers each. A job whose requests return no
model output stays missing and is asked again by a later pass; answered requests replay free.

  python examples/all-peers-public/run.py --bench judgebench --peers deepeval,langwatch --execute
"""
import argparse
import fcntl
import json
import os
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DEEPEVAL_TELEMETRY_OPT_OUT', 'YES')
os.environ.setdefault('DEEPEVAL_UPDATE_WARNING_OPT_IN', 'NO')

import peers  # noqa: E402
from transport import Journal, Stop, TransportFailure, probe_gate, now  # noqa: E402

BENCHES = ('judgebench', 'mmeval', 'rubricbench', 'verify', 'writing')
POINT = {'verify'}


def items_for(bench):
    return json.loads((ROOT / 'data' / bench / 'items.json').read_text())


def decisions_path(bench, peer):
    return ROOT / 'cells' / bench / peer / 'decisions.jsonl'


def done_ids(bench, peer):
    path = decisions_path(bench, peer)
    if not path.exists():
        return set()
    return {json.loads(line)['id'] for line in path.read_text().splitlines() if line.strip()}


def run_job(bench, peer, index, item, call):
    """Returns a decision row, or raises TransportFailure / Stop."""
    if bench in POINT:
        fn = {'deepeval': peers.deepeval_point, 'inspect': peers.inspect_point,
              'langfuse': peers.langfuse_point, 'langwatch': peers.langwatch_point}[peer]
        try:
            out = fn(item, call)
        except (TransportFailure, Stop):
            raise
        except Exception as error:  # the peer's own parser rejected an answered request
            return {'pass': None, 'graderError': f'{type(error).__name__}: {error}'[:500]}
        return {**out, 'graderError': None if out.get('pass') is not None else 'no verdict parsed'}
    if peer == 'deepeval':
        games, errors = [], []
        for game in ('AB', 'BA'):
            try:
                games.append(peers.deepeval_pair(item, game, call))
            except (TransportFailure, Stop):
                raise
            except Exception as error:
                games.append(None)
                errors.append(f'{game}: {type(error).__name__}: {error}'[:500])
        return {'games': games, 'graderError': '; '.join(errors) or None}
    if peer == 'langwatch':
        verdict, reads = peers.langwatch_pair(item, index, call)
        return {'games': [verdict, verdict], 'reads': reads,
                'graderError': 'unanswered read' if any(r.get('unanswered') for r in reads) else None}
    if peer in peers.POINTWISE_PAIR_PEERS:
        grade = {'inspect': peers.inspect_point, 'langfuse': peers.langfuse_point}[peer]
        verdict, reads = peers.pointwise_pair(item, grade, call)
        return {'games': [verdict, verdict], 'reads': reads, 'mode': peers.POINTWISE_PAIR_LABEL,
                'graderError': 'no verdict parsed' if verdict is None else None}
    raise ValueError(f'{peer} has no pairwise grader')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bench', choices=BENCHES, required=True)
    ap.add_argument('--peers', required=True)
    ap.add_argument('--execute', action='store_true')
    ap.add_argument('--cap-usd', type=float, default=100.0)
    ap.add_argument('--call-limit', type=int, help='stop each peer after this many new paid requests')
    ap.add_argument('--workers', type=int, default=2)
    ap.add_argument('--skip-probe', action='store_true', help='only for an immediate rerun after a passed gate')
    args = ap.parse_args()
    chosen = args.peers.split(',')
    allowed = peers.POINT_PEERS if args.bench in POINT else peers.PAIR_PEERS
    if any(p not in allowed for p in chosen) or len(chosen) > 2:
        raise SystemExit(f'peers for {args.bench}: at most two of {allowed}')
    items = items_for(args.bench)
    plan = {p: [i for i, x in enumerate(items) if x['id'] not in done_ids(args.bench, p)] for p in chosen}
    print(json.dumps({'bench': args.bench, 'items': len(items), 'missing': {p: len(v) for p, v in plan.items()},
                      'execute': args.execute}), flush=True)
    if not args.execute:
        return 0
    (ROOT / 'cells').mkdir(exist_ok=True)
    lock = open(ROOT / 'cells' / '.paid-run.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # one paid process at a time
    journal = Journal(str(ROOT / 'cells' / 'calls.jsonl'), args.cap_usd)
    journal.call_limit = args.call_limit
    if not args.skip_probe:
        probe_gate(journal.log)
    write_lock = threading.Lock()
    stop = threading.Event()
    peer_stop = {p: threading.Event() for p in chosen}
    counts = {p: {'decided': 0, 'missing': 0} for p in chosen}

    def work(peer, index):
        if stop.is_set() or peer_stop[peer].is_set():
            return
        item = items[index]
        keys = []

        def call(system, user):
            from transport import request_key
            keys.append(request_key(system, user))
            return journal.call(peer, args.bench, system, user)
        try:
            row = run_job(args.bench, peer, index, item, call)
        except Stop as error:
            (peer_stop[peer] if 'call limit' in str(error) else stop).set()
            print(json.dumps({'stop': str(error)}), flush=True)
            return
        except TransportFailure as error:
            counts[peer]['missing'] += 1
            print(json.dumps({'peer': peer, 'id': item['id'], 'missing': str(error)[:200]}), flush=True)
            return
        except Exception:
            stop.set()
            traceback.print_exc()
            return
        row = {'id': item['id'], 'peer': peer, 'bench': args.bench, **row, 'callKeys': keys, 'at': now()}
        path = decisions_path(args.bench, peer)
        with write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'a') as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + '\n')
            counts[peer]['decided'] += 1
            print(json.dumps({'peer': peer, 'done': counts[peer]['decided'], 'of': len(plan[peer]),
                              'liabilityUsd': round(journal.liability(), 6)}), flush=True)

    pools = [ThreadPoolExecutor(max_workers=args.workers) for _ in chosen]
    futures = [pool.submit(work, peer, i) for pool, peer in zip(pools, chosen) for i in plan[peer]]
    for future in futures:
        future.result()
    for pool in pools:
        pool.shutdown()
    print(json.dumps({'finished': counts, 'liabilityUsd': journal.liability(), 'knownUsd': journal.known_usd,
                      'newCalls': journal.new_calls, 'stopped': stop.is_set()}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
