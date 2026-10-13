import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {scanText,loadDenylist} from '../../../../tools/guard/guard.mjs';
const git=(args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:256*1024*1024}).split('\n').filter(Boolean);
const files=[...new Set([...git(['diff','--name-only','0fa48a41']),...git(['ls-files','--others','--exclude-standard']), 'examples/judge-benchmarks/results/verify-dev/test-expansion.log'])];
const denylist=loadDenylist(process.env,process.cwd());
let findings=[],allowed=0,bytes=0,jsonlRows=0;
for(const file of files){
 if(!file.startsWith('examples/judge-benchmarks/'))throw Error('Write scope violation: '+file);
 const content=await readFile(file,'utf8'); bytes+=Buffer.byteLength(content);
 const scanned=scanText(content,{denylist}); allowed+=scanned.allowed;
 findings.push(...scanned.findings.map(x=>({file,line:x.line,kind:x.kind})));
 if(file.endsWith('.jsonl'))for(const row of content.trimEnd().split('\n'))if(row){JSON.parse(row);jsonlRows++;}
}
const result={at:new Date().toISOString(),files:files.length,bytes,jsonlRows,fullFilesScanned:true,sizeLimitSkipped:0,denylistTerms:denylist.length,allowed,findings,clean:findings.length===0};
await writeFile('examples/judge-benchmarks/results/verify-dev/final-guard.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));if(!result.clean)process.exitCode=1;
