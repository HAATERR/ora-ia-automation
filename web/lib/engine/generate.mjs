// GENERADOR (puro): compila un flow-spec a los workflows de n8n (objetos JS, no archivos).
// Portado de provision/generate.mjs SIN cambiar la lógica de compilación (validada
// end-to-end contra n8n real). Único cambio: en vez de leer/escribir archivos, exporta
//   compileFlowSpec(spec) -> { [flowName]: workflowObject }
// Los workflows salen tokenizados con {{ORA_*}}; provisionToN8n() inyecta los valores.

const GHL = 'https://services.leadconnectorhq.com';
const OPENAI = 'https://api.openai.com/v1/chat/completions';
const stageTok = (role) => `{{ORA_STAGE_${String(role).toUpperCase()}}}`;

// ── factories de nodos ─────────────────────────────────────────
const ghlHeaders = { parameters: [
  { name: 'Authorization', value: 'Bearer {{ORA_PIT}}' },
  { name: 'Version', value: '2021-07-28' },
  { name: 'Accept', value: 'application/json' },
] };
const httpGhl = (name, method, url, jsonBody) => ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: { method, url, sendHeaders: true, headerParameters: ghlHeaders, ...(jsonBody ? { sendBody: true, specifyBody: 'json', jsonBody } : {}), options: {} } });
const httpOpenAI = (name, jsonBody) => ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: { method: 'POST', url: OPENAI, authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi', sendBody: true, specifyBody: 'json', jsonBody, options: {} },
  credentials: { openAiApi: { id: '{{ORA_OPENAI_CRED_ID}}', name: 'OpenAI account' } } });
const ifNode = (name, left, right, op = 'equals', type = 'string', single = false) => ({ name, type: 'n8n-nodes-base.if', typeVersion: 2,
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: name.replace(/\W/g, '').slice(0, 12) + '-c', leftValue: left, rightValue: right, operator: { type, operation: op, ...(single ? { singleValue: true } : {}) } }], combinator: 'and' }, options: {} } });
const waitNode = (name, amount, unit) => ({ name, type: 'n8n-nodes-base.wait', typeVersion: 1.1, parameters: { amount, unit } });
const codeNode = (name, jsCode) => ({ name, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode } });
const webhookNode = (name) => ({ name, type: 'n8n-nodes-base.webhook', typeVersion: 2, parameters: { httpMethod: 'POST', path: '{{ORA_WEBHOOK_PATH}}', responseMode: 'onReceived', options: {} }, webhookId: '{{ORA_WEBHOOK_ID}}' });
const setNode = (name, assignments) => ({ name, type: 'n8n-nodes-base.set', typeVersion: 3.4, parameters: { assignments: { assignments }, includeOtherFields: true, options: {} } });

// ── bodies GHL/OpenAI ──────────────────────────────────────────
const upsertBody = (stageToken, ref = "'Contacto'") =>
  `={{ JSON.stringify({ pipelineId: "{{ORA_PIPELINE_ID}}", locationId: "{{ORA_LOCATION_ID}}", contactId: $(${ref}).item.json.contactId, pipelineStageId: "${stageToken}", status: "open", name: ($(${ref}).item.json.contactName || $(${ref}).item.json.phone || "Lead") }) }}`;
const tagsBody = (tag) => `={{ JSON.stringify({ tags: ["${tag}"] }) }}`;
const gptBody = (promptExpr) =>
  `={{ JSON.stringify({ model: "{{ORA_OPENAI_MODEL}}", temperature: 0, messages: [ { role: "system", content: ${promptExpr} }, { role: "user", content: ($('Contacto').item.json.transcript || "sin transcripcion") } ] }) }}`;

const CF = {
  transcript: ['ORA_CF_TRANSCRIPT', "$('Contacto').item.json.transcript"],
  recording: ['ORA_CF_RECORDING', "$('Contacto').item.json.recordingLink"],
  duration: ['ORA_CF_DURATION', "String($('Contacto').item.json.callDuration || '')"],
};
const updateFieldsBody = (fields) =>
  `={{ JSON.stringify({ customFields: [ ${fields.map((f) => `{ id: "{{${CF[f][0]}}}", field_value: ${CF[f][1]} }`).join(', ')} ] }) }}`;

