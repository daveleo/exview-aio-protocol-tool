import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

type RunMode = 'single' | 'suite' | 'sanity' | 'issues';
type ProfileName = 'exview-aio' | 'generic';
type ValidationMode = 'STRICT_EXACT' | 'STRUCTURE_ONLY' | 'PARSED_RANGE' | 'EXPECTED_NO_REPLY';
type TransportStatus = 'REPLY' | 'NO_REPLY';
type StatusColor = 'GREEN' | 'YELLOW' | 'RED' | 'GRAY';
type ResultStatus = 'PASS' | 'FAIL' | 'NO_REPLY' | 'SKIPPED';

interface CliOptions {
  mode: RunMode;
  profile: ProfileName;
  singleSelector?: string;
  issuesFile?: string;
  value?: number;
  targetHost: string;
  targetPort: number;
  localPort: number;
  timeoutMs: number;
  rate: number;
  settleSetMs: number;
  settleModeMs: number;
  includePower: boolean;
  debugHex: boolean;
  promptEach: boolean;
  columns: string[];
}

interface TruthCommandRow {
  rowNumber: number;
  commandKey: string;
  category: string;
  description: string;
  requestHex: string;
  replyHex: string | null;
  setCommandCode: string | null;
  replyCommandCode: string | null;
  instruction: string;
  remark: string;
  transport?: string;
  excludedReason?: string;
}

interface TruthFile {
  commands: TruthCommandRow[];
}

interface SuiteExclusionEntry {
  code: string;
  reason: string;
}

interface SuiteExclusionFile {
  excludeFromSuite: SuiteExclusionEntry[];
}

interface IssueRecord {
  commandKey?: string;
  setCode?: string;
  command?: string;
  value?: number | null;
  status?: string;
  matchType?: string;
}

interface NumericSpec {
  setCode: string;
  valueIndex: number;
  checksumIndex: number;
  baseRow: TruthCommandRow;
  queryCode?: string;
  queryRow?: TruthCommandRow;
}

interface CertifyCase {
  id: string;
  stage: 'AUTO' | 'POWER_MANUAL';
  source: 'truth' | 'generated' | 'sanity';
  category: string;
  description: string;
  commandKey: string;
  setCode: string | null;
  replyCode: string | null;
  txBytes: number[];
  expectedReplyBytes: number[] | null;
  generatedValue: number | null;
  serialOnly: boolean;
  isSetCommand: boolean;
  isModeChangeCommand: boolean;
  isPowerCommand: boolean;
  isDisruptiveCommand: boolean;
  closedLoopQueryRow?: TruthCommandRow;
  expectedQueryValue?: number;
}

interface CertifyRecord {
  time: string;
  stage: string;
  source: string;
  category: string;
  command: string;
  variant: string;
  commandKey: string;
  setCode: string | null;
  replyCode: string | null;
  txHex: string | null;
  rxHex: string | null;
  expectedHex: string | null;
  latencyMs: number | null;
  transportStatus: TransportStatus;
  status: ResultStatus;
  statusColor: StatusColor;
  validationMode: ValidationMode;
  matchType: string;
  meaning: string | null;
  parsed: Record<string, unknown> | null;
  note: string | null;
  skipReason: string | null;
  value: number | null;
  queryTxHex: string | null;
  queryRxHex: string | null;
  queryLatencyMs: number | null;
  queryTransportStatus: TransportStatus | null;
  queryValue: number | null;
  expectedValue: number | null;
  notes: string[];
}

interface SendResult {
  rxBytes: number[] | null;
  latencyMs: number | null;
}

interface PayloadDecode {
  markerIndex: number;
  dataLength: number;
  data: number[];
  ambiguous: boolean;
}

interface ReplyDecode {
  replyCode: string | null;
  replyCodeIndex: number | null;
  payload: PayloadDecode | null;
}

interface ParseResult {
  ok: boolean;
  parsed: Record<string, unknown> | null;
  meaning: string;
  value: number | null;
  note?: string;
}

interface CommandPolicy {
  validationMode: ValidationMode;
  parserCode?: string;
  note?: string;
  acceptAnyReplyCode?: boolean;
  allowNoReplyQuirk?: boolean;
  allowedReplyCodes?: string[];
}

interface ResolvedPolicy {
  validationMode: ValidationMode;
  parserCode: string | null;
  note: string | null;
  acceptAnyReplyCode: boolean;
  allowNoReplyQuirk: boolean;
  allowedReplyCodes: string[];
}

const DEFAULT_COLUMNS = [
  'time',
  'category',
  'command',
  'variant',
  'tx',
  'rx',
  'latency',
  'status',
  'match',
  'meaning',
  'validationMode',
  'transportStatus',
  'note'
];

const DISRUPTIVE_SET_CODES = new Set(['C003', 'C007', 'C009']);
const NUMERIC_SET_CODES = ['C203', 'C21F', 'C217', 'C223', 'C227', 'C22B', 'C259', 'C262'] as const;
const NUMERIC_VALUE_INDEX_BY_SET: Record<string, { valueIndex: number; checksumIndex: number }> = {
  C203: { valueIndex: 38, checksumIndex: 39 },
  C21F: { valueIndex: 38, checksumIndex: 39 },
  C217: { valueIndex: 38, checksumIndex: 39 },
  C223: { valueIndex: 38, checksumIndex: 39 },
  C227: { valueIndex: 38, checksumIndex: 39 },
  C22B: { valueIndex: 38, checksumIndex: 39 },
  C259: { valueIndex: 38, checksumIndex: 39 },
  C262: { valueIndex: 38, checksumIndex: 39 }
};

const CLOSED_LOOP_QUERY_BY_SET: Record<string, string> = {
  C203: 'C201',
  C21F: 'C21D',
  C217: 'C215',
  C223: 'C221',
  C227: 'C225',
  C22B: 'C229',
  C259: 'C257',
  C262: 'C264',
  C20F: 'C20D'
};

const FORMULA_CHECKSUM_BASE: Record<string, number> = {
  C203: 0x5b,
  C21F: 0x77
};

const ACK_STATUS_MEANING = new Map<number, string>([
  [0x0001, 'Success'],
  [0x0002, 'Failure: unspecified reason'],
  [0x0003, 'Failure: serial port not found'],
  [0x0004, 'Failure: no response'],
  [0x8001, 'Failure: busy'],
  [0x8002, 'Failure: occupied']
]);

const ISSUE_STATUSES = new Set(['FAIL', 'NO_REPLY', 'SKIPPED']);

const VIDEO_SOURCE_ENUM: Record<number, string> = {
  0: 'Android',
  1: 'Windows',
  2: 'HDMI1',
  3: 'HDMI2',
  4: 'HDMI3',
  6: 'HDMI4'
};

const SCENE_MODE_ENUM: Record<number, string> = {
  0: 'Meeting',
  1: 'Standard',
  2: 'Soft',
  3: 'Custom',
  5: 'Cinema'
};

const DISPLAY_MODE_ENUM: Record<number, string> = {
  1: '4:3',
  2: '16:9',
  3: 'Full',
  4: 'Original',
  7: '1:1'
};

const COLOR_TEMP_ENUM: Record<number, string> = {
  1: 'Standard',
  2: 'Warm',
  3: 'Cool',
  4: 'User'
};

const COMMAND_POLICY_BY_CODE: Record<string, CommandPolicy> = {
  C201: { validationMode: 'PARSED_RANGE', parserCode: 'C201' },
  C215: { validationMode: 'PARSED_RANGE', parserCode: 'C215' },
  C221: { validationMode: 'PARSED_RANGE', parserCode: 'C221' },
  C211: { validationMode: 'PARSED_RANGE', parserCode: 'C211' },
  C225: { validationMode: 'PARSED_RANGE', parserCode: 'C221' },
  C229: { validationMode: 'PARSED_RANGE', parserCode: 'C221' },
  C21D: { validationMode: 'PARSED_RANGE', parserCode: 'C201' },
  C257: { validationMode: 'PARSED_RANGE', parserCode: 'C201' },
  C264: { validationMode: 'PARSED_RANGE', parserCode: 'C201' },
  C243: { validationMode: 'PARSED_RANGE', parserCode: 'C243' },
  C25B: { validationMode: 'PARSED_RANGE', parserCode: 'C25B' },
  C241: { validationMode: 'PARSED_RANGE', parserCode: 'C241' },
  C131: { validationMode: 'STRUCTURE_ONLY', parserCode: 'C131', acceptAnyReplyCode: true, allowedReplyCodes: ['C332'] },
  C33D: { validationMode: 'PARSED_RANGE', parserCode: 'C33D' },
  C005: {
    validationMode: 'EXPECTED_NO_REPLY',
    parserCode: 'C005',
    allowNoReplyQuirk: true,
    note: 'Known device quirk around standby/wake transitions; no reply can be expected.'
  }
};

