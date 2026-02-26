# User Guide

## What This Tool Is For

This repository certifies the eXview AIO protocol behavior against a known truth baseline.
It is intended for eXview AIO validation runs, not a generic protocol fuzzer.

## Run The Suite

Use the standard suite command:

```powershell
npm run suite
```

Or run directly with explicit flags:

```powershell
npm run certify -- --suite --rate 5 --timeout 1200 --settle-set 300 --settle-mode 900
```

## Run A Single Command

Run a single command key or set code:

```powershell
npm run certify -- --single 0xC001:idle
```

For numeric single commands, provide `--value`:

```powershell
npm run certify -- --single 0xC203 --value 30
```

## Result Meanings

- `PASS`: Command behavior matched expected validation rules.
- `SKIPPED`: Command was intentionally skipped (for example suite exclusions or known profile limitations).
- `NO_REPLY`: No UDP reply was received within timeout and it was not mapped to a known skip rule.

## Output Files

Suite and single runs write reports under `packages/data/`:

- `certify-<timestamp>.json`
- `certify-<timestamp>.csv`
- `certify-<timestamp>.html`
- `certify-<timestamp>.issues.json`
- `certify-<timestamp>.issues.csv`
