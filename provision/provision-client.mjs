#!/usr/bin/env node
// Motor de alta de un cliente Ora IA.
//   node provision/provision-client.mjs config/clients/<cliente>.client.json [--dry-run]
//
// Pasos: valida PIT → crea credencial en n8n → clona templates → activa → reporte.

import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ghlClient } from './lib/ghl.mjs';
import { n8nClient } from './lib/n8n.mjs';
import { loadEnv, resolveValue, injectTokens, sanitizeWorkflow } from './lib/template.mjs';

loadEnv();

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const configPath = argv.find((a) => !a.startsWith('--'));

if (!configPath) {
  console.error('Uso: node provision/provision-client.mjs config/clients/<cliente>.client.json [--dry-run]');
  process.exit(1);
}

const GHL_BASE_URL = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
const GHL_VERSION = process.env.GHL_API_VERSION || '2021-07-28';

const log = (step, msg) => console.log(`  [${step}] ${msg}`);

async function main() {
  const client = JSON.parse(await readFile(configPath, 'utf8'));
  const pit = await resolveValue(client.ghlPrivateToken);
  console.log(`\n▶ Provisioning "${client.clientName}" (location ${client.locationId})${dryRun ? '  [DRY RUN]' : ''}\n`);

  // ── 1. Validar PIT y leer pipelines ───────────────────────────
  const ghl = ghlClient({ token: pit, baseUrl: GHL_BASE_URL, version: GHL_VERSION });
  log('1/5', 'Validando PIT contra GHL y leyendo pipelines…');
  const res = await ghl.listPipelines(client.locationId);
  const pipelines = res.pipelines || res || [];
  log('1/5', `OK — ${pipelines.length} pipeline(s):`);
  for (const p of pipelines) {
    console.log(`        • ${p.name}  (${p.id})`);
    for (const s of p.stages || []) console.log(`            - ${s.name}  →  ${s.id}`);
  }

  if (dryRun) {
    // Listar custom fields y custom values → para los tokens ORA_CF_* del cableado.
    try {
      const cf = await ghl.req('GET', `/locations/${client.locationId}/customFields`);
      const fields = cf.customFields || cf || [];
      console.log(`\n  Custom fields (${fields.length}):`);
      for (const f of fields) console.log(`        ${f.name}  →  ${f.id}`);
    } catch (e) { console.log('  (no pude listar custom fields:', e.message.slice(0, 60), ')'); }
    try {
      const cv = await ghl.req('GET', `/locations/${client.locationId}/customValues`);
      const vals = cv.customValues || cv || [];
      console.log(`\n  Custom values (${vals.length}):`);
      for (const v of vals) console.log(`        ${v.name}  →  ${v.id}`);
    } catch {}
    console.log('\n(DRY RUN) PIT válido. Copiá los IDs de arriba a la config del cliente. No se creó nada en n8n.\n');
    return;
  }

  const n8n = n8nClient({ baseUrl: process.env.N8N_BASE_URL, apiKey: process.env.N8N_API_KEY });

  // Pre-leer templates (para saber si alguno necesita credencial Custom Auth).
  const templates = [];
  for (const tpl of client.templates || []) {
    templates.push({ ...tpl, raw: await readFile(tpl.file, 'utf8') });
  }
  const needsCredential = templates.some((t) => t.raw.includes('{{ORA_CRED_ID}}'));

  // ── 2. Credencial Custom Auth (solo si algún template la usa) ──
  let cred = null;
  const credName = client.credentialName || `GHL - ${client.clientName}`;
  if (needsCredential) {
    log('2/5', `Creando credencial Custom Auth "${credName}"…`);
    cred = await n8n.createCredential(credName, 'httpCustomAuth', {
      json: JSON.stringify({ headers: { Authorization: `Bearer ${pit}`, Version: GHL_VERSION } }),
    });
    log('2/5', `Credencial creada: ${cred.id}`);
  } else {
    log('2/5', 'Sin credencial Custom Auth — los templates usan {{ORA_PIT}} directo.');
  }

  // URLs de webhook de cada flow (para el enrollment entre flows): ORA_WEBHOOK_<FLOW>.
  const n8nBase = (process.env.N8N_BASE_URL || '').replace(/\/$/, '');
  const flowWebhooks = {};
  for (const t of templates) {
    const wp = t.tokens && t.tokens.ORA_WEBHOOK_PATH;
    if (!wp) continue;
    const key = (t.file.split(/[\\/]/).pop() || '').replace(/\.template\.json$/, '').toUpperCase();
    if (key) flowWebhooks[`ORA_WEBHOOK_${key}`] = `${n8nBase}/webhook/${wp}`;
  }

  // Tokens automáticos disponibles para todos los templates.
  const autoTokens = {
    ORA_PIT: pit,
    ...flowWebhooks,
    ORA_CRED_ID: cred ? cred.id : '',
    ORA_CRED_NAME: credName,
    ORA_LOCATION_ID: client.locationId,
    ORA_GHL_BASE: GHL_BASE_URL,
    ORA_GHL_VERSION: GHL_VERSION,
    ORA_OUTCOME_MAP: client.outcomeMap || {},
  };

  // ── 3-4. Clonar templates → inyectar → crear → activar ────────
  const createdWorkflows = [];
  for (const tpl of templates) {
    log('3/5', `Template "${tpl.name}" ← ${tpl.file}`);

    const tokens = { ...autoTokens, ORA_WEBHOOK_ID: randomUUID() };
    for (const [k, v] of Object.entries(tpl.tokens || {})) tokens[k] = await resolveValue(v);

    const injected = injectTokens(tpl.raw, tokens);
    const workflow = sanitizeWorkflow(JSON.parse(injected), tpl.name);

    const created = await n8n.createWorkflow(workflow);
    log('3/5', `Workflow creado: ${created.id}`);
    if (tpl.activate) {
      await n8n.activateWorkflow(created.id);
      log('4/5', `Activado: ${created.id}`);
    }
    // URL del webhook (para pegar en GHL).
    const webhookPath = tokens.ORA_WEBHOOK_PATH;
    const webhookUrl = webhookPath
      ? `${process.env.N8N_BASE_URL.replace(/\/$/, '')}/webhook/${webhookPath}`
      : null;
    if (webhookUrl) log('4/5', `↪ Webhook para pegar en GHL: ${webhookUrl}`);
    createdWorkflows.push({ name: tpl.name, id: created.id, activated: !!tpl.activate, webhookUrl });
  }

  // ── 5. Reporte ────────────────────────────────────────────────
  const report = {
    clientName: client.clientName,
    locationId: client.locationId,
    credentialId: cred ? cred.id : null,
    workflows: createdWorkflows,
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })),
    })),
  };
  const outPath = configPath.replace(/\.client\.json$/, '').replace(/\.json$/, '') + '.provisioned.json';
  await writeFile(outPath, JSON.stringify(report, null, 2));
  log('5/5', `Reporte: ${outPath}`);
  console.log('\n✅ Provisioning completo.\n');
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
