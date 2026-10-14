"""Restore byte-identical local replay files from reviewable, bounded JSONL storage."""
import argparse,hashlib,json,pathlib
HERE=pathlib.Path(__file__).parent.resolve()
def restore(check_only=False):
 manifest=json.loads((HERE/'storage/manifest.json').read_text())
 for item in manifest['files']:
  chunks=[]
  for part in item['parts']:
   path=HERE/part['path'];data=path.read_bytes()
   if hashlib.sha256(data).hexdigest()!=part['sha256']:raise ValueError('Changed storage part '+str(path))
   chunks.extend(json.loads(line)['line'] for line in data.decode().splitlines())
  data=''.join(chunks).encode()
  if hashlib.sha256(data).hexdigest()!=item['originalSha256']:raise ValueError('Restored bytes differ '+item['path'])
  target=HERE/item['path']
  if not check_only:
   target.parent.mkdir(parents=True,exist_ok=True)
   if not target.exists() or target.read_bytes()!=data:target.write_bytes(data)
 return len(manifest['files'])
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
 print('Verified byte-identical replay files:',restore(args.check))
