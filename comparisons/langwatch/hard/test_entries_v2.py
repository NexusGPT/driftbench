"""Construction and mutation verification; no model calls or recorded outputs."""
import importlib.util,json,pathlib,unittest
HERE=pathlib.Path(__file__).parent

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
new=load('structured','generate-judges-entries-v2.py')
old=load('original','generate-judges.py')
class Construction(unittest.TestCase):
 def setUp(self):self.cases=new.build(20261019,120)
 def test_frozen_generator_preserves_original_construction(self):
  expected=old.build(20261019,120)
  for a,b in zip(self.cases,expected):
   self.assertEqual({k:v for k,v in a.items() if k not in ['entries','adapterVersion']},b)
  self.assertEqual(self.cases,json.loads((HERE/'judges-entries-v2.json').read_text()))
 def test_all_roles_and_receipt_labels(self):
  for case in self.cases:
   e=case['entries'];self.assertEqual([x['role']for x in e[:2]],['agent','user'])
   self.assertEqual(case['receiptToken']in e[0]['text'],case['truth'][1]=='pass')
   self.assertEqual(e[-1]['role']=='context',case['truth'][0]=='inconclusive')
   self.assertTrue(all(set(x)<=set(['role','text','tool'])for x in e))
   if case['kind']=='coverage_order'and case['truth'][0]!='inconclusive':
    self.assertEqual([x['role']for x in e[2:]],['tool_result','agent']if case['truth'][0]=='pass'else['agent','tool_result'])
   if case['kind']=='tool_error'and case['truth'][0]!='inconclusive':
    self.assertEqual(json.loads(e[2]['text'])['success'],False)
 def test_nested_agent_literal_stays_context(self):
  c=next(c for c in self.cases if c['kind']=='tool_error'and c['truth'][0]=='inconclusive')
  self.assertTrue(c['entries'][-1]['text'].startswith('[agent]'))
  self.assertEqual(c['entries'][-1]['role'],'context')
  self.assertEqual(len(c['entries']),3)
 def test_no_complete_input_overlap(self):
  inputs=lambda cs:{json.dumps([c['scenario'],c['criteria'],c['transcript']],sort_keys=True)for c in cs}
  for file in ['judges-v4.json','judges-heldout-v4.json','judges-heldout-v2.json']:
   self.assertFalse(inputs(self.cases)&inputs(json.loads((HERE/file).read_text())))
 def test_mutation_role_collapse_fails(self):
  c=self.cases[0];mutated=[{'role':'agent','text':c['transcript']}]
  self.assertNotEqual([x['role']for x in mutated[:2]],['agent','user'])
 def test_mutation_tool_order_flips_oracle(self):
  c=next(c for c in self.cases if c['kind']=='coverage_order'and c['truth'][0]=='pass')
  oracle=lambda e:e.index(next(x for x in e if x['role']=='tool_result'))<e.index(next(x for x in e if x['role']=='agent'and x['text'].startswith('I offer')))
  self.assertTrue(oracle(c['entries']));self.assertFalse(oracle(c['entries'][:2]+list(reversed(c['entries'][2:]))))
 def test_mutation_receipt_breaks_independent_label(self):
  c=next(c for c in self.cases if c['truth'][1]=='pass')
  self.assertIn(c['receiptToken'],c['entries'][0]['text']);self.assertNotIn(c['receiptToken'],'Case receipt: reference unavailable.')
if __name__=='__main__':unittest.main()
