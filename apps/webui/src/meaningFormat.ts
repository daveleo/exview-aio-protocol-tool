export type MeaningPair = {
  key: string;
  label: string;
  value: string;
};

function toLabel(rawKey: string): string {
  const clean = String(rawKey ?? '').trim();
  if (!clean) return 'Value';
  if (/^hdmi\d+$/i.test(clean)) return clean.toUpperCase();

  const spaced = clean
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  return spaced
    .split(/\s+/)
    .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

export function parseMeaningPairs(meaning: unknown): MeaningPair[] {
  const text = String(meaning ?? '').trim();
  if (!text) return [];

  const matches = [...text.matchAll(/([A-Za-z][A-Za-z0-9_-]*)=("[^"]*"|[^\s]+)/g)];
  if (matches.length === 0) return [];

  const pairs: MeaningPair[] = [];
  for (const match of matches) {
    const key = match[1];
    const rawValue = match[2];
    if (!key) continue;

    const value = String(rawValue)
      .replace(/^"|"$/g, '')
      .replace(/,+$/, '')
      .trim();

    pairs.push({
      key,
      label: toLabel(key),
      value
    });
  }

  return pairs;
}

export function meaningPairsToMap(pairs: MeaningPair[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.toLowerCase();
    map[key] = pair.value;
  }
  return map;
}
