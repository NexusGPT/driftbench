"""Apply the existing development and edit-check reporting to the additive cells."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import phase_report
import validity_report

HERE=Path(__file__).resolve().parent
for model in ['claude-sonnet-5-5','gpt-6.1-sol']:
    cell=HERE/'cells'/model
    if not (cell/'decisions.jsonl').exists():continue
    # Existing reporters are executed with an isolated data root inside this cell.
    # No source, global result or other model is modified.
    with tempfile.TemporaryDirectory(dir=cell/'runtime',prefix='offline-checks-') as name:
        root=Path(name);(root/'seals').symlink_to(HERE/'seals');(root/'results').mkdir()
        rows=[json.loads(x) for x in (cell/'decisions.jsonl').read_text().splitlines()]
        controls=[json.loads(x) for x in (HERE/'results/decisions.jsonl').read_text().splitlines()]
        rows += [r for r in controls if r['model']=='machine']
        (root/'results/decisions.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
        phase_report.HERE=root;validity_report.HERE=root
        phase_report.model_cells.models=lambda:[model]
        phase_report.model_cells.contestants=lambda _:['pair-ledger','promptfoo']
        phase_report.model_cells.phases=lambda _:['fixtures','validity','dev','test']
        with contextlib.redirect_stdout(io.StringIO()):
            phase_report.main();validity_report.main()
        for file in ['phase-report.json','validity-checks.json']:(cell/file).write_bytes((root/'results'/file).read_bytes())
    print(model,'offline checks recorded')
