import {writeFile} from 'node:fs/promises';
import {sandboxRun} from './sandbox';
const python=await sandboxRun({'probe.py':`import importlib,json
out={}
for name in ['numpy','scipy','pandas','fastapi','pydantic','pytest','lxml','pyomo','pypdf','bs4','openpyxl']:
 try:
  m=importlib.import_module(name)
  out[name]=getattr(m,'__version__','loaded')
 except Exception as e:out[name]={'error':str(e)}
print(json.dumps({'probe':out}))
`},'python3 -I probe.py',55000);
const node=await sandboxRun({'probe.cjs':`const out={};
for(const name of ['linkedom','typescript','vue','vue-template-compiler','react','react-dom','react-modal','react-bootstrap','bootstrap','jquery','moment','jsdom','datatables.net']){
try{require(name);out[name]='loaded';}catch(e){out[name]={error:e.message};}}
console.log(JSON.stringify({probe:out}));
`},'node probe.cjs');
await writeFile('.cache/astra-rb/runtime-manifest.json',JSON.stringify({python,node},null,2)+'\n');
console.log(JSON.stringify({python:python.output,node:node.output}));
