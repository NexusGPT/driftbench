"""Additive model enumeration only; scoring formulas stay in the frozen modules."""
import json
from pathlib import Path
HERE = Path(__file__).resolve().parent

def models():
    freeze = json.loads((HERE / 'freeze.json').read_text())
    return freeze['models'] + list(freeze.get('additionalModelCells', {}))

def contestants(model):
    freeze = json.loads((HERE / 'freeze.json').read_text())
    return freeze.get('additionalModelCells', {}).get(model, {}).get('contestants', ['pair-ledger', 'reader-first-c50b2dc3', 'promptfoo'])

def phases(model):
    freeze = json.loads((HERE / 'freeze.json').read_text())
    return freeze.get('additionalModelCells', {}).get(model, {}).get('phases', ['pilot', 'fixtures', 'validity', 'dev', 'test'])
