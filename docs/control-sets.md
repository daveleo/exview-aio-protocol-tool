# Control Sets

## Purpose

`apps/webui/src/controlSets.ts` defines curated operator controls used on Status Dashboard.

It maps safe query/set command pairs into compact rows with explicit:

- Apply (set)
- Verify (query)

Protocol logic still lives in engine/API; frontend only orchestrates API calls.

## File layout

Each control set entry defines:

- `id`
- `title`
- `description`
- `controls[]`

Each control defines:

- `id`
- `label`
- `kind`: `slider` | `select` | `toggle` | `button`
- `queryCode`
- set path:
  - `setCode` for numeric slider style
  - `setVariantCodes[]` for discrete selectors/toggles
- `valueFromResponse`:
  - `parsedKeys[]` preferred
  - `meaningKeys[]` fallback
- optional safety flags:
  - `dangerous: true`

## Current groups

1. Inputs & Sources
2. Picture
3. Power & Standby

## Current controls

- Source select: query `0xC211`, set `0xC213:*` variants
- HDMI presence query: `0xC25B`
- Volume: query `0xC201`, set `0xC203` with value
- Brightness: query `0xC21D`, set `0xC21F` with value
- Contrast: query `0xC215`, set `0xC217` with value
- Hue: query `0xC264`, set `0xC262` with value
- Sleep/Wake status query: `0xC005`
- Power mode (danger zone): query `0xC005`, set `0xC003:wake-up` / `0xC003:sleep`

Excluded/unsupported commands for exview-aio are intentionally not included.

## Value extraction rules

Current value extraction prefers:

1. backend `parsed` keys (`parsedKeys`)
2. `meaning` key/value pairs (`meaningKeys`)

For example:

- volume uses `parsed.volume` then `meaning volume=...`
- source uses `parsed.videoSourceText` then `parsed.videoSource` then `meaning source=...`

## Safety guidance for adding controls

1. Add only commands validated for exview-aio profile.
2. Do not add excluded suite commands.
3. Prefer query+set pairs with stable parsed output.
4. Mark power/standby-changing controls as `dangerous`.
5. Keep Verify explicit and available for every row.
