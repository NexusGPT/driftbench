import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { failingSut } from './cr2-codes-sut';

export default function sut(): PointerSut {
  return failingSut('alias');
}
