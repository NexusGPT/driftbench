from pathlib import Path
import tempfile
import os
import threading
import unittest
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

    def test_four_active_calls_globally(self):
        cache=Path(__file__).parent/'cache';cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as folder:
            p=Path(folder)/'state.json'
            for i in range(4):transact(p,'acquire',str(i),model='fake',pid=os.getpid())
            with self.assertRaises(RuntimeError):transact(p,'acquire','fifth',model='fake',pid=os.getpid())
            transact(p,'release','1')
            transact(p,'acquire','replacement',model='fake',pid=os.getpid())
            import json
            state=json.loads(p.read_text());self.assertEqual(state['peakActiveCalls'],4)
            self.assertEqual(len(state['activeCalls']),4)

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
