import datetime
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from budget import transact
from pacing import decide, observe, transport_failure
import os


class PacingTests(unittest.TestCase):
    def test_load_threshold_and_failure_threshold(self):
        self.assertEqual(decide(60,1),4)
        self.assertEqual(decide(60.001,0),2)
        self.assertEqual(decide(2,2),2)

    def test_parse_and_output_limits_do_not_lower_pacing(self):
        for message in ['invalid JSON', 'parse error', 'unparsed answer', 'schema validation failed', 'response exceeded the 16384 output token maximum']:
            self.assertFalse(transport_failure(message),message)
        for message in ['ENOTFOUND', 'ECONNRESET', 'claude ran past 300000 ms and was stopped', 'HTTP 529 overloaded']:
            self.assertTrue(transport_failure(message),message)

    def test_only_recent_haiku_transport_failures_count(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent/'cache') as name:
            folder=Path(name);clock=1800000000
            def row(i,age,message,model='haiku'):
                return dict(id=i,model=model,at=datetime.datetime.fromtimestamp(clock-age,datetime.timezone.utc).isoformat(),message=message)
            rows=[row('old',601,'ENOTFOUND'),row('other',1,'ENOTFOUND','gemini-3.8-flash'),row('parse',1,'invalid JSON'),row('first',1,'ENOTFOUND')]
            path=folder/'errors.jsonl';path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            self.assertEqual(observe(folder,clock,20)['limit'],4)
            with path.open('a') as file:file.write(json.dumps(row('second',600,'claude ran past 300000 ms and was stopped'))+'\n')
            self.assertEqual(observe(folder,clock,20)['limit'],2)

    @patch('pacing.os.getloadavg',return_value=(61,30,30))
    def test_admission_really_blocks_the_third_under_load(self,_load):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent/'cache') as name:
            path=Path(name)/'budget.json'
            for i in range(2):self.assertTrue(transact(path,'try-acquire',str(i),model='haiku',pid=os.getpid())['acquired'])
            self.assertFalse(transact(path,'try-acquire','third',model='haiku',pid=os.getpid())['acquired'])
            self.assertEqual(json.loads(path.read_text())['haikuPacing']['limit'],2)


if __name__=='__main__':unittest.main()
