"""Restore the pinned local source snapshot. No model calls or writes outside this worktree."""
import hashlib,json,pathlib,tarfile
ROOT=pathlib.Path(__file__).resolve().parent
info=json.loads((ROOT/'frozen-source-archive.json').read_text())
archive=ROOT/info['archive']
assert hashlib.sha256(archive.read_bytes()).hexdigest()==info['sha256']
snapshot=ROOT/'frozen-source';snapshot.mkdir(exist_ok=True)
with tarfile.open(archive,'r:gz') as tar:tar.extractall(snapshot,filter='data')
manifest=json.loads((ROOT/'source-hashes.json').read_text())
for name,digest in manifest.items():
 if name!='worktreeHead':assert hashlib.sha256((snapshot/name).read_bytes()).hexdigest()==digest,name
main=pathlib.Path('/Users/assem/Documents/GitHub/driftbench/packages')
for package in (snapshot/'packages').iterdir():
 deps=main/package.name/'node_modules';link=package/'node_modules'
 if deps.exists() and not link.exists():link.symlink_to(deps,target_is_directory=True)
runtime=ROOT/'runtime/node_modules';link=snapshot/'examples/judge-benchmarks/node_modules'
if runtime.exists() and not link.exists():link.symlink_to(runtime,target_is_directory=True)
print('Restored pinned source; frozen hashes verified. Install franc-all@7.2.0 in research/astra-mm/runtime if it is absent.')
