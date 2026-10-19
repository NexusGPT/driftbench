# Bugbot review rules

Bugbot gives a first-pass review. The independent review stays required.
Flag a violation of any rule below as a blocking comment.

1. No word lists or English phrase lists in `packages/estate`, the estate code in `packages/generate`, or `packages/validators`.
   Why: code that reads English words to decide meaning breaks on every other language. Use declared labels and structure only.
2. No validator item, threshold, seed count or assertion may be weakened or inverted.
   Why: a weaker validator passes bad work and hides the drift the benchmark exists to catch.
3. A change under `packages/validators/**` must come from a branch named `fix/...`.
   Why: validator changes need the extra independent review that the `fix/` branch triggers.
4. Fictional data only: no real names, emails or secrets in code, fixtures, docs or tests.
   Why: the repo is public, and a leaked value cannot be taken back.
5. `tools/structure/api-surface.json` and `docs/reference/spec.md` change only through their generators (`node tools/structure/api-surface.mjs --build --write` and `pnpm docs:reference`).
   Why: a hand edit drifts from the source and the next regeneration erases it.
6. Flag any test that cannot fail, such as an assertion that is always true, a missing assertion, or a mocked result that is the value under test.
   Why: a test that cannot fail gives false confidence.
7. No `2>/dev/null` in scripts. Use `2>&1`.
   Why: discarded stderr hides the failure that explains a red run.
