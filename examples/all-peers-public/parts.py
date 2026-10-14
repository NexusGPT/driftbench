"""Split cells/calls.jsonl into line-aligned parts under cells/calls-parts/ (each under 6 MiB, so the guard can scan
them), or join the parts back into one stream. The parts hold exactly the bytes of the journal, in order.

  python examples/all-peers-public/parts.py split
  python examples/all-peers-public/parts.py join > calls.jsonl
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CELLS = ROOT / 'cells'
PARTS = CELLS / 'calls-parts'
LIMIT = 6 * 1024 * 1024


def part_files():
    return sorted(PARTS.glob('part-*.jsonl')) if PARTS.exists() else []


def split():
    source = CELLS / 'calls.jsonl'
    PARTS.mkdir(exist_ok=True)
    index, size, handle = 0, 0, None
    with source.open('rb') as src:
        for line in src:
            if handle is None or size + len(line) > LIMIT:
                if handle:
                    handle.close()
                handle = (PARTS / f'part-{index:04d}.jsonl').open('wb')
                index, size = index + 1, 0
            handle.write(line)
            size += len(line)
    if handle:
        handle.close()
    return index


def join(out):
    for path in part_files():
        out.write(path.read_bytes())


if __name__ == '__main__':
    if sys.argv[1:] == ['split']:
        print(split(), 'parts')
    elif sys.argv[1:] == ['join']:
        join(sys.stdout.buffer)
    else:
        sys.exit(__doc__)
