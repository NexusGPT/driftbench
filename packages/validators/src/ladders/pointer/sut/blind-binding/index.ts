import type { Json, PointerAdapter, PointerIO, Request } from '../../blind/bank/index';
import type { PointerSut } from '../port';
import { reanchorOp } from './anchor';
import { groupOp } from './group';
import { fingerprintOp, ledgerOp } from './ids';
import { labelsOp } from './labels';
import { privacyOp } from './privacy';
import { type Obj, Unsupported } from './reader';
import { replayOp } from './replay';

type Resolve = () => Promise<PointerSut>;

/** The port's container names to the names of the blind bank. */
const CONTAINERS: Record<string, string> = { block_quote: 'blockquote', front_matter: 'frontmatter' };

async function cutOp(input: Obj, resolve: Resolve): Promise<unknown> {
  const sut = await resolve();
  const cut = await sut.cut({ path: String(input.file), text: String(input.source) });
  return {
    units: cut.units.map((unit) => ({
      container: CONTAINERS[unit.container] ?? unit.container,
      text: unit.text,
      span: [unit.start, unit.end],
      path: unit.path,
      ...(unit.yamlPath !== undefined ? { yamlPath: unit.yamlPath.join('.') } : {}),
    })),
  };
}

/**
 * Operation by operation: cut, fingerprint, ledger, reanchor (all but the ambiguous-candidates and the merge-sibling
 * cases), group (windows, questions, dense), labels (decide, materialize, validate-answer) and replay (a miss that
 * names its field) call reader exports. The rest throw Unsupported with the reason, so the item fails with a message
 * that says the reader lacks the call. Binds the transport vocabulary of the blind bank (`blind/CONTRACT.md`) to the reader. Each operation calls
 * reader exports; where the reader has none, the call throws `Unsupported` with the reason, and the item fails.
 */
export function blindBinding(resolve: Resolve): PointerAdapter {
  return {
    async execute(request: Request, io?: PointerIO): Promise<unknown> {
      const input = request.input as Obj;
      switch (request.operation) {
        case 'cut':
          return cutOp(input, resolve);
        case 'fingerprint':
          return fingerprintOp(input);
        case 'ledger':
          return ledgerOp(input);
        case 'reanchor':
          return reanchorOp(input);
        case 'group':
          return groupOp(input);
        case 'labels':
          return labelsOp(input);
        case 'replay':
          return replayOp(input);
        case 'privacy':
          return privacyOp(input, io);
        case 'links':
        case 'radius':
          throw new Unsupported(
            request.operation,
            'links, blast radius, coverage and clearance (layer C) are not built: docs/estate-pointer-reader.md section 14 lists them as not built, and the reader exports no call for them',
          );
        default:
          throw new Unsupported(request.operation, 'no binding');
      }
    },
  };
}

export type { Json };
