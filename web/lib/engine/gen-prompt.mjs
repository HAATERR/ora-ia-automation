// Genera con Claude un PROMPT de clasificación de llamadas completo y detallado, a medida de
// las etiquetas de salida del nodo IA (léxico por etiqueta, reglas por prioridad, salida
// estricta). Usa como guía de estilo el prompt de referencia (nivel Primedental).

import Anthropic from "@anthropic-ai/sdk";

// Prompt de referencia: marca el ESTILO y nivel de detalle esperado (etiquetas de ejemplo).
const STYLE_EXAMPLE = `# Prompt: Clasificacion de llamada (UNA SOLA SALIDA, SOLO 3 ETIQUETAS)

ROL
Eres un analista de llamadas. Analiza la transcripcion y devuelve EXACTAMENTE UNA etiqueta.

FUENTE UNICA (usa la primera disponible)
1) {{inboundWebhookRequest.transcript}}
2) Si (1) esta vacia o no existe, usar {{contact.ai_transcript}}
Si ambas estan vacias -> salida: llamada ia

PROHIBIDO
- Inventar contexto o usar conocimiento externo.
- Imprimir mas de UNA linea o cualquier texto extra.
- Usar comillas, acentos o mayusculas.

NORMALIZACION (antes de decidir)
- Pasar a minusculas. Quitar tildes/diacriticos.
- Tolerar errores comunes ASR/typos (ej.: "watsapp/guasap/wsp", "voismail/voicemail").
- Aceptar numeros en digitos o palabras. Ignorar muletillas y ruido.

OBJETIVO
Solo debes devolver UNA de estas 3 etiquetas:
- llamada ia
- seguimiento manual
- whatsapp

LEXICON CLAVE (detectar intencion)
A) llamada ia (reintento automatico / no hubo avance real): "ahora no puedo", "llamame mas tarde", "no contesto", "buzon"...
B) seguimiento manual (requiere humano o no se concreto): "quiero un asesor", "no me interesa", "tengo dudas"...
C) whatsapp (derivar al canal de texto): "mandame por whatsapp", "se agendo la cita", "pidio la direccion de la sucursal"...

REGLAS (prioridad estricta, evaluar en este orden)
1) Si se agendo cita -> whatsapp
2) Si pidio continuar por whatsapp/sms/chat/texto -> whatsapp
3) Si pidio direccion/ubicacion -> whatsapp
4) Si pidio humano/asesor, queja, dudas, rechazo definitivo -> seguimiento manual
5) Si pidio precios pero no acepto cita ni whatsapp -> seguimiento manual
6) Si ocupado o pidio que lo llamen mas tarde por voz -> llamada ia
7) Si no hubo contacto real (no contesta, buzon, se corta) -> llamada ia
8) Si hay conversacion pero no es claro a que canal derivar -> seguimiento manual

FORMATO DE SALIDA (ESTRICTO)
Imprime SOLO una linea, en minusculas, sin acentos, sin comillas. Opciones validas: llamada ia | seguimiento manual | whatsapp`;

const SYSTEM = `Sos un experto en prompts para clasificar llamadas de agentes de voz (analisis post-llamada) que rutean leads en un CRM. Te dan las ETIQUETAS de salida y opcionalmente el contexto del negocio, y devolves UN prompt en español que:
- Instruye a clasificar la transcripcion en EXACTAMENTE UNA de las etiquetas dadas (ni mas ni menos).
- Tiene estas secciones: ROL, FUENTE (transcripcion; si esta vacia, una etiqueta de fallback razonable), PROHIBIDO, NORMALIZACION (minusculas, sin tildes, typos ASR), LEXICON con frases/intenciones tipicas POR CADA etiqueta, REGLAS en orden de prioridad estricta, y FORMATO DE SALIDA estricto (una sola linea, minusculas, sin acentos ni comillas).
- El lexicon y las reglas deben ser COHERENTES con el significado de cada etiqueta y con el contexto dado. Inferi el significado de cada etiqueta por su nombre.
- La salida del modelo clasificador debe ser exactamente una de las etiquetas, tal cual fueron escritas (mismas palabras, minusculas).

Devolve SOLO el texto del prompt, sin explicaciones, sin comentarios y sin fences markdown.

=== EJEMPLO DE ESTILO Y NIVEL DE DETALLE (otras etiquetas) ===
${STYLE_EXAMPLE}
=== FIN DEL EJEMPLO ===`;

// generateClassifyPrompt({ labels, project, context, apiKey }) -> string (el prompt)
export async function generateClassifyPrompt({ labels, project = "", context = "", apiKey }) {
  if (!apiKey) throw new Error("generateClassifyPrompt: falta ANTHROPIC_API_KEY.");
  const list = (labels || []).filter(Boolean);
  if (list.length < 2) throw new Error("Definí al menos 2 etiquetas en el nodo IA para generar el prompt.");

  const client = new Anthropic({ apiKey });
  const user = `Etiquetas de salida (exactas): ${list.map((l) => `"${l}"`).join(", ")}.
Negocio / contexto: ${context?.trim() || project?.trim() || "agencia de agentes de voz y chatbots (Ora IA)"}.
Generá el prompt de clasificación para estas etiquetas.`;

  const resp = await client.messages.create(
    {
      model: "claude-opus-4-8",
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 55000 },
  );
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return text.replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/, "").trim();
}