const AVAILABLE_COLUMNS: Record<string, (record: CertifyRecord) => string> = {
  time: record => record.time,
  stage: record => record.stage,
  source: record => record.source,
  category: record => record.category,
  command: record => record.command,
  variant: record => record.variant,
  commandKey: record => record.commandKey,
  setCode: record => record.setCode ?? '',
  replyCode: record => record.replyCode ?? '',
  tx: record => record.txHex ?? '',
  rx: record => record.rxHex ?? '',
  expected: record => record.expectedHex ?? '',
  latency: record => (record.latencyMs == null ? '' : String(record.latencyMs)),
  transportStatus: record => record.transportStatus,
  status: record => record.status,
  statusColor: record => record.statusColor,
  validationMode: record => record.validationMode,
  match: record => record.matchType,
  meaning: record => record.meaning ?? '',
  parsed: record => (record.parsed ? JSON.stringify(record.parsed) : ''),
  note: record => record.note ?? '',
  skipReason: record => record.skipReason ?? '',
  value: record => (record.value == null ? '' : String(record.value)),
  queryTx: record => record.queryTxHex ?? '',
  queryRx: record => record.queryRxHex ?? '',
  queryLatency: record => (record.queryLatencyMs == null ? '' : String(record.queryLatencyMs)),
  queryTransportStatus: record => record.queryTransportStatus ?? '',
  queryValue: record => (record.queryValue == null ? '' : String(record.queryValue)),
  expectedValue: record => (record.expectedValue == null ? '' : String(record.expectedValue)),
  notes: record => record.notes.join(' | ')
};

function printHelp(): void {
  console.log('Usage: npm run certify -- [mode] [options]');
  console.log('');
  console.log('Modes (pick one):');
  console.log('  --single <commandKey|setCommandCode>  Run one command');
  console.log('  --suite                                Run full certification suite');
  console.log('  --sanity-test                          Run known-good packet sanity checks');
  console.log('  --issues-file <path>                   Re-test commands listed in an issues JSON file');
  console.log('  --issues-only <path>                   Alias of --issues-file');
  console.log('');
  console.log('Options:');
  console.log('  --value <0-100>              Value for numeric --single commands');
  console.log('  --target <host:port>         Default: 192.168.0.20:8600');
  console.log('  --local-port <port>          Default: 8600');
  console.log('  --timeout <ms>               Default: 1200');
  console.log('  --rate <commands/sec>        Default: 1');
  console.log('  --settle-set <ms>            Default: 400');
  console.log('  --settle-mode <ms>           Default: 1200');
  console.log('  --profile <name>             exview-aio (default) | generic');
  console.log('  --include-power              Include disruptive power stage');
  console.log('  --debug-hex                  Print TX hex before send');
  console.log(
    '  --prompt-each                Ask Enter before each command send (in --suite/--issues with --include-power: prompts only disruptive power commands)'
  );
  console.log(`  --cols <a,b,c>               Default: ${DEFAULT_COLUMNS.join(',')}`);
  console.log(`                               Available: ${Object.keys(AVAILABLE_COLUMNS).join(',')}`);
  console.log('  --help                       Show this help');
}

function normalizeCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input.replace(/^0x/i, '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!normalized) return null;
  return normalized.padStart(4, '0');
}

function toCode(code: string | null | undefined): string | null {
  const normalized = normalizeCode(code);
  return normalized ? `0x${normalized}` : null;
}

function normalizeHex(input: string): string {
  return input
    .replace(/0x/gi, '')
    .replace(/[^0-9A-Fa-f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function parseHexBytes(input: string): number[] {
  const normalized = normalizeHex(input);
  if (!normalized) return [];
  const tokens = normalized.split(' ');
  const bytes: number[] = [];
  for (const token of tokens) {
    if (token.length !== 2) {
      throw new Error(`Invalid hex token "${token}"`);
    }
    const value = Number.parseInt(token, 16);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid hex token "${token}"`);
    }
    bytes.push(value);
  }
  return bytes;
}

function bytesToHex(bytes: number[]): string {
  return bytes.map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function computePdfChecksum(bytes: number[]): number {
  if (bytes.length < 10) return 0;
  let sum = 0;
  for (let index = 8; index <= bytes.length - 2; index += 1) {
    sum = (sum + bytes[index]) & 0xff;
  }
  return sum;
}

function equalBytes(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function equalIgnoringChecksum(a: number[], b: number[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  for (let index = 0; index < a.length - 1; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseTarget(value: string): { host: string; port: number } {
  const [host, portText] = value.split(':');
  if (!host || !portText) {
    throw new Error(`Invalid --target value: ${value}`);
  }
  const port = Number(portText);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid target port: ${portText}`);
  }
  return { host, port };
}

function parseColumnList(input: string): string[] {
  const columns = input
    .split(',')
    .map(col => col.trim())
    .filter(Boolean);
  if (columns.length === 0) {
    throw new Error('No columns provided to --cols');
  }
  for (const col of columns) {
    if (!AVAILABLE_COLUMNS[col]) {
      throw new Error(`Unknown column "${col}". Available columns: ${Object.keys(AVAILABLE_COLUMNS).join(',')}`);
    }
  }
  return columns;
}

function parseOptions(argv: string[]): CliOptions {
  let mode: RunMode | null = null;
  let profile: ProfileName = 'exview-aio';
  let singleSelector: string | undefined;
  let issuesFile: string | undefined;
  let value: number | undefined;
  let targetHost = '192.168.0.20';
  let targetPort = 8600;
  let localPort = 8600;
  let timeoutMs = 1200;
  let rate = 1;
  let settleSetMs = 400;
  let settleModeMs = 1200;
  let includePower = false;
  let debugHex = false;
  let promptEach = false;
  let columns = [...DEFAULT_COLUMNS];

  const setMode = (next: RunMode): void => {
    if (mode && mode !== next) {
      throw new Error('Choose only one mode: --single, --suite, --sanity-test, or --issues-file');
    }
    mode = next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--single') {
      const next = argv[index + 1];
      if (!next) throw new Error('--single requires a commandKey or setCommandCode');
      index += 1;
      setMode('single');
      singleSelector = next;
      continue;
    }

    if (arg === '--suite') {
      setMode('suite');
      continue;
    }

    if (arg === '--sanity-test') {
      setMode('sanity');
      continue;
    }

    if (arg === '--issues-file' || arg === '--issues-only') {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} requires a file path`);
      index += 1;
      setMode('issues');
      issuesFile = next;
      continue;
    }

    if (arg === '--value') {
      const next = argv[index + 1];
      if (!next) throw new Error('--value requires a number');
      index += 1;
      const numeric = Number(next);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
        throw new Error(`Invalid --value: ${next}`);
      }
      value = Math.round(numeric);
      continue;
    }

    if (arg === '--target') {
      const next = argv[index + 1];
      if (!next) throw new Error('--target requires host:port');
      index += 1;
      const parsed = parseTarget(next);
      targetHost = parsed.host;
      targetPort = parsed.port;
      continue;
    }

    if (arg === '--local-port') {
      const next = argv[index + 1];
      if (!next) throw new Error('--local-port requires a port');
      index += 1;
      const numeric = Number(next);
      if (!Number.isFinite(numeric) || numeric < 1 || numeric > 65535) {
        throw new Error(`Invalid --local-port: ${next}`);
      }
      localPort = numeric;
      continue;
    }

    if (arg === '--timeout') {
      const next = argv[index + 1];
      if (!next) throw new Error('--timeout requires milliseconds');
      index += 1;
      const numeric = Number(next);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`Invalid --timeout: ${next}`);
      }
      timeoutMs = numeric;
      continue;
    }

    if (arg === '--rate') {
      const next = argv[index + 1];
      if (!next) throw new Error('--rate requires commands/sec');
      index += 1;
      const numeric = Number(next);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`Invalid --rate: ${next}`);
      }
      rate = numeric;
      continue;
    }

    if (arg === '--settle-set') {
      const next = argv[index + 1];
      if (!next) throw new Error('--settle-set requires ms');
      index += 1;
      const numeric = Number(next);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error(`Invalid --settle-set: ${next}`);
      }
      settleSetMs = numeric;
      continue;
    }

    if (arg === '--settle-mode') {
      const next = argv[index + 1];
      if (!next) throw new Error('--settle-mode requires ms');
      index += 1;
      const numeric = Number(next);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error(`Invalid --settle-mode: ${next}`);
      }
      settleModeMs = numeric;
      continue;
    }

    if (arg === '--profile') {
      const next = argv[index + 1];
      if (!next) throw new Error('--profile requires a name');
      index += 1;
      if (next !== 'exview-aio' && next !== 'generic') {
        throw new Error(`Invalid --profile: ${next} (supported: exview-aio, generic)`);
      }
      profile = next;
      continue;
    }

    if (arg === '--include-power') {
      includePower = true;
      continue;
    }

    if (arg === '--debug-hex') {
      debugHex = true;
      continue;
    }

    if (arg === '--prompt-each') {
      promptEach = true;
      continue;
    }

    if (arg === '--cols') {
      const next = argv[index + 1];
      if (!next) throw new Error('--cols requires a comma-separated list');
      index += 1;
      columns = parseColumnList(next);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!mode) {
    throw new Error('One mode is required: --single, --suite, --sanity-test, or --issues-file');
  }
  if (mode === 'single' && !singleSelector) {
    throw new Error('--single requires a commandKey or setCommandCode');
  }
  if (mode === 'issues' && !issuesFile) {
    throw new Error('--issues-file requires a path');
  }

  return {
    mode,
    profile,
    singleSelector,
    issuesFile,
    value,
    targetHost,
    targetPort,
    localPort,
    timeoutMs,
    rate,
    settleSetMs,
    settleModeMs,
    includePower,
    debugHex,
    promptEach,
    columns
  };
}
function isUdpLike(bytes: number[]): boolean {
  if (bytes.length < 10) return false;
  for (let index = 0; index < 7; index += 1) {
    if (bytes[index] !== 0x55) return false;
  }
  return true;
}

function isSetCommand(row: TruthCommandRow): boolean {
  return row.category.toLowerCase().startsWith('set ');
}

function isModeChangeCommand(row: TruthCommandRow): boolean {
  const text = `${row.category} ${row.description} ${row.instruction}`.toLowerCase();
  return (
    text.includes('video source') ||
    text.includes('screen display') ||
    text.includes('split screen') ||
    (text.includes('set ') && text.includes('mode'))
  );
}

function isPowerCommand(row: TruthCommandRow): boolean {
  const code = normalizeCode(row.setCommandCode);
  if (!code) return false;
  return DISRUPTIVE_SET_CODES.has(code);
}

function isDisruptiveCommand(row: TruthCommandRow): boolean {
  const text = `${row.category} ${row.description} ${row.remark}`.toLowerCase();
  return text.includes('sleep') || text.includes('standby') || text.includes('restart') || text.includes('power off');
}

function isSerialOnly(row: TruthCommandRow, txBytes: number[]): boolean {
  const transport = (row.transport ?? '').toUpperCase();
  if (transport.includes('SERIAL')) return true;

  const combined = `${row.remark} ${row.instruction} ${row.excludedReason ?? ''}`.toLowerCase();
  if (combined.includes('serial only') || combined.includes('serial-only')) return true;
  if (combined.includes('does not support udp')) return true;
  if (combined.includes('excluded') && combined.includes('serial')) return true;

  if (!isUdpLike(txBytes)) return true;
  return false;
}

function deriveNumericSpecs(bySetCode: Map<string, TruthCommandRow[]>): Map<string, NumericSpec> {
  const specs = new Map<string, NumericSpec>();
  for (const setCode of NUMERIC_SET_CODES) {
    const rows = bySetCode.get(setCode) ?? [];
    if (rows.length === 0) continue;

    const manual = NUMERIC_VALUE_INDEX_BY_SET[setCode];
    if (!manual) {
      throw new Error(`Missing manual numeric index for 0x${setCode}`);
    }

    const baseRow = rows[0];
    const txBytes = parseHexBytes(baseRow.requestHex);
    if (manual.valueIndex >= txBytes.length || manual.checksumIndex >= txBytes.length) {
      throw new Error(`Manual index out of bounds for 0x${setCode}: request length=${txBytes.length}`);
    }
    if (manual.checksumIndex !== txBytes.length - 1) {
      throw new Error(`Manual checksum index is not last byte for 0x${setCode}`);
    }

    const queryCode = CLOSED_LOOP_QUERY_BY_SET[setCode];
    const queryRow = queryCode ? (bySetCode.get(queryCode) ?? [])[0] : undefined;
    specs.set(setCode, {
      setCode,
      valueIndex: manual.valueIndex,
      checksumIndex: manual.checksumIndex,
      baseRow,
      queryCode,
      queryRow
    });
  }
  return specs;
}

function extractTailPayload(bytes: number[]): PayloadDecode | null {
  if (bytes.length < 6) return null;
  const candidates: Array<{ index: number; length: number; data: number[] }> = [];
  const minIndex = Math.max(0, bytes.length - 96);
  for (let index = bytes.length - 4; index >= minIndex; index -= 1) {
    if (bytes[index] !== 0x00) continue;
    if (bytes[index + 2] !== 0x00) continue;
    const length = bytes[index + 1];
    const start = index + 3;
    const checksumIndex = start + length;
    if (checksumIndex !== bytes.length - 1) continue;
    candidates.push({ index, length, data: bytes.slice(start, checksumIndex) });
  }
  if (candidates.length === 0) return null;
  const selected = candidates[0];
  return {
    markerIndex: selected.index,
    dataLength: selected.length,
    data: selected.data,
    ambiguous: candidates.length > 1
  };
}

function decodeReplyCode(bytes: number[]): { code: string | null; index: number | null } {
  const maxScan = Math.min(bytes.length - 3, 40);
  for (let index = 8; index <= maxScan; index += 1) {
    if (bytes[index] !== 0xd0) continue;
    const low = bytes[index + 1];
    const high = bytes[index + 2];
    return {
      code: `${high.toString(16).padStart(2, '0')}${low.toString(16).padStart(2, '0')}`.toUpperCase(),
      index
    };
  }
  return { code: null, index: null };
}

function decodeReply(bytes: number[]): ReplyDecode {
  const code = decodeReplyCode(bytes);
  const payload = extractTailPayload(bytes);
  return {
    replyCode: code.code,
    replyCodeIndex: code.index,
    payload
  };
}

function parseAckStatus(decoded: ReplyDecode | null): number | null {
  if (!decoded?.payload) return null;
  if (decoded.payload.data.length < 2) return null;
  return decoded.payload.data[0] | (decoded.payload.data[1] << 8);
}

function ackMeaning(statusCode: number | null): string | null {
  if (statusCode == null) return null;
  return ACK_STATUS_MEANING.get(statusCode) ?? `Status 0x${statusCode.toString(16).toUpperCase().padStart(4, '0')}`;
}

function sanitizeForCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function waitForEnter(prompt: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log(`${prompt} (stdin not TTY, auto-continue)`);
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${prompt}\n`, () => {
      rl.close();
      resolve();
    });
  });
}

