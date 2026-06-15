import { loadEnv } from './lib/template.mjs';
import { n8nClient } from './lib/n8n.mjs';
loadEnv();
const id = process.argv[2];
const n8n = n8nClient({ baseUrl: process.env.N8N_BASE_URL, apiKey: process.env.N8N_API_KEY });
const wf = await n8n.getWorkflow(id);
console.log('Nombre:', wf.name, '| activo:', wf.active, '| nodos:', wf.nodes.length);
console.log('Conexiones (nodos origen):', Object.keys(wf.connections).length);
const raw = JSON.stringify(wf);
console.log('PIT en headers:', raw.includes('Bearer pit-') ? 'OK' : 'NO', '| leftover {{ORA_}}:', (raw.match(/\{\{ORA_/g) || []).length);
const oa = wf.nodes.find((n) => n.credentials && n.credentials.openAiApi);
console.log('OpenAI cred:', oa ? oa.credentials.openAiApi.id : 'NO');
const types = [...new Set(wf.nodes.map((n) => n.type.split('.').pop()))];
console.log('Tipos de nodo:', types.join(', '));
const names = new Set(wf.nodes.map((n) => n.name));
const dangling = [];
for (const [src, c] of Object.entries(wf.connections)) {
  if (!names.has(src)) dangling.push('src:' + src);
  for (const out of c.main || []) for (const t of out || []) if (!names.has(t.node)) dangling.push('dst:' + t.node);
}
console.log('Conexiones colgadas:', dangling.length ? dangling.join(', ') : 'ninguna OK');
