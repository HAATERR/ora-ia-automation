// Helpers client-safe (JS puro) para saber qué tokens {{ORA_*}} necesita cada workflow
// compilado y cómo renderizar su campo en el formulario. compileFlowSpec/COMPILABLE_FLOWS
// viven en generate.mjs, que es JS puro (sin APIs de node) → se puede importar en el cliente.
import { COMPILABLE_FLOWS } from "@/lib/engine/generate.mjs";

// Tokens que el motor inyecta solo (no se piden en el form).
export const AUTO_TOKENS = new Set([
  "ORA_PIT", "ORA_CRED_ID", "ORA_CRED_NAME", "ORA_LOCATION_ID",
  "ORA_GHL_BASE", "ORA_GHL_VERSION", "ORA_OUTCOME_MAP", "ORA_WEBHOOK_ID",
]);
// URLs de webhook entre flows (enrollment): también las inyecta el motor.
export const ENROLL_TOKENS = new Set(COMPILABLE_FLOWS.map((f) => `ORA_WEBHOOK_${f.toUpperCase()}`));

// Tokens que SÍ se piden en el form para un workflow dado.
export function requiredTokens(workflow) {
  const found = JSON.stringify(workflow).match(/\{\{(ORA_[A-Z0-9_]+)\}\}/g) || [];
  const names = [...new Set(found.map((t) => t.slice(2, -2)))];
  return names.filter((n) => !AUTO_TOKENS.has(n) && !ENROLL_TOKENS.has(n)).sort();
}

// Flows en los que ESTE workflow "enrola" (then/onAnswered → POST al webhook del destino).
// Devuelve las claves de flow (minúscula) que tienen que crearse también. El motor inyecta
// esas URLs (ORA_WEBHOOK_<FLOW>) solo si el flow destino está incluido en la provisión.
export function enrollmentTargets(workflow) {
  const found = JSON.stringify(workflow).match(/\{\{(ORA_WEBHOOK_[A-Z0-9_]+)\}\}/g) || [];
  const toks = [...new Set(found.map((t) => t.slice(2, -2)))].filter((t) => ENROLL_TOKENS.has(t));
  return toks.map((t) => t.slice("ORA_WEBHOOK_".length).toLowerCase());
}

const pretty = (s) => s.toLowerCase().replace(/_/g, " ");

// Nombre corto del flow (para defaults de webhook path).
export const FLOW_SHORT = {
  analisis_postllamada: "analisis",
  seguimientos: "seguimientos",
  cita_agendada: "cita",
};
export const FLOW_LABEL = {
  analisis_postllamada: "Análisis post-llamada",
  seguimientos: "Seguimientos",
  cita_agendada: "Cita agendada",
};

// Metadata de cada campo: cómo renderizarlo y su default.
//   kind: "pipeline" | "stage" | "customField" | "text" | "textarea"
export function fieldMeta(token) {
  if (token === "ORA_PIPELINE_ID") return { kind: "pipeline", label: "Pipeline del cableado" };
  if (token.startsWith("ORA_STAGE_")) return { kind: "stage", label: `Stage · ${pretty(token.slice("ORA_STAGE_".length))}` };
  if (token.startsWith("ORA_CF_")) return { kind: "customField", label: `Custom field · ${pretty(token.slice("ORA_CF_".length))}` };
  if (token === "ORA_WEBHOOK_PATH") return { kind: "webhookPath", label: "Webhook path (n8n)", help: "La ruta del webhook en n8n. Elegila vos (única por workflow)." };
  if (token === "ORA_OPENAI_CRED_ID") return { kind: "text", label: "OpenAI cred ID (n8n)", help: "ID de la credencial OpenAI en tu n8n. Elegí una con cupo." };
  if (token === "ORA_OPENAI_MODEL") return { kind: "text", label: "Modelo OpenAI", default: "gpt-4o-mini" };
  if (token === "ORA_GPT_CLASSIFY_PROMPT") return { kind: "textarea", label: "Prompt de clasificación", help: "El system prompt que clasifica el resultado de la llamada." };
  if (token === "ORA_GPT_REASON_PROMPT") return { kind: "textarea", label: "Prompt de motivo", help: "El system prompt para extraer el motivo del seguimiento manual." };
  if (token === "ORA_TAG_LLAMAR") return { kind: "text", label: "Tag para lanzar llamada", default: "llamar" };
  if (token === "ORA_TAG_RECORDATORIOS") return { kind: "text", label: "Tag de recordatorios", default: "recordatorios-cita" };
  return { kind: "text", label: token };
}
