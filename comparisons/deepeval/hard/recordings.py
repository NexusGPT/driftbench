"""Lossless bounded JSONL storage and explicit operator-identifier redaction."""
import hashlib
import json
from pathlib import Path

MAX_BYTES = 8 * 1024 * 1024
PRIVATE = Path.home() / '.driftbench/private/deepeval-hard'
REPLACEMENT = '[redacted-operator-email]'


def paths(path):
    return sorted(path.parent.glob('calls-[0-9][0-9][0-9].jsonl')) + ([path] if path.exists() else [])


def records(path):
    for source in paths(path):
        with source.open() as stream:
            for line in stream:
                if line.strip():
                    yield json.loads(line)


def append(path, row):
    line = (json.dumps(row, ensure_ascii=False) + '\n').encode()
    if len(line) >= MAX_BYTES:
        raise ValueError('One recording exceeds the chunk limit')
    if path.exists() and path.stat().st_size + len(line) >= MAX_BYTES:
        chunks = sorted(path.parent.glob('calls-[0-9][0-9][0-9].jsonl'))
        next_index = int(chunks[-1].stem.split('-')[-1]) + 1 if chunks else 0
        path.rename(path.parent / f'calls-{next_index:03d}.jsonl')
    with path.open('ab') as stream:
        stream.write(line)
        stream.flush()


def sanitize(row, private=PRIVATE):
    """Keep the exact original privately before replacing the known identifier.

    The operator identifier is supplied only by a private local file. It is never
    a public corpus input. Request hashes are recomputed from the public input.
    """
    identifier = private / 'operator-email.txt'
    if not identifier.exists():
        return row
    value = identifier.read_text().strip()
    if not value:
        return row
    encoded = json.dumps(row, ensure_ascii=False)
    if value not in encoded:
        return row
    if value in row['system'] or value in row['user']:
        raise ValueError('Operator identifier entered a model input; stop before publication')
    private.mkdir(parents=True, exist_ok=True)
    private.chmod(0o700)
    original = private / 'future-originals.jsonl'
    with original.open('a') as stream:
        original.chmod(0o600)
        stream.write(encoded + '\n')
        stream.flush()
    clean = json.loads(encoded.replace(value, REPLACEMENT))
    clean['operator_identifier_redacted'] = True
    clean['request_sha256'] = hashlib.sha256(json.dumps(
        [clean['requested_model'], clean['system'], clean['user']], ensure_ascii=False).encode()).hexdigest()
    return clean