async function bindSocket(socket: dgram.Socket, localPort: number): Promise<dgram.AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      socket.removeListener('error', onError);
      resolve();
    };
    socket.once('error', onError);
    socket.once('listening', onListening);
    socket.bind(localPort);
  });
  const address = socket.address();
  if (typeof address === 'string') {
    throw new Error('Unexpected socket.address() string');
  }
  return address;
}

async function sendAndAwaitReply(
  socket: dgram.Socket,
  txBytes: number[],
  targetHost: string,
  targetPort: number,
  timeoutMs: number
): Promise<SendResult> {
  const requireIp = isIP(targetHost) !== 0;

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const cleanup = (result: SendResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(result);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('message', onMessage);
      reject(error);
    };

    const onMessage = (buffer: Buffer, rinfo: dgram.RemoteInfo): void => {
      if (requireIp && rinfo.address !== targetHost) return;
      if (rinfo.port !== targetPort) return;
      cleanup({
        rxBytes: [...buffer.values()],
        latencyMs: Date.now() - startedAt
      });
    };

    const timer = setTimeout(
      () =>
        cleanup({
          rxBytes: null,
          latencyMs: null
        }),
      timeoutMs
    );

    socket.on('message', onMessage);
    socket.send(Buffer.from(txBytes), targetPort, targetHost, error => {
      if (error) fail(error);
    });
  });
}

function valueLabel(setCode: string | null): string {
  const normalized = normalizeCode(setCode);
  if (!normalized) return 'value';
  if (normalized === 'C203') return 'volume';
  if (normalized === 'C21F') return 'brightness';
  if (normalized === 'C217') return 'contrast';
  if (normalized === 'C223') return 'redGain';
  if (normalized === 'C227') return 'greenGain';
  if (normalized === 'C22B') return 'blueGain';
  if (normalized === 'C259') return 'saturation';
  if (normalized === 'C262') return 'hue';
  return 'value';
}

function toFileStamp(value: Date): string {
  return value.toISOString().replace(/[:.]/g, '-');
}

function buildGeneratedNumericCase(spec: NumericSpec, value: number, source: 'generated' | 'sanity'): CertifyCase {
  const txBytes = parseHexBytes(spec.baseRow.requestHex);
  txBytes[spec.valueIndex] = value & 0xff;

  const formulaBase = FORMULA_CHECKSUM_BASE[spec.setCode];
  if (formulaBase != null) {
    txBytes[spec.checksumIndex] = (formulaBase + value) & 0xff;
  } else {
    txBytes[spec.checksumIndex] = computePdfChecksum(txBytes);
  }

  const expectedReplyBytes = spec.baseRow.replyHex ? parseHexBytes(spec.baseRow.replyHex) : null;
  return {
    id: `${spec.baseRow.commandKey}:gen-${value}`,
    stage: DISRUPTIVE_SET_CODES.has(spec.setCode) ? 'POWER_MANUAL' : 'AUTO',
    source,
    category: spec.baseRow.category,
    description: `${valueLabel(toCode(spec.setCode))}=${value}`,
    commandKey: `${spec.baseRow.commandKey}:gen-${value}`,
    setCode: toCode(spec.setCode),
    replyCode: spec.baseRow.replyCommandCode,
    txBytes,
    expectedReplyBytes,
    generatedValue: value,
    serialOnly: false,
    isSetCommand: true,
    isModeChangeCommand: isModeChangeCommand(spec.baseRow),
    isPowerCommand: false,
    isDisruptiveCommand: false,
    closedLoopQueryRow: spec.queryRow,
    expectedQueryValue: value
  };
}

