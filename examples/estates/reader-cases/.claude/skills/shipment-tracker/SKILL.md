---
name: shipment-tracker
description: Look up where a shipment is and whether it is late. Use when the user asks about a delivery or a tracking number.
allowed-tools: Read, Bash(./scripts/track.sh *)
---

# Shipment tracker

- Always pass the carrier code to track.sh, as in `./scripts/track.sh NWX 123`.
- When the carrier answers with an error, say so; never guess a status.
- For a damaged parcel, the claim follows `claim-rules.md`.
- Carrier habits are in `notes.md`.
