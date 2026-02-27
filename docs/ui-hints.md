# UI Hints

## Purpose

`apps/webui/src/uiHints.ts` defines frontend control hints for command UX only.

Important:

- UI hints do not alter protocol logic.
- API/engine remain source of truth for send/validate/parse.
- UI hints can map controls to selectors and query pairs.

## Supported Hint Types

- `slider`
- `toggle`
- `select`
- `button`

Each hint can include:

- `label`
- `queryPair` for after-set verification
- `valueSource` for extracting current value from backend response

## Current Mappings (Examples)

- `0xC21F` Brightness slider (`0..100`, query `0xC21D`)
- `0xC217` Contrast slider (`0..100`, query `0xC215`)
- `0xC203` Volume slider (`0..100`, query `0xC201`)
- `0xC213` Source select (variants from truth, query `0xC211`)
- `0xC25B` HDMI presence query button
- `0xC003` Power toggle (sleep/wake selectors)

## Label Safety

A dev-time assertion (`assertUiHintsInDev`) prevents invalid semantic mappings, including brightness/contrast labels accidentally using volume semantics.

This guards against regressions like showing `volume=...` for brightness controls.

## Adding a New Hint Safely

1. Add command code mapping in `uiHints.ts`.
2. Choose the correct control `type`.
3. Prefer a `queryPair` when available for current-value confirmation.
4. Set a `valueSource` that reads backend response (`meaning`/`parsed`) without frontend protocol parsing.
5. Verify label semantics are command-specific and not reused incorrectly.

## Notes

- Parsed JSON is considered backend debug payload.
- Primary user-facing interpretation should rely on backend `meaning` and command-specific control labels.
