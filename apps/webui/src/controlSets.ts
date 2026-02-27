import { meaningPairsToMap, parseMeaningPairs } from './meaningFormat.ts';

export const DANGER_CONFIRM_TEXT = 'POWER';

function toNumeric(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function toToggleValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['1', 'true', 'on', 'wake', 'awake'].includes(text)) return true;
    if (['0', 'false', 'off', 'sleep', 'standby'].includes(text)) return false;
    if (text.includes('awake') || text.includes('wake')) return true;
    if (text.includes('sleep') || text.includes('standby')) return false;
  }
  return null;
}

function extractFromParsed(parsed, keys) {
  if (!parsed || typeof parsed !== 'object') return null;
  for (const key of keys ?? []) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      return parsed[key];
    }
  }
  return null;
}

function extractFromMeaningMap(meaningMap, keys) {
  for (const key of keys ?? []) {
    if (Object.prototype.hasOwnProperty.call(meaningMap, key.toLowerCase())) {
      return meaningMap[key.toLowerCase()];
    }
  }
  return null;
}

export function extractControlValue(control, result) {
  if (!result) return null;

  const parsed = result.parsed && typeof result.parsed === 'object' ? result.parsed : null;
  const meaning = String(result.meaning ?? '');
  const meaningMap = meaningPairsToMap(parseMeaningPairs(meaning));

  const parsedValue = extractFromParsed(parsed, control.valueFromResponse?.parsedKeys ?? []);
  const meaningValue = extractFromMeaningMap(meaningMap, control.valueFromResponse?.meaningKeys ?? []);
  const rawValue = parsedValue ?? meaningValue;

  if (control.kind === 'slider') {
    const numeric = toNumeric(rawValue);
    return numeric == null ? null : Math.max(control.min, Math.min(control.max, Math.round(numeric)));
  }

  if (control.kind === 'toggle') {
    return toToggleValue(rawValue);
  }

  if (control.kind === 'select') {
    if (rawValue == null) return null;
    return String(rawValue).trim();
  }

  return rawValue ?? (meaning || null);
}

export function formatControlValue(control, value) {
  if (value == null || value === '') return '-';

  if (control.kind === 'toggle') {
    return value ? control.onLabel ?? 'On' : control.offLabel ?? 'Off';
  }

  if (control.kind === 'slider') {
    return `${value}${control.unit ? ` ${control.unit}` : ''}`;
  }

  return String(value);
}

export const CONTROL_SETS = [
  {
    id: 'inputs-sources',
    title: 'Inputs & Sources',
    description: 'Source routing and HDMI signal visibility',
    controls: [
      {
        id: 'source-select',
        label: 'Source',
        kind: 'select',
        queryCode: '0xC211',
        setVariantCodes: [
          { label: 'Android', value: '0', commandCode: '0xC213:0-android' },
          { label: 'PC Reserved', value: '1', commandCode: '0xC213:1-pc-reserved' },
          { label: 'HDMI1', value: '2', commandCode: '0xC213:2-hdmi1' },
          { label: 'HDMI2', value: '3', commandCode: '0xC213:3-hdmi2' },
          { label: 'HDMI3', value: '4', commandCode: '0xC213:4-hdmi3' },
          { label: 'HDMI4', value: '5', commandCode: '0xC213:5-hdmi4' }
        ],
        valueFromResponse: {
          parsedKeys: ['videoSourceText', 'videoSource'],
          meaningKeys: ['source', 'videoSource']
        }
      },
      {
        id: 'hdmi-presence',
        label: 'HDMI Presence',
        kind: 'button',
        queryCode: '0xC25B',
        buttonLabel: 'Query',
        valueFromResponse: {
          parsedKeys: ['activeInputs', 'payloadHex'],
          meaningKeys: ['hdmi1', 'hdmi2', 'hdmi3', 'hdmi4']
        }
      }
    ]
  },
  {
    id: 'picture',
    title: 'Picture',
    description: 'Core image and audio adjustments',
    controls: [
      {
        id: 'volume',
        label: 'Volume',
        kind: 'slider',
        queryCode: '0xC201',
        setCode: '0xC203',
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        valueFromResponse: {
          parsedKeys: ['volume'],
          meaningKeys: ['volume']
        }
      },
      {
        id: 'brightness',
        label: 'Brightness',
        kind: 'slider',
        queryCode: '0xC21D',
        setCode: '0xC21F',
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        valueFromResponse: {
          parsedKeys: ['brightness', 'volume'],
          meaningKeys: ['brightness', 'volume']
        }
      },
      {
        id: 'contrast',
        label: 'Contrast',
        kind: 'slider',
        queryCode: '0xC215',
        setCode: '0xC217',
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        valueFromResponse: {
          parsedKeys: ['contrast'],
          meaningKeys: ['contrast']
        }
      },
      {
        id: 'hue',
        label: 'Hue',
        kind: 'slider',
        queryCode: '0xC264',
        setCode: '0xC262',
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        valueFromResponse: {
          parsedKeys: ['hue'],
          meaningKeys: ['hue']
        }
      }
    ]
  },
  {
    id: 'power-standby',
    title: 'Power & Standby',
    description: 'Safe status checks plus guarded wake/sleep control',
    controls: [
      {
        id: 'sleep-status',
        label: 'Sleep/Wake Status',
        kind: 'button',
        queryCode: '0xC005',
        buttonLabel: 'Query',
        valueFromResponse: {
          parsedKeys: ['state'],
          meaningKeys: ['state']
        }
      },
      {
        id: 'power-state',
        label: 'Power Mode (Danger Zone)',
        kind: 'toggle',
        queryCode: '0xC005',
        onLabel: 'Wake',
        offLabel: 'Sleep',
        setVariantCodes: [
          { label: 'Wake', value: 'wake', commandCode: '0xC003:wake-up' },
          { label: 'Sleep', value: 'sleep', commandCode: '0xC003:sleep' }
        ],
        dangerous: true,
        valueFromResponse: {
          parsedKeys: ['state', 'sleepWakeFlag'],
          meaningKeys: ['state']
        }
      }
    ]
  }
];
