# Pointer reader prototype

Throwaway code for the offline experiments of `docs/estate-pointer-reader.md` (cutter, ledger ladder, cassette, label-set prompt). Not product code and not a workspace package: install with `pnpm install --ignore-workspace` in this folder, then run an experiment with `pnpm exec tsx expN.ts <repo root>`.

- `src/cut.ts`: units by structure, fingerprints, cut digest.
- `src/ledger.ts`: ids and the re-anchoring ladder.
- `src/labelset.ts`, `src/cassette.ts`, `src/pipeline.ts`: label sets, the request, the cassette, a scan with a fake labeler.
- `exp5.ts` sentence cutting, `exp6.ts` cut digest per Node build, `exp9.ts` ladder, `exp10.ts` fingerprint, `exp12.ts` cassette, label-set edit and prompt genericity (experiments 12, 14, 15), `cost.ts` fixture size.

The results are in section 10a of the design doc.
