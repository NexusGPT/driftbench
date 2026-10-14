"""Read pinned source directly; compare every rendered default prompt and schema."""
import argparse,ast,json,pathlib,re,subprocess,types
HERE=pathlib.Path(__file__).parent.resolve()
PIN='ad220e6a641c3aa38484cbb94d60566d5c9a2c10'
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--checkout',type=pathlib.Path,required=True);args=parser.parse_args();source=args.checkout
 assert subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()==PIN
 path='python/scenario/_judge/criterion_verdicts.py';raw=(source/path).read_bytes();assert raw==subprocess.check_output(['git','-C',str(source),'show',f'{PIN}:{path}'])
 tree=ast.parse(raw);env={'re':re,'Sequence':list,'List':list}
 wanted=['REQUIREMENT_DESCRIPTION','CRITERION_REASONING_DESCRIPTION','STATUS_DESCRIPTION','SUMMARY_DESCRIPTION','PER_CRITERION_RULES','_STATUSES']
 for n in tree.body:
  if isinstance(n,ast.Assign) and any(getattr(t,'id','') in wanted for t in n.targets):exec(compile(ast.Module(body=[n],type_ignores=[]),'constants','exec'),env)
  if isinstance(n,ast.FunctionDef) and n.name in ['criteria_keys','build_finish_test_tool']:exec(compile(ast.Module(body=[n],type_ignores=[]),'schema','exec'),env)
 jp='python/scenario/judge_agent.py';judge_raw=(source/jp).read_bytes();assert judge_raw==subprocess.check_output(['git','-C',str(source),'show',f'{PIN}:{jp}'])
 system=next(n for n in ast.walk(ast.parse(judge_raw)) if isinstance(n,ast.JoinedStr) and any(isinstance(v,ast.Constant) and 'You are an LLM as a judge delivering' in str(v.value) for v in n.values))
 cases=json.loads((HERE/'judges-v4.json').read_text()); rendered=json.loads(subprocess.check_output(['pnpm','exec','tsx',str(HERE/'render-native.mts')],cwd=HERE.parents[2],text=True))
 for item,actual in zip(cases,rendered,strict=True):
  env.update(input=types.SimpleNamespace(scenario_state=types.SimpleNamespace(description=item['scenario'])),criteria_str='\n'.join(f'{i+1}. {c}' for i,c in enumerate(item['criteria'])),per_criterion_rules='\n'.join('- '+r for r in env['PER_CRITERION_RULES']),remote_traces_rule='')
  expected=eval(compile(ast.Expression(system),'native-fstring','eval'),env)
  assert actual['system']==expected,(item['id'],'prompt drift')
  assert actual['schema']==env['build_finish_test_tool'](item['criteria'])['function']['parameters'],(item['id'],'schema drift')
 print('Exact pinned native prompt and schema parity: 120/120 cases, no model calls')
if __name__=='__main__':main()