function buildCaseFromTruthRow(row: TruthCommandRow, source: 'truth' | 'sanity'): CertifyCase {
  const txBytes = parseHexBytes(row.requestHex);
  const setCode = normalizeCode(row.setCommandCode);
  let expectedQueryValue: number | undefined;
  if (setCode === 'C20F' && txBytes.length > 38) {
    expectedQueryValue = txBytes[38];
  }

  return {
    id: row.commandKey,
    stage: isPowerCommand(row) ? 'POWER_MANUAL' : 'AUTO',
    source,
    category: row.category,
    description: row.description || row.remark || row.commandKey,
    commandKey: row.commandKey,
    setCode: row.setCommandCode,
    replyCode: row.replyCommandCode,
    txBytes,
    expectedReplyBytes: row.replyHex ? parseHexBytes(row.replyHex) : null,
    generatedValue: null,
    serialOnly: isSerialOnly(row, txBytes),
    isSetCommand: isSetCommand(row),
    isModeChangeCommand: isModeChangeCommand(row),
    isPowerCommand: isPowerCommand(row),
    isDisruptiveCommand: isDisruptiveCommand(row),
    expectedQueryValue
  };
}

function buildSuiteCases(rows: TruthCommandRow[], numericSpecs: Map<string, NumericSpec>): CertifyCase[] {
  const cases: CertifyCase[] = [];
  const generatedSetCodes = new Set<string>();

  for (const row of rows) {
    const setCode = normalizeCode(row.setCommandCode);
    if (setCode && numericSpecs.has(setCode) && !generatedSetCodes.has(setCode)) {
      const spec = numericSpecs.get(setCode)!;
      for (let value = 0; value <= 100; value += 1) {
        cases.push(buildGeneratedNumericCase(spec, value, 'generated'));
      }
      generatedSetCodes.add(setCode);
      continue;
    }
    if (setCode && numericSpecs.has(setCode)) continue;
    cases.push(buildCaseFromTruthRow(row, 'truth'));
  }

  const normalCases = cases.filter(item => !item.isPowerCommand);
  const powerCases = cases.filter(item => item.isPowerCommand);
  return [...normalCases, ...powerCases];
}

function buildSingleCase(
  byKey: Map<string, TruthCommandRow>,
  bySetCode: Map<string, TruthCommandRow[]>,
  numericSpecs: Map<string, NumericSpec>,
  selector: string,
  value?: number
): CertifyCase {
  const rowByKey = byKey.get(selector);
  if (rowByKey) {
    const setCode = normalizeCode(rowByKey.setCommandCode);
    if (setCode && numericSpecs.has(setCode) && value != null) {
      return buildGeneratedNumericCase(numericSpecs.get(setCode)!, value, 'generated');
    }
    return buildCaseFromTruthRow(rowByKey, 'truth');
  }

  const normalizedCode = normalizeCode(selector);
  if (!normalizedCode) {
    throw new Error(`Unknown --single selector: ${selector}`);
  }
  const matching = bySetCode.get(normalizedCode) ?? [];
  if (matching.length === 0) {
    throw new Error(`No command found for setCommandCode ${selector}`);
  }

  if (numericSpecs.has(normalizedCode)) {
    if (value == null) {
      throw new Error(`Numeric command ${selector} requires --value <0-100> for deterministic single run`);
    }
    return buildGeneratedNumericCase(numericSpecs.get(normalizedCode)!, value, 'generated');
  }

  if (value != null) {
    throw new Error(`--value is not valid for non-numeric command ${selector}`);
  }

  return buildCaseFromTruthRow(matching[0], 'truth');
}

function buildSanityCases(bySetCode: Map<string, TruthCommandRow[]>, numericSpecs: Map<string, NumericSpec>): CertifyCase[] {
  const sanityCases: CertifyCase[] = [];

  const c213Rows = bySetCode.get('C213') ?? [];
  const androidRow =
    c213Rows.find(row => row.description.toLowerCase().includes('android')) ??
    c213Rows.find(row => row.description.trim().startsWith('0')) ??
    c213Rows[0];
  if (!androidRow) {
    throw new Error('Unable to locate C213 Android truth row for sanity test');
  }
  sanityCases.push(buildCaseFromTruthRow(androidRow, 'sanity'));

  const volumeSpec = numericSpecs.get('C203');
  if (!volumeSpec) throw new Error('Unable to locate C203 truth rows for sanity test');
  sanityCases.push(buildGeneratedNumericCase(volumeSpec, 50, 'sanity'));

  const brightnessSpec = numericSpecs.get('C21F');
  if (!brightnessSpec) throw new Error('Unable to locate C21F truth rows for sanity test');
  sanityCases.push(buildGeneratedNumericCase(brightnessSpec, 50, 'sanity'));

  return sanityCases;
}

function statusColorFromStatus(status: ResultStatus): StatusColor {
  if (status === 'PASS') return 'GREEN';
  if (status === 'SKIPPED') return 'GRAY';
  return 'RED';
}

function buildSkippedRecord(caseItem: CertifyCase, reason: string): CertifyRecord {
  return {
    time: new Date().toISOString(),
    stage: caseItem.stage,
    source: caseItem.source,
    category: caseItem.category,
    command: caseItem.setCode ?? caseItem.commandKey,
    variant: caseItem.description,
    commandKey: caseItem.commandKey,
    setCode: caseItem.setCode,
    replyCode: caseItem.replyCode,
    txHex: caseItem.txBytes.length > 0 ? bytesToHex(caseItem.txBytes) : null,
    rxHex: null,
    expectedHex: caseItem.expectedReplyBytes ? bytesToHex(caseItem.expectedReplyBytes) : null,
    latencyMs: null,
    transportStatus: 'NO_REPLY',
    status: 'SKIPPED',
    statusColor: statusColorFromStatus('SKIPPED'),
    validationMode: 'STRICT_EXACT',
    matchType: 'SKIPPED',
    meaning: null,
    parsed: null,
    note: reason,
    skipReason: reason,
    value: caseItem.generatedValue,
    queryTxHex: null,
    queryRxHex: null,
    queryLatencyMs: null,
    queryTransportStatus: null,
    queryValue: null,
    expectedValue: caseItem.expectedQueryValue ?? null,
    notes: [reason]
  };
}

function verifyGeneratedChecksum(caseItem: CertifyCase): {
  computedPdf: number | null;
  actual: number | null;
  formula: number | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (caseItem.generatedValue == null) {
    return { computedPdf: null, actual: null, formula: null, warnings };
  }
  const computedPdf = computePdfChecksum(caseItem.txBytes);
  const actual = caseItem.txBytes[caseItem.txBytes.length - 1];
  let formula: number | null = null;
  if (computedPdf !== actual) {
    warnings.push(
      `Self-check mismatch: checksum(last=0x${actual.toString(16).toUpperCase().padStart(2, '0')}, computed=0x${computedPdf
        .toString(16)
        .toUpperCase()
        .padStart(2, '0')})`
    );
  }
  const setCode = normalizeCode(caseItem.setCode);
  if (setCode && FORMULA_CHECKSUM_BASE[setCode] != null) {
    formula = (FORMULA_CHECKSUM_BASE[setCode] + caseItem.generatedValue) & 0xff;
    if (formula !== actual) {
      warnings.push(
        `Formula mismatch for ${toCode(setCode)}: formula=0x${formula.toString(16).toUpperCase().padStart(2, '0')} actual=0x${actual
          .toString(16)
          .toUpperCase()
          .padStart(2, '0')}`
      );
    }
  }
  return { computedPdf, actual, formula, warnings };
}
function parseRangeValue(label: string, data: number[], min: number, max: number): ParseResult {
  if (data.length < 1) {
    return {
      ok: false,
      parsed: null,
      meaning: `${label}: missing payload`,
      value: null
    };
  }
  const value = data[0];
  const ok = value >= min && value <= max;
  return {
    ok,
    parsed: { [label]: value },
    meaning: `${label}=${value}`,
    value,
    note: ok ? undefined : `${label} out of range (${value}, expected ${min}-${max})`
  };
}

function parseEnumValue(label: string, data: number[], map: Record<number, string>): ParseResult {
  if (data.length < 1) {
    return { ok: false, parsed: null, meaning: `${label}: missing payload`, value: null };
  }
  let value = data[0];
  if (data.length >= 2 && data[0] === 0x00 && data[1] !== 0x00) {
    value = data[1];
  }
  const text = map[value];
  if (!text) {
    return {
      ok: false,
      parsed: { [label]: value },
      meaning: `${label}=unknown(${value})`,
      value,
      note: `${label} value is outside enum set`
    };
  }
  return {
    ok: true,
    parsed: { [label]: value, [`${label}Text`]: text },
    meaning: `${label}=${text}(${value})`,
    value
  };
}

