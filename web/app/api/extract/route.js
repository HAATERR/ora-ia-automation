// POST /api/extract  — multipart/form-data { image, project? } → { spec }
// Claude (Opus 4.8, visión) interpreta el flujograma y devuelve el flow-spec.
import { extractFlow } from "../../../lib/engine/index.mjs";

export const runtime = "nodejs"; // SDK Anthropic + addon nativo (resvg) → runtime Node, no edge
export const maxDuration = 60; // la llamada a Opus + thinking puede tardar 30-45s

export async function POST(request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "Falta ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
    }

    const form = await request.formData();
    const file = form.get("image");
    if (!file || typeof file === "string") {
      return Response.json({ error: "Subí una imagen del flujograma (campo 'image')." }, { status: 400 });
    }
    const project = (form.get("project") || "cliente").toString().trim() || "cliente";

    const imageBuffer = Buffer.from(await file.arrayBuffer());
    const spec = await extractFlow({ imageBuffer, mediaType: file.type, project, apiKey });

    return Response.json({ spec });
  } catch (err) {
    // Errores esperables: media type no soportado, JSON inválido de Claude, etc.
    return Response.json({ error: err?.message || "Error interpretando el flujograma." }, { status: 502 });
  }
}
