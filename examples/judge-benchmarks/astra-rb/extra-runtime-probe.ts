import {sandboxRun} from './sandbox';
console.log(JSON.stringify(await sandboxRun({},'python3 -c "import pyomo,pypdf; print(pyomo.__version__,pypdf.__version__)"')));
console.log(JSON.stringify(await sandboxRun({'p.cjs':"const path=require.resolve('pdfjs-dist/legacy/build/pdf.mjs'); import('file://'+path).then(x=>console.log(JSON.stringify({probe:{pdfjs:x.version}}))).catch(e=>{console.error(e);process.exitCode=1;});"},'node p.cjs')));
