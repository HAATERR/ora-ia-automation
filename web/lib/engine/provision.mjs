// Motor de alta (puro, stateless): toma los workflows YA COMPILADOS (objetos de
// compileFlowSpec) + la config del formulario, y los crea en n8n. Portado de
// provision/provision-client.mjs SIN leer config/templates de disco ni escribir reporte.
//
//   provisionToN8n({ n8n, ghl, clientName, flows }) -> reporte
//   ghlInfo({ pit, locationId }) -> { pipelines, customFields, customValues }  (para los dropdowns)

import { randomUUID } from 'node:crypto';
import { ghlClient } from './ghl.mjs';
import { n8nClient } from './n8n.mjs';
import { injectTokens, sanitizeWorkflow } from './template.mjs';

const GHL_DEFAULT_BASE = 'https://services.leadconnectorhq.com';
const GHL_DEFAULT_VERSION = '2021-07-28';

// Lee pipelines + custom fields + custom values de una subcuenta (lo que el --dry-run del
// CLI imprimía). La UI lo usa para poblar los dropdowns de IDs (stages/custom fields).
export async function ghlInfo({ pit, locationId, baseUrl = GHL_DEFAULT_BASE, version = GHL_DEFAULT_VERSION }) {
  if (!pit) throw new Error('ghlInfo: falta el Private Integration Token (PIT).');
  if (!locationId) throw new Error('ghlInfo: falta el locationId.');
  const ghl = ghlClient({ token: pit, baseUrl, version });

  const res = await ghl.listPipelines(locationId); // valida el PIT de paso
  const pipelines = (res.pipelines || res || []).map((p) => ({
    id: p.id,
    name: p.name,
    stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })),
  }));

  let customFields = [];
  try {
    const cf = await ghl.req('GET', `/locations/${locationId}/customFields`);
    customFields = (cf.customFields || cf || []).map((f) => ({ id: f.id, name: f.name }));
  } catch { /* algunos PIT no tienen scope de custom fields; no es fatal */ }

  let customValues = [];
  try {
    const cv = await ghl.req('GET', `/locations/${locationId}/customValues`);
    customValues = (cv.customValues || cv || []).map((v) => ({ id: v.id, name: v.name }));
  } catch { /* idem */ }

  return { pipelines, customFields, customValues };
}

