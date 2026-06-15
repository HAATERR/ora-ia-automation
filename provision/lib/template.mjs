// Utilidades: carga de .env, resolución de valores @archivo, inyección de tokens
// {{ORA_*}} en templates de workflow y sanitización antes de POST a n8n.

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

// ── .env mínimo (sin dependencias) ──────────────────────────────
export function loadEnv(path = '.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// Valor con prefijo '@' → se lee del archivo (ej. "@secrets/acme.pit").
export async function resolveValue(v) {
  if (typeof v === 'string' && v.startsWith('@')) {
    return (await readFile(v.slice(1), 'utf8')).trim();
  }
  return v;
}

// Inyecta tokens {{ORA_X}} en el texto del template.
// Regla universal: cada placeholder vive dentro de un string JSON del template,
// así que el valor se inserta escapado para contexto de string JSON. Para objetos
// se hace JSON.stringify primero (queda como objeto JS válido al des-escapar n8n).
export function injectTokens(text, tokens) {
  let out = text;
  for (const [key, raw] of Object.entries(tokens)) {
    const asString = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const escaped = JSON.stringify(asString).slice(1, -1); // escapa para string JSON
    out = out.split(`{{${key}}}`).join(escaped);
  }
  const leftover = out.match(/\{\{ORA_[A-Z0-9_]+\}\}/g);
  if (leftover) {
    throw new Error(`Placeholders sin resolver: ${[...new Set(leftover)].join(', ')}`);
  }
  return out;
}

// n8n Public API: POST /workflows acepta solo name/nodes/connections/settings.
// El resto (id, active, createdAt, tags, ...) es readOnly → hay que quitarlo.
const SETTINGS_ALLOWED = [
  'executionOrder', 'saveExecutionProgress', 'saveManualExecutions',
  'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout',
  'timezone', 'errorWorkflow', 'callerPolicy', 'callerIds',
];

export function sanitizeWorkflow(wf, name) {
  const out = {
    name: name || wf.name || 'Workflow',
    nodes: wf.nodes || [],
    connections: wf.connections || {},
    settings: { executionOrder: 'v1', ...(wf.settings || {}) },
  };
  out.settings = Object.fromEntries(
    Object.entries(out.settings).filter(([k]) => SETTINGS_ALLOWED.includes(k)),
  );
  return out;
}
