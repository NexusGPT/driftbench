from pathlib import Path
import tempfile
import os
import threading
import unittest
from unittest.mock import patch
from budget import transact


class BudgetChecks(unittest.TestCase):
    def test_concurrent_reservations_never_exceed_cap(self):
        cache=Path(__file__).parent/'cache'
        cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as folder:
            p=Path(folder)/'state.json'
            failures=[]
            def reserve(i):
                try:
                    transact(p,'reserve',str(i),0.5,'fake')
                except RuntimeError:
                    failures.append(i)
            threads=[threading.Thread(target=reserve,args=(i,)) for i in range(90)]
            for thread in threads: thread.start()
            for thread in threads: thread.join()
            state=transact(p,'status','')
            self.assertEqual(state['reservedUsd'],40)
            self.assertEqual(len(failures),10)

    @patch('pacing.os.getloadavg', return_value=(20,20,20))
    def test_per_model_limits_without_global_four_cap(self, _load):
        cache=Path(__file__).parent/'cache';cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as folder:
            p=Path(folder)/'state.json'
            for model,limit in [('gpt-6-luna',8),('gemini-3.8-flash',2),('haiku',4)]:
                for i in range(limit):transact(p,'acquire',f'{model}-{i}',model=model,pid=os.getpid())
                with self.assertRaises(RuntimeError):transact(p,'acquire',f'{model}-excess',model=model,pid=os.getpid())
            transact(p,'release','gpt-6-luna-0')
            transact(p,'acquire','replacement',model='gpt-6-luna',pid=os.getpid())
            import json
            state=json.loads(p.read_text());self.assertEqual(state['peakActiveCalls'],14)
            self.assertEqual(len(state['activeCalls']),14)

    def test_gemini_two_call_limit_and_nonblocking_wait(self):
        cache=Path(__file__).parent/'cache';cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as folder:
            p=Path(folder)/'state.json'
            for i in range(2):transact(p,'acquire',str(i),model='gemini-3.8-flash',pid=os.getpid())
            self.assertFalse(transact(p,'try-acquire','third',model='gemini-3.8-flash',pid=os.getpid())['acquired'])
            self.assertTrue(transact(p,'try-acquire','luna',model='gpt-6-luna',pid=os.getpid())['acquired'])

    def test_receipt_releases_only_unused_reservation(self):
        cache=Path(__file__).parent/'cache'
        cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as folder:
            p=Path(folder)/'state.json'
            transact(p,'reserve','a',0.5,'fake')
            state=transact(p,'settle','a',0.1)
            self.assertEqual(state['spentUsd'],0.1)
            self.assertEqual(state['reservedUsd'],0)
            with self.assertRaises(AssertionError): transact(p,'reserve','a')


if __name__=='__main__':
    unittest.main()
