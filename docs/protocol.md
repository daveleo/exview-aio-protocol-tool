# Protocol Notes

## Frame Format (High Level)

The engine treats frames as fixed-structure byte packets with:

- A sync/header prefix (`55 55 55 55 55 55 55` in observed samples)
- Routing and command bytes
- Payload length and payload section
- A trailing checksum byte

For generated numeric commands, checksum validation follows the PDF checksum rule used by engine self-check logic.

## Validation Modes

The engine uses multiple validation modes based on command policy:

- `STRICT_EXACT`: Compare full expected reply template (with checksum-aware handling).
- `STRUCTURE_ONLY`: Validate structure/parsing without strict full-template equality.
- `PARSED_RANGE`: Parse semantic payload values and validate value ranges/meaning.
- `EXPECTED_NO_REPLY`: No reply is acceptable and treated per command policy.

## HDMI Presence Parsing Example (0xC25B/0xC25C)

The HDMI presence path uses command/reply mapping:

- Set/query command policy references `0xC25B`
- Reply payload may arrive under `0xC25C`

The parser inspects reply payload markers and derives semantic meaning such as:

- `HDMI1=signal`
- `HDMI2=no-signal`

This is reported in output `meaning`/`parsed` fields while keeping transport and checksum behavior unchanged.
