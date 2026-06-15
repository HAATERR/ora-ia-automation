// Inyección de tokens {{ORA_*}} en un template de workflow y sanitización antes de
// POST a n8n. Funciones PURAS (sin file I/O). Portado de provision/lib/template.mjs;
// se omiten loadEnv() y resolveValue('@archivo') porque en la web no hay disco:
// los secretos vienen de process.env (en la ruta) y los prompts del formulario.

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
