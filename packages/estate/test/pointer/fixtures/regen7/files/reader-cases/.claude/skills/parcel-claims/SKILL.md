---
name: parcel-claims
description: File a damage claim with a carrier for a parcel that arrived broken. Use when: the user reports a damaged or missing parcel.
allowed-tools: Read, Bash(./scripts/track.sh *)
---

# Carrier claims

- Run `./scripts/track.sh <carrier> <number>` first; a claim needs the delivery scan it prints.
- Write the claim in the supplier's language, from `references/supplier-languages.md`.
- A claim follows `references/claim-rules.md`.
- Never promise the user a refund date; the carrier sets it.
- Open the claim with the wording in `REF/notes.md`.
