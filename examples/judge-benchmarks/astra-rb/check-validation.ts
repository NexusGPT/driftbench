import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sandboxRun} from './sandbox';
const validations=[];
for(const f of await readdir('.cache/astra-rb/plans')){
 const row=JSON.parse(await readFile('.cache/astra-rb/plans/'+f,'utf8'));
 for(const check of row.plan?.checks??[]){
  let fixture:any;
  if(check.name==='declarative_to_interrogative_ratio_2_to_1')fixture={text:'"A fact." Another fact. A third fact. Is it true?',expected:false,reason:'Three declarative sentences and one question do not satisfy a 2:1 ratio. A closing quote must not hide a sentence.'};
  if(check.name==='at_least_six_italic_highlights')fixture={text:'_one_ _two_ _three_ _four_ _five_ _six_',expected:true,reason:'Underscores are valid Markdown emphasis; a star-only regex rejects valid highlighted sections.'};
  if(check.name==='enctype_multipart_literal')fixture={text:'<form method=post enctype=multipart/form-data>',expected:true,reason:'An unquoted HTML attribute value has the same enctype semantics.'};
  if(!fixture)continue;
  const run=await sandboxRun({'check.json':JSON.stringify(check),'fixture.json':JSON.stringify(fixture),'validate.py':`import json
c=json.load(open('check.json'));f=json.load(open('fixture.json'));ns={}
exec(c['python'],ns)
actual=ns['check'](f['text'])
print(json.dumps({'probe':{'actual':actual,'expected':f['expected'],'valid':actual is f['expected']}}))
`},'python3 -I validate.py');
  validations.push({programHash:createHash('sha256').update(check.python).digest('hex'),name:check.name,fixture,
    valid:run.output?.probe?.valid===true,observed:run.output?.probe,exitCode:run.record.exitCode});
 }
}
await mkdir('examples/judge-benchmarks/astra-rb/results',{recursive:true});
await writeFile('examples/judge-benchmarks/astra-rb/results/check-validation.json',JSON.stringify(validations,null,2)+'\n');
console.log(JSON.stringify(validations));
