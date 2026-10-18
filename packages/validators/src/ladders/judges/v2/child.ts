/**
 * The bank's child process: runs judges bank items on one seed against the real judges package, in the order
 * given, from a start index, and writes one JSON line before and after each item. The parent (isolate.ts) kills
 * it when an item runs past its time limit, so an endless loop in packages/judges fails one item instead of
 * hanging the validator.
 * Usage: node --import tsx child.ts <seed> <root> <start>, with the item ids as a JSON array on stdin.
 */
import { judgesBankChild } from './run-child';

await judgesBankChild(process.argv.slice(2));
