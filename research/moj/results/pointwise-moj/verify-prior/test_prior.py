import unittest
from unittest.mock import patch
from moj import verify_prior as v

class PriorTests(unittest.TestCase):
    def test_second_solve_requires_observed_disagreement(self):
        for a,b,want in ((.9,1,False),(.1,0,False),(.9,0,True),(.1,1,True),(.9,None,False),(.5,0,False)):
            with self.subTest(a=a,b=b),patch.object(v.r,'old_signal',side_effect=[{'pA':a},{'pA':b}]):
                self.assertEqual(v.disagree({},{}),want)

    def test_no_second_solve_for_agreement(self):
        with patch.object(v,'disagree',return_value=False),self.assertRaisesRegex(ValueError,'forbidden'):
            v.solve({}, {}, None, True)

    def test_intercept_prior_uses_only_training_labels(self):
        population=[{'label':'A'}]+[{'label':'B'}]*9
        with patch.object(v,'feature',return_value=[1,0,0,0,0,0]):m=v.fit_model(population,{})
        self.assertAlmostEqual(m['tuning_prior'],1.5/11)
        self.assertEqual(m['positive_n'],1)

if __name__=='__main__':unittest.main()
