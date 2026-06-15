// POST /api/provision  — crea los workflows del cliente en n8n.
// Body: { spec, pit, locationId, clientName?, credentialName?, outcomeMap?, flows }
//   spec:  flow-spec revisado (se compila en el server con compileFlowSpec)
//   flows: [{ flowName, name, activate, tokens }]  ← config del formulario por flow
// Devuelve el reporte (ids de workflows, webhook URLs, pipelines, credentialId).
import { compileFlowSpec, provisionToN8n } from "../../../lib/engine/index.mjs";

export const runtime = "nodejs";
export const maxDuration = 60; // varias llamadas a n8n + GHL

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body inválido (se esperaba JSON)." }, { status: 400 });
  }

  const { spec, pit, locationId, clientName, credentialName, outcomeMap, flows } = body || {};

  if (!process.env.N8N_BASE_URL || !process.env.N8N_API_KEY) {
    return Response.json({ error: "Faltan N8N_BASE_URL / N8N_API_KEY en el servidor." }, { status: 500 });
  }
  if (!spec || !spec.flows) return Response.json({ error: "Falta el flow-spec ('spec')." }, { status: 400 });
  if (!pit || !locationId) return Response.json({ error: "Faltan 'pit' y/o 'locationId'." }, { status: 400 });
  if (!Array.isArray(flows) || flows.length === 0) {
    return Response.json({ error: "No hay flows seleccionados para provisionar." }, { status: 400 });
  }

  // 1. Compilar el flow-spec a workflows (objetos).
  let compiled;
  try {
    compiled = compileFlowSpec(spec);
  } catch (err) {
    return Response.json({ error: err?.message || "No pude compilar el flow-spec." }, { status: 400 });
  }

  // 2. Acoplar cada flow pedido por el form con su workflow compilado.
  const flowsToProvision = [];
  for (const f of flows) {
    const workflow = compiled[f.flowName];
    if (!workflow) {
      return Response.json(
        { error: `El flow "${f.flowName}" no está en el flow-spec o no es compilable.` },
        { status: 400 },
      );
    }
    flowsToProvision.push({
      flowName: f.flowName,
      name: f.name || workflow.name,
      activate: !!f.activate,
      tokens: f.tokens || {},
      workflow,
    });
  }

  // 3. Provisionar.
  try {
    const report = await provisionToN8n({
      n8n: { baseUrl: process.env.N8N_BASE_URL, apiKey: process.env.N8N_API_KEY },
      ghl: { pit, locationId },
      clientName,
      credentialName,
      outcomeMap,
      flows: flowsToProvision,
    });
    return Response.json({ report });
  } catch (err) {
    // Incluye "Placeholders sin resolver: {{ORA_...}}" si falta un token del form.
    return Response.json({ error: err?.message || "Error provisionando en n8n." }, { status: 502 });
  }
}
