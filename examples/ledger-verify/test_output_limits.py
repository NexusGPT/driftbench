import unittest
from output_limits import strict_decisions, limit_reason
from stats import compare

class OutputLimitChecks(unittest.TestCase):
    def test_output_limit_is_distinct_from_native_turn_limit_and_quota(self):
        self.assertIsNone(limit_reason(dict(model='haiku',metadata=dict(truncated=True,finishReason='error_max_turns'))))
        self.assertIsNone(limit_reason(dict(model='gemini-3.8-flash',message='HTTP 429')))
        self.assertEqual(limit_reason(dict(model='gemini-3.8-flash',metadata=dict(truncated=True,finishReason='MAX_TOKENS'))),'MAX_TOKENS')
        self.assertIsNotNone(limit_reason(dict(model='haiku'),dict(result='API Error: response exceeded the 16384 output token maximum.')))

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
