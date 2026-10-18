import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

class CaptureChecks(unittest.TestCase):
    def test_failure_preserves_body_fee_and_exit(self):
        base=Path(__file__).resolve().parent
        cache=base/'cache';cache.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as folder:
            path=Path(folder)/'receipt.json';fake=Path(folder)/'claude'
            fake.write_text('#!/bin/sh\nprintf \'%s\\n\' \'{"is_error":true,"total_cost_usd":0.02}\'\nprintf \'%s\\n\' \'failure detail\' >&2\nexit 7\n');fake.chmod(0o755)
            result=subprocess.run([str(base/'capture-claude.sh'),'--model','fake'],input=b'input',stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={**os.environ,'VERIFY_NATIVE_EXECUTABLE':str(fake),'VERIFY_NATIVE_RECEIPT':str(path)})
            self.assertEqual(result.returncode,7)
            self.assertEqual(result.stdout,path.read_bytes())
            self.assertEqual(json.loads(path.read_text())['total_cost_usd'],0.02)
            self.assertIn(b'failure detail',result.stderr)
if __name__=='__main__':unittest.main()