const NORMALIZE_JS = [
  "const b = $input.first().json.body ?? $input.first().json;",
  "const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).toLowerCase()) : (b.tags ? [String(b.tags).toLowerCase()] : []);",
  "let tag = 'answered';",
  "if (tags.includes('dnc')) tag = 'dnc'; else if (tags.includes('dna')) tag = 'dna'; else if (tags.includes('answered')) tag = 'answered';",
  "return [{ json: { toNumber: b.to_number ?? null, fromNumber: b.from_number ?? null, transcript: b.transcript ?? '', recordingLink: b.recording_link ?? '', callDuration: b.call_duration ?? '', appointment: b.appointment ?? '', tag, tagsRaw: tags } }];",
].join('\n');
const CONTACTO_JS = [
  "const c = ($input.first().json.contacts && $input.first().json.contacts[0]) || null;",
  "const n = $('Normalizar').item.json;",
  "return [{ json: { ...n, contactId: c ? c.id : '', found: !!c, contactName: c ? ((c.firstName || '') + ' ' + (c.lastName || '')).trim() : '' } }];",
].join('\n');
const findBody = () =>
  `={{ JSON.stringify({ locationId: "{{ORA_LOCATION_ID}}", pageLimit: 1, filters: [ { field: "phone", operator: "eq", value: $('Normalizar').item.json.toNumber } ] }) }}`;
const parseLabelJs = (labels) => [
  "const ch = $input.first().json.choices; const content = (ch && ch[0] && ch[0].message && ch[0].message.content) || '';",
  "let label = String(content).toLowerCase().replace(/[\"'.]/g, '').trim();",
  `const valid = ${JSON.stringify(labels)};`,
  `if (!valid.includes(label)) label = ${JSON.stringify(labels[labels.length - 1])};`,
  "return [{ json: { label, classifyRaw: content } }];",
].join('\n');

// ── builder de workflow ────────────────────────────────────────
class WB {
  constructor() { this.nodes = []; this.conns = {}; this.i = 0; }
  add(n, x, y) { n.id = 'n' + (++this.i); n.position = [x, y]; this.nodes.push(n); return n.name; }
  link(from, to, out = 0) { if (!from || !to) return; (this.conns[from] ??= { main: [] }); while (this.conns[from].main.length <= out) this.conns[from].main.push([]); this.conns[from].main[out].push({ node: to, type: 'main', index: 0 }); }
  wf(name) { return { name, nodes: this.nodes, connections: this.conns, settings: { executionOrder: 'v1' } }; }
}

