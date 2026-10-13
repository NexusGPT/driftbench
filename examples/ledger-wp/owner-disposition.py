"""Apply the owner's reporting withdrawal without changing frozen data or methods."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / 'results'
DROP = json.loads((RESULTS / 'gemini-3.8-owner-drop.json').read_text())
MODEL = DROP['model']
STATUS = DROP['status']


def save(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def withdrawn(row):
    if row.get('model') != MODEL:
        return row
    return {
        **{k: row[k] for k in ('model', 'contestant') if k in row},
        'status': STATUS, 'verdict': 'DROPPED', 'score': None,
        'comparison': None, 'pendingComparisons': 0,
        'recordings': 'results/decisions.jsonl',
        'ownerAmendment': 'results/gemini-3.8-owner-drop.json',
    }


for name in ('primary-disposition.json', 'reader-vs-longer.json'):
    path = RESULTS / name
    save(path, [withdrawn(row) for row in json.loads(path.read_text())])

for name, lists in (
    ('cells.json', ('cells',)),
    ('phase-report.json', ('pilot', 'dev')),
    ('validity-checks.json', ('cells',)),
):
    path = RESULTS / name
    data = json.loads(path.read_text())
    for key in lists:
        data[key] = [withdrawn(row) for row in data[key]]
    data['ownerDisposition'] = 'gemini-3.8-owner-drop.json'
    save(path, data)

path = RESULTS / 'gemini-remaining-requests.json'
data = json.loads(path.read_text())
if 'historicalAllocation' not in data:
    data = {'historicalAllocation': data}
data.update(model=MODEL, status=STATUS, pendingComparisons=0, scheduledRequests=0,
            resumeAllowed=False, ownerAmendment='gemini-3.8-owner-drop.json')
save(path, data)

path = RESULTS / 'frontier-disposition.json'
data = json.loads(path.read_text())
data['gemini38'] = STATUS
data['geminiResultModel'] = 'gemini-3.5-flash-lite'
save(path, data)

paths = [RESULTS / n for n in ('report.md', 'frontier-report.md', 'frontier-final-summary.md')]
paths.extend(Path(p) for p in sys.argv[1:])
for path in paths:
    text = path.read_text()
    text = text.replace('including pending and partial cells', 'including the explicitly dropped cell')
    text = text.replace('gemini-3.8-flash: pending;', 'gemini-3.8-flash: DROPPED;')
    text = text.replace('Gemini 3.8 remains parked.', f'Gemini 3.8: {STATUS}. Flash Lite stays the Gemini result.')
    text = text.replace('## Parked Gemini 3.8 request allocation',
                        '## Historical Gemini 3.8 request allocation, superseded by owner drop')
    text = text.replace('## Freeze and execution\n',
                        '## Freeze and execution\n\nHistorical runtime amendments below are superseded for Gemini 3.8 by `results/gemini-3.8-owner-drop.json`. No resumption is scheduled or authorized.\n') if 'Historical runtime amendments below' not in text else text
    text = text.replace('## Runtime audit\n',
                        '## Runtime audit\n\nGemini 3.8 rows below retain partial transport and cost evidence only. They are not benchmark scores or pending work.\n') if 'retain partial transport and cost evidence only' not in text else text
    text = text.replace('## Historical Gemini 3.8 request allocation, superseded by owner drop\n',
                        '## Historical Gemini 3.8 request allocation, superseded by owner drop\n\nCurrent allocation is zero requests. The following figures describe the earlier, cancelled allocation only.\n') if 'Current allocation is zero requests.' not in text else text
    lines = []
    section = ''
    for line in text.splitlines():
        if line.startswith('## '):
            section = line
        if line.startswith('Gemini: not run: daily quota.'):
            line = f'Gemini 3.8: {STATUS}. Its partial recordings remain immutable. It has zero scheduled requests and no pending completion. Flash Lite stays the Gemini result. Source: `results/gemini-3.8-owner-drop.json`.'
        # Suppress all withdrawn performance rows. Retain the separate runtime evidence.
        if line.startswith('|') and MODEL in line and section not in ('## Runtime audit', '## Owner withdrawal: Gemini 3.8'):
            continue
        lines.append(line)
    text = '\n'.join(lines) + '\n'
    if '## Owner withdrawal: Gemini 3.8' not in text:
        notice = ('## Owner withdrawal: Gemini 3.8\n\n'
                  '| Model | Status | Pending work |\n| --- | --- | --- |\n'
                  f'| {MODEL} | {STATUS} | None |\n\n'
                  'Flash Lite stays the Gemini result. Raw answers, decisions, costs, holds and historical freezes remain unchanged.\n'
                  'Earlier reset permissions and request estimates are superseded. No new model call is required.\n\n')
        if text.startswith('# '):
            text = text.split('\n', 1)[0] + '\n\n' + notice + text.split('\n', 1)[1].lstrip('\n')
        else:
            text = notice + text
    path.write_text(text)

print('Owner withdrawal applied to current report tables; frozen recordings untouched.')
