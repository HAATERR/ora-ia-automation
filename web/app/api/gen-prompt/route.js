// POST /api/gen-prompt — { labels, project?, context? } → { prompt }
// Claude genera un prompt de clasificación detallado a medida de las etiquetas del nodo IA.
import { generateClassifyPrompt } from "../../../lib/engine/index.mjs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, { status: 500 });

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body inválido." }, { status: 400 });
  }
  const { labels, project, context } = body || {};
  if (!Array.isArray(labels) || labels.filter(Boolean).length < 2) {
    return Response.json({ error: "Definí al menos 2 etiquetas en el nodo IA." }, { status: 400 });
  }

  try {
    const prompt = await generateClassifyPrompt({ labels, project, context, apiKey });
    return Response.json({ prompt });
  } catch (err) {
    return Response.json({ error: err?.message || "Error generando el prompt." }, { status: 502 });
  }
}
