"""Split the recorded files above the leak guard's scan limit into line-aligned parts, and join them back.

The leak guard refuses any file above 10 MiB. Each recorded file listed in parts-manifest.json is stored as
parts of at most 8 MiB, cut at line ends, so the parts joined in order are the original bytes. The
manifest holds the size and sha256 of every original. The joined files are git-ignored; every script
in this folder reads them under their original names (run `join` first).

  python3 comparisons/hard-peers/parts.py join    # write the originals from the parts, verify sha256
  python3 comparisons/hard-peers/parts.py check   # verify the parts without writing
  python3 comparisons/hard-peers/parts.py split   # cut originals into parts, write the manifest
"""
import hashlib, json, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / 'parts-manifest.json'
LIMIT = 8 * 1024 * 1024
SOURCES = ('calls/old-langwatch.jsonl',)

def parts_dir(rel):
    return HERE / (rel + '.parts')

def split():
    entries = {}
    for rel in SOURCES:
        data = (HERE / rel).read_bytes()
        lines = data.splitlines(keepends=True)
        chunks, current, size = [], [], 0
        for line in lines:
            assert len(line) <= LIMIT, (rel, len(line))
            if size + len(line) > LIMIT:
                chunks.append(b''.join(current)); current, size = [], 0
            current.append(line); size += len(line)
        if current: chunks.append(b''.join(current))
        assert b''.join(chunks) == data
        directory = parts_dir(rel)
        directory.mkdir(parents=True, exist_ok=True)
        names = []
        for index, chunk in enumerate(chunks):
            name = f'part-{index:04d}.txt'
            (directory / name).write_bytes(chunk)
            names.append({'name': name, 'bytes': len(chunk), 'sha256': hashlib.sha256(chunk).hexdigest()})
        entries[rel] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'parts': names}
    MANIFEST.write_text(json.dumps(entries, indent=2) + '\n')
    print(f'split {len(entries)} files into {sum(len(e["parts"]) for e in entries.values())} parts')

def joined(rel, entry):
    data = b''.join((parts_dir(rel) / p['name']).read_bytes() for p in entry['parts'])
    assert len(data) == entry['bytes'], f'{rel}: {len(data)} bytes, expected {entry["bytes"]}'
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], f'{rel}: sha256 differs'
    return data

def join(write):
    entries = json.loads(MANIFEST.read_text())
    for rel, entry in entries.items():
        data = joined(rel, entry)
        if write: (HERE / rel).write_bytes(data)
    print(f'{"joined" if write else "verified"} {len(entries)} files')

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    if mode == 'split': split()
    elif mode == 'join': join(True)
    elif mode == 'check': join(False)
    else: sys.exit(__doc__)
