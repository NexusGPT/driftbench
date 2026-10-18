"""Repeat the offline audit without rewriting its frozen recording."""
from unittest.mock import patch
from common import *

def main():
    module=load_module('construction_audit_check',HERE/'audit-construction.py')
    expected=json.loads((HERE/'construction-cue-audit.json').read_text())
    captured=[];reads=[]
    original_text=Path.read_text;original_bytes=Path.read_bytes
    def read_text(path,*args,**kwargs):
        reads.append(str(path));return original_text(path,*args,**kwargs)
    def read_bytes(path,*args,**kwargs):
        reads.append(str(path));return original_bytes(path,*args,**kwargs)
    with patch.object(module,'dump',side_effect=lambda path,obj:captured.append(obj)),patch.object(Path,'read_text',read_text),patch.object(Path,'read_bytes',read_bytes),patch('builtins.print'):
        module.audit()
    actual=captured[0]
    expected.pop('stamp');actual.pop('stamp')
    assert actual==expected
    forbidden=('calls.jsonl','decisions.json','scores.json','attempts.jsonl')
    assert not any(path.endswith(forbidden) for path in reads)
    print(json.dumps({'audit_repeated_without_mutation':True,'case_count':1536,'outcome_files_read':0,'input_reads':len(reads)}))

if __name__=='__main__':main()
