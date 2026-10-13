import {sandboxRun} from './sandbox';
for(const command of ["python3 -c 'import numpy,pandas,fastapi,pydantic,lxml; print(numpy.__version__,pandas.__version__,pydantic.__version__)'","node -e \"console.log(require('vue').version,require('react').version,require('linkedom').parseHTML('<p>x</p>').document.body.textContent)\"","dotnet --version","javac -version"]){
 console.log(JSON.stringify(await sandboxRun({},command)));
}
