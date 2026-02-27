import { meaningPairsToMap, parseMeaningPairs } from './meaningFormat.ts';

type Indicator = {
  label: string;
  active: boolean;
};

type StatusPanelContext = {
  result: any;
  status: string;
  meaning: string;
  parsed: Record<string, unknown> | null;
  pairsMap: Record<string, string>;
};

type StatusPanel = {
  id: string;
  title: string;
  description: string;
  commandCode: string;
  getPrimary: (context: StatusPanelContext) => string;
  getSecondary?: (context: StatusPanelContext) => string | null;
  getMeter?: (context: StatusPanelContext) => number | null;
  getIndicators?: (context: StatusPanelContext) => Indicator[] | null;
};

function readNumber(input: unknown): number | null {
  const numeric = Number(input);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function pickFirstNumber(map: Record<string, string>, keys: string[]): number | null {
  for (const key of keys) {
    const value = readNumber(map[key.toLowerCase()]);
    if (value != null) return value;
  }
  return null;
}

function parseNumberFromContext(context: StatusPanelContext, mapKeys: string[], parsedKeys: string[]): number | null {
  const fromMeaning = pickFirstNumber(context.pairsMap, mapKeys);
  if (fromMeaning != null) return fromMeaning;

  for (const key of parsedKeys) {
    const value = readNumber(context.parsed?.[key]);
    if (value != null) return value;
  }

  return null;
}

function pickString(context: StatusPanelContext, mapKeys: string[], parsedKeys: string[]): string | null {
  for (const key of mapKeys) {
    const value = context.pairsMap[key.toLowerCase()];
    if (value) return value;
  }

  for (const key of parsedKeys) {
    const value = context.parsed?.[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }

  return null;
}

function normalizeHdmiValue(value: unknown): boolean {
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'signal' || text === 'present';
  }
  return false;
}

function hdmiIndicators(context: StatusPanelContext): Indicator[] {
  const keys = ['hdmi1', 'hdmi2', 'hdmi3', 'hdmi4'];
  return keys.map(key => {
    const parsedValue = context.parsed?.[key];
    const pairValue = context.pairsMap[key];
    return {
      label: key.toUpperCase(),
      active: normalizeHdmiValue(parsedValue ?? pairValue)
    };
  });
}

export function buildStatusPanelContext(result: any): StatusPanelContext {
  const meaning = String(result?.meaning ?? '').trim();
  const parsed = result?.parsed && typeof result.parsed === 'object' ? result.parsed : null;
  const pairsMap = meaningPairsToMap(parseMeaningPairs(meaning));

  return {
    result,
    status: String(result?.status ?? '').toUpperCase(),
    meaning,
    parsed,
    pairsMap
  };
}

export const STATUS_PANELS: StatusPanel[] = [
  {
    id: 'video-source',
    title: 'Current Video Source',
    description: 'Query command 0xC211',
    commandCode: '0xC211',
    getPrimary: context =>
      pickString(context, ['source', 'videosource'], ['videoSourceText', 'videoSource']) ||
      context.meaning ||
      'Unknown source'
  },
  {
    id: 'hdmi-presence',
    title: 'HDMI Presence',
    description: 'Query command 0xC25B',
    commandCode: '0xC25B',
    getPrimary: context => {
      const active = hdmiIndicators(context)
        .filter(item => item.active)
        .map(item => item.label);
      if (active.length === 0) return 'No active HDMI input';
      return `Active: ${active.join(', ')}`;
    },
    getIndicators: context => hdmiIndicators(context)
  },
  {
    id: 'brightness',
    title: 'Brightness',
    description: 'Query command 0xC21D',
    commandCode: '0xC21D',
    getPrimary: context => {
      const value = parseNumberFromContext(context, ['brightness', 'volume'], ['brightness', 'volume']);
      return value == null ? 'Unknown' : `${Math.round(value)}`;
    },
    getMeter: context => parseNumberFromContext(context, ['brightness', 'volume'], ['brightness', 'volume'])
  },
  {
    id: 'contrast',
    title: 'Contrast',
    description: 'Query command 0xC215',
    commandCode: '0xC215',
    getPrimary: context => {
      const value = parseNumberFromContext(context, ['contrast'], ['contrast']);
      return value == null ? 'Unknown' : `${Math.round(value)}`;
    },
    getMeter: context => parseNumberFromContext(context, ['contrast'], ['contrast'])
  },
  {
    id: 'volume',
    title: 'Volume',
    description: 'Query command 0xC201',
    commandCode: '0xC201',
    getPrimary: context => {
      const value = parseNumberFromContext(context, ['volume'], ['volume']);
      return value == null ? 'Unknown' : `${Math.round(value)}`;
    },
    getMeter: context => parseNumberFromContext(context, ['volume'], ['volume'])
  },
  {
    id: 'display-mode',
    title: 'Split / Display Mode',
    description: 'Query command 0xC241',
    commandCode: '0xC241',
    getPrimary: context =>
      pickString(context, ['displaymode', 'splitmode'], ['displayModeText', 'displayMode']) ||
      context.meaning ||
      'Unknown'
  },
  {
    id: 'sleep-state',
    title: 'Sleep / Wake',
    description: 'Query command 0xC005',
    commandCode: '0xC005',
    getPrimary: context => pickString(context, ['state', 'sleepwake'], ['state']) || context.meaning || 'Unknown'
  }
];
