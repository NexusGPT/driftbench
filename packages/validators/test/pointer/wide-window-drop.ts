import type { PointerSut } from '../../src/ladders/pointer/sut/port';
import { realReader } from '../../src/ladders/pointer/sut/reader';

/**
 * The real reader, except that the ledger it hands back loses entries after a full scan: every entry when
 * `WIDE_WINDOW_DROP` is `all` (the cheat a review found on scale.wide-window), the last one when it is `one`.
 */
const reader = realReader();
export default {
  ...reader,
  name: 'wide-window-drop',
  async scan(request) {
    const result = await reader.scan(request);
    if (!result.ledger) return result;
    const kept = process.env.WIDE_WINDOW_DROP === 'one' ? result.ledger.entries.slice(0, -1) : [];
    return { ...result, ledger: { ...result.ledger, entries: kept } };
  },
} satisfies PointerSut;
