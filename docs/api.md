# API

## Overview

API is a thin adapter around the existing engine CLI (`--single` path). No protocol parsing/checksum logic is duplicated in API.

UDP target port is fixed to `8600`.

## GET `/api/commands`

Returns grouped command metadata derived from truth records.

Includes:

- `commandCode`
- `title` / `shortTitle`
- `category`
- `description`
- `defaultSelector`
- `replyCode`
- `validationMode`
- `expectedBehavior`
- `variants[]`
- `excludedInSuite` + `exclusionReason`
- `hasKnownSkip`

Example:

```json
{
  "commands": [
    {
      "commandCode": "0xC21F",
      "title": "0xC21F brightness level",
      "category": "Set brightness level",
      "description": "brightness=0",
      "defaultSelector": "0xC21F:0:gen-0",
      "replyCode": "0xC220",
      "validationMode": "STRICT_EXACT",
      "expectedBehavior": "Reply matches expected template",
      "variantCount": 101,
      "excludedInSuite": false,
      "exclusionReason": null
    }
  ]
}
```

## GET `/api/command/:code`

Returns full metadata for a single command code (or default selector).

Example:

```json
{
  "command": {
    "commandCode": "0xC211",
    "title": "0xC211 video source",
    "category": "Query video source",
    "variants": []
  }
}
```

## POST `/api/send`

Request body:

```json
{
  "ip": "192.168.0.20",
  "commandCode": "0xC21F",
  "value": 50
}
```

Fields:

- `ip` required, valid IPv4/IPv6
- `commandCode` required
- `value` optional, numeric `0..100` (forwarded to engine `--value`)

Response:

```json
{
  "commandCode": "0xC21F",
  "commandKey": "0xC21F:0:gen-50",
  "status": "PASS",
  "match": "EXACT",
  "validationMode": "STRICT_EXACT",
  "meaning": "Reply matches expected template",
  "latencyMs": 4,
  "parsed": null,
  "txHex": "55 55 ...",
  "rxHex": "55 55 ...",
  "note": null,
  "skipReason": null
}
```

## Error Handling

- `400`: invalid input (`ip`, `commandCode`, or `value`)
- `500`: engine run failed or output artifact parse failure

## Screenshots

- `[placeholder]` `/api/commands` response
- `[placeholder]` `/api/command/:code` response
- `[placeholder]` `/api/send` request/response
