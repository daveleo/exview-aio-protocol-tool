const defaultDoc = `### Checksum Rule
- Covered bytes: **9..len-2**
- Excluded bytes: sync/header prefix and final checksum byte
- Used by engine for transport validation; UI is display-only.

\`\`\`text
frame[9..len-2] -> sum rule -> frame[len-1]
\`\`\`
`;

const byCategory: Record<string, string> = {
  'Set volume level': `### Audio Control Checksum
- Covered bytes: **9..len-2**
- Excludes: first 7 sync bytes and final checksum
- Numeric set commands (volume) use the same checksum envelope.

\`\`\`text
55 55 55 55 55 55 55 .. [payload bytes] .. [checksum]
\`\`\`
`,
  'Set brightness level': `### Display Control Checksum
- Covered bytes: **9..len-2**
- Excludes: sync bytes + trailing checksum
- Brightness slider values are sent to backend; engine computes/validates.

\`\`\`text
bytes 9..len-2 participate, checksum byte does not.
\`\`\`
`,
  'Set video source': `### Source Switch Checksum
- Covered bytes: **9..len-2**
- Excludes: sync bytes + final checksum byte
- Input source changes remain backend-owned protocol operations.

\`\`\`text
payload marker + source byte -> checksum at last byte
\`\`\`
`,
  'Power on/off': `### Power Command Checksum
- Covered bytes: **9..len-2**
- Excludes: sync/header and checksum byte itself
- Sleep/Wake controls are UI hints only; backend handles protocol.

\`\`\`text
sum(data bytes) => checksum byte (frame end)
\`\`\`
`
};

export function getChecksumDoc(category: string | null | undefined): string {
  const key = String(category ?? '').trim();
  if (!key) return defaultDoc;
  return byCategory[key] ?? defaultDoc;
}
