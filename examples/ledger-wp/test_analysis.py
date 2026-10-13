import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
def module(name):
    spec = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    out = importlib.util.module_from_spec(spec); spec.loader.exec_module(out); return out
stats, prepare = module('stats'), module('prepare')

class AnalysisTests(unittest.TestCase):
    def test_mcnemar_known_tails(self):
        self.assertEqual(stats.mcnemar(0,0),1)
        self.assertEqual(stats.mcnemar(6,0),.03125)
        self.assertEqual(stats.mcnemar(0,6),.03125)
        self.assertEqual(stats.mcnemar(4,4),1)
    def test_wilson_not_point_interval(self):
        low,high=stats.wilson(10,10)
        self.assertGreater(low,70);self.assertLess(low,80);self.assertAlmostEqual(high,100)
    def test_order_scores_and_missing_not_dropped(self):
        items=[{'id':'x','label':'B','language':'en','requestId':'r'}]
        result=stats.summarize(items,[{'id':'x','games':['B','tie'],'graderErrors':1}],[{'id':'x','games':['A','B']}])
        self.assertEqual(result['correct'],1);self.assertEqual(result['games'],2)
        self.assertEqual(result['comparison']['wins'],1);self.assertEqual(result['comparison']['losses'],1)
        self.assertEqual(result['graderErrors'],1)
    def test_content_identity_ignores_candidate_order(self):
        self.assertEqual(prepare.canonical_pair('q','one','two'),prepare.canonical_pair('q','two','one'))
        self.assertNotEqual(prepare.canonical_pair('q','one','two'),prepare.canonical_pair('q!','one','two'))
    def test_hard_rows_need_request_text(self):
        self.assertEqual([r['id'] for r in prepare.requirements('Describe your weekend.')],['better_piece'])
        rows=prepare.requirements('Write a poem in English. Use 100 words. You must include the name Ada.')
        self.assertEqual({r['id'] for r in rows},{'form','language','length','named_element','better_piece'})
        self.assertTrue(all(q in 'Write a poem in English. Use 100 words. You must include the name Ada.' for r in rows for q in r['quotes']))
    def test_seals_disjoint_by_request_and_exact_hash(self):
        splits={s:json.loads((HERE/'seals'/f'{s}.json').read_text()) for s in ['pilot','dev','test']}
        ids={s:{r['requestId'] for r in rows} for s,rows in splits.items()}
        self.assertFalse(ids['pilot'] & ids['dev']);self.assertFalse(ids['test'] & (ids['dev'] | ids['pilot']))
        manifest=json.loads((HERE/'seals/manifest.json').read_text())
        for split in splits:self.assertEqual(prepare.sha((HERE/'seals'/f'{split}.json').read_bytes()),manifest['hashes'][split])
        self.assertEqual(len(splits['test']),173)

if __name__=='__main__': unittest.main()
