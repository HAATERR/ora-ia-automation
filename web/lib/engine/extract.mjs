// FRONT-END del pipeline (puro, sin file I/O): imagen del flujograma → flow-spec.
// Portado de provision/extract-flow.mjs. Diferencias para la web:
//   - recibe la imagen como Buffer + mediaType (la ruta la lee del upload), no de disco;
//   - la API key se pasa explícita (la ruta la toma de process.env), no por env global;
//   - el few-shot (flow-spec de primedental) va inline, así web/ es self-contained.

import Anthropic from '@anthropic-ai/sdk';

// Few-shot canónico: fija el formato exacto que consume compileFlowSpec().
// Es una copia de flows/primedental.flow.json (mantener en sync si cambia el formato).
const EXAMPLE_FLOW_SPEC = JSON.stringify({
  project: 'primedental',
  description: 'Cableado Prime Dental Studio (voz + WhatsApp)',
  stages: ['lead_nuevo', 'llamada_curso', 'dnc', 'dna', 'whatsapp', 'seguimiento', 'no_calificado', 'exito'],
  flows: {
    analisis_postllamada: {
      trigger: { type: 'webhook' },
      findContactBy: 'to_number',
      updateCallSummary: ['transcript', 'recording', 'duration'],
      routeBy: 'simpletalk_tag',
      routes: {
        dnc: { stage: 'dnc' },
        dna: { stage: 'dna', then: 'seguimientos' },
        answered: {
          gptClassify: {
            promptRef: 'clasificacion',
            labels: {
              whatsapp: { stage: 'whatsapp' },
              'llamada ia': { stage: 'seguimiento', then: 'seguimientos' },
              'seguimiento manual': { stage: 'seguimiento', gptReasonRef: 'motivo', notify: true },
            },
          },
        },
      },
    },
    seguimientos: {
      trigger: { type: 'webhook' },
      sequence: [
        { wait: '2h' },
        { call: true },
        { wait: '24h' },
        { call: true },
      ],
    },
    cita_agendada: {
      trigger: { type: 'tag', tag: 'cita agendada' },
      stage: 'exito',
      reminders: [
        { before: '1d', via: 'ghl', messageRef: 'recordatorio_1d' },
        { before: '4h', via: 'ghl', messageRef: 'recordatorio_4h' },
      ],
    },
  },
}, null, 2);

const SYSTEM = `Sos un analista que convierte FLUJOGRAMAS de "cableado" post-llamada de agentes de voz (acordados con el cliente, dibujados en Miro/Figma) en un FLOW-SPEC en JSON que compila un generador de workflows de n8n.

El flujograma tiene cajas (stages del pipeline) y flechas (transiciones), a veces con etiquetas en las flechas (condiciones).

Mapeo típico:
- El tronco "Lead → Llamada en curso → {DNC | DNA | Contestó}" se compila en el flow "analisis_postllamada", ruteado por el tag de Simpletalk (dnc/dna/answered).
- La rama "Contestó" (con sub-salidas tipo Éxito / No Calificado / Derivado a WhatsApp / "Pide texto") se compila como una clasificación GPT con etiquetas: "whatsapp", "llamada ia", "seguimiento manual".
- La rama "DNA → Seguimiento Multicanal → Llamada a las 2h → 24h" se compila en el flow "seguimientos" (secuencia con wait 2h / 24h y "call": true = poner tag llamar).
- Si hay una rama de cita/recordatorios, se compila en "cita_agendada".

Devolvé EXCLUSIVAMENTE un JSON válido con EXACTAMENTE el mismo formato y claves que este ejemplo (cambiando project/description y ajustando stages/flows según el flujograma de la imagen). NO incluyas texto fuera del JSON, ni fences markdown.

=== EJEMPLO DE FORMATO (flow-spec de "primedental") ===
${EXAMPLE_FLOW_SPEC}
=== FIN DEL EJEMPLO ===`;

// media types que la API de visión de Claude acepta directo (sin rasterizar).
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// Rasteriza un SVG (Buffer) a PNG (Buffer) con @resvg/resvg-js. Import dinámico para
// que el binario nativo solo se cargue cuando hace falta.
async function rasterizeSvg(svgBuffer) {
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(svgBuffer, { background: '#e5e7eb', fitTo: { mode: 'width', value: 1600 } });
  return Buffer.from(resvg.render().asPng());
}

// extractFlow({ imageBuffer, mediaType, project, apiKey }) -> flow-spec (objeto)
//   imageBuffer: Buffer con la imagen del flujograma (PNG/JPG/GIF/WEBP) o un SVG.
//   mediaType:   p.ej. 'image/png' o 'image/svg+xml'.
//   project:     nombre del proyecto/cliente (va en el flow-spec).
//   apiKey:      ANTHROPIC_API_KEY (la ruta la toma de process.env).
export async function extractFlow({ imageBuffer, mediaType, project = 'cliente', apiKey }) {
  if (!apiKey) throw new Error('extractFlow: falta ANTHROPIC_API_KEY.');
  if (!imageBuffer || !imageBuffer.length) throw new Error('extractFlow: imagen vacía.');

  let buf = imageBuffer;
  let type = mediaType;
  if (type === 'image/svg+xml' || type === 'image/svg') {
    buf = await rasterizeSvg(imageBuffer);
    type = 'image/png';
  } else if (!RASTER_TYPES.has(type)) {
    throw new Error(`extractFlow: media type no soportado: ${type} (usá PNG, JPG, GIF, WEBP o SVG).`);
  }
  const data = buf.toString('base64');

  const client = new Anthropic({ apiKey });
  // timeout explícito (< maxDuration de la ruta=60s): sin esto el SDK usa un budget de
  // ~10min y, si Opus+thinking se pasa de 60s, Vercel mata la función con un 504 opaco que
  // saltea el try/catch de la ruta. Con 55s el SDK aborta antes y la ruta da un error limpio.
  const resp = await client.messages.create(
    {
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: type, data } },
          { type: 'text', text: `Interpretá este flujograma y devolvé el flow-spec del proyecto "${project}". Solo el JSON.` },
        ],
      }],
    },
    { timeout: 55000 },
  );

  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let spec;
  try {
    spec = JSON.parse(jsonStr);
  } catch {
    throw new Error('La respuesta de Claude no fue JSON válido. Cruda: ' + text.slice(0, 400));
  }
  if (!spec.flows) throw new Error('El flow-spec generado no tiene "flows".');
  if (!spec.project) spec.project = project;
  return spec;
}
