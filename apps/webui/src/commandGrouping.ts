export const BASKETS = [
  'Inputs & Sources',
  'Picture',
  'Screen & Layout',
  'Power & Standby',
  'Status & Monitoring',
  'Advanced / Raw'
] as const;

export type BasketName = (typeof BASKETS)[number];

type CommandRow = {
  commandCode: string;
  category?: string | null;
  title?: string | null;
  shortTitle?: string | null;
  description?: string | null;
  defaultVariant?: string | null;
  variants?: Array<{ label?: string | null }>;
};

const pictureKeywords = [
  'volume',
  'brightness',
  'contrast',
  'hue',
  'saturation',
  'gain',
  'gamma',
  'color temp',
  'temperature',
  'red',
  'green',
  'blue'
];

const sourceKeywords = ['hdmi', 'source', 'input', 'video combination', 'video'];
const powerKeywords = ['standby', 'power', 'restart', 'reboot', 'sleep', 'wake'];
const statusKeywords = ['monitor', 'status', 'diagnostic', 'info', 'running time', 'uptime'];
const layoutKeywords = ['aspect', 'screen', 'display', 'layout', 'split', 'scaling'];

function textBlob(command: CommandRow): string {
  const variantText = Array.isArray(command.variants) ? command.variants.map(item => item.label ?? '').join(' ') : '';
  return `${command.category ?? ''} ${command.title ?? ''} ${command.shortTitle ?? ''} ${command.description ?? ''} ${
    command.defaultVariant ?? ''
  } ${variantText}`.toLowerCase();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword));
}

export function getCommandBasket(command: CommandRow): BasketName {
  const blob = textBlob(command);

  if (includesAny(blob, powerKeywords)) return 'Power & Standby';
  if (includesAny(blob, sourceKeywords)) return 'Inputs & Sources';
  if (includesAny(blob, pictureKeywords)) return 'Picture';
  if (includesAny(blob, statusKeywords)) return 'Status & Monitoring';
  if (includesAny(blob, layoutKeywords)) return 'Screen & Layout';
  return 'Advanced / Raw';
}

export function buildBasketCounts(commands: CommandRow[]): Record<BasketName, number> {
  const counts = {
    'Inputs & Sources': 0,
    Picture: 0,
    'Screen & Layout': 0,
    'Power & Standby': 0,
    'Status & Monitoring': 0,
    'Advanced / Raw': 0
  } as Record<BasketName, number>;

  for (const command of commands) {
    const basket = getCommandBasket(command);
    counts[basket] += 1;
  }

  return counts;
}

export function filterByBasket(commands: CommandRow[], basket: BasketName): CommandRow[] {
  return commands.filter(command => getCommandBasket(command) === basket);
}
