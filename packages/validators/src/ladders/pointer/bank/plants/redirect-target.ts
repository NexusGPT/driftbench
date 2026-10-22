import { brokenReader, MARKER_REDIRECT } from './broken';

/** The reader that `cheat-env.ts` points the environment at. */
export default function sut() {
  return brokenReader('redirected', MARKER_REDIRECT);
}
