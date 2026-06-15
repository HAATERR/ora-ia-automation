#!/usr/bin/env node
// FRONT-END del pipeline: imagen del flujograma (Miro/Figma/screenshot) → flow-spec JSON.
// Usa Claude (Opus 4.8, visión + adaptive thinking) para interpretar el diagrama.
//
//   node provision/extract-flow.mjs <imagen> <proyecto>
//   → escribe flows/<proyecto>.flow.json  (el developer lo revisa antes de generate)
//
// Requiere ANTHROPIC_API_KEY en el entorno o en .env.

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from './lib/template.mjs';

loadEnv();

const imgPath = process.argv[2];
const project = process.argv[3] || 'cliente';
if (!imgPath) {
  console.error('Uso: node provision/extract-flow.mjs <imagen.png> <proyecto>');
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Falta ANTHROPIC_API_KEY (poné la key en .env o en el entorno).');
  process.exit(1);
}

const ext = imgPath.toLowerCase().split('.').pop();
let imgBuffer, mediaType;
if (ext === 'svg') {
  // La API de visión necesita un raster → rasterizamos el SVG a PNG.
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(await readFile(imgPath), { background: '#e5e7eb', fitTo: { mode: 'width', value: 1600 } });
  imgBuffer = Buffer.from(resvg.render().asPng());
  mediaType = 'image/png';
  console.log('   (SVG rasterizado a PNG)');
} else {
  imgBuffer = await readFile(imgPath);
  mediaType = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' })[ext] || 'image/png';
}
const data = imgBuffer.toString('base64');

// Ejemplo canónico para que la salida matchee el formato que consume generate.mjs.
const example = await readFile('flows/primedental.flow.json', 'utf8');

const SYSTEM = `Sos un analista que convierte FLUJOGRAMAS de "cableado" post-llamada de agentes de voz (acordados con el cliente, dibujados en Miro/Figma) en un FLOW-SPEC en JSON que compila un generador de workflows de n8n.

El flujograma tiene cajas (stages del pipeline) y flechas (transiciones), a veces con etiquetas en las flechas (condiciones).

Mapeo típico:
- El tronco "Lead → Llamada en curso → {DNC | DNA | Contestó}" se compila en el flow "analisis_postllamada", ruteado por el tag de Simpletalk (dnc/dna/answered).
- La rama "Contestó" (con sub-salidas tipo Éxito / No Calificado / Derivado a WhatsApp / "Pide texto") se compila como una clasificación GPT con etiquetas: "whatsapp", "llamada ia", "seguimiento manual".
- La rama "DNA → Seguimiento Multicanal → Llamada a las 2h → 24h" se compila en el flow "seguimientos" (secuencia con wait 2h / 24h y "call": true = poner tag llamar).
- Si hay una rama de cita/recordatorios, se compila en "cita_agendada".

Devolvé EXCLUSIVAMENTE un JSON válido con EXACTAMENTE el mismo formato y claves que este ejemplo (cambiando project/description y ajustando stages/flows según el flujograma de la imagen). NO incluyas texto fuera del JSON, ni fences markdown.

=== EJEMPLO DE FORMATO (flow-spec de "primedental") ===
${example}
=== FIN DEL EJEMPLO ===`;

console.log(`\n▶ Interpretando "${imgPath}" → flow-spec de "${project}" (Claude Opus 4.8)…\n`);

const client = new Anthropic();
const resp = await client.messages.create({
  model: 'claude-opus-4-8',
  max_tokens: 16000,
  thinking: { type: 'adaptive' },
  system: SYSTEM,
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
      { type: 'text', text: `Interpretá este flujograma y devolvé el flow-spec del proyecto "${project}". Solo el JSON.` },
    ],
  }],
});

const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

let spec;
try {
  spec = JSON.parse(jsonStr);
} catch (e) {
  console.error('❌ La respuesta no fue JSON válido. Cruda:\n', text.slice(0, 800));
  process.exit(1);
}
if (!spec.flows) { console.error('❌ El flow-spec no tiene "flows".'); process.exit(1); }

const out = `flows/${project}.flow.json`;
await writeFile(out, JSON.stringify(spec, null, 2) + '\n');
console.log(`✅ ${out} — flows: ${Object.keys(spec.flows).join(', ')}`);
console.log('   Revisalo y después:  node provision/generate.mjs ' + out + '\n');
