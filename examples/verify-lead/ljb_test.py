"""LongJudgeBench verify TEST (221 items): the frozen candidate and every peer, after the confirmation run.

`prepare` copies the PR 351 sealed verify items (examples/all-peers-public/data/verify/items.json, rebuilt by
its export.py, not committed) to data/ljb-test.json after checking the sha256 pinned in its provenance.json.
`run` passes its arguments to run.py with the split `ljb-test` added. The PR 351 call journal is read as
recorded cassettes when cells/calls-parts links to examples/all-peers-public/cells/calls-parts, so a peer
request it already answered replays free.

  python examples/verify-lead/ljb_test.py prepare
  python examples/verify-lead/ljb_test.py run --contestants driftbench-v5,promptfoo --execute --workers 3
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT.parent / 'all-peers-public' / 'data' / 'verify'
SPLIT = 'ljb-test'


def prepare():
    raw = (PUBLIC / 'items.json').read_bytes()
    pinned = json.loads((PUBLIC / 'provenance.json').read_text())
    assert hashlib.sha256(raw).hexdigest() == pinned['itemsSha256'], 'items differ from the PR 351 pin'
    items = json.loads(raw)
    assert len(items) == pinned['items'] == 221, len(items)
    (ROOT / 'data' / f'{SPLIT}.json').write_bytes(raw)
    print(len(items), sum(x['label'] for x in items))
    return 0


def run(argv):
    sys.path.insert(0, str(ROOT))
    import run as runner
    runner.SPLITS = (*runner.SPLITS, SPLIT)
    sys.argv = ['run.py', '--split', SPLIT, *argv]
    return runner.main()


if __name__ == '__main__':
    if sys.argv[1:2] == ['prepare']:
        sys.exit(prepare())
    if sys.argv[1:2] == ['run']:
        sys.exit(run(sys.argv[2:]))
    raise SystemExit(__doc__)
