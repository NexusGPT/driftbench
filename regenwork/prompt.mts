import { join } from 'node:path';
import { ClaudeCodeReader, pointer, scanEstate } from '../packages/estate/src/index';
const ROOT = new URL('../examples/estates/', import.meta.url).pathname;
const sets = pointer.parseLabelSets(pointer.DEFAULT_LABEL_SETS);
if (!sets.ok) throw new Error(sets.message);
const specs = pointer.DEFAULT_LABELER_SPECS.filter((t: string) => t.startsWith('system2')).map((t) => { const s = pointer.parseLabelerSpec(t); if (!s.ok) throw new Error(s.message); return s.spec; });
const built = await pointer.buildLabelling(specs, { env: {}, record: false, cwd: join(ROOT, 'fixture') });
if (!built.ok) throw new Error(built.message);
let shown = false;
const members = built.labelling.members.map((m: any) => ({ ...m, render(set: any, window: any, ctx: any) { const w = m.render(set, window, ctx); if (!shown && m.cls === 'system2' && window.path.includes('inbox-triager') && set.set === 'agent-rules') { shown = true; console.log(JSON.stringify(w.body ?? w, null, 1).slice(0, 6000)); console.log('UNITS', window.units.map((u: any) => u.n).join(','), 'DISPLAY', (window.display ?? []).map((d: any) => d.n + ':' + d.mode).join(',')); } return w; } }));
const cassette = pointer.Cassette.parse('');
try { await scanEstate({ root: join(ROOT, 'fixture'), reader: new ClaudeCodeReader(), now: () => new Date('2026-10-11T00:00:00.000Z'), pointer: { sets: sets.sets, labelling: { ...built.labelling, members } as any, cassette, mode: 'replay' } }); } catch (e) { console.log('stop', String(e).slice(0, 100)); }
