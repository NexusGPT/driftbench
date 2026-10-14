"""Run verify contestants on one split of the fresh pool, missing items only.

Without --execute it prints the plan and makes no call. Calls go through the PR 351 claude transport
(examples/all-peers-public/transport.py) with this folder's own journal: an answered request replays
free, a request with no model output stays missing and a later pass asks again.

  python examples/verify-lead/run.py --split practice --contestants inspect,driftbench-solve3 --execute
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
sys.path.insert(0, str(ROOT.parent / 'all-peers-public'))
os.environ.setdefault('DEEPEVAL_TELEMETRY_OPT_OUT', 'YES')
os.environ.setdefault('DEEPEVAL_UPDATE_WARNING_OPT_IN', 'NO')

from contestants import CONTESTANTS  # noqa: E402
from transport import Journal, Stop, TransportFailure, now, probe_gate, request_key  # noqa: E402

SPLITS = ('practice', 'confirm', 'dev')


def items_for(split):
    return json.loads((ROOT / 'data' / f'{split}.json').read_text())


def decisions_path(split, contestant):
    return ROOT / 'cells' / split / contestant / 'decisions.jsonl'


def done_ids(split, contestant):
    path = decisions_path(split, contestant)
    if not path.exists():
        return set()
    return {json.loads(line)['id'] for line in path.read_text().splitlines() if line.strip()}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--split', choices=SPLITS, required=True)
    ap.add_argument('--contestants', required=True)
    ap.add_argument('--execute', action='store_true')
    ap.add_argument('--cap-usd', type=float, default=5.0, help='journal-wide liability cap, all runs together')
    ap.add_argument('--workers', type=int, default=3, help='per contestant')
    ap.add_argument('--skip-probe', action='store_true')
    args = ap.parse_args()
    chosen = args.contestants.split(',')
    unknown = [c for c in chosen if c not in CONTESTANTS]
    if unknown:
        raise SystemExit(f'unknown contestants {unknown}; known: {sorted(CONTESTANTS)}')
    items = items_for(args.split)
    plan = {c: [i for i, x in enumerate(items) if x['id'] not in done_ids(args.split, c)] for c in chosen}
    print(json.dumps({'split': args.split, 'items': len(items), 'missing': {c: len(v) for c, v in plan.items()},
                      'execute': args.execute}), flush=True)
    if not args.execute:
        return 0
    (ROOT / 'cells').mkdir(exist_ok=True)
    lock = open(ROOT / 'cells' / '.paid-run.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)  # one paid process at a time
    journal = Journal(str(ROOT / 'cells' / 'calls.jsonl'), args.cap_usd)
    if not args.skip_probe:
        probe_gate(journal.log)
    write_lock = threading.Lock()
    stop = threading.Event()
    counts = {c: {'decided': 0, 'missing': 0} for c in chosen}

    def work(contestant, index):
        if stop.is_set():
            return
        item = items[index]
        keys = []

        def call(system, user):
            keys.append(request_key(system, user))
            return journal.call(contestant, f'verify-lead-{args.split}', system, user)
        try:
            try:
                row = CONTESTANTS[contestant](item, call)
            except (TransportFailure, Stop):
                raise
            except Exception as error:  # the grader's own parser rejected an answered request
                row = {'pass': None, 'graderError': f'{type(error).__name__}: {error}'[:500]}
        except Stop as error:
            stop.set()
            print(json.dumps({'stop': str(error)}), flush=True)
            return
        except TransportFailure as error:
            counts[contestant]['missing'] += 1
            print(json.dumps({'contestant': contestant, 'id': item['id'], 'missing': str(error)[:200]}), flush=True)
            return
        except Exception:
            stop.set()
            traceback.print_exc()
            return
        row = {'id': item['id'], 'contestant': contestant, **row, 'callKeys': keys, 'at': now()}
        path = decisions_path(args.split, contestant)
        with write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'a') as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + '\n')
            counts[contestant]['decided'] += 1
            if counts[contestant]['decided'] % 20 == 0:
                print(json.dumps({'contestant': contestant, 'done': counts[contestant]['decided'],
                                  'of': len(plan[contestant]), 'liabilityUsd': round(journal.liability(), 4)}),
                      flush=True)

    pools = [ThreadPoolExecutor(max_workers=args.workers) for _ in chosen]
    futures = [pool.submit(work, c, i) for pool, c in zip(pools, chosen) for i in plan[c]]
    for future in futures:
        future.result()
    for pool in pools:
        pool.shutdown()
    print(json.dumps({'finished': counts, 'liabilityUsd': journal.liability(), 'knownUsd': journal.known_usd,
                      'newCalls': journal.new_calls, 'stopped': stop.is_set()}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
