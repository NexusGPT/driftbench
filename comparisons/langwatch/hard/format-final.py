"""Format comparison files without modifying frozen candidate or held-out bytes."""
import hashlib,json,pathlib,subprocess
HERE=pathlib.Path(__file__).parent.resolve()
frozen=json.loads((HERE/'frozen.json').read_text())
protected={(HERE/p).resolve():digest for p,digest in {**frozen['sourceHashes'],**frozen['fixtureHashes']}.items()}
for file,fixture in [('injection-attempt-freeze.json','injection/heldout-v2.json'),('compliance-freeze.json','judges-heldout-v2.json')]:
 m=json.loads((HERE/file).read_text())
 protected.update({(HERE/p).resolve():digest for p,digest in m['sourceHashes'].items()})
 protected[(HERE/fixture).resolve()]=m['fixtureSha256']
m=json.loads((HERE/'adapter-v2-freeze.json').read_text())
protected.update({(HERE/p).resolve():digest for p,digest in m['hashes'].items()})
def verify():
 for p,digest in protected.items():
  assert hashlib.sha256(p.read_bytes()).hexdigest()==digest,f'Frozen file changed: {p}'
verify()
paths=[p for p in HERE.rglob('*') if p.is_file() and p.suffix in {'.json','.ts','.mts','.mjs'} and not any(x.startswith('.') for x in p.relative_to(HERE).parts) and not any(x.startswith('.call-') for x in p.parts) and p.resolve() not in protected]
snapshots={p:json.loads(p.read_text()) for p in paths if p.suffix=='.json'}
subprocess.run(['pnpm','exec','biome','check','--write',*[str(p) for p in paths]],check=True)
for p,data in snapshots.items():assert json.loads(p.read_text())==data,f'Semantics changed: {p}'
verify()
print(f'Formatted {len(paths)} files; frozen bytes and all JSON values preserved.')
