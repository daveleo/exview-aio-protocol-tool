# WebUI

## Overview

The WebUI is a controller/viewer for eXview AIO.
It does not implement UDP framing, checksum logic, or protocol parsing.
The backend API and engine remain the source of truth.

## Navigation

Top-level navigation has two tabs:

1. Status Dashboard (default)
2. Command Center

Status Dashboard is the default operator view.
Command Center is for full command-level work and raw inspection.

## Status Dashboard

Dashboard has three compact sections:

1. Top control bar
2. Status tiles
3. Control Sets (operator controls)

### Top control bar

- target IP
- test target
- refresh all
- auto-refresh toggle
- interval: `2s`, `5s`, `10s`

### Status tiles

Tiles query safe read commands through `POST /api/send` and display:

- current value
- status dot (OK / NO_REPLY / ERROR)
- last updated time

Current cards:

- Current Video Source (`0xC211`)
- HDMI Presence (`0xC25B`)
- Brightness (`0xC21D`)
- Contrast (`0xC215`)
- Volume (`0xC201`)
- Split / Display Mode (`0xC241`)
- Sleep / Wake (`0xC005`)

### Control Sets

Below tiles, dashboard shows curated group cards:

1. Inputs & Sources
2. Picture
3. Power & Standby

Each control row includes:

- label + current value
- compact input (slider/select/toggle/query button)
- `Apply` and `Verify` buttons (query-only rows keep `Verify`)
- state text (`synced`, `applied`, `no reply`, etc.)

Card-level actions:

- `Verify all`
- `Apply all` (skips danger-zone actions)

Power-changing actions are guarded by a confirmation modal.

### Refresh behavior

- `Refresh all` triggers all status queries once
- `Auto-refresh` is optional and off by default
- dashboard refresh triggers tile updates and control set verification

If a card returns `NO_REPLY`, the warning is shown on that card only.

Dashboard mappings are defined in:

- `apps/webui/src/statusPanels.ts`
- `apps/webui/src/controlSets.ts`

## Command Center

### Left navigation

- search input at top
- Favorites section (starred commands, persisted in localStorage)
- accordion sections by basket:
  - Inputs & Sources
  - Picture
  - Screen & Layout
  - Power & Standby
  - Status & Monitoring
  - Advanced / Raw

Commands stay inside their section; no secondary floating submenu.

### Control panel

When a command is selected, the panel shows:

- title + description
- reply code badge
- validation mode badge
- target IP + test target button
- control widget from `uiHints.ts` (slider/toggle/select/button when available)
- primary action (`Send` / `Apply`)
- explicit `Verify` for commands with `queryPair`

### Response panel

Response priority:

1. status badge
2. meaning
3. match + latency

Meaning is rendered as key/value chips when backend meaning contains `key=value` pairs.
If not, it is shown as plain text.

Raw protocol payloads are available but de-emphasized:

- `Show raw TX/RX` (collapsed by default)
- `Advanced (backend debug)` with parsed JSON and full raw response

## Notes

- Parsed JSON is backend debug output.
- Human-readable `meaning` is primary in UI.
- Copy helpers for TX/RX support spaced, comma, `0x`, and C array formats.
- Dashboard controls are curated operator controls, not a full protocol surface.
- Control set mapping details are documented in `docs/control-sets.md`.
