import unittest
from output_limits import strict_decisions
from stats import compare

class OutputLimitChecks(unittest.TestCase):
    def test_any_component_limit_is_strict_error_and_product_final_is_preserved(self):
        pool=[dict(id='a',question='q',correct=True)]
        original=[dict(id='a',pass_=True,missing=0)]
        original[0]['pass']=original[0].pop('pass_')
        strict=strict_decisions(original,{'a'})
        self.assertTrue(original[0]['pass'])
        self.assertEqual(strict[0]['error'],'output_limit')
        self.assertEqual(compare(pool,strict,original,{})['correct'],[0,1])
        self.assertEqual(compare(pool,original,strict,{})['correct'],[1,0])
        self.assertEqual(compare(pool,original,original,{})['correct'],[1,1])

if __name__=='__main__':unittest.main()
