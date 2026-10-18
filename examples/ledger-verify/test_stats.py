import unittest
from stats import compare, exact_mcnemar, wilson


class StatisticsChecks(unittest.TestCase):
    def test_exact_test(self):
        self.assertEqual(exact_mcnemar(0,0),1)
        self.assertEqual(exact_mcnemar(10,0),2/1024)
        self.assertEqual(exact_mcnemar(0,10),2/1024)
        self.assertEqual(exact_mcnemar(5,5),1)

    def test_wilson_boundary(self):
        lo,hi=wilson(0,10)
        self.assertAlmostEqual(lo,0)
        self.assertAlmostEqual(hi,0.2775327998628892)

    def test_audit_reverses_discordance_and_missing_not_success(self):
        pool=[dict(id='a',correct=True,question='Q'),dict(id='b',correct=False,question='R')]
        ours=[{'id':'a','pass':True,'missing':0},{'id':'b','missing':1}]
        peer=[{'id':'a','pass':False,'missing':0},{'id':'b','pass':False,'missing':0}]
        official=compare(pool,ours,peer,{})
        audited=compare(pool,ours,peer,{'a':False})
        self.assertEqual((official['wins'],official['losses']),(1,1))
        self.assertEqual((audited['wins'],audited['losses']),(0,2))
        self.assertEqual(official['accuracy'],[0.5,0.5])
        self.assertEqual(official['missing'],[1,0])
        self.assertEqual(official['matchedItems'],1)
        self.assertTrue(official['provisional'])

    def test_duplicate_fails(self):
        with self.assertRaises(AssertionError):
            compare([dict(id='a',question='Q',correct=True)],[{'id':'a'},{'id':'a'}],[],{})


if __name__=='__main__':
    unittest.main()
