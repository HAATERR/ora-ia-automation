// Motor de provisioning Ora IA, portado a funciones PURAS (sin file I/O) para correr
// en las API routes de Next/Vercel (serverless, stateless). Punto de entrada único.
//
//   imagen → extractFlow → flow-spec → compileFlowSpec → workflows → provisionToN8n → n8n
//   ghlInfo: pipelines/customFields/customValues de una subcuenta (para los dropdowns).

export { extractFlow } from './extract.mjs';
export { generateClassifyPrompt } from './gen-prompt.mjs';
export { compileFlowSpec, COMPILABLE_FLOWS } from './generate.mjs';
export { provisionToN8n, ghlInfo } from './provision.mjs';
export { injectTokens, sanitizeWorkflow } from './template.mjs';
export { ghlClient } from './ghl.mjs';
export { n8nClient } from './n8n.mjs';
