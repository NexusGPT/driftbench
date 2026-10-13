import {contestantById} from '../../examples/planted-verify/src/contestants';
import {RUBRIC_ATOMIC} from '../../examples/planted-rb/src/rubric-atomic';
console.log(contestantById('driftbench-verify-uncertainty-cascade').id);
console.log(RUBRIC_ATOMIC.find(x=>x.id==='driftbench-rb-binary-canonical-executed')?.id);
