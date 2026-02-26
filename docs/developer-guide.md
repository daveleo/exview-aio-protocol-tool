# Developer Guide

## Repository Structure

- `baseline/`: Original baseline artifacts used as the source reference.
- `packages/engine/`: Authoritative certification engine (`device-certify.ts`).
- `packages/protocol/truth/`: Truth dataset artifacts.
- `packages/engine/profiles/`: Profile-specific suite exclusions (for example `exview-aio.exclusions.json`).
- `apps/cli/`: CLI wrapper that invokes engine behavior.
- `docs/`: User/developer/protocol documentation.
- `scripts/`: Local helper scripts (including golden summary check).

## Baseline Is Sacred

- Do not refactor certification logic without a concrete protocol reason.
- Do not modify transport/checksum behavior casually.
- Treat baseline outcomes as contract data.
- Every behavior change must be validated against golden outputs.

## Suite Exclusions

For profile `exview-aio`, suite exclusions are configured in:

- `packages/engine/profiles/exview-aio.exclusions.json`

Format:

```json
{
  "excludeFromSuite": [
    { "code": "0xC131", "reason": "Disabled for this FW version" }
  ]
}
```

Exclusions apply to `--suite` selection, producing `SKIPPED` records with `skipReason` and no UDP transmit.

## Adding New Commands

- Add or update command entries in the truth source data (`truth.json` flow), not hardcoded command rewrites in engine code.
- Keep parsing/validation driven by truth and existing policy mechanisms.
- Re-run suite and compare with golden summary before merging.
