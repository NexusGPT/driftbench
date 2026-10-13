import {writeFile} from 'node:fs/promises';
import {sandboxRun} from './sandbox';
const r=await sandboxRun({'probe.py':`import os,glob,json,subprocess
root=os.environ['DOTNET_ROOT']
csc=glob.glob(root+'/sdk/*/Roslyn/bincore/csc.dll')[0]
refs=glob.glob(root+'/packs/Microsoft.NETCore.App.Ref/*/ref/net8.0/*.dll')
open('Main.cs','w').write('using System; class Program { static void Main(){Console.WriteLine("{\\\\\"probe\\\\\":123}");}}')
open('refs.rsp','w').write('\\n'.join('-r:'+x for x in refs))
r=subprocess.run(['dotnet',csc,'-nologo','-target:exe','-out:Probe.dll','@refs.rsp','Main.cs'],capture_output=True,text=True,timeout=10)
print(r.stdout,r.stderr,flush=True)
open('Probe.runtimeconfig.json','w').write(json.dumps({'runtimeOptions':{'tfm':'net8.0','framework':{'name':'Microsoft.NETCore.App','version':'8.0.0'}}}))
if r.returncode==0:
 r=subprocess.run(['dotnet','Probe.dll'],capture_output=True,text=True,timeout=5);print(r.stdout,r.stderr,flush=True)
`},'python3 probe.py');
await writeFile('.cache/astra-rb/dotnet-probe.json',JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify(r));
