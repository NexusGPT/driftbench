"""Run the four peer default judges on a sealed writing-heldout split with the unchanged
examples/all-peers-public runner (same peers.py, transport and criterion), writing under
runs/<split>/peers/ instead of the all-peers-public cells.

  <venv>/bin/python examples/writing-heldout/peers_heldout.py --split fresh --peers deepeval,langwatch --execute
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'all-peers-public'))
import run  # noqa: E402

CRITERION = 'The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.'


def main():
    argv = sys.argv[1:]
    split = argv[argv.index('--split') + 1]
    del argv[argv.index('--split'):argv.index('--split') + 2]
    root = HERE / 'runs' / split / 'peers'
    (root / 'data' / 'writing').mkdir(parents=True, exist_ok=True)
    items = json.loads((HERE / 'items' / f'{split}.json').read_text())
    (root / 'data' / 'writing' / 'items.json').write_text(json.dumps(
        [{'id': x['id'], 'label': x['label'], 'language': x['language'], 'question': x['question'],
          'a': x['a'], 'b': x['b'], 'criterion': CRITERION} for x in items], ensure_ascii=False))
    run.ROOT = root
    sys.argv = ['run.py', '--bench', 'writing', *argv]
    return run.main()


if __name__ == '__main__':
    sys.exit(main())
