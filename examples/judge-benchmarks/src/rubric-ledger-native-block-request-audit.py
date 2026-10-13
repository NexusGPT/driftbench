"""Extend the frozen offline request comparison to explicit native CLI blocks."""
import importlib.util
import json
from pathlib import Path

source = Path(__file__).with_name('rubric-ledger-block-audit.py')
spec = importlib.util.spec_from_file_location('audit', source)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
original = audit.blocked

def native_reason(call):
    try:
        raw = json.loads(call.get('completion', {}).get('raw', '{}'))
    except json.JSONDecodeError:
        return None
    text = raw.get('result', '')
    if (call['status'] == 'ok' and raw.get('is_error') and raw.get('usage', {}).get('output_tokens') == 0
            and isinstance(text, str) and text.startswith('API Error:')
            and 'https://www.anthropic.com/legal/aup' in text):
        match = audit.re.search(r'Details:\s*`([^`]+)`', text)
        return match.group(1) if match else 'Anthropic provider policy block'
    return None

def blocked(call):
    reason = native_reason(call)
    if reason:
        # In-memory interpretation only. The raw recording files are never rewritten.
        call['completion']['refusal'] = reason
        call['text'] = ''
    return original(call)

audit.blocked = blocked
audit.main()
