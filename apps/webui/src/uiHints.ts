export type ValueSource =
  | { kind: 'meaningNumber' }
  | { kind: 'parsedPath'; path: string }
  | { kind: 'parsedBoolean'; path: string };

type BaseHint = {
  commandCode: string;
  label: string;
  queryPair?: string | null;
  valueSource?: ValueSource;
};

export type SliderHint = BaseHint & {
  type: 'slider';
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  units?: string;
  debounceMs?: number;
};

export type ToggleHint = BaseHint & {
  type: 'toggle';
  onLabel: string;
  offLabel: string;
  onSelector: string;
  offSelector: string;
  defaultOn?: boolean;
};

export type SelectHint = BaseHint & {
  type: 'select';
};

export type ButtonHint = BaseHint & {
  type: 'button';
  buttonText?: string;
};

export type UiHint = SliderHint | ToggleHint | SelectHint | ButtonHint;

function normalizeCode(input: string): string {
  const normalized = String(input ?? '')
    .replace(/^0x/i, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (!normalized) return '';
  return `0x${normalized.padStart(4, '0')}`;
}

function readPath(source: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = source;
  for (const key of parts) {
    if (current == null || typeof current !== 'object' || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

const uiHintsByCode: Record<string, UiHint> = {
  '0xC203': {
    type: 'slider',
    commandCode: '0xC203',
    label: 'Volume',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    units: '%',
    debounceMs: 150,
    queryPair: '0xC201',
    valueSource: { kind: 'meaningNumber' }
  },
  '0xC21F': {
    type: 'slider',
    commandCode: '0xC21F',
    label: 'Brightness',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    units: '%',
    debounceMs: 150,
    queryPair: '0xC21D',
    valueSource: { kind: 'meaningNumber' }
  },
  '0xC217': {
    type: 'slider',
    commandCode: '0xC217',
    label: 'Contrast',
    min: 0,
    max: 100,
    step: 1,
    defaultValue: 50,
    units: '%',
    debounceMs: 150,
    queryPair: '0xC215',
    valueSource: { kind: 'meaningNumber' }
  },
  '0xC213': {
    type: 'select',
    commandCode: '0xC213',
    label: 'Source',
    queryPair: '0xC211',
    valueSource: { kind: 'parsedPath', path: 'videoSource' }
  },
  '0xC25B': {
    type: 'button',
    commandCode: '0xC25B',
    label: 'HDMI Presence',
    buttonText: 'Query HDMI Presence'
  },
  '0xC003': {
    type: 'toggle',
    commandCode: '0xC003',
    label: 'Power State',
    onLabel: 'Wake Up',
    offLabel: 'Sleep',
    onSelector: '0xC003:wake-up',
    offSelector: '0xC003:sleep',
    defaultOn: true,
    queryPair: '0xC005',
    valueSource: { kind: 'parsedBoolean', path: 'isSleepMode' }
  }
};

export function getUiHint(commandCode: string): UiHint | null {
  const normalized = normalizeCode(commandCode);
  return uiHintsByCode[normalized] ?? null;
}

export function extractHintValue(hint: UiHint, response: unknown): number | boolean | null {
  if (!hint.valueSource || !response || typeof response !== 'object') return null;
  const payload = response as Record<string, unknown>;

  if (hint.valueSource.kind === 'meaningNumber') {
    const meaning = String(payload.meaning ?? '');
    const match = meaning.match(/(-?\d+)/);
    return match ? Number(match[1]) : null;
  }

  if (hint.valueSource.kind === 'parsedPath') {
    const value = readPath(payload.parsed, hint.valueSource.path);
    return typeof value === 'number' ? value : null;
  }

  if (hint.valueSource.kind === 'parsedBoolean') {
    const value = readPath(payload.parsed, hint.valueSource.path);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return null;
  }

  return null;
}

export function assertUiHintsInDev(): void {
  const brightnessHint = uiHintsByCode['0xC21F'];
  const contrastHint = uiHintsByCode['0xC217'];
  if (!brightnessHint || !contrastHint) return;

  if (brightnessHint.label.toLowerCase().includes('volume')) {
    throw new Error('Invalid UI hint: brightness label cannot contain volume semantics.');
  }
  if (contrastHint.label.toLowerCase().includes('volume')) {
    throw new Error('Invalid UI hint: contrast label cannot contain volume semantics.');
  }
  if (brightnessHint.type === 'slider' && brightnessHint.queryPair === '0xC201') {
    throw new Error('Invalid UI hint: brightness queryPair must not be volume query.');
  }
}
