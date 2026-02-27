import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const truthPath = path.resolve(repoRoot, 'packages', 'protocol', 'truth', 'commands.truth.json');
const exclusionsPath = path.resolve(repoRoot, 'packages', 'engine', 'profiles', 'exview-aio.exclusions.json');
const docsDir = path.resolve(repoRoot, 'docs');

function normalizeCode(input) {
  const text = String(input ?? '')
    .replace(/^0x/i, '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase();
  if (!text) return null;
  return text.padStart(4, '0');
}

function toCode(input) {
  const normalized = normalizeCode(input);
  return normalized ? `0x${normalized}` : null;
}

function codeSortValue(input) {
  const normalized = normalizeCode(input);
  return normalized ? parseInt(normalized, 16) : Number.MAX_SAFE_INTEGER;
}

function shortTitleFromCategory(category) {
  const text = String(category ?? '').trim();
  if (!text) return 'Command';
  return text
    .replace(/^Set\s+/i, '')
    .replace(/^Query\s+/i, '')
    .replace(/^Get\s+/i, '')
    .trim();
}

function loadExclusionsMap() {
  const map = new Map();
  if (!fs.existsSync(exclusionsPath)) return map;

  try {
    const raw = JSON.parse(fs.readFileSync(exclusionsPath, 'utf8'));
    const entries = Array.isArray(raw.excludeFromSuite) ? raw.excludeFromSuite : [];
    for (const entry of entries) {
      const code = normalizeCode(entry.code);
      const reason = String(entry.reason ?? '').trim();
      if (!code || !reason) continue;
      map.set(code, reason);
    }
  } catch (_error) {
    return map;
  }

  return map;
}

function loadCommands() {
  const raw = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
  const source = Array.isArray(raw.commands) ? raw.commands : Array.isArray(raw.records) ? raw.records : [];
  const exclusions = loadExclusionsMap();
  const byCode = new Map();

  for (const row of source) {
    const commandCode = toCode(row.command ?? row.setCode ?? row.setCommandCode ?? row.commandCode);
    if (!commandCode) continue;
    const normalizedCode = normalizeCode(commandCode);
    const selector = String(row.commandKey ?? commandCode).trim() || commandCode;
    const category = String(row.category ?? '').trim() || 'Other';
    const variant = String(row.variant ?? row.description ?? row.remark ?? '').trim();
    const replyCode = toCode(row.replyCode ?? row.replyCommandCode);
    const validationMode = row.validationMode ? String(row.validationMode) : null;
    const meaning = String(row.meaning ?? '').trim();
    const note = String(row.note ?? '').trim();
    const skipReason = String(row.skipReason ?? '').trim();
    const status = String(row.status ?? '').trim().toUpperCase();

    if (!byCode.has(commandCode)) {
      byCode.set(commandCode, {
        commandCode,
        category,
        shortTitle: shortTitleFromCategory(category),
        title: `${commandCode} ${shortTitleFromCategory(category)}`.trim(),
        description: variant || selector,
        defaultSelector: selector,
        replyCode,
        validationMode,
        expectedBehavior: meaning || note || null,
        variants: [],
        variantCount: 0,
        hasKnownSkip: false,
        excludedInSuite: normalizedCode ? exclusions.has(normalizedCode) : false,
        exclusionReason: normalizedCode ? exclusions.get(normalizedCode) ?? null : null
      });
    }

    const item = byCode.get(commandCode);
    if (!item._variantSeen) item._variantSeen = new Set();
    const variantKey = `${selector}::${variant}`;
    if (!item._variantSeen.has(variantKey)) {
      item._variantSeen.add(variantKey);
      item.variants.push({
        selector,
        label: variant || selector,
        replyCode,
        validationMode
      });
    }

    if (!item.replyCode && replyCode) item.replyCode = replyCode;
    if (!item.validationMode && validationMode) item.validationMode = validationMode;
    if (!item.expectedBehavior && (meaning || note)) item.expectedBehavior = meaning || note;
    if (!item.description && variant) item.description = variant;
    if ((status === 'SKIPPED' && skipReason) || skipReason) item.hasKnownSkip = true;
  }

  const commands = [];
  for (const item of byCode.values()) {
    item.variants.sort((a, b) => a.label.localeCompare(b.label));
    item.variantCount = item.variants.length;
    item.defaultVariant = item.variants[0]?.label ?? null;
    delete item._variantSeen;
    commands.push(item);
  }

  commands.sort((a, b) => codeSortValue(a.commandCode) - codeSortValue(b.commandCode));
  return commands;
}

function findCommand(commands, codeOrSelector) {
  const normalized = toCode(codeOrSelector);
  if (normalized) {
    const byCode = commands.find(item => item.commandCode === normalized);
    if (byCode) return byCode;
  }
  return commands.find(item => item.defaultSelector === codeOrSelector) ?? null;
}

function runCertifySingle(ip, commandSelector, value) {
  return new Promise((resolve, reject) => {
    const localPort = 10000 + Math.floor(Math.random() * 50000);
    const certifyArgs = [
      'run',
      'certify',
      '--prefix',
      'apps/cli',
      '--',
      '--single',
      commandSelector,
      '--target',
      `${ip}:8600`,
      '--local-port',
      String(localPort),
      '--timeout',
      '1200',
      '--rate',
      '1',
      '--settle-set',
      '300',
      '--settle-mode',
      '900',
      '--profile',
      'exview-aio'
    ];

    if (typeof value === 'number' && Number.isFinite(value)) {
      certifyArgs.push('--value', String(Math.round(value)));
    }

    const isWindows = process.platform === 'win32';
    const child = spawn(
      isWindows ? process.env.ComSpec || 'cmd.exe' : 'npm',
      isWindows ? ['/d', '/s', '/c', 'npm', ...certifyArgs] : certifyArgs,
      {
        cwd: repoRoot,
        windowsHide: true
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function extractJsonPath(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('JSON: ')) {
      return line.slice('JSON: '.length).trim();
    }
  }
  return null;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use('/docs', express.static(docsDir));

app.get('/api/commands', (_req, res) => {
  try {
    const commands = loadCommands();
    res.json({ commands });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/command/:code', (req, res) => {
  try {
    const commands = loadCommands();
    const code = decodeURIComponent(req.params.code);
    const command = findCommand(commands, code);
    if (!command) {
      return res.status(404).json({ error: `Command not found: ${code}` });
    }
    return res.json({ command });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

app.post('/api/send', async (req, res) => {
  const ip = String(req.body?.ip ?? '').trim();
  const commandCode = String(req.body?.commandCode ?? '').trim();
  const valueRaw = req.body?.value;

  if (!net.isIP(ip)) {
    return res.status(400).json({ error: 'Invalid ip' });
  }
  if (!commandCode) {
    return res.status(400).json({ error: 'commandCode is required' });
  }

  let value;
  if (valueRaw != null) {
    const numeric = Number(valueRaw);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
      return res.status(400).json({ error: 'value must be a number in range 0..100' });
    }
    value = Math.round(numeric);
  }

  try {
    const run = await runCertifySingle(ip, commandCode, value);
    if (run.code !== 0) {
      return res.status(500).json({
        error: 'Certification run failed',
        details: run.stderr || run.stdout
      });
    }

    const jsonFile = extractJsonPath(run.stdout);
    if (!jsonFile || !fs.existsSync(jsonFile)) {
      return res.status(500).json({
        error: 'Result artifact not found',
        details: run.stdout
      });
    }

    const payload = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const record = Array.isArray(payload.records) && payload.records.length > 0 ? payload.records[0] : null;
    if (!record) {
      return res.status(500).json({ error: 'No record returned by engine' });
    }

    return res.json({
      commandCode: record.command ?? record.setCode ?? null,
      commandKey: record.commandKey ?? null,
      status: record.status ?? null,
      match: record.matchType ?? null,
      validationMode: record.validationMode ?? null,
      meaning: record.meaning ?? null,
      latencyMs: record.latencyMs ?? null,
      parsed: record.parsed ?? null,
      txHex: record.txHex ?? null,
      rxHex: record.rxHex ?? null,
      note: record.note ?? null,
      skipReason: record.skipReason ?? null,
      raw: record
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
