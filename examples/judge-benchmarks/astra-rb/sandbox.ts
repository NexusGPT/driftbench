import { homedir } from 'node:os';
import { mkdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { localProvider } from '../../../packages/sandbox/src/local';

const root = resolve('.cache/astra-rb/sandboxes');
const deps = resolve('.cache/astra-rb/node_modules');
const python = resolve('.cache/astra-rb/venv');
const dotnet = resolve('.cache/astra-rb/dotnet');
const java = '/Users/assem/Documents/GitHub/driftbench/.worktrees/codex-rb/.cache/rb/jdk/jdk-17.0.20.1+1/Contents/Home';
const quote = (s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
export async function sandboxRun(files:Record<string,string>,command:string, timeoutMs=25000,maxOutputBytes=65536) {
  await mkdir(root,{recursive:true});
  const box=await localProvider({dir:root}).create({keep:true});
  const allowed = [box.root, deps, java, python, dotnet, join(homedir(),'.local/share/uv/python'), join(homedir(),'.local/bin')];
  const notAllowed=allowed.map(x=>'(require-not (subpath '+JSON.stringify(x)+'))').join(' ');
  const profile='(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (subpath '+JSON.stringify(box.root)+')))\n(deny file-read-data (subpath "/private/tmp"))\n(deny file-read-data (require-all (subpath '+JSON.stringify(homedir())+') '+notAllowed+'))\n';
  for(const name of Object.keys(files)) if(name.startsWith('/')||name.split('/').includes('..')||name==='policy.sb')throw new Error('unsafe generated filename');
  await box.seed({files:{...files,'policy.sb':profile}});
  const record=await box.exec('/usr/bin/sandbox-exec -f policy.sb /bin/sh -c '+quote('ulimit -t 15; ulimit -f 16384; '+command+' 2>&1'),{
    timeoutMs,maxOutputBytes,env:{TMPDIR:box.root,NODE_PATH:deps,DOTNET_ROOT:dotnet,DOTNET_CLI_HOME:box.root,DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE:'1',MSBUILDDISABLENODEREUSE:'1',GOCACHE:box.root+'/.gocache',GOPATH:box.root+'/gopath',PATH:python+'/bin:'+dotnet+':'+java+'/bin:'+(process.env.PATH??'/usr/bin:/bin')}
  });
  let output:Record<string,any>|undefined;
  try{
    const parsed=JSON.parse((record.stdout??'').trim().split('\n').at(-1)??'');
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&('results'in parsed||'inputs'in parsed||'checks'in parsed||'probe'in parsed))output=parsed;
  }catch{ /* Incomplete or non-JSON observations are unknown, never failures. */ }
  return {folder:box.root,record,output};
}