function parseHdmiPresenceFromFrame(bytes: number[]): ParseResult {
  const matches: Array<{ index: number; len: number; payload: number[] }> = [];
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    const len = (bytes[index] << 8) | bytes[index + 1];
    if (bytes[index + 2] !== 0x00) continue;
    const payloadStart = index + 3;
    const payloadEnd = payloadStart + len;
    if (payloadEnd !== bytes.length - 1) continue;
    matches.push({ index, len, payload: bytes.slice(payloadStart, payloadEnd) });
  }

  if (matches.length === 0) {
    return {
      ok: false,
      parsed: { raw: bytesToHex(bytes) },
      meaning: 'hdmiPresence: tail length marker not found',
      value: null
    };
  }

  const len4Matches = matches.filter(item => item.len === 4);
  const selected = (len4Matches.length > 0 ? len4Matches : matches).reduce((best, item) => (item.index > best.index ? item : best));
  if (selected.len !== 4) {
    return {
      ok: false,
      parsed: { tailLength: selected.len, payload: selected.payload },
      meaning: `hdmiPresence payload length=${selected.len}, expected=4`,
      value: null
    };
  }

  const flags = selected.payload;
  if (flags.some(item => item !== 0 && item !== 1)) {
    return {
      ok: false,
      parsed: { payload: flags },
      meaning: `hdmiPresence raw=${flags.join(',')}`,
      value: null,
      note: 'Expected each HDMI flag to be 0 or 1'
    };
  }

  const parsed = {
    hdmi1: flags[0] as 0 | 1,
    hdmi2: flags[1] as 0 | 1,
    hdmi3: flags[2] as 0 | 1,
    hdmi4: flags[3] as 0 | 1,
    payloadHex: bytesToHex(flags),
    activeInputs: ['HDMI1', 'HDMI2', 'HDMI3', 'HDMI4'].filter((_, index) => flags[index] === 1)
  };
  const meaning = `HDMI1=${flags[0] ? 'signal' : 'no-signal'}, HDMI2=${flags[1] ? 'signal' : 'no-signal'}, HDMI3=${flags[2] ? 'signal' : 'no-signal'}, HDMI4=${flags[3] ? 'signal' : 'no-signal'}`;

  return {
    ok: true,
    parsed,
    meaning,
    value: null
  };
}

