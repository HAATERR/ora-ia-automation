// Genera prompts por defecto a partir de las ETIQUETAS de clasificación que el usuario puso
// en el nodo IA (o que Claude detectó del flujograma). El resultado pre-rellena el campo del
// form, pero queda editable (es un textarea) para pegar la versión detallada por cliente.

// Prompt de clasificación: una sola salida, exactamente una de las etiquetas dadas.
export function buildClassifyPrompt(labels) {
  const list = (labels || []).filter(Boolean);
  const fallback = list[list.length - 1] || "seguimiento manual";
  const bullets = list.map((l) => `- ${l}`).join("\n");
  const reglas = list.map((l) => `- Si la intencion del lead corresponde a "${l}", devuelve: ${l}`).join("\n");
  return `Eres un analista de llamadas. Analiza la transcripcion y devuelve EXACTAMENTE UNA de estas etiquetas (una sola linea, en minusculas, sin acentos, sin comillas ni texto extra):
${bullets}

FUENTE
- Usa la transcripcion provista. Si esta vacia o no existe, devuelve: ${fallback}

NORMALIZACION (antes de decidir)
- Pasar a minusculas y quitar acentos/diacriticos.
- Tolerar typos y variantes de ASR (ej.: "watsapp/guasap/wsp" -> whatsapp).
- Aceptar numeros en digitos o palabras; ignorar muletillas y ruido ("eh", "mmm", risas).

REGLAS (evaluar en orden, devolver al primer match)
${reglas}
- Si hay conversacion pero no es claro a que etiqueta corresponde, devuelve: ${fallback}

SALIDA (ESTRICTO)
Imprime SOLO una linea con una de las etiquetas validas, en minusculas y sin acentos.`;
}

// Prompt de "motivo" (para la etiqueta marcada con "motivo"): una frase corta.
export function buildReasonPrompt() {
  return `Eres un analista de llamadas. A partir de la transcripcion, resume en UNA frase corta (maximo 15 palabras) el motivo principal por el que el lead necesita seguimiento manual. Devuelve solo la frase, sin comillas ni texto extra. Si la transcripcion esta vacia, devuelve: sin informacion suficiente.`;
}