// "Enrolar" en otro flow = POST al webhook de ese flow (token ORA_WEBHOOK_<FLOW>, lo inyecta el motor).
const enrollNode = (name, flow) => ({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
  parameters: { method: 'POST', url: `{{ORA_WEBHOOK_${String(flow).toUpperCase()}}}`, sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ contactId: $('Contacto').item.json.contactId }) }}`, options: {} } });

// acción de una etiqueta GPT: { stage, gptReasonRef?, then? } → devuelve nodo de entrada
function buildLabelAction(wb, label, la, x, y) {
  let entry, tail;
  if (la.gptReasonRef) {
    const gr = `GPT · Motivo (${label})`;
    wb.add(httpOpenAI(gr, gptBody("$('Set Prompts').item.json.reasonPrompt")), x, y);
    const up = `GHL · Stage ${label}`;
    wb.add(httpGhl(up, 'POST', GHL + '/opportunities/upsert', upsertBody(stageTok(la.stage))), x + 220, y);
    wb.link(gr, up); entry = gr; tail = up;
  } else {
    const up = `GHL · Stage ${label}`;
    wb.add(httpGhl(up, 'POST', GHL + '/opportunities/upsert', upsertBody(stageTok(la.stage))), x, y);
    entry = up; tail = up;
  }
  if (la.then) { const en = `Enrolar → ${la.then} (${label})`; wb.add(enrollNode(en, la.then), x + 680, y); wb.link(tail, en); }
  return entry;
}

// acción de una ruta por tag: { stage } | { gptClassify } → devuelve nodo de entrada
function buildRouteAction(wb, key, action, x, y) {
  if (action.gptClassify) {
    const setName = 'Set Prompts';
    wb.add(setNode(setName, [
      { id: 'p1', name: 'classifyPrompt', value: '{{ORA_GPT_CLASSIFY_PROMPT}}', type: 'string' },
      { id: 'p2', name: 'reasonPrompt', value: '{{ORA_GPT_REASON_PROMPT}}', type: 'string' },
    ]), x, y);
    wb.add(httpOpenAI('GPT · Clasificar', gptBody('$json.classifyPrompt')), x + 220, y);
    const labels = Object.keys(action.gptClassify.labels);
    wb.add(codeNode('Parse Label', parseLabelJs(labels)), x + 440, y);
    wb.link(setName, 'GPT · Clasificar'); wb.link('GPT · Clasificar', 'Parse Label');
    let prev = 'Parse Label', prevOut = 0, lx = x + 660, ly = y;
    const entries = Object.entries(action.gptClassify.labels);
    entries.forEach(([label, la], i) => {
      const isLast = i === entries.length - 1;
      const entry = buildLabelAction(wb, label, la, lx + 220, ly + 140);
      if (isLast) { wb.link(prev, entry, prevOut); }
      else { const ifn = `¿${label}?`; wb.add(ifNode(ifn, "={{ $('Parse Label').item.json.label }}", label), lx, ly); wb.link(prev, ifn, prevOut); wb.link(ifn, entry, 0); prev = ifn; prevOut = 1; lx += 220; ly += 60; }
    });
    return setName;
  }
  const up = `GHL · Stage ${key}`;
  wb.add(httpGhl(up, 'POST', GHL + '/opportunities/upsert', upsertBody(stageTok(action.stage))), x, y);
  if (action.then) { const en = `Enrolar → ${action.then} (${key})`; wb.add(enrollNode(en, action.then), x + 220, y); wb.link(up, en); }
  return up;
}

function compileAnalisis(flow) {
  const wb = new WB();
  wb.add(webhookNode('Webhook · Simpletalk'), 220, 400);
  wb.add(codeNode('Normalizar', NORMALIZE_JS), 420, 400);
  wb.add(httpGhl('GHL · Find Contact', 'POST', GHL + '/contacts/search', findBody()), 620, 400);
  wb.add(codeNode('Contacto', CONTACTO_JS), 820, 400);
  wb.add(ifNode('¿contacto encontrado?', "={{ $('Contacto').item.json.contactId }}", '', 'notEmpty', 'string', true), 1020, 400);
  wb.add(httpGhl('GHL · Update Call Summary', 'PUT', "=" + GHL + "/contacts/{{ $('Contacto').item.json.contactId }}", updateFieldsBody(flow.updateCallSummary)), 1240, 360);
  wb.link('Webhook · Simpletalk', 'Normalizar'); wb.link('Normalizar', 'GHL · Find Contact');
  wb.link('GHL · Find Contact', 'Contacto'); wb.link('Contacto', '¿contacto encontrado?');
  wb.link('¿contacto encontrado?', 'GHL · Update Call Summary', 0);
  const routes = Object.entries(flow.routes);
  let prev = 'GHL · Update Call Summary', prevOut = 0, x = 1460, y = 360;
  routes.forEach(([tag, action], i) => {
    const isLast = i === routes.length - 1;
    const entry = buildRouteAction(wb, tag, action, x + 220, y + 180);
    if (isLast) { wb.link(prev, entry, prevOut); }
    else { const ifn = `¿tag = ${tag}?`; wb.add(ifNode(ifn, "={{ $('Contacto').item.json.tag }}", tag), x, y); wb.link(prev, ifn, prevOut); wb.link(ifn, entry, 0); prev = ifn; prevOut = 1; x += 220; y += 180; }
  });
  return wb.wf('Analisis Post-Llamada (template)');
}

function compileSeguimientos(flow) {
  const wb = new WB();
  let prev = wb.add(webhookNode('Webhook · Enrolado'), 220, 400), x = 420, n = 0;
  let lastEval = null;
  for (const step of flow.sequence) {
    n++;
    if (step.wait) { const m = String(step.wait).match(/^(\d+)([hmd])$/); const unit = { h: 'hours', m: 'minutes', d: 'days' }[m[2]]; const name = `Wait ${step.wait}`; wb.add(waitNode(name, +m[1], unit), x, 400); wb.link(prev, name); prev = name; }
    else if (step.stopIfAnswered) {
      const gc = `Get Contact ${n}`; wb.add(httpGhl(gc, 'GET', "=" + GHL + "/contacts/{{ $('Webhook · Enrolado').item.json.body.contactId }}", null), x, 400); linkPrev(wb, prev, gc);
      const ev = `Eval ${n}`; wb.add(codeNode(ev, ["const c = $json.contact ?? $json;", "const tags = (c.tags || []).map(t => String(t).toLowerCase());", "return [{ json: { contactId: c.id, phone: c.phone, answered: tags.includes('answered') } }];"].join('\n')), x + 200, 400); wb.link(gc, ev);
      const iff = `¿contestó ${n}?`; wb.add(ifNode(iff, `={{ $('${ev}').item.json.answered }}`, '', 'true', 'boolean', true), x + 400, 400); wb.link(ev, iff);
      // true (contestó): si hay onAnswered, mover de stage; si no, termina.
      if (step.onAnswered && step.onAnswered.stage) { const up = `GHL · Stage ${step.onAnswered.stage} (contestó ${n})`; wb.add(httpGhl(up, 'POST', GHL + '/opportunities/upsert', upsertBody(stageTok(step.onAnswered.stage), `'${ev}'`)), x + 400, 240); wb.link(iff, up, 0); }
      lastEval = ev; x += 600;
      // false (no contestó) sigue por la salida 1.
      prev = { node: iff, out: 1 };
    }
    else if (step.call) { const name = `Tag "llamar" ${n}`; wb.add(httpGhl(name, 'POST', `=${GHL}/contacts/{{ $('${lastEval || 'Contacto'}').item.json.contactId }}/tags`, tagsBody('{{ORA_TAG_LLAMAR}}')), x, 520); linkPrev(wb, prev, name); prev = name; x += 220; }
    else if (step.stage) { const name = `GHL · Stage ${step.stage} ${n}`; wb.add(httpGhl(name, 'POST', GHL + '/opportunities/upsert', upsertBody(stageTok(step.stage), `'${lastEval || 'Contacto'}'`)), x, 520); linkPrev(wb, prev, name); prev = name; x += 220; }
  }
  return wb.wf('Seguimientos (template)');
}
function linkPrev(wb, prev, to) { if (prev && prev.node) wb.link(prev.node, to, prev.out); else wb.link(prev, to); }

function compileCita(flow) {
  const wb = new WB();
  // Trigger por webhook (lo enrola el tag de cita en GHL). n8n mueve a Éxito; los recordatorios
  // los maneja GHL (snapshot) — n8n solo confirma el stage.
  const wh = wb.add(webhookNode('Webhook · Cita agendada'), 220, 400);
  const gc = wb.add(httpGhl('GHL · Stage Éxito', 'POST', GHL + '/opportunities/upsert',
    `={{ JSON.stringify({ pipelineId: "{{ORA_PIPELINE_ID}}", locationId: "{{ORA_LOCATION_ID}}", contactId: $('Webhook · Cita agendada').item.json.body.contactId, pipelineStageId: "${stageTok(flow.stage)}", status: "won", name: "Cita agendada" }) }}`), 440, 400);
  wb.link(wh, gc);
  // Recordatorios: n8n etiqueta para que GHL dispare su secuencia de recordatorios.
  if (flow.reminders) { const tag = wb.add(httpGhl('Tag recordatorios (GHL)', 'POST', `=${GHL}/contacts/{{ $('Webhook · Cita agendada').item.json.body.contactId }}/tags`, tagsBody('{{ORA_TAG_RECORDATORIOS}}')), 660, 400); wb.link(gc, tag); }
  return wb.wf('Cita Agendada (template)');
}

const COMPILERS = { analisis_postllamada: compileAnalisis, seguimientos: compileSeguimientos, cita_agendada: compileCita };

// Lista de flows compilables (para que la UI sepa cuáles tienen compilador).
export const COMPILABLE_FLOWS = Object.keys(COMPILERS);

// compileFlowSpec(spec) -> { [flowName]: { name, nodes, connections, settings } }
// `spec` es el flow-spec (mismo formato que flows/<x>.flow.json). Devuelve un objeto
// con un workflow por cada flow que tenga compilador (los demás se ignoran).
export function compileFlowSpec(spec) {
  if (!spec || !spec.flows) throw new Error('compileFlowSpec: el flow-spec no tiene "flows".');
  const out = {};
  for (const [flowName, flow] of Object.entries(spec.flows)) {
    const compile = COMPILERS[flowName];
    if (!compile) continue; // flow sin compilador (ej. chatbot) → se ignora
    out[flowName] = compile(flow);
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`compileFlowSpec: ningún flow compilable. Flows recibidos: ${Object.keys(spec.flows).join(', ')}. Compilables: ${COMPILABLE_FLOWS.join(', ')}.`);
  }
  return out;
}
