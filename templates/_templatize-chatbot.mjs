#!/usr/bin/env node
// Convierte un export de n8n del chatbot en un TEMPLATE parametrizado con tokens {{ORA_*}}.
// Saca el PIT y los IDs hardcodeados, extrae el prompt a un archivo, y valida que el
// resultado siga siendo JSON válido y que inyecte limpio.
//
//   node templates/_templatize-chatbot.mjs "<ruta al export.json>" [--out templates/chatbot.template.json]
//
// Diseñado para el export "Chatbot Primedental". Si los IDs cambian, ajustá MAP abajo.

import { readFile, writeFile } from 'node:fs/promises';
import { injectTokens, sanitizeWorkflow } from '../provision/lib/template.mjs';

const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith('--'));
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : 'templates/chatbot.template.json';
const promptOut = 'prompts/primedental.txt';

if (!src) {
  console.error('Uso: node templates/_templatize-chatbot.mjs "<export.json>" [--out <ruta>]');
  process.exit(1);
}

// Reemplazos literal → token (los IDs son únicos, así que el string-replace es seguro).
const MAP = {
  S8Ucyhjg3WCPn1nfFBTS: '{{ORA_LOCATION_ID}}',
  HOu6MLCtyRHFV3egUmXK: '{{ORA_LOCATION_ID}}', // unifica el 2º locationId (bug #1)
  Wss5UyH8YZpdMTgl60tP: '{{ORA_CAL_CDMX}}',
  SQGC53TXesIU6diRfTqD: '{{ORA_CAL_CDMX_AVAIL}}',
  CcF9n3GCjyhldRMyecou: '{{ORA_CAL_QUERETARO}}',
  '2oNeOjoF7eVb8H0ipTtW': '{{ORA_CAL_VIRTUAL}}',
  'https://services.leadconnectorhq.com/hooks/ExtFmRLxMpnunKQuDAVi/webhook-trigger/c710a078-41ee-4c58-a787-f89ed68bfef2':
    '{{ORA_GHL_CALL_HOOK_URL}}',
  '652416827': '{{ORA_SIMPLETALK_CLIENT_ID}}',
  '+14125286474': '{{ORA_FROM_NUMBER}}',
  ePr9XrrvmqiK2P0J: '{{ORA_OPENAI_CRED_ID}}', // id de credencial OpenAI del export (stale) → token
};

const wf = JSON.parse(await readFile(src, 'utf8'));

// 1) PIT: detectar el token real y mapearlo (no lo dejamos en el template).
const rawSrc = JSON.stringify(wf);
const pitMatch = rawSrc.match(/pit-[A-Za-z0-9-]+/);
if (pitMatch) MAP[pitMatch[0]] = '{{ORA_PIT}}';

// 2) Estructural: webhook path/id y prompt del agente.
let extractedPrompt = null;
for (const n of wf.nodes || []) {
  if (n.type.endsWith('.webhook')) {
    n.parameters = n.parameters || {};
    n.parameters.path = '{{ORA_WEBHOOK_PATH}}';
    n.webhookId = '{{ORA_WEBHOOK_ID}}';
  }
  if (n.type.endsWith('langchain.agent')) {
    n.parameters = n.parameters || {};
    n.parameters.options = n.parameters.options || {};
    const cur = n.parameters.options.systemMessage ?? n.parameters.systemMessage;
    if (cur) {
      extractedPrompt = String(cur).replace(/^=/, ''); // quitar prefijo de expresión n8n
      if ('systemMessage' in n.parameters.options) n.parameters.options.systemMessage = '{{ORA_PROMPT}}';
      else n.parameters.systemMessage = '{{ORA_PROMPT}}';
    }
  }
}

// 3) String-replace de los IDs/valores hardcodeados.
let text = JSON.stringify(wf, null, 2);
const found = [];
for (const [literal, token] of Object.entries(MAP)) {
  if (text.includes(literal)) { found.push(token); text = text.split(literal).join(token); }
}

// 4) Validaciones.
JSON.parse(text); // el template (con placeholders) debe ser JSON válido

const tokensInTemplate = [...new Set(text.match(/\{\{ORA_[A-Z0-9_]+\}\}/g) || [])].sort();
// Simular inyección con valores dummy para confirmar que sale JSON válido.
const dummy = Object.fromEntries(tokensInTemplate.map((t) => {
  const name = t.slice(2, -2);
  return [name, name === 'ORA_PROMPT' ? 'Sos un asistente.\nLínea con "comillas".' : `dummy_${name}`];
}));
const injected = injectTokens(text, dummy);
const wf2 = JSON.parse(injected);
sanitizeWorkflow(wf2, 'Chatbot - test'); // no debe tirar

// 5) Escribir salidas.
await writeFile(out, text + '\n');
if (extractedPrompt) await writeFile(promptOut, extractedPrompt + '\n');

console.log('✅ Template generado:', out);
console.log('   Prompt extraído a:', promptOut, extractedPrompt ? `(${extractedPrompt.length} chars)` : '(no encontrado)');
console.log('\n== Tokens en el template (para la config del cliente) ==');
for (const t of tokensInTemplate) console.log('  ', t);
console.log('\n== Reemplazos aplicados ==', found.length, 'de', Object.keys(MAP).length);
console.log('✓ El template inyecta a JSON válido y pasa sanitizeWorkflow.');