// provisionToN8n: crea los workflows del cliente en n8n.
//   n8n:   { baseUrl, apiKey }                         ← de process.env (en la ruta)
//   ghl:   { pit, locationId, baseUrl?, version? }     ← pit/locationId del formulario
//   clientName, credentialName?, outcomeMap?
//   flows: [{ flowName, name, activate, tokens, workflow }]
//     flowName: 'analisis_postllamada' | 'seguimientos' | 'cita_agendada' (clave del enrollment)
//     name:     nombre visible del workflow en n8n
//     activate: bool
//     tokens:   map de tokens del formulario (ORA_WEBHOOK_PATH, ORA_PIPELINE_ID, ORA_STAGE_*, ...)
//     workflow: objeto compilado por compileFlowSpec
export async function provisionToN8n({ n8n, ghl, clientName, credentialName, outcomeMap, flows }) {
  if (!n8n || !n8n.baseUrl || !n8n.apiKey) throw new Error('provisionToN8n: faltan N8N_BASE_URL / N8N_API_KEY.');
  if (!ghl || !ghl.pit) throw new Error('provisionToN8n: falta el PIT de GHL.');
  if (!ghl.locationId) throw new Error('provisionToN8n: falta el locationId.');
  if (!Array.isArray(flows) || flows.length === 0) throw new Error('provisionToN8n: no hay flows para provisionar.');

  const ghlBase = ghl.baseUrl || GHL_DEFAULT_BASE;
  const ghlVersion = ghl.version || GHL_DEFAULT_VERSION;

  // ── 1. Validar PIT y leer pipelines ───────────────────────────
  const ghlApi = ghlClient({ token: ghl.pit, baseUrl: ghlBase, version: ghlVersion });
  const pres = await ghlApi.listPipelines(ghl.locationId);
  const pipelines = pres.pipelines || pres || [];

  const n8nApi = n8nClient({ baseUrl: n8n.baseUrl, apiKey: n8n.apiKey });

  // Texto crudo de cada workflow (para detectar tokens y para inyectar).
  const rawByFlow = new Map(flows.map((f) => [f, JSON.stringify(f.workflow)]));
  // Los 3 flows del cableado (compileFlowSpec) inyectan el PIT inline en el header GHL
  // (`Bearer {{ORA_PIT}}`), NO usan {{ORA_CRED_ID}} → para ellos no se crea credencial
  // (el PIT queda en el JSON del workflow en n8n, igual que en el CLI). La credencial
  // Custom Auth solo se crea si un template la referencia (ej. el chatbot, a futuro).
  const needsCredential = [...rawByFlow.values()].some((raw) => raw.includes('{{ORA_CRED_ID}}'));

  // ── 2. Credencial Custom Auth (solo si algún workflow la usa) ──
  let cred = null;
  const credName = credentialName || `GHL - ${clientName || ghl.locationId}`;
  if (needsCredential) {
    cred = await n8nApi.createCredential(credName, 'httpCustomAuth', {
      json: JSON.stringify({ headers: { Authorization: `Bearer ${ghl.pit}`, Version: ghlVersion } }),
    });
  }

  // Normaliza el webhook path (sin slash inicial ni espacios): se usa en el nodo webhook,
  // en la URL del reporte y en las URLs de enrollment → así nunca divergen.
  const cleanPath = (p) => String(p || '').trim().replace(/^\/+/, '');

  // URLs de webhook de cada flow (para el enrollment entre flows): ORA_WEBHOOK_<FLOW>.
  const n8nBase = n8n.baseUrl.replace(/\/$/, '');
  const flowWebhooks = {};
  for (const f of flows) {
    const wp = cleanPath(f.tokens && f.tokens.ORA_WEBHOOK_PATH);
    if (!wp || !f.flowName) continue;
    flowWebhooks[`ORA_WEBHOOK_${String(f.flowName).toUpperCase()}`] = `${n8nBase}/webhook/${wp}`;
  }

  // Tokens automáticos disponibles para todos los workflows.
  const autoTokens = {
    ORA_PIT: ghl.pit,
    ...flowWebhooks,
    ORA_CRED_ID: cred ? cred.id : '',
    ORA_CRED_NAME: credName,
    ORA_LOCATION_ID: ghl.locationId,
    ORA_GHL_BASE: ghlBase,
    ORA_GHL_VERSION: ghlVersion,
    ORA_OUTCOME_MAP: outcomeMap || {},
  };

  // ── 3. Pre-pass: inyectar + parsear + sanitizar TODO antes de crear nada ──
  // Si falta un token (o un enrollment "then" apunta a un flow que no se incluyó), esto
  // tira ANTES de crear workflows en n8n → no quedan workflows huérfanos a medio provisionar.
  const prepared = [];
  for (const f of flows) {
    const webhookPath = cleanPath(f.tokens && f.tokens.ORA_WEBHOOK_PATH);
    const tokens = { ...autoTokens, ORA_WEBHOOK_ID: randomUUID(), ...(f.tokens || {}), ORA_WEBHOOK_PATH: webhookPath };
    let workflow;
    try {
      workflow = sanitizeWorkflow(JSON.parse(injectTokens(rawByFlow.get(f), tokens)), f.name || f.flowName);
    } catch (e) {
      const hint = /ORA_WEBHOOK_/.test(e.message)
        ? ' (el flow destino de un enrollment "then" no está incluido — activalo o quitá el "then")'
        : '';
      throw new Error(`Flow "${f.flowName}": ${e.message}${hint}`);
    }
    prepared.push({ f, workflow, webhookPath });
  }

  // ── 4. Create-pass: crear + activar (ya validado arriba) ──
  const createdWorkflows = [];
  for (const { f, workflow, webhookPath } of prepared) {
    const created = await n8nApi.createWorkflow(workflow);
    if (f.activate) await n8nApi.activateWorkflow(created.id);
    const webhookUrl = webhookPath ? `${n8nBase}/webhook/${webhookPath}` : null;
    createdWorkflows.push({ flowName: f.flowName, name: workflow.name, id: created.id, activated: !!f.activate, webhookUrl });
  }

  // ── 5. Reporte ────────────────────────────────────────────────
  return {
    clientName: clientName || null,
    locationId: ghl.locationId,
    credentialId: cred ? cred.id : null,
    workflows: createdWorkflows,
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })),
    })),
  };
}
