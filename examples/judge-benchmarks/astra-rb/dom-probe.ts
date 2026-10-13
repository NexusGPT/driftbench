import {writeFile} from 'node:fs/promises';
import {sandboxRun} from './sandbox';
const r=await sandboxRun({'probe.cjs':`const l=require('linkedom').parseHTML('<form id="f"><input name="job-title" value="fictional"></form>').document;const j=new(require('jsdom').JSDOM)('<form id="f"><input name="job-title" value="fictional"></form>').window.document;console.log(JSON.stringify({probe:{linkedomElements:typeof l.getElementById('f').elements,jsdomElements:typeof j.getElementById('f').elements,jsdomValue:j.getElementById('f').elements['job-title'].value}}));`},'node probe.cjs');
await writeFile('examples/judge-benchmarks/astra-rb/results/dom-probe.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify(r.output));
