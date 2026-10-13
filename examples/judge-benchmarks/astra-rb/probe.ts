import { sandboxRun } from './sandbox';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
const marker=resolve('.cache/astra-rb/permission-marker.txt');
await writeFile(marker,'fictional marker');
const code=[
 "import json,pathlib,socket",
 "r={}",
 "for k,f in [('outside_read',lambda:pathlib.Path("+JSON.stringify(marker)+").read_text()),('network',lambda:socket.create_connection(('192.0.2.1',80),timeout=1)),('outside_write',lambda:pathlib.Path("+JSON.stringify(marker)+").write_text('changed'))]:",
 " try:f();r[k]='UNSAFE'",
 " except Exception as e:r[k]=type(e).__name__+': '+str(e)",
 "print(json.dumps({'probe':r}))"
].join('\n');
console.log(JSON.stringify(await sandboxRun({'probe.py':code},'python3 -I probe.py')));
console.log(JSON.stringify(await sandboxRun({'hang.py':'while True: pass'},'python3 -I hang.py',500)));
