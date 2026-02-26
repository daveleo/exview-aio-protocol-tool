import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type TruthRecord = {
  commandKey?: string;
  category?: string;
  variant?: string;
  txHex?: string;
  rxHex?: string;
  expectedHex?: string;
  setCode?: string;
  replyCode?: string;
  command?: string;
  meaning?: string;
  transportStatus?: string;
};

function asText(value: unknown): string {
  return String(value ?? '').trim();
}

function buildCommandRows(records: TruthRecord[]) {
  return records
    .filter(record => asText(record.txHex).length > 0)
    .map((record, index) => {
      const commandCode = asText(record.command);
      const variant = asText(record.variant);
      const fallbackKey = commandCode && variant ? `${commandCode}:${variant}` : commandCode || `row-${index + 1}`;
      const replyHex = asText(record.expectedHex) || asText(record.rxHex);

      return {
        rowNumber: index + 1,
        commandKey: asText(record.commandKey) || fallbackKey,
        category: asText(record.category),
        description: variant,
        requestHex: asText(record.txHex),
        replyHex: replyHex || null,
        setCommandCode: asText(record.setCode) || commandCode || null,
        replyCommandCode: asText(record.replyCode) || null,
        instruction: '',
        remark: asText(record.meaning),
        transport: asText(record.transportStatus) || undefined
      };
    });
}

function ensureEngineTruthFile(repoRoot: string): void {
  const protocolTruthPath = path.resolve(repoRoot, 'packages', 'protocol', 'truth', 'commands.truth.json');
  const engineTruthPath = path.resolve(repoRoot, 'packages', 'data', 'commands.truth.json');
  if (!fs.existsSync(protocolTruthPath)) return;

  const payload = JSON.parse(fs.readFileSync(protocolTruthPath, 'utf8')) as {
    commands?: unknown;
    records?: TruthRecord[];
  };

  let output: { commands: unknown[] } | null = null;
  if (Array.isArray(payload.commands)) {
    output = { commands: payload.commands };
  } else if (Array.isArray(payload.records)) {
    output = { commands: buildCommandRows(payload.records) };
  }
  if (!output) return;

  fs.mkdirSync(path.dirname(engineTruthPath), { recursive: true });
  fs.writeFileSync(engineTruthPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
ensureEngineTruthFile(repoRoot);

await import(pathToFileURL(path.resolve(repoRoot, 'packages', 'engine', 'src', 'device-certify.ts')).href);