function parseSemanticByCode(parserCode: string, data: number[]): ParseResult {
  switch (parserCode) {
    case 'C201':
      if (data.length !== 1) return { ok: false, parsed: { raw: data }, meaning: `volume payload length=${data.length}, expected=1`, value: null };
      return parseRangeValue('volume', data, 0, 100);
    case 'C215':
      if (data.length !== 1)
        return { ok: false, parsed: { raw: data }, meaning: `contrast payload length=${data.length}, expected=1`, value: null };
      return parseRangeValue('contrast', data, 0, 100);
    case 'C221':
      if (data.length !== 1)
        return { ok: false, parsed: { raw: data }, meaning: `redGain payload length=${data.length}, expected=1`, value: null };
      return parseRangeValue('redGain', data, 0, 100);
    case 'C211':
      if (data.length !== 1)
        return { ok: false, parsed: { raw: data }, meaning: `videoSource payload length=${data.length}, expected=1`, value: null };
      return parseEnumValue('videoSource', data, VIDEO_SOURCE_ENUM);
    case 'C243':
      if (data.length !== 1)
        return { ok: false, parsed: { raw: data }, meaning: `sceneMode payload length=${data.length}, expected=1`, value: null };
      return parseEnumValue('sceneMode', data, SCENE_MODE_ENUM);
    case 'C20D':
      return parseEnumValue('displayMode', data, DISPLAY_MODE_ENUM);
    case 'C020':
      return parseEnumValue('trueStandby', data, { 0: 'TrueStandby', 1: 'NormalOperation' });
    case 'C005': {
      if (data.length !== 1) {
        return { ok: false, parsed: null, meaning: 'sleepWake: missing payload', value: null };
      }
      const flag = data[0];
      if (flag === 0x80) {
        return {
          ok: true,
          parsed: { sleepWakeFlag: flag, state: 'Awake' },
          meaning: 'sleepWake=Awake(0x80)',
          value: flag
        };
      }
      if (flag === 0x00) {
        return {
          ok: true,
          parsed: { sleepWakeFlag: flag, state: 'Blackout' },
          meaning: 'sleepWake=Blackout(0x00)',
          value: flag
        };
      }
      return {
        ok: false,
        parsed: { sleepWakeFlag: flag },
        meaning: `sleepWake=unknown(0x${flag.toString(16).toUpperCase().padStart(2, '0')})`,
        value: flag,
        note: 'Expected 0x80 (awake) or 0x00 (blackout)'
      };
    }
    case 'C25B': {
      if (data.length !== 4) {
        return { ok: false, parsed: { raw: data }, meaning: `hdmiPresence payload length=${data.length}, expected=4`, value: null };
      }
      const flags = data.slice(0, 4);
      if (flags.some(item => item !== 0 && item !== 1)) {
        return {
          ok: false,
          parsed: { raw: flags },
          meaning: `hdmiPresence raw=${flags.join(',')}`,
          value: null,
          note: 'Expected each HDMI flag to be 0 or 1'
        };
      }
      const parsed = {
        hdmi1: flags[0],
        hdmi2: flags[1],
        hdmi3: flags[2],
        hdmi4: flags[3]
      };
      return {
        ok: true,
        parsed,
        meaning: `hdmi1=${flags[0]} hdmi2=${flags[1]} hdmi3=${flags[2]} hdmi4=${flags[3]}`,
        value: null
      };
    }
    case 'C241': {
      if (data.length !== 7) {
        return {
          ok: false,
          parsed: { raw: data },
          meaning: `videoCombo payload length=${data.length}, expected=7`,
          value: null
        };
      }
      const brightness = data[0];
      const colorTemp = data[1];
      const displayMode = data[2];
      const videoSource = data[3];
      const volume = data[4];
      const contrast = data[5];
      const sceneMode = data[6];

      const errors: string[] = [];
      if (brightness < 0 || brightness > 100) errors.push('brightness out of range');
      if (!COLOR_TEMP_ENUM[colorTemp]) errors.push('colorTemp invalid');
      if (!DISPLAY_MODE_ENUM[displayMode]) errors.push('displayMode invalid');
      if (!VIDEO_SOURCE_ENUM[videoSource]) errors.push('videoSource invalid');
      if (volume < 0 || volume > 100) errors.push('volume out of range');
      if (contrast < 0 || contrast > 100) errors.push('contrast out of range');
      if (!SCENE_MODE_ENUM[sceneMode]) errors.push('sceneMode invalid');

      const parsed = {
        brightness,
        colorTemp,
        colorTempText: COLOR_TEMP_ENUM[colorTemp] ?? 'unknown',
        displayMode,
        displayModeText: DISPLAY_MODE_ENUM[displayMode] ?? 'unknown',
        videoSource,
        videoSourceText: VIDEO_SOURCE_ENUM[videoSource] ?? 'unknown',
        volume,
        contrast,
        sceneMode,
        sceneModeText: SCENE_MODE_ENUM[sceneMode] ?? 'unknown'
      };
      return {
        ok: errors.length === 0,
        parsed,
        meaning: `brightness=${brightness} source=${parsed.videoSourceText} volume=${volume} contrast=${contrast}`,
        value: null,
        note: errors.length === 0 ? undefined : errors.join('; ')
      };
    }
    case 'C131': {
      if (data.length < 6) {
        return {
          ok: false,
          parsed: null,
          meaning: `screenMonitoring: payload too short (${data.length})`,
          value: null
        };
      }
      const status = data[0] | (data[1] << 8);
      const dataSource = data[2];
      const numPorts = data[3];
      const totalCabinets = data[4] | (data[5] << 8);
      const requiredLength = 6 + numPorts + totalCabinets * 6;
      const okStatus = status === 0x0001 || status === 0x0002;
      const plausibleCounts = numPorts <= 64 && totalCabinets <= 4096;
      const okLength = data.length >= requiredLength;
      const perPortCounts = data.slice(6, 6 + numPorts);
      const parsed = {
        status,
        dataSource,
        numPorts,
        totalCabinets,
        requiredLength,
        payloadLength: data.length,
        perPortCounts
      };
      const plausible = okStatus && plausibleCounts;
      const notes: string[] = [];
      if (!okStatus) notes.push(`status not in {0x0001,0x0002}: 0x${status.toString(16).toUpperCase().padStart(4, '0')}`);
      if (!plausibleCounts) notes.push(`implausible counts: ports=${numPorts}, cabinets=${totalCabinets}`);
      if (!okLength) notes.push(`payload shorter than declared structure: ${data.length} < ${requiredLength}`);
      return {
        ok: plausible,
        parsed,
        meaning: `status=0x${status.toString(16).toUpperCase().padStart(4, '0')} ports=${numPorts} totalCabinets=${totalCabinets}`,
        value: null,
        note: notes.length === 0 ? undefined : notes.join('; ')
      };
    }
    case 'C33D': {
      if (data.length !== 4) {
        return {
          ok: false,
          parsed: { raw: data },
          meaning: `uptime payload length=${data.length}, expected=4`,
          value: null
        };
      }
      const minutes = ((data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0) as number;
      return {
        ok: true,
        parsed: { minutes },
        meaning: `uptimeMinutes=${minutes}`,
        value: minutes
      };
    }
    default:
      return {
        ok: false,
        parsed: null,
        meaning: `No semantic parser for ${parserCode}`,
        value: null
      };
  }
}

function resolvePolicy(caseItem: CertifyCase, _profile: ProfileName): ResolvedPolicy {
  const setCode = normalizeCode(caseItem.setCode);
  const base = setCode ? COMMAND_POLICY_BY_CODE[setCode] : undefined;

  let validationMode: ValidationMode = base?.validationMode ?? 'STRICT_EXACT';
  let parserCode: string | null = base?.parserCode ?? setCode ?? null;
  const note: string | null = base?.note ?? null;
  const acceptAnyReplyCode = base?.acceptAnyReplyCode ?? false;
  const allowNoReplyQuirk = base?.allowNoReplyQuirk ?? false;
  const allowedReplyCodes = [...(base?.allowedReplyCodes ?? [])];

  const text = `${caseItem.category} ${caseItem.description}`.toLowerCase();
  if (!base && text.includes('query scene mode')) {
    validationMode = 'PARSED_RANGE';
    parserCode = 'C243';
  }

  return {
    validationMode,
    parserCode,
    note,
    acceptAnyReplyCode,
    allowNoReplyQuirk,
    allowedReplyCodes
  };
}

function isReplyCodeAccepted(expected: string | null, actualNormalized: string | null, allowed: string[]): boolean {
  const accepted = new Set<string>();
  const normalizedExpected = normalizeCode(expected);
  if (normalizedExpected) accepted.add(normalizedExpected);
  for (const item of allowed) {
    const normalized = normalizeCode(item);
    if (normalized) accepted.add(normalized);
  }
  if (accepted.size === 0) return true;
  if (!actualNormalized) return false;
  return accepted.has(actualNormalized);
}

function inferExpectedQueryValue(caseItem: CertifyCase): number | null {
  if (caseItem.expectedQueryValue != null) return caseItem.expectedQueryValue;
  if (caseItem.generatedValue != null) return caseItem.generatedValue;
  const setCode = normalizeCode(caseItem.setCode);
  if (!setCode) return null;
  if (NUMERIC_VALUE_INDEX_BY_SET[setCode]) {
    const index = NUMERIC_VALUE_INDEX_BY_SET[setCode].valueIndex;
    if (index < caseItem.txBytes.length) return caseItem.txBytes[index];
  }
  if (setCode === 'C20F' && caseItem.txBytes.length > 38) {
    return caseItem.txBytes[38];
  }
  return null;
}

function makeBaseRecord(caseItem: CertifyCase, policy: ResolvedPolicy, sendResult: SendResult): CertifyRecord {
  return {
    time: new Date().toISOString(),
    stage: caseItem.stage,
    source: caseItem.source,
    category: caseItem.category,
    command: caseItem.setCode ?? caseItem.commandKey,
    variant: caseItem.description,
    commandKey: caseItem.commandKey,
    setCode: caseItem.setCode,
    replyCode: caseItem.replyCode,
    txHex: bytesToHex(caseItem.txBytes),
    rxHex: sendResult.rxBytes ? bytesToHex(sendResult.rxBytes) : null,
    expectedHex: caseItem.expectedReplyBytes ? bytesToHex(caseItem.expectedReplyBytes) : null,
    latencyMs: sendResult.latencyMs,
    transportStatus: sendResult.rxBytes ? 'REPLY' : 'NO_REPLY',
    status: 'FAIL',
    statusColor: 'RED',
    validationMode: policy.validationMode,
    matchType: 'UNSET',
    meaning: null,
    parsed: null,
    note: policy.note,
    skipReason: null,
    value: caseItem.generatedValue,
    queryTxHex: null,
    queryRxHex: null,
    queryLatencyMs: null,
    queryTransportStatus: null,
    queryValue: null,
    expectedValue: inferExpectedQueryValue(caseItem),
    notes: []
  };
}

function setOutcome(record: CertifyRecord, status: ResultStatus, matchType: string, meaning: string | null, note?: string): CertifyRecord {
  record.status = status;
  record.statusColor = statusColorFromStatus(status);
  record.matchType = matchType;
  if (meaning) record.meaning = meaning;
  if (note) {
    record.note = record.note ? `${record.note} | ${note}` : note;
    record.notes.push(note);
  }
  return record;
}

async function executeCase(
  socket: dgram.Socket,
  caseItem: CertifyCase,
  options: CliOptions,
  bySetCode: Map<string, TruthCommandRow[]>
): Promise<CertifyRecord> {
  const txHex = bytesToHex(caseItem.txBytes);
  if (options.debugHex) {
    console.log(`[DEBUG TX] ${caseItem.commandKey} ${txHex}`);
  }

  const checksumCheck = verifyGeneratedChecksum(caseItem);
  if (caseItem.generatedValue != null && checksumCheck.computedPdf != null && checksumCheck.actual != null) {
    const formulaText =
      checksumCheck.formula == null ? '' : ` formula=0x${checksumCheck.formula.toString(16).toUpperCase().padStart(2, '0')}`;
    console.log(
      `[SELF-CHECK] ${caseItem.commandKey} computed=0x${checksumCheck.computedPdf
        .toString(16)
        .toUpperCase()
        .padStart(2, '0')} last=0x${checksumCheck.actual.toString(16).toUpperCase().padStart(2, '0')}${formulaText}`
    );
  }
  for (const warning of checksumCheck.warnings) {
    console.warn(`WARNING ${caseItem.commandKey}: ${warning}`);
  }

  const policy = resolvePolicy(caseItem, options.profile);
  const primary = await sendAndAwaitReply(socket, caseItem.txBytes, options.targetHost, options.targetPort, options.timeoutMs);
  const decoded = primary.rxBytes ? decodeReply(primary.rxBytes) : null;
  const record = makeBaseRecord(caseItem, policy, primary);
  record.notes.push(...checksumCheck.warnings);

  if (decoded?.payload?.ambiguous && policy.parserCode !== 'C25B') {
    record.notes.push('Ambiguous payload marker in reply; used last marker');
  }
  if (options.debugHex && primary.rxBytes) {
    if (policy.parserCode === 'C25B') {
      const hdmiDebug = parseHdmiPresenceFromFrame(primary.rxBytes);
      const codeText = decoded?.replyCode ? `0x${decoded.replyCode}` : 'unknown';
      const payloadHex =
        hdmiDebug.parsed && typeof hdmiDebug.parsed.payloadHex === 'string' ? hdmiDebug.parsed.payloadHex : 'n/a';
      console.log(`[DEBUG RX] ${caseItem.commandKey} replyCode=${codeText} hdmiPayload=${payloadHex} ${hdmiDebug.meaning}`);
    } else if (decoded) {
      const codeText = decoded.replyCode ? `0x${decoded.replyCode}` : 'unknown';
      const payloadText = decoded.payload ? `len=${decoded.payload.dataLength} marker=${decoded.payload.markerIndex}` : 'none';
      console.log(`[DEBUG RX] ${caseItem.commandKey} replyCode=${codeText} payload=${payloadText}`);
    }
  }
  if (policy.acceptAnyReplyCode && decoded?.replyCode) {
    const observed = `Observed reply code: 0x${decoded.replyCode}`;
    record.note = record.note ? `${record.note} | ${observed}` : observed;
    record.notes.push(observed);
  }

  if (policy.validationMode === 'EXPECTED_NO_REPLY') {
    if (!primary.rxBytes) {
      return setOutcome(record, 'PASS', 'EXPECTED_NO_REPLY', policy.note ?? 'No reply expected for this command');
    }
    if (!decoded?.payload || !policy.parserCode) {
      return setOutcome(record, 'PASS', 'EXPECTED_NO_REPLY_WITH_REPLY', 'Reply received even though no-reply was expected');
    }
    const parsedUnexpected = parseSemanticByCode(policy.parserCode, decoded.payload.data);
    record.parsed = parsedUnexpected.parsed;
    record.meaning = parsedUnexpected.meaning;
    if (parsedUnexpected.note) record.notes.push(parsedUnexpected.note);
    return setOutcome(record, 'PASS', 'EXPECTED_NO_REPLY_WITH_REPLY', 'Reply received; treated as pass for expected-no-reply mode');
  }

  if (!primary.rxBytes) {
    const setCode = normalizeCode(caseItem.setCode);
    if (options.profile === 'exview-aio' && setCode === 'C211') {
      const reason = 'No reply in split-screen mode (FW limitation)';
      record.skipReason = reason;
      return setOutcome(record, 'SKIPPED', 'SKIPPED', reason, reason);
    }
    if (policy.allowNoReplyQuirk) {
      return setOutcome(record, 'NO_REPLY', 'NO_REPLY_QUIRK', policy.note ?? 'Known device quirk: no reply');
    }
    return setOutcome(record, 'NO_REPLY', 'NO_REPLY', 'No reply within timeout');
  }

  if (!policy.acceptAnyReplyCode && !isReplyCodeAccepted(caseItem.replyCode, decoded?.replyCode ?? null, policy.allowedReplyCodes)) {
    const actualCode = decoded?.replyCode ? `0x${decoded.replyCode}` : 'unknown';
    const expectedCode = caseItem.replyCode ?? 'unknown';
    return setOutcome(record, 'FAIL', 'REPLY_CODE_MISMATCH', `replyCode=${actualCode}, expected=${expectedCode}`);
  }

  if (policy.validationMode === 'STRICT_EXACT') {
    if (caseItem.expectedReplyBytes && equalBytes(caseItem.expectedReplyBytes, primary.rxBytes)) {
      return setOutcome(record, 'PASS', 'EXACT', 'Reply matches expected template');
    }
    if (caseItem.expectedReplyBytes && equalIgnoringChecksum(caseItem.expectedReplyBytes, primary.rxBytes)) {
      return setOutcome(record, 'PASS', 'CHECKSUM_DIFF', 'Reply matches expected template except checksum');
    }

    const ack = parseAckStatus(decoded);
    if (ack === 0x0001) {
      return setOutcome(record, 'PASS', 'ACK_SUCCESS', ackMeaning(ack));
    }
    if (!caseItem.expectedReplyBytes) {
      return setOutcome(record, 'PASS', 'RX_WITHOUT_TEMPLATE', 'Reply received (no expected template)');
    }
    return setOutcome(record, 'FAIL', 'MISMATCH', 'Reply did not match expected template');
  }

  if (!policy.parserCode) {
    return setOutcome(record, 'FAIL', 'PARSER_NOT_CONFIGURED', 'Semantic parser not configured for command');
  }

  let parsed: ParseResult;
  if (policy.parserCode === 'C25B') {
    parsed = parseHdmiPresenceFromFrame(primary.rxBytes);
  } else {
    if (!decoded?.payload) {
      return setOutcome(record, 'FAIL', 'PAYLOAD_NOT_FOUND', 'Could not locate payload marker in reply');
    }
    parsed = parseSemanticByCode(policy.parserCode, decoded.payload.data);
  }
  record.parsed = parsed.parsed;
  record.meaning = parsed.meaning;
  if (parsed.note) {
    record.notes.push(parsed.note);
  }
  if (parsed.value != null && caseItem.generatedValue == null) {
    record.value = parsed.value;
  }

  if (parsed.ok) {
    return setOutcome(record, 'PASS', policy.validationMode, parsed.meaning);
  }
  return setOutcome(record, 'FAIL', 'SEMANTIC_PARSE_FAIL', parsed.meaning, parsed.note);
}

function makeProgressLine(index: number, total: number, record: CertifyRecord): string {
  const latency = record.latencyMs == null ? '' : ` latency=${record.latencyMs}ms`;
  const valuePart = record.value == null ? '' : ` ${valueLabel(record.setCode)}=${record.value}`;
  const meaningPart = record.meaning ? ` meaning="${record.meaning}"` : '';
  return `[${index}/${total}] ${record.command}${valuePart} ${record.status}${latency} match=${record.matchType}${meaningPart}`;
}

function buildSummary(records: CertifyRecord[]): {
  pass: number;
  fail: number;
  noReply: number;
  skipped: number;
} {
  return {
    pass: records.filter(record => record.status === 'PASS').length,
    fail: records.filter(record => record.status === 'FAIL').length,
    noReply: records.filter(record => record.status === 'NO_REPLY').length,
    skipped: records.filter(record => record.status === 'SKIPPED').length
  };
}
function writeArtifacts(
  rootDir: string,
  options: CliOptions,
  startedAt: Date,
  finishedAt: Date,
  records: CertifyRecord[]
): {
  jsonPath: string;
  csvPath: string;
  htmlPath: string;
  issuesJsonPath: string;
  issuesCsvPath: string;
} {
  const stamp = toFileStamp(startedAt);
  const dataDir = path.resolve(rootDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const jsonPath = path.resolve(dataDir, `certify-${stamp}.json`);
  const csvPath = path.resolve(dataDir, `certify-${stamp}.csv`);
  const htmlPath = path.resolve(dataDir, `certify-${stamp}.html`);
  const issuesJsonPath = path.resolve(dataDir, `certify-${stamp}.issues.json`);
  const issuesCsvPath = path.resolve(dataDir, `certify-${stamp}.issues.csv`);

  const summary = buildSummary(records);
  const jsonPayload = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    options,
    summary,
    records
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf8');

  const header = options.columns;
  const csvLines: string[] = [header.join(',')];
  for (const record of records) {
    const row = header.map(col => sanitizeForCsv(AVAILABLE_COLUMNS[col](record)));
    csvLines.push(row.join(','));
  }
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

  const issues = records.filter(record => ISSUE_STATUSES.has(record.status));
  const issuesPayload = {
    generatedFrom: path.basename(jsonPath),
    summary: {
      total: issues.length,
      fail: issues.filter(item => item.status === 'FAIL').length,
      noReply: issues.filter(item => item.status === 'NO_REPLY').length,
      skipped: issues.filter(item => item.status === 'SKIPPED').length
    },
    records: issues
  };
  fs.writeFileSync(issuesJsonPath, JSON.stringify(issuesPayload, null, 2), 'utf8');
  const issueCols = ['time', 'category', 'command', 'variant', 'status', 'match', 'validationMode', 'meaning', 'note', 'tx', 'rx'];
  const issueCsvLines = [issueCols.join(',')];
  for (const record of issues) {
    issueCsvLines.push(issueCols.map(col => sanitizeForCsv(AVAILABLE_COLUMNS[col](record))).join(','));
  }
  fs.writeFileSync(issuesCsvPath, issueCsvLines.join('\n'), 'utf8');

  const htmlHeaderCells = header.map(col => `<th>${col}</th>`).join('');
  const htmlRows = records
    .map(record => {
      const cells = header.map(col => `<td>${AVAILABLE_COLUMNS[col](record)}</td>`).join('');
      return `<tr class="${record.status}">${cells}</tr>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Device Certification Report</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; margin: 20px; color: #111827; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #D1D5DB; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #F3F4F6; }
    tr.PASS { background: #ECFDF5; }
    tr.FAIL { background: #FEF2F2; }
    tr.NO_REPLY { background: #FFF7ED; }
    tr.SKIPPED { background: #F9FAFB; color: #6B7280; }
    .meta { margin-bottom: 16px; padding: 10px 12px; border: 1px solid #D1D5DB; border-radius: 8px; background: #F9FAFB; }
  </style>
</head>
<body>
  <h1>Device Certification Report</h1>
  <div class="meta">
    <div><strong>Started:</strong> ${startedAt.toISOString()}</div>
    <div><strong>Finished:</strong> ${finishedAt.toISOString()}</div>
    <div><strong>Summary:</strong> PASS=${summary.pass}, FAIL=${summary.fail}, NO_REPLY=${summary.noReply}, SKIPPED=${summary.skipped}</div>
  </div>
  <table>
    <thead>
      <tr>${htmlHeaderCells}</tr>
    </thead>
    <tbody>
      ${htmlRows}
    </tbody>
  </table>
</body>
</html>`;
  fs.writeFileSync(htmlPath, html, 'utf8');

  return {
    jsonPath,
    csvPath,
    htmlPath,
    issuesJsonPath,
    issuesCsvPath
  };
}

function loadTruth(rootDir: string): TruthCommandRow[] {
  const truthPath = path.resolve(rootDir, 'data', 'commands.truth.json');
  if (!fs.existsSync(truthPath)) {
    throw new Error(`Missing truth file: ${truthPath}. Run: npm run build-truth`);
  }
  const parsed = JSON.parse(fs.readFileSync(truthPath, 'utf8')) as TruthFile;
  if (!Array.isArray(parsed.commands)) {
    throw new Error('Invalid truth file: commands array missing');
  }
  return parsed.commands;
}

function loadIssueRecords(rootDir: string, issuesFile: string): IssueRecord[] {
  const issuePath = path.isAbsolute(issuesFile) ? issuesFile : path.resolve(rootDir, issuesFile);
  if (!fs.existsSync(issuePath)) {
    throw new Error(`Issues file not found: ${issuePath}`);
  }

  const payload = JSON.parse(fs.readFileSync(issuePath, 'utf8')) as { records?: unknown };
  const recordsRaw = payload.records;
  if (!Array.isArray(recordsRaw)) {
    throw new Error(`Invalid issues file (records array missing): ${issuePath}`);
  }

  return recordsRaw as IssueRecord[];
}

function buildIssuesCases(
  rootDir: string,
  issuesFile: string,
  byKey: Map<string, TruthCommandRow>,
  bySetCode: Map<string, TruthCommandRow[]>,
  numericSpecs: Map<string, NumericSpec>
): CertifyCase[] {
  const issueRecords = loadIssueRecords(rootDir, issuesFile);
  const filtered = issueRecords.filter(record => {
    const status = (record.status ?? '').toUpperCase();
    const match = (record.matchType ?? '').toUpperCase();
    return ISSUE_STATUSES.has(status) || match === 'MISMATCH' || match.includes('NO_REPLY');
  });

  const cases: CertifyCase[] = [];
  const seen = new Set<string>();

  for (const record of filtered) {
    const key = record.commandKey ? String(record.commandKey) : '';
    const setCodeRaw = record.setCode ?? record.command ?? null;
    const setCode = normalizeCode(setCodeRaw);
    const value = record.value == null ? null : Number(record.value);
    const dedupeKey = `${key}|${setCode ?? ''}|${value == null ? '' : value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (setCode && numericSpecs.has(setCode) && value != null && Number.isFinite(value)) {
      const boundedValue = Math.max(0, Math.min(100, Math.round(value)));
      cases.push(buildGeneratedNumericCase(numericSpecs.get(setCode)!, boundedValue, 'generated'));
      continue;
    }

    if (key && byKey.has(key)) {
      cases.push(buildCaseFromTruthRow(byKey.get(key)!, 'truth'));
      continue;
    }

    if (setCode && bySetCode.has(setCode)) {
      const row = bySetCode.get(setCode)![0];
      cases.push(buildCaseFromTruthRow(row, 'truth'));
      continue;
    }

    console.warn(`WARNING: Could not map issue record to truth command: commandKey="${key}" setCode="${setCodeRaw ?? ''}"`);
  }

  const normalCases = cases.filter(item => !item.isPowerCommand);
  const powerCases = cases.filter(item => item.isPowerCommand);
  return [...normalCases, ...powerCases];
}

function verifyTruthChecksumCoverage(rows: TruthCommandRow[]): { checked: number; mismatches: number } {
  let checked = 0;
  let mismatches = 0;
  for (const row of rows) {
    const request = parseHexBytes(row.requestHex);
    if (!isUdpLike(request)) continue;
    checked += 1;
    const expected = computePdfChecksum(request);
    const actual = request[request.length - 1];
    if (expected !== actual) mismatches += 1;
  }
  return { checked, mismatches };
}

function logNumericSpecSummary(specs: Map<string, NumericSpec>): void {
  console.log('Numeric command map (manual value/checksum indices):');
  for (const setCode of NUMERIC_SET_CODES) {
    const spec = specs.get(setCode);
    if (!spec) {
      console.log(`  0x${setCode}: missing from truth`);
      continue;
    }
    console.log(
      `  0x${setCode}: valueIndex=${spec.valueIndex}, checksumIndex=${spec.checksumIndex}, baseRow=${spec.baseRow.rowNumber}`
    );
    console.log(`           baseRequest=${spec.baseRow.requestHex}`);
  }
}

function loadSuiteExclusions(rootDir: string, profile: ProfileName): Map<string, string> {
  const exclusions = new Map<string, string>();
  const profileFileByName: Record<ProfileName, string | null> = {
    'exview-aio': path.resolve(rootDir, 'engine', 'profiles', 'exview-aio.exclusions.json'),
    generic: null
  };
  const configPath = profileFileByName[profile];
  if (!configPath) return exclusions;
  if (!fs.existsSync(configPath)) return exclusions;

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as SuiteExclusionFile;
    if (!Array.isArray(parsed.excludeFromSuite)) return exclusions;
    for (const item of parsed.excludeFromSuite) {
      const code = normalizeCode(item.code);
      if (!code) continue;
      const reason = String(item.reason ?? '').trim();
      if (!reason) continue;
      exclusions.set(code, reason);
    }
  } catch (error) {
    console.warn(`WARNING: Failed to load suite exclusions from ${configPath}: ${String(error)}`);
  }

  return exclusions;
}

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, '..', '..');
  const rows = loadTruth(rootDir);
  const suiteExclusions = options.mode === 'suite' ? loadSuiteExclusions(rootDir, options.profile) : new Map<string, string>();

  const byKey = new Map<string, TruthCommandRow>();
  const bySetCode = new Map<string, TruthCommandRow[]>();
  for (const row of rows) {
    byKey.set(row.commandKey, row);
    const setCode = normalizeCode(row.setCommandCode);
    if (!setCode) continue;
    const existing = bySetCode.get(setCode) ?? [];
    existing.push(row);
    bySetCode.set(setCode, existing);
  }

  const checksumCoverage = verifyTruthChecksumCoverage(rows);
  console.log(
    `Checksum self-check (PDF rule bytes 9..len-2): checked=${checksumCoverage.checked}, mismatches=${checksumCoverage.mismatches}`
  );
  if (checksumCoverage.mismatches > 0) {
    console.warn('WARNING: Some truth request packets do not satisfy the PDF checksum rule.');
  }

  const numericSpecs = deriveNumericSpecs(bySetCode);
  logNumericSpecSummary(numericSpecs);

  let runCases: CertifyCase[] = [];
  if (options.mode === 'suite') {
    runCases = buildSuiteCases(rows, numericSpecs);
  } else if (options.mode === 'single') {
    runCases = [buildSingleCase(byKey, bySetCode, numericSpecs, options.singleSelector!, options.value)];
  } else if (options.mode === 'issues') {
    runCases = buildIssuesCases(rootDir, options.issuesFile!, byKey, bySetCode, numericSpecs);
  } else {
    runCases = buildSanityCases(bySetCode, numericSpecs);
  }

  if (options.mode === 'suite' && suiteExclusions.size > 0) {
    const list = [...suiteExclusions.entries()].map(([code, reason]) => `0x${code} (${reason})`).join(', ');
    console.log(`Suite exclusions for profile "${options.profile}": ${list}`);
  }

  const powerExcluded = runCases.filter(item => item.isPowerCommand).length;
  if ((options.mode === 'suite' || options.mode === 'issues') && !options.includePower && powerExcluded > 0) {
    console.log(`Power stage excluded by default: ${powerExcluded} case(s) skipped. Use --include-power to run them.`);
  }

  const socket = dgram.createSocket('udp4');
  const bindInfo = await bindSocket(socket, options.localPort);
  console.log(`Bound UDP local endpoint: ${bindInfo.address}:${bindInfo.port}`);
  console.log(`Remote UDP target: ${options.targetHost}:${options.targetPort}`);
  console.log(`Profile: ${options.profile}`);

  const startedAt = new Date();
  const records: CertifyRecord[] = [];

  const rateIntervalMs = Math.max(1, Math.round(1000 / options.rate));
  let nextDelayMs = 0;
  let processed = 0;

  try {
    for (const caseItem of runCases) {
      if (nextDelayMs > 0) {
        await sleep(nextDelayMs);
      }

      if (caseItem.isPowerCommand && (options.mode === 'suite' || options.mode === 'issues') && !options.includePower) {
        records.push(buildSkippedRecord(caseItem, 'Power stage excluded (add --include-power)'));
        processed += 1;
        console.log(makeProgressLine(processed, runCases.length, records[records.length - 1]));
        nextDelayMs = 0;
        continue;
      }

      if (caseItem.serialOnly) {
        records.push(buildSkippedRecord(caseItem, 'Serial-only or non-UDP request frame'));
        processed += 1;
        console.log(makeProgressLine(processed, runCases.length, records[records.length - 1]));
        nextDelayMs = 0;
        continue;
      }

      if (options.mode === 'suite') {
        const setCode = normalizeCode(caseItem.setCode);
        const exclusionReason = setCode ? suiteExclusions.get(setCode) : undefined;
        if (exclusionReason) {
          records.push(buildSkippedRecord(caseItem, exclusionReason));
          processed += 1;
          console.log(`[SKIP] ${caseItem.setCode ?? caseItem.commandKey} ${caseItem.description} reason="${exclusionReason}"`);
          console.log(makeProgressLine(processed, runCases.length, records[records.length - 1]));
          nextDelayMs = 0;
          continue;
        }
      }

      const disruptivePromptMode =
        options.promptEach && (options.mode === 'suite' || options.mode === 'issues') && options.includePower;

      const promptEveryCommand = options.promptEach && !disruptivePromptMode;
      const promptDisruptiveOnly = disruptivePromptMode && caseItem.isPowerCommand && caseItem.isDisruptiveCommand;

      if (promptEveryCommand) {
        await waitForEnter(`Ready to run ${caseItem.commandKey}. Set screen/device state as needed, then press Enter.`);
      }

      if (promptDisruptiveOnly) {
        await waitForEnter(`Manual stage: press Enter to execute disruptive command ${caseItem.commandKey}`);
      }

      const record = await executeCase(socket, caseItem, options, bySetCode);
      records.push(record);
      processed += 1;
      if (record.status === 'SKIPPED' && record.skipReason) {
        console.log(`[SKIP] ${record.command} ${record.variant} reason="${record.skipReason}"`);
      }
      console.log(makeProgressLine(processed, runCases.length, record));

      nextDelayMs = rateIntervalMs;
      if (caseItem.isModeChangeCommand) {
        nextDelayMs = Math.max(nextDelayMs, options.settleModeMs);
      } else if (caseItem.isSetCommand) {
        nextDelayMs = Math.max(nextDelayMs, options.settleSetMs);
      }
    }
  } finally {
    socket.close();
  }

  const finishedAt = new Date();
  const artifacts = writeArtifacts(rootDir, options, startedAt, finishedAt, records);
  const summary = buildSummary(records);

  console.log('');
  console.log(
    `Completed ${records.length} case(s): PASS=${summary.pass} FAIL=${summary.fail} NO_REPLY=${summary.noReply} SKIPPED=${summary.skipped}`
  );
  console.log(`JSON: ${artifacts.jsonPath}`);
  console.log(`CSV: ${artifacts.csvPath}`);
  console.log(`HTML: ${artifacts.htmlPath}`);
  console.log(`ISSUES JSON: ${artifacts.issuesJsonPath}`);
  console.log(`ISSUES CSV: ${artifacts.issuesCsvPath}`);

  if (records.length === 1) {
    const record = records[0];
    if (record.meaning) {
      console.log(`Meaning: ${record.meaning}`);
    }
    if (record.parsed) {
      console.log(`Parsed: ${JSON.stringify(record.parsed)}`);
    }
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
